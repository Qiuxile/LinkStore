import {
  base64UrlToBytes,
  bytesToBase64Url,
  randomBase64Url,
} from "./crypto";
import type { Env } from "./types";

const COOKIE_NAME = "ls_session";
const SESSION_VERSION_MIN = 1;
const DEFAULT_TTL_SECONDS = 7200;
const MIN_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 86400;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface SessionPayload {
  iat: number;
  exp: number;
  v: number;
  jti: string;
}

function getSecret(env: Env): string {
  const secret = env.SESSION_SECRET;
  if (!secret || encoder.encode(secret).byteLength < 32) {
    throw new Error("SESSION_SECRET must be at least 32 bytes");
  }
  return secret;
}

export function getSessionTtl(env: Env): number {
  const configured = Number(env.SESSION_TTL_SECONDS ?? DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(configured)) return DEFAULT_TTL_SECONDS;
  return Math.min(
    MAX_TTL_SECONDS,
    Math.max(MIN_TTL_SECONDS, Math.floor(configured)),
  );
}

async function importHmacKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(getSecret(env)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createSession(
  env: Env,
  sessionVersion: number,
): Promise<{ token: string; ttl: number }> {
  if (!Number.isInteger(sessionVersion) || sessionVersion < SESSION_VERSION_MIN) {
    throw new Error("Invalid session version");
  }

  const ttl = getSessionTtl(env);
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    iat: issuedAt,
    exp: issuedAt + ttl,
    v: sessionVersion,
    jti: randomBase64Url(16),
  };
  const payloadPart = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await importHmacKey(env);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payloadPart),
  );

  return {
    token: `${payloadPart}.${bytesToBase64Url(new Uint8Array(signature))}`,
    ttl,
  };
}

export async function readSession(
  request: Request,
  env: Env,
): Promise<SessionPayload | null> {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadPart, signaturePart] = parts;
  if (!payloadPart || !signaturePart) return null;

  try {
    const signature = base64UrlToBytes(signaturePart);
    const key = await importHmacKey(env);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      encoder.encode(payloadPart),
    );
    if (!valid) return null;

    const raw = JSON.parse(
      decoder.decode(base64UrlToBytes(payloadPart)),
    ) as Partial<SessionPayload>;

    const now = Math.floor(Date.now() / 1000);
    if (
      !Number.isInteger(raw.iat) ||
      !Number.isInteger(raw.exp) ||
      !Number.isInteger(raw.v) ||
      typeof raw.jti !== "string" ||
      raw.iat === undefined ||
      raw.exp === undefined ||
      raw.v === undefined
    ) {
      return null;
    }

    if (
      raw.v < SESSION_VERSION_MIN ||
      raw.exp <= now ||
      raw.iat > now + 60 ||
      raw.exp <= raw.iat ||
      raw.exp - raw.iat > getSessionTtl(env) + 5
    ) {
      return null;
    }

    return {
      iat: raw.iat,
      exp: raw.exp,
      v: raw.v,
      jti: raw.jti,
    };
  } catch {
    return null;
  }
}

export function sessionCookie(token: string, ttl: number): string {
  return [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${ttl}`,
  ].join("; ");
}

export function clearSessionCookie(): string {
  return [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ].join("; ");
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return null;
}
