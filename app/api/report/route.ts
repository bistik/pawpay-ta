import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { reportBodySchema } from "@/lib/schemas";
import { invalidBodyResponse, parseJsonBody } from "@/lib/api-body";
import { getSessionToken, tokensMatch } from "@/lib/auth";
import { enforceRateLimits, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/report — body { fromId, reason }
// An anonymous abuse tally. It records ONLY { id, reason, createdAt }: `fromId`
// proves the caller owns a live session and is then discarded along with the
// IP. No peer id, no message content, no coordinates — the server can't see
// any of those anyway (chat/video are peer-to-peer), and this endpoint is
// deliberately not the place to start collecting them.
export async function POST(request: NextRequest) {
  // IP limit first: it shields the token lookup below from a token-spray flood.
  const ipLimited = await enforceRateLimits([
    { key: `report:ip:${getClientIp(request)}`, ...RATE_LIMITS.reportPerIp },
  ]);
  if (ipLimited) return ipLimited;

  const parsed = await parseJsonBody(request, reportBodySchema);
  if (!parsed.ok) return invalidBodyResponse(parsed);

  const { fromId, reason } = parsed.data;

  // Authenticate the reporter: the caller must prove it owns `fromId`.
  const reporter = await prisma.presence.findUnique({
    where: { id: fromId },
    select: { token: true },
  });
  if (!tokensMatch(reporter?.token, getSessionToken(request))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const sessionLimited = await enforceRateLimits([
    { key: `report:${fromId}`, ...RATE_LIMITS.reportPerSession },
  ]);
  if (sessionLimited) return sessionLimited;

  await prisma.report.create({ data: { reason } });

  return Response.json({ ok: true });
}
