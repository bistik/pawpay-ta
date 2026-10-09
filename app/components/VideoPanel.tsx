"use client";

import { useEffect, useRef } from "react";
import SecureBadge from "./SecureBadge";

export default function VideoPanel({
  localStream,
  remoteStream,
  secureCode,
  onEnd,
  onRequestReport,
}: {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  secureCode: string | null;
  onEnd: () => void;
  onRequestReport: () => void;
}) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localRef.current && localRef.current.srcObject !== localStream) {
      localRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteRef.current && remoteRef.current.srcObject !== remoteStream) {
      remoteRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-void">
      <div className="relative flex-1">
        {/* Remote (full screen) */}
        <video
          ref={remoteRef}
          autoPlay
          playsInline
          aria-label="Stranger's video"
          className="h-full w-full bg-abyss object-cover"
        />
        {!remoteStream && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="animate-pulse text-sm text-fg-faint">
              Waiting for the stranger&rsquo;s video…
            </p>
          </div>
        )}
        {/* Local (picture-in-picture), mirrored like a self-view. */}
        <video
          ref={localRef}
          autoPlay
          playsInline
          muted
          aria-label="Your video"
          className="absolute bottom-[calc(env(safe-area-inset-bottom)+1rem)] right-4 h-40 w-28 -scale-x-100 rounded-xl border border-line-strong bg-surface object-cover shadow-xl"
        />
        {secureCode && (
          <div className="absolute left-4 top-[calc(env(safe-area-inset-top)+1rem)]">
            <SecureBadge code={secureCode} />
          </div>
        )}
      </div>
      <div className="flex items-center justify-center gap-3 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          onClick={onRequestReport}
          className="rounded-full border border-line-strong px-5 py-3 font-semibold text-fg-muted transition-colors hover:border-danger hover:text-danger"
        >
          Report
        </button>
        <button
          onClick={onEnd}
          className="rounded-full bg-danger px-8 py-3 font-semibold text-white transition-colors hover:bg-danger-hi"
        >
          End video
        </button>
      </div>
    </div>
  );
}
