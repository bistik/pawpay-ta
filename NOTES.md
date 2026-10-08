# Pulse — Notes

## Phase 1 — Make it run

Found three bugs by tracing the full connect → negotiate → chat/end flow, plus
local/Neon env wiring.

**Chat never arrived on the other side**
- Symptom: after two peers connected, messages sent from one side never appeared
  for the other.
- Cause: the data channel was asymmetric. In `lib/webrtc.ts`, `sendChat` tagged
  outgoing frames `{ t: "msg" }`, but the receive handler only matched
  `t === "chat"`. Every chat frame fell through the `else if` and was swallowed
  by the empty `catch`.
- Fix: gave the wire format a `WireMessage` discriminated union plus a
  `parseWireMessage` validator. `sendChat` now sends `{ t: "chat" }`, and
  `safeSend(msg: WireMessage)` makes a wrong tag a compile error instead of a
  silent drop. Send and receive now share one type, so they can't drift.

**Stale dots stayed online**
- Symptom: after everyone closed the app, dots lingered on the map for ages.
- Cause: the poll heartbeat used `updateMany({ where: {} })`, refreshing
  `lastSeen` for *every* user on every poll, so the staleness reaper never caught
  anyone.
- Fix: scoped the heartbeat to `where: { id }` in `app/api/poll/route.ts`.

**A user stayed "busy" after hanging up**
- Symptom: after ending a call, a user could not be re-connected.
- Cause: `app/api/signal/route.ts` cleared the `busy` flag on `decline` but not on
  `end`, so the hung-up peer was left marked busy.
- Fix: treat `end` like `decline` — free both peers.

**ICE candidates dropped**
- Cause: candidates arriving while the remote description was still being applied
  (same poll batch as the offer/answer) had no flush after
  `setRemoteDescription`.
- Fix: flush the pending-candidate queue again after setting the remote
  description.

**Env / tooling**
- Added `@neon/config` + `@neon/env`, `neon.ts`, `.mcp.json`, a `.gitignore` entry
  for `.neon`, and a `postinstall: prisma generate`.

## Phase 2 — Make it good

TBD.

## Phase 3 — Make it secure

Review of the four coordination endpoints (`join`, `signal`, `poll`, `leave`):
surface-level input handling first, then the structural issues. Fixed the
critical + high findings; medium and below are noted at the end.

**Fixed — typed + validated request bodies (zod)**

`lib/schemas.ts` is the single source of truth; every route validates before
touching Prisma.

- `join`: UUID `id`, finite in-range `lat`/`lng` (raw coords still
  privacy-offset and never stored).
- `signal`: UUID ids, `type` constrained, 64 KB `payload` cap — and the wire
  contract is tight: `offer`/`answer`/`ice` **require** a payload, the control
  signals must not carry one (this also fixed the client crash on
  `JSON.parse("")`).
- `poll`/`leave`: same UUID check.
- All bodies are `strictObject` (unknown keys rejected). `SIGNAL_TYPES` is one
  `as const` tuple; the `SignalType` union and the zod enum both derive from it.
- `parseJsonBody` (`lib/api-body.ts`) rejects non-`application/json` (415) and
  returns a consistent 400 with the zod issues.

**Fixed — session-token authentication (critical)**

- The flaw: the session id was both the public handle *and* the only
  credential, and `poll` hands every peer's id out — so anyone could drain a
  victim's mailbox (reading/deleting their signaling), forge signals as them, or
  `leave` them.
- Now `join` mints a random 256-bit token (`lib/auth.ts`), stored on
  `Presence.token` and returned once; `signal`/`poll`/`leave` verify it
  (constant-time) against the claimed id. `join` refuses to re-issue a live id's
  token (409), so the token can't be taken by joining as the victim — which is
  why a stateless HMAC-over-id token would not have worked here. Still
  anonymous: no account, no PII, the token simply isn't published.
- Token travels in `x-session-token` for `signal`/`poll`; `leave` carries it in
  the body because `sendBeacon` cannot set headers. `lib/api.ts` holds it and
  re-joins once if the server reaped an idle session.

**Fixed — rate limiting (high)**

- Postgres fixed-window counters (`lib/rate-limit.ts` + `RateLimit` table) —
  shared across serverless instances, unlike an in-process map.
- Per-IP on every endpoint (shields the pre-auth token lookup), plus
  per-authenticated-session on `signal`/`poll`/`leave`. Returns 429 with
  `Retry-After`; old windows pruned in `poll`.

**Fixed — busy-flag / connection DoS (high)**

- Auth alone wasn't enough: any authenticated user could still `accept` to a
  stranger and mark them busy. `accept` now requires a real pending `request`
  from the target within the signal TTL — so `poll` marks signals `deliveredAt`
  instead of deleting them, letting the request survive delivery for that check.

Schema changes are captured in a migration
(`prisma/migrations/20261008143042_add_session_tokens_and_rate_limit`) and
applied with `prisma migrate deploy`, which the build now runs. Migrate uses
`DATABASE_URL_UNPOOLED` (PgBouncer can't hold its locks); the app runtime keeps
the pooled `DATABASE_URL` (`lib/prisma.ts`).

**Production rollout (next session).** The existing prod DB predates migrations,
so baseline it once against the prod direct URL —
`npx prisma migrate resolve --applied 20260608183826_initialized` — then deploy;
the Vercel build's `migrate deploy` applies the token/RateLimit migration. Set
`DATABASE_URL_UNPOOLED` in the Vercel project env. Note the build runs on every
deploy, so if preview deployments share the prod database, scope `migrate
deploy` to the production environment.

**Noted, not fixed (medium and below)**

- Mailbox flooding: no cap on pending signals per recipient within the TTL.
- Signals to nonexistent peers: only `request` checks the target exists.
- CSRF on `/api/leave`: needs a valid token now, but `Origin`/`Sec-Fetch-Site`
  isn't checked. (Low.)
- `end`/`decline` can free a peer the caller isn't connected to — but only
  within `[self, one victim]`, so low impact. (Low.)
- Dependency audit: `npm audit` flags a critical Next.js advisory plus highs in
  `sharp`/`postcss`/`nanoid`/`fast-uri`. (Medium.)
- No security headers (CSP, `X-Content-Type-Options`, `Referrer-Policy`,
  HSTS). (Low.)
- Session id still in the `poll` query string. (Low.)

Verified with tsc, eslint, `next build`, and live tests: 401 without/with a
wrong token, 409 on id reuse and on an `accept` with no pending request, the
full join → request → accept → busy flow, and 150 polls allowed with the rest
429.



## Phase 4 — Make it better

TBD.
