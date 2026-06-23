-- STEM judging rubric and judge assignment foundation

create table if not exists public.stem_judging_rubrics (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.stem_contests(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.stem_judging_criteria (
  id uuid primary key default gen_random_uuid(),
  rubric_id uuid not null references public.stem_judging_rubrics(id) on delete cascade,
  criterion_key text not null,
  label text not null,
  weight_pct numeric(7,2) not null default 0,
  max_score numeric(10,2) not null default 100,
  description text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.stem_judge_assignments (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.stem_contests(id) on delete cascade,
  application_id uuid not null references public.stem_applications_v2(id) on delete cascade,
  judge_user_id text not null,
  status text not null default 'assigned',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists uq_stem_judging_criteria_rubric_key
  on public.stem_judging_criteria(rubric_id, criterion_key);

create unique index if not exists uq_stem_judge_assignment_unique
  on public.stem_judge_assignments(contest_id, application_id, judge_user_id);

create index if not exists idx_stem_judging_rubrics_contest_id
  on public.stem_judging_rubrics(contest_id);
create index if not exists idx_stem_judging_criteria_rubric_id
  on public.stem_judging_criteria(rubric_id);
create index if not exists idx_stem_judge_assignments_contest_id
  on public.stem_judge_assignments(contest_id);
create index if not exists idx_stem_judge_assignments_application_id
  on public.stem_judge_assignments(application_id);
create index if not exists idx_stem_judge_assignments_judge_user_id
  on public.stem_judge_assignments(judge_user_id);

create or replace function public.set_stem_judging_rubrics_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.set_stem_judging_criteria_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.set_stem_judge_assignments_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_stem_judging_rubrics_updated_at on public.stem_judging_rubrics;
create trigger trg_stem_judging_rubrics_updated_at
before update on public.stem_judging_rubrics
for each row execute function public.set_stem_judging_rubrics_updated_at();

drop trigger if exists trg_stem_judging_criteria_updated_at on public.stem_judging_criteria;
create trigger trg_stem_judging_criteria_updated_at
before update on public.stem_judging_criteria
for each row execute function public.set_stem_judging_criteria_updated_at();

drop trigger if exists trg_stem_judge_assignments_updated_at on public.stem_judge_assignments;
create trigger trg_stem_judge_assignments_updated_at
before update on public.stem_judge_assignments
for each row execute function public.set_stem_judge_assignments_updated_at();

