// Shared types across client + API.

// Header carrying the per-session bearer token on signal/poll requests. Lives
// here (not in lib/auth, which pulls in node:crypto) so the client bundle stays
// free of server-only modules.
export const SESSION_TOKEN_HEADER = "x-session-token";

// Signal mailbox message types. The runtime tuple is the single source of
// truth: the type is derived from it and the zod schema (lib/schemas.ts) reuses
// it, so a new signal kind can never be added to one place but forgotten in
// another.
export const SIGNAL_TYPES = [
  "request", // connection request (tap a dot)
  "accept", // recipient accepted
  "decline", // recipient declined (or auto-declined while busy)
  "offer", // WebRTC SDP offer
  "answer", // WebRTC SDP answer
  "ice", // WebRTC ICE candidate
  "end", // hang up / leave the connection
] as const;

export type SignalType = (typeof SIGNAL_TYPES)[number];

// Signals whose payload carries an SDP description or ICE candidate.
export const PAYLOAD_SIGNAL_TYPES = ["offer", "answer", "ice"] as const;

export interface PeerDot {
  id: string;
  lat: number;
  lng: number;
  busy: boolean;
}

export interface SignalMsg {
  id: string;
  fromId: string;
  toId: string;
  type: SignalType;
  payload: string | null;
  createdAt: string;
}

export interface PollResponse {
  peers: PeerDot[];
  signals: SignalMsg[];
}
