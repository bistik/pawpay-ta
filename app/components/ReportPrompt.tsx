"use client";

import { useEffect, useId, useRef, useState } from "react";
import { REPORT_REASONS, type ReportReason } from "@/lib/types";

const REASON_LABELS: Record<ReportReason, string> = {
  harassment: "Harassment or abuse",
  sexual: "Sexual content",
  spam: "Spam or a scam",
  other: "Something else",
};

// Reason picker shown before a report-eject. Focus moves in, Tab is trapped,
// Escape cancels, focus returns on close.
export default function ReportPrompt({
  onConfirm,
  onCancel,
}: {
  onConfirm: (reason: ReportReason) => void;
  onCancel: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const [reason, setReason] = useState<ReportReason>(REPORT_REASONS[0]);
  const titleId = useId();

  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    firstRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancelRef.current();
        return;
      }
      if (e.key !== "Tab" || !cardRef.current) return;
      const focusables = cardRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, [tabindex]:not([tabindex="-1"])',
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
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-void/70 p-6 backdrop-blur-sm">
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="rise w-full max-w-sm rounded-panel border border-line bg-surface p-6 text-fg shadow-2xl"
      >
        <h2 id={titleId} className="text-lg font-semibold tracking-tight">
          Report and disconnect?
        </h2>
        <p className="mt-1.5 text-pretty text-sm leading-relaxed text-fg-muted">
          This ends the connection immediately. Reports are anonymous — nothing
          about you or the conversation is stored.
        </p>

        <fieldset className="mt-4">
          <legend className="sr-only">Reason</legend>
          <div className="flex flex-col gap-1.5">
            {REPORT_REASONS.map((r, i) => (
              <label
                key={r}
                className="flex cursor-pointer items-center gap-2.5 rounded-field border border-line bg-abyss px-3 py-2.5 text-sm text-fg-muted transition-colors has-[:checked]:border-signal has-[:checked]:text-fg"
              >
                <input
                  ref={i === 0 ? firstRef : undefined}
                  type="radio"
                  name="report-reason"
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                  className="accent-[var(--signal)]"
                />
                {REASON_LABELS[r]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-full border border-line-strong px-4 py-2.5 text-sm font-medium text-fg-muted transition-colors hover:border-fg-faint hover:text-fg"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason)}
            className="flex-1 rounded-full bg-danger px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-danger-hi"
          >
            Report &amp; leave
          </button>
        </div>
      </div>
    </div>
  );
}
