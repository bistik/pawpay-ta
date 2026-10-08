import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { applyPrivacyOffset } from "@/lib/geo";
import { joinBodySchema } from "@/lib/schemas";
import { invalidBodyResponse, parseJsonBody } from "@/lib/api-body";
import { getSessionToken, newSessionToken, tokensMatch } from "@/lib/auth";
import { STALE_MS } from "@/lib/presence";
import { enforceRateLimits, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/join — body { id, lat, lng } (raw coords).
// Applies a 1–3 km privacy offset, upserts the presence row, and returns the
// session's bearer token. Raw coordinates are never stored.
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimits([
    { key: `join:${getClientIp(request)}`, ...RATE_LIMITS.joinPerIp },
  ]);
  if (limited) return limited;

  const parsed = await parseJsonBody(request, joinBodySchema);
  if (!parsed.ok) return invalidBodyResponse(parsed);

  const { id, lat, lng } = parsed.data;
  const offset = applyPrivacyOffset(lat, lng);
  const now = new Date();

  // If `id` is already live, someone else holds it. Refuse to hand out a fresh
  // token — that would be a session takeover — unless the caller proves it
  // already owns the row by presenting the existing token.
  const existing = await prisma.presence.findUnique({
    where: { id },
    select: { token: true, lastSeen: true },
  });
  const isLive =
    !!existing && now.getTime() - existing.lastSeen.getTime() < STALE_MS;

  if (isLive && !tokensMatch(existing.token, getSessionToken(request))) {
    return Response.json({ error: "id in use" }, { status: 409 });
  }

  const token = isLive && existing.token ? existing.token : newSessionToken();

  await prisma.presence.upsert({
    where: { id },
    create: {
      id,
      lat: offset.lat,
      lng: offset.lng,
      busy: false,
      token,
      lastSeen: now,
    },
    update: {
      lat: offset.lat,
      lng: offset.lng,
      token,
      lastSeen: now,
    },
  });

  return Response.json({ ok: true, token });
}
