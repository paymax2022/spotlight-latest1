import { describe, expect, it } from 'vitest';
import {
  eligibilityForbiddenResponse,
  guardSongContentType,
  guardSongFileName,
  guardSongSize,
  isSubmissionId,
  songObjectKeyFor,
  songUploadDescriptor,
} from '@/server/openmic/song-upload-request';
import { classifyEligibility } from '@/server/openmic/submission-eligibility';
import { MAX_SONG_BYTES } from '@/features/openmic/song-storage';

const ARTIST = '11111111-1111-4111-8111-111111111111';
const SUBMISSION = '22222222-2222-4222-8222-222222222222';
const CONTEST = { id: 'cid', slug: 'open-mic-november-2026' };

describe('guardSongFileName', () => {
  it('accepts mp3 whatever the case', () => {
    expect(guardSongFileName('my song.MP3').ok).toBe(true);
    expect(guardSongFileName('track.mp3').ok).toBe(true);
  });

  it('refuses everything else, including a double extension', () => {
    expect(guardSongFileName('').ok).toBe(false);
    expect(guardSongFileName('song.svg').ok).toBe(false);
    expect(guardSongFileName('song.html').ok).toBe(false);
    expect(guardSongFileName('song.mp3.svg').ok).toBe(false);
    expect(guardSongFileName('song.wav').ok).toBe(false);
  });
});

describe('guardSongContentType', () => {
  it('accepts both spellings of mp3 and ignores parameters', () => {
    // The historic route demanded `audio/mp3` exactly; RFC 3003 says an mp3 is
    // `audio/mpeg`, and mobile pickers send that. Refusing a working client over a
    // label is not a security win — the extension decides what we serve back.
    expect(guardSongContentType('audio/mp3').ok).toBe(true);
    expect(guardSongContentType('audio/mpeg').ok).toBe(true);
    expect(guardSongContentType('Audio/MPEG; codecs=mp3').ok).toBe(true);
  });

  it('refuses a non-audio type and an empty one', () => {
    expect(guardSongContentType('image/svg+xml').ok).toBe(false);
    expect(guardSongContentType('application/octet-stream').ok).toBe(false);
    expect(guardSongContentType('').ok).toBe(false);
  });
});

describe('guardSongSize', () => {
  it('bounds the declared size at 50 MiB inclusive', () => {
    expect(guardSongSize(MAX_SONG_BYTES).ok).toBe(true);
    expect(guardSongSize(MAX_SONG_BYTES + 1).ok).toBe(false);
    expect(guardSongSize(0).ok).toBe(false);
    expect(guardSongSize(-5).ok).toBe(false);
    expect(guardSongSize('abc').ok).toBe(false);
    expect(guardSongSize(null).ok).toBe(false);
    expect(guardSongSize(undefined).ok).toBe(false);
    expect(guardSongSize('2048').ok).toBe(true);
  });
});

describe('isSubmissionId', () => {
  it('only lets a UUID name an object slot', () => {
    expect(isSubmissionId(SUBMISSION)).toBe(true);
    expect(isSubmissionId(`${SUBMISSION}../../etc`)).toBe(false);
    expect(isSubmissionId('1')).toBe(false);
    expect(isSubmissionId('')).toBe(false);
  });
});

describe('songObjectKeyFor / songUploadDescriptor', () => {
  it('derives the key server-side from the contest row, never from the client', () => {
    expect(songObjectKeyFor({ contest: CONTEST, artistUserId: ARTIST, submissionId: SUBMISSION })).toBe(
      `openmic/open-mic-november-2026/${ARTIST}/${SUBMISSION}.mp3`,
    );
    expect(songObjectKeyFor({ contest: { id: 'cid' }, artistUserId: ARTIST, submissionId: SUBMISSION })).toContain('/cid/');
  });

  it('hands back the reader URL and the cap a client needs before it sends bytes', () => {
    const descriptor = songUploadDescriptor({ contest: CONTEST, artistUserId: ARTIST, submissionId: SUBMISSION });
    expect(descriptor.readerUrl).toBe(`/api/open-mic/songs/${SUBMISSION}`);
    expect(descriptor.maxBytes).toBe(MAX_SONG_BYTES);
    expect(descriptor.submissionId).toBe(SUBMISSION);
    expect(descriptor.objectKey).toContain(ARTIST);
  });
});

describe('eligibilityForbiddenResponse', () => {
  it('is a 403 carrying the reason and the dates, and no internals', async () => {
    const verdict = classifyEligibility({
      contest: { id: 'cid', slug: 's', beat: {}, status: 'published', submissionStartAt: '2026-12-01T00:00:00.000Z' },
      userId: ARTIST,
      promoted: false,
      enrollment: false,
      registration: true,
    });
    const response = eligibilityForbiddenResponse(verdict);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toMatchObject({ success: false, code: 'window_closed', reason: 'window_closed', submissionOpensAt: '2026-12-01T00:00:00.000Z' });
    expect(body.error).toMatch(/closed/i);
    expect(JSON.stringify(body)).not.toMatch(/openmic\/|Bearer|at \w/);
  });

  it('names approval, not the calendar, when the applicant is still pending', async () => {
    const verdict = classifyEligibility({ contest: { id: 'cid', slug: 's', beat: {}, status: 'submission_open' }, userId: null, promoted: false, enrollment: false, registration: false });
    const body = await eligibilityForbiddenResponse(verdict).json();
    expect(body.code).toBe('not_approved');
    expect(body.error).toMatch(/approved/i);
  });
});
