import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signalBodySchema } from "@/lib/schemas";
import { invalidBodyResponse, parseJsonBody } from "@/lib/api-body";
import { getSessionToken, tokensMatch } from "@/lib/auth";
import { SIGNAL_TTL_MS } from "@/lib/presence";
import { enforceRateLimits, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/signal — body { fromId, toId, type, payload? }
// Drops one message into the recipient's mailbox. Also manages the `busy`
// flag so a user can only be in one connection at a time.
export async function POST(request: NextRequest) {
  // IP limit first: it shields the token lookup below from a token-spray flood.
  const ipLimited = await enforceRateLimits([
    { key: `signal:ip:${getClientIp(request)}`, ...RATE_LIMITS.signalPerIp },
  ]);
  if (ipLimited) return ipLimited;

  const parsed = await parseJsonBody(request, signalBodySchema);
  if (!parsed.ok) return invalidBodyResponse(parsed);

  const { fromId, toId, type, payload } = parsed.data;
  const payloadStr = payload ?? null;

  // Authenticate the sender: the caller must prove it owns `fromId`.
  const sender = await prisma.presence.findUnique({
    where: { id: fromId },
    select: { token: true },
  });
  if (!tokensMatch(sender?.token, getSessionToken(request))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const sessionLimited = await enforceRateLimits([
    { key: `signal:${fromId}`, ...RATE_LIMITS.signalPerSession },
  ]);
  if (sessionLimited) return sessionLimited;

  // Enforce "one active connection at a time": if the target is already busy,
  // auto-decline the request instead of delivering it.
  if (type === "request") {
    const target = await prisma.presence.findUnique({
      where: { id: toId },
      select: { busy: true },
    });
    if (!target || target.busy) {
      // Target offline or busy — tell the initiator it was declined.
      await sendDecline(toId, fromId);
      return Response.json({ ok: true, autoDeclined: true });
    }
  }

  // Busy transitions:
  // - accept: only valid if `toId` really did request `fromId` recently —
  //   otherwise a stranger could mark an unrelated peer busy (a connection DoS).
  //   On success, mark BOTH peers busy.
  // - decline/end: free both peers.
  if (type === "accept") {
    const pending = await prisma.signal.findFirst({
      where: {
        fromId: toId,
        toId: fromId,
        type: "request",
        createdAt: { gte: new Date(Date.now() - SIGNAL_TTL_MS) },
      },
      select: { id: true },
    });
    if (!pending) {
      return Response.json({ error: "no pending request" }, { status: 409 });
    }
    await prisma.presence.updateMany({
      where: { id: { in: [fromId, toId] } },
      data: { busy: true },
    });
  } else if (type === "decline" || type === "end") {
    await prisma.presence.updateMany({
      where: { id: { in: [fromId, toId] } },
      data: { busy: false },
    });
  }

  await prisma.signal.create({
    data: { fromId, toId, type, payload: payloadStr },
  });

  return Response.json({ ok: true });
}

// Helper: deliver an auto-decline from `target` back to `initiator`.
async function sendDecline(targetId: string, initiatorId: string) {
  await prisma.signal.create({
    data: { fromId: targetId, toId: initiatorId, type: "decline", payload: null },
  });
}
