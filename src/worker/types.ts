/** Bindings available to the Worker. */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SESSION_SECRET: string;
  SESSION_TTL_SECONDS?: string;
  REDEEM_RATE_LIMITER?: RateLimitBinding;
}

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface AdminConfigRow {
  admin_code_hash: string;
  session_version: number;
}

export interface RedemptionCodeRow {
  id: number;
  target_url: string;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  created_at: string;
  last_used_at: string | null;
  disabled: number;
}
