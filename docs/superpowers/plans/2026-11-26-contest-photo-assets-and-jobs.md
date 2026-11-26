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
--
-- The code is spelled as the condition NAME on purpose. plpgsql parses
-- USING ERRCODE = 'x' as a condition name unless the string is uppercase hex,
-- so a lowercase '2f003' would fail at raise time with 42704
-- "unrecognized exception condition" -- measured, not assumed. 42501 is what a
-- row-level-security denial raises here, so a guard refusal and a policy
-- refusal land in the same class for the caller.
create or replace function public.reject_contest_photo_asset_mutation() returns trigger
language plpgsql as $$
begin
  if old.kind = 'original' then
    raise exception 'contest_photo_assets % kind=original is immutable', old.id
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'contest_photo_assets rows are insert-only (id %)', old.id
      using errcode = 'insufficient_privilege';
  end if;
  return old;
end;
$$;

-- drop-first so re-applying this file against a development database during the
-- build is a no-op rather than an error; a fresh replay never has the trigger.
drop trigger if exists contest_photo_assets_immutable on public.contest_photo_assets;
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
  p_source_asset_id uuid default null,
  p_render_params jsonb default '{}'::jsonb
) returns jsonb
language plpgsql as $$
declare v_job public.contest_photo_jobs%ROWTYPE;
begin
  -- p_source_asset_id carries no DEFAULT only because Postgres forbids a
  -- non-defaulted parameter after a defaulted one; the value is still required.
  if p_source_asset_id is null then
    raise exception 'enqueue_photo_job requires p_source_asset_id'
      using errcode = '22023';
  end if;

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

exception when unique_violation then
  -- Two callers with the same run_key can both pass the SELECT ... FOR UPDATE
  -- above while no row exists yet to lock, so the insert is the real arbiter.
  -- The loser reports the winner's job instead of faulting the submit endpoint:
  -- idempotency has to survive concurrency, not just a retry.
  select * into v_job from public.contest_photo_jobs where run_key = p_run_key;
  return jsonb_build_object('job_id', v_job.id, 'status', v_job.status, 'already_existed', true);
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
declare v public.contest_photo_jobs%ROWTYPE; v_next text;
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

-- Privileges, following the estate-ledger house style (20271099000080:466-486).
--
-- `revoke ... from public` alone is NOT enough here and was checked rather than
-- assumed: this schema carries ALTER DEFAULT PRIVILEGES that hand EXECUTE to
-- anon, authenticated and service_role for every function postgres creates, so
-- the pseudo-role PUBLIC is only one of four entries in the ACL. The two web
-- roles stay revoked and only service_role is handed execute back -- otherwise
-- any logged-in contestant could claim a job out from under the worker or mint
-- an asset row pointing at their own bytes.
revoke all on function public.claim_due_photo_jobs(text, integer) from public, anon, authenticated;
revoke all on function public.enqueue_photo_job(text, uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fail_photo_job(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_photo_job(uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_photo_job_progress(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.cancel_photo_job(uuid, text) from public, anon, authenticated;
revoke all on function public.reclaim_stale_photo_jobs(integer) from public, anon, authenticated;
revoke all on function public.upsert_contest_photo_asset(uuid, text, text, text, text, integer, integer, bigint, uuid, integer, jsonb, uuid) from public, anon, authenticated;
-- The guard is a trigger body; it must never be callable by hand at all.
revoke all on function public.reject_contest_photo_asset_mutation() from public, anon, authenticated, service_role;

grant execute on function public.claim_due_photo_jobs(text, integer) to service_role;
grant execute on function public.enqueue_photo_job(text, uuid, uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.fail_photo_job(uuid, text) to service_role;
grant execute on function public.complete_photo_job(uuid, uuid) to service_role;
grant execute on function public.set_photo_job_progress(uuid, text, integer) to service_role;
grant execute on function public.cancel_photo_job(uuid, text) to service_role;
grant execute on function public.reclaim_stale_photo_jobs(integer) to service_role;
grant execute on function public.upsert_contest_photo_asset(uuid, text, text, text, text, integer, integer, bigint, uuid, integer, jsonb, uuid) to service_role;
-- Queue health is read by the admin config surface THROUGH the BFF, which
-- arrives as the service role, so service_role is the only executor. Revoked
-- from PUBLIC as well as anon and authenticated: leaving the `=X/postgres` entry
-- in the ACL silently re-grants every web role, which is exactly how the other
-- eight functions were already covered and this one was not.
revoke all on function public.photo_job_config_summary() from public, anon, authenticated;
grant execute on function public.photo_job_config_summary() to service_role;
```

Corrections applied while executing this task, now reflected in the block above (the plan's first draft would not have loaded): `p_source_asset_id` needed a `default null` because Postgres rejects a non-defaulted parameter after a defaulted one, with an explicit guard keeping it required; the trigger's `errcode` had to be spelled as the condition name (a lowercase `'2f003'` raises 42704 at raise time, and `SQLSTATE '2F003'` is not accepted in `USING`); `fail_photo_job`'s unused `declare v_delay seconds` was a type that does not exist; the trigger is dropped before creation so a development re-apply is a no-op; the enqueue gained a `unique_violation` handler because `SELECT ... FOR UPDATE` cannot lock a row that does not exist yet; and the privilege block was rewritten after measuring that the schema's default privileges leave `from public` revokes ineffective for `anon`/`authenticated`. Two more corrections came out of the first executed run of the spec above: `photo_job_config_summary` lost its `authenticated` grant — the live case proved that grant had no caller, since the only client it named was refused the function while the admin surface reaches it as `service_role` through the BFF, and leaving it in would have let any logged-in contestant read other contests' queue depth — and the Step 4 recipe was rewritten because the delivered file's credentials are in the main checkout, not the worktree, and the local API will not answer at all until the schema cache finishes loading.

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
    // Deleting the owning application is the retention path the guard allows:
    // assets and jobs leave with it, and nothing here is left behind.
    await db().from('registrations').delete().eq('id', registrationId);
    const { data: jobs } = await db().from('contest_photo_jobs').select('id').eq('registration_id', registrationId);
    expect(jobs ?? [], 'job fixture must not leak').toHaveLength(0);
    const { data: assets } = await db().from('contest_photo_assets').select('id').eq('registration_id', registrationId);
    expect(assets ?? [], 'asset fixture must not leak').toHaveLength(0);
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
```

- [ ] **Step 4: Run it and make sure it passes**

The file self-skips without credentials, so the run must be cited with an executed
count. Two prerequisites are measured, not assumed:

1. the credentials live in the MAIN checkout's `frontend-web/.env.local` (a worktree
   never has that gitignored file), and
2. the local PostgREST must have loaded its schema cache. On a loaded machine the
   introspection query blows past the `authenticator` role's default 8s
   `statement_timeout`, and every request then answers 503 `PGRST002` — a dev-stack
   setting, not something a migration can change.

Run:
```bash
DB="$(grep -m1 '^DATABASE_URL' ../../../backend/.env | cut -d= -f2- | tr -d '"')"
psql "$DB" -tAc "select setconfig from pg_db_role_setting s join pg_roles r on r.oid=s.setrole where r.rolname='authenticator';"
# if it shows statement_timeout=8s and the API answers PGRST002:
#   psql "$DB" -c "ALTER ROLE authenticator SET statement_timeout='60s';" -c "NOTIFY pgrst, 'reload schema';"
# anon (3s) and authenticated (8s) are separate roles and stay as they are.
set -a; source /Users/paymax/Documents/spotlight/main/frontend-web/.env.local; set +a
NODE_OPTIONS="--require /tmp/zstd-shim.cjs" npx vitest run --config vitest.integration.config.ts tests/integration/photo-jobs.test.ts 2>&1 | tail -20
```
Expected: `Test Files 1 passed`, `Tests 12 passed (12)`. A run that shows `12 skipped`
means the skip branch fired — fix the credentials or the schema cache before citing it.

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
/**
 * @file tests/unit/media/provider.test.ts
 *
 * The seam between the photo job runner and whatever vendor is configured
 * (spec §5, §10). Two promises are under test here, and both are the kind a
 * reviewer cannot see by reading `cloudinary.ts`:
 *
 *   1. a configuration surface reports the NAMES of missing variables and never
 *      their values — this object is what an admin screen and the job ledger
 *      will render, so one echoed secret would put a vendor API secret in front
 *      of every operator with access to /admin; and
 *   2. when creds are absent the seam answers with a result, it does not reach
 *      the network. The runner keeps its own fail-closed rule, and that rule
 *      only holds if "not configured" is distinguishable from "vendor said no".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Only the two network calls are faked. The env helpers stay real, because the
// whole point of the seam is that readiness is decided by the same list
// `cloudinary.ts` reads — mocking that away would let a drifted duplicate of
// the contract pass this file.
vi.mock('@/src/lib/media/cloudinary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/media/cloudinary')>();
  return {
    ...actual,
    moderatePhoto: vi.fn(async () => ({ approved: true })),
    removeBackground: vi.fn(async () => ({ ok: true, resultUrl: 'https://cdn/x.png' })),
  };
});

import { getPhotoProvider, photoProviderConfig } from '@/src/lib/media/provider';
import { moderatePhoto, removeBackground } from '@/src/lib/media/cloudinary';

describe('photo provider seam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
  });

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
    expect(provider.configured).toBe(true);
    await expect(provider.extractBackground('https://example.test/a.jpg')).resolves.toEqual({
      ok: true,
      resultUrl: 'https://cdn/x.png',
    });
    expect(removeBackground).toHaveBeenCalledWith('https://example.test/a.jpg');
    await expect(provider.moderate('https://example.test/a.jpg')).resolves.toEqual({ approved: true });
    expect(moderatePhoto).toHaveBeenCalledTimes(1);
  });

  it('answers notConfigured without calling the vendor when creds are absent', async () => {
    const provider = getPhotoProvider();
    expect(provider.name).toBe('none');
    await expect(provider.extractBackground('https://example.test/a.jpg')).resolves.toMatchObject({
      ok: false,
      notConfigured: true,
    });
    expect(removeBackground).not.toHaveBeenCalled();
  });

  // Moderation is the fail-closed gate (IMG-001 / SEC-010). An unconfigured
  // vendor must never read as "approved" to the runner, or a missing secret
  // would silently publish unmoderated contestant photos.
  it('fails moderation closed when unconfigured', async () => {
    const provider = getPhotoProvider();
    await expect(provider.moderate('https://example.test/a.jpg')).resolves.toMatchObject({
      approved: false,
      notConfigured: true,
    });
    expect(moderatePhoto).not.toHaveBeenCalled();
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
 * Provider seam for contestant-photo rendering (spec §5, §10).
 *
 * One place decides *whether* a vendor can be used; `cloudinary.ts` stays the
 * only place Cloudinary HTTP lives. The job runner talks to this interface, so
 * P2's blend presets and a possible second vendor become parameters here rather
 * than a new call site scattered through the pipeline.
 *
 * Readiness is delegated to the client's own env contract
 * (`missingCloudinaryEnv`) instead of a second copy of the variable list: a
 * drifted duplicate would let the admin config surface claim "configured" while
 * every vendor call failed closed.
 *
 * `photoProviderConfig()` deliberately returns variable NAMES and booleans. This
 * is what an admin screen and the job ledger render, so echoing a value would
 * put a vendor secret in front of every operator with access to /admin.
 *
 * Nothing here is memoised. Env is fixed at process start in this deployment, so
 * a cache buys nothing, and the config surface has to answer for the process as
 * it stands — including in the tests that flip these variables per case.
 */
import {
  configured as cloudinaryConfigured,
  missingCloudinaryEnv,
  moderatePhoto,
  removeBackground,
  type BackgroundRemovalResult,
  type ModerationResult,
} from './cloudinary';

export type PhotoProviderName = 'cloudinary' | 'none';

/** The extract shape is the client's, aliased rather than redefined so the
 * runner and the vendor can never disagree about what `ok: false` carries. */
export type ExtractResult = BackgroundRemovalResult;

export interface PhotoProvider {
  name: PhotoProviderName;
  configured: boolean;
  missing: string[];
  extractBackground(sourceUrl: string): Promise<ExtractResult>;
  moderate(sourceUrl: string): Promise<ModerationResult>;
}

export function photoProviderConfig(): {
  configured: boolean;
  name: PhotoProviderName;
  missing: string[];
} {
  // `configured` comes from the client, and `missing` from the same list it
  // checks; deriving one from the other here would be a second policy.
  const configured = cloudinaryConfigured();
  return { configured, name: configured ? 'cloudinary' : 'none', missing: missingCloudinaryEnv() };
}

export function getPhotoProvider(): PhotoProvider {
  const { configured, name, missing } = photoProviderConfig();

  if (!configured) {
    const reason = `Cloudinary is not configured (missing ${missing.join(', ')})`;
    return {
      name: 'none',
      configured: false,
      missing,
      // Both branches return a result rather than throwing: the runner's
      // fail-closed rule needs to tell "no vendor" apart from "vendor refused",
      // which is what `notConfigured` is for.
      async extractBackground(): Promise<ExtractResult> {
        return { ok: false, notConfigured: true, reason };
      },
      async moderate(): Promise<ModerationResult> {
        return { approved: false, notConfigured: true, reason };
      },
    };
  }

  return {
    name,
    configured,
    missing,
    extractBackground: (sourceUrl: string) => removeBackground(sourceUrl),
    moderate: (sourceUrl: string) => moderatePhoto(sourceUrl),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `NODE_OPTIONS="--require /tmp/zstd-shim.cjs" npx vitest run tests/unit/media/provider.test.ts tests/unit/media/cloudinary.test.ts`
Expected: PASS on both files (the existing 12 Cloudinary tests must stay green — this task changed nothing in that client's behaviour).

- [ ] **Step 5: Commit** — `git add frontend-web/src/lib/media/provider.ts frontend-web/tests/unit/media/provider.test.ts && git commit -m "refactor(photo): provider seam in front of the Cloudinary client"`

---

Two things this task did differently from the first draft of the steps above, both
because the draft would have been wrong rather than merely shorter: the seam must
NOT re-declare the required env variable names (it imports the client's
`CLOUDINARY_ENV_VARS` / `missingCloudinaryEnv()` / `configured()`, so the config
surface and the client can never disagree), and `ExtractResult` is an alias of the
client's `BackgroundRemovalResult` rather than a second shape. The test therefore
mocks Cloudinary with `importOriginal` -- faking only the two network functions and
leaving the env helpers real -- and it carries a fourth case proving an
unconfigured vendor fails *moderation* closed, not open.

---

### Task 3: Turn a stored value into a URL the vendor can fetch

**Files:**
- Create: `frontend-web/src/lib/media/asset-source.ts`
- Test: `frontend-web/tests/unit/media/asset-source.test.ts`

**Interfaces:**
- Consumes: `createR2DownloadUrl({ key, fileName, disposition, expiresIn })`, `hasR2Config()` from `@/src/lib/storage/r2`; base64url object keys as produced by `app/api/registration/uploads/route.ts:97` (`registration/<user id>/<uuid>.<ext>`).
- Produces: `type FetchableSource = { ok: true; url: string; objectKey: string | null; ttlSeconds: number } | { ok: false; reason: string; kind: 'relative' | 'notFetchable' | 'noProviderUrl' }`, `resolveFetchableSource(storedValue: string, opts?: { ttlSeconds?: number }): Promise<FetchableSource>`, `decodeUploadRouteKey(value: string): string | null`, `DEFAULT_PROVIDER_TTL_SECONDS = 600`.

This is the unit that fixes spec §2 defect 4: today `form_data['media.photoUrl']` holds the *relative* route `/api/registration/uploads/<base64url(key)>`, and Cloudinary's upload-by-fetch-URL cannot fetch a path.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @file tests/unit/media/asset-source.test.ts
 *
 * Spec §2 defect 4, pinned down. What is stored in `form_data['media.photoUrl']`
 * today is the *relative* in-app route `/api/registration/uploads/<base64url(key)>`
 * (app/api/registration/uploads/route.ts:97). Cloudinary's upload API is handed a
 * URL and downloads it itself, server-side, so a path is not a source: the call
 * cannot resolve it, the moderation result comes back as a refusal, and the
 * fail-closed pipeline publishes nothing while the job says "moderation rejected".
 *
 * This unit is the only place that turns a stored value into something a vendor
 * can fetch, so the two things it must never do are under test: hand back a
 * non-fetchable value as if it were usable, and mint a permanent public link to a
 * contestant's original photograph.
 */
import { describe, expect, it, vi } from 'vitest';

const r2 = vi.hoisted(() => ({ hasConfig: false, downloadUrl: vi.fn() }));
vi.mock('@/src/lib/storage/r2', () => ({
  hasR2Config: () => r2.hasConfig,
  createR2DownloadUrl: r2.downloadUrl,
}));

import { decodeUploadRouteKey, resolveFetchableSource } from '@/src/lib/media/asset-source';

// The shape the upload route really mints: registration/<user id>/<uuid>.<ext>.
const key = 'registration/user-1/8f14e45f-ea29-4b88-9f3c-0a1b2c3d4e5f.jpg';
const route = `/api/registration/uploads/${Buffer.from(key, 'utf8').toString('base64url')}`;

describe('decodeUploadRouteKey', () => {
  it('recognises the upload route and recovers the object key', () => {
    expect(decodeUploadRouteKey(route)).toBe(key);
    expect(decodeUploadRouteKey('https://other.test/x.jpg')).toBeNull();
  });

  it('refuses a base64url body that does not decode to an upload key', () => {
    // A payload that decodes to arbitrary text must not become a storage key:
    // this function's output is what gets presigned.
    const junk = `/api/registration/uploads/${Buffer.from('../../etc/passwd', 'utf8').toString('base64url')}`;
    expect(decodeUploadRouteKey(junk)).toBeNull();
    const notBase64url = '/api/registration/uploads/!!!not-base64!!!';
    expect(decodeUploadRouteKey(notBase64url)).toBeNull();
  });
});

describe('resolveFetchableSource', () => {
  it('presigns the key into an absolute https URL the vendor can fetch', async () => {
    r2.hasConfig = true;
    r2.downloadUrl.mockResolvedValue(`https://bucket.r2.dev/${key}?X-Amz-Signature=sig`);
    const out = await resolveFetchableSource(route);
    expect(out).toMatchObject({ ok: true, objectKey: key, ttlSeconds: 600 });
    if (out.ok) expect(out.url).toMatch(/^https:\/\/.+\.jpg\?/);
    expect(r2.downloadUrl).toHaveBeenCalledWith(
      expect.objectContaining({ key, disposition: 'inline', expiresIn: 600 }),
    );
  });

  // The original is never made public: what the vendor gets is a time-boxed
  // presigned read, and a caller asking for a shorter window must not be ignored.
  it('honours a shorter ttl and never returns a permanent link', async () => {
    r2.hasConfig = true;
    r2.downloadUrl.mockResolvedValue('https://bucket.r2.dev/x?sig=1');
    const out = await resolveFetchableSource(route, { ttlSeconds: 120 });
    expect(out.ok && out.ttlSeconds).toBe(120);
    expect(r2.downloadUrl).toHaveBeenLastCalledWith(expect.objectContaining({ expiresIn: 120 }));
  });

  it('reports a relative route as unusable when there is no R2 to presign', async () => {
    r2.hasConfig = false;
    const out = await resolveFetchableSource(route);
    expect(out).toMatchObject({ ok: false, kind: 'notFetchable' });
    if (!out.ok) expect(out.reason).toMatch(/presign/i);
  });

  it('passes an already-absolute public url through untouched', async () => {
    const out = await resolveFetchableSource('https://pub-xyz.r2.dev/contestants/images/a.png');
    expect(out).toMatchObject({ ok: true, url: 'https://pub-xyz.r2.dev/contestants/images/a.png' });
    expect(r2.downloadUrl).not.toHaveBeenCalled();
  });

  // Mobile and old rows store the same route as an absolute URL. It is the same
  // object, so it must resolve the same way rather than being fetched (it is
  // owner-gated, so a vendor fetch of it would 401).
  it('presigns our own upload route when it arrives absolute', async () => {
    r2.hasConfig = true;
    r2.downloadUrl.mockResolvedValue('https://bucket.r2.dev/signed?sig=1');
    const out = await resolveFetchableSource(`https://www.spotlightng.com${route}`);
    expect(out).toMatchObject({ ok: true, objectKey: key });
    expect(r2.downloadUrl).toHaveBeenLastCalledWith(expect.objectContaining({ key }));
  });

  it('refuses a non-https or host-less value rather than handing it to the vendor', async () => {
    expect(await resolveFetchableSource('file:///tmp/x.jpg')).toMatchObject({ ok: false, kind: 'noProviderUrl' });
    expect(await resolveFetchableSource('')).toMatchObject({ ok: false, kind: 'noProviderUrl' });
    expect(await resolveFetchableSource('javascript:alert(1)')).toMatchObject({ ok: false, kind: 'noProviderUrl' });
    // A path that is not our upload route is its own kind of bad: there is no
    // key to presign and no host to fetch from, so guessing a site URL here
    // would only send the vendor to a 404 with a confident-looking reason.
    expect(await resolveFetchableSource('/uploads/other.png')).toMatchObject({ ok: false, kind: 'relative' });
  });

  it('preserves a presigning failure as an unusable source, not a crash', async () => {
    r2.hasConfig = true;
    r2.downloadUrl.mockRejectedValue(new Error('R2 credentials expired'));
    const out = await resolveFetchableSource(route);
    expect(out).toMatchObject({ ok: false, kind: 'notFetchable' });
    if (!out.ok) expect(out.reason).toMatch(/R2 credentials expired/);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/media/asset-source.test.ts` → FAIL, module missing.

- [ ] **Step 3: Implement**

`frontend-web/src/lib/media/asset-source.ts`:

```ts
/**
 * Resolves a stored photo value into something a vendor can fetch itself.
 *
 * Cloudinary's upload API is given a URL and downloads it server-side, so a
 * relative in-app route (`/api/registration/uploads/<base64url key>`, which is
 * exactly what `form_data['media.photoUrl']` holds today) or a `file:` path is
 * not a source — it is a guaranteed vendor failure that surfaces as a
 * fail-closed moderation rejection, i.e. the worst possible error message for
 * what is really a plumbing problem.
 *
 * The presigned branch is deliberate. The original photograph is never made
 * public: what the vendor receives is a time-boxed read derived from the object
 * key at call time, with the shortest window that survives a slow upload. It is
 * never stored on a row and never logged, which is also why nothing here
 * returns a permanent `getR2PublicUrl` link.
 *
 * Our own route is presigned whether it arrives relative or absolute — the
 * absolute form is what mobile and older rows store, and fetching it would hit
 * the owner check on `app/api/registration/uploads/[fileKey]` and fail.
 *
 * Consequence worth stating for whoever runs this locally: with no R2
 * credentials in the environment there is nothing to presign, so the answer is
 * an honest `notFetchable` rather than a guessed URL. Dev photo jobs therefore
 * need R2 creds (or the stub provider in Task 6) to reach a vendor at all.
 */
import { createR2DownloadUrl, hasR2Config } from '@/src/lib/storage/r2';

/** The route the upload endpoint mints, relative. */
const UPLOAD_ROUTE = /^\/api\/registration\/uploads\/([A-Za-z0-9_-]+)$/;

/** Ten minutes matches R2's own default download TTL and is long enough for a
 * large PNG to leave Cloudinary's origin fetch before the signature expires. */
export const DEFAULT_PROVIDER_TTL_SECONDS = 600;

export type FetchableSource =
  | { ok: true; url: string; objectKey: string | null; ttlSeconds: number }
  | { ok: false; reason: string; kind: 'relative' | 'notFetchable' | 'noProviderUrl' };

/**
 * base64url -> object key, accepting only the shape the upload route actually
 * writes (`registration/<user id>/<uuid>.<ext>`). The return value is what gets
 * presigned, so a payload that decodes to traversal or to anything else is
 * refused rather than normalised.
 */
export function decodeUploadRouteKey(value: string): string | null {
  const match = UPLOAD_ROUTE.exec((value || '').trim());
  if (!match) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1], 'base64url').toString('utf8');
  } catch {
    return null;
  }
  return /^registration\/[^/]+\/[^/]+\.\w+$/.test(decoded) ? decoded : null;
}

function httpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

async function presign(objectKey: string, ttlSeconds: number): Promise<FetchableSource> {
  if (!hasR2Config()) {
    return {
      ok: false,
      kind: 'notFetchable',
      reason:
        `Object ${objectKey} needs a URL a vendor can fetch, but R2 is not configured to presign one ` +
        '(set R2_ENDPOINT or R2_ACCOUNT_ID with R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME)',
    };
  }
  try {
    const url = await createR2DownloadUrl({
      key: objectKey,
      fileName: objectKey.split('/').pop() || 'photo',
      disposition: 'inline',
      expiresIn: ttlSeconds,
    });
    return { ok: true, url, objectKey, ttlSeconds };
  } catch (err) {
    // A failed presign is a usable answer, not a crash: the job records it and
    // retries on the normal ladder instead of faulting the request that asked.
    return {
      ok: false,
      kind: 'notFetchable',
      reason: `Could not presign ${objectKey}: ${err instanceof Error ? err.message : 'unknown R2 error'}`,
    };
  }
}

export async function resolveFetchableSource(
  storedValue: string,
  // No `siteUrl`: the one case that would have needed it is our own upload
  // route, and that resolves better by presigning the key than by prefixing a
  // host onto a path the owner check would refuse to serve to the vendor.
  opts: { ttlSeconds?: number } = {},
): Promise<FetchableSource> {
  const value = (storedValue || '').trim();
  const ttlSeconds = opts.ttlSeconds ?? DEFAULT_PROVIDER_TTL_SECONDS;

  if (!value) {
    return { ok: false, kind: 'noProviderUrl', reason: 'No photo URL stored' };
  }

  const absolute = httpUrl(value);
  const objectKey = absolute
    ? decodeUploadRouteKey(absolute.pathname)
    : value.startsWith('/')
      ? decodeUploadRouteKey(value)
      : null;

  if (objectKey) return presign(objectKey, ttlSeconds);

  if (absolute) {
    // Already a public/CDN URL from somewhere else: pass it through untouched.
    return { ok: true, url: value, objectKey: null, ttlSeconds };
  }

  if (value.startsWith('/')) {
    return {
      ok: false,
      kind: 'relative',
      reason: `Stored value ${value} is a relative path that is not a Spotlight upload route, so there is no object key to presign`,
    };
  }

  return {
    ok: false,
    kind: 'noProviderUrl',
    reason: 'Stored photo value is neither an absolute http(s) URL nor a Spotlight upload route',
  };
}
```

- [ ] **Step 4: Run to verify pass** — the five cases above green.
- [ ] **Step 5: Commit** — `git commit -am "feat(photo): resolve a provider-fetchable source URL from a stored photo value"` (add the new test file explicitly in the same call).

Corrections applied while executing this task, now reflected in the blocks above:
the delivered unit is nine cases rather than five — an absolute upload-route URL
is presigned instead of fetched (the `[fileKey]` route is owner-gated, so the
vendor would be refused), a rejected presign degrades to `notFetchable` rather
than throwing, a non-route relative path reports the distinct `relative` kind the
interface declared but the draft never returned, and base64url bodies that do not
decode to a real key are refused. `objectKey` is `string | null` (a passthrough
public URL has no key), and the draft's `siteUrl` option is gone: the only case
that would have used it is the absolute-route case, and that resolves better by
presigning the key than by prefixing a host onto a path we refuse to serve to a
vendor. The TTL is forwarded to R2 as `expiresIn`, which is what the presigner
actually reads.

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
```

- [ ] **Step 2: Run to verify failure** — FAIL, module missing.

- [ ] **Step 3: Implement**

`frontend-web/src/server/photo-jobs/job-store.ts`. The Supabase client is created lazily and memoized exactly as `src/server/registration/template-resolver.ts` does, because `createClient` throws at module scope when env is unset (vitest collection, `next build`):

```ts
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
```

- [ ] **Step 4: Run to verify pass** — all `job-store.test.ts` cases green.
- [ ] **Step 5: Commit** — `git commit -am "feat(photo): job store wrapping the SQL claim/backoff functions"`

Corrections applied while executing this task: `PhotoJob` gained
`registration_user_id` and `getPhotoJob` now selects
`*, registrations(user_id)` and flattens the embed, because Task 8's ownership
check reads `job.registration_user_id` -- the draft's `select('*')` would have
made that comparison `undefined !== user.id` and 403 every legitimate owner.
`AssetKind` is exported so the registry and the runner share one list of the
five kinds instead of each spelling the CHECK constraint's values. The delivered
suite is 14 cases: the draft's five, plus the exact parameter shape of the other
six RPCs, the empty-error floor (`last_error` is what an operator reads), a null
claim payload, and the two null answers of `getPhotoJob`.

---

### Task 5: Registry — record the original, then enqueue

**Files:**
- Create: `frontend-web/src/server/photo-jobs/registry.ts`
- Create: `frontend-web/src/server/registration/connect-contest-id.ts`
- Modify: `frontend-web/src/server/registration/template-resolver.ts` (returns the template's identity)
- Modify: `frontend-web/src/lib/media/asset-source.ts` (adds `uploadObjectKeyFor`)
- Modify: `frontend-web/src/server/registration/supabase-store.ts` (imports the moved helper)
- Test: `frontend-web/tests/unit/photo-jobs/registry.test.ts`

**Interfaces:**
- Consumes: `resolveFetchableSource` + `uploadObjectKeyFor` (Task 3), `upsertPhotoAsset`/`enqueuePhotoJob`/`buildRunKey` (Task 4), `resolveConnectContestId` (moved here from `supabase-store.ts`), `resolveActiveTemplateForContest` (existing), `contentTypeForKey` (existing).
- Produces: `registerOriginalAndEnqueue(input: RegisterInput): Promise<RegisterOutcome>` where
  `RegisterInput = { registrationId, contestSlug?, contestId?, storedPhotoValue, renderParams? }` and
  `RegisterOutcome = { assetId: string | null; jobId: string | null; skipped: string | null }`.
  Tasks 6, 9, 10 and 11 all call this; nothing else writes an `original` asset row.

- [ ] **Step 1: Write the failing test**

```ts
// frontend-web/tests/unit/photo-jobs/registry.test.ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/photo-jobs/registry.test.ts`
Expected: FAIL — `Cannot find package '@/src/server/photo-jobs/registry'`, `Test Files 1 failed (1)`, `Tests 0`.

- [ ] **Step 3: Implement**

`frontend-web/src/server/photo-jobs/registry.ts`:

```ts
/**
 * The single entry point the rest of the app uses to put a contestant's
 * photograph into the compositing pipeline (spec §5, acceptance criterion 16).
 *
 * Order is the whole design: resolve what we can, record the original as an
 * asset row, and only then ask for a render. The behaviour this replaces wrote
 * the pipeline's output over the one stored photo value, so any failure
 * destroyed the input and left nothing to retry from. Here, a job that cannot
 * run — because the vendor has no URL to fetch, because moderation refused,
 * because the queue write failed — still leaves the photograph recorded and
 * readable. `assetId` comes back on every non-fatal path for exactly that
 * reason, and callers that show a photo should show it from the asset row.
 *
 * What gets stored is the object key, never a signed URL. A presigned URL is a
 * temporary capability with the same shape as a permanent one in a text column,
 * and the row's unique key is built from that value: store the ephemeral string
 * and every re-ingest mints a fresh "original" for the same photograph while the
 * reference quietly stops resolving an hour later.
 *
 * Returns rather than throws. The callers are the submit and review paths, both
 * of which must keep working when this feature fails, so the outcome is a small
 * record the caller can log or surface — never an exception that turns a broken
 * compositing job into a lost application.
 */
import { contentTypeForKey } from '@/src/lib/storage/local-uploads';
import { resolveFetchableSource, uploadObjectKeyFor } from '@/src/lib/media/asset-source';
import { resolveConnectContestId } from '@/src/server/registration/connect-contest-id';
import { resolveActiveTemplateForContest } from '@/src/server/registration/template-resolver';
import { buildRunKey, enqueuePhotoJob, upsertPhotoAsset } from './job-store';

export interface RegisterInput {
  registrationId: string;
  /**
   * Which contest this entry belongs to. Either form is accepted because the
   * rest of the registration flow carries a slug while the admin and job paths
   * carry the `connect_contests` id; the slug is resolved to an id here so no
   * caller has to duplicate that query.
   */
  contestSlug?: string | null;
  contestId?: string | null;
  /** The value currently stored in `form_data['media.photoUrl']`. */
  storedPhotoValue: string;
  /**
   * Contestant positioning choices from the preview editor. Part of the run key,
   * which is what lets a re-crop of the same photo be a new job rather than a
   * replay of the finished one.
   */
  renderParams?: Record<string, unknown>;
}

export interface RegisterOutcome {
  /** The original's asset row id, or null when nothing was recorded. */
  assetId: string | null;
  /** The queued render's id, or null when no job was created. */
  jobId: string | null;
  /**
   * Why no job was created, or null when one was. Kept as a short machine-ish
   * string (`noPhoto`, `assetWriteFailed`, `enqueueFailed`, or
   * `<sourceKind>: <reason>`) so a caller can log it and an operator can read
   * it without this module owning any presentation.
   */
  skipped: string | null;
}

export async function registerOriginalAndEnqueue(
  input: RegisterInput,
): Promise<RegisterOutcome> {
  const stored = (input.storedPhotoValue || '').trim();
  if (!stored) return { assetId: null, jobId: null, skipped: 'noPhoto' };

  // Skipped rather than called with an empty slug: the helper answers null for
  // that input anyway, and a queue writer that fires a pointless query on every
  // photo-less call is how a hot path ends up rate-limited by its own database.
  const contestId =
    input.contestId ?? (input.contestSlug ? await resolveConnectContestId(input.contestSlug) : null);

  // Both of these read the stored value; neither may fail. The key is what the
  // row stores, the fetchable source is only what the vendor can be given, and
  // a machine without R2 credentials still has to record the photograph.
  const objectKey = uploadObjectKeyFor(stored);
  const resolved = await resolveFetchableSource(stored);

  // An object we own is referenced by key; anything else — a CDN URL from an
  // older import, a value this module does not recognise — is kept verbatim in
  // provider_url. Storing the unrecognised form is not a claim that it is
  // fetchable; it is the alternative to losing the only pointer we have.
  const storageKey = objectKey;
  const providerUrl = objectKey ? null : stored;

  const assetId = await upsertPhotoAsset({
    registrationId: input.registrationId,
    kind: 'original',
    storageKey,
    providerUrl,
    // Derived from the name rather than assumed: a PNG original labelled
    // image/jpeg is a wrong fact on an immutable row forever, and this is the
    // only place the label is chosen.
    contentType: contentTypeForKey(objectKey ?? stored),
    contestId,
  });
  if (!assetId) return { assetId: null, jobId: null, skipped: 'assetWriteFailed' };

  if (!resolved.ok) {
    // The original is safe; the render cannot run yet. Reported as a skipped
    // reason rather than enqueued to fail six times and pause for review.
    return { assetId, jobId: null, skipped: `${resolved.kind}: ${resolved.reason}` };
  }

  const template = contestId ? await resolveActiveTemplateForContest(contestId) : null;
  const templateId = template?.templateId ?? null;

  const job = await enqueuePhotoJob({
    runKey: buildRunKey({ sourceAssetId: assetId, templateId, renderParams: input.renderParams }),
    registrationId: input.registrationId,
    sourceAssetId: assetId,
    contestId,
    templateId,
    renderParams: input.renderParams,
  });

  return { assetId, jobId: job?.jobId ?? null, skipped: job ? null : 'enqueueFailed' };
}
```

`frontend-web/src/server/registration/connect-contest-id.ts` — the slug lookup, moved verbatim out of
`supabase-store.ts` (which now imports it; its own call site is unchanged):

```ts
/**
 * slug -> `connect_contests.id`, the one lookup needed to decide whether a
 * contest has a compositing template configured.
 *
 * This began as a private helper inside `supabase-store.ts`. It lives here now
 * because the photo registry needs it and the registry is going to be called
 * FROM `supabase-store.ts` (the submit and review paths are its only callers),
 * which would have made the two modules import each other. A one-function
 * module breaks the cycle without any behaviour change, and both sides arrive
 * through the same query instead of maintaining two copies that can drift.
 *
 * Returns null (never throws) on any miss or error — an unresolvable contest
 * simply means no template is consulted and the caller keeps the plain photo.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Lazy + memoized for the same reason as template-resolver.ts: building a
// client at import time captures whatever env happened to be set when the
// module was first loaded, which is never a time to construct one (vitest
// collection, next build).
let supabaseClient: SupabaseClient | null = null;
function getSupabase() {
  if (!supabaseClient) {
    supabaseClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || '',
      { auth: { persistSession: false } },
    );
  }
  return supabaseClient;
}

export async function resolveConnectContestId(
  slug: string | null | undefined,
): Promise<string | null> {
  if (!slug) return null;
  const { data, error } = await getSupabase()
    .from('connect_contests')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { id: string }).id;
}
```

`frontend-web/src/lib/media/asset-source.ts` — add this export above `resolveFetchableSource` and make
that function read the key through it (`const objectKey = uploadObjectKeyFor(value);`) so "is this our
upload route" has exactly one implementation:

```ts
/**
 * The object key behind a stored photo value, or null when it is not our own
 * upload route.
 *
 * Split out from `resolveFetchableSource` because the key is wanted even when
 * no fetchable URL can be produced: the asset row stores the key, not the
 * signed URL, and a machine with no R2 credentials still has to be able to
 * record which photograph a contestant uploaded. Callers that only need a
 * vendor source keep using `resolveFetchableSource`, which reads the value
 * through this same function — so "is this our route" has exactly one answer.
 */
export function uploadObjectKeyFor(storedValue: string): string | null {
  const value = (storedValue || '').trim();
  if (!value) return null;
  const absolute = httpUrl(value);
  // The absolute form is what mobile and older rows store; both spellings
  // name the same object.
  return decodeUploadRouteKey(absolute ? absolute.pathname : value.startsWith('/') ? value : '');
}
```

`frontend-web/src/server/registration/template-resolver.ts` — `ResolvedTemplate` gains the template's
identity, the query selects it, and the return passes it through:

```ts
export interface ResolvedTemplate {
  /**
   * Identity of the template that was resolved, not just its pixels.
   *
   * The photo job queue keys each render by template, so a template edit that
   * publishes a new version must produce a new job rather than being answered
   * from the completed row of the version before it. That is only expressible
   * if the resolver hands back `id` and `version` — until now it returned the
   * URL and dimensions and dropped both, which meant callers either re-queried
   * the table themselves or built a run key that could not tell two versions
   * apart. Both are selected by the query below, so no caller has to cast the
   * row or re-fetch it to learn which template a job was rendered against.
   */
  templateId: string;
  templateVersion: number;
  templateUrl: string;
  templateWidth: number;
  templateHeight: number;
  slot: SlotConfig;
}
```

```ts
.select('id, version, template_url, width, height')

// … and at the end of resolveActiveTemplateForContest:
  return {
    templateId: template.id,
    templateVersion: Number(template.version),
    templateUrl: template.template_url,
    templateWidth: Number(template.width),
    templateHeight: Number(template.height),
    slot,
  };
```

Widening the interface breaks one existing fixture that constructs a `ResolvedTemplate` literal —
`tests/unit/registration/review-template-wiring.test.ts`, which gains `templateId: 'tpl-1'` and
`templateVersion: 2`. `npx vitest run tests/unit/registration/template-resolver.test.ts` additionally
pins the column list the resolver asks for, because the mock returns a whole row whatever the query
selects and would keep passing if `version` disappeared from the `select` string.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/photo-jobs/registry.test.ts`
Expected: PASS — `Tests 11 passed (11)`.

Run: `npx vitest run tests/unit/media/asset-source.test.ts tests/unit/registration/template-resolver.test.ts tests/unit/registration/review-template-wiring.test.ts tests/unit/photo-jobs/job-store.test.ts tests/unit/media/provider.test.ts`
Expected: PASS — the neighbouring suites the refactor touches stay green.

Run: `npm run type-check`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend-web/src/server/photo-jobs/registry.ts \
      frontend-web/src/server/registration/connect-contest-id.ts \
      frontend-web/src/server/registration/template-resolver.ts \
      frontend-web/src/lib/media/asset-source.ts \
      frontend-web/src/server/registration/supabase-store.ts \
      frontend-web/tests/unit/photo-jobs/registry.test.ts \
      frontend-web/tests/unit/registration/template-resolver.test.ts \
      frontend-web/tests/unit/registration/review-template-wiring.test.ts
git commit -m "feat(photo): registry records the original asset before enqueuing a render"
```

**Corrections made while executing (the draft was not executable as written):**

1. *The draft stored the fetched presigned URL as the asset reference.* It set `providerUrl` from
   `resolved.url`, which for our own uploads is a signed R2 URL carrying `X-Amz-Signature`. Two
   failures follow: the reference stops resolving when the signature expires, and the row's unique
   index is `kind, coalesce(storage_key, provider_url)` — so re-ingesting the same photograph mints a
   second `original` for one contestant. The delivered code stores the object key
   (`uploadObjectKeyFor(stored)`), which needs the key even when presigning fails, hence the new
   export. Test (a) asserts the signed URL appears nowhere in the write.
2. *`contentType: 'image/jpeg'` was hard-coded.* A PNG original would be labelled wrongly on an
   immutable row forever; the delivered code derives it with the repo's own `contentTypeForKey`, and
   test (b) asserts `image/png` for a PNG object.
3. *The draft cast `template` to `any` to read `.id`.* `ResolvedTemplate` did not carry the template's
   identity at all, so a run key could not distinguish two versions of a template and a template edit
   would be answered by the previous version's completed job. `templateId`/`templateVersion` are now
   part of the resolver's contract, selected and returned.
4. *The draft mocked the entire job store,* including the pure `buildRunKey`, which made its own
   instruction — "assert the run key differs between two template ids" — impossible to satisfy: the
   mock returned the same string for both. The delivered test mocks only the two functions that need a
   database and imports the real `buildRunKey`.
5. *The draft called `resolveConnectContestId` on the registry with a `contestSlug` while importing it
   from `supabase-store.ts`, which is the file Tasks 9 and 10 will call the registry from* — a circular
   import. The helper moved to its own module instead.
6. *An absent slug fired a query anyway.* `resolveConnectContestId('')` answers null, so the draft's
   unconditional `await` meant every photo-less call ran a database round-trip for nothing; the
   delivered code skips it, and the last test pins that.

**Note on a pre-existing failure found while verifying:** `tests/unit/registration/contest-admin-schedule-route.spec.ts` fails 2 of 8 (`No "getRegistrationContestBySlug" export is defined on the "@/src/server/registration/store" mock`). Reproduced verbatim on `origin/main` (`b926c8b4b`) in a throwaway worktree, so it is not this branch's and is left alone.


### Task 6: Runner — one claimed job, all-or-nothing output

**Executed 2026-11-26 as `b1f68c225`** (11 files, 882 insertions). The section
below is the delivered code, not the draft: the draft's own defects are listed
after it so an executor re-deriving this task reads the corrections instead of
re-introducing them.

**Files:**
- Create: `frontend-web/src/server/photo-jobs/runner.ts`
- Create: `frontend-web/src/server/photo-jobs/persist.ts` — the shared writer
- Create: `frontend-web/src/server/photo-jobs/assets.ts` — read bytes for a row
- Create: `frontend-web/src/server/photo-jobs/variants.ts` — real sharp resize
- Create: `frontend-web/tests/unit/photo-jobs/runner.test.ts`
- Create: `frontend-web/tests/unit/photo-jobs/assets.test.ts`
- Create: `frontend-web/tests/unit/photo-jobs/variants.test.ts`
- Modify: `frontend-web/src/server/photo-jobs/job-store.ts` — `getPhotoAsset`
  and the `PhotoAsset` type the runner reads
- Modify: `frontend-web/src/lib/storage/r2.ts` — `readR2Object`
- Modify: `frontend-web/src/server/registration/photo-pipeline.ts` — its
  `persistToR2` now delegates the write so review and runner share one writer
- Modify: `frontend-web/tests/unit/photo-jobs/job-store.test.ts` — `getPhotoAsset`

**Interfaces:**
- Consumes: `getPhotoProvider()` (Task 2, shape `{name, configured, missing,
  extractBackground, moderate}`), `resolveFetchableSource` (existing),
  `compositeImage` + `SlotConfig` (existing compositor),
  `resolveActiveTemplateForContest` returning `ResolvedTemplate` with
  `templateId`/`templateVersion` (Task 5), `getPhotoAsset`/`upsertPhotoAsset`/
  `setPhotoJobProgress`/`completePhotoJob`/`failPhotoJob`/`cancelPhotoJob`
  (Tasks 4-6).
- Produces: `runPhotoJob(job: PhotoJob): Promise<RunOutcome>` where
  `RunOutcome = 'ready' | 'failed' | 'cancelled'`; `storePhoto(buffer, mimeType,
  prefix): Promise<string>` returning an **object key**; `readAssetBytes(asset:
  AssetLocation): Promise<Buffer | null>`; `renderVariant(image, name): Promise<
  VariantImage>` with `VARIANT_MAX_WIDTH = {preview: 1080, thumbnail: 320}`;
  `readR2Object(key): Promise<Buffer | null>`.

- [x] **Step 1: Write the failing test** — 17 cases, delivered verbatim:

```ts
// tests/unit/photo-jobs/runner.test.ts
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
```
- [x] **Step 2: Run to verify failure.** `Test Files 1 failed (1)` /
  `Tests  no tests` — `Cannot find module '@/src/server/photo-jobs/runner'`
  (and `persist`, `assets`, `variants`), which is the red the task asked for.

- [x] **Step 3: Implement the helpers.**

```ts
// src/server/photo-jobs/persist.ts
/**
 * Storing a rendered image — the write half of the pipeline (spec §11).
 *
 * Deliberately returns the object KEY, not a URL. The existing
 * `photo-pipeline.ts` helper returns a public URL because that is all a
 * synchronous response needs; an asset row that has to outlive the request
 * needs the key, from which a URL (public or signed) is derived at read time.
 * Recording a derived value as the reference is what makes references rot, so
 * the two are kept as separate functions with different names rather than one
 * function with a flag.
 *
 * Throws on any failure. In P1 the only caller is the job runner, where a
 * storage fault is a retryable job failure on the normal backoff ladder — and
 * swallowing it into a `null` would mean a job that looks finished while the
 * bytes it points at were never written.
 */
import { randomUUID } from 'crypto';
import { hasR2Config, uploadR2Object } from '@/src/lib/storage/r2';

/** Same layout `photo-pipeline.ts` has always used, so composites from both
 *  code paths land in one place instead of two near-identical prefixes. */
export function photoObjectKey(mimeType: string, prefix: string): string {
  const ext = mimeType === 'image/png' ? 'png' : 'jpg';
  return `contestants/${prefix}/${randomUUID()}.${ext}`;
}

export async function storePhoto(buffer: Buffer, mimeType: string, prefix: string): Promise<string> {
  if (!hasR2Config()) throw new Error('R2 storage is not configured');
  const key = photoObjectKey(mimeType, prefix);
  await uploadR2Object({ key, body: buffer, contentType: mimeType });
  return key;
}
```

```ts
// src/server/photo-jobs/assets.ts
/**
 * Reading an asset's bytes back from whichever store holds them (spec §11).
 *
 * Two locations, because the table has two: `storage_key` is an object in our
 * own bucket or, on a machine with no R2 credentials, a file under the local
 * upload root; `provider_url` is somebody else's URL — a Cloudinary cutout the
 * vendor handed back, or a photo a client submitted by link.
 *
 * The value-not-exception contract is deliberate. This runs inside a claimed
 * job, and a job that throws is indistinguishable from a bug in the runner,
 * while a job that answers "unreadable" with the reason is something an operator
 * can act on. The one case that must never be papered over is reported in the
 * log, not the row: the runner already has a single message for "the bytes were
 * not there", and putting the vendor's URL inside it would copy a signed link
 * into the job ledger.
 *
 * A stored URL is only fetched when its host is on the allowlist the compositor
 * already uses (`isAllowedRemoteImageUrl`). A background job with no user in the
 * loop reading an arbitrary URL from a database row is an SSRF primitive, and an
 * allowlist is the policy this app already enforces for exactly that reason.
 */
import { isAllowedRemoteImageUrl } from '@/lib/config';
import { hasR2Config, readR2Object } from '@/src/lib/storage/r2';
import { readLocalUpload } from '@/src/lib/storage/local-uploads';

export interface AssetLocation {
  storage_key: string | null;
  provider_url: string | null;
}

async function fetchAllowed(url: string, context: string): Promise<Buffer | null> {
  if (!isAllowedRemoteImageUrl(url)) {
    console.warn(`[photo-jobs] refusing to fetch a ${context} whose host is not allowlisted: ${url}`);
    return null;
  }
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    console.warn(`[photo-jobs] ${context} fetch answered ${res.status}`);
    return null;
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function readAssetBytes(asset: AssetLocation): Promise<Buffer | null> {
  try {
    if (asset.storage_key) {
      // No R2 credentials means the key can only name a local upload — which is
      // the only thing that ever wrote one (see local-uploads.ts:136, itself
      // `Buffer | null`).
      if (!hasR2Config()) return await readLocalUpload(asset.storage_key);
      return await readR2Object(asset.storage_key);
    }
    if (asset.provider_url) return await fetchAllowed(asset.provider_url, 'provider_url');
    console.warn('[photo-jobs] asset row has neither a storage key nor a provider URL');
  } catch (err) {
    console.warn('[photo-jobs] asset read failed:', err instanceof Error ? err.message : err);
  }
  return null;
}
```

```ts
// src/server/photo-jobs/variants.ts
/**
 * Display variants of a finished composite (spec §8: "consistent presentation
 * across surfaces … with variants").
 *
 * One resize, driven by the composite that was just built, not a second render
 * pass. Re-compositing at thumbnail size would put a second copy of the layout
 * rules in this file, and the two would drift — the same reason the compositor
 * owns slot geometry and nothing below it re-derives it.
 *
 * PNG throughout. A JPEG thumbnail would be smaller, but the composite can
 * legitimately have transparent pixels (a template whose background is a cutout
 * shape), and `sharp`'s implicit matte for a flattened alpha channel is a
 * visible colour shift on a contestant's portrait — a byte saving is not worth
 * an unexpected background. Format choice belongs with P2's styling pass, where
 * there is a designed background to flatten onto.
 */
import sharp from 'sharp';

export type VariantName = 'preview' | 'thumbnail';

/** Max widths, not fixed sizes: portrait aspect ratios vary by template, and a
 *  surface that crops to a square crops in CSS where the rule is visible. */
export const VARIANT_MAX_WIDTH: Record<VariantName, number> = {
  preview: 1080,
  thumbnail: 320,
};

export interface VariantImage {
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

export async function renderVariant(image: Buffer, name: VariantName): Promise<VariantImage> {
  const maxWidth = VARIANT_MAX_WIDTH[name];
  if (!maxWidth) throw new Error(`Unknown photo variant "${name}"`);

  const resized = await sharp(image)
    .resize({ width: maxWidth, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: resized.data,
    mimeType: 'image/png',
    width: resized.info.width,
    height: resized.info.height,
  };
}
```

Plus the additions the modules above call. `src/lib/storage/r2.ts` gains the read mirror of the `uploadR2Object` that already lives there (the rest of that file is untouched):

```ts
// src/lib/storage/r2.ts - the added export only
/**
 * Direct server-side read of an object's bytes.
 *
 * The mirror of `uploadR2Object` above: a job runner that already holds the
 * bucket credentials does not need to presign a URL in order to fetch it back
 * from itself. `null` means the object is not in the bucket — the one answer a
 * caller can act on — while a credential, network or SDK fault throws so the
 * caller can tell "gone" apart from "storage was briefly unhappy" instead of
 * treating a transient failure as a deleted photograph.
 */
export async function readR2Object(key: string): Promise<Buffer | null> {
  const { bucket, client } = getR2Config();
  try {
    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const base64 = await object.Body?.transformToString('base64');
    return base64 ? Buffer.from(base64, 'base64') : null;
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'NoSuchKey' || name === 'NotFound') return null;
    throw err;
  }
}
```

`src/server/photo-jobs/job-store.ts` gains the row type and read the runner consumes:

```ts
// src/server/photo-jobs/job-store.ts - the added type and read
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

export async function getPhotoAsset(id: string): Promise<PhotoAsset | null> {
  const { data, error } = await db()
    .from('contest_photo_assets')
    .select('id, registration_id, contest_id, kind, storage_key, provider_url, content_type, width, height, bytes, template_id, template_version, render_params')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.warn('[photo-jobs] asset read failed:', error.message);
    return null;
  }
  return (data as PhotoAsset) ?? null;
}
```

and the review path now shares the writer, so its own wrapper is the only change in it:

```ts
// src/server/registration/photo-pipeline.ts
/**
 * Contestant photo pipeline — moderation + background removal + optional
 * template compositing, orchestrated from Cloudinary (src/lib/media/cloudinary.ts)
 * and the existing Sharp compositor (src/lib/rendering/imageCompositor.ts).
 *
 * Test-plan: G-IMG / TS-3 (docs/qa/voting-contest-test-plan.md).
 *
 * ── Template compositing reachability ───────────────────────────────────────
 * `compositeImage` needs a `CompositorInput` (templateUrl/templateWidth/
 * templateHeight/slot). `contest_templates`/`template_slots`
 * (supabase/migrations/20260405700000_contest_image_templates.sql) is the
 * only template concept in the schema, but `contest_templates.contest_id`
 * references the LEGACY `public.contests` table — not `connect_contests`,
 * which is what registrations resolve via `registrations.contest_slug`
 * (see promote_registration_to_contestant in
 * supabase/migrations/20260812010000_registration_contestant_seam.sql).
 * There is no bridge row/column linking a connect_contests contest to a
 * contest_templates row today, and no admin UI to create one (AD-003/CS-004,
 * explicitly out of scope here). So a real registration approval has no way
 * to resolve which template+slot to composite onto.
 *
 * `processContestantPhoto` (full pipeline, moderation + bg-removal +
 * compositing) is still implemented and unit-tested here for when that link
 * exists, but the registration review wiring
 * (app/api/admin/registration/applications/[id]/review/route.ts) uses
 * `processContestantPhotoNoTemplate` — moderation + optional background-removal
 * cutout only, no compositing — because that's what's actually reachable from
 * today's data model.
 */

import { moderatePhoto, removeBackground } from '@/src/lib/media/cloudinary';
import { compositeImage, type SlotConfig } from '@/src/lib/rendering/imageCompositor';
import { getR2PublicUrl } from '@/src/lib/storage/r2';
import { storePhoto } from '@/src/server/photo-jobs/persist';

export type PhotoPipelineResult =
  | { status: 'ready'; photoUrl: string }
  | { status: 'rejected'; reason: string }
  | { status: 'fallback'; photoUrl: string; reason: string };

export interface ProcessContestantPhotoInput {
  rawPhotoUrl: string;
  templateUrl: string;
  templateWidth: number;
  templateHeight: number;
  slot: SlotConfig;
}

/**
 * Upload a composited/cutout buffer to R2 and return a stable public URL.
 * Throws if R2 isn't configured or the upload fails — callers decide what
 * that means for their status (ready vs. fallback).
 *
 * The write itself lives in `photo-jobs/persist.ts` so the synchronous review
 * path and the queued runner cannot disagree about key layout or about which
 * errors are fatal; this wrapper adds the one thing only a response needs — the
 * public URL — and keeps the legacy contract that a stored object without a
 * public base URL is an error rather than a silently unresolvable reference.
 */
async function persistToR2(buffer: Buffer, mimeType: string, prefix: string): Promise<string> {
  const key = await storePhoto(buffer, mimeType, prefix);
  const publicUrl = getR2PublicUrl(key);
  if (!publicUrl) {
    throw new Error('R2 upload succeeded but no public base URL is configured (R2_PUBLIC_BASE_URL)');
  }
  return publicUrl;
}

/**
 * Run moderation on a raw photo URL. Returns null if approved (or dev-mode
 * skip), or a rejected PhotoPipelineResult to return immediately.
 *
 * IMPORTANT: the `notConfigured` skip below is a DEV-ONLY relaxation. It must
 * NEVER trigger when Cloudinary creds ARE configured — it only fires when
 * `moderatePhoto` explicitly reports `notConfigured: true` (i.e. env vars are
 * literally absent), never as a default-open fallback for an ambiguous or
 * malformed moderation response. Every other non-approved outcome
 * (including HTTP/parse errors, which `moderatePhoto` itself fails closed on)
 * rejects here.
 */
async function runModerationGate(rawPhotoUrl: string): Promise<PhotoPipelineResult | null> {
  const moderation = await moderatePhoto(rawPhotoUrl);

  if (moderation.approved) return null;

  if (moderation.notConfigured) {
    // eslint-disable-next-line no-console
    console.warn(
      '[photo-pipeline] Cloudinary is not configured — skipping content moderation for this photo. ' +
        'This path must only ever be reached in local/dev environments with no CLOUDINARY_* env vars set. ' +
        'It must never be treated as a default-open fallback for a configured-but-ambiguous moderation result.'
    );
    return null;
  }

  return { status: 'rejected', reason: moderation.reason || 'Photo failed content moderation' };
}

/**
 * Full pipeline: moderate -> background-remove -> composite onto template ->
 * upload to R2. See module doc for why this is not currently reachable from
 * the real registration-review flow (no contest_templates<->connect_contests
 * link), but it is fully implemented + tested for when that link exists.
 */
export async function processContestantPhoto(
  input: ProcessContestantPhotoInput
): Promise<PhotoPipelineResult> {
  const { rawPhotoUrl, templateUrl, templateWidth, templateHeight, slot } = input;

  const gated = await runModerationGate(rawPhotoUrl);
  if (gated) return gated;

  const bgResult = await removeBackground(rawPhotoUrl);

  // Fallback preference: if background removal fails, prefer compositing the
  // RAW photo onto the template over skipping compositing entirely — the
  // template framing/branding is more valuable to preserve than a clean
  // cutout, and the compositor handles a non-transparent source photo fine
  // (it just won't look "cut out"). Only fall back further, to the
  // fully-uncomposited raw URL, if compositing itself also fails (e.g. the
  // template asset is unreachable) — at that point there's nothing left to
  // safely combine, so return the one URL guaranteed to be a real image.
  const photoUrlForSlot = bgResult.ok ? bgResult.resultUrl : rawPhotoUrl;
  const usedCutout = bgResult.ok;

  try {
    const composited = await compositeImage({
      templateUrl,
      templateWidth,
      templateHeight,
      slots: [{ ...slot, photo_url: photoUrlForSlot }],
    });
    const uploadedUrl = await persistToR2(composited.buffer, composited.mimeType, 'composited');

    if (usedCutout) {
      return { status: 'ready', photoUrl: uploadedUrl };
    }
    return {
      status: 'fallback',
      photoUrl: uploadedUrl,
      reason: `Background removal failed (${!bgResult.ok ? bgResult.reason : 'unknown'}); composited with raw photo instead`,
    };
  } catch (compositeErr) {
    const compositeReason = compositeErr instanceof Error ? compositeErr.message : 'Unknown compositing error';
    // Compositing itself failed — fall all the way back to the raw photo URL,
    // which is at least a real, viewable image.
    return {
      status: 'fallback',
      photoUrl: rawPhotoUrl,
      reason: `Compositing failed (${compositeReason}); using raw photo with no template`,
    };
  }
}

/**
 * No-template pipeline: moderate, then (best-effort) background-remove,
 * returning the Cloudinary cutout URL directly with no compositing. This is
 * the function actually wired into registration approval today — see module
 * doc for why full template compositing isn't reachable from real data yet.
 */
export async function processContestantPhotoNoTemplate(rawPhotoUrl: string): Promise<PhotoPipelineResult> {
  const gated = await runModerationGate(rawPhotoUrl);
  if (gated) return gated;

  const bgResult = await removeBackground(rawPhotoUrl);
  if (bgResult.ok) {
    return { status: 'ready', photoUrl: bgResult.resultUrl };
  }

  // No template to fall back to compositing onto here — the only fallback
  // available is the original, unprocessed photo URL.
  return {
    status: 'fallback',
    photoUrl: rawPhotoUrl,
    reason: `Background removal failed (${bgResult.reason}); using raw photo`,
  };
}
```
- [x] **Step 4: Implement the runner.**

```ts
// src/server/photo-jobs/runner.ts
/**
 * Executes one claimed job (spec §6, §7).
 *
 * All-or-nothing by construction: a `final` asset row is written only after the
 * composite has been built and stored, and the job is only marked `ready` after
 * that row exists. So a reader that finds a ready job is guaranteed a complete
 * portrait, and any failure leaves the original exactly where the registry put
 * it and publishes nothing under the template's name.
 *
 * The order of the checks is a cost order, not a convenience one. Read the row,
 * prove the photograph is still there, get the vendor a URL it can fetch,
 * moderate, confirm the template is still the one the job was queued for, and
 * only then spend the paid calls (extraction, compositing). Two of those steps
 * exist purely to avoid a misleading later failure: an unreadable original comes
 * back from the vendor as a moderation-shaped rejection, and a template that was
 * republished mid-queue would otherwise render the contestant onto the wrong
 * frame and record it against the job's stale template id.
 *
 * Content safety keeps the fail-closed semantics already documented in
 * `registration/photo-pipeline.ts`: `notConfigured` — literally absent
 * credentials — is the only non-approval that may pass, and an ambiguous answer
 * from a configured vendor never reaches the compositor.
 *
 * Nothing here catches an exception to keep going. Variants are the single
 * exception, and only because a thumbnail is decoration on a portrait that is
 * already finished and stored; losing them must not un-publish a result.
 */
import { resolveFetchableSource } from '@/src/lib/media/asset-source';
import { getPhotoProvider } from '@/src/lib/media/provider';
import { compositeImage } from '@/src/lib/rendering/imageCompositor';
import { resolveActiveTemplateForContest } from '@/src/server/registration/template-resolver';
import { readAssetBytes } from './assets';
import {
  cancelPhotoJob,
  completePhotoJob,
  failPhotoJob,
  getPhotoAsset,
  setPhotoJobProgress,
  upsertPhotoAsset,
  type PhotoJob,
} from './job-store';
import { storePhoto } from './persist';
import { renderVariant, type VariantName } from './variants';

export type RunOutcome = 'ready' | 'failed' | 'cancelled';

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export async function runPhotoJob(job: PhotoJob): Promise<RunOutcome> {
  const provider = getPhotoProvider();

  // The mobile sequence starts at `extracting` here: from this point the job is
  // ours (claimed with a lock) and every later write is either a progress value,
  // a terminal `ready`, or a terminal `failed`/`cancelled`.
  await setPhotoJobProgress(job.id, 'extracting', 5);

  const source = await getPhotoAsset(job.source_asset_id);
  if (!source) return fail(job, `Could not read the source asset ${job.source_asset_id} for this job`);

  // A deleted or unreachable original must not reach the vendor: the answer that
  // comes back is a moderation-shaped refusal that describes neither the fault
  // nor the fix. In P2 this same read becomes the pixel source.
  if (!(await readAssetBytes(source))) {
    return fail(job, 'The stored original photograph is unreadable — its bytes could not be fetched');
  }

  const stored = source.storage_key ?? source.provider_url ?? '';
  const fetchable = await resolveFetchableSource(stored);
  if (!fetchable.ok) {
    return fail(job, `Original photo is not fetchable for the provider: ${fetchable.reason}`);
  }

  const verdict = await provider.moderate(fetchable.url);
  if (!verdict.approved && !verdict.notConfigured) {
    await cancelPhotoJob(job.id, verdict.reason || 'Photo failed content moderation');
    return 'cancelled';
  }

  // Resolve before the paid calls, and against the identity the job carries: a
  // job queued for template A must not render onto template B because an admin
  // published a new one while the queue was backed up.
  const template = job.contest_id ? await resolveActiveTemplateForContest(job.contest_id) : null;
  if (!template) {
    return fail(job, 'The contest has no active template to composite onto');
  }
  if (job.template_id && template.templateId !== job.template_id) {
    return fail(
      job,
      `The active template changed since this job was queued (queued for ${job.template_id}, contest now resolves ${template.templateId})`,
    );
  }

  await setPhotoJobProgress(job.id, 'extracting', 35);
  const cutout = await provider.extractBackground(fetchable.url);
  if (!cutout.ok) {
    return fail(job, `Background removal failed via the ${provider.name} provider: ${cutout.reason || 'no reason given'}`);
  }

  const transparentId = await upsertPhotoAsset({
    registrationId: job.registration_id,
    kind: 'transparent',
    providerUrl: cutout.resultUrl,
    contentType: 'image/png',
    contestId: job.contest_id,
    templateId: template.templateId,
    templateVersion: template.templateVersion,
    renderParams: job.render_params,
  });
  if (!transparentId) return fail(job, 'Could not record the transparent cutout asset');

  await setPhotoJobProgress(job.id, 'compositing', 70);

  let composited: { key: string; buffer: Buffer; mimeType: string; width: number; height: number };
  try {
    // The cutout, never the original, is what goes into the slot — otherwise the
    // feature is a rectangle pasted onto a rectangle. Falling back to the
    // original only when there is no cutout URL is `photo-pipeline.ts:122`'s
    // existing preference, kept identical so both code paths agree.
    const rendered = await compositeImage({
      templateUrl: template.templateUrl,
      templateWidth: template.templateWidth,
      templateHeight: template.templateHeight,
      slots: [{ ...template.slot, photo_url: cutout.resultUrl || fetchable.url }],
    });
    composited = { ...rendered, key: await storePhoto(rendered.buffer, rendered.mimeType, 'composited') };
  } catch (err) {
    return fail(job, `Compositing failed: ${messageOf(err)}`);
  }

  const finalId = await upsertPhotoAsset({
    registrationId: job.registration_id,
    kind: 'final',
    storageKey: composited.key,
    contentType: composited.mimeType,
    width: composited.width,
    height: composited.height,
    bytes: composited.buffer.byteLength,
    templateId: template.templateId,
    templateVersion: template.templateVersion,
    renderParams: job.render_params,
    contestId: job.contest_id,
  });
  if (!finalId) {
    return fail(job, 'The composite was stored but its asset row could not be recorded');
  }

  await writeVariants(job, composited.buffer, template);

  if (!(await completePhotoJob(job.id, finalId))) {
    // The bytes exist and the row exists, so this is a job-table fault, and an
    // operator has to be able to tell that apart from "the portrait failed".
    return fail(job, 'The composite is stored but the job could not be marked ready');
  }
  return 'ready';
}

/** Preview and thumbnail. A failure here is logged and skipped: the portrait is
 *  already stored and recorded, and the surfaces that want a variant fall back
 *  to the `final` asset rather than showing nothing. */
async function writeVariants(
  job: PhotoJob,
  finalBuffer: Buffer,
  template: { templateId: string; templateVersion: number },
): Promise<void> {
  for (const name of ['preview', 'thumbnail'] as VariantName[]) {
    try {
      const variant = await renderVariant(finalBuffer, name);
      const key = await storePhoto(variant.buffer, variant.mimeType, name);
      await upsertPhotoAsset({
        registrationId: job.registration_id,
        kind: name,
        storageKey: key,
        contentType: variant.mimeType,
        width: variant.width,
        height: variant.height,
        bytes: variant.buffer.byteLength,
        templateId: template.templateId,
        templateVersion: template.templateVersion,
        renderParams: job.render_params,
        contestId: job.contest_id,
      });
    } catch (err) {
      console.warn(`[photo-jobs] ${name} variant failed for job ${job.id}:`, messageOf(err));
    }
  }
}

async function fail(job: PhotoJob, reason: string): Promise<'failed'> {
  await failPhotoJob(job.id, reason);
  return 'failed';
}
```
- [x] **Step 5: Run to verify pass.**
  `npx vitest run tests/unit/photo-jobs/ tests/unit/registration/photo-pipeline.test.ts`
  → `Test Files 6 passed (6)`, `Tests 66 passed (66)` — 17 runner, 16 job-store,
  11 registry, 7 assets, 5 variants, 10 existing pipeline cases (unchanged, which
  is the proof that sharing the writer did not alter the review path).
  Wider run `npx vitest run tests/unit/registration tests/unit/photo-jobs` →
  `Test Files 1 failed | 38 passed (39)`, `Tests 2 failed | 318 passed (320)`; the
  two failures are `contest-admin-schedule-route.spec.ts` and reproduce on
  `origin/main` (`b926c8b4b`) in a throwaway worktree — see Task 5's note.
  `npm run type-check` → exit 0.

- [x] **Step 6: Commit** — `b1f68c225 feat(photo): job runner publishes assets only when a composite is complete`.

**Corrections to the draft** (what an executor would otherwise get wrong):

1. The draft's mock line `vi.mock('@/src/lib/media/provider', () =>
   deps.getPhotoProvider)` hands the factory a bare function, so the module has
   no `getPhotoProvider` export. Delivered: `() => ({ getPhotoProvider:
   deps.getPhotoProvider })`.
2. `persistToR2` is **not** lifted as-is. It returned a public URL, and an asset
   row must store the object key (a URL is derived at read time). Delivered:
   `storePhoto(buffer, mimeType, prefix) -> key` in `photo-jobs/persist.ts`, and
   `photo-pipeline.ts` keeps a same-file `persistToR2` wrapper that adds
   `getR2PublicUrl` on top. Two names for two different returns, deliberately:
   one name with two returns is how a caller starts storing the wrong half.
3. The draft read the source row with `getPhotoJob`; the job already carries
   `source_asset_id`. Delivered: a new `getPhotoAsset(id)` in `job-store.ts`
   selecting an explicit column list, so dropping `storage_key`/`provider_url`
   from the select fails a test instead of surfacing as a null inside a job.
4. The draft's `Produces` named `readOriginalBytes(asset)` on the runner; the
   delivered module is `photo-jobs/assets.ts` with `readAssetBytes` — the name
   its own mock already used.
5. Variants became a module of their own with a **real-pixel** test. The runner's
   compositor stub returns `Buffer.from('final')`, which sharp cannot decode, so
   the resize could never be exercised from `runner.test.ts`; `variants.test.ts`
   builds 1080x1350 PNGs with sharp and re-opens the output to measure width,
   height and `hasAlpha`.
6. The draft's `templateOrThrow` threw *inside* the compositing `try`, so a
   missing template would have been reported as "Compositing failed". Delivered:
   the template is resolved and checked inline before the paid calls, a stale
   `template_id` fails with a message naming both ids, and no template fails with
   `no active template` — the job is reported, not re-labelled.
7. The draft announced progress `['extracting', 20]` and `['compositing', 55]`.
   Delivered ladder is `5 / 35 / 70` and **no `ready` write**: the migration's
   `complete_photo_job` sets `status='ready', progress=100` in one statement, so
   a runner that also announced ready would put two updates on the very row the
   client is polling.
8. The draft called `completePhotoJob(job.id, finalId ?? previewId ??
   transparentId)`. That marks a job `ready` whose `final` row was refused, and
   points `result_asset_id` at a cutout. Delivered: a refused `final` row fails
   the job before any variant is written, and a refused completion says the
   composite is stored but "could not be marked ready" — an operator can tell a
   job-table fault from a portrait failure.
9. The draft read bucket bytes by presigning a URL and fetching it from itself.
   Delivered: `readR2Object(key)` in `src/lib/storage/r2.ts`, the mirror of the
   `uploadR2Object` that already exists there; `null` means the object is not
   there, and credential/network faults throw so the two stay distinguishable.
10. The draft fetched any stored `provider_url`. Delivered: only hosts on
    `allowedRemoteImageHostnames` (the same predicate `imageCompositor` uses),
    because a background job with no user in the loop reading an arbitrary URL
    from a row is an SSRF primitive. `assets.test.ts` asserts `fetch` was **not**
    called, not merely that the result was null.
11. Two test expectations were corrected against the migration and the existing
    pipeline after the draft was written: the ambiguous-moderation case is
    `cancelled` (a configured vendor's non-approval is a verdict, and
    `photo-pipeline.ts`'s `runModerationGate` already rejects everything that is
    not `approved` or `notConfigured`), and its title now says so; and
    `complete_photo_job`'s own status write removed the `['ready', 100]` entry
    from the expected progress sequence.
12. The draft's final line told the implementer to "fill the four small helpers"
    without writing them. That is a plan failure by the skill's own rule, so the
    delivered bodies above replace the skeleton; the behaviour each one was
    supposed to have is pinned by the named case in `runner.test.ts`.
### Task 7: The worker — opportunistic drain with one loop per process

**Executed 2026-11-26 as `781e2f406`** (2 files, 277 insertions) plus the
one-line follow-up `eeae7dd9d`. The section below is the delivered code, not the
draft; the draft's defects are listed after it so an executor re-deriving this
task reads the corrections instead of re-introducing them.

**Files:**
- Create: `frontend-web/src/server/photo-jobs/worker.ts`
- Test: `frontend-web/tests/unit/photo-jobs/worker.test.ts`

**Interfaces:**
- Consumes: `claimDuePhotoJobs(workerId, limit)` returning `Promise<PhotoJob[]>`,
  `reclaimStalePhotoJobs(ttlSeconds)` returning `Promise<number>`, and
  `photoJobSummary()` returning `Promise<Record<string, number>>` (Task 4);
  `runPhotoJob(job): Promise<RunOutcome>` (Task 6).
- Produces: `drainPhotoJobs(opts?: { workerId?: string; limit?: number }):
  Promise<DrainResult>` with `DrainResult = {claimed, ready, failed, cancelled,
  reclaimed, errors}`; `maybeDrainPhotoJobs(): void`; `photoQueueHealth():
  Promise<{due, locked, paused}>`. Task 8's status route and Task 9's enqueue
  path are the only callers.

- [x] **Step 1: Write the failing test** — 10 cases, delivered verbatim:

```ts
// tests/unit/photo-jobs/worker.test.ts
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
```
- [x] **Step 2: Run to verify failure.** `npx vitest run
  tests/unit/photo-jobs/worker.test.ts` → `Test Files 1 failed (1)`,
  `Tests no tests`, `Error: Cannot find package
  '@/src/server/photo-jobs/worker' imported from .../worker.test.ts`.

- [x] **Step 3: Write the worker.**

```ts
// src/server/photo-jobs/worker.ts
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
import { claimDuePhotoJobs, photoJobSummary, reclaimStalePhotoJobs } from './job-store';
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
      const outcome = await runPhotoJob(job);
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
```
- [x] **Step 4: Run to verify pass.** `npx vitest run
  tests/unit/photo-jobs/worker.test.ts` → `Test Files 1 passed (1)`,
  `Tests 10 passed (10)`. Directory run `npx vitest run tests/unit/photo-jobs/`
  → `Test Files 6 passed (6)`, `Tests 66 passed (66)` (17 runner, 16 job-store, 11 registry,
  7 assets, 5 variants, 10 worker). With the review path alongside, `npx vitest run
  tests/unit/photo-jobs/ tests/unit/registration/photo-pipeline.test.ts` → `Test Files
  7 passed (7)`, `Tests 76 passed (76)` — the 10 pipeline cases are unchanged.
  `npm run type-check` → exit 0.
  Wider run `npx vitest run tests/unit/registration tests/unit/photo-jobs` →
  `Test Files 1 failed | 39 passed (40)`, `Tests 2 failed | 328 passed (330)`; the
  two failures are `contest-admin-schedule-route.spec.ts` and reproduce on
  `origin/main` — see Task 5's note.

- [x] **Step 5: Commit** — `781e2f406 feat(photo): opportunistic sequential job drain`,
  then `eeae7dd9d refactor(photo): drop the redundant row cast in the drain loop`.

**Corrections to the draft** (what an executor would otherwise get wrong):

1. The draft's `import { runPhotoJob, type PhotoJob } from './runner'` does not
   type-check: `runner.ts` exports only `runPhotoJob` and `RunOutcome`, and
   `PhotoJob` lives in `job-store.ts`. Delivered: the rows come typed from
   `claimDuePhotoJobs`, which is `Promise<PhotoJob[]>`, so the worker imports no
   type at all and the loop variable needs no cast (that was `eeae7dd9d`).
2. The draft's batch test expected `reclaimed: 1` from a summary of
   `{queued: 3}` — but the reclaim only runs when `processing > 0`, which is the
   guard that keeps an idle queue off the RPC. The expectation could never be
   met by the code in the same draft. Delivered: the case reads
   `{queued: 3, processing: 1}` and says why in a comment.
3. The draft's overlap test called `release()` synchronously right after three
   `maybeDrainPhotoJobs()` calls. That is a false claim of progress: the promise
   handed to `claimDuePhotoJobs` is only *constructed* when the drain reaches the
   claim, so `release` was still the initialised no-op stub, the drain awaited
   forever, and the module-level `draining` latch stayed shut — the next test in
   the file then inherited a wedged worker and failed for a reason that pointed
   nowhere near its own code. Delivered: `await flush()`, a real macrotask
   (`new Promise((r) => setTimeout(r, 0))`), before asserting and before
   releasing, plus a tail that proves the latch genuinely reopened by letting a
   second drain run.
4. The draft asserted `toHaveBeenCalledTimes(0)` immediately after the three
   calls, which passes because the summary probe is async — but proves nothing
   about the guard. Delivered: assert `photoJobSummary` once and
   `claimDuePhotoJobs` once *after* the flush, which is the actual
   "three calls, one drain" property.
5. The draft's `console.error('[photo-jobs] runner threw for job', job.id)`
   printed the id and dropped the error, next to a comment saying "log loudly".
   Delivered: the exception object goes to the log too — a runner defect that
   escapes to the drain otherwise leaves a message with no stack.
6. The draft's `photoQueueHealth` let a summary fault throw. Delivered: it
   catches, warns, and answers zeros, because Task 8 renders this figure on an
   admin page and a queue readout must not fault the page.
7. The draft's `maybeDrainPhotoJobs` cleared the latch unconditionally
   (`draining = null`) from the `finally` of the drain it started. Delivered: the
   handle is named and cleared only `if (draining === running)`, and the
   rejection is swallowed on that local handle rather than on the module
   variable. Nothing in this task can currently interleave two drains, so this
   is insurance, not a fix — worth keeping because the flag is process-wide state
   and the next caller (Task 9) is a request path.
8. The draft's `beforeEach` stubbed a summary of `{queued: 0, processing: 0,
   paused: 0}`. Delivered: all five keys `photo_job_summary()` really returns, so
   a future read of `ready`/`failed` in the drain cannot be written against a
   shape the test never showed.
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
  store.getPhotoJob.mockResolvedValue({ id: 'j1', registration_id: 'r1', registration_user_id: 'u1', status: 'ready', progress: 100, attempt: 1, result_asset_id: 'a-final', last_error: null });
  store.listPhotoAssets.mockResolvedValue([{ kind: 'final', storage_key: 'contestants/composited/x.png' }]);
  const got = await GET(request(), { params: Promise.resolve({ id: 'j1' }) });
  expect(got.status).toBe(200);
  const body = await got.json();
  expect(body.job.status).toBe('ready');
  expect(body.job.assets.final).toBe('/api/contestant-photo/contestants/composited/x.png');
});

it('refuses a job whose registration the caller does not own', async () => {
  store.getPhotoJob.mockResolvedValue({ id: 'j1', registration_id: 'other', registration_user_id: 'u2', status: 'ready' });
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

The route handler needs the registration's owning user, so extend `getPhotoJob` to select `registrations(user_id)`; that join is what makes the second test a real ownership check rather than an assumed one. Both mock rows above carry `registration_user_id`, the flattened field Task 4's store produces.

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

