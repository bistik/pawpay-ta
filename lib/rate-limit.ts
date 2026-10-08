// Fixed-window rate limiting. Counters live in Postgres because Vercel runs
// many serverless instances — an in-process Map would be per-instance and
// trivially bypassed. Keys are the client IP (for the unauthenticated entry
// point) or the authenticated session id.
import { prisma } from "@/lib/prisma";

export interface RateLimitRule {
  key: string;
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  joinPerIp: { limit: 30, windowMs: 60_000 },
  signalPerSession: { limit: 120, windowMs: 60_000 },
  signalPerIp: { limit: 300, windowMs: 60_000 },
  pollPerSession: { limit: 150, windowMs: 60_000 },
  pollPerIp: { limit: 600, windowMs: 60_000 },
  leavePerSession: { limit: 30, windowMs: 60_000 },
  leavePerIp: { limit: 60, windowMs: 60_000 },
} as const;

// Keep counters around a little longer than the widest window so the prune in
// `poll` can't drop a window that's still being counted.
export const RATE_LIMIT_RETENTION_MS = 5 * 60_000;

export interface RateLimitResult {
  ok: boolean;
  retryAfterSeconds: number;
}

export async function checkRateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);

  // Single atomic upsert: reset the counter when the window rolls over,
  // otherwise increment. RETURNING gives us the post-increment value.
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count")
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key") DO UPDATE
      SET "count" = CASE
            WHEN "RateLimit"."windowStart" = EXCLUDED."windowStart"
              THEN "RateLimit"."count" + 1
            ELSE 1
          END,
          "windowStart" = EXCLUDED."windowStart"
    RETURNING "count"
  `;

  const count = Number(rows[0]?.count ?? 1);
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((windowStart.getTime() + windowMs - now) / 1000),
  );

  return { ok: count <= limit, retryAfterSeconds };
}

// Returns a 429 Response if any rule is exceeded, otherwise null.
export async function enforceRateLimits(
  rules: RateLimitRule[],
): Promise<Response | null> {
  for (const rule of rules) {
    const result = await checkRateLimit(rule.key, rule);
    if (!result.ok) {
      return Response.json(
        { error: "rate limited" },
        {
          status: 429,
          headers: { "Retry-After": String(result.retryAfterSeconds) },
        },
      );
    }
  }
  return null;
}

// Client IP, for keying the limiter on the unauthenticated join endpoint.
// Vercel sets x-forwarded-for at the edge; the left-most entry is the client.
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? "unknown";
  return request.headers.get("x-real-ip") ?? "unknown";
}
