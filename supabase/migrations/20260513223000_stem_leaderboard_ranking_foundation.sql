-- STEM leaderboard and ranking foundation

alter table if exists public.stem_contests
  add column if not exists allow_mixed_channels boolean not null default false,
  add column if not exists ranking_formula text;

create table if not exists public.stem_leaderboard_entries (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.stem_contests(id) on delete cascade,
  participant_id text not null,
  participant_type text not null,
  display_name text not null,
  judge_score numeric(10,2) not null default 0,
  vote_score numeric(10,2) not null default 0,
  stage_score numeric(10,2) not null default 0,
  final_score numeric(10,2) not null default 0,
  rank_position integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_stem_leaderboard_contest_rank on public.stem_leaderboard_entries(contest_id, rank_position);
create index if not exists idx_stem_leaderboard_contest_score on public.stem_leaderboard_entries(contest_id, final_score desc);

create or replace function public.set_stem_leaderboard_entries_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_stem_leaderboard_entries_updated_at on public.stem_leaderboard_entries;
create trigger trg_stem_leaderboard_entries_updated_at
before update on public.stem_leaderboard_entries
for each row execute function public.set_stem_leaderboard_entries_updated_at();
