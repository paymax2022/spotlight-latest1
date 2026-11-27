/**
 * Task 6 — the runner: turn one claimed job into a complete portrait, or into
 * nothing at all (spec §6, §7, acceptance criteria 4, 5 and 17).
 *
 * The asymmetry these tests defend is the one the spec calls out: a `ready`
 * job must guarantee a finished composite, while any failure publishes no
 * `final` row. A reader that finds a ready job therefore never has to guess
 * whether the portrait is half-built, and a failed job leaves the original
 * exactly where the registry put it.
 *
 * Every dependency is mocked at its module boundary, including `variants`,
 * because the compositor stub hands back `Buffer.from('final')` — not an image
 * sharp could decode. The resize itself is real and tested in variants.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  getPhotoProvider: vi.fn(),
  moderate: vi.fn(),
  extractBackground: vi.fn(),
  resolveFetchableSource: vi.fn(),
  compositeImage: vi.fn(),
  storePhoto: vi.fn(),
  readAssetBytes: vi.fn(),
  renderVariant: vi.fn(),
  getPhotoAsset: vi.fn(),
  upsertPhotoAsset: vi.fn(),
  setPhotoJobProgress: vi.fn(),
  completePhotoJob: vi.fn(),
  failPhotoJob: vi.fn(),
  cancelPhotoJob: vi.fn(),
  resolveActiveTemplateForContest: vi.fn(),
}));

vi.mock('@/src/lib/media/provider', () => ({ getPhotoProvider: deps.getPhotoProvider }));
vi.mock('@/src/lib/media/asset-source', () => ({ resolveFetchableSource: deps.resolveFetchableSource }));
vi.mock('@/src/lib/rendering/imageCompositor', () => ({ compositeImage: deps.compositeImage }));
vi.mock('@/src/server/photo-jobs/persist', () => ({ storePhoto: deps.storePhoto }));
vi.mock('@/src/server/photo-jobs/assets', () => ({ readAssetBytes: deps.readAssetBytes }));
vi.mock('@/src/server/photo-jobs/variants', () => ({ renderVariant: deps.renderVariant }));
vi.mock('@/src/server/registration/template-resolver', () => ({
  resolveActiveTemplateForContest: deps.resolveActiveTemplateForContest,
}));
vi.mock('@/src/server/photo-jobs/job-store', () => ({
  getPhotoAsset: deps.getPhotoAsset,
  upsertPhotoAsset: deps.upsertPhotoAsset,
  setPhotoJobProgress: deps.setPhotoJobProgress,
  completePhotoJob: deps.completePhotoJob,
  failPhotoJob: deps.failPhotoJob,
  cancelPhotoJob: deps.cancelPhotoJob,
}));

import { runPhotoJob } from '@/src/server/photo-jobs/runner';

const job = {
  id: 'job-1',
  run_key: 'photo:asset-o:tpl-1:abc',
  registration_id: 'reg-1',
  contest_id: 'contest-1',
  template_id: 'tpl-1',
  source_asset_id: 'asset-original',
  status: 'queued',
  progress: 0,
  attempt: 1,
  max_attempts: 6,
  last_error: null,
  render_params: { offsetX: 12 },
  result_asset_id: null,
};

const ORIGINAL = {
  id: 'asset-original',
  kind: 'original',
  storage_key: 'registration/u-1/photo.jpg',
  provider_url: null,
  content_type: 'image/jpeg',
  width: 682,
  height: 1080,
  bytes: 123456,
  render_params: {},
};

function slot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'slot-1', slot_name: 'Main', slot_type: 'contestant', slot_order: 0,
    x: 10, y: 20, width: 300, height: 400, rotation: 0, z_index: 1, scale: 1,
    crop_mode: 'cover', border_radius: 0, opacity: 1, ...overrides,
  };
}

function template(overrides: Record<string, unknown> = {}) {
  return {
    templateId: 'tpl-1',
    templateVersion: 4,
    templateUrl: 'https://cdn.test/template.png',
    templateWidth: 1080,
    templateHeight: 1350,
    slot: slot(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  deps.getPhotoProvider.mockReturnValue({
    name: 'cloudinary',
    configured: true,
    missing: [],
    extractBackground: deps.extractBackground,
    moderate: deps.moderate,
  });
  deps.moderate.mockResolvedValue({ approved: true });
  deps.extractBackground.mockResolvedValue({ ok: true, resultUrl: 'https://cut.test/x.png' });
  deps.resolveFetchableSource.mockResolvedValue({
    ok: true, url: 'https://signed.test/photo.jpg', objectKey: ORIGINAL.storage_key, ttlSeconds: 600,
  });
  deps.getPhotoAsset.mockResolvedValue(ORIGINAL);
  deps.readAssetBytes.mockResolvedValue(Buffer.from('raw-bytes'));
  deps.resolveActiveTemplateForContest.mockResolvedValue(template());
  deps.compositeImage.mockResolvedValue({
    buffer: Buffer.from('final'), mimeType: 'image/png', width: 1080, height: 1350,
  });
  deps.storePhoto.mockResolvedValue('contestants/composited/uuid.png');
  deps.upsertPhotoAsset.mockResolvedValue('asset-new');
  deps.completePhotoJob.mockResolvedValue(true);
  deps.failPhotoJob.mockResolvedValue('failed');
  deps.renderVariant.mockResolvedValue({
    buffer: Buffer.from('variant'), mimeType: 'image/png', width: 320, height: 400,
  });
});

const kinds = () => deps.upsertPhotoAsset.mock.calls.map((call) => call[0].kind);

describe('runPhotoJob', () => {
  it('publishes transparent, final and both variants, then completes with the final id', async () => {
    expect(await runPhotoJob(job as never)).toBe('ready');

    expect(kinds()).toEqual(['transparent', 'final', 'preview', 'thumbnail']);
    expect(deps.completePhotoJob).toHaveBeenCalledWith('job-1', 'asset-new');

    // The composite must be built from the cutout, not the original, or the
    // whole feature is a rectangle pasted on a rectangle.
    const composited = deps.compositeImage.mock.calls[0][0];
    expect(composited.slots).toHaveLength(1);
    expect(composited.slots[0].photo_url).toBe('https://cut.test/x.png');
    expect(composited.templateUrl).toBe('https://cdn.test/template.png');
    expect(composited.templateWidth).toBe(1080);
  });

  it('records the template identity and the requested params on the final asset', async () => {
    await runPhotoJob(job as never);
    const final = deps.upsertPhotoAsset.mock.calls.find((call) => call[0].kind === 'final')![0];
    expect(final).toMatchObject({
      registrationId: 'reg-1',
      contestId: 'contest-1',
      templateId: 'tpl-1',
      templateVersion: 4,
      renderParams: { offsetX: 12 },
      storageKey: 'contestants/composited/uuid.png',
      contentType: 'image/png',
      width: 1080,
      height: 1350,
    });
  });

  it('fails without publishing a final asset when extraction fails', async () => {
    deps.extractBackground.mockResolvedValue({ ok: false, reason: 'background_removal add-on is disabled' });
    expect(await runPhotoJob(job as never)).toBe('failed');
    expect(deps.compositeImage).not.toHaveBeenCalled();
    expect(kinds()).not.toContain('final');
    expect(deps.failPhotoJob).toHaveBeenCalledWith('job-1', expect.stringContaining('add-on is disabled'));
    expect(deps.completePhotoJob).not.toHaveBeenCalled();
  });

  it('cancels on a moderation rejection and stores nothing', async () => {
    deps.moderate.mockResolvedValue({ approved: false, reason: 'Rejected: nudity' });
    expect(await runPhotoJob(job as never)).toBe('cancelled');
    expect(deps.cancelPhotoJob).toHaveBeenCalledWith('job-1', 'Rejected: nudity');
    expect(kinds()).toEqual([]);
    expect(deps.extractBackground).not.toHaveBeenCalled();
    expect(deps.failPhotoJob).not.toHaveBeenCalled();
  });

  it('keeps rendering when moderation is unconfigured, because that is a dev fault, not a verdict', async () => {
    deps.moderate.mockResolvedValue({ approved: false, notConfigured: true, reason: 'Cloudinary is not configured' });
    expect(await runPhotoJob(job as never)).toBe('ready');
    expect(deps.extractBackground).toHaveBeenCalled();
    expect(deps.cancelPhotoJob).not.toHaveBeenCalled();
  });

  it('cancels an ambiguous moderation answer instead of passing it to the vendor', async () => {
    // The distinction is the content-safety gate: `notConfigured` is the only
    // non-rejection that may pass, so a configured-but-unclear verdict must
    // never reach the compositor.
    deps.moderate.mockResolvedValue({ approved: false, reason: 'Moderation status not final/recognized: pending' });
    expect(await runPhotoJob(job as never)).toBe('cancelled');
    expect(deps.cancelPhotoJob).toHaveBeenCalledWith('job-1', 'Moderation status not final/recognized: pending');
    expect(deps.extractBackground).not.toHaveBeenCalled();
  });

  it('fails when the original asset row cannot be read', async () => {
    deps.getPhotoAsset.mockResolvedValue(null);
    expect(await runPhotoJob(job as never)).toBe('failed');
    expect(deps.failPhotoJob).toHaveBeenCalledWith('job-1', expect.stringContaining('source asset'));
    expect(deps.moderate).not.toHaveBeenCalled();
  });

  it('fails when the stored original has no bytes behind it', async () => {
    deps.readAssetBytes.mockResolvedValue(null);
    expect(await runPhotoJob(job as never)).toBe('failed');
    expect(deps.compositeImage).not.toHaveBeenCalled();
    expect(deps.failPhotoJob).toHaveBeenCalledWith('job-1', expect.stringContaining('unreadable'));
  });

  it('fails when the source cannot be given to the vendor, quoting the reason', async () => {
    deps.resolveFetchableSource.mockResolvedValue({ ok: false, kind: 'notFetchable', reason: 'R2 is not configured' });
    expect(await runPhotoJob(job as never)).toBe('failed');
    expect(deps.failPhotoJob).toHaveBeenCalledWith('job-1', expect.stringContaining('R2 is not configured'));
  });

  it('fails when the contest no longer resolves the template the job was queued for', async () => {
    deps.resolveActiveTemplateForContest.mockResolvedValue(template({ templateId: 'tpl-9', templateVersion: 1 }));
    expect(await runPhotoJob(job as never)).toBe('failed');
    expect(deps.compositeImage).not.toHaveBeenCalled();
    expect(deps.failPhotoJob).toHaveBeenCalledWith('job-1', expect.stringContaining('changed'));
    expect(kinds()).not.toContain('final');
  });

  it('fails when the contest has no template at all rather than publishing an unstyled portrait', async () => {
    deps.resolveActiveTemplateForContest.mockResolvedValue(null);
    expect(await runPhotoJob(job as never)).toBe('failed');
    expect(deps.failPhotoJob).toHaveBeenCalledWith('job-1', expect.stringContaining('no active template'));
  });

  it('a compositor throw becomes a failed job carrying the message', async () => {
    deps.compositeImage.mockRejectedValue(new Error('Failed to fetch image: template (404)'));
    expect(await runPhotoJob(job as never)).toBe('failed');
    expect(deps.failPhotoJob).toHaveBeenCalledWith('job-1', expect.stringContaining('template (404)'));
    expect(kinds()).toEqual(['transparent']);
  });

  it('fails when the final row cannot be recorded, even though the bytes were stored', async () => {
    deps.storePhoto.mockResolvedValue('contestants/composited/uuid.png');
    deps.upsertPhotoAsset
      .mockResolvedValueOnce('asset-transparent')
      .mockResolvedValueOnce(null);
    expect(await runPhotoJob(job as never)).toBe('failed');
    expect(deps.completePhotoJob).not.toHaveBeenCalled();
    expect(kinds()).not.toContain('preview');
  });

  it('a variant failure does not destroy a complete portrait', async () => {
    deps.renderVariant.mockRejectedValue(new Error('sharp refused the buffer'));
    expect(await runPhotoJob(job as never)).toBe('ready');
    expect(deps.completePhotoJob).toHaveBeenCalledWith('job-1', 'asset-new');
    expect(kinds()).toEqual(['transparent', 'final']);
  });

  it('walks the status sequence the mobile client is documented to show', async () => {
    await runPhotoJob(job as never);
    // No `ready` here: complete_photo_job sets status and progress in one
    // write, and a runner that also announced it would put two updates on the
    // row the client is watching — a flicker and a lost race for no gain.
    expect(deps.setPhotoJobProgress.mock.calls.map((call) => call.slice(1))).toEqual([
      ['extracting', 5],
      ['extracting', 35],
      ['compositing', 70],
    ]);
  });

  it('never reports ready when the completion write was refused', async () => {
    deps.completePhotoJob.mockResolvedValue(false);
    expect(await runPhotoJob(job as never)).toBe('failed');
    expect(deps.failPhotoJob).toHaveBeenCalledWith('job-1', expect.stringContaining('could not be marked ready'));
  });

  it('uses the provider name in errors so an operator can tell a vendor fault from ours', async () => {
    deps.getPhotoProvider.mockReturnValue({
      name: 'none', configured: false, missing: ['CLOUDINARY_API_KEY'],
      extractBackground: vi.fn().mockResolvedValue({ ok: false, notConfigured: true, reason: 'no provider' }),
      moderate: deps.moderate,
    });
    deps.moderate.mockResolvedValue({ approved: false, notConfigured: true });
    expect(await runPhotoJob(job as never)).toBe('failed');
    expect(deps.failPhotoJob.mock.calls[0][1]).toMatch(/provider|Cloudinary/);
  });
});
