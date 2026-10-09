// Request-body schemas for the coordination API. One source of truth for what
// each endpoint accepts, shared by the route handlers (server-side validation)
// and the inferred TypeScript types (so the client can't drift).
//
// Every schema is a `strictObject`: unknown keys are rejected rather than
// silently ignored. Session ids must be UUIDs because the client generates them
// with `crypto.randomUUID()` — pinning the format stops a caller from choosing
// arbitrary, guessable, or oversized ids.
import { z } from "zod";
import {
  PAYLOAD_SIGNAL_TYPES,
  REPORT_REASONS,
  SIGNAL_TYPES,
} from "@/lib/types";

// SDP/ICE blobs are small; cap the payload so a peer can't stuff the mailbox
// with megabytes per message.
export const MAX_SIGNAL_PAYLOAD = 64 * 1024;

const sessionId = z.uuid();

const PAYLOAD_TYPES = new Set<string>(PAYLOAD_SIGNAL_TYPES);

// POST /api/join — raw coordinates, privacy-offset server-side.
export const joinBodySchema = z.strictObject({
  id: sessionId,
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});

// POST /api/signal — one mailbox message + busy-flag transitions.
export const signalBodySchema = z
  .strictObject({
    fromId: sessionId,
    toId: sessionId,
    type: z.enum(SIGNAL_TYPES),
    payload: z.string().max(MAX_SIGNAL_PAYLOAD).nullish(),
  })
  // You can't signal yourself: otherwise a caller could flip its own busy flag
  // or spin request/decline loops.
  .refine((d) => d.fromId !== d.toId, {
    message: "fromId and toId must differ",
    path: ["toId"],
  })
  // The wire contract stays tight: offer/answer/ice carry a payload, the
  // control signals carry none.
  .superRefine((d, ctx) => {
    const needsPayload = PAYLOAD_TYPES.has(d.type);
    if (needsPayload && typeof d.payload !== "string") {
      ctx.addIssue({
        code: "custom",
        message: `${d.type} requires a payload`,
        path: ["payload"],
      });
    }
    if (!needsPayload && d.payload != null) {
      ctx.addIssue({
        code: "custom",
        message: `${d.type} must not carry a payload`,
        path: ["payload"],
      });
    }
  });

// POST /api/leave — sent via `navigator.sendBeacon`, which cannot set headers,
// so the session token rides in the body (validated the same way, but without
// requiring a JSON content-type).
export const leaveBodySchema = z.strictObject({
  id: sessionId,
  token: z.string().min(1).max(256),
});

// GET /api/poll?id= — not strict: query strings carry incidental params
// (cache busters, tracking) that shouldn't fail the request.
export const pollQuerySchema = z.object({
  id: sessionId,
});

// POST /api/report — an anonymous abuse tally. `fromId` only proves the caller
// owns a live session; it is never stored. No peer id, no content, no IP.
export const reportBodySchema = z.strictObject({
  fromId: sessionId,
  reason: z.enum(REPORT_REASONS),
});

export type JoinBody = z.infer<typeof joinBodySchema>;
export type SignalBody = z.infer<typeof signalBodySchema>;
export type ReportBody = z.infer<typeof reportBodySchema>;
