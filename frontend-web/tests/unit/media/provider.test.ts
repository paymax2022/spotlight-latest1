/**
 * @file tests/unit/media/provider.test.ts
 *
 * The seam between the photo job runner and whatever vendor is configured
 * (spec §5, §10). Two promises are under test here, and both are the kind a
 * reviewer cannot see by reading `cloudinary.ts`:
 *
 *   1. a configuration surface reports the NAMES of missing variables and never
 *      their values — this object is what an admin screen and the job ledger
 *      will render, so one echoed secret would put a vendor API secret in front
 *      of every operator with access to /admin; and
 *   2. when creds are absent the seam answers with a result, it does not reach
 *      the network. The runner keeps its own fail-closed rule, and that rule
 *      only holds if "not configured" is distinguishable from "vendor said no".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Only the two network calls are faked. The env helpers stay real, because the
// whole point of the seam is that readiness is decided by the same list
// `cloudinary.ts` reads — mocking that away would let a drifted duplicate of
// the contract pass this file.
vi.mock('@/src/lib/media/cloudinary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/media/cloudinary')>();
  return {
    ...actual,
    moderatePhoto: vi.fn(async () => ({ approved: true })),
    removeBackground: vi.fn(async () => ({ ok: true, resultUrl: 'https://cdn/x.png' })),
  };
});

import { getPhotoProvider, photoProviderConfig } from '@/src/lib/media/provider';
import { moderatePhoto, removeBackground } from '@/src/lib/media/cloudinary';

describe('photo provider seam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
  });

  it('reports not-configured with the exact missing variable names, never values', () => {
    process.env.CLOUDINARY_API_KEY = 'k';
    const cfg = photoProviderConfig();
    expect(cfg.configured).toBe(false);
    expect(cfg.missing).toEqual(['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_SECRET']);
    expect(JSON.stringify(cfg)).not.toContain('k');
  });

  it('delegates to the Cloudinary client when all three vars exist', async () => {
    process.env.CLOUDINARY_CLOUD_NAME = 'paymax';
    process.env.CLOUDINARY_API_KEY = 'k';
    process.env.CLOUDINARY_API_SECRET = 's';
    const provider = getPhotoProvider();
    expect(provider.name).toBe('cloudinary');
    expect(provider.configured).toBe(true);
    await expect(provider.extractBackground('https://example.test/a.jpg')).resolves.toEqual({
      ok: true,
      resultUrl: 'https://cdn/x.png',
    });
    expect(removeBackground).toHaveBeenCalledWith('https://example.test/a.jpg');
    await expect(provider.moderate('https://example.test/a.jpg')).resolves.toEqual({ approved: true });
    expect(moderatePhoto).toHaveBeenCalledTimes(1);
  });

  it('answers notConfigured without calling the vendor when creds are absent', async () => {
    const provider = getPhotoProvider();
    expect(provider.name).toBe('none');
    await expect(provider.extractBackground('https://example.test/a.jpg')).resolves.toMatchObject({
      ok: false,
      notConfigured: true,
    });
    expect(removeBackground).not.toHaveBeenCalled();
  });

  // Moderation is the fail-closed gate (IMG-001 / SEC-010). An unconfigured
  // vendor must never read as "approved" to the runner, or a missing secret
  // would silently publish unmoderated contestant photos.
  it('fails moderation closed when unconfigured', async () => {
    const provider = getPhotoProvider();
    await expect(provider.moderate('https://example.test/a.jpg')).resolves.toMatchObject({
      approved: false,
      notConfigured: true,
    });
    expect(moderatePhoto).not.toHaveBeenCalled();
  });
});
