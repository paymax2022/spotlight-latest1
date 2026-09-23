/**
 * Cloudinary vendor client tests (G-IMG / TS-3).
 *
 * All HTTP calls are mocked via vi.stubGlobal('fetch', ...) — same pattern as
 * tests/unit/utility/vtpass-adapter.spec.ts. No real Cloudinary API is hit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const OLD_ENV = {
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
};

function setCloudinaryEnv() {
  process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
  process.env.CLOUDINARY_API_KEY = 'test-api-key';
  process.env.CLOUDINARY_API_SECRET = 'test-api-secret';
}

function clearCloudinaryEnv() {
  delete process.env.CLOUDINARY_CLOUD_NAME;
  delete process.env.CLOUDINARY_API_KEY;
  delete process.env.CLOUDINARY_API_SECRET;
}

function restoreEnv() {
  for (const [key, value] of Object.entries(OLD_ENV)) {
    if (value === undefined) delete process.env[key as keyof typeof OLD_ENV];
    else process.env[key as keyof typeof OLD_ENV] = value;
  }
}

describe('Cloudinary media client', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv();
  });

  describe('moderatePhoto', () => {
    it('approves when Cloudinary reports an approved moderation verdict', async () => {
      setCloudinaryEnv();
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/v1/photo.jpg',
            moderation: [{ kind: 'aws_rek', status: 'approved' }],
          }),
          { status: 200 }
        )
      );

      const { moderatePhoto } = await import('@/src/lib/media/cloudinary');
      const result = await moderatePhoto('https://example.com/raw-photo.jpg');

      expect(result.approved).toBe(true);
      expect(result.notConfigured).toBeUndefined();
    });

    it('rejects when Cloudinary reports a rejected moderation verdict', async () => {
      setCloudinaryEnv();
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/v1/photo.jpg',
            moderation: [{ kind: 'aws_rek', status: 'rejected', response: [{ name: 'Explicit Nudity' }] }],
          }),
          { status: 200 }
        )
      );

      const { moderatePhoto } = await import('@/src/lib/media/cloudinary');
      const result = await moderatePhoto('https://example.com/raw-photo.jpg');

      expect(result.approved).toBe(false);
      expect(result.reason).toMatch(/Explicit Nudity/);
    });

    it('fails closed (approved:false) on an HTTP error from Cloudinary', async () => {
      setCloudinaryEnv();
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Invalid signature' } }), { status: 401 })
      );

      const { moderatePhoto } = await import('@/src/lib/media/cloudinary');
      const result = await moderatePhoto('https://example.com/raw-photo.jpg');

      expect(result.approved).toBe(false);
      expect(result.notConfigured).toBeUndefined();
    });

    it('fails closed on a malformed (non-JSON) response', async () => {
      setCloudinaryEnv();
      vi.mocked(fetch).mockResolvedValueOnce(new Response('<html>not json</html>', { status: 200 }));

      const { moderatePhoto } = await import('@/src/lib/media/cloudinary');
      const result = await moderatePhoto('https://example.com/raw-photo.jpg');

      expect(result.approved).toBe(false);
    });

    it('fails closed when the moderation field is absent from an otherwise-OK response', async () => {
      setCloudinaryEnv();
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ secure_url: 'https://res.cloudinary.com/x/image/upload/v1/photo.jpg' }), {
          status: 200,
        })
      );

      const { moderatePhoto } = await import('@/src/lib/media/cloudinary');
      const result = await moderatePhoto('https://example.com/raw-photo.jpg');

      expect(result.approved).toBe(false);
    });

    it('fails closed on a network-level fetch rejection', async () => {
      setCloudinaryEnv();
      vi.mocked(fetch).mockRejectedValueOnce(new Error('network unreachable'));

      const { moderatePhoto } = await import('@/src/lib/media/cloudinary');
      const result = await moderatePhoto('https://example.com/raw-photo.jpg');

      expect(result.approved).toBe(false);
      expect(result.reason).toMatch(/network unreachable/);
    });

    it('reports notConfigured:true and does not call fetch when env vars are missing', async () => {
      clearCloudinaryEnv();

      const { moderatePhoto } = await import('@/src/lib/media/cloudinary');
      const result = await moderatePhoto('https://example.com/raw-photo.jpg');

      expect(result.notConfigured).toBe(true);
      expect(result.approved).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('removeBackground', () => {
    it('returns the Cloudinary delivery URL on success', async () => {
      setCloudinaryEnv();
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/v1/cutout.png',
          }),
          { status: 200 }
        )
      );

      const { removeBackground } = await import('@/src/lib/media/cloudinary');
      const result = await removeBackground('https://example.com/raw-photo.jpg');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.resultUrl).toBe('https://res.cloudinary.com/test-cloud/image/upload/v1/cutout.png');
      }
    });

    it('sends the stripprofile flag to guarantee EXIF/GPS is stripped on delivery (D-006)', async () => {
      setCloudinaryEnv();
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/v1/cutout.png' }), {
          status: 200,
        })
      );

      const { removeBackground } = await import('@/src/lib/media/cloudinary');
      await removeBackground('https://example.com/raw-photo.jpg');

      const call = vi.mocked(fetch).mock.calls[0];
      const body = String(call[1]?.body);
      expect(body).toContain('flags=stripprofile');
      expect(body).toContain('background_removal=cloudinary_ai');
    });

    it('returns ok:false (never throws) on an HTTP error', async () => {
      setCloudinaryEnv();
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), { status: 402 })
      );

      const { removeBackground } = await import('@/src/lib/media/cloudinary');
      const result = await removeBackground('https://example.com/raw-photo.jpg');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/quota exceeded/);
      }
    });

    it('returns ok:false when secure_url is missing from an otherwise-OK response', async () => {
      setCloudinaryEnv();
      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

      const { removeBackground } = await import('@/src/lib/media/cloudinary');
      const result = await removeBackground('https://example.com/raw-photo.jpg');

      expect(result.ok).toBe(false);
    });

    it('reports notConfigured:true and does not call fetch when env vars are missing', async () => {
      clearCloudinaryEnv();

      const { removeBackground } = await import('@/src/lib/media/cloudinary');
      const result = await removeBackground('https://example.com/raw-photo.jpg');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.notConfigured).toBe(true);
      }
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
