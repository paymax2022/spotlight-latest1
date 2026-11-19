import { describe, expect, it } from 'vitest';
import {
  DIRECT_SONG_UPLOAD_PATH,
  MAX_SONG_BYTES,
  SONG_CONTENT_TYPE,
  SONG_EXTENSION,
  SONG_OBJECT_PREFIX,
  buildSongObjectKey,
  isSongObjectKeyFor,
  isUUID,
  songContestRef,
  songReaderUrl,
} from '@/features/openmic/song-storage';

const CONTEST_REF = 'open-mic-november-2026';
const ARTIST = '11111111-1111-4111-8111-111111111111';
const SUBMISSION = '22222222-2222-4222-8222-222222222222';

function keyFor(overrides: Partial<Parameters<typeof buildSongObjectKey>[0]> = {}) {
  return buildSongObjectKey({ contestRef: CONTEST_REF, artistUserId: ARTIST, submissionId: SUBMISSION, ...overrides });
}

describe('open mic song object keys', () => {
  it('names the slot the three writers already used, so stored keys stay readable', () => {
    // Compatibility pin: presign, complete and recordSubmissionUploadComplete all
    // built `openmic/${slug || id}/${userId}/${submissionId}.mp3`. Anything else
    // orphans every object uploaded before this change.
    expect(keyFor()).toBe(`${SONG_OBJECT_PREFIX}${CONTEST_REF}/${ARTIST}/${SUBMISSION}${SONG_EXTENSION}`);
    expect(keyFor()).toBe(`openmic/${CONTEST_REF}/${ARTIST}/${SUBMISSION}.mp3`);
  });

  it('falls back to the contest id when there is no slug', () => {
    expect(songContestRef({ slug: '', id: 'cid' })).toBe('cid');
    expect(songContestRef({ slug: 's', id: 'cid' })).toBe('s');
    expect(songContestRef({})).toBe('');
    expect(keyFor({ contestRef: songContestRef({ id: 'cid' }) })).toContain('/cid/');
  });

  it('exposes the reader path every surface plays through', () => {
    expect(songReaderUrl(SUBMISSION)).toBe(`/api/open-mic/songs/${SUBMISSION}`);
    expect(songReaderUrl(SUBMISSION)).not.toMatch(/^https?:/);
  });

  it('keeps the direct-upload sink and the R2 mode distinguishable but same-pathed', () => {
    expect(DIRECT_SONG_UPLOAD_PATH).toBe('/api/open-mic/uploads');
    expect(MAX_SONG_BYTES).toBe(50 * 1024 * 1024);
    expect(SONG_CONTENT_TYPE).toBe('audio/mp3');
  });
});

describe('isSongObjectKeyFor', () => {
  it('accepts the caller\'s own key', () => {
    expect(isSongObjectKeyFor({ key: keyFor(), contestRef: CONTEST_REF, artistUserId: ARTIST })).toBe(true);
  });

  it('rejects another artist\'s object in the same contest', () => {
    expect(
      isSongObjectKeyFor({
        key: keyFor({ artistUserId: '99999999-9999-4999-8999-999999999999' }),
        contestRef: CONTEST_REF,
        artistUserId: ARTIST,
      }),
    ).toBe(false);
  });

  it('rejects another contest, including one whose slug is a prefix of ours', () => {
    expect(isSongObjectKeyFor({ key: keyFor({ contestRef: 'other' }), contestRef: CONTEST_REF, artistUserId: ARTIST })).toBe(false);
    expect(
      isSongObjectKeyFor({ key: keyFor({ contestRef: `${CONTEST_REF}-evil` }), contestRef: CONTEST_REF, artistUserId: ARTIST }),
    ).toBe(false);
  });

  it('rejects traversal and over-long keys — the local fallback turns keys into paths', () => {
    const cases = [
      `openmic/../registration/${ARTIST}/x.mp3`,
      `openmic/${CONTEST_REF}/../../etc/passwd`,
      `openmic/${CONTEST_REF}/${ARTIST}/nested/${SUBMISSION}.mp3`,
      `openmic/${CONTEST_REF}/${ARTIST}/a b.mp3`,
      `openmic\\${CONTEST_REF}\\${ARTIST}\\${SUBMISSION}.mp3`,
      `openmic/${CONTEST_REF}/${ARTIST}/`,
      `openmic/${CONTEST_REF}/${ARTIST}/${SUBMISSION}.svg`,
      `openmic/${CONTEST_REF}/${ARTIST}/${SUBMISSION}`,
      `openmic/${CONTEST_REF}/${ARTIST}/not-a-uuid.mp3`,
      `registration/${ARTIST}/${SUBMISSION}.mp3`,
    ];
    for (const key of cases) {
      expect(isSongObjectKeyFor({ key, contestRef: CONTEST_REF, artistUserId: ARTIST }), key).toBe(false);
    }
  });

  it('rejects short and over-long keys without throwing', () => {
    // `openmic/<contest>/<artist>` has no filename segment at all, so a validator
    // that only counted *extra* segments would read `fileName` as undefined and
    // crash on `.endsWith()` inside a request handler.
    const cases = [
      `openmic/${CONTEST_REF}/${ARTIST}`,
      `openmic/${CONTEST_REF}`,
      'openmic/',
    ];
    for (const key of cases) {
      expect(() => isSongObjectKeyFor({ key, contestRef: CONTEST_REF, artistUserId: ARTIST })).not.toThrow();
      expect(isSongObjectKeyFor({ key, contestRef: CONTEST_REF, artistUserId: ARTIST }), key).toBe(false);
    }
  });

  it('is case-tolerant on the stem, which Postgres uuids are', () => {
    const upper = keyFor({ submissionId: SUBMISSION.toUpperCase() });
    expect(isSongObjectKeyFor({ key: upper, contestRef: CONTEST_REF, artistUserId: ARTIST })).toBe(true);
  });
});

describe('isUUID', () => {
  it('pins the shape the key builder relies on', () => {
    expect(isUUID(SUBMISSION)).toBe(true);
    expect(isUUID('22222222222222222222222222222222')).toBe(false);
    expect(isUUID('')).toBe(false);
    expect(isUUID(undefined as unknown as string)).toBe(false);
  });
});
