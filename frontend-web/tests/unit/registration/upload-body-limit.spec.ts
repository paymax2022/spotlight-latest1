/**
 * Upload body-size contract, pinned together.
 *
 * Next clones every request body for the middleware layer and caps that clone at
 * `experimental.proxyClientMaxBodySize` (default 10 MiB —
 * `next/dist/server/config-shared.js`). Above the cap it does not reject the
 * request: it pushes `null` into the stream, so the handler receives a TRUNCATED
 * body. `request.formData()` then dies with
 * `TypeError: Failed to parse body as FormData.` and the upload route's blanket
 * catch answered that as `415 Expected multipart/form-data` — a content-type
 * complaint about a request that had a perfectly good boundary. A user picking a
 * 20 MB file saw "Upload failed. Please try again." and nothing else.
 * (Measured 2026-11-24 against the dev server: 8 MiB uploads returned 200,
 * 10 MiB and 20 MiB returned 415.)
 *
 * The fix has two halves that must not be allowed to drift apart again: the caps
 * each upload route declares for itself, and ONE server-wide body limit that
 * clears the largest of them plus multipart framing. This spec fails if the
 * limit is lowered, removed, or simply forgotten when a new, bigger cap lands.
 */
import { describe, it, expect } from 'vitest';

import { MAX_REGISTRATION_UPLOAD_BYTES } from '@/src/lib/storage/upload-limits';
import { MAX_SONG_BYTES } from '@/src/features/openmic/song-storage';
import { MAX_MULTIPART_BODY_BYTES, MAX_MULTIPART_BODY_SIZE } from '../../../upload-limits.config.mjs';

/** Every multipart route's own declared cap, as the server has to receive them. */
const DECLARED_CAPS: Record<string, number> = {
  'registration/uploads': MAX_REGISTRATION_UPLOAD_BYTES,
  'open-mic songs': MAX_SONG_BYTES,
};

describe('multipart body limit vs. the upload caps it has to clear', () => {
  it('is a string Next can parse (bytes(), not a bare number)', () => {
    expect(typeof MAX_MULTIPART_BODY_SIZE).toBe('string');
    expect(MAX_MULTIPART_BODY_SIZE).toMatch(/^\d+(mb|kb|gb)$/i);
  });

  it('agrees with the numeric bytes value the spec is written against', () => {
    expect(MAX_MULTIPART_BODY_BYTES).toBe(110 * 1024 * 1024);
  });

  it('clears the largest declared upload cap with framing headroom to spare', () => {
    const largest = Math.max(...Object.values(DECLARED_CAPS));
    // The boundary, part headers and CRLFs ride on top of the file itself, so a
    // file exactly at a cap produces a slightly larger body. 1 MiB of headroom
    // is generous; anything less than that is a rounding accident waiting to
    // truncate a legitimate upload.
    expect(MAX_MULTIPART_BODY_BYTES).toBeGreaterThanOrEqual(largest + 1024 * 1024);
  });

  it('is above the 10 MiB default that caused the 415 in the first place', () => {
    const NEXT_DEFAULT_CLONE_LIMIT = 10 * 1024 * 1024;
    expect(MAX_MULTIPART_BODY_BYTES).toBeGreaterThan(NEXT_DEFAULT_CLONE_LIMIT);
  });
});
