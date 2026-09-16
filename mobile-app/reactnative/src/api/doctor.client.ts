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

import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';

// Default MOCK: unset / anything-but-'false' => mock, so the app still runs
// with no backend. Only the exact string 'false' switches to the live backend.
export const DOCTOR_USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_DOCTOR_USE_MOCK, true);

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

// ── File uploads (presigned R2) ──────────────────────────────────────────────
// Mirrors the marketplace module's working upload flow (sell.api.ts
// uploadListingImage): presign, then PUT the binary straight to R2 — the
// backend never sees the bytes. Every doctor upload screen (profile photo,
// documents, vet licence renewal, chat attachments, dispute evidence) used to
// fake a local file URI and post it directly to the metadata-recording
// endpoint with the wrong field names, so nothing ever reached storage and the
// request always failed. `backend/internal/doctor/presign.go` already
// implements the real presign endpoint for exactly these five kinds; this was
// simply never called from the client.
//
// The returned value is the R2 OBJECT KEY, never a public URL — same as
// marketplace's `fileUrl`. The bucket is private; a caller displays the file
// later via a presigned GET, not by treating this as a servable link.
export type DoctorUploadKind = 'profile_photo' | 'document' | 'licence' | 'chat_attachment' | 'dispute_evidence';

interface DoctorPresignResponse {
  uploadUrl:   string;
  objectKey:   string;
  bucket:      string;
  contentType: string;
  expiresIn:   number;
  method:      string;
}

export async function doctorUploadFile(
  kind: DoctorUploadKind,
  file: { uri: string; fileName: string; mimeType: string },
): Promise<string> {
  const presign = await doctorPost<DoctorPresignResponse>('/uploads/presign', {
    kind,
    fileName: file.fileName,
    contentType: file.mimeType,
  });
  const blob = await (await fetch(file.uri)).blob();
  const res = await fetch(presign.uploadUrl, {
    method: 'PUT',
    body: blob,
    headers: { 'Content-Type': presign.contentType },
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return presign.objectKey;
}
