// Connect profile photo upload — two steps, because the bytes never travel
// through our API:
//   1. Ask the backend for a short-lived presigned PUT (it picks the object key).
//   2. PUT the image straight to R2 with the exact Content-Type bound into the
//      signature, then register the returned key on the profile.
// Before this existed the onboarding wizard kept the image picker's local file://
// URI, so a photo showed on the member's own phone and was never saved anywhere.

import { api } from '@/api/client';
import { CONNECT_API_BASE } from '../constants/connect.constants';

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function photoContentType(uri: string, hint?: string | null): string {
  if (hint && /^image\/(jpeg|png|webp)$/.test(hint)) return hint;
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  // The picker re-encodes to JPEG by default, so unknown/HEIC extensions are JPEG.
  return CONTENT_TYPE_BY_EXT[ext] ?? 'image/jpeg';
}

/** Thrown when the server has no R2 credentials; retrying cannot succeed. */
export class PhotoUploadUnavailableError extends Error {
  constructor() {
    super('Photo uploads are temporarily unavailable. Please try again later.');
    this.name = 'PhotoUploadUnavailableError';
  }
}

type Presign = { upload_url: string; object_key: string; content_type: string };

export async function uploadProfilePhoto(
  uri: string,
  mimeHint?: string | null,
): Promise<{ id: string; status: string }> {
  const contentType = photoContentType(uri, mimeHint);

  let presign: Presign;
  try {
    const res = await api.post(`${CONNECT_API_BASE}/profile/media/presign`, {
      file_name: uri.split('/').pop() ?? 'photo.jpg',
      content_type: contentType,
    });
    presign = (res.data?.data ?? res.data) as Presign;
  } catch (e) {
    if ((e as { response?: { status?: number } })?.response?.status === 503) {
      throw new PhotoUploadUnavailableError();
    }
    throw e;
  }

  const blob = await (await fetch(uri)).blob();
  const put = await fetch(presign.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': presign.content_type },
    body: blob,
  });
  if (!put.ok) {
    throw new Error("Your photo couldn't be uploaded. Please try again.");
  }

  const res = await api.post(`${CONNECT_API_BASE}/profile/media`, {
    url: presign.object_key,
    kind: 'photo',
  });
  const d = (res.data?.data ?? res.data) as { id: string; moderation_status: string };
  return { id: d.id, status: d.moderation_status };
}
