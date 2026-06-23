-- Spotlight STEM admin-configurable contest system foundation
-- Supports: contest builder, categories, price categories, prize categories,
-- school onboarding, school join approval flow, configurable applications.

create extension if not exists pgcrypto;

create table if not exists public.stem_contest_configs (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.stem_contests(id) on delete cascade,
  season text not null,
  subtitle text,
  objective text,
  organizer text,
  partner_sponsor text,
  contest_status text not null default 'DRAFT',
  contest_visibility text not null default 'PUBLIC',
  terms_and_conditions text,
  privacy_note text,
  faq text,
  support_contact text,
  tracks_allowed text[] not null default '{}',
  track_rules jsonb not null default '{}'::jsonb,
  eligibility_rules jsonb not null default '{}'::jsonb,
  required_documents text[] not null default '{}',
  required_uploads text[] not null default '{}',
  required_project_fields jsonb not null default '[]'::jsonb,
  team_rules jsonb not null default '{}'::jsonb,
  judging_rules jsonb not null default '{}'::jsonb,
  voting_rules jsonb not null default '{}'::jsonb,
  showcase_rules jsonb not null default '{}'::jsonb,
  reporting_rules jsonb not null default '{}'::jsonb,
  registration_open_at timestamptz,
  registration_close_at timestamptz,
  voting_open_at timestamptz,
  voting_close_at timestamptz,
  public_profile_enabled boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(contest_id)
);

create table if not exists public.stem_contest_categories (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.stem_contests(id) on delete cascade,
  category_name text not null,
  category_description text,
  category_icon text,
  category_banner text,
  eligible_tracks text[] not null default '{}',
  eligible_age_min integer,
  eligible_age_max integer,
  eligible_school_levels text[] not null default '{}',
  eligible_project_stages text[] not null default '{}',
  required_uploads text[] not null default '{}',
  required_questions jsonb not null default '[]'::jsonb,
  judging_criteria jsonb not null default '[]'::jsonb,
  score_weight_pct numeric(7,2),
  sponsor_name text,
  max_applicants integer,
  max_finalists integer,
  is_public_profile_visible boolean not null default true,
  category_rules text,
  safety_requirements text,
  status text not null default 'ACTIVE',
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.stem_price_categories (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.stem_contests(id) on delete cascade,
  category_name text not null,
  description text,
  applies_to_tracks text[] not null default '{}',
  applies_to_applicant_types text[] not null default '{}',
  applies_to_school_types text[] not null default '{}',
  applies_to_states text[] not null default '{}',
  currency text not null default 'NGN',
  amount numeric(12,2) not null default 0,
  early_bird_amount numeric(12,2),
  late_fee_amount numeric(12,2),
  starts_at timestamptz,
  ends_at timestamptz,
  payment_required_before_submission boolean not null default false,
  payment_required_after_shortlisting boolean not null default false,
  payment_required_before_demo_day boolean not null default false,
  refund_policy text,
  discount_code_enabled boolean not null default false,
  waiver_code_enabled boolean not null default false,
  sponsor_code_enabled boolean not null default false,
  max_applicants integer,
  is_publicly_visible boolean not null default true,
  is_admin_only boolean not null default false,
  status text not null default 'ACTIVE',
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.stem_prize_categories (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.stem_contests(id) on delete cascade,
  prize_title text not null,
  prize_description text,
  prize_type text not null,
  prize_value text,
  cash_prize_amount numeric(12,2),
  non_cash_prize_description text,
  sponsor_name text,
  eligible_tracks text[] not null default '{}',
  number_of_winners integer not null default 1,
  selection_criteria text,
  is_publicly_visible boolean not null default true,
  terms text,
  disbursement_condition text,
  verification_required_before_award boolean not null default true,
  status text not null default 'ACTIVE',
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.stem_school_join_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.stem_schools(id) on delete cascade,
  student_user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  student_id text,
  class_level text,
  department text,
  student_id_upload_url text,
  admission_letter_upload_url text,
  mentor_name text,
  request_note text,
  status text not null default 'PENDING',
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.stem_contest_applications (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.stem_contests(id) on delete cascade,
  application_reference text not null unique,
  applicant_user_id uuid references auth.users(id) on delete set null,
  school_id uuid references public.stem_schools(id) on delete set null,
  school_join_request_id uuid references public.stem_school_join_requests(id) on delete set null,
  applicant_type text not null,
  participation_track text not null,
  category_id uuid references public.stem_contest_categories(id) on delete set null,
  price_category_id uuid references public.stem_price_categories(id) on delete set null,
  state text,
  project_stage text,
  payment_status text not null default 'PENDING',
  verification_status text,
  application_status text not null default 'DRAFT',
  public_profile_status text not null default 'HIDDEN',
  score numeric(8,2),
  safety_flag text,
  voting_status text,
  form_answers jsonb not null default '{}'::jsonb,
  project_payload jsonb not null default '{}'::jsonb,
  upload_payload jsonb not null default '{}'::jsonb,
  safety_payload jsonb not null default '{}'::jsonb,
  fraud_payload jsonb not null default '{}'::jsonb,
  admin_notes text,
  submitted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.stem_application_status_history (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.stem_contest_applications(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_stem_contest_configs_contest_id on public.stem_contest_configs(contest_id);
create index if not exists idx_stem_contest_categories_contest_id on public.stem_contest_categories(contest_id);
create index if not exists idx_stem_price_categories_contest_id on public.stem_price_categories(contest_id);
create index if not exists idx_stem_prize_categories_contest_id on public.stem_prize_categories(contest_id);
create index if not exists idx_stem_school_join_requests_school_id on public.stem_school_join_requests(school_id);
create index if not exists idx_stem_school_join_requests_status on public.stem_school_join_requests(status);
create index if not exists idx_stem_contest_applications_contest_id on public.stem_contest_applications(contest_id);
create index if not exists idx_stem_contest_applications_school_id on public.stem_contest_applications(school_id);
create index if not exists idx_stem_contest_applications_status on public.stem_contest_applications(application_status);
create index if not exists idx_stem_contest_applications_applicant_type on public.stem_contest_applications(applicant_type);
create index if not exists idx_stem_contest_applications_track on public.stem_contest_applications(participation_track);
create index if not exists idx_stem_contest_applications_payment_status on public.stem_contest_applications(payment_status);
create index if not exists idx_stem_contest_applications_public_profile_status on public.stem_contest_applications(public_profile_status);
create index if not exists idx_stem_application_status_history_application_id on public.stem_application_status_history(application_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_stem_contest_configs_updated_at on public.stem_contest_configs;
create trigger trg_stem_contest_configs_updated_at
before update on public.stem_contest_configs
for each row execute function public.touch_updated_at();

drop trigger if exists trg_stem_contest_categories_updated_at on public.stem_contest_categories;
create trigger trg_stem_contest_categories_updated_at
before update on public.stem_contest_categories
for each row execute function public.touch_updated_at();

drop trigger if exists trg_stem_price_categories_updated_at on public.stem_price_categories;
create trigger trg_stem_price_categories_updated_at
before update on public.stem_price_categories
for each row execute function public.touch_updated_at();

drop trigger if exists trg_stem_prize_categories_updated_at on public.stem_prize_categories;
create trigger trg_stem_prize_categories_updated_at
before update on public.stem_prize_categories
for each row execute function public.touch_updated_at();

drop trigger if exists trg_stem_school_join_requests_updated_at on public.stem_school_join_requests;
create trigger trg_stem_school_join_requests_updated_at
before update on public.stem_school_join_requests
for each row execute function public.touch_updated_at();

drop trigger if exists trg_stem_contest_applications_updated_at on public.stem_contest_applications;
create trigger trg_stem_contest_applications_updated_at
before update on public.stem_contest_applications
for each row execute function public.touch_updated_at();

alter table public.stem_contest_configs enable row level security;
alter table public.stem_contest_categories enable row level security;
alter table public.stem_price_categories enable row level security;
alter table public.stem_prize_categories enable row level security;
alter table public.stem_school_join_requests enable row level security;
alter table public.stem_contest_applications enable row level security;
alter table public.stem_application_status_history enable row level security;

-- Baseline RLS policies (tighten with project auth roles before production).
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='stem_contest_configs' and policyname='stem_contest_configs_select'
  ) then
    create policy stem_contest_configs_select on public.stem_contest_configs for select using (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='stem_contest_categories' and policyname='stem_contest_categories_select'
  ) then
    create policy stem_contest_categories_select on public.stem_contest_categories for select using (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='stem_price_categories' and policyname='stem_price_categories_select'
  ) then
    create policy stem_price_categories_select on public.stem_price_categories for select using (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='stem_prize_categories' and policyname='stem_prize_categories_select'
  ) then
    create policy stem_prize_categories_select on public.stem_prize_categories for select using (true);
  end if;
end $$;

comment on table public.stem_contest_configs is
  'Admin-configurable contest settings for STEM contests. Legal and policy text must be reviewed by legal counsel before public launch.';
