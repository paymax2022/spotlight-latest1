// ── Registration module — runtime MOCK ↔ LIVE switch ─────────────────────────
// Thin helpers shared by registration.api.ts. Mirrors invest.client.ts.
//
//   - MOCK: resolves local demo data so the app runs with no backend.
//   - LIVE (default): calls the Next.js web app under /api/registration using
//     the shared authenticated `api` axios instance (Bearer token from
//     Supabase + 401). The Next.js side (src/server/registration/store.ts) is
//     a fully real implementation — contests, drafts, step validation, fraud
//     checks, submit, uploads (real R2), and registration-fee payment via the
//     real Paystack gateway (currently test-mode keys).
//
// Defaults to LIVE because payment cannot be mocked: the draft/application a
// payment attaches to has to exist in the SAME store the payment routes read
// from (`getRegistrationDraft`). A client-only mock draft (id `mock-<ts>`)
// isn't visible to the Next.js server at all, so a "real" payment against a
// mock draft always 404s — there is no coherent way to keep the rest of this
// module mocked while making only payment real. Set
// EXPO_PUBLIC_REGISTRATION_USE_MOCK=true to force the old fully-offline mock
// mode back on (no backend required, but payment will not actually charge
// anything — useful for pure UI iteration only).
//
// NOTE: registration endpoints live on the Next.js server (NOT the Go /api/v1),
// so paths are passed through unprefixed (e.g. '/api/registration/contests').

import { mockAllowed } from '@/config/mockPolicy';
import { Platform } from 'react-native';
import { api } from '@/api/client';
import { createSupabaseClient } from '@/lib/supabase';

export const REGISTRATION_USE_MOCK =
  mockAllowed(process.env.EXPO_PUBLIC_REGISTRATION_USE_MOCK, false);

// Mock-latency helper so loading states render in mock mode.
export const waitMock = <T>(value: T, ms = 320): Promise<T> =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

// Next.js successResponse returns the payload bare ({ success, ...fields }),
// so callers consume res.data directly.
export async function regGet<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const res = await api.get(path, { params });
  return res.data as T;
}

export async function regPost<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await api.post(path, body ?? {}, headers ? { headers } : undefined);
  return res.data as T;
}

// Mirrors `newIdempotencyKey` in src/features/health/pharmacy/cartStore.ts —
// one key per logical user action (e.g. a single "Pay" tap), threaded through
// as the Idempotency-Key header so a retried/double-submitted request can't
// open two Paystack transactions for the same registration fee.
export function newRegistrationIdempotencyKey(prefix = 'reg'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function regPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await api.patch(path, body ?? {});
  return res.data as T;
}

// Multipart upload for `file` fields. RN FormData accepts a { uri, name, type }
// blob descriptor; axios sets the multipart boundary when given a FormData body.
export async function regUpload<T>(
  path: string,
  file: { uri: string; name: string; mimeType: string },
): Promise<T> {
  const form = new FormData();

  if (Platform.OS === 'web') {
    // On web (Expo web / browser) React Native's { uri, name, type } descriptor is
    // NOT a real file — FormData stringifies it to "[object Object]", so the server
    // reads no file ("file is required"). Fetch the picked uri into a real Blob and
    // append it as a named file part.
    const blob = await (await fetch(file.uri)).blob();
    // Append as a named file part. RN's FormData type only declares append(name,
    // value), but on web the DOM FormData supports the (name, blob, filename)
    // overload — so the server receives a real File named `file.name`.
    (form.append as (name: string, value: Blob, filename?: string) => void)(
      'file',
      blob,
      file.name,
    );

    // IMPORTANT: do NOT send this through the shared axios instance. That instance
    // sets a default `Content-Type: application/json`, and axios only auto-strips
    // it for FormData in a "standard browser" env. Under React Native (incl. Expo
    // web) axios sees navigator.product === 'ReactNative' and keeps the JSON
    // Content-Type, so the multipart body arrives mislabeled and the server's
    // request.formData() rejects it ("Content-Type was not one of
    // multipart/form-data…"). Using the browser's own fetch (with no Content-Type
    // header) lets it set 'multipart/form-data; boundary=…' correctly. We attach
    // the same Supabase bearer token the axios interceptor would.
    let authHeaders: Record<string, string> = {};
    try {
      const supabase = createSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) authHeaders = { Authorization: `Bearer ${session.access_token}` };
    } catch { /* proceed unauthenticated — server will 401 */ }

    const base = String(api.defaults.baseURL ?? '').replace(/\/$/, '');
    const url = /^https?:\/\//i.test(path) ? path : `${base}${path}`;
    const res = await fetch(url, { method: 'POST', headers: authHeaders, body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || (data && data.success === false)) {
      throw new Error((data && data.error) || `Upload failed (${res.status})`);
    }
    return data as T;
  }

  // Native: RN's FormData accepts the { uri, name, type } blob descriptor and adds
  // the multipart boundary itself. Cast through unknown for TS.
  form.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.mimeType,
  } as unknown as Blob);
  const res = await api.post(path, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data as T;
}
