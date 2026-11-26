/**
 * Job store: the only Node-side knowledge of the photo job tables.
 *
 * Deliberately thin. The claim lock, the backoff ladder and pause-on-exhaust
 * live in the migration's functions (Task 1), and re-deriving any of them here
 * is how two implementations of one policy start to disagree — the failure the
 * Go durable scheduler avoided by keeping the ladder in `service.go` alone. What
 * this file owns is the *translation*: PostgREST's snake_case parameter names,
 * camelCase in, and a value-not-exception contract out.
 *
 * Every function returns something on failure (null / [] / false / 0) instead of
 * throwing. A submit endpoint that faulted because storage was briefly unhappy
 * would lose the applicant's upload, and the runner needs to tell "the store
 * said no" apart from "the vendor said no" — the first retries on the ladder,
 * the second may cancel the job.
 *
 * The Supabase client is created lazily and memoized exactly as
 * `src/server/registration/template-resolver.ts` does, because `createClient`
 * throws at module scope when env is unset — which is vitest collection time and
 * `next build` time.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

let supabaseClient: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!supabaseClient) {
    supabaseClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || '',
      { auth: { persistSession: false } },
    );
  }
  return supabaseClient;
}

export type JobStatus =
  | 'queued'
  | 'extracting'
  | 'compositing'
  | 'ready'
  | 'failed'
  | 'cancelled'
  | 'paused';

export type AssetKind = 'original' | 'transparent' | 'final' | 'preview' | 'thumbnail';

export interface PhotoJob {
  id: string;
  run_key: string;
  registration_id: string;
  /** From the `registrations(user_id)` embed in `getPhotoJob`; the status route's
   * ownership check is only real if this is a flattened value rather than a
   * nested row, because `undefined !== user.id` would 403 every legitimate owner. */
  registration_user_id?: string | null;
  contest_id: string | null;
  template_id: string | null;
  source_asset_id: string;
  status: JobStatus;
  progress: number;
  attempt: number;
  max_attempts: number;
  last_error: string | null;
  render_params: Record<string, unknown>;
  result_asset_id: string | null;
}

/** Matches the migration's `left(..., 300)` so nothing is silently cut twice. */
const ERROR_LIMIT = 300;

/**
 * Canonical key order: `JSON.stringify({a,b}) !== JSON.stringify({b,a})` would
 * otherwise let the same editor state mint a second job every time a client
 * re-serialised its payload in a different order.
 */
export function renderKeyFor(params: Record<string, unknown> = {}): string {
  const canonical = Object.keys(params)
    .sort()
    .map((k) => `${k}=${JSON.stringify(params[k] ?? null)}`)
    .join('&');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

export function buildRunKey(input: {
  sourceAssetId: string;
  templateId: string | null;
  renderParams?: Record<string, unknown>;
}): string {
  return `photo:${input.sourceAssetId}:${input.templateId ?? 'none'}:${renderKeyFor(input.renderParams ?? {})}`;
}

export async function enqueuePhotoJob(input: {
  runKey: string;
  registrationId: string;
  sourceAssetId: string;
  contestId?: string | null;
  templateId?: string | null;
  renderParams?: Record<string, unknown>;
}): Promise<{ jobId: string; status: JobStatus; alreadyExisted: boolean } | null> {
  const { data, error } = await db().rpc('enqueue_photo_job', {
    p_run_key: input.runKey,
    p_registration_id: input.registrationId,
    p_contest_id: input.contestId ?? null,
    p_template_id: input.templateId ?? null,
    p_source_asset_id: input.sourceAssetId,
    p_render_params: input.renderParams ?? {},
  });
  if (error || !data) {
    console.warn('[photo-jobs] enqueue failed:', error?.message);
    return null;
  }
  const payload = data as Record<string, unknown>;
  return {
    jobId: String(payload.job_id),
    status: payload.status as JobStatus,
    alreadyExisted: Boolean(payload.already_existed),
  };
}

export async function claimDuePhotoJobs(workerId: string, limit = 3): Promise<PhotoJob[]> {
  const { data, error } = await db().rpc('claim_due_photo_jobs', { p_worker_id: workerId, p_limit: limit });
  if (error) {
    console.warn('[photo-jobs] claim failed:', error.message);
    return [];
  }
  return (data ?? []) as PhotoJob[];
}

export async function setPhotoJobProgress(id: string, status: JobStatus, progress?: number): Promise<void> {
  const { error } = await db().rpc('set_photo_job_progress', {
    p_job_id: id,
    p_status: status,
    p_progress: progress ?? null,
  });
  if (error) console.warn('[photo-jobs] status write failed:', error.message);
}

export async function completePhotoJob(id: string, resultAssetId: string): Promise<boolean> {
  const { error } = await db().rpc('complete_photo_job', { p_job_id: id, p_result_asset_id: resultAssetId });
  if (error) {
    console.warn('[photo-jobs] complete failed:', error.message);
    return false;
  }
  return true;
}

export async function upsertPhotoAsset(input: {
  registrationId?: string | null;
  kind: AssetKind;
  storageKey?: string | null;
  providerUrl?: string | null;
  contentType?: string;
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  templateId?: string | null;
  templateVersion?: number | null;
  renderParams?: Record<string, unknown>;
  contestId?: string | null;
}): Promise<string | null> {
  const { data, error } = await db().rpc('upsert_contest_photo_asset', {
    p_registration_id: input.registrationId ?? null,
    p_kind: input.kind,
    p_storage_key: input.storageKey ?? null,
    p_provider_url: input.providerUrl ?? null,
    p_content_type: input.contentType ?? 'image/png',
    p_width: input.width ?? null,
    p_height: input.height ?? null,
    // bigint column; PostgREST answers a number, and the migration never
    // re-derives it, so pass whatever the caller measured.
    p_bytes: input.bytes ?? null,
    p_template_id: input.templateId ?? null,
    p_template_version: input.templateVersion ?? null,
    p_render_params: input.renderParams ?? {},
    p_contest_id: input.contestId ?? null,
  });
  if (error) {
    console.warn('[photo-jobs] asset write failed:', error.message);
    return null;
  }
  return data ? String(data) : null;
}

export async function failPhotoJob(id: string, errorText: string): Promise<JobStatus | null> {
  const { data, error } = await db().rpc('fail_photo_job', {
    p_job_id: id,
    p_error: (errorText || 'unknown error').slice(0, ERROR_LIMIT),
  });
  if (error) {
    console.warn('[photo-jobs] fail write failed:', error.message);
    return null;
  }
  return (data as JobStatus) ?? null;
}

export async function cancelPhotoJob(id: string, reason: string): Promise<void> {
  const { error } = await db().rpc('cancel_photo_job', {
    p_job_id: id,
    p_reason: (reason || '').slice(0, ERROR_LIMIT),
  });
  if (error) console.warn('[photo-jobs] cancel failed:', error.message);
}

export async function reclaimStalePhotoJobs(ttlSeconds = 300): Promise<number> {
  const { data, error } = await db().rpc('reclaim_stale_photo_jobs', { p_lock_ttl_seconds: ttlSeconds });
  if (error || typeof data !== 'number') {
    if (error) console.warn('[photo-jobs] reclaim failed:', error.message);
    return 0;
  }
  return data;
}

export async function getPhotoJob(id: string): Promise<PhotoJob | null> {
  const { data, error } = await db()
    .from('contest_photo_jobs')
    .select('*, registrations(user_id)')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.warn('[photo-jobs] read failed:', error.message);
    return null;
  }
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const embedded = row.registrations as { user_id?: string } | null | undefined;
  const { registrations: _dropped, ...job } = row;
  return { ...(job as unknown as PhotoJob), registration_user_id: embedded?.user_id ?? null };
}

export async function photoJobSummary(): Promise<Record<string, number>> {
  const { data, error } = await db().rpc('photo_job_config_summary');
  if (error || !data) return {};
  return data as Record<string, number>;
}
