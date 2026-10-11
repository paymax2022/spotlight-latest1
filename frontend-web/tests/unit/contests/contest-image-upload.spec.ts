// Contest banner + logo upload and the public GET that serves them.
//
// The logo reuses the banner pipeline (same admin permission, same R2/local
// storage, same public GET) under its own key prefix. The two things that must
// not regress: the banner keeps its prefix and behaviour, and the PUBLIC GET
// never becomes a reader for the private registration documents that share the
// bucket (it only serves contests/banners/ and contests/logos/ keys).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const assertAdminPermission = vi.hoisted(() => vi.fn());
vi.mock('@/src/server/admin/auth', () => ({ assertAdminPermission }));

const saveLocalUpload = vi.hoisted(() => vi.fn());
const readLocalUpload = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/storage/local-uploads', () => ({
  saveLocalUpload,
  readLocalUpload,
  contentTypeForKey: (key: string) => (key.endsWith('.png') ? 'image/png' : 'image/jpeg'),
}));

vi.mock('@/src/lib/storage/r2', () => ({
  hasR2Config: () => false,
  createR2UploadUrl: vi.fn(),
  assertR2ObjectExists: vi.fn(),
  createR2DownloadUrl: vi.fn(),
}));

import { ApiError } from '@/src/lib/api/responses';
import { POST } from '@/app/api/admin/contests/banner/route';
import { GET } from '@/app/api/admin/contests/banner/[fileKey]/route';

const ORIGIN = 'https://web.example.test';

function uploadRequest(opts: { name?: string; kind?: string; omitFile?: boolean } = {}) {
  const form = new FormData();
  if (!opts.omitFile) {
    form.append('file', new File([new Uint8Array([1, 2, 3, 4])], opts.name ?? 'pic.png', { type: 'image/png' }));
  }
  if (opts.kind !== undefined) form.append('kind', opts.kind);
  return new Request(`${ORIGIN}/api/admin/contests/banner`, { method: 'POST', body: form });
}

const keyFromUrl = (url: string) =>
  Buffer.from(url.split('/api/admin/contests/banner/')[1], 'base64url').toString('utf8');

beforeEach(() => {
  assertAdminPermission.mockReset();
  assertAdminPermission.mockResolvedValue(undefined);
  saveLocalUpload.mockReset();
  saveLocalUpload.mockResolvedValue(undefined);
  readLocalUpload.mockReset();
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', ORIGIN);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/admin/contests/banner (upload)', () => {
  it('keeps the banner under contests/banners/ when no kind is sent (unchanged behaviour)', async () => {
    const res = await POST(uploadRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(keyFromUrl(body.upload.url)).toMatch(/^contests\/banners\/[0-9a-f-]+\.png$/);
    expect(saveLocalUpload.mock.calls[0][0]).toMatch(/^contests\/banners\//);
  });

  it('stores a logo under contests/logos/ and returns an absolute URL for it', async () => {
    const res = await POST(uploadRequest({ kind: 'logo' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.upload.url.startsWith(`${ORIGIN}/api/admin/contests/banner/`)).toBe(true);
    expect(keyFromUrl(body.upload.url)).toMatch(/^contests\/logos\/[0-9a-f-]+\.png$/);
    expect(saveLocalUpload.mock.calls[0][0]).toMatch(/^contests\/logos\//);
  });

  it('rejects an unknown kind instead of guessing a prefix', async () => {
    const res = await POST(uploadRequest({ kind: '../../registration' }));
    expect(res.status).toBe(400);
    expect(saveLocalUpload).not.toHaveBeenCalled();
  });

  it('rejects a non-image and names the logo in the message', async () => {
    const res = await POST(uploadRequest({ kind: 'logo', name: 'evil.exe' }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/logo/i);
    expect(saveLocalUpload).not.toHaveBeenCalled();
  });

  it('requires a file', async () => {
    const res = await POST(uploadRequest({ kind: 'logo', omitFile: true }));
    expect(res.status).toBe(400);
  });

  it('is admin-gated BEFORE the body is read: a forbidden caller stores nothing', async () => {
    assertAdminPermission.mockRejectedValue(new ApiError('Forbidden', 403));
    const res = await POST(uploadRequest({ kind: 'logo' }));
    expect(res.status).toBe(403);
    expect(saveLocalUpload).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/contests/banner/[fileKey] (public serve)', () => {
  const enc = (key: string) => Buffer.from(key, 'utf8').toString('base64url');
  const get = (key: string) =>
    GET(new Request(`${ORIGIN}/x`), { params: Promise.resolve({ fileKey: enc(key) }) });

  it('serves a logo key', async () => {
    readLocalUpload.mockResolvedValue(Buffer.from([9, 9]));
    const res = await get('contests/logos/abc.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(readLocalUpload).toHaveBeenCalledWith('contests/logos/abc.png');
  });

  it('still serves a banner key', async () => {
    readLocalUpload.mockResolvedValue(Buffer.from([9, 9]));
    expect((await get('contests/banners/abc.jpg')).status).toBe(200);
  });

  it('never serves anything outside the two public prefixes (private documents stay private)', async () => {
    readLocalUpload.mockResolvedValue(Buffer.from([9]));
    for (const key of [
      'registration/documents/passport.png',
      'contests/other/abc.png',
      'contests/logos/../../registration/passport.png',
      'contests/banners/../secret.png',
    ]) {
      expect((await get(key)).status).toBe(404);
    }
    expect(readLocalUpload).not.toHaveBeenCalled();
  });

  it('404s a key that is not valid base64url', async () => {
    const res = await GET(new Request(`${ORIGIN}/x`), { params: Promise.resolve({ fileKey: '%%%' }) });
    expect(res.status).toBe(404);
  });
});
