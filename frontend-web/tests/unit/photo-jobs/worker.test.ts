/**
 * Task 7 — the worker: one sequential drain, never two at once.
 *
 * Three properties the request paths depend on, each pinned by its own case:
 * the drain costs nothing when the summary says the queue is empty (a submit
 * route that fired it on every click would put a claim lock on the table for no
 * reason); a runner that throws is a defect in *one* job and must not abandon
 * its neighbours; and the overlap guard has to clear itself after a failure,
 * because a latch that stays shut turns an opportunistic queue into a silent one.
 *
 * `runPhotoJob` is mocked at the module boundary: what is under test is the
 * loop, the counting and the single-flight flag, not the compositor.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  claimDuePhotoJobs: vi.fn(),
  reclaimStalePhotoJobs: vi.fn(),
  photoJobSummary: vi.fn(),
}));
const runPhotoJob = vi.hoisted(() => vi.fn());

vi.mock('@/src/server/photo-jobs/job-store', () => store);
vi.mock('@/src/server/photo-jobs/runner', () => ({ runPhotoJob }));

import { drainPhotoJobs, maybeDrainPhotoJobs, photoQueueHealth } from '@/src/server/photo-jobs/worker';

const job = (id: string) => ({ id, status: 'extracting', attempt: 1, max_attempts: 6, render_params: {} });

/** The single-flight flag is module state, as it must be — two request paths in
 *  one process share it — so these cases have to say when a drain has actually
 *  reached its claim rather than assuming one tick is enough. `flush()` is a
 *  macrotask: every pending microtask (the summary await, then the claim, then
 *  the runner, then the `finally` that clears the flag) runs before it lands,
 *  whatever its depth. Counting `setImmediate`s, as the draft of this test did,
 *  made two false claims at once: that `claimDuePhotoJobs` had been *called*
 *  meant the drain had made progress, when the promise it hands back had not
 *  even been created yet — so the captured `release` was still the no-op stub,
 *  the drain hung, and the next test inherited a wedged latch. */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.resetAllMocks();
  store.reclaimStalePhotoJobs.mockResolvedValue(0);
  store.claimDuePhotoJobs.mockResolvedValue([]);
  store.photoJobSummary.mockResolvedValue({ queued: 0, processing: 0, failed: 0, paused: 0, ready: 0 });
});

describe('drainPhotoJobs', () => {
  it('claims only when a summary says work may be due', async () => {
    expect(await drainPhotoJobs()).toMatchObject({ claimed: 0 });
    expect(store.claimDuePhotoJobs).not.toHaveBeenCalled();
    expect(store.reclaimStalePhotoJobs).not.toHaveBeenCalled();

    store.photoJobSummary.mockResolvedValue({ queued: 2, processing: 0, failed: 0 });
    store.claimDuePhotoJobs.mockResolvedValue([job('a'), job('b')]);
    runPhotoJob.mockResolvedValue('ready');
    expect(await drainPhotoJobs({ limit: 3 })).toMatchObject({ claimed: 2, ready: 2, errors: [] });
    expect(runPhotoJob).toHaveBeenCalledTimes(2);
  });

  it('passes a per-process worker id and the default batch size through to the claim', async () => {
    store.photoJobSummary.mockResolvedValue({ queued: 5 });
    await drainPhotoJobs();
    expect(store.claimDuePhotoJobs).toHaveBeenCalledWith(`web-${process.pid}`, 3);
    await drainPhotoJobs({ workerId: 'admin-1', limit: 1 });
    expect(store.claimDuePhotoJobs).toHaveBeenLastCalledWith('admin-1', 1);
  });

  it('runs jobs sequentially — one container, one compositor at a time', async () => {
    const order: string[] = [];
    store.photoJobSummary.mockResolvedValue({ queued: 2 });
    store.claimDuePhotoJobs.mockResolvedValue([job('a'), job('b')]);
    runPhotoJob.mockImplementation(async (j: { id: string }) => {
      order.push(`start:${j.id}`);
      await new Promise((r) => setTimeout(r, 5));
      order.push(`end:${j.id}`);
      return 'ready';
    });
    await drainPhotoJobs();
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
  });

  it('a throwing runner does not abort the rest of the batch', async () => {
    // `processing: 1` is what lets the stale-lock reclaim run at all: the guard
    // on an in-flight count is precisely what avoids the extra RPC, so a summary
    // with nothing being processed must not be expected to reclaim.
    store.photoJobSummary.mockResolvedValue({ queued: 3, processing: 1 });
    store.claimDuePhotoJobs.mockResolvedValue([job('a'), job('b'), job('c')]);
    store.reclaimStalePhotoJobs.mockResolvedValue(1);
    runPhotoJob
      .mockRejectedValueOnce(new Error('worker bug'))
      .mockResolvedValueOnce('failed')
      .mockResolvedValueOnce('cancelled');
    const out = await drainPhotoJobs();
    expect(out).toMatchObject({ claimed: 3, failed: 2, cancelled: 1, ready: 0, reclaimed: 1 });
    expect(out.errors).toEqual(['worker bug']);
  });

  it('still claims when a reclaim put rows back on the queue that the summary pre-dated', async () => {
    // The summary is read before the reclaim, so a row the reclaim converts from
    // a stale lock to `failed` is not in `due`. Without the compensating branch
    // this drain would return without touching the very job it just rescued.
    store.photoJobSummary.mockResolvedValue({ queued: 0, processing: 2, failed: 0 });
    store.reclaimStalePhotoJobs.mockResolvedValue(2);
    store.claimDuePhotoJobs.mockResolvedValue([job('rescued')]);
    runPhotoJob.mockResolvedValue('ready');
    expect(await drainPhotoJobs()).toMatchObject({ reclaimed: 2, claimed: 1, ready: 1 });
    expect(store.claimDuePhotoJobs).toHaveBeenCalled();
  });

  it('asks the vendor-free question first: a paused queue is not due work', async () => {
    store.photoJobSummary.mockResolvedValue({ queued: 0, processing: 0, failed: 0, paused: 9 });
    expect(await drainPhotoJobs()).toMatchObject({ claimed: 0 });
    expect(store.claimDuePhotoJobs).not.toHaveBeenCalled();
  });
});

describe('maybeDrainPhotoJobs', () => {
  it('never overlaps itself, and clears the latch once the drain finishes', async () => {
    store.photoJobSummary.mockResolvedValue({ queued: 1 });
    let release: (jobs: unknown[]) => void = () => {};
    store.claimDuePhotoJobs.mockImplementation(
      () => new Promise((r) => { release = (jobs) => r(jobs); }),
    );
    runPhotoJob.mockResolvedValue('ready');

    maybeDrainPhotoJobs();
    maybeDrainPhotoJobs();
    maybeDrainPhotoJobs();
    await flush(); // the summary probe is async; the claim starts on the next microtask
    expect(store.claimDuePhotoJobs).toHaveBeenCalledTimes(1); // three calls, one drain
    expect(store.photoJobSummary).toHaveBeenCalledTimes(1);

    release([job('a')]);
    await flush();
    expect(runPhotoJob).toHaveBeenCalledTimes(1);

    // And the latch is genuinely gone, not merely un-latched by the assertion
    // above: the next click has to be able to drain again.
    store.claimDuePhotoJobs.mockResolvedValue([]);
    maybeDrainPhotoJobs();
    await flush();
    expect(store.claimDuePhotoJobs).toHaveBeenCalledTimes(2);
  });

  it('clears the flag when a drain rejects, so one bad tick cannot wedge the queue', async () => {
    store.photoJobSummary.mockRejectedValue(new Error('summary down'));
    maybeDrainPhotoJobs();
    await flush();

    store.photoJobSummary.mockReset();
    store.photoJobSummary.mockResolvedValue({ queued: 1 });
    store.claimDuePhotoJobs.mockResolvedValue([job('after')]);
    runPhotoJob.mockResolvedValue('ready');

    maybeDrainPhotoJobs();
    await flush();
    expect(store.claimDuePhotoJobs).toHaveBeenCalledTimes(1);
    expect(runPhotoJob).toHaveBeenCalledTimes(1);
  });
});

describe('photoQueueHealth', () => {
  it('reports queue health from the summary, never by scanning rows', async () => {
    store.photoJobSummary.mockResolvedValue({ queued: 4, processing: 1, failed: 2, paused: 3 });
    expect(await photoQueueHealth()).toEqual({ due: 6, locked: 1, paused: 3 });
    expect(store.claimDuePhotoJobs).not.toHaveBeenCalled();
  });

  it('answers zeros when the summary RPC is unavailable', async () => {
    store.photoJobSummary.mockRejectedValue(new Error('rpc down'));
    expect(await photoQueueHealth()).toEqual({ due: 0, locked: 0, paused: 0 });
  });
});
