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
// STATUS (go-live audit): the proxy route now EXISTS at
// frontend-web/app/api/v1/marketplace/[...path]/route.ts — it forwards every
// /api/v1/marketplace/* call to the Go backend's /v1/marketplace group. Live
// calls below therefore resolve once EXPO_PUBLIC_MARKETPLACE_USE_MOCK=false;
// mock stays the default so the group is demoable/offline out of the box.
// Money POSTs attach an Idempotency-Key.

import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';

/** Base path on the frontend-web proxy. Proxy → Go /v1/marketplace/* (route lives at
 *  frontend-web/app/api/v1/marketplace/[...path]/route.ts). */
export const MKT_BASE = '/api/v1/marketplace';

/**
 * Mock switch. Default TRUE so the whole Discover group is demoable/offline
 * without a live backend. Set EXPO_PUBLIC_MARKETPLACE_USE_MOCK=false to hit the
 * real proxy. Case-insensitive: only the literal 'false' turns mocks off.
 */
export const MKT_USE_MOCK =
  mockAllowed(process.env.EXPO_PUBLIC_MARKETPLACE_USE_MOCK, true);

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

// ─── Retry policy ────────────────────────────────────────────────────────────
//
// The app-wide default (app/_layout.tsx) retries a failed query exactly ONCE,
// one second after the first attempt. That absorbs a blip between two healthy
// requests and not a backend that is still coming up: the staging gateway
// answers 502/503 from the edge while its container boots, so both attempts land
// inside the same outage and the query settles into its error state. Nothing
// re-runs it afterwards — nothing dropped the connection, so there is no
// reconnect to refetch on — and the screen shows "check your connection" until
// the user taps Retry by hand.
//
// Marketplace reads therefore keep trying while the failure looks transient and
// give up immediately on everything a retry cannot fix (401, 404, the rest of
// the 4xx range).
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/** HTTP status from either a raw axios rejection or a normalized MktApiError. */
function statusOf(error: unknown): number | undefined {
  const e = error as { status?: unknown; response?: { status?: unknown } } | null | undefined;
  const status = e?.status ?? e?.response?.status;
  return typeof status === 'number' ? status : undefined;
}

/** True when the failure is worth another attempt. */
export function isTransientMktFailure(error: unknown): boolean {
  const status = statusOf(error);
  // No status at all is a DNS failure, a reset connection or a client timeout.
  return status === undefined || RETRYABLE_STATUSES.has(status);
}

/** `retry` for marketplace queries: 3 retries on top of the first attempt. */
export function mktRetry(failureCount: number, error: unknown): boolean {
  return isTransientMktFailure(error) && failureCount < 3;
}

// ─── Response envelope unwrap ────────────────────────────────────────────────
// House convention: handlers may reply { data: <payload> } or the bare payload.
// Unwrap by KEY PRESENCE (not nullishness): if the body carries a `data` key we
// return its value even when null — so an empty result serialized as
// { data: null } yields null, never the wrapper object (which would break Array
// ops downstream). Then deep-camel the result. Mirrors fx.api.ts's unwrap().
function unwrap<T>(res: { data?: unknown }): T {
  const body = res.data as { data?: unknown } | unknown;
  const payload =
    isPlainObject(body) && 'data' in (body as Record<string, unknown>)
      ? (body as { data: unknown }).data
      : body;
  return deepCamel<T>(payload);
}

// Coerce a list payload to an array — a live empty result may arrive as null.
// Wrap every list projection with this so screens always receive an array.
export function arr<T>(v: T[] | null | undefined): T[] {
  return Array.isArray(v) ? v : [];
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
