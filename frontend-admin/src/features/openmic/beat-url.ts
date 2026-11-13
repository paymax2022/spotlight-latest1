/**
 * Can an artist open this beat URL? The authoritative vocabulary lives in
 * frontend-web — src/features/openmic/beat-storage.ts (BEAT_READER_BASE,
 * LEGACY_UPLOAD_PREFIX, publicBeatUrl, isLegacyBeatUrl) — and the reader that
 * enforces it is app/api/open-mic/beats/[fileKey]/route.ts.
 *
 * Mirrored here, not imported: frontend-admin and frontend-web are separately
 * deployed Next apps with no shared package between them. If the reader's
 * prefix ever changes, change it in BOTH files; tests/unit/openmic plus this
 * app's beat-upload test pin each copy to its literal, so a silent drift shows
 * up as a failing test rather than a console that warns about a URL that works.
 */
export const BEAT_READER_BASE = '/api/open-mic/beats';
export const LEGACY_UPLOAD_PREFIX = '/api/registration/uploads/';

export type BeatUrlProblem = 'legacy' | 'unplayable';

/** null when the value is empty or a path this site's reader serves. */
export function beatUrlProblem(stored: string | null | undefined): BeatUrlProblem | null {
  const value = String(stored || '').trim();
  if (!value) return null;
  if (value.startsWith(LEGACY_UPLOAD_PREFIX)) return 'legacy';
  return value.startsWith(`${BEAT_READER_BASE}/`) ? null : 'unplayable';
}
