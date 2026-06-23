-- STEM Emerging team/project link foundation

create extension if not exists pgcrypto;

create table if not exists public.stem_emerging_teams (
  id uuid primary key default gen_random_uuid(),
  innovator_id uuid not null references public.stem_emerging_innovators(id) on delete cascade,
  team_name text not null,
  innovation_track text,
  team_size integer not null default 1,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stem_emerging_projects (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.stem_emerging_teams(id) on delete cascade,
  project_title text not null,
  category text,
  problem_statement text,
  proposed_solution text,
  status text not null default 'DRAFT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_stem_emerging_teams_innovator_id on public.stem_emerging_teams(innovator_id);
create index if not exists idx_stem_emerging_teams_created_at on public.stem_emerging_teams(created_at desc);
create index if not exists idx_stem_emerging_projects_team_id on public.stem_emerging_projects(team_id);
create index if not exists idx_stem_emerging_projects_created_at on public.stem_emerging_projects(created_at desc);

create or replace function public.set_stem_emerging_teams_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_stem_emerging_teams_updated_at on public.stem_emerging_teams;
create trigger trg_stem_emerging_teams_updated_at
before update on public.stem_emerging_teams
for each row execute function public.set_stem_emerging_teams_updated_at();

create or replace function public.set_stem_emerging_projects_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_stem_emerging_projects_updated_at on public.stem_emerging_projects;
create trigger trg_stem_emerging_projects_updated_at
before update on public.stem_emerging_projects
for each row execute function public.set_stem_emerging_projects_updated_at();
