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

/**
 * Submission states whose song a voter may hear. `draft` is deliberately absent:
 * an uploaded-but-not-yet-submitted file belongs to the artist alone, and the
 * reader serves it only to its owner.
 *
 * This is a security rule, not a display preference, so it lives once. The reader
 * enforces it on the bytes, and anything that hands out a URL for a status not
 * listed here only produces a 404 — which is why the reader stays the authority
 * even though the vote page filters on this same list.
 */
export const PUBLICLY_PLAYABLE_SONG_STATUSES = [
  'submitted',
  'published_for_voting',
  'finalist',
  'winner',
  'live_for_voting',
] as const;

export function isPubliclyPlayableSongStatus(status: unknown): boolean {
  return (PUBLICLY_PLAYABLE_SONG_STATUSES as readonly string[]).includes(String(status ?? '').toLowerCase());
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

/**
 * Reader-side check: does this stored key name the object for *this* submission?
 *
 * Deliberately weaker than `isSongObjectKeyFor`, which also pins the artist and
 * contest from the caller's session — a reader has only the database row, and a
 * row whose contest was renamed must keep playing. What it does require is that
 * the filename is `<submissionId>.mp3` under our own prefix with no traversal, so
 * a corrupted or hand-edited `lyrical_concept_summary` cannot point the local
 * reader at another folder on the server's disk.
 */
export function isSongKeyForSubmission(key: unknown, submissionId: string): boolean {
  if (typeof key !== 'string') return false;
  if (!isUUID(submissionId)) return false;
  if (!key.startsWith(SONG_OBJECT_PREFIX) || key.includes('..') || key.includes('\\')) return false;
  const segments = key.slice(SONG_OBJECT_PREFIX.length).split('/');
  if (segments.length !== 3) return false;
  const fileName = segments[2];
  return (
    fileName.toLowerCase().endsWith(SONG_EXTENSION) &&
    fileName.slice(0, -SONG_EXTENSION.length).toLowerCase() === submissionId.toLowerCase()
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUUID(value: string): boolean {
  return UUID_RE.test(String(value || ''));
}
