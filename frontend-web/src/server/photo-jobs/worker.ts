/**
 * Opportunistic drain (spec §3). The job table is the queue; this function is
 * the only thing that consumes it in-process, and it is called from request
 * paths rather than from a dedicated loop — `frontend-web` has no worker
 * service, and inventing a fourth deployable to tick a queue that traffic
 * already drives is the kind of infrastructure the spec's "do not duplicate
 * existing architecture" rule refuses.
 *
 * Sequential on purpose. sharp decoding is CPU-heavy, this service gets a
 * shared slice, and five concurrent composites would slow all five while
 * contending for the vendor's rate budget for no gain.
 *
 * The summary comes first and is the only cost of an idle queue: one counts-only
 * RPC, then nothing. Claiming unconditionally would put a row lock on
 * `contest_photo_jobs` on every submit click, which is a contention source we
 * would only notice in production.
 *
 * Read order matters, and the compensation is deliberate rather than tidy. The
 * summary is sampled *before* the stale-lock reclaim, so rows the reclaim turns
 * from `extracting` into `failed` are not in the `due` figure it produced — and
 * a drain that then declined to claim would have rescued those jobs for nothing.
 * `reclaimed > 0` therefore forces a claim on its own.
 */
import { claimDuePhotoJobs, photoJobSummary, reclaimStalePhotoJobs, type PhotoJob } from './job-store';
import { runPhotoJob } from './runner';

const DEFAULT_LIMIT = 3;
const LOCK_TTL_SECONDS = 300;

export interface DrainResult {
  claimed: number;
  ready: number;
  failed: number;
  cancelled: number;
  reclaimed: number;
  errors: string[];
}

let draining: Promise<DrainResult> | null = null;

export async function drainPhotoJobs(opts: { workerId?: string; limit?: number } = {}): Promise<DrainResult> {
  const out: DrainResult = { claimed: 0, ready: 0, failed: 0, cancelled: 0, reclaimed: 0, errors: [] };
  const summary = await photoJobSummary();
  const due = (summary.queued ?? 0) + (summary.failed ?? 0);
  const inFlight = summary.processing ?? 0;

  out.reclaimed = inFlight > 0 ? await reclaimStalePhotoJobs(LOCK_TTL_SECONDS) : 0;
  if (due === 0 && out.reclaimed === 0) return out;

  const jobs = await claimDuePhotoJobs(opts.workerId || `web-${process.pid}`, opts.limit ?? DEFAULT_LIMIT);
  out.claimed = jobs.length;

  for (const job of jobs) {
    try {
      const outcome = await runPhotoJob(job as PhotoJob);
      out[outcome] += 1;
    } catch (err) {
      // The runner records its own failures; a throw escaping it is a defect in
      // the runner. The lock expires and `reclaim_stale_photo_jobs` requeues the
      // row, so the job is not lost — but this line is the only trace of the bug.
      out.failed += 1;
      out.errors.push(err instanceof Error ? err.message : String(err));
      console.error('[photo-jobs] runner threw for job', job.id, err);
    }
  }
  return out;
}

/**
 * Fire-and-forget: a request path must never wait on the drain. Called after a
 * job is enqueued, so the common case — one contestant waiting on one photo —
 * starts within the request that queued it.
 *
 * The single-flight flag is cleared in the `finally` of the drain itself, which
 * runs before the outer promise settles, and the rejection is swallowed here so
 * a background fault cannot become an unhandled rejection that kills a Node
 * process. The next click tries again.
 */
export function maybeDrainPhotoJobs(): void {
  if (draining) return;
  const running = drainPhotoJobs().finally(() => {
    if (draining === running) draining = null;
  });
  draining = running;
  running.catch(() => undefined);
}

export async function photoQueueHealth(): Promise<{ due: number; locked: number; paused: number }> {
  let summary: Record<string, number> = {};
  try {
    summary = await photoJobSummary();
  } catch (err) {
    // The store already answers `{}` rather than throwing; this catch is for the
    // admin surface never faulting a page over a queue readout.
    console.warn('[photo-jobs] queue health unavailable:', err instanceof Error ? err.message : err);
  }
  return {
    due: (summary.queued ?? 0) + (summary.failed ?? 0),
    locked: summary.processing ?? 0,
    paused: summary.paused ?? 0,
  };
}
