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
  return data ? toPhotoJob(data as Record<string, unknown>) : null;
}

/**
 * The newest job for one registration — the read that lets a surface reopen its
 * own progress after a page reload, when it no longer holds the id the submit
 * response handed it.
 *
 * Ordered by `created_at desc` because that is what the migration's
 * `contest_photo_jobs_registration (registration_id, created_at desc)` index is
 * there for; re-editing a registration appends jobs rather than replacing them,
 * so the newest row is the one the editor's state produced.
 */
export async function getLatestPhotoJob(registrationId: string): Promise<PhotoJob | null> {
  const { data, error } = await db()
    .from('contest_photo_jobs')
    .select('*, registrations(user_id)')
    .eq('registration_id', registrationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('[photo-jobs] latest read failed:', error.message);
    return null;
  }
  return data ? toPhotoJob(data as Record<string, unknown>) : null;
}

/** Both reads answer the same shape, and the ownership rule the status route
 *  depends on lives or dies on this flattening: `registrations(user_id)` arrives
 *  as a nested object, and `job.user_id === user.id` would be `undefined` for
 *  every row, 403-ing the only caller who is allowed in. */
function toPhotoJob(row: Record<string, unknown>): PhotoJob {
  const embedded = row.registrations as { user_id?: string } | null | undefined;
  const { registrations: _dropped, ...job } = row;
  return { ...(job as unknown as PhotoJob), registration_user_id: embedded?.user_id ?? null };
}

/** One row of `contest_photo_assets`, in the snake_case the table uses.
 *
 * The runner reads the *source* asset by id, so it needs the location columns;
 * naming them here is what stops `runner.ts` from inventing its own shape for a
 * row it does not own. `bytes` stays `number | null` because the column is a
 * bigint the writer may not have measured (a Cloudinary cutout URL has no local
 * length until someone fetches it). */
export interface PhotoAsset {
  id: string;
  registration_id: string | null;
  contest_id: string | null;
  kind: AssetKind;
  storage_key: string | null;
  provider_url: string | null;
  content_type: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  template_id: string | null;
  template_version: number | null;
  render_params: Record<string, unknown>;
}

/** Named once so the two asset reads cannot drift apart: a column dropped from
 *  this list must fail a test, not surface as a null inside a job. */
const ASSET_COLUMNS =
  'id, registration_id, contest_id, kind, storage_key, provider_url, content_type, width, height, bytes, template_id, template_version, render_params';

export async function getPhotoAsset(id: string): Promise<PhotoAsset | null> {
  const { data, error } = await db()
    .from('contest_photo_assets')
    .select(ASSET_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.warn('[photo-jobs] asset read failed:', error.message);
    return null;
  }
  return (data as PhotoAsset) ?? null;
}

/**
 * Everything the pipeline produced for one registration, oldest first: the
 * original, then whatever the newest successful render added.
 *
 * The status surface reads this only for a `ready` job, and the caller picks by
 * `kind` — so an entry here is a stored fact, not a claim that the contestant
 * approved it. `contest_photo_assets_registration (registration_id, kind)` backs
 * the lookup; `created_at` orders the rare registration with two renders.
 */
export async function listPhotoAssets(registrationId: string): Promise<PhotoAsset[]> {
  const { data, error } = await db()
    .from('contest_photo_assets')
    .select(ASSET_COLUMNS)
    .eq('registration_id', registrationId)
    .order('created_at', { ascending: true });
  if (error) {
    console.warn('[photo-jobs] asset list failed:', error.message);
    return [];
  }
  return (data ?? []) as PhotoAsset[];
}

export async function photoJobSummary(): Promise<Record<string, number>> {
  const { data, error } = await db().rpc('photo_job_config_summary');
  if (error || !data) return {};
  return data as Record<string, number>;
}
