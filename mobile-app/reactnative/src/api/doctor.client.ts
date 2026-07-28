// ── Doctor module — runtime SANDBOX ↔ PRODUCTION switch ──────────────────────
// Central config + thin live-HTTP helpers shared by every `doctor.*.api.ts`.
//
// Each doctor api function branches on `DOCTOR_USE_MOCK`:
//   - MOCK (default): resolves the existing DEMO_* data via `wait()` so the app
//     runs with no backend.
//   - LIVE: calls the real backend under `DOCTOR_API_PREFIX` using the shared
//     authenticated `api` axios instance (Bearer token + 401 handling).
//
// Flip to live by setting `EXPO_PUBLIC_DOCTOR_USE_MOCK=false`. See
// `docs/DOCTOR_GO_LIVE.md` and `docs/DOCTOR_ENDPOINT_INVENTORY.md`.

import { api } from '@/api/client';

// Default MOCK: unset / anything-but-'false' => mock, so the app still runs
// with no backend. Only the exact string 'false' switches to the live backend.
export const DOCTOR_USE_MOCK = (process.env.EXPO_PUBLIC_DOCTOR_USE_MOCK ?? 'true') !== 'false';

// All live doctor endpoints live under this prefix on the API base URL.
export const DOCTOR_API_PREFIX = '/api/v1/doctor';

// Canonical mock-latency helper. Existing files keep their local `wait`; this is
// exported so new/converging code can import a single source of truth.
export const waitMock = <T>(value: T, ms = 350): Promise<T> =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

// Response envelope: the backend may wrap payloads as `{ data: <payload> }` or
// return the payload directly. Both are accepted (`res.data.data ?? res.data`).
function unwrap<T>(res: { data?: unknown }): T {
  const body = res.data as { data?: unknown } | undefined;
  return ((body && typeof body === 'object' && 'data' in body ? body.data : body) ?? body) as T;
}

function idempotencyHeaders(idempotencyKey?: string): Record<string, string> | undefined {
  return idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined;
}

export async function doctorGet<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const res = await api.get(DOCTOR_API_PREFIX + path, { params });
  return unwrap<T>(res);
}

export async function doctorPost<T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const res = await api.post(DOCTOR_API_PREFIX + path, body, { headers: idempotencyHeaders(idempotencyKey) });
  return unwrap<T>(res);
}

export async function doctorPut<T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const res = await api.put(DOCTOR_API_PREFIX + path, body, { headers: idempotencyHeaders(idempotencyKey) });
  return unwrap<T>(res);
}

export async function doctorPatch<T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const res = await api.patch(DOCTOR_API_PREFIX + path, body, { headers: idempotencyHeaders(idempotencyKey) });
  return unwrap<T>(res);
}

export async function doctorDelete<T>(path: string, idempotencyKey?: string): Promise<T> {
  const res = await api.delete(DOCTOR_API_PREFIX + path, { headers: idempotencyHeaders(idempotencyKey) });
  return unwrap<T>(res);
}
