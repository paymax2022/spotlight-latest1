// ── Invest module — runtime MOCK ↔ LIVE switch ───────────────────────────────
// Thin helpers shared by invest.api.ts. Mirrors doctor.client.ts.
//
//   - MOCK (default): resolves local demo data so the app runs with no backend.
//   - LIVE: calls the Go backend under /api/v1 using the shared authenticated
//     `api` axios instance (Bearer token from Supabase + 401 handling).
//
// Flip to live with EXPO_PUBLIC_INVEST_USE_MOCK=false (requires the backend
// running with FEATURE_INVEST_ENABLED=true).

import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';

export const INVEST_USE_MOCK =
  mockAllowed(process.env.EXPO_PUBLIC_INVEST_USE_MOCK, true);

// Mock-latency helper so loading states render in mock mode.
export const waitMock = <T>(value: T, ms = 320): Promise<T> =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

// The backend wraps list payloads as { data: [...] } and returns objects bare.
function unwrap<T>(res: { data?: unknown }): T {
  const body = res.data as { data?: unknown } | undefined;
  return ((body && typeof body === 'object' && 'data' in body ? body.data : body) ?? body) as T;
}

function idemHeaders(key?: string): Record<string, string> | undefined {
  return key ? { 'Idempotency-Key': key } : undefined;
}

export async function investGet<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const res = await api.get('/api/v1' + path, { params });
  return unwrap<T>(res);
}

export async function investPost<T>(
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const res = await api.post('/api/v1' + path, body ?? {}, { headers: idemHeaders(idempotencyKey) });
  return unwrap<T>(res);
}

export async function investPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await api.patch('/api/v1' + path, body ?? {});
  return unwrap<T>(res);
}

export async function investDelete<T>(path: string): Promise<T> {
  const res = await api.delete('/api/v1' + path);
  return unwrap<T>(res);
}
