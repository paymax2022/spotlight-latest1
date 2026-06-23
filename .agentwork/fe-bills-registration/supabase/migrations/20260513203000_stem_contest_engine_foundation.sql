-- STEM contest engine foundation (channel-aware eligibility)

create extension if not exists pgcrypto;

create table if not exists public.stem_contests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  contest_type text,
  contest_mode text,
  eligible_participant_types text[] not null default '{}',
  eligible_school_levels text[] not null default '{}',
  eligible_states text[] not null default '{}',
  status text not null default 'DRAFT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_stem_contests_status on public.stem_contests(status);
create index if not exists idx_stem_contests_created_at on public.stem_contests(created_at desc);

create or replace function public.set_stem_contests_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_stem_contests_updated_at on public.stem_contests;
create trigger trg_stem_contests_updated_at
before update on public.stem_contests
for each row execute function public.set_stem_contests_updated_at();
