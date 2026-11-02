import type {
  CodeResponse,
  CodesResponse,
  CreateCodePayload,
  CreateCodeResponse,
  RedeemSuccess,
  UpdateCodePayload,
} from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR");
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Keep the status code; responses without JSON are treated as failures.
  }

  if (!response.ok) {
    const code =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : "REQUEST_FAILED";
    throw new ApiError(response.status, code);
  }

  if (!isRecord(payload)) throw new ApiError(500, "INVALID_RESPONSE");
  return payload as T;
}

export function redeem(code: string): Promise<RedeemSuccess> {
  return request<RedeemSuccess>("/api/redeem", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function getSession(): Promise<void> {
  await request<{ ok: true }>("/api/admin/session");
}

export async function logout(): Promise<void> {
  await request<{ ok: true }>("/api/admin/logout", { method: "POST" });
}

export function getCodes(
  page: number,
  pageSize = 20,
): Promise<CodesResponse> {
  return request<CodesResponse>(
    `/api/admin/codes?page=${page}&pageSize=${pageSize}`,
  );
}

export function createCode(
  payload: CreateCodePayload,
): Promise<CreateCodeResponse> {
  return request<CreateCodeResponse>("/api/admin/codes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateCode(
  id: number,
  payload: UpdateCodePayload,
): Promise<CodeResponse> {
  return request<CodeResponse>(`/api/admin/codes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteCode(id: number): Promise<{ ok: true; id: number }> {
  return request<{ ok: true; id: number }>(`/api/admin/codes/${id}`, {
    method: "DELETE",
  });
}
