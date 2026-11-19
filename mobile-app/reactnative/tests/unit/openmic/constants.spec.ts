// Mirrors of server-side facts. Each assertion names the authority it mirrors,
// because a copy that drifts is worse than no copy: the size cap and the
// extension decide whether a hand-in is accepted, and the status list decides
// whether a link we show can actually play.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SONG_BYTES,
  OPEN_MIC_CONTEST_SLUGS,
  OPEN_MIC_CONTEST_TYPE,
  OPEN_MIC_REGISTRATION_CATEGORY,
  PLAYABLE_SONG_STATUSES,
  SONG_CONTENT_TYPE,
  SONG_EXTENSION,
  formatDuration,
  formatMegabytes,
  isPlayableSongStatus,
  looksLikeOpenMicSlug,
} from '@/features/openmic/constants';

describe('Open Mic edition identity', () => {
  it('uses the unified contest type the server writes, not the retired separate one', () => {
    // frontend-web/src/features/openmic/constants.ts declares this same string;
    // One_beat_one_verse and Open Mic are one contest, so both planes agree.
    assert.equal(OPEN_MIC_CONTEST_TYPE, 'one_beat_one_verse');
    assert.equal(OPEN_MIC_REGISTRATION_CATEGORY, 'open_mic');
  });

  it('recognises every slug the catalogue and the generator emit', () => {
    assert.ok(OPEN_MIC_CONTEST_SLUGS.includes('open-mic-competition'));
    assert.equal(looksLikeOpenMicSlug('open-mic'), true);
    assert.equal(looksLikeOpenMicSlug('open-mic-2026'), true);
    assert.equal(looksLikeOpenMicSlug('spotlight-open-mic-2026-11'), true);
  });

  it('matches case and padding, and rejects anything else', () => {
    assert.equal(looksLikeOpenMicSlug('  Open-MIC-2026  '), true);
    assert.equal(looksLikeOpenMicSlug('open-mic-next-edition'), false);
    assert.equal(looksLikeOpenMicSlug('arena'), false);
    assert.equal(looksLikeOpenMicSlug(''), false);
    assert.equal(looksLikeOpenMicSlug(null), false);
    assert.equal(looksLikeOpenMicSlug(undefined), false);
  });
});

describe('song upload limits', () => {
  it('caps at the server 50 MB and sends the type the signature is made for', () => {
    assert.equal(MAX_SONG_BYTES, 50 * 1024 * 1024);
    assert.equal(SONG_EXTENSION, '.mp3');
    assert.equal(SONG_CONTENT_TYPE, 'audio/mp3');
  });

  it('labels the cap in whole megabytes the way the card reads it', () => {
    assert.equal((MAX_SONG_BYTES / (1024 * 1024)).toFixed(0), '50');
    assert.equal(formatMegabytes(MAX_SONG_BYTES), '50.0 MB');
    assert.equal(formatMegabytes(1024 * 1024), '1.0 MB');
  });

  it('formats a zero and a nonsense byte count as 0 MB', () => {
    assert.equal(formatMegabytes(0), '0 MB');
    assert.equal(formatMegabytes('abc'), '0 MB');
    assert.equal(formatMegabytes(-5), '0 MB');
    assert.equal(formatMegabytes(null), '0 MB');
  });
});

describe('playable song statuses', () => {
  it('is exactly the security list the web reader and the Go roster use', () => {
    // Mirrors PUBLICLY_PLAYABLE_SONG_STATUSES in
    // frontend-web/src/features/openmic/song-storage.ts and
    // publiclyPlayableSongStatuses in backend/internal/connect/voting/repo.go.
    // `draft` must never appear: voters must not hear an unsubmitted file.
    assert.deepEqual([...PLAYABLE_SONG_STATUSES], [
      'submitted',
      'published_for_voting',
      'finalist',
      'winner',
      'live_for_voting',
    ]);
    assert.ok(!PLAYABLE_SONG_STATUSES.includes('draft'));
  });

  it('accepts the listed states and refuses the rest, case-insensitively', () => {
    assert.equal(isPlayableSongStatus('submitted'), true);
    assert.equal(isPlayableSongStatus('PUBLISHED_FOR_VOTING'), true);
    assert.equal(isPlayableSongStatus('draft'), false);
    assert.equal(isPlayableSongStatus('removed'), false);
    assert.equal(isPlayableSongStatus(undefined), false);
    assert.equal(isPlayableSongStatus(null), false);
  });
});

describe('formatDuration', () => {
  it('renders m:ss with padded seconds', () => {
    assert.equal(formatDuration(0), '');
    assert.equal(formatDuration(9), '0:09');
    assert.equal(formatDuration(65), '1:05');
    assert.equal(formatDuration(600), '10:00');
  });

  it('returns empty for anything that is not a positive number', () => {
    assert.equal(formatDuration(undefined), '');
    assert.equal(formatDuration(null), '');
    assert.equal(formatDuration('not a number'), '');
    assert.equal(formatDuration(-3), '');
  });

  it('floors a fractional duration rather than rounding it up', () => {
    assert.equal(formatDuration(65.9), '1:05');
  });
});
