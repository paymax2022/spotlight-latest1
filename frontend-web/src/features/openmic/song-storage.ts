/**
 * Object keys and URLs for a contestant's uploaded song.
 *
 * The key is written by three places (the presign route, the complete route and
 * `recordSubmissionUploadComplete` in persistence) and re-derived by the complete
 * route to decide ownership, so it lives here once instead of as three template
 * strings that can drift. Drift is not cosmetic: a mismatch makes an upload
 * permanently un-completable, and the mismatch this replaces was latent — the
 * three copies agreed only because all three used `slug || id`.
 *
 * `contestRef` keeps that existing rule rather than inventing a cleaner one,
 * because rows already stored under a slug-derived key must stay readable.
 */
export const SONG_OBJECT_PREFIX = 'openmic/';

/** Same cap the presign route has always applied. */
export const MAX_SONG_BYTES = 50 * 1024 * 1024;

/** MP3 only, and one exact MIME — matches the historic presign validation. */
export const SONG_CONTENT_TYPE = 'audio/mp3';
export const SONG_EXTENSION = '.mp3';

/**
 * Where a client POSTs the file when there is no object storage to presign
 * against (local development, and any environment without R2 credentials).
 */
export const DIRECT_SONG_UPLOAD_PATH = '/api/open-mic/uploads';

/** The root-relative reader every surface plays through — web, admin, mobile. */
export function songReaderUrl(submissionId: string) {
  return `/api/open-mic/songs/${submissionId}`;
}

export function songContestRef(contest: { slug?: string | null; id?: string | null }): string {
  return String(contest.slug || contest.id || '');
}

export function buildSongObjectKey(input: {
  contestRef: string;
  artistUserId: string;
  submissionId: string;
}): string {
  return `${SONG_OBJECT_PREFIX}${input.contestRef}/${input.artistUserId}/${input.submissionId}${SONG_EXTENSION}`;
}

/**
 * Does this key name this artist's slot in this contest?
 *
 * Ownership is structural, not a lookup: the artist id sits in its own segment,
 * so a caller can never claim another contestant's object by supplying a key
 * that merely exists. The traversal and segment-count checks are deliberate
 * defence in depth *behind* that exact-segment match — the local-disk fallback
 * turns keys into filesystem paths, and `segments.length !== 3` also keeps a
 * short key from reading `fileName` as undefined inside a request handler.
 */
export function isSongObjectKeyFor(input: {
  key: string;
  contestRef: string;
  artistUserId: string;
}): boolean {
  const { key, contestRef, artistUserId } = input;
  if (!key.startsWith(SONG_OBJECT_PREFIX) || key.includes('..') || key.includes('\\')) return false;
  const segments = key.slice(SONG_OBJECT_PREFIX.length).split('/');
  if (segments.length !== 3) return false;
  const [keyContest, keyArtist, fileName] = segments;
  return (
    keyContest === contestRef &&
    keyArtist === artistUserId &&
    fileName.endsWith(SONG_EXTENSION) &&
    isUUID(fileName.slice(0, -SONG_EXTENSION.length))
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUUID(value: string): boolean {
  return UUID_RE.test(String(value || ''));
}
