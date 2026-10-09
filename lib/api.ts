// Client-side helpers for talking to the coordination API.
import type { PollResponse, ReportReason, SignalType } from "@/lib/types";
import { SESSION_TOKEN_HEADER } from "@/lib/types";

// The session token lives here rather than at every call site: `join` stores
// the token the server returns, and poll/signal/leave attach it automatically.
let sessionToken: string | null = null;
let lastJoin: { id: string; lat: number; lng: number } | null = null;

function tokenHeaders(): Record<string, string> {
  return sessionToken ? { [SESSION_TOKEN_HEADER]: sessionToken } : {};
}

export async function join(
  id: string,
  lat: number,
  lng: number,
): Promise<void> {
  lastJoin = { id, lat, lng };
  const res = await fetch("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, lat, lng }),
  });
  if (res.ok) {
    const data = (await res.json().catch(() => null)) as {
      token?: string;
    } | null;
    sessionToken = data?.token ?? sessionToken;
  }
}

export async function poll(id: string): Promise<PollResponse> {
  const url = `/api/poll?id=${encodeURIComponent(id)}`;
  let res = await fetch(url, { cache: "no-store", headers: tokenHeaders() });

  // Our presence row can expire if the tab was throttled long enough for the
  // server's staleness reaper to drop it. Re-establish the session once, then
  // retry — otherwise the poll loop would 401 forever.
  if (res.status === 401 && lastJoin?.id === id) {
    await join(lastJoin.id, lastJoin.lat, lastJoin.lng);
    res = await fetch(url, { cache: "no-store", headers: tokenHeaders() });
  }

  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  return res.json();
}

export async function sendSignal(
  fromId: string,
  toId: string,
  type: SignalType,
  payload?: string,
): Promise<void> {
  await fetch("/api/signal", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...tokenHeaders() },
    body: JSON.stringify({ fromId, toId, type, payload }),
  });
}

// Fire-and-forget leave that survives the tab closing. sendBeacon cannot set
// headers, so the token rides in the body.
export function leave(id: string): void {
  const body = JSON.stringify({ id, token: sessionToken });
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon("/api/leave", body);
  } else {
    void fetch("/api/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
  }
}

// File an anonymous abuse report. No peer id or content is sent — only the
// caller's own session (which the server uses to authorize, then discards) and
// the picked reason. Fire-and-forget; the caller disconnects regardless.
export function reportPeer(fromId: string, reason: ReportReason): void {
  void fetch("/api/report", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...tokenHeaders() },
    body: JSON.stringify({ fromId, reason }),
    keepalive: true,
  });
}
