// Open Mic facts a phone needs to talk to the web API. Values are *mirrors* of
// the canonical copies in frontend-web (`src/features/openmic/constants.ts`,
// `src/features/openmic/song-storage.ts`) — the server stays the authority, and
// these only exist so a screen can label a limit or recognise an edition without
// a second round trip.
//
// Kept free of `react-native` and `expo` imports on purpose: `node --test`
// cannot load those (SDK 54 points package `main` at TypeScript sources, which
// Node refuses to type-strip inside node_modules), and this module's rules are
// exactly the kind of thing that should be under a test.

/** `contests.contest_type` an Open Mic edition written by the admin carries. */
export const OPEN_MIC_CONTEST_TYPE = 'one_beat_one_verse';

/** `contests.category` the registration plane writes for the same edition. */
export const OPEN_MIC_REGISTRATION_CATEGORY = 'open_mic';

/**
 * Slugs the catalogue, the programme pages and hand-made editions use.
 * `spotlight-open-mic-YYYY-MM` is what `buildDefaultOpenMicContest` generates for
 * a monthly edition, so the pattern is checked too — see `looksLikeOpenMicSlug`.
 */
export const OPEN_MIC_CONTEST_SLUGS = ['open-mic-competition', 'open-mic', 'open-mic-2026'];
export const OPEN_MIC_SLUG_PREFIX = 'spotlight-open-mic';

export function looksLikeOpenMicSlug(slug: unknown): boolean {
  const value = String(slug ?? '').trim().toLowerCase();
  if (!value) return false;
  if (OPEN_MIC_CONTEST_SLUGS.includes(value)) return true;
  return value.startsWith(OPEN_MIC_SLUG_PREFIX);
}

/** The single cap the server applies to a hand-in (50 MB). */
export const MAX_SONG_BYTES = 50 * 1024 * 1024;

/** The extension the server accepts and will serve the bytes back as. */
export const SONG_EXTENSION = '.mp3';

/**
 * The type the server signs the presigned PUT with and the type it expects on the
 * multipart part. `guardSongContentType` on the server also tolerates
 * `audio/mpeg`, which is what some pickers report, but the value a client *sends*
 * is this one so a signature and a part header never drift.
 */
export const SONG_CONTENT_TYPE = 'audio/mp3';

/**
 * Submission states whose song a voter may hear — a display copy of
 * `PUBLICLY_PLAYABLE_SONG_STATUSES` in frontend-web. The server's reader enforces
 * this on the bytes, so an out-of-date copy here can only ever mislabel a link,
 * never expose a song.
 */
export const PLAYABLE_SONG_STATUSES = [
  'submitted',
  'published_for_voting',
  'finalist',
  'winner',
  'live_for_voting',
];

export function isPlayableSongStatus(status: unknown): boolean {
  return PLAYABLE_SONG_STATUSES.includes(String(status ?? '').toLowerCase());
}

/** Format bytes for a label. Pure so a test can pin the rounding. */
export function formatMegabytes(bytes: unknown): string {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 MB';
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/** `mm:ss` from seconds, used for the beat's declared length. */
export function formatDuration(seconds: unknown): string {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return '';
  const m = Math.floor(value / 60);
  const s = Math.floor(value % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
