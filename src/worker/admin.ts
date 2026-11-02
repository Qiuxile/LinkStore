import { recordAudit } from "./audit";
import {
  bytesToBase64Url,
  sha256Hex,
  timingSafeEqual,
} from "./crypto";
import {
  ApiError,
  apiError,
  json,
  methodNotAllowed,
  readJsonBody,
} from "./http";
import {
  clearSessionCookie,
  readSession,
} from "./session";
import type {
  AdminConfigRow,
  Env,
  RedemptionCodeRow,
} from "./types";
import {
  normalizeCustomCode,
  normalizeTargetUrl,
  parseBoolean,
  parseExpiresAt,
  parseId,
  parseMaxUses,
} from "./validation";

interface SessionInfo {
  sessionVersion: number;
}

interface PublicCode {
  id: number;
  targetUrl: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  disabled: boolean;
}

interface InsertValues {
  codeHash: string;
  targetUrl: string;
  maxUses: number;
  expiresAt: string | null;
  createdAt: string;
}

function mapCode(row: RedemptionCodeRow): PublicCode {
  return {
    id: row.id,
    targetUrl: row.target_url,
    maxUses: row.max_uses,
    usedCount: row.used_count,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    disabled: row.disabled === 1,
  };
}

async function authenticateAdmin(
  request: Request,
  env: Env,
): Promise<SessionInfo | null> {
  const session = await readSession(request, env);
  if (!session) return null;

  const config = await env.DB.prepare(
    `SELECT admin_code_hash, session_version
     FROM admin_config
     WHERE id = 1`,
  ).first<AdminConfigRow>();
  if (!config || config.session_version !== session.v) return null;

  return { sessionVersion: config.session_version };
}

function unauthorized(): Response {
  return apiError(401, "UNAUTHORIZED", {
    "Set-Cookie": clearSessionCookie(),
  });
}

function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function authorizeWrite(
  request: Request,
  env: Env,
): Promise<Response | null> {
  if (!(await authenticateAdmin(request, env))) return unauthorized();
  if (!hasSameOrigin(request)) return apiError(403, "INVALID_ORIGIN");
  return null;
}

async function getCode(
  env: Env,
  id: number,
): Promise<RedemptionCodeRow | null> {
  return env.DB.prepare(
    `SELECT id, target_url, max_uses, used_count, expires_at,
            created_at, last_used_at, disabled
     FROM redemption_codes
     WHERE id = ?`,
  )
    .bind(id)
    .first<RedemptionCodeRow>();
}

function generateRedemptionCode(): string {
  const bytes = new Uint8Array(24); // 192 bits of entropy.
  crypto.getRandomValues(bytes);
  return `lsc_${bytesToBase64Url(bytes)}`;
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    error instanceof Error &&
    /unique constraint failed/i.test(error.message)
  );
}

async function listCodes(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  if (!(await authenticateAdmin(request, env))) return unauthorized();

  const requestedPage = Number(url.searchParams.get("page") ?? "1");
  const requestedSize = Number(url.searchParams.get("pageSize") ?? "50");
  const page =
    Number.isFinite(requestedPage) && requestedPage >= 1
      ? Math.floor(requestedPage)
      : 1;
  const pageSize =
    Number.isFinite(requestedSize) && requestedSize >= 1
      ? Math.min(100, Math.floor(requestedSize))
      : 50;
  const offset = (page - 1) * pageSize;

  const results = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, target_url, max_uses, used_count, expires_at,
              created_at, last_used_at, disabled
       FROM redemption_codes
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
    ).bind(pageSize, offset),
    env.DB.prepare("SELECT COUNT(*) AS total FROM redemption_codes"),
  ]);

  const rowsResult = results[0];
  const totalResult = results[1];
  if (!rowsResult || !totalResult) {
    throw new Error("D1 batch returned an unexpected result");
  }

  const rows = rowsResult.results as RedemptionCodeRow[];
  const totalRow = totalResult.results[0] as { total: number } | undefined;
  const total = Number(totalRow?.total ?? 0);

  return json({
    ok: true,
    items: rows.map(mapCode),
    pagination: { page, pageSize, total },
  });
}

async function createCode(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowed("GET, POST");
  }
  const authFailure = await authorizeWrite(request, env);
  if (authFailure) return authFailure;

  const body = await readJsonBody(request);
  const targetUrl = normalizeTargetUrl(body.targetUrl);
  if (!targetUrl) throw new ApiError(400, "INVALID_TARGET_URL");

  const maxUses = parseMaxUses(body.maxUses);
  if (maxUses === null) throw new ApiError(400, "INVALID_MAX_USES");

  let expiresAt: string | null = null;
  if ("expiresAt" in body) {
    const parsed = parseExpiresAt(body.expiresAt);
    if (parsed === undefined) throw new ApiError(400, "INVALID_EXPIRY");
    expiresAt = parsed;
  }

  let customCode: string | null = null;
  if (
    body.code !== undefined &&
    body.code !== null &&
    body.code !== ""
  ) {
    customCode = normalizeCustomCode(body.code);
    if (!customCode) throw new ApiError(400, "INVALID_CODE_FORMAT");
  }

  if (customCode) {
    const config = await env.DB.prepare(
      "SELECT admin_code_hash, session_version FROM admin_config WHERE id = 1",
    ).first<AdminConfigRow>();
    if (
      config &&
      timingSafeEqual(config.admin_code_hash, await sha256Hex(customCode))
    ) {
      throw new ApiError(400, "CODE_RESERVED");
    }
  }

  let plaintext = customCode ?? generateRedemptionCode();
  let createdId: number | null = null;
  const createdAt = new Date().toISOString();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const values: InsertValues = {
      codeHash: await sha256Hex(plaintext),
      targetUrl,
      maxUses,
      expiresAt,
      createdAt,
    };

    try {
      const result = await env.DB.prepare(
        `INSERT INTO redemption_codes
           (code_hash, target_url, max_uses, used_count, expires_at,
            created_at, last_used_at, disabled)
         VALUES (?, ?, ?, 0, ?, ?, NULL, 0)`,
      )
        .bind(
          values.codeHash,
          values.targetUrl,
          values.maxUses,
          values.expiresAt,
          values.createdAt,
        )
        .run();

      const id = Number(result.meta.last_row_id);
      if (!Number.isSafeInteger(id) || id < 1) {
        throw new Error("D1 did not return a valid row id");
      }
      createdId = id;
      break;
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
      if (customCode) throw new ApiError(409, "CODE_EXISTS");
      plaintext = generateRedemptionCode();
    }
  }

  if (createdId === null) {
    throw new ApiError(500, "CODE_GENERATION_FAILED");
  }

  const item: PublicCode = {
    id: createdId,
    targetUrl,
    maxUses,
    usedCount: 0,
    expiresAt,
    createdAt,
    lastUsedAt: null,
    disabled: false,
  };

  await recordAudit(
    env,
    request,
    "code_create",
    `code_id=${createdId};max_uses=${maxUses}`,
  );

  return json({ ok: true, code: plaintext, item }, 201);
}

async function updateCode(
  request: Request,
  env: Env,
  id: number,
): Promise<Response> {
  if (request.method !== "PATCH") {
    return methodNotAllowed("PATCH, DELETE");
  }
  const authFailure = await authorizeWrite(request, env);
  if (authFailure) return authFailure;

  const body = await readJsonBody(request);
  const assignments: string[] = [];
  const values: (string | number | null)[] = [];
  let maxUses: number | undefined;

  if ("targetUrl" in body) {
    const targetUrl = normalizeTargetUrl(body.targetUrl);
    if (!targetUrl) throw new ApiError(400, "INVALID_TARGET_URL");
    assignments.push("target_url = ?");
    values.push(targetUrl);
  }

  if ("maxUses" in body) {
    const parsed = parseMaxUses(body.maxUses);
    if (parsed === null) throw new ApiError(400, "INVALID_MAX_USES");
    maxUses = parsed;
    assignments.push("max_uses = ?");
    values.push(parsed);
  }

  if ("expiresAt" in body) {
    const parsed = parseExpiresAt(body.expiresAt);
    if (parsed === undefined) throw new ApiError(400, "INVALID_EXPIRY");
    assignments.push("expires_at = ?");
    values.push(parsed);
  }

  if ("disabled" in body) {
    const parsed = parseBoolean(body.disabled);
    if (parsed === null) throw new ApiError(400, "INVALID_DISABLED");
    assignments.push("disabled = ?");
    values.push(parsed ? 1 : 0);
  }

  if (assignments.length === 0) {
    throw new ApiError(400, "NO_FIELDS");
  }

  values.push(id);
  let sql = `UPDATE redemption_codes
             SET ${assignments.join(", ")}
             WHERE id = ?`;
  if (maxUses !== undefined) {
    // Prevent lowering max_uses below the already consumed count, even while
    // a concurrent redemption is in flight.
    sql += " AND used_count <= ?";
    values.push(maxUses);
  }

  const result = await env.DB.prepare(sql).bind(...values).run();
  if (result.meta.changes !== 1) {
    const current = await getCode(env, id);
    if (!current) return apiError(404, "CODE_NOT_FOUND");
    if (maxUses !== undefined && current.used_count > maxUses) {
      return apiError(409, "MAX_USES_BELOW_USED");
    }
    return apiError(409, "CODE_UPDATE_CONFLICT");
  }

  const updated = await getCode(env, id);
  if (!updated) return apiError(404, "CODE_NOT_FOUND");

  await recordAudit(
    env,
    request,
    "code_update",
    `code_id=${id};fields=${assignments
      .map((assignment) => assignment.split(" = ")[0])
      .join(",")}`,
  );

  return json({ ok: true, item: mapCode(updated) });
}

async function deleteCode(
  request: Request,
  env: Env,
  id: number,
): Promise<Response> {
  if (request.method !== "DELETE") {
    return methodNotAllowed("PATCH, DELETE");
  }
  const authFailure = await authorizeWrite(request, env);
  if (authFailure) return authFailure;

  const result = await env.DB.prepare(
    "DELETE FROM redemption_codes WHERE id = ?",
  )
    .bind(id)
    .run();

  if (result.meta.changes !== 1) return apiError(404, "CODE_NOT_FOUND");

  await recordAudit(env, request, "code_delete", `code_id=${id}`);
  return json({ ok: true, id });
}

async function logout(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (!(await authenticateAdmin(request, env))) return unauthorized();
  if (!hasSameOrigin(request)) return apiError(403, "INVALID_ORIGIN");

  const response = json(
    { ok: true },
    200,
    { "Set-Cookie": clearSessionCookie() },
  );
  await recordAudit(env, request, "admin_logout");
  return response;
}

export async function handleAdmin(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const url = new URL(request.url);

  if (path === "/api/admin/session") {
    if (request.method !== "GET") return methodNotAllowed("GET");
    if (!(await authenticateAdmin(request, env))) return unauthorized();
    return json({ ok: true });
  }

  if (path === "/api/admin/logout") {
    return logout(request, env);
  }

  if (path === "/api/admin/codes") {
    if (request.method === "GET") return listCodes(request, env, url);
    if (request.method === "POST") return createCode(request, env);
    return methodNotAllowed("GET, POST");
  }

  const match = /^\/api\/admin\/codes\/([^/]+)$/.exec(path);
  if (!match) return apiError(404, "NOT_FOUND");

  const id = parseId(match[1] ?? "");
  if (id === null) return apiError(404, "NOT_FOUND");

  if (request.method === "PATCH") {
    return updateCode(request, env, id);
  }
  if (request.method === "DELETE") {
    return deleteCode(request, env, id);
  }
  return methodNotAllowed("PATCH, DELETE");
}
