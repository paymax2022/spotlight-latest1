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

-- The original is the one asset the whole feature exists to protect, and this is
-- where that rule lives: in the database, not in a JS convention.
--
-- The guard refuses the mutations that would break the promise, and only those:
--
--   UPDATE that changes any content-bearing or derivation-bearing column  -> no.
--   UPDATE that only touches an FK this table points at with ON DELETE SET
--     NULL (contestant_id, template_id)                                   -> yes,
--     because that is Postgres' own cascade when a contestant or a template is
--     deleted. A blanket "no UPDATE ever" would make those unrelated deletions
--     fail, which is a production regression disguised as a safety rule.
--   DELETE of a kind=original row that someone reached for directly        -> no.
--   DELETE of a kind=original row arriving as a cascade from registrations
--     (retention: the application is gone, so its photo must go too)       -> yes.
--   DELETE of a derived row                                                -> yes.
--
-- pg_trigger_depth() separates the two delete paths; measured in this database,
-- a direct DELETE fires the row trigger at depth 1 and an FK cascade at depth 2.
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
  if tg_op = 'UPDATE' then
    if new.kind             is distinct from old.kind
       or new.storage_key   is distinct from old.storage_key
       or new.provider_url  is distinct from old.provider_url
       or new.content_type  is distinct from old.content_type
       or new.width         is distinct from old.width
       or new.height        is distinct from old.height
       or new.bytes         is distinct from old.bytes
       or new.render_params is distinct from old.render_params
       or new.template_version is distinct from old.template_version
       or new.registration_id is distinct from old.registration_id
       or new.contest_id    is distinct from old.contest_id then
      raise exception 'contest_photo_assets % is append-only: its bytes and derivation are immutable', old.id
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if old.kind = 'original' and pg_trigger_depth() <= 1 then
    raise exception 'contest_photo_assets % kind=original may not be deleted directly', old.id
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
-- arrives as the service role, so service_role is the only executor. This was
-- originally `to authenticated` as well, and the live spec caught it being
-- wrong twice over: an anonymous visitor was refused (so the grant proved
-- nothing for the path it claimed to serve), and leaving authenticated in would
-- have handed every logged-in contestant a direct RPC that reports other
-- contests' queue depth -- a permission with no designed caller in P1, exactly
-- what the deny-all-by-omission table policies above refuse to grant. Widening
-- it is a P4 decision, made against the editor that actually polls.
revoke all on function public.photo_job_config_summary() from public, anon, authenticated;
grant execute on function public.photo_job_config_summary() to service_role;
