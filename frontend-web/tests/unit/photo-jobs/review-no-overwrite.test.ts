/**
 * Spec §6 + §10: approving an application must never rewrite the stored
 * photograph, and the reviewer's answer must say which portrait they are
 * looking at.
 *
 * The defect this replaces (`supabase-store.ts:1067`) assigned the pipeline
 * output over `form_data['media.photoUrl']`. That key held the only pointer to
 * the uploaded original, so a failed re-render had nothing to retry from and a
 * reviewer could not tell a composite from an upload. These cases pin the four
 * answers the review path may take, and — the part that is easy to get wrong —
 * which of them are allowed to talk to the vendor at all.
 *
 * Nothing here waits on a vendor: the review request only ever reads the job
 * store and, at most, enqueues. That is design §6's "nothing in this flow
 * blocks a request on a vendor call", and it is why the drain is kicked and not
 * awaited.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const registry = vi.hoisted(() => ({ registerOriginalAndEnqueue: vi.fn() }));
vi.mock('@/src/server/photo-jobs/registry', () => registry);

const store = vi.hoisted(() => ({ getLatestPhotoJob: vi.fn() }));
vi.mock('@/src/server/photo-jobs/job-store', () => store);

const statusRead = vi.hoisted(() => ({ publishedPortraitFor: vi.fn(), kickDrain: vi.fn() }));
vi.mock('@/src/server/photo-jobs/status-read', () => statusRead);


import {
  resolveReviewPhotoOutcome,
  startPhotoForSubmission,
  storedPhotoValueFor,
} from '@/src/server/photo-jobs/presentation';

/** A stored value of the shape the upload route mints, kept byte-for-byte
 *  comparable so every assertion below can prove the original is untouched. */
// base64url of `registration/u-9/face.jpg`: a route the upload endpoint would
// really mint, so it is recognisable as one of our own objects.
const ORIGINAL = '/api/registration/uploads/cmVnaXN0cmF0aW9uL3UtOS9mYWNlLmpwZw';
const COMPOSITE = 'https://pub.r2.test/contestants/composited/final.png';

const job = (over: Record<string, unknown> = {}) => ({
  id: 'job-1',
  run_key: 'photo:asset-1:tpl-1:deadbeefcafe',
  registration_id: 'reg-1',
  source_asset_id: 'asset-original-1',
  result_asset_id: 'asset-final-1',
  status: 'ready',
  progress: 100,
  attempt: 1,
  max_attempts: 6,
  last_error: null,
  render_params: {},
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  registry.registerOriginalAndEnqueue.mockResolvedValue({
    assetId: 'asset-original-1',
    jobId: 'job-1',
    skipped: null,
  });
  store.getLatestPhotoJob.mockResolvedValue(null);
  statusRead.publishedPortraitFor.mockResolvedValue({ url: COMPOSITE, assetId: 'asset-final-1' });
});

describe('resolveReviewPhotoOutcome: the composite is only ever reported, never written back', () => {
  it('answers composite from the finished asset and leaves the original value alone', async () => {
    store.getLatestPhotoJob.mockResolvedValue(job());

    const out = await resolveReviewPhotoOutcome({ rawPhotoUrl: ORIGINAL, registrationId: 'reg-1' });

    expect(out).toEqual({
      mode: 'composite',
      photoUrl: COMPOSITE,
      photoAssetId: 'asset-final-1',
      originalAssetId: 'asset-original-1',
    });
    // A job already exists, so a second approval must not mint another one.
    expect(registry.registerOriginalAndEnqueue).not.toHaveBeenCalled();
    expect(statusRead.kickDrain).not.toHaveBeenCalled();
  });

  it('does not claim a composite when its bytes cannot be turned into a URL', async () => {
    store.getLatestPhotoJob.mockResolvedValue(job());
    statusRead.publishedPortraitFor.mockResolvedValue(null);

    const out = await resolveReviewPhotoOutcome({ rawPhotoUrl: ORIGINAL, registrationId: 'reg-1' });

    expect(out.mode).toBe('original');
    expect(out.photoUrl).toBe(ORIGINAL);
    expect(out.reason).toContain('no URL could be derived');
  });

  it('reads a job that already exists instead of minting a second one', async () => {
    // `failed` and `paused` are deliberately not re-armed here: the ladder owns
    // when the next vendor call happens, and an approval click that reset
    // `available_at` would retry a down vendor once per review. Exhaustion is
    // reported as an operator blocker by /api/admin/photo-config-status instead.
    const cases: [string, string][] = [
      ['queued', 'processing'],
      ['extracting', 'processing'],
      ['compositing', 'processing'],
      ['failed', 'original'],
      ['paused', 'original'],
    ];
    for (const [status, mode] of cases) {
      vi.resetAllMocks();
      store.getLatestPhotoJob.mockResolvedValue(
        job({ status, progress: 5, result_asset_id: null, last_error: 'vendor said no' }),
      );

      const out = await resolveReviewPhotoOutcome({ rawPhotoUrl: ORIGINAL, registrationId: 'reg-1' });

      expect(registry.registerOriginalAndEnqueue).not.toHaveBeenCalled();
      expect(statusRead.kickDrain).not.toHaveBeenCalled();
      expect(out.mode).toBe(mode);
      // Either way the reviewer is shown the upload, byte-identical.
      expect(out.photoUrl).toBe(ORIGINAL);
      if (mode === 'original') expect(out.reason).toBe('vendor said no');
    }
  });

  it('never blocks an approval on a vendor failure: a paused job presents the original', async () => {
    store.getLatestPhotoJob.mockResolvedValue(
      job({ status: 'paused', progress: 5, result_asset_id: null, last_error: 'Cloudinary returned 503' }),
    );

    const out = await resolveReviewPhotoOutcome({ rawPhotoUrl: ORIGINAL, registrationId: 'reg-1' });

    expect(out).toEqual({
      mode: 'original',
      photoUrl: ORIGINAL,
      originalAssetId: 'asset-original-1',
      reason: 'Cloudinary returned 503',
    });
  });

  it('surfaces a moderation verdict as rejected, so the caller can refuse the approval', async () => {
    store.getLatestPhotoJob.mockResolvedValue(
      job({ status: 'cancelled', progress: 5, result_asset_id: null, last_error: 'Rejected: violence' }),
    );

    const out = await resolveReviewPhotoOutcome({ rawPhotoUrl: ORIGINAL, registrationId: 'reg-1' });

    expect(out.mode).toBe('rejected');
    expect(out.reason).toBe('Rejected: violence');
    // Still the original: a refusal must not leave the application with no photo.
    expect(out.photoUrl).toBe(ORIGINAL);
  });
});

describe('resolveReviewPhotoOutcome: the first approval records the original and starts a render', () => {
  it('registers the original, kicks the queue without waiting, and says processing', async () => {
    const out = await resolveReviewPhotoOutcome({
      rawPhotoUrl: ORIGINAL,
      registrationId: 'reg-1',
      contestSlug: 'open-mic-competition',
    });

    expect(registry.registerOriginalAndEnqueue).toHaveBeenCalledWith({
      registrationId: 'reg-1',
      contestSlug: 'open-mic-competition',
      storedPhotoValue: ORIGINAL,
    });
    expect(statusRead.kickDrain).toHaveBeenCalledTimes(1);
    expect(out).toEqual({
      mode: 'processing',
      photoUrl: ORIGINAL,
      originalAssetId: 'asset-original-1',
    });
  });

  it('says original, not processing, when the contest has nothing to composite onto', async () => {
    registry.registerOriginalAndEnqueue.mockResolvedValue({
      assetId: 'asset-original-1',
      jobId: null,
      skipped: 'noTemplate',
    });

    const out = await resolveReviewPhotoOutcome({ rawPhotoUrl: ORIGINAL, registrationId: 'reg-1' });

    expect(out.mode).toBe('original');
    expect(out.photoUrl).toBe(ORIGINAL);
    expect(out.originalAssetId).toBe('asset-original-1');
    expect(out.reason).toContain('template');
    // No job exists, so kicking a drain would query an empty queue for nothing.
    expect(statusRead.kickDrain).not.toHaveBeenCalled();
  });

  it('carries a source problem into the reason instead of inventing a job', async () => {
    registry.registerOriginalAndEnqueue.mockResolvedValue({
      assetId: 'asset-original-1',
      jobId: null,
      skipped: 'notFetchable: R2 is not configured to presign one',
    });

    const out = await resolveReviewPhotoOutcome({ rawPhotoUrl: ORIGINAL, registrationId: 'reg-1' });

    expect(out.mode).toBe('original');
    expect(out.reason).toContain('R2 is not configured');
  });

  it('will not register rendered output as somebody\'s original photograph', async () => {
    // The registry call is what mints the immutable `original` asset row, so a
    // value under a rendered prefix has to be displayed without being
    // recorded: approving a legacy row that only ever held a composite keeps
    // showing that portrait, but it must not become the source every later
    // re-render reads.
    const outcome = await resolveReviewPhotoOutcome({
      rawPhotoUrl: COMPOSITE,
      registrationId: 'reg-1',
      contestSlug: 'open-mic-competition',
    });
    expect(outcome).toEqual({
      mode: 'original',
      photoUrl: COMPOSITE,
      reason: expect.stringContaining('rendered'),
    });
    expect(registry.registerOriginalAndEnqueue).not.toHaveBeenCalled();
    expect(statusRead.kickDrain).not.toHaveBeenCalled();
  });

  it('an application with no photo needs no job and no vendor at all', async () => {
    const out = await resolveReviewPhotoOutcome({ registrationId: 'reg-1' });

    expect(out).toEqual({ mode: 'original', photoUrl: '', reason: 'noPhoto' });
    expect(store.getLatestPhotoJob).not.toHaveBeenCalled();
    expect(registry.registerOriginalAndEnqueue).not.toHaveBeenCalled();
  });

  it('a store that cannot answer is reported as processing, never as a composite', async () => {
    store.getLatestPhotoJob.mockRejectedValue(new Error('db down'));

    const out = await resolveReviewPhotoOutcome({ rawPhotoUrl: ORIGINAL, registrationId: 'reg-1' });

    expect(out.mode).toBe('original');
    expect(out.photoUrl).toBe(ORIGINAL);
    expect(out.reason).toContain('db down');
  });
});

describe('storedPhotoValueFor: one rule for which value is this applicant’s photo', () => {
  it('prefers the legacy keys, then the key every current form collects', () => {
    expect(
      storedPhotoValueFor({ 'media.photoUrl': 'a', 'media.headshotUrl': 'b', 'media.profilePhoto': 'c' }),
    ).toBe('a');
    expect(storedPhotoValueFor({ 'media.headshotUrl': 'b', 'media.profilePhoto': 'c' })).toBe('b');
    expect(storedPhotoValueFor({ 'media.profilePhoto': 'c' })).toBe('c');
    expect(storedPhotoValueFor({ 'media.profilePhoto': '   ' })).toBeUndefined();
    expect(storedPhotoValueFor({})).toBeUndefined();
  });

  it('flattens the object the mobile client stores into a value the registry can read', () => {
    expect(
      storedPhotoValueFor({
        media: {},
        'media.profilePhoto': { fileName: 'me.jpg', previewUrl: '/api/registration/uploads/eA', storageKey: 'registration/u1/me.jpg' },
      }),
    ).toBe('registration/u1/me.jpg');
    expect(storedPhotoValueFor({ 'media.profilePhoto': { previewUrl: '/api/registration/uploads/eA' } })).toBe(
      '/api/registration/uploads/eA',
    );
    // An object with neither field is not a photo; stringifying it would store
    // "[object Object]" as the contestant's portrait.
    expect(storedPhotoValueFor({ 'media.profilePhoto': { fileName: 'me.jpg' } })).toBeUndefined();
  });
  it('refuses to mistake a rendered portrait for the photograph it was made from', () => {
    // The old review path overwrote `media.photoUrl` with the composite, so a
    // legacy row can hold output under the key that used to hold the upload
    // while `media.profilePhoto` still holds the upload. Taking the first key
    // that is merely non-empty would register the composite as this
    // contestant's "original" and render a face onto a frame onto a face.
    const composited = 'https://pub.r2.test/contestants/composited/9f14e45f.png';
    expect(storedPhotoValueFor({ 'media.photoUrl': composited, 'media.profilePhoto': ORIGINAL })).toBe(ORIGINAL);
    expect(storedPhotoValueFor({ 'media.photoUrl': 'contestants/preview/x.png' })).toBeUndefined();
    expect(storedPhotoValueFor({ 'media.profilePhoto': { storageKey: 'contestants/thumbnail/x.png' } })).toBeUndefined();
    // Same recovery for the other overwrite: the no-template fallback stored
    // the vendor's own cutout URL. That string is not recognisable as rendered
    // output by shape, but it is not one of our objects either, so the ranking
    // prefers the upload sitting in the next key.
    expect(
      storedPhotoValueFor({
        'media.photoUrl': 'https://res.cloudinary.com/dxxx/image/upload/e_background_removal/cut.png',
        'media.profilePhoto': ORIGINAL,
      }),
    ).toBe(ORIGINAL);
    // A named limit: when nothing of ours exists the external value is still
    // presented. Refusing to show any portrait is worse for the reviewer than
    // showing one that has been used over, and the asset row records which
    // value was actually the source.
    expect(storedPhotoValueFor({ 'media.photoUrl': 'https://cdn.example.com/headshot.jpg' })).toBe(
      'https://cdn.example.com/headshot.jpg',
    );
  });
  });


describe('startPhotoForSubmission: rendering starts at submit, and never fails the submit', () => {
  it('enqueues with the contest slug and kicks the queue', async () => {
    await startPhotoForSubmission({
      registrationId: 'reg-1',
      contestSlug: 'open-mic-competition',
      formData: { 'media.profilePhoto': ORIGINAL },
    });

    expect(registry.registerOriginalAndEnqueue).toHaveBeenCalledWith({
      registrationId: 'reg-1',
      contestSlug: 'open-mic-competition',
      storedPhotoValue: ORIGINAL,
    });
    expect(statusRead.kickDrain).toHaveBeenCalledTimes(1);
  });

  it('swallows a registry failure — a broken pipeline must not undo a submission', async () => {
    registry.registerOriginalAndEnqueue.mockRejectedValue(new Error('enqueue exploded'));

    await expect(
      startPhotoForSubmission({ registrationId: 'reg-1', formData: { 'media.profilePhoto': ORIGINAL } }),
    ).resolves.toEqual({ started: false });
    expect(statusRead.kickDrain).not.toHaveBeenCalled();
  });

  it('does nothing when the application has no photo', async () => {
    await expect(
      startPhotoForSubmission({ registrationId: 'reg-1', formData: { 'personal.bio': 'hi' } }),
    ).resolves.toEqual({ started: false });
    expect(registry.registerOriginalAndEnqueue).not.toHaveBeenCalled();
  });
});
