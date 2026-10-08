import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { STALE_MS, SIGNAL_TTL_MS } from "@/lib/presence";
import { pollQuerySchema } from "@/lib/schemas";
import { getSessionToken, tokensMatch } from "@/lib/auth";
import {
  enforceRateLimits,
  getClientIp,
  RATE_LIMIT_RETENTION_MS,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import type { PollResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/poll?id= — the single endpoint that drives the live map.
// It (1) authenticates the caller, (2) heartbeats them, (3) reaps stale
// presence + orphan signals + old rate-limit counters, (4) returns the filtered
// online peers, and (5) delivers this user's mailbox.
export async function GET(request: NextRequest) {
  // IP limit first: shields the token lookup below from an unauthenticated flood.
  const ipLimited = await enforceRateLimits([
    { key: `poll:ip:${getClientIp(request)}`, ...RATE_LIMITS.pollPerIp },
  ]);
  if (ipLimited) return ipLimited;

  const params = request.nextUrl.searchParams;
  const parsed = pollQuerySchema.safeParse({ id: params.get("id") ?? undefined });

  if (!parsed.success) {
    return Response.json({ error: "invalid id" }, { status: 400 });
  }

  const { id } = parsed.data;

  // Authenticate the poller: the caller must prove it owns `id`.
  const caller = await prisma.presence.findUnique({
    where: { id },
    select: { token: true },
  });
  if (!tokensMatch(caller?.token, getSessionToken(request))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const sessionLimited = await enforceRateLimits([
    { key: `poll:${id}`, ...RATE_LIMITS.pollPerSession },
  ]);
  if (sessionLimited) return sessionLimited;

  const now = Date.now();
  const staleCutoff = new Date(now - STALE_MS);
  const signalCutoff = new Date(now - SIGNAL_TTL_MS);

  // 1) Heartbeat — refresh lastSeen for the caller.
  await prisma.presence.updateMany({
    where: { id },
    data: { lastSeen: new Date(now) },
  });

  // 2) Reap stale presence rows, orphaned signals, and old limiter counters
  // (independent deletes — no atomicity needed, and avoids transactions over a
  // PgBouncer pooler).
  await prisma.presence.deleteMany({ where: { lastSeen: { lt: staleCutoff } } });
  await prisma.signal.deleteMany({ where: { createdAt: { lt: signalCutoff } } });
  await prisma.rateLimit.deleteMany({
    where: { windowStart: { lt: new Date(now - RATE_LIMIT_RETENTION_MS) } },
  });

  // 3) Online peers, excluding self.
  const peers = await prisma.presence.findMany({
    where: {
      id: { not: id },
      lastSeen: { gte: staleCutoff },
    },
    select: { id: true, lat: true, lng: true, busy: true },
  });

  // 4) Deliver this user's mailbox: hand over undelivered rows, then mark them
  // delivered (not delete) so a later `accept` can still verify the request was
  // real. A concurrently-inserted signal isn't in our id list, so it's safe.
  const inbox = await prisma.signal.findMany({
    where: { toId: id, deliveredAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (inbox.length > 0) {
    await prisma.signal.updateMany({
      where: { id: { in: inbox.map((s) => s.id) } },
      data: { deliveredAt: new Date(now) },
    });
  }

  const response: PollResponse = {
    peers: peers.map((p) => ({
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      busy: p.busy,
    })),
    signals: inbox.map((s) => ({
      id: s.id,
      fromId: s.fromId,
      toId: s.toId,
      type: s.type as PollResponse["signals"][number]["type"],
      payload: s.payload,
      createdAt: s.createdAt.toISOString(),
    })),
  };

  return Response.json(response);
}
