import type {
  FilesetResolver,
  ImageSegmenter,
  ImageSegmenterResult,
  MPMask,
} from "@mediapipe/tasks-vision";

// `WasmFileset` is declared but not exported, so derive it from the loader.
type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

// Self-hosted assets, produced by scripts/setup-mediapipe.mjs at install time.
const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/mediapipe/models/selfie_segmenter_landscape.tflite";

const OUTPUT_MAX_WIDTH = 640;
const CAPTURE_FPS = 30;
// Background blur is faked by downscaling then upscaling the frame — no
// ctx.filter dependency, so it looks the same in every browser.
const BG_DOWNSCALE = 10;

export function supportsBackgroundBlur(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function"
  );
}

// Takes a raw camera stream and republishes it as a video track with the
// background blurred: per frame it segments the person, composites a blurred
// copy of the frame underneath a sharp cut-out of the person, and hands the
// result to a canvas capture stream. Everything stays on the device.
export class BackgroundBlur {
  private readonly video = document.createElement("video");
  private readonly out = document.createElement("canvas");
  private readonly bg = document.createElement("canvas");
  private readonly bgSmall = document.createElement("canvas");
  private readonly person = document.createElement("canvas");
  private readonly mask = document.createElement("canvas");
  private segmenter: ImageSegmenter | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private lastTs = -1;
  private stopped = false;

  get track(): MediaStreamTrack | null {
    return this.stream?.getVideoTracks()[0] ?? null;
  }

  async start(raw: MediaStream): Promise<void> {
    const { FilesetResolver, ImageSegmenter: Segmenter } = await import(
      "@mediapipe/tasks-vision"
    );
    const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
    // GPU delegate is faster but not available everywhere; fall back to CPU.
    this.segmenter = await this.createSegmenter(vision, Segmenter, "GPU").catch(
      () => this.createSegmenter(vision, Segmenter, "CPU"),
    );

    // A detached video won't reliably decode; keep it in the DOM but off-screen.
    Object.assign(this.video.style, {
      position: "fixed",
      width: "160px",
      height: "120px",
      top: "0",
      left: "-10000px",
      pointerEvents: "none",
    });
    document.body.appendChild(this.video);
    this.video.srcObject = new MediaStream([raw.getVideoTracks()[0]]);
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play().catch(() => {});
    await this.awaitSize();

    const vw = this.video.videoWidth || 640;
    const vh = this.video.videoHeight || 480;
    const scale = Math.min(1, OUTPUT_MAX_WIDTH / vw);
    const w = Math.max(2, Math.round(vw * scale));
    const h = Math.max(2, Math.round(vh * scale));
    for (const canvas of [this.out, this.bg, this.person]) {
      canvas.width = w;
      canvas.height = h;
    }
    this.bgSmall.width = Math.max(2, Math.round(w / BG_DOWNSCALE));
    this.bgSmall.height = Math.max(2, Math.round(h / BG_DOWNSCALE));
    for (const ctx of this.contexts()) ctx.imageSmoothingEnabled = true;

    this.stream = this.out.captureStream(CAPTURE_FPS);
    this.raf = requestAnimationFrame(this.loop);
  }

  private async createSegmenter(
    vision: WasmFileset,
    Segmenter: typeof import("@mediapipe/tasks-vision").ImageSegmenter,
    delegate: "GPU" | "CPU",
  ): Promise<ImageSegmenter> {
    return Segmenter.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate },
      runningMode: "VIDEO",
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });
  }

  private awaitSize(): Promise<void> {
    if (this.video.videoWidth > 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.video.onloadedmetadata = () => resolve();
    });
  }

  private contexts(): CanvasRenderingContext2D[] {
    return [this.out, this.bg, this.bgSmall, this.person, this.mask]
      .map((c) => c.getContext("2d"))
      .filter((c): c is CanvasRenderingContext2D => c !== null);
  }

  private readonly loop = () => {
    if (this.stopped) return;
    this.raf = requestAnimationFrame(this.loop);
    const segmenter = this.segmenter;
    if (!segmenter || this.video.readyState < 2) return;

    let ts = performance.now();
    if (ts <= this.lastTs) ts = this.lastTs + 0.01;
    this.lastTs = ts;

    let result: ImageSegmenterResult;
    try {
      result = segmenter.segmentForVideo(this.video, ts);
    } catch {
      return;
    }

    const { width: w, height: h } = this.out;
    const maskImage = result.categoryMask;

    // Background: downscale the frame, then blow it back up — cheap, portable blur.
    const small = this.bgSmall.getContext("2d");
    const bg = this.bg.getContext("2d");
    const person = this.person.getContext("2d");
    const out = this.out.getContext("2d");
    if (!small || !bg || !person || !out) {
      result.close();
      return;
    }
    small.drawImage(this.video, 0, 0, this.bgSmall.width, this.bgSmall.height);
    bg.drawImage(
      this.bgSmall,
      0,
      0,
      this.bgSmall.width,
      this.bgSmall.height,
      0,
      0,
      w,
      h,
    );

    // Person: sharp frame, cut out with the segmentation mask.
    person.clearRect(0, 0, w, h);
    person.globalCompositeOperation = "source-over";
    person.drawImage(this.video, 0, 0, w, h);
    if (maskImage) {
      this.paintMask(maskImage);
      person.globalCompositeOperation = "destination-in";
      person.drawImage(this.mask, 0, 0, w, h);
      person.globalCompositeOperation = "source-over";
    }

    out.drawImage(this.bg, 0, 0);
    out.drawImage(this.person, 0, 0);
    result.close();
  };

  private paintMask(mask: MPMask) {
    const mw = mask.width;
    const mh = mask.height;
    const data = mask.getAsUint8Array();
    this.mask.width = mw;
    this.mask.height = mh;
    const ctx = this.mask.getContext("2d");
    if (!ctx) return;
    const image = ctx.createImageData(mw, mh);
    for (let i = 0; i < mw * mh; i++) {
      // The shipped selfie model's category mask marks the *background* with a
      // non-zero category and the person with 0 — the opposite of the docs'
      // "background 0 / person 1". Verified against the pinned model, so keep
      // the person (the zero pixel) opaque and let the background show through.
      image.data[i * 4] = 255;
      image.data[i * 4 + 1] = 255;
      image.data[i * 4 + 2] = 255;
      image.data[i * 4 + 3] = data[i] ? 0 : 255;
    }
    ctx.putImageData(image, 0, 0);
  }

  stop() {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    try {
      this.segmenter?.close();
    } catch {}
    this.segmenter = null;
    this.video.srcObject = null;
    this.video.remove();
  }
}
