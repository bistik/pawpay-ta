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

TBD.

## Phase 4 — Make it better

TBD.
