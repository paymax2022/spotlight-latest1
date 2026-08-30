// ── Association — Organisation logo upload (presigned R2) ─────────────────────
//
// Two steps, because the binary never travels through our API:
//
//   1. Ask the backend for a short-lived presigned PUT URL. It chooses the
//      object key — the client cannot pick where the file lands.
//   2. PUT the image straight to R2 with the exact Content-Type the backend
//      bound into the signature.
//
// The caller then submits the returned objectKey as the draft's logoUri. The
// backend stores it in logo_url and signs it back into a viewable URL on every
// read, because the bucket is not public.
//
// Before this existed the wizard stored the image picker's local file:// URI, so
// an uploaded logo rendered on the founder's own phone and nowhere else.

import { api } from '@/api/client';
import { USE_MOCK, ASSOCIATION_API_BASE as BASE } from '../constants/association.constants';

export interface LogoPresign {
  uploadUrl: string;
  objectKey: string;
  contentType: string;
  expiresIn: number;
  method: string;
}

/** Content types the backend will sign for. Keep in step with presign.go. */
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

/**
 * Guess the content type from a file name. The backend rejects anything it does
 * not recognise, so an unknown extension is passed through as-is and refused
 * there rather than being silently coerced to something that would upload a
 * mislabelled file.
 */
export function contentTypeForFile(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPE_BY_EXT[ext] ?? `image/${ext || 'unknown'}`;
}

/** Ask the backend to mint a presigned PUT URL for a logo. */
export async function presignLogoUpload(fileName: string, contentType: string): Promise<LogoPresign> {
  const res = await api.post(`${BASE}/uploads/logo/presign`, { fileName, contentType });
  return (res.data?.data ?? res.data) as LogoPresign;
}

/**
 * Upload a picked image and return the object key to store as the logo.
 *
 * The PUT goes to R2 directly with `fetch`, NOT through the app's axios client:
 * that client attaches the user's Supabase bearer token to every request, and
 * sending it to a third-party host would leak the session. The presigned URL
 * carries its own authorisation in the query string and needs nothing else.
 */
export async function uploadLogo(localUri: string, fileName: string): Promise<string> {
  if (USE_MOCK) {
    // Mock mode has no R2; hand back a key-shaped value so the rest of the
    // wizard behaves exactly as it does live.
    return `association/logo/mock/${Date.now()}-${fileName}`;
  }

  const contentType = contentTypeForFile(fileName);
  const presigned = await presignLogoUpload(fileName, contentType);

  // React Native's fetch can PUT a blob read from the local file URI.
  const fileRes = await fetch(localUri);
  const blob = await fileRes.blob();

  const put = await fetch(presigned.uploadUrl, {
    method: 'PUT',
    // The signature covers this header — a different value fails with 403.
    headers: { 'Content-Type': presigned.contentType },
    body: blob,
  });
  if (!put.ok) {
    throw new Error(`Logo upload failed (${put.status})`);
  }
  return presigned.objectKey;
}
