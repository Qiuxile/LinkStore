import { recordAudit } from "./audit";
import { sha256Hex, timingSafeEqual } from "./crypto";
import {
  getClientIp,
  json,
  methodNotAllowed,
  readJsonBody,
} from "./http";
import { createSession, sessionCookie } from "./session";
import type { AdminConfigRow, Env } from "./types";
import { normalizeRedeemCode } from "./validation";

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const FALLBACK_MAX_KEYS = 4096;

interface Bucket {
  count: number;
  resetAt: number;
}

const fallbackBuckets = new Map<string, Bucket>();

function fallbackRateLimited(ip: string): boolean {
  const now = Date.now();

  if (fallbackBuckets.size >= FALLBACK_MAX_KEYS) {
    for (const [key, bucket] of fallbackBuckets) {
      if (bucket.resetAt <= now) fallbackBuckets.delete(key);
    }
    if (fallbackBuckets.size >= FALLBACK_MAX_KEYS) fallbackBuckets.clear();
  }

  const bucket = fallbackBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    fallbackBuckets.set(ip, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return false;
  }

  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX;
}

async function isRateLimited(env: Env, request: Request): Promise<boolean> {
  const ip = getClientIp(request);
  if (env.REDEEM_RATE_LIMITER) {
    try {
      const outcome = await env.REDEEM_RATE_LIMITER.limit({ key: ip });
      return !outcome.success;
    } catch {
      // The native limiter is the production path; keep a per-isolate
      // fallback so a binding outage does not remove the guard entirely.
      console.error("rate_limiter_unavailable");
    }
  }
  return fallbackRateLimited(ip);
}

function invalidCodeResponse(): Response {
  // All business failures intentionally share this exact response.
  return json({ ok: false, error: "INVALID_CODE" }, 400);
}

async function readSubmittedCode(request: Request): Promise<string | null> {
  try {
    const body = await readJsonBody(request);
    return normalizeRedeemCode(body.code);
  } catch {
    return null;
  }
}

export async function handleRedeem(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");

  if (await isRateLimited(env, request)) {
    return json(
      { ok: false, error: "RATE_LIMITED" },
      429,
      { "Retry-After": "60" },
    );
  }

  const code = await readSubmittedCode(request);
  if (!code) return invalidCodeResponse();

  const codeHash = await sha256Hex(code);
  const admin = await env.DB.prepare(
    `SELECT admin_code_hash, session_version
     FROM admin_config
     WHERE id = 1`,
  ).first<AdminConfigRow>();

  if (admin && timingSafeEqual(admin.admin_code_hash, codeHash)) {
    const { token, ttl } = await createSession(env, admin.session_version);
    const response = json(
      { ok: true, type: "admin", redirectTo: "/admin" },
      200,
      { "Set-Cookie": sessionCookie(token, ttl) },
    );

    await recordAudit(
      env,
      request,
      "admin_login",
      `session_version=${admin.session_version}`,
    );
    return response;
  }

  const now = new Date().toISOString();
  const redeemed = await env.DB.prepare(
    `UPDATE redemption_codes
     SET used_count = used_count + 1,
         last_used_at = ?
     WHERE code_hash = ?
       AND disabled = 0
       AND used_count < max_uses
       AND (expires_at IS NULL OR expires_at > ?)
     RETURNING target_url`,
  )
    .bind(now, codeHash, now)
    .first<{ target_url: string }>();

  // A single affected row is the only success condition. The WHERE clause
  // guarantees at most one concurrent request can consume the final use.
  if (!redeemed) return invalidCodeResponse();

  return json({
    ok: true,
    type: "redirect",
    targetUrl: redeemed.target_url,
  });
}
