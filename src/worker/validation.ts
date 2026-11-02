import { ApiError } from "./http";

export const MAX_CODE_LENGTH = 256;
export const MIN_CUSTOM_CODE_LENGTH = 8;
export const MAX_CUSTOM_CODE_LENGTH = 128;
export const MAX_TARGET_URL_LENGTH = 2048;
export const MAX_USES_LIMIT = 1_000_000;

/** Returns a normalized absolute http(s) URL, or null if it is unsafe. */
export function normalizeTargetUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_TARGET_URL_LENGTH) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    try {
      // The UI also auto-prefixes, but accepting this at the API level keeps
      // older cached clients and API callers working.
      url = new URL(`https://${trimmed}`);
    } catch {
      return null;
    }
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return url.href.length <= MAX_TARGET_URL_LENGTH ? url.href : null;
}

export function normalizeRedeemCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_CODE_LENGTH) return null;
  return trimmed;
}

export function normalizeCustomCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (
    trimmed.length < MIN_CUSTOM_CODE_LENGTH ||
    trimmed.length > MAX_CUSTOM_CODE_LENGTH
  ) {
    return null;
  }
  return trimmed;
}

export function parseMaxUses(value: unknown): number | null {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_USES_LIMIT
  ) {
    return null;
  }
  return value;
}

export function parseBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function parseId(value: string): number | null {
  if (!/^[1-9]\d{0,15}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * Accepts an ISO/date-time string and normalizes it to UTC ISO. A null value
 * clears the expiry. Expiry must be in the future.
 */
export function parseExpiresAt(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 64) return undefined;

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  if (timestamp <= Date.now()) return undefined;

  return new Date(timestamp).toISOString();
}

export function requireBodyField(
  body: Record<string, unknown>,
  key: string,
): unknown {
  if (!(key in body)) {
    throw new ApiError(400, "INVALID_REQUEST");
  }
  return body[key];
}
