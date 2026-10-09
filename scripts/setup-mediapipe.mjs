// Copies MediaPipe's vision wasm out of node_modules and downloads the selfie
// segmentation model, so background blur is fully self-hosted (no runtime
// third-party requests). Generated assets land in public/mediapipe/ (gitignored)
// and are rebuilt on every install. Fail-soft: a missing asset only disables the
// blur toggle, it must never break `npm install`.
import { access, cp, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wasmSrc = resolve(root, "node_modules/@mediapipe/tasks-vision/wasm");
const wasmDest = resolve(root, "public/mediapipe/wasm");
const modelDir = resolve(root, "public/mediapipe/models");
const modelPath = resolve(modelDir, "selfie_segmenter_landscape.tflite");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/1/selfie_segmenter_landscape.tflite";

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(wasmSrc))) {
    console.warn(
      "[mediapipe] wasm missing in node_modules — background blur will be unavailable.",
    );
    return;
  }
  await cp(wasmSrc, wasmDest, { recursive: true });

  if (await exists(modelPath)) return;
  await mkdir(modelDir, { recursive: true });
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`model download failed: ${res.status}`);
  await writeFile(modelPath, Buffer.from(await res.arrayBuffer()));
  console.log("[mediapipe] assets ready");
}

main().catch((err) => {
  console.warn(`[mediapipe] ${err.message} — background blur will be unavailable.`);
});
