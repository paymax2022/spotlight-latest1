/**
 * @file tests/unit/media/asset-source.test.ts
 *
 * Spec §2 defect 4, pinned down. What is stored in `form_data['media.photoUrl']`
 * today is the *relative* in-app route `/api/registration/uploads/<base64url(key)>`
 * (app/api/registration/uploads/route.ts:97). Cloudinary's upload API is handed a
 * URL and downloads it itself, server-side, so a path is not a source: the call
 * cannot resolve it, the moderation result comes back as a refusal, and the
 * fail-closed pipeline publishes nothing while the job says "moderation rejected".
 *
 * This unit is the only place that turns a stored value into something a vendor
 * can fetch, so the two things it must never do are under test: hand back a
 * non-fetchable value as if it were usable, and mint a permanent public link to a
 * contestant's original photograph.
 */
import { describe, expect, it, vi } from 'vitest';

const r2 = vi.hoisted(() => ({ hasConfig: false, downloadUrl: vi.fn() }));
vi.mock('@/src/lib/storage/r2', () => ({
  hasR2Config: () => r2.hasConfig,
  createR2DownloadUrl: r2.downloadUrl,
}));

import { decodeUploadRouteKey, resolveFetchableSource } from '@/src/lib/media/asset-source';

// The shape the upload route really mints: registration/<user id>/<uuid>.<ext>.
const key = 'registration/user-1/8f14e45f-ea29-4b88-9f3c-0a1b2c3d4e5f.jpg';
const route = `/api/registration/uploads/${Buffer.from(key, 'utf8').toString('base64url')}`;

describe('decodeUploadRouteKey', () => {
  it('recognises the upload route and recovers the object key', () => {
    expect(decodeUploadRouteKey(route)).toBe(key);
    expect(decodeUploadRouteKey('https://other.test/x.jpg')).toBeNull();
  });

  it('refuses a base64url body that does not decode to an upload key', () => {
    // A payload that decodes to arbitrary text must not become a storage key:
    // this function's output is what gets presigned.
    const junk = `/api/registration/uploads/${Buffer.from('../../etc/passwd', 'utf8').toString('base64url')}`;
    expect(decodeUploadRouteKey(junk)).toBeNull();
    const notBase64url = '/api/registration/uploads/!!!not-base64!!!';
    expect(decodeUploadRouteKey(notBase64url)).toBeNull();
  });
});

describe('resolveFetchableSource', () => {
  it('presigns the key into an absolute https URL the vendor can fetch', async () => {
    r2.hasConfig = true;
    r2.downloadUrl.mockResolvedValue(`https://bucket.r2.dev/${key}?X-Amz-Signature=sig`);
    const out = await resolveFetchableSource(route);
    expect(out).toMatchObject({ ok: true, objectKey: key, ttlSeconds: 600 });
    if (out.ok) expect(out.url).toMatch(/^https:\/\/.+\.jpg\?/);
    expect(r2.downloadUrl).toHaveBeenCalledWith(
      expect.objectContaining({ key, disposition: 'inline', expiresIn: 600 }),
    );
  });

  // The original is never made public: what the vendor gets is a time-boxed
  // presigned read, and a caller asking for a shorter window must not be ignored.
  it('honours a shorter ttl and never returns a permanent link', async () => {
    r2.hasConfig = true;
    r2.downloadUrl.mockResolvedValue('https://bucket.r2.dev/x?sig=1');
    const out = await resolveFetchableSource(route, { ttlSeconds: 120 });
    expect(out.ok && out.ttlSeconds).toBe(120);
    expect(r2.downloadUrl).toHaveBeenLastCalledWith(expect.objectContaining({ expiresIn: 120 }));
  });

  it('reports a relative route as unusable when there is no R2 to presign', async () => {
    r2.hasConfig = false;
    const out = await resolveFetchableSource(route);
    expect(out).toMatchObject({ ok: false, kind: 'notFetchable' });
    if (!out.ok) expect(out.reason).toMatch(/presign/i);
  });

  it('passes an already-absolute public url through untouched', async () => {
    const out = await resolveFetchableSource('https://pub-xyz.r2.dev/contestants/images/a.png');
    expect(out).toMatchObject({ ok: true, url: 'https://pub-xyz.r2.dev/contestants/images/a.png' });
    expect(r2.downloadUrl).not.toHaveBeenCalled();
  });

  // Mobile and old rows store the same route as an absolute URL. It is the same
  // object, so it must resolve the same way rather than being fetched (it is
  // owner-gated, so a vendor fetch of it would 401).
  it('presigns our own upload route when it arrives absolute', async () => {
    r2.hasConfig = true;
    r2.downloadUrl.mockResolvedValue('https://bucket.r2.dev/signed?sig=1');
    const out = await resolveFetchableSource(`https://www.spotlightng.com${route}`);
    expect(out).toMatchObject({ ok: true, objectKey: key });
    expect(r2.downloadUrl).toHaveBeenLastCalledWith(expect.objectContaining({ key }));
  });

  it('refuses a non-https or host-less value rather than handing it to the vendor', async () => {
    expect(await resolveFetchableSource('file:///tmp/x.jpg')).toMatchObject({ ok: false, kind: 'noProviderUrl' });
    expect(await resolveFetchableSource('')).toMatchObject({ ok: false, kind: 'noProviderUrl' });
    expect(await resolveFetchableSource('javascript:alert(1)')).toMatchObject({ ok: false, kind: 'noProviderUrl' });
    // A path that is not our upload route is its own kind of bad: there is no
    // key to presign and no host to fetch from, so guessing a site URL here
    // would only send the vendor to a 404 with a confident-looking reason.
    expect(await resolveFetchableSource('/uploads/other.png')).toMatchObject({ ok: false, kind: 'relative' });
  });

  it('preserves a presigning failure as an unusable source, not a crash', async () => {
    r2.hasConfig = true;
    r2.downloadUrl.mockRejectedValue(new Error('R2 credentials expired'));
    const out = await resolveFetchableSource(route);
    expect(out).toMatchObject({ ok: false, kind: 'notFetchable' });
    if (!out.ok) expect(out.reason).toMatch(/R2 credentials expired/);
  });
});
