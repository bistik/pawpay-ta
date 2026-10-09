"use client";

import { useEffect, useRef, useState } from "react";
import EntryGate from "./components/EntryGate";
import WorldMap from "./components/WorldMap";
import ConnectionPrompt from "./components/ConnectionPrompt";
import ChatPanel, { type ChatMessage } from "./components/ChatPanel";
import VideoPanel from "./components/VideoPanel";
import ReportPrompt from "./components/ReportPrompt";
import { join, leave, poll, reportPeer, sendSignal } from "@/lib/api";
import {
  PeerSession,
  type DescType,
  type PeerControl,
  type ReactionEmoji,
  type ReactionMap,
} from "@/lib/webrtc";
import { supportsBackgroundBlur } from "@/lib/background-blur";
import { POLL_INTERVAL_MS } from "@/lib/presence";
import { censorText } from "@/lib/moderation";
import { type PeerDot, type ReportReason, type SignalMsg } from "@/lib/types";

type Conn =
  | { kind: "idle" }
  | { kind: "requesting"; peerId: string }
  | { kind: "incoming"; peerId: string }
  | { kind: "connecting"; peerId: string }
  | { kind: "connected"; peerId: string };

type VideoState = "none" | "requesting" | "incoming" | "active";

const REQUEST_TIMEOUT_MS = 30_000;

export default function Home() {
  const [phase, setPhase] = useState<"gate" | "live">("gate");
  const [sessionId] = useState(() => crypto.randomUUID());
  const [peers, setPeers] = useState<PeerDot[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<Record<string, ReactionMap>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [blurOn, setBlurOn] = useState(false);
  // Feature-detected once; the value only affects the video UI, which is never
  // server-rendered, so the SSR `false` snapshot can't cause a hydration mismatch.
  const [blurSupported] = useState(() => supportsBackgroundBlur());
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(
    null,
  );

  const [conn, _setConn] = useState<Conn>({ kind: "idle" });
  const connRef = useRef<Conn>(conn);
  const setConn = (c: Conn) => {
    connRef.current = c;
    _setConn(c);
  };

  const [video, _setVideo] = useState<VideoState>("none");
  const videoRef = useRef<VideoState>(video);
  const setVideo = (v: VideoState) => {
    videoRef.current = v;
    _setVideo(v);
  };

  const [peerTyping, setPeerTyping] = useState(false);
  const [secureCode, setSecureCode] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  const peerRef = useRef<PeerSession | null>(null);
  // Peers we've reported this session — a report shouldn't be a formality, so
  // we refuse to reconnect with them while the tab lives.
  const reportedRef = useRef<Set<string>>(new Set());
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);

  function showNotice(text: string) {
    setNotice(text);
    window.setTimeout(() => setNotice(null), 3500);
  }

  function addMessage(mine: boolean, id: string, text: string) {
    setMessages((prev) => [...prev, { id, mine, text, at: Date.now() }]);
  }

  // Reactions are keyed by message id on both sides: `me` is my own toggle,
  // `them` is the stranger's, so a chip can show a count and highlight mine.
  function setReaction(
    id: string,
    emoji: ReactionEmoji,
    who: "me" | "them",
    on: boolean,
  ) {
    setReactions((prev) => {
      const current = prev[id]?.[emoji] ?? { me: false, them: false };
      const next = { ...current, [who]: on };
      const forMessage: ReactionMap = { ...(prev[id] ?? {}) };
      if (next.me || next.them) forMessage[emoji] = next;
      else delete forMessage[emoji];
      return { ...prev, [id]: forMessage };
    });
  }

  function toggleReaction(id: string, emoji: ReactionEmoji) {
    const mine = reactions[id]?.[emoji]?.me ?? false;
    setReaction(id, emoji, "me", !mine);
    peerRef.current?.sendReaction(id, emoji, mine ? "remove" : "add");
  }

  // Typing is ephemeral: a keystroke refreshes it, and it clears itself when the
  // stranger stops. A delivered message clears it immediately.
  function markPeerTyping() {
    setPeerTyping(true);
    if (typingClearTimer.current) clearTimeout(typingClearTimer.current);
    typingClearTimer.current = setTimeout(() => setPeerTyping(false), 3000);
  }

  function stopPeerTyping() {
    if (typingClearTimer.current) clearTimeout(typingClearTimer.current);
    setPeerTyping(false);
  }

  function sendTyping() {
    const now = Date.now();
    if (now - lastTypingSent.current < 1200) return;
    lastTypingSent.current = now;
    peerRef.current?.sendControl("typing");
  }

  function teardown(message?: string) {
    if (requestTimer.current) clearTimeout(requestTimer.current);
    stopPeerTyping();
    peerRef.current?.close();
    peerRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setSecureCode(null);
    setReporting(false);
    setVideo("none");
    setMessages([]);
    setReactions({});
    setBlurOn(false);
    setConn({ kind: "idle" });
    if (message) showNotice(message);
  }

  function startPeer(peerId: string, initiator: boolean) {
    const ps = new PeerSession(initiator, {
      onSignal: (type: DescType, payload: string) => {
        void sendSignal(sessionId, peerId, type, payload);
      },
      onChat: (id, text) => {
        stopPeerTyping();
        addMessage(false, id, censorText(text).text);
      },
      onReact: (to, emoji, op) => setReaction(to, emoji, "them", op === "add"),
      onControl: (ctrl) => handleControl(ctrl),
      onRemoteStream: (stream) => setRemoteStream(stream),
      onSecureCode: (code) => setSecureCode(code),
      onConnectionState: (state) => {
        if (state === "failed") {
          teardown("Connection failed (network).");
        }
      },
      onChannelOpen: () => {
        setConn({ kind: "connected", peerId });
      },
    });
    peerRef.current = ps;
  }

  function handleControl(ctrl: PeerControl) {
    const ps = peerRef.current;
    switch (ctrl) {
      case "video-request":
        if (videoRef.current === "none") setVideo("incoming");
        break;
      case "video-accept":
        if (videoRef.current === "requesting" && ps) {
          ps.startVideo()
            .then((stream) => {
              setLocalStream(stream);
              setVideo("active");
            })
            .catch(() => {
              setVideo("none");
              ps.sendControl("video-end");
              showNotice("Camera unavailable.");
            });
        }
        break;
      case "video-decline":
        if (videoRef.current === "requesting") {
          setVideo("none");
          showNotice("Video declined.");
        }
        break;
      case "video-end":
        ps?.stopVideo();
        setLocalStream(null);
        setRemoteStream(null);
        setBlurOn(false);
        setVideo("none");
        break;
      case "typing":
        markPeerTyping();
        break;
    }
  }

  function requestConnection(peerId: string) {
    if (connRef.current.kind !== "idle") return;
    setConn({ kind: "requesting", peerId });
    void sendSignal(sessionId, peerId, "request");
    requestTimer.current = setTimeout(() => {
      if (
        connRef.current.kind === "requesting" &&
        connRef.current.peerId === peerId
      ) {
        void sendSignal(sessionId, peerId, "end");
        teardown("No answer.");
      }
    }, REQUEST_TIMEOUT_MS);
  }

  function cancelRequest() {
    if (connRef.current.kind === "requesting") {
      void sendSignal(sessionId, connRef.current.peerId, "end");
    }
    teardown();
  }

  function acceptIncoming() {
    if (connRef.current.kind !== "incoming") return;
    const peerId = connRef.current.peerId;
    startPeer(peerId, false);
    void sendSignal(sessionId, peerId, "accept");
    setConn({ kind: "connecting", peerId });
  }

  function declineIncoming() {
    if (connRef.current.kind !== "incoming") return;
    void sendSignal(sessionId, connRef.current.peerId, "decline");
    setConn({ kind: "idle" });
  }

  function endConnection() {
    const c = connRef.current;
    if (c.kind === "connecting" || c.kind === "connected") {
      void sendSignal(sessionId, c.peerId, "end");
    }
    teardown();
  }

  // Report and hard-disconnect in one move: the peer gets the same `end` a
  // normal hang-up sends (so their screen clears too), we remember them for the
  // rest of the session, and an anonymous tally is filed.
  function reportAndLeave(reason: ReportReason) {
    const c = connRef.current;
    if (c.kind === "connecting" || c.kind === "connected") {
      void sendSignal(sessionId, c.peerId, "end");
      reportedRef.current.add(c.peerId);
    }
    reportPeer(sessionId, reason);
    teardown("Reported. You're disconnected.");
  }

  function startVideoRequest() {
    if (videoRef.current !== "none" || !peerRef.current) return;
    setVideo("requesting");
    peerRef.current.sendControl("video-request");
  }

  function acceptVideo() {
    const ps = peerRef.current;
    if (!ps) return;
    ps.startVideo()
      .then((stream) => {
        setLocalStream(stream);
        ps.sendControl("video-accept");
        setVideo("active");
      })
      .catch(() => {
        ps.sendControl("video-decline");
        setVideo("none");
        showNotice("Camera unavailable.");
      });
  }

  function declineVideo() {
    peerRef.current?.sendControl("video-decline");
    setVideo("none");
  }

  function endVideo() {
    const ps = peerRef.current;
    ps?.stopVideo();
    ps?.sendControl("video-end");
    setLocalStream(null);
    setRemoteStream(null);
    setBlurOn(false);
    setVideo("none");
  }

  function toggleBlur() {
    const ps = peerRef.current;
    if (!ps) return;
    const next = !blurOn;
    ps.setBlur(next)
      .then((stream) => {
        setBlurOn(next);
        setLocalStream(stream);
      })
      .catch(() => {
        setBlurOn(false);
        showNotice("Background blur unavailable.");
      });
  }

  function processSignal(sig: SignalMsg) {
    switch (sig.type) {
      case "request": {
        if (
          connRef.current.kind !== "idle" ||
          reportedRef.current.has(sig.fromId)
        ) {
          void sendSignal(sessionId, sig.fromId, "decline");
        } else {
          setConn({ kind: "incoming", peerId: sig.fromId });
        }
        break;
      }
      case "accept": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (requestTimer.current) clearTimeout(requestTimer.current);
          startPeer(sig.fromId, true);
          setConn({ kind: "connecting", peerId: sig.fromId });
        }
        break;
      }
      case "decline": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (requestTimer.current) clearTimeout(requestTimer.current);
          teardown("Request declined.");
        }
        break;
      }
      case "offer":
      case "answer":
      case "ice": {
        const c = connRef.current;
        const peerId =
          c.kind === "connecting" || c.kind === "connected" ? c.peerId : null;
        if (peerRef.current && peerId === sig.fromId) {
          void peerRef.current.handleSignal(
            sig.type as DescType,
            sig.payload ?? "",
          );
        }
        break;
      }
      case "end": {
        const c = connRef.current;
        if (
          (c.kind === "incoming" ||
            c.kind === "connecting" ||
            c.kind === "connected") &&
          c.peerId === sig.fromId
        ) {
          if (c.kind === "incoming") setConn({ kind: "idle" });
          else teardown("Stranger disconnected.");
        }
        break;
      }
    }
  }

  const processSignalRef = useRef(processSignal);
  useEffect(() => {
    processSignalRef.current = processSignal;
  });

  useEffect(() => {
    if (phase !== "live" || !sessionId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const data = await poll(sessionId);
        if (!active) return;
        setPeers(data.peers);
        for (const s of data.signals) processSignalRef.current(s);
      } catch {}
      if (active) timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [phase, sessionId]);

  useEffect(() => {
    if (!sessionId || phase !== "live") return;
    const onLeave = () => leave(sessionId);
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [sessionId, phase]);

  async function handleReady(lat: number, lng: number) {
    setMyLocation({ lat, lng });
    await join(sessionId, lat, lng);
    setPhase("live");
  }

  if (phase === "gate") {
    return <EntryGate onReady={handleReady} />;
  }

  const inChat = conn.kind === "connecting" || conn.kind === "connected";
  const connected = conn.kind === "connected";
  const chatPeerId =
    conn.kind === "connecting" || conn.kind === "connected" ? conn.peerId : null;

  return (
    <main className="fixed inset-0 overflow-hidden">
      <WorldMap
        peers={peers}
        me={myLocation}
        onPeerClick={requestConnection}
        canConnect={conn.kind === "idle"}
      />

      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="panel-glass absolute left-1/2 top-[calc(env(safe-area-inset-top)+4.5rem)] z-30 -translate-x-1/2 rounded-full px-4 py-2 text-sm text-fg shadow-lg"
        >
          {notice}
        </div>
      )}

      {conn.kind === "requesting" && (
        <div className="panel-glass absolute left-1/2 top-[calc(env(safe-area-inset-top)+4.5rem)] z-30 flex -translate-x-1/2 items-center gap-3 rounded-full py-1.5 pl-4 pr-1.5 text-sm text-fg shadow-lg">
          <span className="whitespace-nowrap">Requesting connection…</span>
          <button
            onClick={cancelRequest}
            className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-fg-muted transition-colors hover:bg-line-strong hover:text-fg"
          >
            Cancel
          </button>
        </div>
      )}

      {conn.kind === "incoming" && (
        <ConnectionPrompt
          title="A stranger wants to connect"
          acceptLabel="Accept"
          declineLabel="Decline"
          onAccept={acceptIncoming}
          onDecline={declineIncoming}
        />
      )}

      {inChat && (
        <ChatPanel
          messages={messages}
          reactions={reactions}
          connected={connected}
          videoBusy={video !== "none"}
          peerId={chatPeerId}
          peerTyping={peerTyping}
          secureCode={secureCode}
          onSend={(text) => {
            const { text: safe } = censorText(text);
            const id = crypto.randomUUID();
            peerRef.current?.sendChat(id, safe);
            addMessage(true, id, safe);
          }}
          onReact={toggleReaction}
          onTyping={sendTyping}
          onStartVideo={startVideoRequest}
          onEnd={endConnection}
          onRequestReport={() => setReporting(true)}
        />
      )}

      {video === "requesting" && (
        <div
          role="status"
          aria-live="polite"
          className="panel-glass absolute bottom-[calc(env(safe-area-inset-bottom)+6rem)] left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-full px-4 py-2 text-sm text-fg shadow-lg"
        >
          Waiting for stranger to accept video…
        </div>
      )}

      {video === "incoming" && (
        <ConnectionPrompt
          title="Start video call?"
          subtitle="The stranger wants to turn on video."
          acceptLabel="Accept"
          declineLabel="Decline"
          onAccept={acceptVideo}
          onDecline={declineVideo}
        />
      )}

      {video === "active" && (
        <VideoPanel
          localStream={localStream}
          remoteStream={remoteStream}
          secureCode={secureCode}
          blurOn={blurOn}
          blurSupported={blurSupported}
          onToggleBlur={toggleBlur}
          onEnd={endVideo}
          onRequestReport={() => setReporting(true)}
        />
      )}

      {reporting && (
        <ReportPrompt
          onConfirm={reportAndLeave}
          onCancel={() => setReporting(false)}
        />
      )}
    </main>
  );
}
