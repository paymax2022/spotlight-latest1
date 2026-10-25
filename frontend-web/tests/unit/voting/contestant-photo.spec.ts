// A contestants.photo_url is an upload response, a private preview route, or a
// plain URL — and only the last of those renders for a voter or a share crawler.
// The reader's job is to sign the key and never hand back the private route.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createR2DownloadUrl = vi.hoisted(() => vi.fn());
const hasR2Config = vi.hoisted(() => vi.fn(() => true));
vi.mock('@/src/lib/storage/r2', () => ({ createR2DownloadUrl, hasR2Config }));

import { contestantPhotoObjectKey, resolveContestantPhotoUrl } from '@/src/lib/storage/contestant-photo';

const KEY = 'registration/4762acdb-e3c6-4d03-92e7-b5d9411b82e3/40b36f1d.png';
const ROUTE = `/api/registration/uploads/${Buffer.from(KEY).toString('base64url')}`;

beforeEach(() => {
  createR2DownloadUrl.mockReset();
  createR2DownloadUrl.mockImplementation(async ({ key }: { key: string }) => `https://r2.example/${key}?sig=abc`);
  hasR2Config.mockReturnValue(true);
});

describe('contestantPhotoObjectKey', () => {
  it('reads the key out of every shape the column holds', () => {
    const cases: [string, string][] = [
      [JSON.stringify({ fileName: 'a.png', previewUrl: ROUTE, storageKey: KEY }), KEY],
      [JSON.stringify({ previewUrl: ROUTE }), KEY],
      [ROUTE, KEY],
      [KEY, KEY],
      [`/${KEY}`, KEY],
      [`${ROUTE}?signed=1`, KEY],
    ];
    for (const [stored, want] of cases) expect(contestantPhotoObjectKey(stored)).toBe(want);
  });

  it('refuses anything that is not ours to sign', () => {
    for (const stored of [
      'https://cdn.example/photo.jpg',
      '',
      null,
      undefined,
      '{"fileName":',
      JSON.stringify({ storageKey: 'registration/../auth/seeds.sql' }),
      JSON.stringify({ storageKey: 'contests/banners/x.png' }),
      '/api/registration/uploads/not-base64-%25',
    ]) {
      expect(contestantPhotoObjectKey(stored)).toBeNull();
    }
  });
});

describe('resolveContestantPhotoUrl', () => {
  it('signs our own key', async () => {
    await expect(resolveContestantPhotoUrl(JSON.stringify({ storageKey: KEY }))).resolves.toBe(
      `https://r2.example/${KEY}?sig=abc`
    );
    expect(createR2DownloadUrl).toHaveBeenCalledWith(expect.objectContaining({ key: KEY }));
  });

  it('keeps a long TTL for OG images and honours a short one for page images', async () => {
    await resolveContestantPhotoUrl(KEY);
    expect(createR2DownloadUrl).toHaveBeenLastCalledWith(expect.objectContaining({ expiresIn: 7 * 24 * 60 * 60 }));

    createR2DownloadUrl.mockClear();
    await resolveContestantPhotoUrl(KEY, 60);
    expect(createR2DownloadUrl).toHaveBeenCalledWith(expect.objectContaining({ expiresIn: 60 }));
  });

  it('passes an external or same-origin path through without touching R2', async () => {
    await expect(resolveContestantPhotoUrl('https://cdn.example/photo.jpg')).resolves.toBe('https://cdn.example/photo.jpg');
    await expect(resolveContestantPhotoUrl('/assets/img/shape/banner-home.png')).resolves.toBe(
      '/assets/img/shape/banner-home.png'
    );
    expect(createR2DownloadUrl).not.toHaveBeenCalled();
  });

  // The private upload route is worse than no photo: it 403s for everyone but
  // the uploader, so the page shows a broken image where a fallback belongs.
  it('returns null rather than a route it cannot sign', async () => {
    hasR2Config.mockReturnValue(false);
    await expect(resolveContestantPhotoUrl(ROUTE)).resolves.toBeNull();

    hasR2Config.mockReturnValue(true);
    createR2DownloadUrl.mockRejectedValueOnce(new Error('R2 down'));
    await expect(resolveContestantPhotoUrl(ROUTE)).resolves.toBeNull();
  });

  it('is null when there is no photo at all', async () => {
    await expect(resolveContestantPhotoUrl('')).resolves.toBeNull();
    await expect(resolveContestantPhotoUrl(null)).resolves.toBeNull();
  });
});
