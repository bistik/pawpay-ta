"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { LinkMatch } from "@/lib/links";

// Confirmation shown before any link a stranger sent is opened. Focus moves in,
// Tab is trapped, Escape cancels, focus returns on close.
export default function LinkPrompt({
  link,
  onClose,
}: {
  link: LinkMatch;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const titleId = useId();

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    openRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
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

  function open() {
    window.open(link.href, "_blank", "noopener,noreferrer");
    onClose();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link.href);
      setCopied(true);
    } catch {
      // Clipboard can be blocked; the URL is visible below to copy by hand.
    }
  }

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
          Open this link?
        </h2>
        <p className="mt-1.5 text-pretty text-sm leading-relaxed text-fg-muted">
          The stranger sent this. Pulse can&rsquo;t check where it leads.
        </p>

        <div className="mt-4 rounded-field border border-line bg-abyss px-3 py-2.5">
          <p className="truncate font-medium text-fg">{link.host}</p>
          <p className="mt-0.5 break-all font-mono text-xs text-fg-faint">
            {link.href}
          </p>
        </div>

        {link.suspicious && (
          <p className="mt-2.5 text-xs leading-relaxed text-danger">
            This address looks unusual — a raw IP or disguised characters. Be
            careful.
          </p>
        )}

        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-full border border-line-strong px-4 py-2.5 text-sm font-medium text-fg-muted transition-colors hover:border-fg-faint hover:text-fg"
          >
            Cancel
          </button>
          <button
            onClick={copy}
            className="flex-1 rounded-full border border-line-strong px-4 py-2.5 text-sm font-medium text-fg-muted transition-colors hover:border-fg-faint hover:text-fg"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            ref={openRef}
            onClick={open}
            className="flex-1 rounded-full bg-signal px-4 py-2.5 text-sm font-semibold text-signal-ink transition-colors hover:bg-signal-hi"
          >
            Open
          </button>
        </div>
      </div>
    </div>
  );
}
