// Small helpers that read a request body, reject unexpected content types, and
// run it through a zod schema. Keeps every route handler's error shape
// consistent and stops malformed input before it reaches Prisma.
import { z } from "zod";

type ParseFailure = {
  ok: false;
  status: 400 | 415;
  body: {
    error: string;
    issues?: {
      formErrors: string[];
      fieldErrors: Record<string, string[] | undefined>;
    };
  };
};

type ParseSuccess<T> = { ok: true; data: T };

export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

// Parse a JSON request body. When `requireJson` is set, callers must send a
// JSON content type — this is a cheap CSRF guard, because cross-site
// "simple" requests (form posts, sendBeacon) can't set application/json
// without triggering a CORS preflight.
export async function parseJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
  { requireJson = true }: { requireJson?: boolean } = {},
): Promise<ParseResult<z.infer<S>>> {
  if (requireJson) {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return {
        ok: false,
        status: 415,
        body: { error: "expected application/json" },
      };
    }
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, status: 400, body: { error: "unreadable body" } };
  }

  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : undefined;
  } catch {
    return { ok: false, status: 400, body: { error: "invalid json" } };
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "invalid body",
        issues: z.flattenError(parsed.error),
      },
    };
  }

  return { ok: true, data: parsed.data };
}

export function invalidBodyResponse(result: ParseFailure): Response {
  return Response.json(result.body, { status: result.status });
}
