import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { leaveBodySchema } from "@/lib/schemas";
import { invalidBodyResponse, parseJsonBody } from "@/lib/api-body";
import { tokensMatch } from "@/lib/auth";
import { enforceRateLimits, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/leave — body { id, token }. Removes the presence row and any
// pending signals to/from this user. Called via navigator.sendBeacon on tab
// close, so the body may arrive as text/plain and carries the token (beacon
// can't set headers) — hence `requireJson: false`.
export async function POST(request: NextRequest) {
  const ipLimited = await enforceRateLimits([
    { key: `leave:ip:${getClientIp(request)}`, ...RATE_LIMITS.leavePerIp },
  ]);
  if (ipLimited) return ipLimited;

  const parsed = await parseJsonBody(request, leaveBodySchema, {
    requireJson: false,
  });
  if (!parsed.ok) return invalidBodyResponse(parsed);

  const { id, token } = parsed.data;

  // Authenticate: only the owner of `id` may remove it.
  const row = await prisma.presence.findUnique({
    where: { id },
    select: { token: true },
  });
  if (!tokensMatch(row?.token, token)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const sessionLimited = await enforceRateLimits([
    { key: `leave:${id}`, ...RATE_LIMITS.leavePerSession },
  ]);
  if (sessionLimited) return sessionLimited;

  // Independent cleanup deletes — no atomicity needed (and interactive
  // transactions are unreliable over a PgBouncer pooler).
  await prisma.signal.deleteMany({
    where: { OR: [{ toId: id }, { fromId: id }] },
  });
  await prisma.presence.deleteMany({ where: { id } });

  return Response.json({ ok: true });
}
