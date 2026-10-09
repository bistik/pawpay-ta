"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { peerColor, peerGlow } from "@/lib/peer-color";
import { pickIcebreaker, QUICK_REPLIES } from "@/lib/icebreakers";
import {
  REACTION_EMOJI,
  type ReactionEmoji,
  type ReactionMap,
} from "@/lib/webrtc";
import type { LinkMatch } from "@/lib/links";
import MessageText from "./MessageText";
import LinkPrompt from "./LinkPrompt";
import SecureBadge from "./SecureBadge";

export interface ChatMessage {
  id: string;
  mine: boolean;
  text: string;
  at: number;
}

// Messages from the same sender within this window collapse into one group:
// bubbles tighten together and a single timestamp closes the run.
const GROUP_WINDOW_MS = 5 * 60 * 1000;
const PIN_THRESHOLD_PX = 80;

function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ChatPanel({
  messages,
  reactions,
  connected,
  videoBusy,
  peerId,
  peerTyping,
  secureCode,
  onSend,
  onReact,
  onTyping,
  onStartVideo,
  onEnd,
  onRequestReport,
}: {
  messages: ChatMessage[];
  reactions: Record<string, ReactionMap>;
  connected: boolean;
  videoBusy: boolean;
  peerId: string | null;
  peerTyping: boolean;
  secureCode: string | null;
  onSend: (text: string) => void;
  onReact: (id: string, emoji: ReactionEmoji) => void;
  onTyping: () => void;
  onStartVideo: () => void;
  onEnd: () => void;
  onRequestReport: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [pinned, setPinned] = useState(true);
  const [unread, setUnread] = useState(0);
  const [pendingLink, setPendingLink] = useState<LinkMatch | null>(null);
  // Which message's reaction tray is open (one at a time, or null).
  const [reactionTray, setReactionTray] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Read in effects/scroll handlers without making them reactive.
  const pinnedRef = useRef(true);

  const peerKey = peerId ?? "stranger";
  const icebreaker = useMemo(() => pickIcebreaker(peerKey), [peerKey]);
  const peerVars = {
    "--dot": peerColor(peerKey),
    "--dot-glow": peerGlow(peerKey),
  } as CSSProperties;

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_THRESHOLD_PX;
    pinnedRef.current = nearBottom;
    setPinned(nearBottom);
    if (nearBottom) setUnread(0);
  }

  function jumpToLatest() {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    pinnedRef.current = true;
    setPinned(true);
    setUnread(0);
  }

  // New message: follow it only if the reader is already at the bottom.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (pinnedRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      setUnread((n) => n + 1);
    }
  }, [messages.length]);

  // The typing bubble shouldn't bump the unread count, but it should stay in view.
  useEffect(() => {
    const el = listRef.current;
    if (el && pinnedRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [peerTyping]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !connected) return;
    onSend(text);
    setDraft("");
    pinnedRef.current = true;
    setPinned(true);
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
  }

  return (
    <div
      className={`absolute inset-x-0 bottom-0 z-20 flex h-[92dvh] flex-col rounded-t-[1.5rem] border-t border-line bg-abyss text-fg shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        expanded ? "translate-y-0" : "translate-y-[26dvh]"
      } sm:inset-y-0 sm:right-0 sm:left-auto sm:h-full sm:w-full sm:max-w-md sm:translate-y-0 sm:rounded-none sm:border-t-0 sm:border-l`}
    >
      {/* Drag-style handle: on phones the chat is a bottom sheet, so the map
          stays one tap away. Hidden once the drawer docks to the side. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse chat to see the map" : "Expand chat"}
        className="mx-auto mt-2 flex h-6 w-20 shrink-0 items-center justify-center rounded-full sm:hidden"
      >
        <span aria-hidden="true" className="h-1.5 w-10 rounded-full bg-line-strong" />
      </button>

      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span
          aria-hidden="true"
          className="peer-avatar h-9 w-9 shrink-0 rounded-full"
          style={peerVars}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold tracking-tight">Stranger</p>
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-fg-faint">
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${
                connected
                  ? "bg-presence shadow-[0_0_8px_var(--presence)]"
                  : "animate-pulse bg-fg-faint"
              }`}
            />
            {connected ? "Connected" : "Connecting…"}
            {connected && <SecureBadge code={secureCode} />}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={onStartVideo}
            disabled={!connected || videoBusy}
            className="rounded-full border border-line-strong px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:border-fg-faint hover:text-fg disabled:opacity-40 disabled:hover:border-line-strong disabled:hover:text-fg-muted"
          >
            Video
          </button>
          <button
            onClick={onRequestReport}
            disabled={!connected}
            aria-label="Report this stranger"
            title="Report"
            className="rounded-full border border-line-strong px-2.5 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:border-danger hover:text-danger disabled:opacity-40 disabled:hover:border-line-strong disabled:hover:text-fg-muted"
          >
            <span aria-hidden="true">⚑</span>
          </button>
          <button
            onClick={onEnd}
            className="rounded-full bg-danger px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-danger-hi"
          >
            End
          </button>
        </div>
      </header>

      <div
        ref={listRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        className="scroll-slim flex flex-1 flex-col gap-1 overflow-y-auto px-4 py-3"
      >
        {messages.length === 0 && (
          <div className="mt-8 flex flex-col items-center gap-2 px-4 text-center">
            <p className="text-pretty text-sm leading-relaxed text-fg-muted">
              {icebreaker}
            </p>
            <p className="text-xs leading-relaxed text-fg-faint">
              Messages go peer-to-peer and are never stored.
            </p>
          </div>
        )}

        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const startsGroup =
            !prev || prev.mine !== m.mine || m.at - prev.at > GROUP_WINDOW_MS;
          const endsGroup =
            !next || next.mine !== m.mine || next.at - m.at > GROUP_WINDOW_MS;
          const rx = reactions[m.id];
          const active = rx ? REACTION_EMOJI.filter((e) => rx[e]) : [];
          return (
            <div
              key={m.id}
              className={`bubble-in group flex flex-col ${
                m.mine ? "items-end" : "items-start"
              } ${startsGroup ? "mt-2" : ""}`}
            >
              <div
                className={`flex max-w-full items-center gap-1 ${
                  m.mine ? "flex-row-reverse" : "flex-row"
                }`}
              >
                <span
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap ${
                    m.mine ? "bg-signal text-signal-ink" : "bg-surface-2 text-fg"
                  } ${endsGroup ? (m.mine ? "rounded-br-md" : "rounded-bl-md") : ""} ${
                    startsGroup ? "" : m.mine ? "rounded-tr-md" : "rounded-tl-md"
                  }`}
                >
                  <MessageText text={m.text} onLinkClick={setPendingLink} />
                </span>
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      setReactionTray(reactionTray === m.id ? null : m.id)
                    }
                    aria-label="Add reaction"
                    aria-expanded={reactionTray === m.id}
                    className="flex h-7 w-7 items-center justify-center rounded-full border border-line-strong bg-surface text-sm transition-opacity hover:border-fg-faint sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                  >
                    <span aria-hidden="true">🙂</span>
                  </button>
                  {reactionTray === m.id && (
                    <div
                      className={`absolute top-full z-20 mt-1 flex gap-0.5 rounded-full border border-line-strong bg-surface px-1.5 py-1 shadow-lg ${
                        m.mine ? "right-0" : "left-0"
                      }`}
                    >
                      {REACTION_EMOJI.map((e) => (
                        <button
                          key={e}
                          type="button"
                          onClick={() => {
                            onReact(m.id, e);
                            setReactionTray(null);
                          }}
                          aria-label={`React with ${e}`}
                          className="rounded-full px-1 text-lg leading-none transition-transform hover:scale-125"
                        >
                          <span aria-hidden="true">{e}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {active.length > 0 && (
                <div
                  className={`mt-1 flex flex-wrap gap-1 ${
                    m.mine ? "justify-end" : "justify-start"
                  }`}
                >
                  {active.map((e) => {
                    const r = rx![e]!;
                    const count = (r.me ? 1 : 0) + (r.them ? 1 : 0);
                    return (
                      <button
                        key={e}
                        type="button"
                        onClick={() => onReact(m.id, e)}
                        aria-pressed={r.me}
                        aria-label={`${e} reaction${count > 1 ? ` (${count})` : ""}`}
                        className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                          r.me
                            ? "border-signal bg-signal/15 text-fg"
                            : "border-line-strong bg-surface text-fg-muted hover:border-fg-faint"
                        }`}
                      >
                        <span aria-hidden="true">{e}</span>
                        {count > 1 && (
                          <span className="font-mono tabular-nums">{count}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {endsGroup && (
                <span className="mt-1 px-1 font-mono text-xs text-fg-faint tabular-nums">
                  {timeLabel(m.at)}
                </span>
              )}
            </div>
          );
        })}

        {peerTyping && connected && (
          <div className="bubble-in mt-2 flex items-end">
            {/* Announced by the log's live region; the dots are decorative. */}
            <span className="sr-only">Stranger is typing</span>
            <span
              aria-hidden="true"
              className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-surface-2 px-3.5 py-3"
            >
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-fg-faint" />
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-fg-faint" />
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-fg-faint" />
            </span>
          </div>
        )}

        {!pinned && (
          <div className="pointer-events-none sticky bottom-0 z-10 flex justify-center pt-2">
            <button
              type="button"
              onClick={jumpToLatest}
              className="pointer-events-auto rounded-full border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-fg shadow-lg transition-colors hover:border-fg-faint"
            >
              {unread > 0
                ? `${unread} new message${unread > 1 ? "s" : ""}`
                : "Jump to latest"}{" "}
              <span aria-hidden="true">↓</span>
            </button>
          </div>
        )}
      </div>

      <div className="border-t border-line">
        {connected && (
          <div className="scroll-slim flex gap-2 overflow-x-auto px-3 pt-3">
            {QUICK_REPLIES.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  setDraft(q);
                  inputRef.current?.focus();
                }}
                className="shrink-0 rounded-full border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:border-fg-faint hover:text-fg"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={submit}
          className="flex gap-2 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (e.target.value) onTyping();
            }}
            placeholder={connected ? "Type a message…" : "Connecting…"}
            aria-label="Message"
            disabled={!connected}
            className="flex-1 rounded-full bg-surface px-4 py-2 text-base placeholder:text-fg-faint disabled:opacity-50 sm:text-sm"
          />
          <button
            type="submit"
            disabled={!connected || !draft.trim()}
            className="shrink-0 rounded-full bg-signal px-4 py-2 text-sm font-semibold text-signal-ink transition-colors hover:bg-signal-hi disabled:opacity-40 disabled:hover:bg-signal"
          >
            Send
          </button>
        </form>
      </div>

      {pendingLink && (
        <LinkPrompt link={pendingLink} onClose={() => setPendingLink(null)} />
      )}
    </div>
  );
}
