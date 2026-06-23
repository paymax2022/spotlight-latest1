-- STEM school profile links (admin/teacher/student) and team foundation

create extension if not exists pgcrypto;

create table if not exists public.stem_school_profiles (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.stem_schools(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  role_type text not null check (role_type in ('SCHOOL_ADMIN','TEACHER_COACH','STUDENT_CONTESTANT')),
  full_name text,
  email text,
  phone text,
  grade_level text,
  specialization text,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stem_school_teams (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.stem_schools(id) on delete cascade,
  team_name text not null,
  contest_category text,
  coach_name text,
  project_title text,
  team_size integer not null default 1,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_stem_school_profiles_school_id on public.stem_school_profiles(school_id);
create index if not exists idx_stem_school_profiles_role_type on public.stem_school_profiles(role_type);
create index if not exists idx_stem_school_profiles_created_at on public.stem_school_profiles(created_at desc);
create index if not exists idx_stem_school_teams_school_id on public.stem_school_teams(school_id);
create index if not exists idx_stem_school_teams_created_at on public.stem_school_teams(created_at desc);

create or replace function public.set_stem_school_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_stem_school_profiles_updated_at on public.stem_school_profiles;
create trigger trg_stem_school_profiles_updated_at
before update on public.stem_school_profiles
for each row execute function public.set_stem_school_profiles_updated_at();

create or replace function public.set_stem_school_teams_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_stem_school_teams_updated_at on public.stem_school_teams;
create trigger trg_stem_school_teams_updated_at
before update on public.stem_school_teams
for each row execute function public.set_stem_school_teams_updated_at();
