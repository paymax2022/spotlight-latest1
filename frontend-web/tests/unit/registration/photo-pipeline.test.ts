/**
 * Photo pipeline orchestration tests (G-IMG / TS-3).
 *
 * Mocks the Cloudinary client, the Sharp compositor, and R2 storage — no
 * network/filesystem I/O. Covers: moderation reject, moderation not-configured
 * degrades safely, background-removal success (composited/cutout), background
 * removal failure falls back safely (never a broken/empty image), and the
 * no-template path used by the actual registration-review wiring.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/src/lib/media/cloudinary', () => ({
  moderatePhoto: vi.fn(),
  removeBackground: vi.fn(),
}));

vi.mock('@/src/lib/rendering/imageCompositor', () => ({
  compositeImage: vi.fn(),
}));

vi.mock('@/src/lib/storage/r2', () => ({
  uploadR2Object: vi.fn(),
  getR2PublicUrl: vi.fn(),
  hasR2Config: vi.fn(),
}));

import { moderatePhoto, removeBackground } from '@/src/lib/media/cloudinary';
import { compositeImage } from '@/src/lib/rendering/imageCompositor';
import { uploadR2Object, getR2PublicUrl, hasR2Config } from '@/src/lib/storage/r2';
import {
  processContestantPhoto,
  processContestantPhotoNoTemplate,
} from '@/src/server/registration/photo-pipeline';

const RAW_URL = 'https://example.com/raw-photo.jpg';
const CUTOUT_URL = 'https://res.cloudinary.com/test-cloud/image/upload/v1/cutout.png';

const SLOT = {
  id: 'slot-1',
  slot_name: 'Main',
  slot_type: 'contestant',
  slot_order: 0,
  x: 0,
  y: 0,
  width: 200,
  height: 200,
  rotation: 0,
  z_index: 1,
  scale: 1,
  crop_mode: 'cover' as const,
  border_radius: 0,
  opacity: 1,
};

const TEMPLATE_INPUT = {
  rawPhotoUrl: RAW_URL,
  templateUrl: 'https://res.cloudinary.com/test-cloud/image/upload/v1/template.png',
  templateWidth: 1080,
  templateHeight: 1080,
  slot: SLOT,
};

describe('processContestantPhotoNoTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects when moderation rejects the photo', async () => {
    vi.mocked(moderatePhoto).mockResolvedValueOnce({ approved: false, reason: 'Explicit content' });

    const result = await processContestantPhotoNoTemplate(RAW_URL);

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toMatch(/Explicit content/);
    }
    expect(removeBackground).not.toHaveBeenCalled();
  });

  it('skips moderation safely when Cloudinary is not configured (dev-only relaxation)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(moderatePhoto).mockResolvedValueOnce({ approved: false, notConfigured: true });
    vi.mocked(removeBackground).mockResolvedValueOnce({ ok: true, resultUrl: CUTOUT_URL });

    const result = await processContestantPhotoNoTemplate(RAW_URL);

    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.photoUrl).toBe(CUTOUT_URL);
    }
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('never treats an ambiguous (approved:false, notConfigured:undefined) moderation result as configured-skip', async () => {
    // This is the critical fail-closed check: notConfigured must be LITERALLY
    // true, not merely falsy/absent, for the skip to apply.
    vi.mocked(moderatePhoto).mockResolvedValueOnce({ approved: false, reason: 'malformed response' });

    const result = await processContestantPhotoNoTemplate(RAW_URL);

    expect(result.status).toBe('rejected');
    expect(removeBackground).not.toHaveBeenCalled();
  });

  it('returns ready with the cutout URL when background removal succeeds', async () => {
    vi.mocked(moderatePhoto).mockResolvedValueOnce({ approved: true });
    vi.mocked(removeBackground).mockResolvedValueOnce({ ok: true, resultUrl: CUTOUT_URL });

    const result = await processContestantPhotoNoTemplate(RAW_URL);

    expect(result).toEqual({ status: 'ready', photoUrl: CUTOUT_URL });
  });

  it('falls back to the raw photo URL (never a broken/empty image) when background removal fails', async () => {
    vi.mocked(moderatePhoto).mockResolvedValueOnce({ approved: true });
    vi.mocked(removeBackground).mockResolvedValueOnce({ ok: false, reason: 'provider timeout' });

    const result = await processContestantPhotoNoTemplate(RAW_URL);

    expect(result.status).toBe('fallback');
    if (result.status === 'fallback') {
      expect(result.photoUrl).toBe(RAW_URL);
      expect(result.photoUrl).toBeTruthy();
      expect(result.reason).toMatch(/provider timeout/);
    }
  });
});

describe('processContestantPhoto (full pipeline with template compositing)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects when moderation rejects the photo, without calling background removal or compositing', async () => {
    vi.mocked(moderatePhoto).mockResolvedValueOnce({ approved: false, reason: 'nudity detected' });

    const result = await processContestantPhoto(TEMPLATE_INPUT);

    expect(result.status).toBe('rejected');
    expect(removeBackground).not.toHaveBeenCalled();
    expect(compositeImage).not.toHaveBeenCalled();
  });

  it('composites the cutout and uploads to R2 on full success', async () => {
    vi.mocked(moderatePhoto).mockResolvedValueOnce({ approved: true });
    vi.mocked(removeBackground).mockResolvedValueOnce({ ok: true, resultUrl: CUTOUT_URL });
    vi.mocked(compositeImage).mockResolvedValueOnce({
      buffer: Buffer.from('fake-png-bytes'),
      mimeType: 'image/png',
      width: 1080,
      height: 1080,
    });
    vi.mocked(hasR2Config).mockReturnValue(true);
    vi.mocked(uploadR2Object).mockResolvedValueOnce(undefined);
    vi.mocked(getR2PublicUrl).mockReturnValue('https://cdn.example.com/contestants/composited/abc.png');

    const result = await processContestantPhoto(TEMPLATE_INPUT);

    expect(result).toEqual({
      status: 'ready',
      photoUrl: 'https://cdn.example.com/contestants/composited/abc.png',
    });
    expect(compositeImage).toHaveBeenCalledWith(
      expect.objectContaining({
        slots: [expect.objectContaining({ photo_url: CUTOUT_URL })],
      })
    );
  });

  it('falls back to compositing the RAW photo when background removal fails, and marks status fallback', async () => {
    vi.mocked(moderatePhoto).mockResolvedValueOnce({ approved: true });
    vi.mocked(removeBackground).mockResolvedValueOnce({ ok: false, reason: 'AI service unavailable' });
    vi.mocked(compositeImage).mockResolvedValueOnce({
      buffer: Buffer.from('fake-png-bytes'),
      mimeType: 'image/png',
      width: 1080,
      height: 1080,
    });
    vi.mocked(hasR2Config).mockReturnValue(true);
    vi.mocked(uploadR2Object).mockResolvedValueOnce(undefined);
    vi.mocked(getR2PublicUrl).mockReturnValue('https://cdn.example.com/contestants/composited/raw.png');

    const result = await processContestantPhoto(TEMPLATE_INPUT);

    expect(result.status).toBe('fallback');
    if (result.status === 'fallback') {
      expect(result.photoUrl).toBe('https://cdn.example.com/contestants/composited/raw.png');
      expect(result.reason).toMatch(/AI service unavailable/);
    }
    // Raw photo URL passed into the slot instead of a cutout.
    expect(compositeImage).toHaveBeenCalledWith(
      expect.objectContaining({
        slots: [expect.objectContaining({ photo_url: RAW_URL })],
      })
    );
  });

  it('falls all the way back to the raw photo URL (never a broken/empty image) when compositing itself fails', async () => {
    vi.mocked(moderatePhoto).mockResolvedValueOnce({ approved: true });
    vi.mocked(removeBackground).mockResolvedValueOnce({ ok: true, resultUrl: CUTOUT_URL });
    vi.mocked(compositeImage).mockRejectedValueOnce(new Error('template unreachable'));

    const result = await processContestantPhoto(TEMPLATE_INPUT);

    expect(result.status).toBe('fallback');
    if (result.status === 'fallback') {
      expect(result.photoUrl).toBe(RAW_URL);
      expect(result.photoUrl).toBeTruthy();
      expect(result.reason).toMatch(/template unreachable/);
    }
    expect(uploadR2Object).not.toHaveBeenCalled();
  });

  it('falls back to the raw photo URL when compositing succeeds but R2 is not configured', async () => {
    vi.mocked(moderatePhoto).mockResolvedValueOnce({ approved: true });
    vi.mocked(removeBackground).mockResolvedValueOnce({ ok: true, resultUrl: CUTOUT_URL });
    vi.mocked(compositeImage).mockResolvedValueOnce({
      buffer: Buffer.from('fake-png-bytes'),
      mimeType: 'image/png',
      width: 1080,
      height: 1080,
    });
    vi.mocked(hasR2Config).mockReturnValue(false);

    const result = await processContestantPhoto(TEMPLATE_INPUT);

    expect(result.status).toBe('fallback');
    if (result.status === 'fallback') {
      expect(result.photoUrl).toBe(RAW_URL);
    }
  });
});
