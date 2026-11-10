// The official Open Mic beat must play for an anonymous visitor, so its bytes
// live under their own public prefix instead of sharing the bucket with private
// registration documents (the old flow stored /api/registration/uploads/… keys,
// which 401/403 for every artist but the admin who uploaded them).
//
// Two things must not regress: the reader cannot be pointed at any prefix but
// `openmic-beats/`, and it never becomes an existence oracle for private
// objects (404, not 403).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readLocalUpload = vi.hoisted(() => vi.fn());
// Hoisted so the R2 describe at the bottom can flip the flag. Production is the
// R2 branch, so it has to be reachable from a test.
const hasR2Config = vi.hoisted(() => vi.fn(() => false));
const assertR2ObjectExists = vi.hoisted(() => vi.fn());
const createR2DownloadUrl = vi.hoisted(() => vi.fn());
const assertAdminPermission = vi.hoisted(() => vi.fn());
const saveLocalUpload = vi.hoisted(() => vi.fn());
vi.mock('@/src/server/admin/auth', () => ({ assertAdminPermission }));

vi.mock('@/src/lib/storage/local-uploads', () => ({
  readLocalUpload,
  saveLocalUpload,
  contentTypeForKey: (key: string) => (key.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream'),
}));

vi.mock('@/src/lib/storage/r2', () => ({
  hasR2Config,
  createR2UploadUrl: vi.fn(),
  uploadR2Object: vi.fn(),
  assertR2ObjectExists,
  createR2DownloadUrl,
  sanitizeObjectFileName: (name: string) => name.replace(/[^a-zA-Z0-9._-]+/g, '-'),
}));

import { GET } from '@/app/api/open-mic/beats/[fileKey]/route';
import {
  BEAT_OBJECT_PREFIX,
  BEAT_READER_BASE,
  LEGACY_UPLOAD_PREFIX,
  beatObjectKey,
  beatReaderUrl,
  decodeBeatFileKey,
  encodeBeatFileKey,
  isLegacyBeatUrl,
  isPublicBeatObjectKey,
  publicBeatUrl,
} from '@/src/features/openmic/beat-storage';

const get = (fileKey: string, query = '') =>
  GET(new Request(`https://web.example.test/api/open-mic/beats/${fileKey}${query}`), {
    params: Promise.resolve({ fileKey }),
  });

describe('beat storage vocabulary', () => {
  it('namespaces an object key under the public beat prefix', () => {
    expect(beatObjectKey('contest-9', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe(
      `${BEAT_OBJECT_PREFIX}contest-9/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.mp3`,
    );
  });

  it('mints root-relative reader URLs, with ?download=1 only for the download', () => {
    const key = beatObjectKey('contest-9', 'u1');
    expect(beatReaderUrl(key)).toMatch(new RegExp(`^${BEAT_READER_BASE}/[A-Za-z0-9_-]+$`));
    expect(beatReaderUrl(key, { download: true })).toBe(`${beatReaderUrl(key)}?download=1`);
    expect(beatReaderUrl(key)).not.toMatch(/^https?:/);
  });

  it('round-trips a key through base64url and rejects anything that is not exactly encoded', () => {
    const key = beatObjectKey('contest-9', 'u2');
    expect(decodeBeatFileKey(encodeBeatFileKey(key))).toBe(key);
    expect(decodeBeatFileKey('%%%')).toBeNull();
    expect(decodeBeatFileKey('')).toBeNull();
    // Padding is the subtle half of "not exactly encoded": base64url decoding
    // accepts `…==` and returns the right bytes, so only the round-trip check
    // (which re-encodes unpadded) can tell a hand-padded key from a minted one.
    const encoded = encodeBeatFileKey(key);
    expect(encoded).not.toContain('=');
    expect(decodeBeatFileKey(`${encoded}=`)).toBeNull();
    expect(decodeBeatFileKey(`${encoded}==`)).toBeNull();
  });

  it('accepts only its own prefix and refuses traversal', () => {
    expect(isPublicBeatObjectKey('openmic-beats/c1/u.mp3')).toBe(true);
    expect(isPublicBeatObjectKey('registration/user-1/passport.png')).toBe(false);
    expect(isPublicBeatObjectKey('openmic-beats/../../registration/x.mp3')).toBe(false);
  });

  it('treats a legacy owner-only URL as unavailable and names it for the admin warning', () => {
    expect(publicBeatUrl(`${LEGACY_UPLOAD_PREFIX}abc`)).toBeNull();
    expect(publicBeatUrl('')).toBeNull();
    expect(publicBeatUrl(undefined)).toBeNull();
    expect(publicBeatUrl(`${BEAT_READER_BASE}/abc`)).toBe(`${BEAT_READER_BASE}/abc`);
    expect(isLegacyBeatUrl(`${LEGACY_UPLOAD_PREFIX}abc`)).toBe(true);
    expect(isLegacyBeatUrl(`${BEAT_READER_BASE}/abc`)).toBe(false);
  });

  // publicBeatUrl is an ALLOWLIST, not an exclusion list: the admin builder has
  // a free-text beat URL field, so anything other than our own reader URL can
  // only ever be an off-origin, protocol-downgraded or protocol-relative host
  // handed straight to <source src> by the edition page.
  it('hands a public surface only its own reader URL shape', () => {
    expect(publicBeatUrl('https://cdn.example.test/beat.mp3')).toBeNull();
    expect(publicBeatUrl('http://cdn.example.test/beat.mp3')).toBeNull();
    expect(publicBeatUrl('//cdn.example.test/beat.mp3')).toBeNull();
    expect(publicBeatUrl(BEAT_READER_BASE)).toBeNull();
    expect(publicBeatUrl(`${BEAT_READER_BASE}/abc?download=1`)).toBe(`${BEAT_READER_BASE}/abc?download=1`);
    // …while the admin-facing diagnostic keeps answering its own question: a
    // third-party URL is a different problem from a pre-fix owner-only path, so
    // it is NOT legacy, and must not be reported as if it could be re-uploaded.
    expect(isLegacyBeatUrl('https://cdn.example.test/beat.mp3')).toBe(false);
  });
});

describe('GET /api/open-mic/beats/[fileKey]', () => {
  beforeEach(() => {
    hasR2Config.mockReturnValue(false);
    readLocalUpload.mockReset();
  });

  it('serves a beat key inline with an audio content type and immutable caching', async () => {
    readLocalUpload.mockResolvedValue(Buffer.from([1, 2, 3]));
    const res = await get(encodeBeatFileKey('openmic-beats/c1/u.mp3'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('content-disposition')).toBe('inline');
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('switches to an attachment disposition for ?download=1', async () => {
    readLocalUpload.mockResolvedValue(Buffer.from([1]));
    const res = await get(encodeBeatFileKey('openmic-beats/c1/u.mp3'), '?download=1');
    expect(res.headers.get('content-disposition')).toContain('attachment');
  });

  it('404s — never 403 — for any other prefix, so the route cannot probe private objects', async () => {
    for (const key of [
      'registration/user-1/passport.pdf',
      'contests/banners/abc.png',
      'openmic-beats/../../registration/passport.pdf',
    ]) {
      expect((await get(encodeBeatFileKey(key))).status).toBe(404);
    }
    expect(readLocalUpload).not.toHaveBeenCalled();
  });

  it('404s a missing file and a malformed key', async () => {
    readLocalUpload.mockResolvedValue(null);
    expect((await get(encodeBeatFileKey('openmic-beats/c1/gone.mp3'))).status).toBe(404);
    expect((await get('%%%')).status).toBe(404);
  });

  // A padded key decodes to a real object path but is not one we ever minted:
  // the reader must refuse it before touching storage, not serve it.
  it('404s a padded base64url key without touching storage', async () => {
    const valid = encodeBeatFileKey('openmic-beats/c1/u.mp3');
    for (const padded of [`${valid}=`, `${valid}==`]) {
      expect((await get(padded)).status).toBe(404);
    }
    expect(readLocalUpload).not.toHaveBeenCalled();
  });
});

// Production is the R2 branch: existence check, then a 302 to a short-lived
// signed GET whose disposition is the only thing that makes `?download=1` mean
// anything there. Mocked shapes are asserted through real behaviour — status,
// the Location header, and the arguments the route hands the signing helper.
describe('GET /api/open-mic/beats/[fileKey] with R2 configured', () => {
  const fileKey = encodeBeatFileKey('openmic-beats/c1/u.mp3');
  const signedUrl = 'https://signed.example.test/openmic-beats/c1/u.mp3?token=abc';

  beforeEach(() => {
    hasR2Config.mockReturnValue(true);
    readLocalUpload.mockReset();
    assertR2ObjectExists.mockReset().mockResolvedValue(undefined);
    createR2DownloadUrl.mockReset().mockResolvedValue(signedUrl);
  });

  afterEach(() => {
    // Never leak the flag into the local-disk suite above.
    hasR2Config.mockReturnValue(false);
  });

  it('302s ?download=1 to a signed attachment GET for the decoded key', async () => {
    const res = await get(fileKey, '?download=1');

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(signedUrl);
    expect(assertR2ObjectExists).toHaveBeenCalledWith('openmic-beats/c1/u.mp3');
    expect(createR2DownloadUrl).toHaveBeenCalledWith({
      key: 'openmic-beats/c1/u.mp3',
      fileName: 'u.mp3',
      disposition: 'attachment',
    });
    // R2 configured means the bytes are not on this disk: never read it.
    expect(readLocalUpload).not.toHaveBeenCalled();
  });

  it('uses an inline disposition when only playing the beat', async () => {
    const res = await get(fileKey);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(signedUrl);
    expect(createR2DownloadUrl).toHaveBeenCalledWith({
      key: 'openmic-beats/c1/u.mp3',
      fileName: 'u.mp3',
      disposition: 'inline',
    });
  });

  it('404s a missing object and signs nothing', async () => {
    assertR2ObjectExists.mockRejectedValue(new Error('NotFound'));

    const res = await get(fileKey, '?download=1');

    expect(res.status).toBe(404);
    expect(res.headers.get('location')).toBeNull();
    expect(createR2DownloadUrl).not.toHaveBeenCalled();
  });
});

import { ApiError } from '@/src/lib/api/responses';
import { POST } from '@/app/api/admin/open-mic/beats/route';

function beatUploadRequest(opts: { name?: string; type?: string; contestId?: string | null; bytes?: number } = {}) {
  const form = new FormData();
  const body = new Uint8Array(opts.bytes ?? 3);
  form.append('file', new File([body], opts.name ?? 'beat.mp3', { type: opts.type ?? 'audio/mpeg' }));
  if (opts.contestId !== null) form.append('contestId', opts.contestId ?? 'contest-9');
  const query = opts.contestId ? `?contestId=${encodeURIComponent(opts.contestId)}` : '';
  return new Request(`https://web.example.test/api/admin/open-mic/beats${query}`, { method: 'POST', body: form });
}

describe('POST /api/admin/open-mic/beats', () => {
  beforeEach(() => {
    assertAdminPermission.mockReset();
    assertAdminPermission.mockResolvedValue({ role: 'admin', actorId: 'user-1' });
    saveLocalUpload.mockReset();
    saveLocalUpload.mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('stores the bytes under openmic-beats/<contestId>/ and returns relative reader paths', async () => {
    const res = await POST(beatUploadRequest());
    expect(res.status).toBe(201);
    const { beat } = await res.json();
    expect(beat.objectKey).toMatch(/^openmic-beats\/contest-9\/[0-9a-f-]+\.mp3$/);
    expect(beat.previewUrl).toBe(`/api/open-mic/beats/${encodeBeatFileKey(beat.objectKey)}`);
    expect(beat.downloadUrl).toBe(`${beat.previewUrl}?download=1`);
    expect(saveLocalUpload.mock.calls[0][0]).toBe(beat.objectKey);
    expect(saveLocalUpload.mock.calls[0][1]).toBeInstanceOf(Buffer);
  });

  it('namespaces under "unassigned" when no contest id is sent, because the builder has no id yet', async () => {
    const res = await POST(beatUploadRequest({ contestId: null }));
    expect((await res.json()).beat.objectKey).toMatch(/^openmic-beats\/unassigned\//);
  });

  it('refuses a contestId that is not a safe path token', async () => {
    const res = await POST(beatUploadRequest({ contestId: '../../registration' }));
    expect(res.status).toBe(400);
    expect(saveLocalUpload).not.toHaveBeenCalled();
  });

  // A dot-dot id survives the character class but not the public reader's own
  // `!key.includes('..')` check, so accepting it would 201 a beat URL that 404s
  // forever — the store/serve pairing is the one thing this route must keep.
  it('refuses a contestId the public reader would not serve', async () => {
    for (const contestId of ['..', 'a..b']) {
      expect((await POST(beatUploadRequest({ contestId }))).status).toBe(400);
    }
    expect(saveLocalUpload).not.toHaveBeenCalled();
  });

  it('accepts both mp3 spellings a browser reports', async () => {
    expect((await POST(beatUploadRequest({ type: 'audio/mpeg' }))).status).toBe(201);
    expect((await POST(beatUploadRequest({ type: 'audio/mp3' }))).status).toBe(201);
  });

  it('rejects a non-mp3 name, a mismatched declared type, and anything over 50MB', async () => {
    expect((await POST(beatUploadRequest({ name: 'beat.wav' }))).status).toBe(400);
    expect((await POST(beatUploadRequest({ type: 'text/html' }))).status).toBe(400);
    expect((await POST(beatUploadRequest({ bytes: 51 * 1024 * 1024 }))).status).toBe(400);
    expect(saveLocalUpload).not.toHaveBeenCalled();
  });

  it('gates BEFORE reading the body: a forbidden caller stores nothing', async () => {
    assertAdminPermission.mockRejectedValue(new ApiError('Forbidden', 403));
    const res = await POST(beatUploadRequest());
    expect(res.status).toBe(403);
    expect(saveLocalUpload).not.toHaveBeenCalled();
  });

  // The observable half of "before reading the body": a forbidden caller with a
  // malformed request gets the auth status, never the 415 that parsing the body
  // would have produced — so nothing about our payload rules leaks to them.
  it('answers 403 rather than 415 when a forbidden caller sends a non-multipart body', async () => {
    assertAdminPermission.mockRejectedValue(new ApiError('Forbidden', 403));
    const res = await POST(
      new Request('https://web.example.test/api/admin/open-mic/beats', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'not a form',
      }),
    );
    expect(res.status).toBe(403);
    expect(saveLocalUpload).not.toHaveBeenCalled();
  });
});
