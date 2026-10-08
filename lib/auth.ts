// Per-session bearer tokens. The public session id stays public (the peer list
// hands it out so others can address you), but proving you *are* that session
// requires a secret the server minted at join and only that client holds.
//
// Tokens are random and stored server-side (Presence.token), so they can't be
// forged by anyone who merely knows an id — including someone calling /api/join
// with a victim's id, which is why a stateless HMAC-over-id token would not
// work here.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { SESSION_TOKEN_HEADER } from "@/lib/types";

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

// Constant-time compare so a token can't be recovered byte-by-byte via timing.
export function tokensMatch(
  stored: string | null | undefined,
  presented: string | null | undefined,
): boolean {
  if (!stored || !presented) return false;
  const a = Buffer.from(stored);
  const b = Buffer.from(presented);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Reads the token from the `x-session-token` header. POSTs that must survive a
// tab close go out via `navigator.sendBeacon`, which cannot set headers, so
// those endpoints read the token from the body instead.
export function getSessionToken(request: Request): string | null {
  return request.headers.get(SESSION_TOKEN_HEADER);
}
