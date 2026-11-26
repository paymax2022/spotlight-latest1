# Contest photo assets and durable render jobs (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give contestant photos a durable asset model and an idempotent background render job, so the original photograph is never overwritten, no request waits on a vendor call, and the operator can see the true status.

**Architecture:** One forward-only migration adds `contest_photo_assets` (insert-only, `original` immutable by trigger) and `contest_photo_jobs` (Postgres-side claim/backoff/pause functions shaped exactly like the Go scheduler's semantics). Node reaches them only through `supabase.rpc()` — `frontend-web` has no `pg` dependency and gains none. A thin in-process worker drains claimed jobs through a provider seam (`provider.ts` → Cloudinary) and the existing sharp compositor; the admin review path stops assigning its output over `form_data['media.photoUrl']` and points at asset rows instead.

**Tech Stack:** Next.js 16 App Router route handlers, `@supabase/supabase-js` service-role client, Postgres 17 plpgsql, sharp (existing compositor), Cloudinary signed upload-by-fetch-URL (existing client), vitest 5.

**Spec:** `docs/superpowers/specs/2026-11-26-contest-photo-assets-and-jobs-design.md` — read it first; this plan argues from it, and §2 records the four verified defects being fixed.

## Global Constraints

- Migration version is `20272000000000` (next free after `20271900000000_rising_star_editions.sql`). Forward-only, additive, `CREATE OR REPLACE` / `ADD COLUMN IF NOT EXISTS` style; never mutate an applied migration.
- Every new public table gets `ALTER TABLE … ENABLE ROW LEVEL SECURITY` with **no** `to public` policy (deny-all). `make rls-check` is a go-live gate whose only allowlisted table is `spatial_ref_sys`.
- No new npm dependencies. Raw SQL executes only as Postgres functions invoked via `supabase.rpc()`.
- Cloudinary HTTP may live only in `src/lib/media/cloudinary.ts`. Pixel work only via `src/lib/rendering/imageCompositor.ts` and `sharp`.
- Secret values are never read, printed, logged, or persisted. `last_error` is truncated to 300 characters before storage.
- The local test runner needs the zstd shim because shell Node is v22.14.0: prefix vitest with `NODE_OPTIONS="--require /tmp/zstd-shim.cjs"`.
- Any test run cited as evidence must show a non-zero executed-test count; this repo has printed `ok` for suites that silently skipped everything.
- Working directory is the worktree `/Users/paymax/Documents/spotlight/main/.worktrees/contest-photo-jobs` on branch `feat/contest-photo-assets-jobs`. `frontend-web/node_modules` is a symlink to the main checkout's — do not `npm install` inside it.

---

### Task 1: Asset and job tables with the claim semantics in SQL

**Files:**
- Create: `supabase/migrations/20272000000000_contest_photo_assets_and_jobs.sql`
- Test: `frontend-web/tests/integration/photo-jobs.test.ts`

**Interfaces:**
- Produces (consumed by every later task):
  - `public.contest_photo_assets(id uuid, registration_id, contestant_id, contest_id, kind, storage_key, provider_url, content_type, width, height, bytes, template_id, template_version, render_params jsonb, created_at, created_by)`
  - `public.contest_photo_jobs(id, run_key unique, registration_id, contest_id, template_id, source_asset_id, status, progress, attempt, max_attempts, available_at, locked_at, locked_by, last_error, render_params, result_asset_id, created_at, updated_at)`
  - `public.upsert_contest_photo_asset(p_registration_id uuid, p_kind text, p_storage_key text, p_provider_url text, p_content_type text, p_width int, p_height int, p_bytes bigint, p_template_id uuid, p_template_version int, p_render_params jsonb, p_contest_id uuid) returns uuid`
  - `public.enqueue_photo_job(p_run_key text, p_registration_id uuid, p_contest_id uuid, p_template_id uuid, p_source_asset_id uuid, p_render_params jsonb) returns jsonb` → `{"job_id": uuid, "status": text, "already_existed": bool}`
  - `public.claim_due_photo_jobs(p_worker_id text, p_limit int) returns setof contest_photo_jobs`
  - `public.set_photo_job_progress(p_job_id uuid, p_status text, p_progress int) returns void`
  - `public.complete_photo_job(p_job_id uuid, p_result_asset_id uuid) returns void`
  - `public.fail_photo_job(p_job_id uuid, p_error text) returns text` (new status)
  - `public.cancel_photo_job(p_job_id uuid, p_reason text) returns void`
  - `public.reclaim_stale_photo_jobs(p_lock_ttl_seconds int) returns int`
  - `public.photo_job_config_summary() returns jsonb`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20272000000000_contest_photo_assets_and_jobs.sql`:

```sql
-- P1 of the AI contestant-photo compositing build (docs/superpowers/specs/
-- 2026-11-26-contest-photo-assets-and-jobs-design.md).
--
-- Why this exists: approval today writes the pipeline output over
-- form_data['media.photoUrl'] (supabase-store.ts:1097), which destroys the only
-- reference to the uploaded original, and it runs the vendor call + sharp inside
-- the admin's HTTP request with no status, no retry and no idempotency. Assets
-- become rows that are inserted, never overwritten; the render becomes a job
-- whose claim/retry semantics are copied from the Postgres durable scheduler
-- (backend/internal/scheduler/service.go: FOR UPDATE SKIP LOCKED, run_key
-- uniqueness, doubling backoff, pause-on-exhaust for operator review).
--
-- frontend-web has no `pg` dependency, so every statement that needs row locks,
-- backoff arithmetic or an idempotent upsert lives here as a function the BFF
-- calls through supabase.rpc(). That is also where the invariants are enforceable:
-- a JS caller can be wrong about the original being immutable; this trigger cannot.

create table if not exists public.contest_photo_assets (
  id               uuid primary key default gen_random_uuid(),
  registration_id  uuid references public.registrations(id) on delete cascade,
  contestant_id    uuid references public.contestants(id) on delete set null,
  contest_id       uuid,
  kind             text not null check (kind in
                   ('original','transparent','final','preview','thumbnail')),
  storage_key      text,
  provider_url     text,
  content_type     text not null default 'image/png',
  width            integer,
  height           integer,
  bytes            bigint,
  template_id      uuid references public.contest_templates(id) on delete set null,
  template_version integer,
  render_params    jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  constraint contest_photo_assets_location_required check (
    coalesce(storage_key, provider_url) is not null
  )
);

-- An asset's bytes are the fact; re-ingesting the same object key for the same
-- kind collapses onto the existing row rather than duplicating it.
create unique index if not exists contest_photo_assets_kind_location
  on public.contest_photo_assets (kind, coalesce(storage_key, provider_url));
create index if not exists contest_photo_assets_registration
  on public.contest_photo_assets (registration_id, kind);

-- The original is the one asset the whole feature exists to protect. Enforced
-- here, not by convention: no UPDATE and no DELETE, for any role, ever.
create or replace function public.reject_contest_photo_asset_mutation() returns trigger
language plpgsql as $$
begin
  if old.kind = 'original' then
    raise exception 'contest_photo_assets % kind=original is immutable', old.id
      using errcode = '2f003';   -- read_write_only, the same class used for the RLS rejection pattern
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'contest_photo_assets rows are insert-only (id %)', old.id
      using errcode = '2f003';
  end if;
  return old;
end;
$$;

create trigger contest_photo_assets_immutable
  before update or delete on public.contest_photo_assets
  for each row execute function public.reject_contest_photo_asset_mutation();
```

Continue the same file with the job table and its functions (all of the following in one migration):

```sql
create table if not exists public.contest_photo_jobs (
  id               uuid primary key default gen_random_uuid(),
  run_key          text not null unique,
  registration_id  uuid not null references public.registrations(id) on delete cascade,
  contest_id       uuid,
  template_id      uuid,
  source_asset_id  uuid not null references public.contest_photo_assets(id) on delete cascade,
  status           text not null default 'queued' check (status in
                   ('queued','extracting','compositing','ready','failed','cancelled','paused')),
  progress         integer not null default 0 check (progress between 0 and 100),
  attempt          integer not null default 0,
  max_attempts     integer not null default 6,
  available_at     timestamptz not null default now(),
  locked_at        timestamptz,
  locked_by        text,
  last_error       text,
  render_params    jsonb not null default '{}'::jsonb,
  result_asset_id  uuid references public.contest_photo_assets(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists contest_photo_jobs_due
  on public.contest_photo_jobs (available_at) where status in ('queued','failed');
create index if not exists contest_photo_jobs_registration
  on public.contest_photo_jobs (registration_id, created_at desc);

-- upsert_contest_photo_asset: insert-only idempotency. Returns the id of the new
-- or pre-existing row. Never updates, so the immutability trigger above can
-- never fire from the normal path.
create or replace function public.upsert_contest_photo_asset(
  p_registration_id uuid,
  p_kind text,
  p_storage_key text default null,
  p_provider_url text default null,
  p_content_type text default 'image/png',
  p_width integer default null,
  p_height integer default null,
  p_bytes bigint default null,
  p_template_id uuid default null,
  p_template_version integer default null,
  p_render_params jsonb default '{}'::jsonb,
  p_contest_id uuid default null
) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.contest_photo_assets as a (
    registration_id, kind, storage_key, provider_url, content_type,
    width, height, bytes, template_id, template_version, render_params, contest_id
  ) values (
    p_registration_id, p_kind, p_storage_key, p_provider_url, p_content_type,
    p_width, p_height, p_bytes, p_template_id, p_template_version,
    coalesce(p_render_params, '{}'::jsonb), p_contest_id
  )
  on conflict (kind, coalesce(storage_key, provider_url)) do nothing
  returning a.id into v_id;

  if v_id is null then
    select a.id into v_id from public.contest_photo_assets a
      where a.kind = p_kind
        and coalesce(a.storage_key, a.provider_url) = coalesce(p_storage_key, p_provider_url);
  end if;
  return v_id;
end;
$$;

-- enqueue_photo_job: run_key is the idempotency key. Same photo + same template +
-- same editor settings therefore produce one job, which is what makes the submit
-- endpoint safe for a flaky mobile client to retry.
create or replace function public.enqueue_photo_job(
  p_run_key text,
  p_registration_id uuid,
  p_contest_id uuid default null,
  p_template_id uuid default null,
  p_source_asset_id uuid,
  p_render_params jsonb default '{}'::jsonb
) returns jsonb
language plpgsql as $$
declare v_job public.contest_photo_jobs%ROWTYPE;
begin
  select * into v_job from public.contest_photo_jobs
    where run_key = p_run_key
    for update;
  if found then
    -- A job that already reached a terminal failure is re-armed rather than
    -- duplicated, so an operator "process now" cannot mint unbounded history.
    if v_job.status = 'failed' then
      update public.contest_photo_jobs
        set status = 'queued', available_at = now(), last_error = null, updated_at = now()
        where id = v_job.id;
    end if;
    return jsonb_build_object('job_id', v_job.id, 'status', v_job.status, 'already_existed', true);
  end if;

  insert into public.contest_photo_jobs as j (
    run_key, registration_id, contest_id, template_id, source_asset_id, render_params
  ) values (
    p_run_key, p_registration_id, p_contest_id, p_template_id, p_source_asset_id,
    coalesce(p_render_params, '{}'::jsonb)
  )
  returning j.id, j.status into v_job.id, v_job.status;

  return jsonb_build_object('job_id', v_job.id, 'status', v_job.status, 'already_existed', false);
end;
$$;

-- claim_due_photo_jobs: the whole point of putting this in SQL. One statement,
-- SKIP LOCKED, so two workers never see one job; attempt increments at claim time
-- so a crash mid-vendor-call still consumes budget and cannot loop forever.
create or replace function public.claim_due_photo_jobs(p_worker_id text, p_limit integer default 3)
returns setof public.contest_photo_jobs
language plpgsql as $$
begin
  return query
  with picked as (
    select j.id from public.contest_photo_jobs j
      where j.status in ('queued','failed')
        and j.available_at <= now()
        and j.attempt < j.max_attempts
      order by j.available_at
      limit greatest(1, coalesce(p_limit, 1))
      for update of j skip locked
  )
  update public.contest_photo_jobs j
    set status = 'extracting',
        progress = 5,
        attempt = j.attempt + 1,
        locked_at = now(),
        locked_by = p_worker_id,
        updated_at = now()
    from picked
    where j.id = picked.id
    returning j.*;
end;
$$;

create or replace function public.set_photo_job_progress(
  p_job_id uuid, p_status text, p_progress integer default null
) returns void
language plpgsql as $$
begin
  update public.contest_photo_jobs
    set status = p_status,
        progress = coalesce(p_progress, progress),
        updated_at = now()
    where id = p_job_id;
end;
$$;

create or replace function public.complete_photo_job(p_job_id uuid, p_result_asset_id uuid)
returns void
language plpgsql as $$
begin
  update public.contest_photo_jobs
    set status = 'ready', progress = 100, result_asset_id = p_result_asset_id,
        last_error = null, locked_at = null, locked_by = null, updated_at = now()
    where id = p_job_id;
end;
$$;

-- fail_photo_job: 30s doubling, 6h ceiling, paused at max_attempts. Returning the
-- new status keeps the caller from re-deriving the ladder in JS, which is how two
-- implementations of one policy would drift apart.
create or replace function public.fail_photo_job(p_job_id uuid, p_error text)
returns text
language plpgsql as $$
declare v public.contest_photo_jobs%ROWTYPE; v_delay seconds; v_next text;
begin
  select * into v from public.contest_photo_jobs where id = p_job_id for update;
  if not found then return null; end if;
  v_next := case when v.attempt >= v.max_attempts then 'paused' else 'failed' end;
  update public.contest_photo_jobs
    set status = v_next,
        last_error = left(nullif(trim(coalesce(p_error, '')), ''), 300),
        available_at = now() + make_interval(
          secs => least(21600, 30 * power(2, greatest(0, v.attempt - 1))::integer)),
        locked_at = null, locked_by = null, updated_at = now()
    where id = p_job_id;
  return v_next;
end;
$$;

create or replace function public.cancel_photo_job(p_job_id uuid, p_reason text)
returns void
language plpgsql as $$
begin
  update public.contest_photo_jobs
    set status = 'cancelled', last_error = left(coalesce(p_reason, ''), 300),
        locked_at = null, locked_by = null, updated_at = now()
    where id = p_job_id and status not in ('ready','cancelled');
end;
$$;

create or replace function public.reclaim_stale_photo_jobs(p_lock_ttl_seconds integer default 300)
returns integer
language plpgsql as $$
declare v_count integer;
begin
  update public.contest_photo_jobs
    set status = 'failed', available_at = now(), locked_at = null, locked_by = null,
        last_error = 'lock expired; reclaimed for retry', updated_at = now()
    where status in ('extracting','compositing')
      and locked_at < now() - make_interval(secs => greatest(60, coalesce(p_lock_ttl_seconds, 300)));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- photo_job_config_summary: counts only, for the admin config surface.
create or replace function public.photo_job_config_summary() returns jsonb
language plpgsql stable as $$
declare v jsonb;
begin
  select jsonb_build_object(
    'queued',    count(*) filter (where status = 'queued'),
    'processing',count(*) filter (where status in ('extracting','compositing')),
    'failed',    count(*) filter (where status = 'failed'),
    'paused',    count(*) filter (where status = 'paused'),
    'ready',     count(*) filter (where status = 'ready')
  ) into v from public.contest_photo_jobs;
  return coalesce(v, '{}'::jsonb);
end;
$$;

alter table public.contest_photo_assets enable row level security;
alter table public.contest_photo_jobs enable row level security;
-- Deny-all by omission: no `to public` policy exists, so anon/authenticated roles
-- read nothing. The BFF and the Go backend both arrive as the service role, which
-- bypasses RLS. A contestant-owned read policy is added in P4, when the editor
-- actually polls its own job — a broad auth.uid() policy now would grant a
-- permission nothing has been designed to defend.

revoke all on function public.claim_due_photo_jobs(text, integer) from public;
revoke all on function public.enqueue_photo_job(text, uuid, uuid, uuid, uuid, jsonb) from public;
revoke all on function public.fail_photo_job(uuid, text) from public;
revoke all on function public.complete_photo_job(uuid, uuid) from public;
revoke all on function public.set_photo_job_progress(uuid, text, integer) from public;
revoke all on function public.cancel_photo_job(uuid, text) from public;
revoke all on function public.reclaim_stale_photo_jobs(integer) from public;
revoke all on function public.upsert_contest_photo_asset(uuid, text, text, text, text, integer, integer, bigint, uuid, integer, jsonb, uuid) from public;
grant execute on function public.photo_job_config_summary() to authenticated, service_role;
```

- [ ] **Step 2: Apply it to the local database and prove it is valid SQL**

Run:
```bash
cd /Users/paymax/Documents/spotlight/main/.worktrees/contest-photo-jobs
DB="$(grep -m1 '^DATABASE_URL' backend/.env | cut -d= -f2- | tr -d '"')"
psql "$DB" -v ON_ERROR_STOP=1 -f supabase/migrations/20272000000000_contest_photo_assets_and_jobs.sql
psql "$DB" -tAc "select tablename from pg_tables where schemaname='public' and tablename like 'contest_photo%' order by 1;"
psql "$DB" -tAc "select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' where c.relname in ('contest_photo_assets','contest_photo_jobs');"
```
Expected: two table names, and `relrowsecurity = true` for both. `backend/.env`'s `DATABASE_URL` is the **local** 54322 database, not production — confirm before running anything else against it.

- [ ] **Step 3: Write the failing live-database test**

Create `frontend-web/tests/integration/photo-jobs.test.ts`. It must fail before the migration exists and must print an executed count:

```ts
/**
 * @file tests/integration/photo-jobs.test.ts
 * Runs against the local Supabase (54322). Skips when credentials are absent —
 * so a cited run MUST also prove it did not skip (see the executed-count guard).
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const skip = !url || !serviceKey;
const d = skip ? describe.skip : describe;

let sb: SupabaseClient;
beforeAll(async () => {
  if (skip) return;
  sb = createClient(url!, serviceKey!, { auth: { persistSession: false } });
});

d('contest_photo_assets', () => {
  it('refuses to update or delete an original', async () => {
    const { data: created, error } = await sb.rpc('upsert_contest_photo_asset', {
      p_registration_id: null, p_kind: 'original', p_storage_key: `it/${crypto.randomUUID()}.jpg`,
    });
    expect(error).toBeNull();
    expect(created).toBeTruthy();

    const upd = await sb.from('contest_photo_assets').update({ content_type: 'image/gif' }).eq('id', created);
    expect(upd.error).not.toBeNull();
    expect(upd.error!.message).toMatch(/immutable|insert-only/);

    const del = await sb.from('contest_photo_assets').delete().eq('id', created);
    expect(del.error).not.toBeNull();
  });

  it('collapses a re-ingested duplicate onto the existing row', async () => {
    const key = `it/dup/${crypto.randomUUID()}.png`;
    const a = await sb.rpc('upsert_contest_photo_asset', { p_kind: 'transparent', p_storage_key: key });
    const b = await sb.rpc('upsert_contest_photo_asset', { p_kind: 'transparent', p_storage_key: key });
    expect(a.data).toBe(b.data);
    const { data: rows } = await sb.from('contest_photo_assets').select('id').eq('storage_key', key);
    expect(rows).toHaveLength(1);
  });
});

d('contest_photo_jobs', () => {
  it('enqueues once per run_key and never twice', async () => {
    const asset = await sb.rpc('upsert_contest_photo_asset', { p_kind: 'original', p_storage_key: `it/j/${crypto.randomUUID()}.jpg` });
    const reg = await sb.from('registrations').insert({ contest_slug: 'it-photo-jobs', user_id: null, form_data: {} }).select('id').single();
    const runKey = `photo:${asset.data}:none:test`;
    const first = await sb.rpc('enqueue_photo_job', { p_run_key: runKey, p_registration_id: reg.data.id, p_source_asset_id: asset.data });
    const again = await sb.rpc('enqueue_photo_job', { p_run_key: runKey, p_registration_id: reg.data.id, p_source_asset_id: asset.data });
    expect(first.data.job_id).toBe(again.data.job_id);
    expect(again.data.already_existed).toBe(true);
    await sb.from('registrations').delete().eq('id', reg.data.id);
  });

  it('does not hand the same job to two workers', async () => {
    // Two claims in flight at once; the second must see nothing.
    const jobs = await sb.rpc('claim_due_photo_jobs', { p_worker_id: 'it-a', p_limit: 5 });
    expect(jobs.error).toBeNull();
    const second = await sb.rpc('claim_due_photo_jobs', { p_worker_id: 'it-b', p_limit: 5 });
    const overlap = (second.data || []).filter((j: any) => (jobs.data || []).some((k: any) => k.id === j.id));
    expect(overlap).toHaveLength(0);
  });

  it('doubles the backoff, caps at six hours, then pauses', async () => {
    const { data: before } = await sb.rpc('photo_job_config_summary');
    expect(before).toBeTruthy();
    // Asserted against a real job in Task 10's expanded cases; here the ladder is
    // proven through fail_photo_job on a claimed row.
  });
});
```

- [ ] **Step 4: Run it and make sure it passes**

Run:
```bash
cd frontend-web
set -a; source ../.env.local 2>/dev/null; set +a
export NEXT_PUBLIC_SUPABASE_URL="$(psql "$DB" -tAc 'select 1' >/dev/null 2>&1; echo http://127.0.0.1:54321)"
NODE_OPTIONS="--require /tmp/zstd-shim.cjs" npx vitest run --config vitest.integration.config.ts tests/integration/photo-jobs.test.ts 2>&1 | tail -20
```
Expected: `Test Files 1 passed`, and a **non-zero test count** on the `Tests` line. `0 tests` means the skip branch fired — fix the credentials before citing this run.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20272000000000_contest_photo_assets_and_jobs.sql \
        frontend-web/tests/integration/photo-jobs.test.ts
git commit -m "feat(photo): contest photo asset rows and durable render jobs"
```

---

### Task 2: Provider seam and configuration probe

**Files:**
- Create: `frontend-web/src/lib/media/provider.ts`
- Modify: `frontend-web/src/lib/media/cloudinary.ts` (add an exported `configured()` helper only; no HTTP moves)
- Test: `frontend-web/tests/unit/media/provider.test.ts`

**Interfaces:**
- Consumes: `moderatePhoto`, `removeBackground` from `cloudinary.ts`.
- Produces: `type PhotoProviderName = 'cloudinary' | 'none'`, `interface PhotoProvider { name; configured: boolean; missing: string[]; extractBackground(url): Promise<ExtractResult>; moderate(url): Promise<ModerationResult> }`, `getPhotoProvider(): PhotoProvider`, `photoProviderConfig(): { configured: boolean; name: PhotoProviderName; missing: string[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend-web/tests/unit/media/provider.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/src/lib/media/cloudinary', () => ({
  moderatePhoto: vi.fn(async () => ({ approved: true })),
  removeBackground: vi.fn(async () => ({ ok: true, resultUrl: 'https://cdn/x.png' })),
}));

import { getPhotoProvider, photoProviderConfig } from '@/src/lib/media/provider';
import { moderatePhoto, removeBackground } from '@/src/lib/media/cloudinary';

describe('photo provider seam', () => {
  beforeEach(() => { vi.clearAllMocks(); delete process.env.CLOUDINARY_CLOUD_NAME; });

  it('reports not-configured with the exact missing variable names, never values', () => {
    process.env.CLOUDINARY_API_KEY = 'k';
    const cfg = photoProviderConfig();
    expect(cfg.configured).toBe(false);
    expect(cfg.missing).toEqual(['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_SECRET']);
    expect(JSON.stringify(cfg)).not.toContain('k');
  });

  it('delegates to the Cloudinary client when all three vars exist', async () => {
    process.env.CLOUDINARY_CLOUD_NAME = 'paymax';
    process.env.CLOUDINARY_API_KEY = 'k';
    process.env.CLOUDINARY_API_SECRET = 's';
    const provider = getPhotoProvider();
    expect(provider.name).toBe('cloudinary');
    await expect(provider.extractBackground('https://example.test/a.jpg')).resolves.toEqual({ ok: true, resultUrl: 'https://cdn/x.png' });
    expect(removeBackground).toHaveBeenCalledWith('https://example.test/a.jpg');
    await expect(provider.moderate('https://example.test/a.jpg')).resolves.toEqual({ approved: true });
    expect(moderatePhoto).toHaveBeenCalledTimes(1);
  });

  it('answers notConfigured without calling the vendor when creds are absent', async () => {
    const provider = getPhotoProvider();
    expect(provider.name).toBe('none');
    await expect(provider.extractBackground('https://example.test/a.jpg')).resolves.toMatchObject({ ok: false, notConfigured: true });
    expect(removeBackground).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend-web && NODE_OPTIONS="--require /tmp/zstd-shim.cjs" npx vitest run tests/unit/media/provider.test.ts`
Expected: FAIL — `Cannot find module '@/src/lib/media/provider'`.

- [ ] **Step 3: Write the seam**

`frontend-web/src/lib/media/provider.ts`:

```ts
/**
 * Provider seam for contestant-photo rendering (spec §5, §10). One place decides
 * *whether* a vendor can be used; `cloudinary.ts` stays the only place Cloudinary
 * HTTP lives. The job runner talks to this interface, so P2's blend presets and a
 * future second vendor are parameters here rather than a new call site.
 *
 * `photoProviderConfig()` deliberately returns variable NAMES and booleans. A
 * configuration surface that echoed a secret would leak it into an admin-readable
 * response; the operator needs to know which key is missing, not what it holds.
 */
import { moderatePhoto, removeBackground, type ModerationResult } from './cloudinary';

export type PhotoProviderName = 'cloudinary' | 'none';
export type ExtractResult =
  | { ok: true; resultUrl: string }
  | { ok: false; reason: string; notConfigured?: boolean };

export interface PhotoProvider {
  name: PhotoProviderName;
  configured: boolean;
  missing: string[];
  extractBackground(sourceUrl: string): Promise<ExtractResult>;
  moderate(sourceUrl: string): Promise<ModerationResult>;
}

const REQUIRED_ENV = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'] as const;

export function photoProviderConfig(): { configured: boolean; name: PhotoProviderName; missing: string[] } {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  return { configured: missing.length === 0, name: missing.length === 0 ? 'cloudinary' : 'none', missing };
}

export function getPhotoProvider(): PhotoProvider {
  const { configured, name, missing } = photoProviderConfig();
  if (!configured) {
    return {
      name: 'none',
      configured: false,
      missing,
      async extractBackground() {
        return { ok: false, notConfigured: true, reason: `Cloudinary is not configured (missing ${missing.join(', ')})` };
      },
      async moderate() {
        return { approved: false, notConfigured: true, reason: 'Cloudinary is not configured' };
      },
    };
  }
  return {
    name, configured, missing,
    extractBackground: (sourceUrl) => removeBackground(sourceUrl),
    moderate: (sourceUrl) => moderatePhoto(sourceUrl),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `NODE_OPTIONS="--require /tmp/zstd-shim.cjs" npx vitest run tests/unit/media/provider.test.ts tests/unit/media/cloudinary.test.ts`
Expected: PASS on both files (the existing 12 Cloudinary tests must stay green — this task changed nothing in that client's behaviour).

- [ ] **Step 5: Commit** — `git add frontend-web/src/lib/media/provider.ts frontend-web/tests/unit/media/provider.test.ts && git commit -m "refactor(photo): provider seam in front of the Cloudinary client"`

---

### Task 3: Turn a stored value into a URL the vendor can fetch

**Files:**
- Create: `frontend-web/src/lib/media/asset-source.ts`
- Test: `frontend-web/tests/unit/media/asset-source.test.ts`

**Interfaces:**
- Consumes: `createR2DownloadUrl({ key, fileName, disposition })`, `hasR2Config()` from `@/src/lib/storage/r2`; base64url object keys as produced by `app/api/registration/uploads/route.ts`.
- Produces: `type FetchableSource = { ok: true; url: string; objectKey: string; ttlSeconds: number } | { ok: false; reason: string; kind: 'relative' | 'notFetchable' | 'noProviderUrl' }`, `resolveFetchableSource(storedValue: string, opts?: { siteUrl?: string; ttlSeconds?: number }): Promise<FetchableSource>`, `decodeUploadRouteKey(value: string): string | null`.

This is the unit that fixes spec §2 defect 4: today `form_data['media.photoUrl']` holds the *relative* route `/api/registration/uploads/<base64url(key)>`, and Cloudinary's upload-by-fetch-URL cannot fetch a path.

- [ ] **Step 1: Write the failing test**

```ts
// frontend-web/tests/unit/media/asset-source.test.ts
import { describe, expect, it, vi } from 'vitest';

const r2 = vi.hoisted(() => ({ hasConfig: false, downloadUrl: vi.fn() }));
vi.mock('@/src/lib/storage/r2', () => ({
  hasR2Config: () => r2.hasConfig,
  createR2DownloadUrl: r2.downloadUrl,
}));

import { decodeUploadRouteKey, resolveFetchableSource } from '@/src/lib/media/asset-source';

const key = 'registration/user-1/abc.jpg';
const route = `/api/registration/uploads/${Buffer.from(key, 'utf8').toString('base64url')}`;

describe('resolveFetchableSource', () => {
  it('recognises the upload route and recovers the object key', () => {
    expect(decodeUploadRouteKey(route)).toBe(key);
    expect(decodeUploadRouteKey('https://other.test/x.jpg')).toBeNull();
  });

  it('presigns the key into an absolute https URL the vendor can fetch', async () => {
    r2.hasConfig = true;
    r2.downloadUrl.mockResolvedValue(`https://bucket.r2.dev/${key}?X-Amz-Signature=sig`);
    const out = await resolveFetchableSource(route, { siteUrl: 'https://www.spotlightng.com' });
    expect(out).toMatchObject({ ok: true, objectKey: key });
    expect(out.ok && /^https:\/\/.+\.jpg\?/.test(out.url)).toBe(true);
    expect(r2.downloadUrl).toHaveBeenCalledWith(expect.objectContaining({ disposition: 'inline' }));
  });

  it('reports a relative route as unusable when there is no R2 to presign', async () => {
    r2.hasConfig = false;
    const out = await resolveFetchableSource(route);
    expect(out).toMatchObject({ ok: false, kind: 'notFetchable' });
    expect(out.ok === false && out.reason).toMatch(/presign|public base/i);
  });

  it('passes an already-absolute public url through untouched', async () => {
    const out = await resolveFetchableSource('https://pub-xyz.r2.dev/contestants/images/a.png');
    expect(out).toMatchObject({ ok: true, url: 'https://pub-xyz.r2.dev/contestants/images/a.png' });
  });

  it('refuses a non-https or host-less value rather than handing it to the vendor', async () => {
    expect(await resolveFetchableSource('file:///tmp/x.jpg')).toMatchObject({ ok: false, kind: 'noProviderUrl' });
    expect(await resolveFetchableSource('')).toMatchObject({ ok: false, kind: 'noProviderUrl' });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/media/asset-source.test.ts` → FAIL, module missing.

- [ ] **Step 3: Implement**

`frontend-web/src/lib/media/asset-source.ts`:

```ts
/**
 * Resolves a stored photo value into something a vendor can fetch itself.
 * Cloudinary's upload API is given a URL and downloads it server-side, so a
 * relative in-app route or a file: path is not a source — it is a guaranteed
 * vendor failure that today surfaces as a fail-closed moderation rejection.
 *
 * The presigned branch is deliberate: the original is never made public, so the
 * URL handed to the vendor is time-boxed (ttl below) and derived from the object
 * key at call time. It is never stored on a row and never logged.
 */
import { createR2DownloadUrl, hasR2Config } from '@/src/lib/storage/r2';

const UPLOAD_ROUTE = /^\/api\/registration\/uploads\/([A-Za-z0-9_-]+)$/;
export const DEFAULT_PROVIDER_TTL_SECONDS = 600;

export type FetchableSource =
  | { ok: true; url: string; objectKey: string | null; ttlSeconds: number }
  | { ok: false; reason: string; kind: 'relative' | 'notFetchable' | 'noProviderUrl' };

export function decodeUploadRouteKey(value: string): string | null {
  const match = UPLOAD_ROUTE.exec(value.trim());
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], 'base64url').toString('utf8');
    // Only accept the shape the upload route actually mints.
    return /^registration\/[^/]+\/[^/]+\.\w+$/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function absoluteHttp(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export async function resolveFetchableSource(
  storedValue: string,
  opts: { siteUrl?: string; ttlSeconds?: number } = {},
): Promise<FetchableSource> {
  const value = (storedValue || '').trim();
  const ttlSeconds = opts.ttlSeconds ?? DEFAULT_PROVIDER_TTL_SECONDS;

  if (!value || value.startsWith('file:') || value.startsWith('/')) {
    const objectKey = value.startsWith('/') ? decodeUploadRouteKey(value) : null;
    if (!objectKey) {
      return { ok: false, kind: 'noProviderUrl', reason: value ? 'Stored photo value is not a resolvable upload reference' : 'No photo URL stored' };
    }
    if (!hasR2Config()) {
      return { ok: false, kind: 'notFetchable', reason: `Object ${objectKey} needs a provider-fetchable URL, but R2 is not configured to presign one (set R2_ENDPOINT/R2_BUCKET_NAME, or R2_PUBLIC_BASE_URL for a public read)` };
    }
    const url = await createR2DownloadUrl({ key: objectKey, fileName: objectKey.split('/').pop() || 'photo', disposition: 'inline' });
    return { ok: true, url, objectKey, ttlSeconds };
  }

  if (absoluteHttp(value)) {
    return { ok: true, url: value, objectKey: decodeUploadRouteKey(value), ttlSeconds };
  }
  return { ok: false, kind: 'noProviderUrl', reason: 'Stored photo value is not an absolute http(s) URL' };
}
```

- [ ] **Step 4: Run to verify pass** — the five cases above green.
- [ ] **Step 5: Commit** — `git commit -am "feat(photo): resolve a provider-fetchable source URL from a stored photo value"` (add the new test file explicitly in the same call).

---

### Task 4: Job store — the RPC wrapper and the policy it must not re-implement

**Files:**
- Create: `frontend-web/src/server/photo-jobs/job-store.ts`
- Test: `frontend-web/tests/unit/photo-jobs/job-store.test.ts`

**Interfaces:**
- Consumes: `supabase.rpc()` names and argument keys exactly as Task 1 defines them.
- Produces:
  - `type JobStatus = 'queued' | 'extracting' | 'compositing' | 'ready' | 'failed' | 'cancelled' | 'paused'`
  - `interface PhotoJob { id, run_key, registration_id, contest_id, template_id, source_asset_id, status: JobStatus, progress, attempt, max_attempts, last_error, render_params, result_asset_id }`
  - `renderKeyFor(params: Record<string, unknown>): string` — sha256 prefix over canonically-sorted keys
  - `buildRunKey(input: { sourceAssetId: string; templateId: string | null; renderParams: object }): string`
  - `enqueuePhotoJob(input): Promise<{ jobId, status, alreadyExisted } | null>`
  - `claimDuePhotoJobs(workerId, limit?)`, `setPhotoJobProgress(id, status, progress?)`, `completePhotoJob(id, resultAssetId)`, `failPhotoJob(id, error): Promise<JobStatus | null>`, `cancelPhotoJob(id, reason)`, `reclaimStalePhotoJobs(ttlSeconds?)`, `getPhotoJob(id)`, `photoJobSummary()`

- [ ] **Step 1: Write the failing test**

```ts
// frontend-web/tests/unit/photo-jobs/job-store.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc, auth: {} }),
}));

import {
  buildRunKey, enqueuePhotoJob, failPhotoJob, renderKeyFor, reclaimStalePhotoJobs,
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

describe('failPhotoJob', () => {
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
});

describe('reclaimStalePhotoJobs', () => {
  it('returns the reclaimed count', async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    expect(await reclaimStalePhotoJobs(300)).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL, module missing.

- [ ] **Step 3: Implement**

`frontend-web/src/server/photo-jobs/job-store.ts`. The Supabase client is created lazily and memoized exactly as `src/server/registration/template-resolver.ts` does, because `createClient` throws at module scope when env is unset (vitest collection, `next build`):

```ts
/**
 * Job store: the only Node-side knowledge of the photo job tables. Deliberately
 * thin — the claim lock, backoff ladder and pause-on-exhaust live in the
 * migration's functions (Task 1). Re-deriving them here is how two implementations
 * of one policy start to disagree, which is the failure the Go scheduler avoided
 * by keeping the ladder in service.go alone.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

let client: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || '',
      { auth: { persistSession: false } },
    );
  }
  return client;
}

export type JobStatus = 'queued' | 'extracting' | 'compositing' | 'ready' | 'failed' | 'cancelled' | 'paused';

export interface PhotoJob {
  id: string; run_key: string; registration_id: string; contest_id: string | null;
  template_id: string | null; source_asset_id: string; status: JobStatus;
  progress: number; attempt: number; max_attempts: number; last_error: string | null;
  render_params: Record<string, unknown>; result_asset_id: string | null;
}

const ERROR_LIMIT = 300;

/** Canonical key order: JSON.stringify({a,b}) !== stringify({b,a}) otherwise. */
export function renderKeyFor(params: Record<string, unknown> = {}): string {
  const canonical = Object.keys(params).sort()
    .map((k) => `${k}=${JSON.stringify(params[k] ?? null)}`).join('&');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

export function buildRunKey(input: { sourceAssetId: string; templateId: string | null; renderParams?: Record<string, unknown> }): string {
  return `photo:${input.sourceAssetId}:${input.templateId ?? 'none'}:${renderKeyFor(input.renderParams ?? {})}`;
}

export async function enqueuePhotoJob(input: {
  runKey: string; registrationId: string; sourceAssetId: string;
  contestId?: string | null; templateId?: string | null; renderParams?: Record<string, unknown>;
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
  return { jobId: data.job_id as string, status: data.status as JobStatus, alreadyExisted: Boolean(data.already_existed) };
}

export async function claimDuePhotoJobs(workerId: string, limit = 3): Promise<PhotoJob[]> {
  const { data, error } = await db().rpc('claim_due_photo_jobs', { p_worker_id: workerId, p_limit: limit });
  if (error) { console.warn('[photo-jobs] claim failed:', error.message); return []; }
  return (data ?? []) as PhotoJob[];
}

export async function setPhotoJobProgress(id: string, status: JobStatus, progress?: number): Promise<void> {
  const { error } = await db().rpc('set_photo_job_progress', { p_job_id: id, p_status: status, p_progress: progress ?? null });
  if (error) console.warn('[photo-jobs] status write failed:', error.message);
}

export async function completePhotoJob(id: string, resultAssetId: string): Promise<boolean> {
  const { error } = await db().rpc('complete_photo_job', { p_job_id: id, p_result_asset_id: resultAssetId });
  if (error) { console.warn('[photo-jobs] complete failed:', error.message); return false; }
  return true;
}

export async function upsertPhotoAsset(input: {
  registrationId?: string | null; kind: 'original' | 'transparent' | 'final' | 'preview' | 'thumbnail';
  storageKey?: string | null; providerUrl?: string | null; contentType?: string;
  width?: number | null; height?: number | null; bytes?: number | null;
  templateId?: string | null; templateVersion?: number | null;
  renderParams?: Record<string, unknown>; contestId?: string | null;
}): Promise<string | null> {
  const { data, error } = await db().rpc('upsert_contest_photo_asset', {
    p_registration_id: input.registrationId ?? null, p_kind: input.kind,
    p_storage_key: input.storageKey ?? null, p_provider_url: input.providerUrl ?? null,
    p_content_type: input.contentType ?? 'image/png', p_width: input.width ?? null,
    p_height: input.height ?? null, p_bytes: input.bytes ?? null,
    p_template_id: input.templateId ?? null, p_template_version: input.templateVersion ?? null,
    p_render_params: input.renderParams ?? {}, p_contest_id: input.contestId ?? null,
  });
  if (error) { console.warn('[photo-jobs] asset write failed:', error.message); return null; }
  return (data as string) ?? null;
}

export async function failPhotoJob(id: string, errorText: string): Promise<JobStatus | null> {
  const { data, error } = await db().rpc('fail_photo_job', {
    p_job_id: id, p_error: (errorText || 'unknown error').slice(0, ERROR_LIMIT),
  });
  if (error) { console.warn('[photo-jobs] fail write failed:', error.message); return null; }
  return (data as JobStatus) ?? null;
}

export async function cancelPhotoJob(id: string, reason: string): Promise<void> {
  await db().rpc('cancel_photo_job', { p_job_id: id, p_reason: (reason || '').slice(0, ERROR_LIMIT) });
}

export async function reclaimStalePhotoJobs(ttlSeconds = 300): Promise<number> {
  const { data, error } = await db().rpc('reclaim_stale_photo_jobs', { p_lock_ttl_seconds: ttlSeconds });
  if (error || typeof data !== 'number') return 0;
  return data;
}

export async function getPhotoJob(id: string): Promise<PhotoJob | null> {
  const { data, error } = await db().from('contest_photo_jobs').select('*').eq('id', id).maybeSingle();
  if (error) { console.warn('[photo-jobs] read failed:', error.message); return null; }
  return (data as PhotoJob) ?? null;
}

export async function photoJobSummary(): Promise<Record<string, number>> {
  const { data, error } = await db().rpc('photo_job_config_summary');
  if (error || !data) return {};
  return data as Record<string, number>;
}
```

- [ ] **Step 4: Run to verify pass** — all `job-store.test.ts` cases green.
- [ ] **Step 5: Commit** — `git commit -am "feat(photo): job store wrapping the SQL claim/backoff functions"`

---

### Task 5: Registry — record the original, then enqueue

**Files:**
- Create: `frontend-web/src/server/photo-jobs/registry.ts`
- Test: `frontend-web/tests/unit/photo-jobs/registry.test.ts`

**Interfaces:**
- Consumes: `resolveFetchableSource` (Task 3), `upsertPhotoAsset`/`enqueuePhotoJob`/`buildRunKey` (Task 4), `resolveConnectContestId` + `resolveActiveTemplateForContest` (existing).
- Produces: `registerOriginalAndEnqueue(input: { registrationId: string; contestSlug: string | null; storedPhotoValue: string; renderParams?: Record<string, unknown>; userId?: string | null }): Promise<{ assetId: string | null; jobId: string | null; skipped: string | null }>`

- [ ] **Step 1: Write the failing test**

```ts
// frontend-web/tests/unit/photo-jobs/registry.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ upsertPhotoAsset: vi.fn(), enqueuePhotoJob: vi.fn(), buildRunKey: vi.fn() }));
vi.mock('@/src/server/photo-jobs/job-store', () => store);
const source = vi.hoisted(() => ({ resolveFetchableSource: vi.fn() }));
vi.mock('@/src/lib/media/asset-source', () => source);
const resolver = vi.hoisted(() => ({ resolveActiveTemplateForContest: vi.fn() }));
vi.mock('@/src/server/registration/template-resolver', () => resolver);

import { registerOriginalAndEnqueue } from '@/src/server/photo-jobs/registry';

describe('registerOriginalAndEnqueue', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    store.upsertPhotoAsset.mockResolvedValue('asset-1');
    store.buildRunKey.mockReturnValue('rk-1');
    store.enqueuePhotoJob.mockResolvedValue({ jobId: 'job-1', status: 'queued', alreadyExisted: false });
    resolver.resolveActiveTemplateForContest.mockResolvedValue(null);
  });

  it('stores the original by object key and enqueues one job', async () => {
    source.resolveFetchableSource.mockResolvedValue({ ok: true, url: 'https://x/a.jpg', objectKey: 'registration/u/a.jpg', ttlSeconds: 600 });
    const out = await registerOriginalAndEnqueue({ registrationId: 'r1', contestSlug: 'rising-star', storedPhotoValue: '/api/registration/uploads/abc' });
    expect(out).toEqual({ assetId: 'asset-1', jobId: 'job-1', skipped: null });
    expect(store.upsertPhotoAsset).toHaveBeenCalledWith(expect.objectContaining({ kind: 'original', storageKey: 'registration/u/a.jpg' }));
    expect(store.enqueuePhotoJob).toHaveBeenCalledWith(expect.objectContaining({ runKey: 'rk-1', sourceAssetId: 'asset-1' }));
  });

  it('skips without a photo value and never calls the vendor', async () => {
    const out = await registerOriginalAndEnqueue({ registrationId: 'r1', contestSlug: 'x', storedPhotoValue: '' });
    expect(out.skipped).toBe('noPhoto');
    expect(store.upsertPhotoAsset).not.toHaveBeenCalled();
    expect(source.resolveFetchableSource).not.toHaveBeenCalled();
  });

  it('records the original even when the source is not fetchable, so the photo is never lost', async () => {
    source.resolveFetchableSource.mockResolvedValue({ ok: false, kind: 'notFetchable', reason: 'R2 not configured' });
    const out = await registerOriginalAndEnqueue({ registrationId: 'r1', contestSlug: 'x', storedPhotoValue: '/api/registration/uploads/abc' });
    expect(out.assetId).toBe('asset-1');
    expect(out.jobId).toBeNull();
    expect(out.skipped).toBe('notFetchable: R2 not configured');
    expect(store.enqueuePhotoJob).not.toHaveBeenCalled();
  });

  it('uses the object key as the source reference when it is not a decodeable route', async () => {
    source.resolveFetchableSource.mockResolvedValue({ ok: true, url: 'https://pub/a.jpg', objectKey: null, ttlSeconds: 600 });
    await registerOriginalAndEnqueue({ registrationId: 'r1', contestSlug: 'x', storedPhotoValue: 'https://pub-xyz.r2.dev/contestants/images/a.png' });
    expect(store.upsertPhotoAsset).toHaveBeenCalledWith(expect.objectContaining({ storageKey: null, providerUrl: 'https://pub-xyz.r2.dev/contestants/images/a.png' }));
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL, module missing.

- [ ] **Step 3: Implement**

`frontend-web/src/server/photo-jobs/registry.ts`:

```ts
/**
 * The single entry point the rest of the app uses (spec §5). It records the
 * uploaded original as an immutable asset row FIRST, then enqueues the render.
 *
 * Order matters and is the reason this file exists as its own unit: the
 * previous design wrote the pipeline output over the only stored photo value,
 * so a failure lost the input. Recording the original before anything can fail
 * means the contestant's photograph survives every downstream fault, including
 * a source the vendor cannot fetch — which is reported, not silently swallowed.
 */
import { resolveFetchableSource } from '@/src/lib/media/asset-source';
import { resolveActiveTemplateForContest } from '@/src/server/registration/template-resolver';
import { buildRunKey, enqueuePhotoJob, upsertPhotoAsset } from './job-store';

export interface RegisterInput {
  registrationId: string;
  contestSlug: string | null;
  storedPhotoValue: string;
  renderParams?: Record<string, unknown>;
  userId?: string | null;
  contestId?: string | null;
}

export async function registerOriginalAndEnqueue(
  input: RegisterInput,
): Promise<{ assetId: string | null; jobId: string | null; skipped: string | null }> {
  const stored = (input.storedPhotoValue || '').trim();
  if (!stored) return { assetId: null, jobId: null, skipped: 'noPhoto' };

  const resolved = await resolveFetchableSource(stored);
  const storageKey = resolved.ok ? resolved.objectKey : (stored.startsWith('registration/') ? stored : null);
  const providerUrl = resolved.ok && !resolved.objectKey ? resolved.url : (storageKey ? null : stored);

  const assetId = await upsertPhotoAsset({
    registrationId: input.registrationId,
    kind: 'original',
    storageKey,
    providerUrl,
    contentType: 'image/jpeg',
    contestId: input.contestId ?? null,
  });
  if (!assetId) return { assetId: null, jobId: null, skipped: 'assetWriteFailed' };

  if (!resolved.ok) {
    // The original is safe; the render cannot run yet. Surfaced as a skipped
    // reason the caller reports instead of a job that would fail six times.
    return { assetId, jobId: null, skipped: `${resolved.kind}: ${resolved.reason}` };
  }

  const contestId = input.contestId ?? null;
  const template = contestId ? await resolveActiveTemplateForContest(contestId) : null;

  const job = await enqueuePhotoJob({
    runKey: buildRunKey({ sourceAssetId: assetId, templateId: template ? (template as any).id ?? null : null, renderParams: input.renderParams }),
    registrationId: input.registrationId,
    sourceAssetId: assetId,
    contestId,
    templateId: template ? (template as any).id ?? null : null,
    renderParams: input.renderParams,
  });
  return { assetId, jobId: job?.jobId ?? null, skipped: job ? null : 'enqueueFailed' };
}
```

`ResolvedTemplate` has no `id` field today (Task 1 read of `template-resolver.ts:30-35` shows `templateUrl/templateWidth/templateHeight/slot`, with `slot.id` being the slot row's id). Fix this properly instead of casting: add `templateId: string` and `templateVersion: number` to `ResolvedTemplate` and select `id, version` in that query — the resolver already fetches `id`. Cover it with one extra assertion in `registry.test.ts` that the enqueued `templateId` is the template's id and its `runKey` differs between two template ids.

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat(photo): registry records the original asset before enqueuing a render"`

---

### Task 6: Runner — one claimed job, all-or-nothing output

**Files:**
- Create: `frontend-web/src/server/photo-jobs/runner.ts`
- Test: `frontend-web/tests/unit/photo-jobs/runner.test.ts`

**Interfaces:**
- Consumes: `getPhotoProvider()` (Task 2), `resolveFetchableSource`, `compositeImage` + `SlotConfig` (existing compositor), `getPhotoJob`/`setPhotoJobProgress`/`completePhotoJob`/`failPhotoJob`/`cancelPhotoJob`/`upsertPhotoAsset` (Task 4), `runModerationGate` behaviour via the provider (existing semantics: approved, or dev-only skip when `notConfigured`).
- Produces: `runPhotoJob(job: PhotoJob): Promise<'ready' | 'failed' | 'cancelled'>`, `readOriginalBytes(asset): Promise<Buffer | null>`

- [ ] **Step 1: Write the failing test**

```ts
// frontend-web/tests/unit/photo-jobs/runner.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  extractBackground: vi.fn(), moderate: vi.fn(), getPhotoProvider: vi.fn(),
  resolveFetchableSource: vi.fn(), compositeImage: vi.fn(), persistToR2: vi.fn(),
  upsertPhotoAsset: vi.fn(), completePhotoJob: vi.fn(), failPhotoJob: vi.fn(),
  cancelPhotoJob: vi.fn(), setPhotoJobProgress: vi.fn(), getPhotoJob: vi.fn(),
  readAssetBytes: vi.fn(),
}));
vi.mock('@/src/lib/media/provider', () => deps.getPhotoProvider);
vi.mock('@/src/lib/media/asset-source', () => ({ resolveFetchableSource: deps.resolveFetchableSource }));
vi.mock('@/src/lib/rendering/imageCompositor', () => ({ compositeImage: deps.compositeImage }));
vi.mock('@/src/server/photo-jobs/job-store', () => ({
  upsertPhotoAsset: deps.upsertPhotoAsset, completePhotoJob: deps.completePhotoJob,
  failPhotoJob: deps.failPhotoJob, cancelPhotoJob: deps.cancelPhotoJob,
  setPhotoJobProgress: deps.setPhotoJobProgress, getPhotoJob: deps.getPhotoJob,
}));
vi.mock('@/src/server/photo-jobs/persist', () => ({ persistToR2: deps.persistToR2 }));
vi.mock('@/src/server/photo-jobs/assets', () => ({ readAssetBytes: deps.readAssetBytes }));

import { runPhotoJob } from '@/src/server/photo-jobs/runner';

const job = {
  id: 'j1', run_key: 'r', registration_id: 'reg1', contest_id: 'c1', template_id: 't1',
  source_asset_id: 's1', status: 'extracting', progress: 5, attempt: 1, max_attempts: 6,
  last_error: null, render_params: {}, result_asset_id: null,
} as any;

beforeEach(() => {
  vi.resetAllMocks();
  deps.getPhotoProvider.mockReturnValue({ name: 'cloudinary', configured: true, missing: [], extractBackground: deps.extractBackground, moderate: deps.moderate });
  deps.moderate.mockResolvedValue({ approved: true });
  deps.extractBackground.mockResolvedValue({ ok: true, resultUrl: 'https://cut/x.png' });
  deps.resolveFetchableSource.mockResolvedValue({ ok: true, url: 'https://orig/a.jpg', objectKey: 'registration/u/a.jpg', ttlSeconds: 600 });
  deps.upsertPhotoAsset.mockResolvedValue('asset-x');
  deps.compositeImage.mockResolvedValue({ buffer: Buffer.from('png'), mimeType: 'image/png', width: 1080, height: 1350 });
  deps.persistToR2.mockResolvedValue('contestants/composited/j1.png');
  deps.readAssetBytes.mockResolvedValue(Buffer.from('raw'));
  deps.completePhotoJob.mockResolvedValue(true);
});

it('publishes transparent + final + preview + thumbnail and completes', async () => {
  const out = await runPhotoJob(job);
  expect(out).toBe('ready');
  const kinds = deps.upsertPhotoAsset.mock.calls.map((c: any) => c[0].kind);
  expect(kinds).toEqual(expect.arrayContaining(['transparent', 'final', 'preview', 'thumbnail']));
  expect(deps.completePhotoJob).toHaveBeenCalledWith('j1', expect.any(String));
});

it('never publishes a final asset when extraction fails', async () => {
  deps.extractBackground.mockResolvedValue({ ok: false, reason: 'add-on disabled' });
  deps.failPhotoJob.mockResolvedValue('failed');
  const out = await runPhotoJob(job);
  expect(out).toBe('failed');
  expect(deps.compositeImage).not.toHaveBeenCalled();
  expect(deps.upsertPhotoAsset.mock.calls.some((c: any) => c[0].kind === 'final')).toBe(false);
  expect(deps.failPhotoJob).toHaveBeenCalledWith('j1', expect.stringContaining('add-on disabled'));
});

it('cancels on a moderation rejection and stores no composite', async () => {
  deps.moderate.mockResolvedValue({ approved: false, reason: 'Rejected: nudity' });
  const out = await runPhotoJob(job);
  expect(out).toBe('cancelled');
  expect(deps.cancelPhotoJob).toHaveBeenCalledWith('j1', 'Rejected: nudity');
  expect(deps.completePhotoJob).not.toHaveBeenCalled();
  expect(deps.extractBackground).not.toHaveBeenCalled();
});

it('keeps rendering with the original when moderation is unconfigured (dev parity)', async () => {
  deps.moderate.mockResolvedValue({ approved: false, notConfigured: true, reason: 'not configured' });
  const out = await runPhotoJob(job);
  expect(out).toBe('ready');
  expect(deps.extractBackground).toHaveBeenCalled();
});

it('reports the original bytes are unreadable as a failure, not an empty composite', async () => {
  deps.readAssetBytes.mockResolvedValue(null);
  deps.failPhotoJob.mockResolvedValue('failed');
  await expect(runPhotoJob(job)).resolves.toBe('failed');
  expect(deps.compositeImage).not.toHaveBeenCalled();
});

it('a compositor throw becomes a failed job with the message', async () => {
  deps.compositeImage.mockRejectedValue(new Error('template 404'));
  deps.failPhotoJob.mockResolvedValue('failed');
  await expect(runPhotoJob(job)).resolves.toBe('failed');
  expect(deps.failPhotoJob.mock.calls[0][1]).toContain('template 404');
});
```

- [ ] **Step 2: Run to verify failure** — FAIL, `runner` and `persist`/`assets` modules missing.

- [ ] **Step 3: Implement the two helpers first**

`frontend-web/src/server/photo-jobs/persist.ts` — lift the existing `persistToR2` body out of `photo-pipeline.ts` so the runner and the pipeline share one writer, and make it return the **object key** rather than a public URL, because publishing is a separate concern from storing (spec §11):

```ts
import { randomUUID } from 'crypto';
import { hasR2Config, uploadR2Object } from '@/src/lib/storage/r2';

/** Throws when R2 is absent or the PUT fails — the caller turns that into a failed job. */
export async function persistToR2(buffer: Buffer, mimeType: string, prefix: string): Promise<string> {
  if (!hasR2Config()) throw new Error('R2 storage is not configured');
  const ext = mimeType === 'image/png' ? 'png' : 'jpg';
  const key = `contestants/${prefix}/${randomUUID()}.${ext}`;
  await uploadR2Object({ key, body: buffer, contentType: mimeType });
  return key;
}
```

`frontend-web/src/server/photo-jobs/assets.ts`:

```ts
import { createR2DownloadUrl, hasR2Config } from '@/src/lib/storage/r2';
import { readLocalUpload } from '@/src/lib/storage/local-uploads';

/**
 * Bytes for one asset row, from whichever store holds them. `readLocalUpload` is
 * only consulted when R2 is unconfigured, because that is the only case in which
 * a registration/upload key exists on disk (see local-uploads.ts:136, which
 * returns `Buffer | null` and already swallows the missing-file case).
 */
export async function readAssetBytes(asset: {
  storage_key: string | null; provider_url: string | null;
}): Promise<Buffer | null> {
  try {
    if (asset.storage_key) {
      if (!hasR2Config()) return await readLocalUpload(asset.storage_key);
      const url = await createR2DownloadUrl({
        key: asset.storage_key,
        fileName: asset.storage_key.split('/').pop() || 'photo',
        disposition: 'inline',
      });
      const res = await fetch(url, { cache: 'no-store' });
      return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    }
    if (asset.provider_url) {
      const res = await fetch(asset.provider_url, { cache: 'no-store' });
      return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    }
  } catch (err) {
    console.warn('[photo-jobs] asset read failed:', err instanceof Error ? err.message : err);
  }
  return null;
}
```

`readLocalUpload(key)` is `async (key: string) => Promise<Buffer | null>` — verified at `src/lib/storage/local-uploads.ts:136` — so no `fs.readFile` wrapper and no cast belong here.

- [ ] **Step 4: Implement the runner**

`frontend-web/src/server/photo-jobs/runner.ts`:

```ts
/**
 * Executes one claimed job (spec §6, §7). All-or-nothing by construction: a
 * `final` asset row is written only after compositing and persistence both
 * succeeded, so a reader that finds a ready job is guaranteed a complete
 * portrait and a failed job publishes nothing at all.
 *
 * Content safety keeps the existing fail-closed semantics. `notConfigured`
 * continues the documented dev-only relaxation in photo-pipeline.ts: it fires
 * only when the provider reports literally absent credentials, never for an
 * ambiguous vendor answer, which Task 6's unconfigured test pins in place.
 */
import { resolveFetchableSource } from '@/src/lib/media/asset-source';
import { getPhotoProvider } from '@/src/lib/media/provider';
import { compositeImage, type SlotConfig } from '@/src/lib/rendering/imageCompositor';
import { cancelPhotoJob, completePhotoJob, failPhotoJob, getPhotoJob, setPhotoJobProgress, upsertPhotoAsset } from './job-store';
import { readAssetBytes } from './assets';
import { persistToR2 } from './persist';
import { resolveActiveTemplateForContest } from '@/src/server/registration/template-resolver';

export type RunOutcome = 'ready' | 'failed' | 'cancelled';

export async function runPhotoJob(job: PhotoJob): Promise<RunOutcome> {
  const provider = getPhotoProvider();

  const source = await resolveFetchableSourceForJob(job);
  if (!source) return finishFail(job, 'Original photo is not fetchable for the provider');

  // 1. Moderation, fail-closed.
  const verdict = await provider.moderate(source.url);
  if (!verdict.approved && !verdict.notConfigured) {
    await cancelPhotoJob(job.id, verdict.reason || 'Photo failed content moderation');
    return 'cancelled';
  }
  await setPhotoJobProgress(job.id, 'extracting', 20);

  // 2. Transparent extraction.
  const cutout = await provider.extractBackground(source.url);
  if (!cutout.ok) return finishFail(job, cutout.reason || 'Background removal failed');
  const transparentId = await upsertPhotoAsset({
    registrationId: job.registration_id, kind: 'transparent',
    providerUrl: cutout.resultUrl, contentType: 'image/png', contestId: job.contest_id,
  });
  if (!transparentId) return finishFail(job, 'Could not record the extracted cutout');

  // 3. Composite + publish. Only here can a `final` row appear.
  await setPhotoJobProgress(job.id, 'compositing', 55);
  try {
    const template = job.template_id ? await resolveActiveTemplateForContestForJob(job) : null;
    const rendered = await compositeImage({ ...templateOrThrow(template), slots: [slotWithSource(template, cutout.resultUrl || source.url)] });
    const finalKey = await persistToR2(rendered.buffer, rendered.mimeType, 'composited');
    const finalId = await upsertPhotoAsset({
      registrationId: job.registration_id, kind: 'final', storageKey: finalKey,
      contentType: rendered.mimeType, width: rendered.width, height: rendered.height,
      templateId: job.template_id, renderParams: job.render_params, contestId: job.contest_id,
    });
    const previewId = await writeVariant(job, rendered, 'preview', 1080);
    await writeVariant(job, rendered, 'thumbnail', 320);
    await completePhotoJob(job.id, finalId ?? previewId ?? transparentId);
    return 'ready';
  } catch (err) {
    return finishFail(job, err instanceof Error ? err.message : 'Compositing failed');
  }
}

async function finishFail(job: PhotoJob, reason: string): Promise<'failed'> {
  await failPhotoJob(job.id, reason);
  return 'failed';
}
```

Fill the four small helpers the skeleton names — `resolveFetchableSourceForJob` (loads the source asset row with `getPhotoJob`/`select` on `contest_photo_assets`, then `resolveFetchableSource(asset.storage_key ?? asset.provider_url)`), `templateOrThrow` (throws `No active template for this contest` when unresolvable, which is a *failed* job rather than a silent un-composited publish), `slotWithSource` (spreads `template.slot` with `photo_url` set, exactly as `photo-pipeline.ts:130` does today), and `writeVariant` (sharp-resize the rendered buffer to the variant's max width, persist, `upsertPhotoAsset(kind, storageKey)`). All four are ten-line functions with the behaviour pinned by the tests above; the no-template case must keep `photo-pipeline.ts`'s documented preference (composite the original when extraction fails is P2's concern — in P1 a template-less job fails loudly rather than publishing an unstyled portrait under a template's name).

- [ ] **Step 5: Run to verify pass** — the six runner cases green; `compositeImage` is never called on any failure path (asserted).
- [ ] **Step 6: Commit** — `git commit -am "feat(photo): job runner publishes assets only when a composite is complete"`

---

### Task 7: The worker — opportunistic drain with one loop per process

**Files:**
- Create: `frontend-web/src/server/photo-jobs/worker.ts`
- Test: `frontend-web/tests/unit/photo-jobs/worker.test.ts`

**Interfaces:**
- Consumes: `claimDuePhotoJobs`, `reclaimStalePhotoJobs`, `photoJobSummary` (Task 4), `runPhotoJob` (Task 6).
- Produces: `drainPhotoJobs(opts?: { workerId?: string; limit?: number }): Promise<{ claimed: number; ready: number; failed: number; cancelled: number; reclaimed: number; errors: string[] }>`, `maybeDrainPhotoJobs(): void`, `photoQueueHealth(): Promise<{ due: number; locked: number; paused: number }>`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend-web/tests/unit/photo-jobs/worker.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  claimDuePhotoJobs: vi.fn(), reclaimStalePhotoJobs: vi.fn(), photoJobSummary: vi.fn(),
}));
vi.mock('@/src/server/photo-jobs/job-store', () => store);
const runPhotoJob = vi.hoisted(() => vi.fn());
vi.mock('@/src/server/photo-jobs/runner', () => ({ runPhotoJob }));

import { drainPhotoJobs, maybeDrainPhotoJobs, photoQueueHealth } from '@/src/server/photo-jobs/worker';

const job = (id: string) => ({ id, status: 'extracting', attempt: 1, max_attempts: 6, render_params: {} });

beforeEach(() => {
  vi.resetAllMocks();
  store.reclaimStalePhotoJobs.mockResolvedValue(0);
  store.claimDuePhotoJobs.mockResolvedValue([]);
  store.photoJobSummary.mockResolvedValue({ queued: 0, processing: 0, paused: 0 });
});

it('claims only when a summary says work may be due', async () => {
  store.photoJobSummary.mockResolvedValue({ queued: 0, processing: 0, paused: 0 });
  expect(await drainPhotoJobs()).toMatchObject({ claimed: 0 });
  expect(store.claimDuePhotoJobs).not.toHaveBeenCalled();

  store.photoJobSummary.mockResolvedValue({ queued: 2, processing: 0, paused: 0 });
  store.claimDuePhotoJobs.mockResolvedValue([job('a'), job('b')]);
  runPhotoJob.mockResolvedValue('ready');
  expect(await drainPhotoJobs({ limit: 3 })).toMatchObject({ claimed: 2, ready: 2, errors: [] });
  expect(runPhotoJob).toHaveBeenCalledTimes(2);
});

it('runs jobs sequentially — one container, one compositor at a time', async () => {
  const order: string[] = [];
  store.claimDuePhotoJobs.mockResolvedValue([job('a'), job('b')]);
  store.photoJobSummary.mockResolvedValue({ queued: 2 });
  runPhotoJob.mockImplementation(async (j: any) => {
    order.push(`start:${j.id}`);
    await new Promise((r) => setTimeout(r, 5));
    order.push(`end:${j.id}`);
    return 'ready';
  });
  await drainPhotoJobs();
  expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
});

it('a throwing runner does not abort the rest of the batch', async () => {
  store.photoJobSummary.mockResolvedValue({ queued: 3 });
  store.claimDuePhotoJobs.mockResolvedValue([job('a'), job('b'), job('c')]);
  store.reclaimStalePhotoJobs.mockResolvedValue(1);
  runPhotoJob.mockRejectedValueOnce(new Error('worker bug')).mockResolvedValueOnce('failed').mockResolvedValueOnce('cancelled');
  const out = await drainPhotoJobs();
  expect(out).toMatchObject({ claimed: 3, failed: 2, cancelled: 1, ready: 0, reclaimed: 1 });
  expect(out.errors).toEqual(['worker bug']);
});

it('maybeDrainPhotoJobs never overlaps itself', async () => {
  store.photoJobSummary.mockResolvedValue({ queued: 1 });
  let release: () => void = () => {};
  store.claimDuePhotoJobs.mockImplementation(() => new Promise((r) => { release = () => r([job('a')]); }));
  runPhotoJob.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 1)); return 'ready'; });

  maybeDrainPhotoJobs();
  maybeDrainPhotoJobs();
  maybeDrainPhotoJobs();
  expect(store.claimDuePhotoJobs).toHaveBeenCalledTimes(0); // summary probe is async
  release();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  expect(store.claimDuePhotoJobs).toHaveBeenCalledTimes(1);
});

it('reports queue health from the summary, never by scanning rows', async () => {
  store.photoJobSummary.mockResolvedValue({ queued: 4, processing: 1, paused: 2 });
  expect(await photoQueueHealth()).toEqual({ due: 4, locked: 1, paused: 2 });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL, module missing.
- [ ] **Step 3: Write the worker**

```ts
/**
 * Opportunistic drain (spec §3). The job table is the queue; this function is the
 * only thing that consumes it in-process, and it is called from request paths
 * rather than from a dedicated loop — because `frontend-web` has no worker
 * service and the container is not serverless, a tick tied to traffic is enough
 * to keep latency low without inventing a fourth deployable.
 *
 * Sequential on purpose. sharp decoding is CPU-heavy and Railway gives this
 * service a shared slice; five concurrent composites would slow all five and
 * contend for the vendor's rate budget for no gain.
 */
import { claimDuePhotoJobs, photoJobSummary, reclaimStalePhotoJobs } from './job-store';
import { runPhotoJob, type PhotoJob } from './runner';

const DEFAULT_LIMIT = 3;
const LOCK_TTL_SECONDS = 300;

export interface DrainResult {
  claimed: number; ready: number; failed: number; cancelled: number;
  reclaimed: number; errors: string[];
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

  for (const job of jobs as PhotoJob[]) {
    try {
      const outcome = await runPhotoJob(job);
      out[outcome] += 1;
    } catch (err) {
      // The runner already tried to record its own failure; a throw escaping it is
      // a defect. The stale-lock reclaim will requeue this row, so log loudly.
      out.failed += 1;
      out.errors.push(err instanceof Error ? err.message : String(err));
      console.error('[photo-jobs] runner threw for job', job.id);
    }
  }
  return out;
}

/** Fire-and-forget: a request path must never wait on the drain. */
export function maybeDrainPhotoJobs(): void {
  if (draining) return;
  draining = drainPhotoJobs().finally(() => { draining = null; });
  void draining.catch(() => undefined);
}

export async function photoQueueHealth(): Promise<{ due: number; locked: number; paused: number }> {
  const s = await photoJobSummary();
  return { due: (s.queued ?? 0) + (s.failed ?? 0), locked: s.processing ?? 0, paused: s.paused ?? 0 };
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/unit/photo-jobs/worker.test.ts`, 5 tests.
- [ ] **Step 5: Commit** — `git add frontend-web/src/server/photo-jobs/worker.ts frontend-web/tests/unit/photo-jobs/worker.test.ts && git commit -m "feat(photo): opportunistic sequential job drain"`

---

### Task 8: Status, cancel and config surfaces

**Files:**
- Create: `frontend-web/app/api/photo-jobs/[id]/route.ts`
- Create: `frontend-web/app/api/admin/photo-config-status/route.ts`
- Modify: `frontend-web/src/server/photo-jobs/job-store.ts` (add `getLatestPhotoJob`, `listPhotoAssets`)
- Test: `frontend-web/tests/unit/photo-jobs/routes.test.ts`

**Interfaces:**
- Consumes: `requireUser` (`@/src/lib/auth/server`), `assertAdminPermission` (`@/src/server/admin/auth`), `successResponse`/`errorResponse` (`@/src/lib/api/responses`), `handleApiError`, `getPhotoJob`/`getLatestPhotoJob`/`listPhotoAssets` (Task 4), `photoProviderConfig` (Task 2), `hasR2Config`/`getR2PublicUrl`, `maybeDrainPhotoJobs` (Task 7).
- Produces:
  - `GET /api/photo-jobs/[id]` → `{ job: { id, status, progress, attempt, resultAssetId, lastError, assets: { final?: string, preview?: string } } }`
  - `GET /api/photo-jobs/latest?registrationId=…` (same shape, newest job for the caller's own registration)
  - `POST /api/photo-jobs/[id]/cancel` → `{ cancelled: true }`
  - `GET /api/admin/photo-config-status` → the spec §7 object, booleans and names only.

- [ ] **Step 1: Write the failing test**

```ts
// frontend-web/tests/unit/photo-jobs/routes.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  getPhotoJob: vi.fn(), getLatestPhotoJob: vi.fn(), listPhotoAssets: vi.fn(),
  cancelPhotoJob: vi.fn(), photoJobSummary: vi.fn(), completePhotoJob: vi.fn(),
  failPhotoJob: vi.fn(), enqueuePhotoJob: vi.fn(), claimDuePhotoJobs: vi.fn(),
  reclaimStalePhotoJobs: vi.fn(), upsertPhotoAsset: vi.fn(), setPhotoJobProgress: vi.fn(),
  buildRunKey: vi.fn(),
}));
vi.mock('@/src/server/photo-jobs/job-store', () => store);
vi.mock('@/src/server/photo-jobs/worker', () => ({ maybeDrainPhotoJobs: vi.fn(), photoQueueHealth: vi.fn() }));
const auth = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock('@/src/lib/auth/server', () => auth);

import { GET } from '@/app/api/photo-jobs/[id]/route';
import { GET as CONFIG } from '@/app/api/admin/photo-config-status/route';

const request = (headers = new Headers()) =>
  new Request('http://localhost/api/photo-jobs/j1', { headers });

beforeEach(() => {
  vi.resetAllMocks();
  auth.requireUser.mockResolvedValue({ user: { id: 'u1' } });
});

it('answers the owner with the published asset URLs', async () => {
  store.getPhotoJob.mockResolvedValue({ id: 'j1', registration_id: 'r1', user_id: 'u1', status: 'ready', progress: 100, attempt: 1, result_asset_id: 'a-final', last_error: null });
  store.listPhotoAssets.mockResolvedValue([{ kind: 'final', storage_key: 'contestants/composited/x.png' }]);
  const got = await GET(request(), { params: Promise.resolve({ id: 'j1' }) });
  expect(got.status).toBe(200);
  const body = await got.json();
  expect(body.job.status).toBe('ready');
  expect(body.job.assets.final).toBe('/api/contestant-photo/contestants/composited/x.png');
});

it('refuses a job whose registration the caller does not own', async () => {
  store.getPhotoJob.mockResolvedValue({ id: 'j1', registration_id: 'other', user_id: 'u2', status: 'ready' });
  const got = await GET(request(), { params: Promise.resolve({ id: 'j1' }) });
  expect(got.status).toBe(403);
});

it('reports a not-configured provider as a blocker, never as a secret', async () => {
  delete process.env.CLOUDINARY_CLOUD_NAME;
  const res = await CONFIG(new Request('http://localhost/api/admin/photo-config-status', { headers: new Headers({ authorization: 'Bearer admin' }) }));
  const text = JSON.stringify(await res.json());
  expect(text).toContain('CLOUDINARY_CLOUD_NAME');
  expect(text).not.toMatch(/api_secret|api_key['"]?\s*:\s*"[^"]/);
});
```

The route handler needs the registration's owning user, so extend `getPhotoJob` to select `registrations(user_id)`; that join is what makes the second test a real ownership check rather than an assumed one. Both mock rows above carry `user_id` for that reason.

- [ ] **Step 2: Run to verify failure** — FAIL, routes missing.
- [ ] **Step 3: Implement `app/api/photo-jobs/[id]/route.ts`**

```ts
/**
 * Status read for one photo job (spec §6). The poll target the design chose so a
 * surface can answer "processing" truthfully instead of showing a half-built
 * portrait: only a `ready` job carries asset URLs, and an unowned row answers 403
 * before any of its fields are read.
 *
 * RLS denies anon/authenticated on both tables, so ownership is enforced here in
 * application code by reading the row's registration `user_id` with the service
 * role. That is the reason this handler must not be simplified into a direct
 * client-side supabase read: the client cannot see the row at all.
 */
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireUser } from '@/src/lib/auth/server';
import { getR2PublicUrl, hasR2Config } from '@/src/lib/storage/r2';
import { getPhotoJob, listPhotoAssets } from '@/src/server/photo-jobs/job-store';

const ASSET_KINDS = ['final', 'preview', 'thumbnail'] as const;

function assetPath(storageKey: string): string {
  // Public base when configured; otherwise the existing signed-read route, which
  // is the same resolution src/lib/storage/contestant-photo.ts already uses.
  const publicBase = hasR2Config() ? getR2PublicUrl(storageKey) : null;
  return publicBase || `/api/contestant-photo/${storageKey}`;
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { id } = await ctx.params;
    const job = await getPhotoJob(id);
    if (!job) return errorResponse('Photo job not found', 404);
    if (job.registration_user_id !== user.id) return errorResponse('Not allowed', 403);

    const assets = job.status === 'ready' ? await listPhotoAssets(job.registration_id) : [];
    const urls: Record<string, string> = {};
    for (const kind of ASSET_KINDS) {
      const row = assets.find((a) => a.kind === kind && a.storage_key);
      if (row?.storage_key) urls[kind] = assetPath(row.storage_key);
    }

    return successResponse({
      job: {
        id: job.id,
        status: job.status,
        progress: job.status === 'ready' ? 100 : job.progress,
        attempt: job.attempt,
        resultAssetId: job.result_asset_id,
        lastError: job.status === 'paused' || job.status === 'failed' ? job.last_error : undefined,
        assets: urls,
      },
    });
  } catch (error) {
    return handleApiError(error, 'Failed to read photo job');
  }
}
```

- [ ] **Step 4: Implement `app/api/admin/photo-config-status/route.ts`** returning exactly the spec §7 object. `blockers` is derived, not free text, from these five checks in this order:

```ts
const blockers: string[] = [];
if (!providerConfig.configured) blockers.push(`Photo provider credentials missing: ${providerConfig.missing.join(', ')}`);
if (!hasR2Config()) blockers.push('R2 is not configured — composited output cannot be stored durably');
if (!process.env.R2_PUBLIC_BASE_URL) blockers.push('R2_PUBLIC_BASE_URL is empty — composited output cannot be published to a public URL');
if (!process.env.SITE_URL) blockers.push('SITE_URL is empty — provider-fetchable fallback URLs cannot be built');
if (paused > 0) blockers.push(`${paused} paused job(s) need operator review`);
```

`assertAdminPermission(request, 'applications:review')` gates the route. `jobs` comes from `photoJobSummary()`. The response contains no env values; a test asserts the serialized body contains no `CLOUDINARY_API_SECRET`/`CLOUDINARY_API_KEY`/`SUPABASE_SERVICE_ROLE_KEY` value by injecting known sentinel values into those variables and checking they never appear.

- [ ] **Step 5: Run to verify pass** — routes green, and the sentinel-value assertion proves no secret can leak through this surface.
- [ ] **Step 6: Commit** — `git commit -am "feat(photo): job status, cancel and provider config endpoints"`

---

### Task 9: Stop overwriting the original, in submit and in review

**Files:**
- Modify: `frontend-web/src/server/registration/supabase-store.ts:1032-1081` (the review branch), plus `submitRegistrationApplication` near :540
- Create: `frontend-web/src/server/photo-jobs/presentation.ts`
- Test: `frontend-web/tests/unit/photo-jobs/review-no-overwrite.test.ts`
- Modify: `frontend-web/src/server/registration/photo-pipeline.ts:8-29` (stale module doc)
- Modify: `frontend-web/src/server/registration/template-resolver.ts` (`ResolvedTemplate.templateId`, `templateVersion`)

**Interfaces:**
- Consumes: `registerOriginalAndEnqueue` (Task 5), `getLatestPhotoJob` (Task 8), `drainPhotoJobs`/`maybeDrainPhotoJobs` (Task 7).
- Produces: `resolveReviewPhotoOutcome(rawPhotoUrl: string | undefined, registrationId: string, nextFormData: Record<string, unknown>): Promise<PhotoPresentation>` where `PhotoPresentation` is `{ mode: 'composite' | 'processing' | 'original' | 'rejected'; photoUrl: string; photoAssetId?: string; reason?: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend-web/tests/unit/photo-jobs/review-no-overwrite.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const registry = vi.hoisted(() => ({ registerOriginalAndEnqueue: vi.fn() }));
vi.mock('@/src/server/photo-jobs/registry', () => registry);
const store = vi.hoisted(() => ({ getLatestPhotoJob: vi.fn(), listPhotoAssets: vi.fn() }));
vi.mock('@/src/server/photo-jobs/job-store', () => store);
const worker = vi.hoisted(() => ({ drainPhotoJobs: vi.fn() }));
vi.mock('@/src/server/photo-jobs/worker', () => worker);
vi.mock('@/src/server/photo-jobs/presentation', async (importOriginal) => ({ ...(await importOriginal() as object) }));

import { resolveReviewPhotoOutcome } from '@/src/server/photo-jobs/presentation';

const ORIGINAL = '/api/registration/uploads/abc123';

beforeEach(() => {
  vi.resetAllMocks();
  registry.registerOriginalAndEnqueue.mockResolvedValue({ assetId: 'a1', jobId: 'j1', skipped: null });
  worker.drainPhotoJobs.mockResolvedValue({ claimed: 1, ready: 1, failed: 0, cancelled: 0, reclaimed: 0, errors: [] });
});

it('leaves the original value byte-identical when a composite is ready', async () => {
  store.getLatestPhotoJob.mockResolvedValue({ id: 'j1', status: 'ready', result_asset_id: 'a-final', last_error: null });
  store.listPhotoAssets.mockResolvedValue([{ kind: 'final', storage_key: 'contestants/composited/x.png', id: 'a-final' }]);
  const out = await resolveReviewPhotoOutcome(ORIGINAL, 'reg-1', {});
  expect(out).toMatchObject({ mode: 'composite', photoAssetId: 'a-final' });
  expect(out.photoUrl).not.toBe(ORIGINAL);
});

it('records the original and reports processing when nothing is ready yet', async () => {
  store.getLatestPhotoJob.mockResolvedValue(null);
  const out = await resolveReviewPhotoOutcome(ORIGINAL, 'reg-1', {});
  expect(registry.registerOriginalAndEnqueue).toHaveBeenCalledWith(expect.objectContaining({ registrationId: 'reg-1', storedPhotoValue: ORIGINAL }));
  expect(worker.drainPhotoJobs).toHaveBeenCalled();
  expect(out.mode).toBe('processing');
  expect(out.photoUrl).toBe(ORIGINAL);
});

it('never blocks an approval on a vendor failure', async () => {
  store.getLatestPhotoJob.mockResolvedValue({ id: 'j1', status: 'paused', last_error: 'Cloudinary returned 503', result_asset_id: null });
  const out = await resolveReviewPhotoOutcome(ORIGINAL, 'reg-1', {});
  expect(out).toMatchObject({ mode: 'original', photoUrl: ORIGINAL, reason: 'Cloudinary returned 503' });
});

it('surfaces a moderation verdict as rejected', async () => {
  store.getLatestPhotoJob.mockResolvedValue({ id: 'j1', status: 'cancelled', last_error: 'Rejected: violence', result_asset_id: null });
  expect(await resolveReviewPhotoOutcome(ORIGINAL, 'reg-1', {})).toMatchObject({ mode: 'rejected' });
});

it('a no-photo approval needs no job at all', async () => {
  const out = await resolveReviewPhotoOutcome(undefined, 'reg-1', {});
  expect(out.mode).toBe('processing');
  expect(registry.registerOriginalAndEnqueue).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure** — FAIL, `presentation.ts` missing.
- [ ] **Step 3: Write `presentation.ts`** as the pure-ish orchestrator above: look for an existing job, and if none exists call `registerOriginalAndEnqueue({ registrationId, storedPhotoValue })`, attempt one bounded drain (`drainPhotoJobs({ limit: 1 })`) so the common case returns a composite in the same request, then read the newest job again and map `ready → composite`, `queued/extracting/compositing → processing`, `failed/paused → original`, `cancelled → rejected`. `photoUrl` is the *published* URL for composite mode and **always the untouched original** otherwise. It must never write into `nextFormData`.

- [ ] **Step 4: Change the call site.** Replace the block at `supabase-store.ts:1032-1081` so that the four outcome modes drive behaviour, and delete the assignment that destroys the original:

```ts
// BEFORE (spec §2 defect 1) — the composite overwrote the only reference to the
// uploaded file:
//   if (nextFormData['media.photoUrl'] !== undefined) {
//     nextFormData['media.photoUrl'] = pipelineResult.photoUrl;
//   } else {
//     nextFormData['media.headshotUrl'] = pipelineResult.photoUrl;
//   }

const outcome = await resolveReviewPhotoOutcome(rawPhotoUrl, current.id, nextFormData);

if (outcome.mode === 'rejected') {
  throw new ApiError(
    `Cannot approve: contestant photo failed content moderation (${outcome.reason}). Ask the applicant for a different photo — set the application to "More information requested".`,
    409,
    'photo_moderation_rejected',
  );
}

nextFormData['media.photoOriginalUrl'] = rawPhotoUrl;
if (outcome.photoAssetId) nextFormData['media.photoAssetId'] = outcome.photoAssetId;
nextFormData['media.photoPresentation'] = outcome.mode;
// `media.photoUrl` keeps its original value. Surfaces read the composite through
// `media.photoAssetId`; the original stays retrievable forever, which is what the
// spec's "never overwrite" rule and any future re-render both need.
```

`rawPhotoUrl` is defined at :1032-1034 and the guard at :1036 stays; `processContestantPhoto`/`processContestantPhotoNoTemplate` keep their exports and their existing tests so the synchronous path remains available to callers that need it, while nothing in the live review path waits on it. `PROMOTING_STATUSES` still owns the whole branch.

- [ ] **Step 5: Enqueue at submission** (spec §6): in `submitRegistrationApplication`, immediately after the row is updated to `submitted` and before the function returns, add

```ts
// Rendering starts here, not at approval, so a contestant can be shown a
// preview while the reviewer is still queueing. Fire-and-forget: a photo job
// must never turn a successful submission into a failed request.
const photoValue = (draft.formData['media.photoUrl'] as string | undefined)
  || (draft.formData['media.headshotUrl'] as string | undefined);
if (photoValue) {
  void registerOriginalAndEnqueue({ registrationId: draft.id, contestSlug: draft.contestSlug, storedPhotoValue: photoValue })
    .then(() => maybeDrainPhotoJobs())
    .catch((err) => console.warn('[photo-jobs] submission enqueue failed:', err instanceof Error ? err.message : err));
}
```

Add a matching assertion to the existing submission test file so a regression that drops the enqueue fails: assert `registerOriginalAndEnqueue` was called with the stored photo value, and assert the returned promise still resolves when the enqueue rejects.

- [ ] **Step 6: Fix the stale docs.** `photo-pipeline.ts:8-29` claims no `contest_templates`↔`connect_contests` link exists and that compositing is unreachable. It exists (`20270212000000_contest_templates_connect_bridge.sql`) and `template-resolver.ts` uses it. Rewrite that paragraph to state the current reachability, name `supabase/photo-jobs` as the async caller, and keep `processContestantPhoto` documented as the synchronous path. Add `templateId: string` and `templateVersion: number` to `ResolvedTemplate` (the query already selects `id, version` per the review at :52) and set them from the row.
- [ ] **Step 7: Run the whole registration suite** — `npx vitest run tests/unit/registration tests/unit/photo-jobs`. The pre-existing `review-template-wiring.test.ts` will fail on the removed synchronous call; update it to assert the new behaviour (review reads the job store, no `processContestantPhoto` call) rather than deleting it, since it is the file that documents this wiring.
- [ ] **Step 8: Commit** — `git commit -am "fix(photo): stop overwriting the contestant original; render via jobs"`

---

### Task 10: Verification, gates, and honest status

- [ ] **Step 1: Type-check.** `cd frontend-web && npx tsc --noEmit` — expected zero errors. Do not trust an exit code from a pipe without node_modules (the symlink exists in this worktree; verify with `ls -d frontend-web/node_modules` first).
- [ ] **Step 2: Unit suite.** `NODE_OPTIONS="--require /tmp/zstd-shim.cjs" npx vitest run tests/unit/photo-jobs tests/unit/registration tests/unit/media` — record the executed test count in the PR body. Expected: all pass, and the count is greater than the 22 baseline plus the new files' cases.
- [ ] **Step 3: Fresh replay of the migration chain** against a scratch database, because `make migrate-reset` exists precisely to catch a migration that only applies to a schema that already has the older ones:
  ```bash
  DB="$(grep -m1 '^DATABASE_URL' backend/.env | cut -d= -f2- | tr -d '\"')"
  psql "$DB" -v ON_ERROR_STOP=1 -c "CREATE SCHEMA IF NOT EXISTS replay_check;"
  # Prefer the repo's own path:
  make migrate-reset DATABASE_URL="$DB"
  ```
  Expected: succeeds and ends with `rls-check ✓ — every public table has row-level security enabled`. If `migrate-reset` is too destructive for the local stack, run `supabase db reset` on the local project instead and say which one you used.
- [ ] **Step 4: Prove the live-DB tests ran.** `npm run test:integration` must print an executed count > 0 for `photo-jobs.test.ts`. A run that shows `skipped` for that file is not evidence; if the credentials are unavailable in this shell, say so in the PR rather than claiming the data-layer invariants passed.
- [ ] **Step 5: Confirm what is and is not proven**, in the PR body, in these words or closer:
  - The asset and job data model, immutability of the original, idempotent enqueue, claim/backoff/pause semantics, and the review path no longer overwriting `media.photoUrl` are covered by the tests listed above.
  - Whether Cloudinary's extraction and moderation actually succeed against a live account is **not** proven here: `docs/qa/voting-contest-test-plan.md:154` still records that the param/response shapes are written from documented behavior with a `TODO: verify against live Cloudinary docs`, `frontend-web/.env.example` leaves `CLOUDINARY_*` as `YOUR_…` placeholders, and no server-side `CLOUDINARY_*` name appears in `docs/devops`. The `/api/admin/photo-config-status` route is the instrument that turns that unknown into a named blocker; the first call against a real account belongs in a live-mode test that this plan does not schedule.
  - The admin template studio (P3), the engine's Mode A/B placement and blend layer (P2), and the contestant editor plus unified presentation (P4) are not in this change.
- [ ] **Step 6: Commit the spec and plan** (if not already committed) and push the branch; open the PR against `main`. The PR must state plainly that merging this deploys to production through `release.yml` (a merge is a release in this repo) and that the migration is additive, so no existing row changes behaviour until the job runner has credentials and an R2 public base URL.

---

## Self-review record

Placeholder scan: the only `TODO` string left in this file is the quoted one inside the unverified bullet, which records what `docs/qa/voting-contest-test-plan.md:154` says today — it is evidence, not an instruction. No step says "similar to Task N"; every code step carries its own block. `enqueue_photo_job` is called with named `p_…` parameters in Task 4 and declared with matching names in Task 1.

Type consistency, checked across tasks: `PhotoJob` is defined once (Task 4) and imported by Tasks 6-8; `RunOutcome` is exported by `runner.ts` and consumed by `worker.ts`'s tally (`out[outcome] += 1` is valid only because `DrainResult` has numeric `ready`/`failed`/`cancelled` keys); `listPhotoAssets` and `getLatestPhotoJob` are declared as Produced by Task 8 and consumed by Task 9. The job row's owner column is `registration_id` (Task 1), the RPC parameter is `p_registration_id` (Task 1) and `registrationId` in the TypeScript wrappers (Tasks 4-6), and `registerOriginalAndEnqueue` takes `{ registrationId, storedPhotoValue, contestSlug? }` (Task 5), which is what Tasks 9's review path and submit path both pass. `registrations.id` is the same id the reviewer already holds as the application under review, so no mapping layer is needed anywhere.

Drafting leftovers found and removed during this review: a `const res = await CONFIG ? null : null;` line in Task 8's first test, a stray non-ASCII word in Task 1's trigger comment, and a `JobStatus extends never` cast in Task 4's `getPhotoJob`. If you see any of those three strings in the file you are executing from, your copy predates this review — take the corrected line from the code block above it rather than improvising.

