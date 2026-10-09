"use client";

import { useState } from "react";
import Beacon from "./Beacon";

export default function EntryGate({
  onReady,
}: {
  onReady: (lat: number, lng: number) => void;
}) {
  const [status, setStatus] = useState<"idle" | "locating" | "error">("idle");
  const [error, setError] = useState<string>("");

  function enter() {
    if (!("geolocation" in navigator)) {
      setStatus("error");
      setError("This browser can't share a location, so there's no dot to place.");
      return;
    }
    setStatus("locating");
    setError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => onReady(pos.coords.latitude, pos.coords.longitude),
      (err) => {
        setStatus("error");
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Pulse needs your location to place your dot. Allow access and try again."
            : "Couldn't find you this time. Give it another go.",
        );
      },
      // High accuracy + maximumAge:0 forces a fresh fix (Wi-Fi/GPS scan)
      // instead of reusing the browser's cached IP-based location.
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  return (
    <div className="relative flex min-h-dvh flex-1 flex-col items-center justify-center overflow-hidden px-6 py-9">
      {/* Background plane: deep space, a night-side planet, and a vignette
          that keeps the type legible. Decorative, so it is hidden from AT. */}
      <div className="starfield pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="planet pointer-events-none" aria-hidden="true">
        <span className="planet__sheen" />
        <span className="planet__rim" />
      </div>
      <div className="entry-vignette pointer-events-none absolute inset-0" aria-hidden="true" />

      {/* Content plane */}
      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-9 text-center">
        <div
          className="rise flex flex-col items-center gap-6"
          style={{ animationDelay: "60ms" }}
        >
          <Beacon size="lg" />
          <h1 className="text-balance text-5xl font-semibold tracking-[-0.045em] sm:text-6xl">
            Pulse
          </h1>
        </div>

        <p
          className="rise text-pretty text-base leading-relaxed text-fg-muted sm:text-lg"
          style={{ animationDelay: "170ms" }}
        >
          Every dot is a stranger, online right now. Drop in, tap one, say hello.
        </p>

        <div
          className="rise flex w-full flex-col items-center gap-5"
          style={{ animationDelay: "280ms" }}
        >
          <button
            onClick={enter}
            disabled={status === "locating"}
            className="inline-flex items-center gap-2.5 rounded-full bg-signal px-7 py-3.5 text-base font-semibold text-signal-ink shadow-[0_12px_44px_-14px_var(--signal-glow)] transition duration-150 hover:bg-signal-hi active:scale-[0.98] disabled:cursor-progress disabled:opacity-70"
          >
            {status === "locating" && (
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-signal-ink/30 border-t-signal-ink"
              />
            )}
            {status === "locating" ? "Finding you…" : "Drop onto the map"}
          </button>

          <p className="max-w-[40ch] text-pretty text-xs leading-relaxed text-fg-faint">
            No sign-up. Your dot lands 1–3&nbsp;km from your real location, and
            nothing is stored. Close the tab and you&rsquo;re gone.
          </p>
        </div>

        <p
          role="status"
          aria-live="polite"
          className="min-h-5 max-w-[40ch] text-sm text-danger"
        >
          {status === "error" ? error : ""}
        </p>
      </div>
    </div>
  );
}
