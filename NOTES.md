# Pulse — Notes

## Phase 1 — Make it run

Traced the full connect → negotiate → chat/end flow. Four bugs, plus env wiring.

- **Chat never arrived.** `sendChat` tagged frames `{ t: "msg" }`, but the receiver
  only matched `t === "chat"`, so every frame fell through an empty `catch`. Gave the
  wire format a `WireMessage` discriminated union + `parseWireMessage`;
  `safeSend(msg: WireMessage)` makes a wrong tag a compile error, so send and receive
  can't drift apart.
- **Dots stayed online.** The poll heartbeat ran `updateMany({ where: {} })`, refreshing
  `lastSeen` for *every* user, so the reaper never caught anyone. Scoped it to
  `where: { id }` (`app/api/poll/route.ts`).
- **Stuck "busy" after hang-up.** `signal` cleared `busy` on `decline` but not `end`.
  `end` now frees both peers.
- **Dropped ICE candidates.** Candidates buffered while the remote description was
  being applied were never flushed. Flush again after `setRemoteDescription`.
- **Env/tooling.** `@neon/config` + `@neon/env`, `neon.ts`, `.mcp.json`, `.neon`
  gitignored, `postinstall: prisma generate`.

## Phase 2 — Make it good

Two slices: globe + brand system first (so nothing got restyled twice), then chat feel.

**Direction.** The concept is *Earth at night*: a dark sphere with a cool rim,
strangers as cool points of light, and one warm amber "beacon" for anything meaning
you/action. Warm vs cool is load-bearing — stranger hues are clamped to a 168–288°
band, so the accent can never be confused with a peer. Dark-only on purpose; a light
theme would fight the map.

- **Tokens** (`app/globals.css`): colour defined in OKLCH as semantic roles, mapped
  into Tailwind v4 via `@theme inline`, so utilities and component CSS share one
  source of truth. Fixed a real bug: `body` was forced to `Arial`, so **Geist was
  downloaded and never used**. Added one `:focus-visible` treatment and a global
  `prefers-reduced-motion` switch (`0.01ms`, so `transitionend` still fires).
- **Globe** (`WorldMap`): `projection: "globe"` + `setFog` atmosphere against deep
  space and stars, instead of a flat map; a ~0.9°/s idle spin that pauses on any
  gesture and is off under reduced-motion. Markers get cool hues, a halo, a sonar ring
  and a hover label; **busy is now a hollow, dashed shape** rather than 35% opacity, so
  it survives greyscale. Replaced the OS-inconsistent 📍 pin with a warm beacon. Fixed
  a dead `!TOKEN` fallback (`?? "pk…"` meant a missing token silently rendered a broken
  map).
- **Brand** (`Beacon`, `EntryGate`): a pulse-beacon mark drives the hero — mark,
  wordmark, one promise line, one dominant action, privacy as a trust line — over a
  starfield and night-side planet, with a staggered entrance.
- **Chat feel.** One hue per stranger (`lib/peer-color.ts`) drives both the map dot and
  the chat avatar (a shaded "point of light"). `typing` joins the `PeerControl` union —
  throttled to 1 send per 1.2 s, self-clearing after 3 s, announced once. Messages group
  with a single timestamp per run; the view auto-follows only when you're already at the
  bottom, otherwise a "N new messages" pill appears. On phones the chat is a bottom
  sheet with a handle to peek at the map.
- **Rode along:** prompts are real dialogs (focus moved in, Tab trapped, Esc, focus
  restored); status pills are `aria-live` and the message list is a `role="log"`; the
  chat input is 16 px on mobile so **iOS stops auto-zooming**; chrome respects
  `env(safe-area-inset-*)`; self-view video is mirrored.

**Verified:** `tsc`, `eslint`, `next build` clean. Rendered the entry at 320/390/1280
and the live globe via headless Chrome (CDP + faked geolocation); the chat was
render-checked mid-slice.

**Deferred:** video mute/flip/quality controls, marker clustering, sound/haptics.

## Phase 3 — Make it secure

Reviewed `join`/`signal`/`poll`/`leave`. Fixed critical + high; the rest are noted.

- **Validated bodies (zod).** `lib/schemas.ts` is the single source of truth; every
  route validates before Prisma. `join`: UUID + in-range coords (still offset, never
  stored raw). `signal`: UUIDs, constrained `type`, 64 KB payload cap, and a tight
  contract — `offer`/`answer`/`ice` require a payload, control signals must not carry
  one (which also fixed a client `JSON.parse("")` crash). Bodies are `strictObject`;
  `SIGNAL_TYPES` is one `as const` tuple feeding both the union and the zod enum.
- **Session-token auth (critical).** The id was both the public handle *and* the only
  credential, and `poll` hands out every id — so any peer could drain another's
  mailbox, forge signals as them, or `leave` them. `join` now mints a 256-bit token
  (`lib/auth.ts`, on `Presence.token`, returned once) that `signal`/`poll`/`leave`
  verify constant-time. `join` refuses to re-issue a live id's token (409), which is why
  a stateless HMAC-over-id token wouldn't have worked here. Still anonymous: no account,
  no PII, the token just isn't published. Sent in `x-session-token`; `leave` carries it
  in the body since `sendBeacon` can't set headers.
- **Rate limiting (high).** Postgres fixed-window counters (`lib/rate-limit.ts` +
  `RateLimit` table), shared across serverless instances. Per-IP everywhere (shielding
  the pre-auth token lookup) plus per-session on `signal`/`poll`/`leave`; 429 +
  `Retry-After`.
- **Busy-flag DoS (high).** Auth wasn't enough — any user could `accept` a stranger and
  mark them busy. `accept` now requires a real pending `request` within the signal TTL,
  so `poll` stamps `deliveredAt` instead of deleting.

Schema lives in a migration the build applies via `prisma migrate deploy` (using
`DATABASE_URL_UNPOOLED`, since PgBouncer can't hold its locks; the runtime keeps the
pooled `DATABASE_URL`). Prod's Neon branch was empty, so the first deploy created the
schema from scratch; Vercel holds `DATABASE_URL`, `DATABASE_URL_UNPOOLED` and
`NEXT_PUBLIC_MAPBOX_TOKEN`. The build runs on every deploy, so scope `migrate deploy` to
production if previews ever share the prod DB.

**Noted, not fixed.** Mailbox flooding (no per-recipient cap); only `request` checks the
peer exists; `/api/leave` has no `Origin`/`Sec-Fetch-Site` check (low); `end`/`decline`
can free a peer you aren't connected to (low); `npm audit` flags a critical Next.js
advisory plus highs in `sharp`/`postcss`/`nanoid`/`fast-uri` (medium); no security
headers (low); session id still in the `poll` query string (low).

Verified with tsc, eslint, `next build` and live tests: 401 without/with a wrong token,
409 on id reuse and on `accept` with no pending request, the full join → request →
accept → busy flow, and 150 polls allowed before 429.

## Phase 4 — Make it better

**"Safer strangers."** Pulse pairs strangers on video, so its real risk is abuse,
not missing features. These slices make a connection accountable and self-defending
*without* breaking the privacy promise (no accounts, nothing stored) — mostly
**outside the WebRTC wire format**, with reactions the one additive exception.

- **Profanity masking** (`lib/moderation.ts`). Masked **on send and on render**:
  the wire never carries the raw word, and a patched client can't unmask it.
  Whole-word matching over a folded form (leet `4/@/3/1/0/$/5/7`, accents,
  `fuuuck → fuck`); substrings are never matched, so Scunthorpe / "assassin" /
  "classic" survive. A speed bump, not a wall.
- **Link safety** (`lib/links.ts`, `MessageText`, `LinkPrompt`). URLs are never
  auto-linked — they render as buttons that open a confirm dialog showing the
  host first, with raw-IP and punycode hosts flagged. Only `http(s)://`/`www.`
  match, so "e.g." isn't a link.
- **Secure-channel badge** (`lib/secure-code.ts`). Both peers sort the two DTLS
  fingerprints from their SDP, SHA-256 them, and render 4 emoji — identical on
  both screens unless a relay rewrote the fingerprints. Catches an active MITM,
  but only pays off if the two humans compare it (and a short code is grindable).
- **Report & eject** (`app/api/report`, `ReportPrompt`). Pick a reason → instant
  disconnect, the peer gets the normal `end`, and re-requests are auto-declined
  for the session. The tally stores **only `{ id, reason, createdAt }`** — no
  session ids, content, or IP. Anonymous telemetry, not enforcement: the server
  can't identify an anonymous P2P peer, and it doesn't pretend otherwise.
- **Icebreakers + quick replies** (`lib/icebreakers.ts`). A per-peer opening
  prompt and chips that insert into the draft (a suggestion, never an auto-send).
- **Emoji reactions** (`lib/webrtc.ts`, `ChatPanel`). Chat ids were a local counter,
  so a peer had nothing to point at — `chat` now carries a shared `id`, and a new
  `react` message (`{ to, emoji, op }`) targets a fixed 6-emoji whitelist validated
  on receive. Chips show a count and highlight yours; a hover/tap tray adds one.
  Whitelisted, so they bypass the profanity mask and the link path.
- **Background blur** (`lib/background-blur.ts`, `PeerSession.setBlur`). Camera →
  MediaPipe Selfie Segmentation → a downscale/upscale-blurred frame composited under
  a mask cut-out of the person, published via `sender.replaceTrack`; the `Blur` toggle
  swaps tracks and the self-view mirrors it. Wasm + model are self-hosted (generated
  at install by `scripts/setup-mediapipe.mjs`), so video never leaves the device.

**Shape.** The report route mirrors `signal`/`leave` (IP limit → zod strictObject
→ session-token auth → per-session limit); `Report` is an additive migration the
build applies via `prisma migrate deploy`.

**Verified.** `tsc`, `eslint`, `next build` clean; live API probes (415/400/401) and a
24-case scratch suite (moderation, links, SAS). The reactions + blur slice adds
`tsc`/`eslint`/`next build`; both want a two-window browser check.

**Next.** GIF/sticker search (provider + IP-leak note), ML noise cancellation and
a softer (portrait) blur mode, and a `Report` retention prune.
