import { getClientIp } from "./http";
import type { Env } from "./types";

const AUDIT_RETENTION = 1000;

export type AuditEvent =
  | "admin_login"
  | "admin_logout"
  | "admin_write_failed"
  | "code_create"
  | "code_update"
  | "code_delete";

/**
 * Best-effort audit. Auditing must not make an already-committed business
 * operation appear to fail, so errors are logged without request data.
 */
export async function recordAudit(
  env: Env,
  request: Request,
  event: AuditEvent,
  detail?: string,
): Promise<void> {
  const userAgent = (request.headers.get("User-Agent") ?? "unknown").slice(
    0,
    512,
  );
  const safeDetail = detail?.slice(0, 500) ?? null;

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO audit_logs (event_type, ip, user_agent, detail, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(
        event,
        getClientIp(request),
        userAgent,
        safeDetail,
        new Date().toISOString(),
      ),
      env.DB.prepare(
        `DELETE FROM audit_logs
         WHERE id NOT IN (
           SELECT id FROM audit_logs ORDER BY id DESC LIMIT ?
         )`,
      ).bind(AUDIT_RETENTION),
    ]);
  } catch {
    console.error("audit_write_failed", event);
  }
}
