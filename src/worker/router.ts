import { ApiError, apiError } from "./http";
import { handleAdmin } from "./admin";
import { handleRedeem } from "./redeem";
import type { Env } from "./types";

function normalizePath(pathname: string): string {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "") || "/";
}

export async function handleApi(
  request: Request,
  env: Env,
): Promise<Response> {
  const { pathname } = new URL(request.url);
  const path = normalizePath(pathname);

  try {
    if (path === "/api/redeem") return await handleRedeem(request, env);
    if (path === "/api/admin" || path.startsWith("/api/admin/")) {
      return await handleAdmin(request, env, path);
    }
    return apiError(404, "NOT_FOUND");
  } catch (error) {
    if (error instanceof ApiError) {
      return apiError(error.status, error.code);
    }
    // Never log request bodies, submitted codes or secrets.
    console.error(
      "api_error",
      error instanceof Error ? error.message : "unknown error",
    );
    return apiError(500, "INTERNAL_ERROR");
  }
}
