import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The local branch is what localhost and CI exercise, so the R2 module is stubbed
// to "not configured" rather than reaching for credentials the test environment
// does not have.
vi.mock('@/src/lib/storage/r2', () => ({
  hasR2Config: () => false,
  createR2DownloadUrl: async () => 'https://bucket.example.invalid/signed',
}));

const { contentDispositionHeader, parseByteRange, resolveByteRange, buildSongResponse, SONG_CORS_HEADERS } =
  await import('@/src/server/openmic/song-stream');
const { saveLocalUpload } = await import('@/src/lib/storage/local-uploads');

const KEY = 'openmic/open-mic-november-2026/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.mp3';
const TOTAL = 1000;

describe('parseByteRange', () => {
  it('reads the three shapes an audio element actually sends', () => {
    expect(parseByteRange('bytes=0-1')).toEqual({ start: 0, end: 1 });
    expect(parseByteRange('bytes=500-')).toEqual({ start: 500, end: undefined });
    expect(parseByteRange('bytes=-500')).toEqual({ suffix: 500 });
    expect(parseByteRange('BYTES=10-20')).toEqual({ start: 10, end: 20 });
  });

  it('returns null instead of guessing', () => {
    for (const header of [null, undefined, '', 'bytes=', 'bytes=abc', 'bytes=-', 'bytes=10-5', 'bytes=0-1,5-6', 'items=0-1']) {
      expect(parseByteRange(header), String(header)).toBeNull();
    }
  });

  it('rejects negative and fractional offsets', () => {
    expect(parseByteRange('bytes=-10-')).toBeNull();
    expect(parseByteRange('bytes=1.5-')).toBeNull();
  });
});

describe('resolveByteRange', () => {
  it('treats no range as the whole object', () => {
    expect(resolveByteRange(null, TOTAL)).toEqual({ kind: 'full' });
  });

  it('clamps an open-ended range to the last byte, inclusively', () => {
    expect(resolveByteRange(parseByteRange('bytes=900-'), TOTAL)).toEqual({ kind: 'partial', start: 900, end: 999 });
    expect(resolveByteRange(parseByteRange('bytes=500-9999'), TOTAL)).toEqual({ kind: 'partial', start: 500, end: 999 });
  });

  it('answers a suffix range from the end, and caps it at the object size', () => {
    expect(resolveByteRange(parseByteRange('bytes=-100'), TOTAL)).toEqual({ kind: 'partial', start: 900, end: 999 });
    expect(resolveByteRange(parseByteRange('bytes=-5000'), TOTAL)).toEqual({ kind: 'partial', start: 0, end: 999 });
  });

  it('calls a start past EOF unsatisfiable rather than serving an empty 206', () => {
    expect(resolveByteRange(parseByteRange('bytes=1000-'), TOTAL)).toEqual({ kind: 'unsatisfiable', totalBytes: TOTAL });
    expect(resolveByteRange(parseByteRange('bytes=-0'), TOTAL)).toEqual({ kind: 'unsatisfiable', totalBytes: TOTAL });
    expect(resolveByteRange(parseByteRange('bytes=0-'), 0)).toEqual({ kind: 'unsatisfiable', totalBytes: 0 });
  });
});

describe('buildSongResponse without R2', () => {
  let dir = '';

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'openmic-song-stream-'));
    process.env.LOCAL_UPLOAD_DIR = dir;
    await saveLocalUpload(KEY, Buffer.alloc(TOTAL, 7));
  });

  afterAll(() => {
    delete process.env.LOCAL_UPLOAD_DIR;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('serves the whole file with the type the extension map gives', async () => {
    const res = await buildSongResponse({ objectKey: KEY });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-length')).toBe(String(TOTAL));
    expect(res.headers.get('content-range')).toBeNull();
    expect((await res.arrayBuffer()).byteLength).toBe(TOTAL);
    expect(res.headers.get('access-control-allow-origin')).toBe(SONG_CORS_HEADERS['Access-Control-Allow-Origin']);
  });

  it('answers a range with 206 and a Content-Range the browser can scrub by', async () => {
    const res = await buildSongResponse({ objectKey: KEY, rangeHeader: 'bytes=10-19' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 10-19/${TOTAL}`);
    expect(res.headers.get('content-length')).toBe('10');
    expect((await res.arrayBuffer()).byteLength).toBe(10);
  });

  it('is what makes seeking work: the second request an audio element sends', async () => {
    // The player probes `bytes=0-1` for metadata, then requests from the seek
    // target. A server that ignores the header returns 200 twice and the UI is
    // stuck at the start of the song.
    const probe = await buildSongResponse({ objectKey: KEY, rangeHeader: 'bytes=0-1' });
    expect(probe.status).toBe(206);
    await probe.arrayBuffer();
    const seek = await buildSongResponse({ objectKey: KEY, rangeHeader: 'bytes=640-' });
    expect(seek.status).toBe(206);
    expect(seek.headers.get('content-range')).toBe(`bytes 640-${TOTAL - 1}/${TOTAL}`);
    expect((await seek.arrayBuffer()).byteLength).toBe(TOTAL - 640);
  });

  it('refuses a range past the end with 416 and the real length', async () => {
    const res = await buildSongResponse({ objectKey: KEY, rangeHeader: 'bytes=4000-' });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe(`bytes */${TOTAL}`);
  });

  it('names the file the artist uploaded instead of the object key', async () => {
    const res = await buildSongResponse({ objectKey: KEY, fileName: 'my song.mp3' });
    expect(res.headers.get('content-disposition')).toBe('inline; filename="my song.mp3"');
    await res.arrayBuffer();
  });

  it('switches to attachment for ?download=1', async () => {
    const res = await buildSongResponse({ objectKey: KEY, fileName: 'song.mp3', disposition: 'attachment' });
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="song.mp3"');
    await res.arrayBuffer();
  });

  it('cannot be talked into smuggling a header through a filename', () => {
    // The filename is the artist's own string and lands inside a response header.
    expect(contentDispositionHeader('inline', 'a".mp3\nX-Evil: 1')).toBe('inline; filename="a.mp3X-Evil_ 1"');
    expect(contentDispositionHeader('inline', '../../etc/passwd')).toBe('inline; filename="passwd"');
    expect(contentDispositionHeader('attachment')).toBe('attachment; filename="song.mp3"');
  });

  it('404s a song that was never written instead of throwing', async () => {
    const res = await buildSongResponse({ objectKey: 'openmic/other/artist/missing.mp3' });
    expect(res.status).toBe(404);
  });

  it('cannot be talked out of the upload root by a key', async () => {
    // The public reader takes the key from a database row, so a stored value is
    // the attack surface; `../../etc/passwd` must never become a filesystem path
    // outside the temp root. The reader resolves it, refuses it, and reports the
    // same 404 as a missing song rather than leaking which half failed.
    for (const key of ['openmic/../../escape.mp3', '../../../etc/passwd', 'openmic/../../../etc/passwd']) {
      const res = await buildSongResponse({ objectKey: key });
      expect(res.status, key).toBe(404);
    }
  });
});
