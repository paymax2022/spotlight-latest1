// `serveContestantPhoto` is the half that knows where the bytes actually are.
//
// The registration upload route writes to R2 when this app has credentials and
// to its own disk when it does not, so a signed URL is not evidence that an
// object exists — it is the failure a developer sees as a missing profile
// picture (valid signature, 404 NoSuchKey). These tests pin the three answers
// and the order they can be trusted in.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasR2Config = vi.hoisted(() => vi.fn(() => true));
const assertR2ObjectExists = vi.hoisted(() => vi.fn(async () => undefined));
const createR2DownloadUrl = vi.hoisted(() => vi.fn());
const readLocalUpload = vi.hoisted(() => vi.fn());
const contentTypeForKey = vi.hoisted(() => vi.fn(() => 'image/jpeg'));

vi.mock('@/src/lib/storage/r2', () => ({ hasR2Config, assertR2ObjectExists, createR2DownloadUrl }));
vi.mock('@/src/lib/storage/local-uploads', () => ({ readLocalUpload, contentTypeForKey }));

import { serveContestantPhoto } from '@/src/lib/storage/contestant-photo';

const KEY = 'registration/4762acdb-e3c6-4d03-92e7-b5d9411b82e3/84f62294.jpeg';
const BLOB = JSON.stringify({
  fileName: '84f62294.jpeg',
  previewUrl: `/api/registration/uploads/${Buffer.from(KEY).toString('base64url')}`,
  storageKey: KEY,
});

beforeEach(() => {
  hasR2Config.mockReturnValue(true);
  assertR2ObjectExists.mockReset();
  assertR2ObjectExists.mockImplementation(async () => undefined);
  createR2DownloadUrl.mockReset();
  createR2DownloadUrl.mockImplementation(async ({ key }: { key: string }) => `https://r2.example/${key}?sig=abc`);
  readLocalUpload.mockReset();
});

describe('serveContestantPhoto with the bucket configured', () => {
  it('redirects to a signed GET once it has confirmed the object', async () => {
    const res = await serveContestantPhoto(BLOB);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(`https://r2.example/${KEY}?sig=abc`);
    expect(assertR2ObjectExists).toHaveBeenCalledWith(KEY);
  });

  // The defect this guard exists for: the key parses, the signature is valid,
  // the bucket has never heard of the object, and the screen shows nothing.
  it('404s instead of signing an object the bucket does not have', async () => {
    assertR2ObjectExists.mockRejectedValue(new Error('NotFound'));
    const res = await serveContestantPhoto(BLOB);
    expect(res.status).toBe(404);
    expect(createR2DownloadUrl).not.toHaveBeenCalled();
  });
});

describe('serveContestantPhoto without bucket credentials', () => {
  it('serves the bytes from this server’s disk, typed and uncacheable', async () => {
    hasR2Config.mockReturnValue(false);
    readLocalUpload.mockResolvedValue(Buffer.from('fake-jpeg-bytes'));
    const res = await serveContestantPhoto(BLOB);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-length')).toBe('15');
    expect(createR2DownloadUrl).not.toHaveBeenCalled();
    expect(await res.text()).toBe('fake-jpeg-bytes');
  });

  it('404s when neither store has it', async () => {
    hasR2Config.mockReturnValue(false);
    readLocalUpload.mockResolvedValue(null);
    const res = await serveContestantPhoto(BLOB);
    expect(res.status).toBe(404);
  });

  // Never the private preview route: it 403s for everyone but the uploader, and
  // a 403 is what made the roster show a broken image rather than a placeholder.
  it('never answers from the uploader-only preview route', async () => {
    hasR2Config.mockReturnValue(false);
    readLocalUpload.mockResolvedValue(null);
    const res = await serveContestantPhoto(`/api/registration/uploads/${Buffer.from(KEY).toString('base64url')}`);
    expect(res.status).toBe(404);
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('serveContestantPhoto for a photo this app does not store', () => {
  it('redirects to the pasted external URL', async () => {
    const res = await serveContestantPhoto('https://cdn.example/photo.jpg');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://cdn.example/photo.jpg');
  });

  it('404s an empty column', async () => {
    expect((await serveContestantPhoto(null)).status).toBe(404);
    expect((await serveContestantPhoto('')).status).toBe(404);
  });
});
