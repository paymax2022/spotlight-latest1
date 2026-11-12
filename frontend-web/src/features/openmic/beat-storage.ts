/**
 * Object keys and reader URLs for the Open Mic official beat.
 *
 * The beat has to play for an anonymous visitor on the programme page, so its
 * bytes get their own public prefix rather than sharing the bucket with private
 * registration documents. Reader URLs are ROOT-RELATIVE: the stored value is
 * read by the web app, the admin console and the Go voting API on three
 * different origins, and an absolute URL minted at upload time bakes that
 * environment's host into the row (the failure that made contest banners
 * unloadable anywhere but the laptop that uploaded them).
 */
export const BEAT_OBJECT_PREFIX = 'openmic-beats/';
export const BEAT_READER_BASE = '/api/open-mic/beats';

/**
 * Written by the old admin flow. The registration reader serves those keys only
 * to the account that uploaded them (403), or not at all (401 signed out), so an
 * edition carrying one has a beat nobody but the admin can hear.
 */
export const LEGACY_UPLOAD_PREFIX = '/api/registration/uploads/';

export function beatObjectKey(contestId: string, uuid: string) {
  return `${BEAT_OBJECT_PREFIX}${contestId}/${uuid}.mp3`;
}

export function encodeBeatFileKey(objectKey: string) {
  return Buffer.from(objectKey, 'utf8').toString('base64url');
}

/**
 * base64url decoding never throws — it yields garbage — so require an exact
 * round trip. `%%%` must not resolve to an object, and neither must a valid key
 * with hand-added `=` padding: encodeBeatFileKey never emits padding, so the
 * re-encode cannot match.
 */
export function decodeBeatFileKey(fileKey: string): string | null {
  if (!fileKey) return null;
  const decoded = Buffer.from(fileKey, 'base64url').toString('utf8');
  return encodeBeatFileKey(decoded) === fileKey ? decoded : null;
}

export function isPublicBeatObjectKey(key: string) {
  return key.startsWith(BEAT_OBJECT_PREFIX) && !key.includes('..');
}

export function beatReaderUrl(objectKey: string, opts: { download?: boolean } = {}) {
  const url = `${BEAT_READER_BASE}/${encodeBeatFileKey(objectKey)}`;
  return opts.download ? `${url}?download=1` : url;
}

/**
 * The one URL shape a public surface may use: a root-relative reader URL under
 * BEAT_READER_BASE, or null when the stored value cannot play or download.
 *
 * An allowlist on purpose. The admin builder's beat URL field is free text, so
 * an exclusion list would happily pass an absolute off-origin host, an http
 * downgrade of an https one, or a protocol-relative `//host/…` straight through
 * to `<source src>` on the edition page — none of which this reader serves.
 */
export function publicBeatUrl(stored: string | null | undefined): string | null {
  if (!stored) return null;
  return stored.startsWith(`${BEAT_READER_BASE}/`) ? stored : null;
}

/**
 * Admin-facing diagnostic, and only that: "is this a pre-fix, owner-only
 * registration path?". It deliberately does not answer "is this URL safe to
 * render?" — that is publicBeatUrl's job — so an absolute third-party URL is
 * false here while still being unusable. Two different problems, two different
 * warnings.
 */
export function isLegacyBeatUrl(stored: string | null | undefined): boolean {
  return Boolean(stored && stored.startsWith(LEGACY_UPLOAD_PREFIX));
}
