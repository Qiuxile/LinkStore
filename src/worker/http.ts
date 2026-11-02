const MAX_JSON_BYTES = 8 * 1024;

const BASE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function json(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  const headers = new Headers(BASE_HEADERS);
  headers.set("Content-Type", "application/json; charset=utf-8");
  for (const [key, value] of Object.entries(extraHeaders)) {
    headers.set(key, value);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export function apiError(
  status: number,
  code: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return json({ ok: false, error: code }, status, extraHeaders);
}

export function methodNotAllowed(allow: string): Response {
  return json(
    { ok: false, error: "METHOD_NOT_ALLOWED" },
    405,
    { Allow: allow },
  );
}

/** Cloudflare sets CF-Connecting-IP and overwrites client-supplied values. */
export function getClientIp(request: Request): string {
  const connectingIp = request.headers.get("CF-Connecting-IP");
  return connectingIp && connectingIp.length <= 128 ? connectingIp : "local";
}

export async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (contentType.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new ApiError(400, "INVALID_REQUEST");
  }

  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE");
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new ApiError(400, "INVALID_REQUEST");
  }

  if (!text || new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
    throw new ApiError(
      text ? 413 : 400,
      text ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST",
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ApiError(400, "INVALID_REQUEST");
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiError(400, "INVALID_REQUEST");
  }
  return value as Record<string, unknown>;
}
