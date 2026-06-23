-- ─────────────────────────────────────────────────────────────────────────────
-- LEADERBOARD-1 — previous-rank / rank-history snapshots (ADDITIVE ONLY)
--
-- Stores immutable, append-only snapshots of the leaderboard rank ordering per
-- contest so the leaderboard endpoint can compute rankChange (up/down/same/new)
-- without ever touching the protected voting-module internals. Each snapshot is
-- one row: a JSONB { participant_id -> rank_position } map captured at read time.
--
-- Append-only by design: no UPDATE path, corrections are new snapshot rows.
-- No DROP, no column rename, no type narrowing — safe to replay.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists stem_leaderboard_rank_snapshots (
  id          uuid primary key default gen_random_uuid(),
  contest_id  text        not null,
  -- { "<participant_id>": <rank_position:int>, ... }
  ranks       jsonb       not null default '{}'::jsonb,
  captured_at timestamptz not null default now()
);

-- Fast "latest snapshot for this contest" lookup (order by captured_at desc).
create index if not exists idx_stem_rank_snapshots_contest_time
  on stem_leaderboard_rank_snapshots (contest_id, captured_at desc);

-- RLS: snapshots are derived projections; only the service role writes/reads
-- them via the Go backend. Enable RLS and add a service-role policy (additive).
alter table stem_leaderboard_rank_snapshots enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'stem_leaderboard_rank_snapshots'
      and policyname = 'stem_rank_snapshots_service_all'
  ) then
    create policy stem_rank_snapshots_service_all
      on stem_leaderboard_rank_snapshots
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;
