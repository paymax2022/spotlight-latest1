import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The official beat is heard through an `<audio>` element — by an anonymous
 * visitor on the programme page, by the applicant who is told to preview it
 * before downloading, and by the admin review panel. A media element does not
 * fetch a file, it fetches ranges of one, so this route is only a player source
 * if it answers a Range request the way RFC 7233 says it must.
 *
 * The local-disk branch is what localhost and CI exercise; R2 is stubbed off so
 * the test never reaches for credentials it does not have.
 */
vi.mock('@/src/lib/storage/r2', () => ({
  hasR2Config: () => false,
  createR2DownloadUrl: async () => 'https://bucket.example.invalid/signed',
  assertR2ObjectExists: async () => true,
  sanitizeObjectFileName: (value: string) => value.replace(/[^A-Za-z0-9._ -]/g, '_'),
}));

const { GET } = await import('@/app/api/open-mic/beats/[fileKey]/route');
const { encodeBeatFileKey, beatObjectKey } = await import('@/src/features/openmic/beat-storage');
const { saveLocalUpload } = await import('@/src/lib/storage/local-uploads');

const CONTEST_ID = '11111111-1111-4111-8111-111111111111';
const BEAT_UUID = '22222222-2222-4222-8222-222222222222';
const KEY = beatObjectKey(CONTEST_ID, BEAT_UUID);
const FILE_KEY = encodeBeatFileKey(KEY);
const TOTAL = 400;

function get(init: { range?: string; download?: boolean } = {}) {
  const url = `http://localhost:3000/api/open-mic/beats/${FILE_KEY}${init.download ? '?download=1' : ''}`;
  const headers: Record<string, string> = {};
  if (init.range) headers.Range = init.range;
  return GET(new Request(url, { headers }), { params: Promise.resolve({ fileKey: FILE_KEY }) });
}

let dir = '';

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'openmic-beat-route-'));
  process.env.LOCAL_UPLOAD_DIR = dir;
  await saveLocalUpload(KEY, Buffer.alloc(TOTAL, 3));
});

afterAll(() => {
  delete process.env.LOCAL_UPLOAD_DIR;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('GET /api/open-mic/beats/[fileKey] byte ranges', () => {
  it('advertises range support even on the whole-file read', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-length')).toBe(String(TOTAL));
    expect(res.headers.get('content-range')).toBeNull();
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('answers a scrub with 206 and the slice the player asked for', async () => {
    const res = await get({ range: 'bytes=100-199' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 100-199/${TOTAL}`);
    expect(res.headers.get('content-length')).toBe('100');
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });

  it('serves an open-ended tail range to the last byte', async () => {
    const res = await get({ range: `bytes=${TOTAL - 20}-` });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes ${TOTAL - 20}-${TOTAL - 1}/${TOTAL}`);
  });

  it('refuses a range past the end instead of answering an empty 206', async () => {
    const res = await get({ range: `bytes=${TOTAL + 10}-` });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe(`bytes */${TOTAL}`);
  });

  it('keeps naming the file for a download', async () => {
    const res = await get({ download: true });
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="${BEAT_UUID}.mp3"`);
  });

  it('still refuses a key that is not a public beat', async () => {
    const privateFileKey = encodeBeatFileKey('registration-docs/user/passport.pdf');
    const res = await GET(new Request('http://localhost:3000/api/open-mic/beats/x'), {
      params: Promise.resolve({ fileKey: privateFileKey }),
    });
    expect(res.status).toBe(404);
  });
});
