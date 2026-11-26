/**
 * @file tests/unit/photo-jobs/job-store.test.ts
 *
 * The store is a translation layer, so what is under test is the translation —
 * not the ladder, which lives in SQL where it can be enforced. Three things a
 * reader of the runner must be able to trust from here:
 *
 *   1. every call uses the exact snake_case parameter names the migration's
 *      functions declare. A typo in a `p_` name is not a TypeScript error and
 *      PostgREST answers it as a rejected call at runtime, in production, during
 *      an admin's approval click;
 *   2. a failed RPC returns a value (null / [] / false) instead of throwing, so
 *      the job runner keeps its own error path and the submit endpoint cannot be
 *      faulted by storage trouble; and
 *   3. `getPhotoJob` flattens PostgREST's nested `registrations(user_id)` embed
 *      into `registration_user_id`. The status route's ownership check compares
 *      against that field; if the nesting were left in place the check would
 *      compare `undefined !== user.id` and answer 403 to every legitimate owner.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc, from, auth: {} }),
}));

import {
  buildRunKey,
  cancelPhotoJob,
  claimDuePhotoJobs,
  completePhotoJob,
  enqueuePhotoJob,
  failPhotoJob,
  getPhotoJob,
  photoJobSummary,
  renderKeyFor,
  reclaimStalePhotoJobs,
  setPhotoJobProgress,
  upsertPhotoAsset,
} from '@/src/server/photo-jobs/job-store';

describe('run key', () => {
  it('is stable for identical params and changes when the editor changes them', () => {
    const a = buildRunKey({ sourceAssetId: 's1', templateId: null, renderParams: { offsetY: 4, scale: 1.1 } });
    const b = buildRunKey({ sourceAssetId: 's1', templateId: null, renderParams: { scale: 1.1, offsetY: 4 } });
    const c = buildRunKey({ sourceAssetId: 's1', templateId: null, renderParams: { scale: 1.2, offsetY: 4 } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith('photo:s1:none:')).toBe(true);
  });

  it('orders keys canonically so a re-serialised payload cannot mint a second job', () => {
    expect(renderKeyFor({ b: 2, a: 1 })).toBe(renderKeyFor({ a: 1, b: 2 }));
  });

  it('names a template differently from no template at the same settings', () => {
    const bare = buildRunKey({ sourceAssetId: 's1', templateId: null, renderParams: { scale: 1 } });
    const templated = buildRunKey({ sourceAssetId: 's1', templateId: 't9', renderParams: { scale: 1 } });
    expect(templated.startsWith('photo:s1:t9:')).toBe(true);
    expect(templated).not.toBe(bare);
  });

  it('separates a null value from an absent key, which are different renders', () => {
    expect(renderKeyFor({ x: null })).not.toBe(renderKeyFor({}));
  });
});

describe('enqueuePhotoJob', () => {
  beforeEach(() => rpc.mockReset());

  it('calls the SQL function with snake_case parameter names', async () => {
    rpc.mockResolvedValue({ data: { job_id: 'j1', status: 'queued', already_existed: false }, error: null });
    const out = await enqueuePhotoJob({ runKey: 'r', registrationId: 'reg', sourceAssetId: 's', renderParams: {} });
    expect(out).toEqual({ jobId: 'j1', status: 'queued', alreadyExisted: false });
    expect(rpc).toHaveBeenCalledWith('enqueue_photo_job', {
      p_run_key: 'r', p_registration_id: 'reg', p_contest_id: null,
      p_template_id: null, p_source_asset_id: 's', p_render_params: {},
    });
  });

  it('returns null rather than throwing when the RPC fails, so the caller can degrade', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(enqueuePhotoJob({ runKey: 'r', registrationId: 'reg', sourceAssetId: 's' })).resolves.toBeNull();
  });
});

describe('the rest of the surface uses the migration names exactly', () => {
  beforeEach(() => rpc.mockReset().mockResolvedValue({ data: null, error: null }));

  it('passes claim, progress, complete, fail, cancel, reclaim, asset and summary', async () => {
    await claimDuePhotoJobs('w1', 2);
    expect(rpc).toHaveBeenLastCalledWith('claim_due_photo_jobs', { p_worker_id: 'w1', p_limit: 2 });

    await setPhotoJobProgress('j1', 'compositing', 55);
    expect(rpc).toHaveBeenLastCalledWith('set_photo_job_progress', { p_job_id: 'j1', p_status: 'compositing', p_progress: 55 });

    await completePhotoJob('j1', 'a-final');
    expect(rpc).toHaveBeenLastCalledWith('complete_photo_job', { p_job_id: 'j1', p_result_asset_id: 'a-final' });

    await failPhotoJob('j1', 'vendor timeout');
    expect(rpc).toHaveBeenLastCalledWith('fail_photo_job', { p_job_id: 'j1', p_error: 'vendor timeout' });

    await cancelPhotoJob('j1', 'template unpublished');
    expect(rpc).toHaveBeenLastCalledWith('cancel_photo_job', { p_job_id: 'j1', p_reason: 'template unpublished' });

    await reclaimStalePhotoJobs(300);
    expect(rpc).toHaveBeenLastCalledWith('reclaim_stale_photo_jobs', { p_lock_ttl_seconds: 300 });

    await upsertPhotoAsset({ registrationId: 'reg', kind: 'original', storageKey: 'k' });
    expect(rpc).toHaveBeenLastCalledWith('upsert_contest_photo_asset', {
      p_registration_id: 'reg', p_kind: 'original', p_storage_key: 'k', p_provider_url: null,
      p_content_type: 'image/png', p_width: null, p_height: null, p_bytes: null,
      p_template_id: null, p_template_version: null, p_render_params: {}, p_contest_id: null,
    });

    await photoJobSummary();
    expect(rpc).toHaveBeenLastCalledWith('photo_job_config_summary');
  });

  it('degrades to empty answers rather than throwing on RPC trouble', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'down' } });
    expect(await claimDuePhotoJobs('w1')).toEqual([]);
    expect(await completePhotoJob('j1', 'a')).toBe(false);
    expect(await failPhotoJob('j1', 'x')).toBeNull();
    expect(await reclaimStalePhotoJobs()).toBe(0);
    expect(await upsertPhotoAsset({ kind: 'final', providerUrl: 'https://cdn/y.png' })).toBeNull();
    expect(await photoJobSummary()).toEqual({});
    await expect(setPhotoJobProgress('j1', 'ready')).resolves.toBeUndefined();
  });

  it('claims nothing when PostgREST answers with a null payload', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await claimDuePhotoJobs('w1', 3)).toEqual([]);
  });
});

describe('failPhotoJob', () => {
  beforeEach(() => rpc.mockReset());

  it('truncates the error before storage and surfaces the new status', async () => {
    rpc.mockResolvedValue({ data: 'failed', error: null });
    const status = await failPhotoJob('j1', 'x'.repeat(900));
    expect(status).toBe('failed');
    const passed = rpc.mock.calls[0][1].p_error as string;
    expect(passed).toHaveLength(300);
  });

  it('does not retry a cancelled verdict', async () => {
    rpc.mockResolvedValue({ data: 'cancelled', error: null });
    expect(await failPhotoJob('j1', 'rejected by moderation')).toBe('cancelled');
  });

  // The column is NOT NULL in the migration and the ladder reason is what an
  // operator reads, so an empty error must still arrive as something.
  it('never sends an empty error string', async () => {
    rpc.mockResolvedValue({ data: 'failed', error: null });
    await failPhotoJob('j1', '');
    expect(rpc.mock.calls[0][1].p_error).toBe('unknown error');
  });
});

describe('getPhotoJob', () => {
  beforeEach(() => {
    rpc.mockReset();
    from.mockReset();
  });

  it('flattens the registration embed into registration_user_id for the ownership check', async () => {
    const select = vi.fn().mockReturnValue({ eq: () => ({ maybeSingle: maybeSingle }) });
    const maybeSingle = vi.fn().mockResolvedValue({
      error: null,
      data: { id: 'j1', status: 'ready', registration_id: 'r1', registrations: { user_id: 'u1' } },
    });
    from.mockReturnValue({ select });

    const job = await getPhotoJob('j1');

    expect(from).toHaveBeenCalledWith('contest_photo_jobs');
    expect(select).toHaveBeenCalledWith('*, registrations(user_id)');
    expect(job).toMatchObject({ id: 'j1', status: 'ready', registration_user_id: 'u1' });
  });

  it('answers null, not a half-row, when the read fails or the job is gone', async () => {
    from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ error: { message: 'no' }, data: null }) }) }) });
    expect(await getPhotoJob('j1')).toBeNull();

    from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ error: null, data: null }) }) }) });
    expect(await getPhotoJob('j1')).toBeNull();
  });
});
