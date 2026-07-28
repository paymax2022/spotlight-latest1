// ── Paymax Marketplace — shared HTTP client ──────────────────────────────────
//
// THE single fix for the snake_case (backend) ↔ camelCase (screens) mismatch.
// The Go marketplace module returns snake_case JSON (market_id, price_kobo,
// escrow_eligible, amount_kobo, created_at, …) and binds snake_case request
// bodies. Every screen and every sibling domain agent talks camelCase. This
// module normalizes in ONE place:
//
//   • ALL responses  → deepCamel()  (recursive snake_case → camelCase)
//   • ALL request bodies → deepSnake() (recursive camelCase → snake_case)
//
// so nobody downstream re-implements the conversion. Import mktGet/mktPost/… and
// the returned data is already camelCase and type-safe against ../types.
//
// Transport: the shared axios instance `@/api/client` (baseURL → frontend-web),
// which forwards the Supabase Bearer. BASE = '/api/v1/marketplace' — INTENDED
// to hit a Next.js catch-all proxy (frontend-web/app/api/v1/marketplace/
// [...path]/route.ts) that forwards to the Go backend's r.Group("/v1/marketplace")
// (confirmed in backend/internal/app/marketplace_routes.go — mounted directly on
// the gin engine, NOT under /api/finance, so the blanket /api/finance/:path*
// rewrite in frontend-web/next.config.mjs does not cover it either).
//
// STATUS (go-live audit): that proxy route file does NOT exist yet in
// frontend-web/app/api/v1/ — grepped the repo, only frontend-web/app/api/v1/
// estate/admin/summary/route.ts exists under app/api/v1. Until the proxy (or a
// rewrite for /api/v1/marketplace/:path* → GO_BACKEND_URL/v1/marketplace/:path*)
// is added, every live call below 404s. This file is out of the mobile-only
// go-live cluster's edit boundary (frontend-web is owned by a different
// agent/cluster) — flagged here as a MISSING backend-proxy endpoint.
// Money POSTs attach an Idempotency-Key.

import { api } from '@/api/client';

/** Base path on the frontend-web proxy. Proxy → Go /v1/marketplace/* (proxy route missing — see note above). */
export const MKT_BASE = '/api/v1/marketplace';

/**
 * Mock switch. Default TRUE so the whole Discover group is demoable/offline
 * without a live backend. Set EXPO_PUBLIC_MARKETPLACE_USE_MOCK=false to hit the
 * real proxy. Case-insensitive: only the literal 'false' turns mocks off.
 */
export const MKT_USE_MOCK =
  (process.env.EXPO_PUBLIC_MARKETPLACE_USE_MOCK ?? 'true').toLowerCase() !== 'false';

// ─── Case conversion helpers ─────────────────────────────────────────────────

const snakeToCamel = (s: string): string =>
  s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

const camelToSnake = (s: string): string =>
  s.replace(/([A-Z])/g, (m) => '_' + m.toLowerCase());

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && (v as object).constructor === Object;
}

/**
 * Deep snake_case → camelCase over any JSON value. Recurses into objects and
 * arrays; leaves primitives (and non-plain objects like Date, if any) untouched.
 * Applied to EVERY backend response so screens only ever see camelCase.
 */
export function deepCamel<T = unknown>(input: unknown): T {
  if (Array.isArray(input)) return input.map((v) => deepCamel(v)) as unknown as T;
  if (isPlainObject(input)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input)) {
      out[snakeToCamel(key)] = deepCamel(input[key]);
    }
    return out as T;
  }
  return input as T;
}

/**
 * Deep camelCase → snake_case over any JSON value. Applied to EVERY request body
 * before it leaves the client, because the Go marketplace handlers bind
 * snake_case DTOs (CreateOrderInput.delivery_option, FundInput.payment_method …).
 */
export function deepSnake<T = unknown>(input: unknown): T {
  if (Array.isArray(input)) return input.map((v) => deepSnake(v)) as unknown as T;
  if (isPlainObject(input)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input)) {
      out[camelToSnake(key)] = deepSnake(input[key]);
    }
    return out as T;
  }
  return input as T;
}

// ─── Error normalization ─────────────────────────────────────────────────────

/** Uniform backend error envelope: { error: { code, message, field, request_id } }. */
export interface MktApiErrorBody {
  code: string;
  message: string;
  field: string | null;
  requestId: string;
}

export class MktApiError extends Error {
  code: string;
  field: string | null;
  requestId: string;
  status?: number;
  /** true when this was a 409 idempotency replay (safe: the original response is echoed). */
  isIdempotentReplay: boolean;
  /** the original success payload when isIdempotentReplay (already camelCased). */
  replayBody?: unknown;

  constructor(body: MktApiErrorBody, status?: number, isIdempotentReplay = false, replayBody?: unknown) {
    super(body.message || body.code || 'Something went wrong');
    this.name = 'MktApiError';
    this.code = body.code;
    this.field = body.field ?? null;
    this.requestId = body.requestId;
    this.status = status;
    this.isIdempotentReplay = isIdempotentReplay;
    this.replayBody = replayBody;
  }

  /** GET /search returns 501 SEARCH_NOT_WIRED until Elasticsearch is configured. */
  get isSearchNotWired(): boolean {
    return this.status === 501 || this.code === 'SEARCH_NOT_WIRED';
  }
}

function toMktError(err: unknown): MktApiError {
  const anyErr = err as {
    response?: { status?: number; data?: { error?: Partial<MktApiErrorBody & { request_id?: string }> } };
    message?: string;
  };
  const status = anyErr?.response?.status;
  const raw = anyErr?.response?.data?.error;
  if (raw) {
    const body: MktApiErrorBody = {
      code: raw.code ?? 'UNKNOWN',
      message: raw.message ?? 'Something went wrong',
      field: raw.field ?? null,
      // backend sends request_id (snake); accept either.
      requestId: raw.requestId ?? raw.request_id ?? '',
    };
    const replay = status === 409 && body.code === 'IDEMPOTENCY_KEY_REPLAY';
    return new MktApiError(body, status, replay, replay ? deepCamel(anyErr.response?.data) : undefined);
  }
  return new MktApiError(
    { code: 'NETWORK_ERROR', message: anyErr?.message || 'Network error — check your connection.', field: null, requestId: '' },
    status,
  );
}

// ─── Response envelope unwrap ────────────────────────────────────────────────
// House convention: handlers may reply { data: <payload> } or the bare payload.
// Unwrap the { data } wrapper, then deep-camel the result.
function unwrap<T>(res: { data?: unknown }): T {
  const body = res.data as { data?: unknown } | unknown;
  const payload =
    isPlainObject(body) && 'data' in (body as Record<string, unknown>)
      ? (body as { data: unknown }).data
      : body;
  return deepCamel<T>(payload);
}

// ─── Verbs ───────────────────────────────────────────────────────────────────

/** GET with camelCase params → snake_case query, camelCase response. */
export async function mktGet<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  try {
    const res = await api.get(`${MKT_BASE}${path}`, {
      params: params ? deepSnake<Record<string, unknown>>(params) : undefined,
    });
    return unwrap<T>(res);
  } catch (e) {
    throw toMktError(e);
  }
}

/** POST — request body camel→snake, response snake→camel. Attaches Idempotency-Key when given. */
export async function mktPost<T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  try {
    const res = await api.post(`${MKT_BASE}${path}`, body === undefined ? undefined : deepSnake(body), {
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    });
    return unwrap<T>(res);
  } catch (e) {
    throw toMktError(e);
  }
}

export async function mktPut<T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  try {
    const res = await api.put(`${MKT_BASE}${path}`, body === undefined ? undefined : deepSnake(body), {
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
    });
    return unwrap<T>(res);
  } catch (e) {
    throw toMktError(e);
  }
}

export async function mktPatch<T>(path: string, body?: unknown): Promise<T> {
  try {
    const res = await api.patch(`${MKT_BASE}${path}`, body === undefined ? undefined : deepSnake(body));
    return unwrap<T>(res);
  } catch (e) {
    throw toMktError(e);
  }
}

export async function mktDelete<T>(path: string): Promise<T> {
  try {
    const res = await api.delete(`${MKT_BASE}${path}`);
    return unwrap<T>(res);
  } catch (e) {
    throw toMktError(e);
  }
}

// ─── Idempotency key minting ─────────────────────────────────────────────────

/**
 * Mints a fresh opaque idempotency token (the server treats it as an opaque
 * string). For money POSTs that must survive an app-kill + retry, PERSIST the
 * returned key (e.g. SecureStore keyed by `order:{listingId}`) and reuse it on
 * retry — see the Transact agent's order/fund flow.
 */
export function newMktIdempotencyKey(): string {
  return 'mkt-xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
