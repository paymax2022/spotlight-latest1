/**
 * Can an artist open this beat URL? The authoritative vocabulary lives in
 * frontend-web — src/features/openmic/beat-storage.ts (BEAT_READER_BASE,
 * LEGACY_UPLOAD_PREFIX, publicBeatUrl, isLegacyBeatUrl) — and the reader that
 * enforces it is app/api/open-mic/beats/[fileKey]/route.ts.
 *
 * Mirrored here, not imported: frontend-admin and frontend-web are separately
 * deployed Next apps — frontend-web's `@/*` maps inside itself and there is no
 * `shared/` directory at the repo root, so neither app can reach the other's
 * module. If the reader's prefix ever changes, change it in BOTH files. Each
 * copy is pinned by a failing test: frontend-web's by the reader tests in
 * tests/unit/openmic and tests/unit/media, this copy by beat-upload.test.tsx
 * case 1, which asserts that a real reader path warns nothing — drift here
 * makes that path look unplayable and the case dies.
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
