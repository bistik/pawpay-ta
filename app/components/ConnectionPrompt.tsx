"use client";

import { useEffect, useId, useRef } from "react";

// Reusable centered prompt for "someone wants to connect" and
// "someone wants to start video". Behaves as a modal: focus moves in, Tab is
// trapped, Escape declines, and focus returns to the trigger on close.
export default function ConnectionPrompt({
  title,
  subtitle,
  acceptLabel,
  declineLabel,
  onAccept,
  onDecline,
}: {
  title: string;
  subtitle?: string;
  acceptLabel: string;
  declineLabel: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  // Keep the latest decline handler without re-running the effect (which would
  // steal focus on every parent render).
  const onDeclineRef = useRef(onDecline);
  useEffect(() => {
    onDeclineRef.current = onDecline;
  });

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    acceptRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onDeclineRef.current();
        return;
      }
      if (e.key !== "Tab" || !cardRef.current) return;
      const focusables = cardRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-void/70 p-6 backdrop-blur-sm">
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="rise w-full max-w-sm rounded-panel border border-line bg-surface p-6 text-center text-fg shadow-2xl"
      >
        <h2 id={titleId} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-1.5 text-pretty text-sm leading-relaxed text-fg-muted">
            {subtitle}
          </p>
        )}
        <div className="mt-6 flex gap-3">
          <button
            onClick={onDecline}
            className="flex-1 rounded-full border border-line-strong px-4 py-2.5 text-sm font-medium text-fg-muted transition-colors hover:border-fg-faint hover:text-fg"
          >
            {declineLabel}
          </button>
          <button
            ref={acceptRef}
            onClick={onAccept}
            className="flex-1 rounded-full bg-signal px-4 py-2.5 text-sm font-semibold text-signal-ink transition-colors hover:bg-signal-hi"
          >
            {acceptLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
