-- STEM growth modules foundation:
-- voting/paid-voting readiness, bootcamp depth, sponsors, certificates, badges, reporting support tables.

create table if not exists public.stem_voting_rules (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.stem_contests(id) on delete cascade,
  voting_status text not null default 'NOT_STARTED',
  voting_mode text not null default 'FREE',
  daily_vote_limit integer not null default 1,
  one_user_one_vote boolean not null default true,
  allow_paid_votes boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.stem_vote_packages (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.stem_contests(id) on delete cascade,
  name text not null,
  votes integer not null,
  amount_ngn numeric(12,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.stem_vote_transactions (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.stem_contests(id) on delete cascade,
  application_id uuid references public.stem_applications_v2(id) on delete set null,
  package_id uuid references public.stem_vote_packages(id) on delete set null,
  voter_ref text not null default '',
  payment_reference text not null default '',
  amount_ngn numeric(12,2) not null default 0,
  votes_allocated integer not null default 0,
  status text not null default 'pending',
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.stem_bootcamp_cohorts (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid references public.stem_contests(id) on delete set null,
  name text not null,
  status text not null default 'planned',
  start_date date,
  end_date date,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.stem_bootcamp_tasks (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.stem_bootcamp_cohorts(id) on delete cascade,
  title text not null,
  description text not null default '',
  day_number integer not null default 1,
  max_score numeric(10,2) not null default 100,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.stem_bootcamp_scores (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.stem_bootcamp_cohorts(id) on delete cascade,
  task_id uuid not null references public.stem_bootcamp_tasks(id) on delete cascade,
  application_id uuid not null references public.stem_applications_v2(id) on delete cascade,
  score numeric(10,2) not null default 0,
  note text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.stem_sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sponsor_type text not null default 'general',
  logo_url text not null default '',
  website_url text not null default '',
  campaign_message text not null default '',
  cta_url text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.stem_certificates (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.stem_applications_v2(id) on delete set null,
  certificate_type text not null,
  certificate_number text not null unique,
  issued_at timestamptz not null default timezone('utc', now()),
  file_url text not null default '',
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.stem_badges (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  icon_url text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.stem_badge_awards (
  id uuid primary key default gen_random_uuid(),
  badge_id uuid not null references public.stem_badges(id) on delete cascade,
  application_id uuid references public.stem_applications_v2(id) on delete set null,
  awarded_at timestamptz not null default timezone('utc', now()),
  note text not null default ''
);

create index if not exists idx_stem_voting_rules_contest on public.stem_voting_rules(contest_id);
create index if not exists idx_stem_vote_packages_contest on public.stem_vote_packages(contest_id, is_active);
create index if not exists idx_stem_vote_tx_contest on public.stem_vote_transactions(contest_id, created_at desc);
create index if not exists idx_stem_bootcamp_cohorts_contest on public.stem_bootcamp_cohorts(contest_id, status);
create index if not exists idx_stem_bootcamp_tasks_cohort on public.stem_bootcamp_tasks(cohort_id, day_number);
create index if not exists idx_stem_bootcamp_scores_cohort on public.stem_bootcamp_scores(cohort_id, application_id);
create index if not exists idx_stem_certificates_application on public.stem_certificates(application_id, issued_at desc);
create index if not exists idx_stem_badge_awards_application on public.stem_badge_awards(application_id, awarded_at desc);

