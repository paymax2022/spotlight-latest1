import { api } from '@/api/client';

/**
 * Upload a picked cover image and return a durable, remotely-resolvable URL.
 *
 * Why this exists: the wizard had no upload step. The media step stored the raw
 * picker URI — `blob:` on web, `file://` on native — and neither survives the
 * trip to another device or, on web, even a page reload. The submit payload
 * therefore dropped it (it persists a cover only when it already matches
 * ^https?://), so every campaign reached the server with no cover and the
 * creator's list showed a placeholder for an image they had definitely chosen.
 *
 * Uploading at pick time rather than at submit means the draft holds an http URL
 * from that moment on, which fixes three things at once: the persisted draft
 * keeps it (persistableUri drops only blob:/data:), the submit guard accepts it,
 * and a failure surfaces while the user is still looking at the media step
 * instead of silently at the end.
 */
export interface CoverUploadResult {
  url: string;
  storageKey: string;
}

function fileNameFor(uri: string): string {
  const fromUri = uri.split('?')[0].split('/').pop() || '';
  // A blob: URI has no filename and no extension; the server validates on
  // extension, so give it one rather than letting the upload 400.
  if (/\.(jpe?g|png|webp)$/i.test(fromUri)) return fromUri;
  return `cover-${Date.now()}.jpg`;
}

function mimeFor(name: string): string {
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.webp$/i.test(name)) return 'image/webp';
  return 'image/jpeg';
}

export async function uploadCampaignCover(uri: string): Promise<CoverUploadResult> {
  // Already durable (e.g. re-entering the step on a restored draft) — uploading
  // again would just create an orphaned duplicate object.
  if (/^https?:\/\//i.test(uri)) return { url: uri, storageKey: '' };

  const name = fileNameFor(uri);
  const type = mimeFor(name);
  const form = new FormData();

  if (uri.startsWith('blob:') || uri.startsWith('data:')) {
    // Web: turn the picker's object URL back into real bytes. RN's FormData
    // blob-descriptor form does not apply here — the DOM FormData needs a Blob.
    const blob = await (await fetch(uri)).blob();
    form.append('file', new File([blob], name, { type: blob.type || type }));
  } else {
    // Native: RN FormData accepts a { uri, name, type } descriptor and streams
    // the file itself. Casting because RN's typings declare only (name, value).
    form.append('file', { uri, name, type } as unknown as Blob);
  }

  const res = await api.post('/api/crowdfunding/uploads', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  const upload = (res?.data?.data ?? res?.data)?.upload as CoverUploadResult | undefined;
  if (!upload?.url) throw new Error('Upload did not return a URL');
  return upload;
}
