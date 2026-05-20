-- Spotlight STEM multi-track registration foundation
-- Supports school-based STEM + open/public hackathon and IT contest flows.

create extension if not exists pgcrypto;

create table if not exists public.stem_challenge_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  challenge_type text not null,
  is_school_required boolean not null default false,
  team_allowed boolean not null default true,
  team_size_min integer not null default 1,
  team_size_max integer not null default 10,
  mentor_required boolean not null default false,
  school_verification_required boolean not null default false,
  guardian_consent_required_if_minor boolean not null default true,
  repo_required boolean not null default false,
  design_file_required boolean not null default false,
  demo_required boolean not null default false,
  pitch_required boolean not null default false,
  min_age integer,
  max_age integer,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stem_applications_v2 (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  application_code text unique,
  entry_route text not null,
  challenge_template_id uuid references public.stem_challenge_templates(id) on delete set null,
  challenge_type text not null,
  category_track text not null,
  participation_mode text not null check (participation_mode in ('individual', 'team')),
  applicant_role text not null,
  applicant_type text,
  is_minor boolean not null default false,
  profile_photo_url text,
  applicant_profile jsonb not null default '{}'::jsonb,
  school_info jsonb not null default '{}'::jsonb,
  guardian_info jsonb not null default '{}'::jsonb,
  mentor_advisor_info jsonb not null default '{}'::jsonb,
  team_info jsonb not null default '{}'::jsonb,
  project_solution jsonb not null default '{}'::jsonb,
  uploads_artifacts jsonb not null default '{}'::jsonb,
  risk_ethics jsonb not null default '{}'::jsonb,
  logistics jsonb not null default '{}'::jsonb,
  motivation_readiness jsonb not null default '{}'::jsonb,
  declarations jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  review_stage text not null default 'intake',
  completion_percent integer not null default 0,
  source_channel text not null default 'web',
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stem_team_members_v2 (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.stem_applications_v2(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  role_label text,
  is_team_lead boolean not null default false,
  profile_photo_url text,
  completion_percent integer not null default 0,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stem_artifacts_v2 (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.stem_applications_v2(id) on delete cascade,
  artifact_type text not null,
  artifact_url text,
  file_name text,
  mime_type text,
  file_size_bytes bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.stem_consent_records_v2 (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.stem_applications_v2(id) on delete cascade,
  consent_type text not null,
  status text not null default 'pending',
  signed_by_name text,
  signed_by_email text,
  signed_by_phone text,
  signed_at timestamptz,
  evidence_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stem_review_scores_v2 (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.stem_applications_v2(id) on delete cascade,
  reviewer_id uuid references auth.users(id) on delete set null,
  innovation_score numeric(5,2),
  problem_solution_fit_score numeric(5,2),
  technical_depth_score numeric(5,2),
  execution_score numeric(5,2),
  impact_score numeric(5,2),
  readiness_score numeric(5,2),
  compliance_score numeric(5,2),
  overall_score numeric(5,2),
  notes text,
  tags text[] default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stem_status_history_v2 (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.stem_applications_v2(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_id uuid references auth.users(id) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_stem_applications_v2_status on public.stem_applications_v2(status);
create index if not exists idx_stem_applications_v2_challenge_type on public.stem_applications_v2(challenge_type);
create index if not exists idx_stem_applications_v2_category_track on public.stem_applications_v2(category_track);
create index if not exists idx_stem_applications_v2_entry_route on public.stem_applications_v2(entry_route);
create index if not exists idx_stem_applications_v2_created_at on public.stem_applications_v2(created_at desc);
create index if not exists idx_stem_team_members_v2_application_id on public.stem_team_members_v2(application_id);
create index if not exists idx_stem_artifacts_v2_application_id on public.stem_artifacts_v2(application_id);
create index if not exists idx_stem_consent_records_v2_application_id on public.stem_consent_records_v2(application_id);
create index if not exists idx_stem_review_scores_v2_application_id on public.stem_review_scores_v2(application_id);
create index if not exists idx_stem_status_history_v2_application_id on public.stem_status_history_v2(application_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_stem_challenge_templates_updated_at on public.stem_challenge_templates;
create trigger trg_stem_challenge_templates_updated_at
before update on public.stem_challenge_templates
for each row execute function public.set_updated_at();

drop trigger if exists trg_stem_applications_v2_updated_at on public.stem_applications_v2;
create trigger trg_stem_applications_v2_updated_at
before update on public.stem_applications_v2
for each row execute function public.set_updated_at();

drop trigger if exists trg_stem_team_members_v2_updated_at on public.stem_team_members_v2;
create trigger trg_stem_team_members_v2_updated_at
before update on public.stem_team_members_v2
for each row execute function public.set_updated_at();

drop trigger if exists trg_stem_consent_records_v2_updated_at on public.stem_consent_records_v2;
create trigger trg_stem_consent_records_v2_updated_at
before update on public.stem_consent_records_v2
for each row execute function public.set_updated_at();

drop trigger if exists trg_stem_review_scores_v2_updated_at on public.stem_review_scores_v2;
create trigger trg_stem_review_scores_v2_updated_at
before update on public.stem_review_scores_v2
for each row execute function public.set_updated_at();
