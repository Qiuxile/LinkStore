export interface AdminCode {
  id: number;
  targetUrl: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  disabled: boolean;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
}

export interface RedeemSuccess {
  ok: true;
  type: "admin" | "redirect";
  redirectTo?: string;
  targetUrl?: string;
}

export interface CodesResponse {
  ok: true;
  items: AdminCode[];
  pagination: Pagination;
}

export interface CreateCodeResponse {
  ok: true;
  code: string;
  item: AdminCode;
}

export interface CodeResponse {
  ok: true;
  item: AdminCode;
}

export interface CreateCodePayload {
  targetUrl: string;
  maxUses: number;
  expiresAt: string | null;
  code?: string;
}

export interface UpdateCodePayload {
  targetUrl?: string;
  maxUses?: number;
  expiresAt?: string | null;
  disabled?: boolean;
}

export interface CodeFormValues {
  targetUrl: string;
  maxUses: number;
  expiresAt: string | null;
  disabled: boolean;
  code?: string;
}
