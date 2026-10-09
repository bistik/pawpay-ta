import { deriveSecureCode } from "@/lib/secure-code";
import { BackgroundBlur } from "@/lib/background-blur";

export type DescType = "offer" | "answer" | "ice";
export type PeerControl =
  | "video-request"
  | "video-accept"
  | "video-decline"
  | "video-end"
  | "typing";

const PEER_CONTROLS: readonly PeerControl[] = [
  "video-request",
  "video-accept",
  "video-decline",
  "video-end",
  "typing",
];

// Reactions are a fixed whitelist, shared by the sender, the validator and the
// UI so the three can't drift apart. Emoji never reach the profanity mask.
export const REACTION_EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🔥"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJI)[number];
export type ReactionOp = "add" | "remove";
export type Reaction = { me: boolean; them: boolean };
export type ReactionMap = Partial<Record<ReactionEmoji, Reaction>>;

// Wire format for the chat data channel. A discriminated union on `t` keeps the
// send and receive halves in sync — a wrong tag is a compile error, not a
// silently dropped message. `chat` carries a shared id so a peer can point a
// reaction at a specific message.
type WireMessage =
  | { t: "chat"; id: string; text: string }
  | { t: "react"; to: string; emoji: ReactionEmoji; op: ReactionOp }
  | { t: "ctrl"; ctrl: PeerControl };

const WIRE_ID_MAX = 64;

function isWireId(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= WIRE_ID_MAX
  );
}

function parseWireMessage(data: unknown): WireMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const msg = data as Record<string, unknown>;
  if (msg.t === "chat" && isWireId(msg.id) && typeof msg.text === "string") {
    return { t: "chat", id: msg.id, text: msg.text };
  }
  if (
    msg.t === "react" &&
    isWireId(msg.to) &&
    REACTION_EMOJI.includes(msg.emoji as ReactionEmoji) &&
    (msg.op === "add" || msg.op === "remove")
  ) {
    return {
      t: "react",
      to: msg.to,
      emoji: msg.emoji as ReactionEmoji,
      op: msg.op,
    };
  }
  if (msg.t === "ctrl" && PEER_CONTROLS.includes(msg.ctrl as PeerControl)) {
    return { t: "ctrl", ctrl: msg.ctrl as PeerControl };
  }
  return null;
}

interface PeerCallbacks {
  onSignal: (type: DescType, payload: string) => void;
  onChat: (id: string, text: string) => void;
  onReact: (to: string, emoji: ReactionEmoji, op: ReactionOp) => void;
  onControl: (ctrl: PeerControl) => void;
  onRemoteStream: (stream: MediaStream | null) => void;
  onConnectionState: (state: RTCPeerConnectionState) => void;
  onChannelOpen: () => void;
  // Short authentication string, derived once both SDPs have arrived. Null when
  // it can't be computed (missing fingerprint, non-secure context).
  onSecureCode: (code: string | null) => void;
}

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export class PeerSession {
  private pc: RTCPeerConnection;
  private dc: RTCDataChannel | null = null;
  private readonly polite: boolean;
  private makingOffer = false;
  private ignoreOffer = false;
  private rawStream: MediaStream | null = null;
  private videoSender: RTCRtpSender | null = null;
  private blur: BackgroundBlur | null = null;
  private blurOn = false;
  private closed = false;
  private readonly cb: PeerCallbacks;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private secureEmitted = false;

  constructor(initiator: boolean, cb: PeerCallbacks) {
    this.cb = cb;
    this.polite = !initiator;
    this.pc = new RTCPeerConnection(ICE_CONFIG);

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.cb.onSignal("ice", JSON.stringify(candidate));
      }
    };

    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        if (this.pc.localDescription) {
          this.cb.onSignal("offer", JSON.stringify(this.pc.localDescription));
        }
      } finally {
        this.makingOffer = false;
      }
    };

    this.pc.ontrack = ({ streams }) => {
      this.cb.onRemoteStream(streams[0] ?? null);
    };

    this.pc.onconnectionstatechange = () => {
      this.cb.onConnectionState(this.pc.connectionState);
    };

    if (initiator) {
      this.dc = this.pc.createDataChannel("chat");
      this.wireDataChannel(this.dc);
    } else {
      this.pc.ondatachannel = (e) => {
        this.dc = e.channel;
        this.wireDataChannel(this.dc);
      };
    }
  }

  private wireDataChannel(dc: RTCDataChannel) {
    dc.onopen = () => this.cb.onChannelOpen();
    dc.onmessage = (e) => {
      let data: unknown;
      try {
        data = JSON.parse(e.data as string);
      } catch {
        return;
      }
      const msg = parseWireMessage(data);
      if (!msg) return;
      if (msg.t === "chat") this.cb.onChat(msg.id, msg.text);
      else if (msg.t === "react") this.cb.onReact(msg.to, msg.emoji, msg.op);
      else this.cb.onControl(msg.ctrl);
    };
  }

  async handleSignal(type: DescType, payload: string) {
    if (this.closed) return;
    const data = JSON.parse(payload);

    if (type === "ice") {
      if (!this.pc.remoteDescription) {
        this.pendingCandidates.push(data);
        return;
      }
      try {
        await this.pc.addIceCandidate(data);
      } catch {}
      return;
    }

    const desc = data as RTCSessionDescriptionInit;
    const offerCollision =
      desc.type === "offer" &&
      (this.makingOffer || this.pc.signalingState !== "stable");
    this.ignoreOffer = !this.polite && offerCollision;
    if (this.ignoreOffer) return;

    await this.flushPendingCandidates();
    await this.pc.setRemoteDescription(desc);
    // ICE candidates that were buffered while the remote description was still
    // being applied (same poll batch as this offer/answer) can be added now.
    await this.flushPendingCandidates();
    if (desc.type === "offer") {
      await this.pc.setLocalDescription();
      if (this.pc.localDescription) {
        this.cb.onSignal("answer", JSON.stringify(this.pc.localDescription));
      }
    }

    // Both SDPs now exist on either path (initiator on answer, answerer on
    // offer), so this is the single moment the session code can be derived.
    void this.maybeEmitSecureCode();
  }

  private async maybeEmitSecureCode() {
    if (this.secureEmitted || this.closed) return;
    const local = this.pc.localDescription?.sdp;
    const remote = this.pc.remoteDescription?.sdp;
    if (!local || !remote) return;
    this.secureEmitted = true;
    try {
      const code = await deriveSecureCode(local, remote);
      if (!this.closed) this.cb.onSecureCode(code);
    } catch {
      if (!this.closed) this.cb.onSecureCode(null);
    }
  }

  private async flushPendingCandidates() {
    if (this.pendingCandidates.length === 0) return;
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of queued) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch {}
    }
  }

  sendChat(id: string, text: string) {
    this.safeSend({ t: "chat", id, text });
  }

  sendReaction(to: string, emoji: ReactionEmoji, op: ReactionOp) {
    this.safeSend({ t: "react", to, emoji, op });
  }

  sendControl(ctrl: PeerControl) {
    this.safeSend({ t: "ctrl", ctrl });
  }

  private safeSend(msg: WireMessage) {
    if (this.dc && this.dc.readyState === "open") {
      this.dc.send(JSON.stringify(msg));
    }
  }

  async startVideo(): Promise<MediaStream> {
    if (!this.rawStream) {
      this.rawStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      for (const track of this.rawStream.getTracks()) {
        const sender = this.pc.addTrack(track, this.rawStream);
        if (track.kind === "video") this.videoSender = sender;
      }
    }
    return this.publishedStream();
  }

  // Turn background blur on/off by swapping the video track the peer receives.
  // Returns a fresh stream for the local self-view so it mirrors the effect.
  async setBlur(on: boolean): Promise<MediaStream> {
    if (on) {
      if (!this.rawStream) throw new Error("no stream");
      if (!this.blur) {
        // Assign only once it has started, so a failure leaves `blur` null and
        // the toggle can be retried from a clean state.
        const blur = new BackgroundBlur();
        await blur.start(this.rawStream);
        this.blur = blur;
      }
      this.blurOn = true;
    } else {
      this.blurOn = false;
    }
    await this.videoSender?.replaceTrack(this.videoTrack());
    return this.publishedStream();
  }

  // What the peer receives: the processed video track when blur is on, else the
  // raw camera track, always paired with the raw microphone track.
  private videoTrack(): MediaStreamTrack | null {
    if (this.blurOn && this.blur?.track) return this.blur.track;
    return this.rawStream?.getVideoTracks()[0] ?? null;
  }

  private publishedStream(): MediaStream {
    const stream = new MediaStream();
    const video = this.videoTrack();
    if (video) stream.addTrack(video);
    const audio = this.rawStream?.getAudioTracks()[0];
    if (audio) stream.addTrack(audio);
    return stream;
  }

  stopVideo() {
    if (this.blur) {
      this.blur.stop();
      this.blur = null;
    }
    this.blurOn = false;
    if (this.rawStream) {
      for (const track of this.rawStream.getTracks()) track.stop();
      for (const sender of this.pc.getSenders()) {
        if (sender.track) {
          try {
            this.pc.removeTrack(sender);
          } catch {}
        }
      }
      this.rawStream = null;
      this.videoSender = null;
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.stopVideo();
    if (this.dc) {
      try {
        this.dc.close();
      } catch {}
    }
    try {
      this.pc.close();
    } catch {}
  }
}
