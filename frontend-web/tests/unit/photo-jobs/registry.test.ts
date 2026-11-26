/**
 * Task 5 — the registry that records a contestant's original photograph and
 * then asks for a render (spec §5, acceptance criterion 16).
 *
 * Two of these cases exist because of faults the design review caught in the
 * plan's draft of this file, and both are the kind that no amount of reading
 * the code would have surfaced:
 *
 *   1. The draft stored the *presigned* URL Cloudinary would fetch as the
 *      asset's reference. A signed URL expires, so the reference would rot —
 *      and the row's unique key is that reference, so the same photograph
 *      re-ingested later would mint a second "original" for one contestant.
 *      Case (a) asserts the object key is stored and the signed URL appears
 *      nowhere in the write.
 *   2. The draft hard-coded `image/jpeg`, so a PNG original was labelled
 *      wrongly forever. Same case asserts `image/png` for a PNG object.
 *
 * `buildRunKey` is deliberately NOT mocked. The plan's draft mocked the whole
 * job store, which made its own instruction — "assert the run key differs
 * between two template ids" — unassertable, because the mock returned the same
 * string both times. Importing the real one keeps the interesting behaviour
 * under test and mocks only the functions that need a database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const jobStore = vi.hoisted(() => ({
  upsertPhotoAsset: vi.fn(),
  enqueuePhotoJob: vi.fn(),
}));

vi.mock('@/src/server/photo-jobs/job-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/server/photo-jobs/job-store')>();
  return { ...actual, upsertPhotoAsset: jobStore.upsertPhotoAsset, enqueuePhotoJob: jobStore.enqueuePhotoJob };
});

const source = vi.hoisted(() => ({ resolveFetchableSource: vi.fn() }));

// Only the fetchable-URL step is faked (it signs requests to R2); the route
// decoder next to it stays real, because reading an object key back out of an
// upload URL is exactly what this file must get right.
vi.mock('@/src/lib/media/asset-source', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/media/asset-source')>();
  return { ...actual, resolveFetchableSource: source.resolveFetchableSource };
});

const contests = vi.hoisted(() => ({ resolveConnectContestId: vi.fn() }));
// Mocked at its own module: the registry reaches the slug lookup directly, and
// mocking supabase-store instead would leave this file asserting against a
// module the code under test never imports.
vi.mock('@/src/server/registration/connect-contest-id', () => contests);

const resolver = vi.hoisted(() => ({ resolveActiveTemplateForContest: vi.fn() }));
vi.mock('@/src/server/registration/template-resolver', () => resolver);

import { registerOriginalAndEnqueue } from '@/src/server/photo-jobs/registry';

const ROUTE = (key: string): string =>
  `/api/registration/uploads/${Buffer.from(key, 'utf8').toString('base64url')}`;

function template(overrides: Record<string, unknown> = {}) {
  return {
    templateId: 'tpl-1',
    templateVersion: 4,
    templateUrl: 'https://cdn/t.png',
    templateWidth: 1080,
    templateHeight: 1350,
    slot: { id: 'slot-1', x: 10, y: 20, width: 300, height: 400 },
    ...overrides,
  };
}

const FETCHED = {
  ok: true as const,
  url: 'https://r2.example.com/registration/u-1/photo.jpg?X-Amz-Signature=abc123',
  objectKey: 'registration/u-1/photo.jpg',
  ttlSeconds: 600,
};

beforeEach(() => {
  vi.resetAllMocks();
  jobStore.upsertPhotoAsset.mockResolvedValue('asset-1');
  jobStore.enqueuePhotoJob.mockResolvedValue({ jobId: 'job-1', status: 'queued', alreadyExisted: false });
  source.resolveFetchableSource.mockResolvedValue(FETCHED);
  contests.resolveConnectContestId.mockResolvedValue('contest-1');
  resolver.resolveActiveTemplateForContest.mockResolvedValue(null);
});

describe('registerOriginalAndEnqueue', () => {
  it('records the original by object key and never stores the signed URL', async () => {
    const out = await registerOriginalAndEnqueue({
      registrationId: 'r-1',
      contestSlug: 'rising-star',
      storedPhotoValue: ROUTE('registration/u-1/photo.jpg'),
    });

    expect(out).toEqual({ assetId: 'asset-1', jobId: 'job-1', skipped: null });
    expect(jobStore.upsertPhotoAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        registrationId: 'r-1',
        kind: 'original',
        storageKey: 'registration/u-1/photo.jpg',
        providerUrl: null,
        contentType: 'image/jpeg',
      }),
    );
    // The URL we handed the vendor is signed and short-lived; persisting it
    // would rot and would split one photo across two asset rows.
    const written = JSON.stringify(jobStore.upsertPhotoAsset.mock.calls);
    expect(written).not.toContain('X-Amz-Signature');
    expect(written).not.toContain('https://r2.example.com');
  });

  it('keeps the extension-derived content type for a PNG original', async () => {
    source.resolveFetchableSource.mockResolvedValue({
      ...FETCHED,
      objectKey: 'registration/u-1/photo.png',
    });
    await registerOriginalAndEnqueue({
      registrationId: 'r-1',
      storedPhotoValue: ROUTE('registration/u-1/photo.png'),
    });
    expect(jobStore.upsertPhotoAsset).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'image/png' }),
    );
  });

  it('records a remote provider URL as providerUrl when the photo is not ours', async () => {
    const remote = 'https://cdn.example.net/entries/a.png';
    source.resolveFetchableSource.mockResolvedValue({ ok: true, url: remote, objectKey: null, ttlSeconds: 0 });
    await registerOriginalAndEnqueue({ registrationId: 'r-1', storedPhotoValue: remote });
    expect(jobStore.upsertPhotoAsset).toHaveBeenCalledWith(
      expect.objectContaining({ storageKey: null, providerUrl: remote }),
    );
  });

  it('skips without a photo and touches neither the vendor nor the queue', async () => {
    const out = await registerOriginalAndEnqueue({ registrationId: 'r-1', storedPhotoValue: '   ' });
    expect(out).toEqual({ assetId: null, jobId: null, skipped: 'noPhoto' });
    expect(source.resolveFetchableSource).not.toHaveBeenCalled();
    expect(jobStore.upsertPhotoAsset).not.toHaveBeenCalled();
    expect(jobStore.enqueuePhotoJob).not.toHaveBeenCalled();
  });

  it('still records the original when the source is not fetchable, so the photo is never lost', async () => {
    source.resolveFetchableSource.mockResolvedValue({
      ok: false,
      kind: 'notFetchable',
      reason: 'R2 is not configured (set R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, NEXT_PUBLIC_R2_PUBLIC_BASE_URL)',
    });
    const out = await registerOriginalAndEnqueue({
      registrationId: 'r-1',
      storedPhotoValue: ROUTE('registration/u-1/photo.jpg'),
    });

    // The asset row is written BEFORE fetchability is consulted, and the
    // object key survives even though no URL could be signed for it.
    expect(jobStore.upsertPhotoAsset).toHaveBeenCalledWith(
      expect.objectContaining({ storageKey: 'registration/u-1/photo.jpg' }),
    );
    expect(out.assetId).toBe('asset-1');
    expect(out.jobId).toBeNull();
    expect(out.skipped).toMatch(/^notFetchable: /);
    expect(jobStore.enqueuePhotoJob).not.toHaveBeenCalled();
  });

  it('reports assetWriteFailed and enqueues nothing when the asset row cannot be written', async () => {
    jobStore.upsertPhotoAsset.mockResolvedValue(null);
    const out = await registerOriginalAndEnqueue({
      registrationId: 'r-1',
      storedPhotoValue: ROUTE('registration/u-1/photo.jpg'),
    });
    expect(out).toEqual({ assetId: null, jobId: null, skipped: 'assetWriteFailed' });
    expect(jobStore.enqueuePhotoJob).not.toHaveBeenCalled();
  });

  it('reports enqueueFailed but keeps the asset id — the original is safe', async () => {
    jobStore.enqueuePhotoJob.mockResolvedValue(null);
    const out = await registerOriginalAndEnqueue({
      registrationId: 'r-1',
      storedPhotoValue: ROUTE('registration/u-1/photo.jpg'),
    });
    expect(out).toEqual({ assetId: 'asset-1', jobId: null, skipped: 'enqueueFailed' });
  });

  it('pins the resolved template so a template change cannot reuse a finished render', async () => {
    resolver.resolveActiveTemplateForContest.mockResolvedValue(template({ templateId: 'tpl-1', templateVersion: 4 }));
    const first = await registerOriginalAndEnqueue({
      registrationId: 'r-1',
      contestId: 'contest-1',
      storedPhotoValue: ROUTE('registration/u-1/photo.jpg'),
    });
    expect(first.jobId).toBe('job-1');

    const pinned = jobStore.enqueuePhotoJob.mock.calls[0][0];
    expect(pinned).toMatchObject({ templateId: 'tpl-1', sourceAssetId: 'asset-1', registrationId: 'r-1' });

    // Same source photo, a different template: a different run key, so the
    // unique index cannot answer the new request with the old completed job.
    resolver.resolveActiveTemplateForContest.mockResolvedValue(template({ templateId: 'tpl-2', templateVersion: 1 }));
    await registerOriginalAndEnqueue({
      registrationId: 'r-1',
      contestId: 'contest-1',
      storedPhotoValue: ROUTE('registration/u-1/photo.jpg'),
    });
    const runKeys = jobStore.enqueuePhotoJob.mock.calls.map((call) => call[0].runKey);
    expect(runKeys).toHaveLength(2);
    expect(runKeys[1]).not.toBe(runKeys[0]);
    expect(runKeys[0]).toContain('tpl-1');
    expect(runKeys[1]).toContain('tpl-2');
  });

  it('gives a different renderParams object its own run key', async () => {
    resolver.resolveActiveTemplateForContest.mockResolvedValue(template());
    await registerOriginalAndEnqueue({
      registrationId: 'r-1',
      contestId: 'contest-1',
      storedPhotoValue: ROUTE('registration/u-1/photo.jpg'),
      renderParams: { offsetX: 0 },
    });
    await registerOriginalAndEnqueue({
      registrationId: 'r-1',
      contestId: 'contest-1',
      storedPhotoValue: ROUTE('registration/u-1/photo.jpg'),
      renderParams: { offsetX: 40 },
    });
    const [first, second] = jobStore.enqueuePhotoJob.mock.calls.map((call) => call[0]);
    expect(second.runKey).not.toBe(first.runKey);
    // The request must carry the params themselves, not only their hash, or
    // the worker has nothing to render from.
    expect(first.renderParams).toEqual({ offsetX: 0 });
    expect(second.renderParams).toEqual({ offsetX: 40 });
  });

  it('resolves the contest from the slug when no contest id is supplied', async () => {
    await registerOriginalAndEnqueue({
      registrationId: 'r-1',
      contestSlug: 'rising-star',
      storedPhotoValue: ROUTE('registration/u-1/photo.jpg'),
    });
    expect(contests.resolveConnectContestId).toHaveBeenCalledWith('rising-star');
    expect(resolver.resolveActiveTemplateForContest).toHaveBeenCalledWith('contest-1');
    expect(jobStore.upsertPhotoAsset).toHaveBeenCalledWith(expect.objectContaining({ contestId: 'contest-1' }));
    expect(jobStore.enqueuePhotoJob).toHaveBeenCalledWith(expect.objectContaining({ contestId: 'contest-1' }));
  });

  it('does not look up a contest when neither id nor slug is given', async () => {
    await registerOriginalAndEnqueue({
      registrationId: 'r-1',
      storedPhotoValue: ROUTE('registration/u-1/photo.jpg'),
    });
    expect(contests.resolveConnectContestId).not.toHaveBeenCalled();
    expect(resolver.resolveActiveTemplateForContest).not.toHaveBeenCalled();
    expect(jobStore.enqueuePhotoJob).toHaveBeenCalledWith(expect.objectContaining({ templateId: null }));
  });
});
