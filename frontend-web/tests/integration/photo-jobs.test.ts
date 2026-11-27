/**
 * @file tests/integration/photo-jobs.test.ts
 *
 * WHY THIS EXISTS — the invariants are supposed to live in the database, so they
 * have to be proven there. A mock can only show that some code asked; it cannot
 * show that Postgres refused when the ask was wrong.
 *
 * The spec (docs/superpowers/specs/2026-11-26-contest-photo-assets-and-jobs-design.md
 * §2) records what this replaces: approval today writes the pipeline output over
 * form_data['media.photoUrl'], destroying the only reference to the uploaded
 * original, and it renders inside the admin's HTTP request with no status, no
 * retry and no idempotency. The replacement is two tables whose rules are
 * enforced by a trigger and by SQL functions:
 *
 *   1. an original's bytes can never be repointed, and it cannot be deleted by
 *      hand — only by the cascade that fires when the owning application goes;
 *   2. a re-render never overwrites an existing asset row (same kind + same
 *      location collapses onto the row that already exists);
 *   3. one run_key mints one job, which is what makes a retried submit safe;
 *   4. a job goes to exactly one worker, and the failure ladder doubles, is
 *      capped, then parks the job as `paused` instead of looping forever;
 *   5. the web roles cannot call any of it — only the service role can.
 *
 * Item 5 is checked as anon on purpose: this schema carries ALTER DEFAULT
 * PRIVILEGES that hand EXECUTE to anon/authenticated/service_role for every new
 * function, so `revoke ... from public` in the migration is necessary but not
 * sufficient, and only a call from the anon role proves the revocation landed.
 *
 * P2 (docs/superpowers/specs/2026-11-27-contest-photo-blend-layer-design.md
 * §14.12) adds one more obligation to this file: the blend migration's replay
 * is proven here rather than by a one-off psql session, so the original-
 * immutability proofs above are known to run on the merged chain.
 *
 * Runs against the local Supabase (54321/54322) and skips when credentials are
 * absent, so a cited run MUST also show a non-zero executed test count:
 *
 *   cd frontend-web
 *   set -a; source .env.local; set +a
 *   npx vitest run --config vitest.integration.config.ts tests/integration/photo-jobs.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const live = Boolean(URL && KEY);
const db = () => createClient(URL as string, KEY as string, { auth: { persistSession: false } });
const anon = () => createClient(URL as string, ANON as string, { auth: { persistSession: false } });

// registrations.reference has CHECK ~ '^[A-Z0-9]+-[0-9]+-[A-Z0-9]+$'.
const REFERENCE = `PHTOB-${Date.now()}-JOB`;
const CONTEST_SLUG = 'it-photo-jobs';
const RUN = Date.now().toString(36);
const keyFor = (kind: string) => `it/photo-jobs/${RUN}/${kind}.png`;

let registrationId = '';
let assetSeq = 0;
// P2's blend columns live on rows this file does not otherwise create, so the
// two fixture ids are held here for the one cleanup that removes them.
let blendTemplateId = '';
let blendSlotId = '';

/** One registration owns every row this file creates, so cleanup is one delete. */
async function upsert(kind: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await db().rpc('upsert_contest_photo_asset', {
    p_registration_id: registrationId,
    p_kind: kind,
    p_storage_key: keyFor(kind),
    p_content_type: 'image/png',
    p_width: 1080,
    p_height: 1920,
    p_bytes: 123456 + assetSeq++,
    ...overrides,
  });
  expect(error, error?.message ?? '').toBeNull();
  return data as string;
}

async function enqueue(runKey: string, sourceAssetId: string) {
  const { data, error } = await db().rpc('enqueue_photo_job', {
    p_run_key: runKey,
    p_registration_id: registrationId,
    p_source_asset_id: sourceAssetId,
  });
  expect(error, error?.message ?? '').toBeNull();
  return data as { job_id: string; status: string; already_existed: boolean };
}

async function jobRow(id: string) {
  const { data, error } = await db().from('contest_photo_jobs').select('*').eq('id', id).single();
  expect(error, error?.message ?? '').toBeNull();
  return data as Record<string, string | number | null>;
}

describe.skipIf(!live)('contest photo assets and jobs (live)', () => {
  beforeAll(async () => {
    const { data, error } = await db()
      .from('registrations')
      .insert({
        contest_slug: CONTEST_SLUG,
        reference: REFERENCE,
        status: 'draft',
        form_data: {},
      })
      .select('id')
      .single();
    expect(error, error?.message ?? '').toBeNull();
    registrationId = data!.id as string;
  });

  afterAll(async () => {
    if (blendSlotId) await db().from('template_slots').delete().eq('id', blendSlotId);
    if (blendTemplateId) await db().from('contest_templates').delete().eq('id', blendTemplateId);
    // Deleting the owning application is the retention path the guard allows:
    // assets and jobs leave with it, and nothing here is left behind.
    await db().from('registrations').delete().eq('id', registrationId);
    const { data: jobs } = await db().from('contest_photo_jobs').select('id').eq('registration_id', registrationId);
    expect(jobs ?? [], 'job fixture must not leak').toHaveLength(0);
    const { data: assets } = await db().from('contest_photo_assets').select('id').eq('registration_id', registrationId);
    expect(assets ?? [], 'asset fixture must not leak').toHaveLength(0);
  });

  // Spec §14.12 asks for P2's replay to be part of this check rather than a
  // one-off run. Declared first on purpose: if the database only has P1's
  // migration, the blend columns are unknown to the API and this test fails at
  // the select — so the append-only proofs below it cannot pass against a
  // pre-P2 schema, and a green file means both migrations were replayed here.
  it('has the blend layer replayed, with its defaults and CHECKs live', async () => {
    const read = await db()
      .from('contest_templates')
      .select('id, photo_mode, blend_preset, blend_settings')
      .limit(1);
    expect(read.error, `P2's template columns must exist and be readable: ${read.error?.message ?? ''}`).toBeNull();

    const slotsRead = await db()
      .from('template_slots')
      .select('id, image_url, anchor, bleed, face_protect')
      .limit(1);
    expect(slotsRead.error, `P2's slot columns must exist and be readable: ${slotsRead.error?.message ?? ''}`).toBeNull();

    // Defaults are what §11 promises the untouched admin row behaves like, so
    // they are read from a row written without them — not from the catalog.
    const { data: template, error: templateError } = await db()
      .from('contest_templates')
      .insert({ name: `it-blend-${RUN}`, template_url: `https://example.invalid/it-blend-${RUN}.png` })
      .select('id, photo_mode, blend_preset, blend_settings')
      .single();
    expect(templateError, templateError?.message ?? '').toBeNull();
    blendTemplateId = template!.id as string;
    expect(template!.photo_mode).toBe('auto');
    expect(template!.blend_preset).toBe('natural');
    expect(template!.blend_settings).toEqual({});

    const { data: slot, error: slotError } = await db()
      .from('template_slots')
      .insert({ template_id: blendTemplateId, slot_name: 'it-blend-slot' })
      .select('id, image_url, anchor, bleed, face_protect')
      .single();
    expect(slotError, slotError?.message ?? '').toBeNull();
    blendSlotId = slot!.id as string;
    expect(slot!.image_url).toBeNull();
    expect(slot!.anchor).toBe('auto');
    expect(slot!.bleed).toBe(false);
    expect(slot!.face_protect).toBe(true);

    // The CHECKs are the migration's, not the resolver's: an admin row that
    // names a preset the engine does not implement has to be refused by Postgres.
    const badMode = await db().from('contest_templates').update({ photo_mode: 'cutout' }).eq('id', blendTemplateId);
    expect(badMode.error, 'photo_mode must reject a value outside the enum').not.toBeNull();
    expect(badMode.error!.message).toMatch(/photo_mode/);

    const badPreset = await db().from('contest_templates').update({ blend_preset: 'vivid' }).eq('id', blendTemplateId);
    expect(badPreset.error, 'blend_preset must reject a value outside the enum').not.toBeNull();
    expect(badPreset.error!.message).toMatch(/blend_preset/);

    const badAnchor = await db().from('template_slots').update({ anchor: 'middle' }).eq('id', blendSlotId);
    expect(badAnchor.error, 'anchor must reject a value outside the enum').not.toBeNull();
    expect(badAnchor.error!.message).toMatch(/anchor/);

    // 'off' is the preset §14.11 promises renders like P1, so it must be storable.
    const off = await db().from('contest_templates').update({ blend_preset: 'off' }).eq('id', blendTemplateId);
    expect(off.error, off.error?.message ?? '').toBeNull();
    const { data: stored } = await db()
      .from('contest_templates').select('blend_preset').eq('id', blendTemplateId).single();
    expect(stored!.blend_preset).toBe('off');
  });

  it('refuses to repoint an original, and refuses to delete it by hand', async () => {
    const id = await upsert('original');

    const repoint = await db().from('contest_photo_assets').update({ storage_key: keyFor('stolen') }).eq('id', id);
    expect(repoint.error, 'a service-role caller must not be able to repoint the bytes').not.toBeNull();
    expect(repoint.error!.message).toMatch(/append-only/i);

    const wipe = await db().from('contest_photo_assets').delete().eq('id', id);
    expect(wipe.error, 'the original is the one row this feature exists to protect').not.toBeNull();
    expect(wipe.error!.message).toMatch(/may not be deleted directly/);

    const { data } = await db().from('contest_photo_assets').select('storage_key').eq('id', id).single();
    expect(data!.storage_key).toBe(keyFor('original'));
  });

  it('leaves an FK-only update alone, so unrelated deletions keep working', async () => {
    const id = await upsert('original', { p_storage_key: keyFor('original-fk') });
    const { data: contestant } = await db().from('contestants').select('id').limit(1).maybeSingle();
    // The fixture database may hold no contestant; the point is the cascade shape,
    // so fall back to clearing a column no cascade touches differently.
    const first = await db().from('contest_photo_assets').update({ contestant_id: contestant?.id ?? null }).eq('id', id);
    expect(first.error, `SET NULL style cascade bookkeeping must not raise: ${first.error?.message ?? ''}`).toBeNull();

    // ... while the same statement on a content column still raises.
    const second = await db().from('contest_photo_assets').update({ width: 1 }).eq('id', id);
    expect(second.error).not.toBeNull();
    expect(second.error!.message).toMatch(/append-only/i);
  });

  it('collapses a re-ingested duplicate onto the row that already exists', async () => {
    const a = await upsert('transparent');
    const b = await upsert('transparent');
    expect(b).toBe(a);
    const { data } = await db().from('contest_photo_assets').select('id').eq('kind', 'transparent').eq('storage_key', keyFor('transparent'));
    expect(data).toHaveLength(1);
  });

  it('allows a derived asset to be deleted, so re-renders do not accumulate', async () => {
    const id = await upsert('thumbnail');
    const { error } = await db().from('contest_photo_assets').delete().eq('id', id);
    expect(error, error?.message ?? '').toBeNull();
  });

  it('mints exactly one job per run_key', async () => {
    const source = await upsert('original', { p_storage_key: keyFor('original-enqueue') });
    const runKey = `photo:${source}:none:${RUN}`;
    const first = await enqueue(runKey, source);
    const again = await enqueue(runKey, source);
    expect(again.job_id).toBe(first.job_id);
    expect(again.already_existed).toBe(true);
    expect(first.already_existed).toBe(false);
    const { count } = await db().from('contest_photo_jobs').select('id', { count: 'exact', head: true }).eq('run_key', runKey);
    expect(count).toBe(1);
  });

  it('refuses an enqueue with no source asset rather than orphaning a job', async () => {
    const { error } = await db().rpc('enqueue_photo_job', {
      p_run_key: `photo:none:${RUN}`,
      p_registration_id: registrationId,
    });
    expect(error, 'a job without bytes to work from must not be created').not.toBeNull();
    expect(error!.message).toMatch(/requires p_source_asset_id/);
  });

  it('hands one job to one worker only', async () => {
    const source = await upsert('original', { p_storage_key: keyFor('original-claim') });
    const job = await enqueue(`photo:${source}:none:claim-${RUN}`, source);

    const { data: mineData, error: claimError } = await db().rpc('claim_due_photo_jobs', {
      p_worker_id: `it-${RUN}`, p_limit: 20,
    });
    expect(claimError, claimError?.message ?? '').toBeNull();
    const mine = (mineData ?? []) as Array<{ id: string }>;
    expect(mine.map((j) => j.id)).toContain(job.job_id);

    const { data: theirs } = await db().rpc('claim_due_photo_jobs', { p_worker_id: `it-other-${RUN}`, p_limit: 20 });
    const overlap = ((theirs ?? []) as Array<{ id: string }>).filter((j) => mine.some((k) => k.id === j.id));
    expect(overlap, 'SKIP LOCKED must not give one job to two workers').toHaveLength(0);

    const row = await jobRow(job.job_id);
    expect(row.status).toBe('extracting');
    expect(row.attempt).toBe(1);
    expect(row.locked_by).toBe(`it-${RUN}`);
  });

  it('doubles the backoff, then parks the job as paused instead of looping', async () => {
    const source = await upsert('original', { p_storage_key: keyFor('original-ladder') });
    const job = await enqueue(`photo:${source}:none:ladder-${RUN}`, source);
    const statuses: string[] = [];
    const delays: number[] = [];

    for (let i = 0; i < 6; i += 1) {
      // Only the due window is fast-forwarded; the ladder itself stays the
      // function's decision, which is the thing under test.
      await db().from('contest_photo_jobs').update({ available_at: new Date(0).toISOString() }).eq('id', job.job_id);
      const { data: claimed, error: claimError } = await db().rpc('claim_due_photo_jobs', {
        p_worker_id: `ladder-${RUN}`, p_limit: 20,
      });
      expect(claimError, claimError?.message ?? '').toBeNull();
      expect(((claimed ?? []) as Array<{ id: string }>).map((j) => j.id)).toContain(job.job_id);

      const { data: next, error: failError } = await db().rpc('fail_photo_job', {
        p_job_id: job.job_id, p_error: `ladder probe failure ${i + 1}`,
      });
      expect(failError, failError?.message ?? '').toBeNull();
      statuses.push(next as string);

      const row = await jobRow(job.job_id);
      if (row.status !== 'paused') {
        const waitMs = new Date(row.available_at as string).getTime() - Date.now();
        delays.push(Math.round(waitMs / 1000));
      }
    }

    expect(statuses).toEqual(['failed', 'failed', 'failed', 'failed', 'failed', 'paused']);
    const row = await jobRow(job.job_id);
    expect(row.attempt).toBe(6);
    // 30s doubling: 30, 60, 120, 240, 480. Tolerance is the scheduler's clock,
    // not the arithmetic, so assert the shape rather than wall-clock precision.
    expect(delays[0]).toBeGreaterThanOrEqual(20);
    expect(delays[0]).toBeLessThanOrEqual(45);
    expect(delays[1]).toBeGreaterThan(delays[0]);
    expect(delays[4]).toBeLessThanOrEqual(6 * 3600 + 15);
    expect(String(row.last_error)).toMatch(/ladder probe failure 6/);

    // The six-hour ceiling is unreachable through the default ladder -- pausing
    // at attempt 6 happens first -- so it is proven on its own terms: one job
    // given a bigger budget and pushed past the cap. Without this the number
    // 21600 would be an assertion-free constant in the SQL.
    await db().from('contest_photo_jobs')
      .update({ status: 'failed', attempt: 12, max_attempts: 20, available_at: new Date(0).toISOString() })
      .eq('id', job.job_id);
    const { data: claimedAgain } = await db().rpc('claim_due_photo_jobs', { p_worker_id: `cap-${RUN}`, p_limit: 20 });
    expect(((claimedAgain ?? []) as Array<{ id: string }>).map((j) => j.id)).toContain(job.job_id);
    const { data: capped } = await db().rpc('fail_photo_job', { p_job_id: job.job_id, p_error: 'past the cap' });
    expect(capped).toBe('failed');
    const cappedRow = await jobRow(job.job_id);
    const capWait = Math.round((new Date(cappedRow.available_at as string).getTime() - Date.now()) / 1000);
    expect(capWait).toBeGreaterThan(6 * 3600 - 60);
    expect(capWait).toBeLessThanOrEqual(6 * 3600 + 15);
  });

  it('reclaims a lock whose worker died mid-vendor-call', async () => {
    const source = await upsert('original', { p_storage_key: keyFor('original-stale') });
    const job = await enqueue(`photo:${source}:none:stale-${RUN}`, source);
    await db().from('contest_photo_jobs')
      .update({ status: 'compositing', locked_at: new Date(Date.now() - 10 * 60_000).toISOString() })
      .eq('id', job.job_id);

    const { data: reclaimed, error } = await db().rpc('reclaim_stale_photo_jobs', { p_lock_ttl_seconds: 300 });
    expect(error, error?.message ?? '').toBeNull();
    expect(Number(reclaimed)).toBeGreaterThanOrEqual(1);

    const row = await jobRow(job.job_id);
    expect(row.status).toBe('failed');
    expect(String(row.last_error)).toMatch(/reclaimed for retry/);
  });

  it('reports queue health as counts, never as configuration', async () => {
    const { data, error } = await db().rpc('photo_job_config_summary');
    expect(error, error?.message ?? '').toBeNull();
    expect(Object.keys(data as object).sort()).toEqual(['failed', 'paused', 'processing', 'queued', 'ready']);
    expect(JSON.stringify(data)).not.toMatch(/CLOUDINARY|cloudinary|secret/i);
  });

  describe('as a web role', () => {
    // Every RPC in this migration, including the read-only aggregate, is
    // service-role-only: the admin surface reaches it through the BFF, never
    // straight from a browser. The summary used to be granted to `authenticated`
    // and this spec is what proved that grant had no caller — an anon client was
    // refused it, so the only role the grant named could not even exercise it.
    it.skipIf(!ANON)('cannot claim, enqueue, mint an asset row, or read queue depth', async () => {
      const source = await upsert('original', { p_storage_key: keyFor('original-anon') });
      const client = anon();
      const attempts = await Promise.all([
        client.rpc('claim_due_photo_jobs', { p_worker_id: 'anon', p_limit: 1 }),
        client.rpc('enqueue_photo_job', { p_run_key: 'anon', p_registration_id: registrationId, p_source_asset_id: source }),
        client.rpc('upsert_contest_photo_asset', { p_registration_id: registrationId, p_kind: 'final', p_storage_key: keyFor('anon-final') }),
        client.rpc('photo_job_config_summary'),
      ]);
      for (const attempt of attempts) {
        expect(attempt.error, 'a logged-in contestant must not reach the pipeline').not.toBeNull();
        expect(`${attempt.error!.code} ${attempt.error!.message}`).toMatch(/42501|permission denied/i);
      }
    });

    it.skipIf(!ANON)('still reads nothing at all from the two tables', async () => {
      const client = anon();
      const { data: assets, error: assetsError } = await client.from('contest_photo_assets').select('id');
      const { data: jobs, error: jobsError } = await client.from('contest_photo_jobs').select('id');
      // RLS deny-by-omission answers an unreadable table as an EMPTY set, not an
      // error. Asserting only `toHaveLength(0)` would also pass on a missing
      // table grant, which is a different bug, so the error has to be null here.
      expect(assetsError, assetsError?.message ?? '').toBeNull();
      expect(jobsError, jobsError?.message ?? '').toBeNull();
      expect(assets ?? []).toHaveLength(0);
      expect(jobs ?? []).toHaveLength(0);
    });
  });
});
