-- STEM School onboarding and verification foundation

create extension if not exists pgcrypto;

create table if not exists public.stem_schools (
  id uuid primary key default gen_random_uuid(),
  school_name text not null,
  school_type text,
  ownership_type text,
  education_level text,
  country text default 'Nigeria',
  state text,
  lga_city text,
  address text,
  official_email text,
  official_phone text,
  website text,
  principal_name text,
  school_admin_name text,
  school_admin_email text,
  school_admin_phone text,
  number_of_students integer,
  has_stem_club boolean default false,
  has_stem_teacher boolean default false,
  school_logo_url text,
  registration_document_url text,
  accreditation_document_url text,
  social_links jsonb not null default '{}'::jsonb,
  preferred_contest_category text,
  verification_status text not null default 'PENDING',
  verification_notes text,
  submitted_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stem_school_verifications (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.stem_schools(id) on delete cascade,
  previous_status text,
  new_status text not null,
  reason text,
  actor_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_stem_schools_state on public.stem_schools(state);
create index if not exists idx_stem_schools_status on public.stem_schools(verification_status);
create index if not exists idx_stem_schools_created_at on public.stem_schools(created_at desc);
create index if not exists idx_stem_school_verifications_school_id on public.stem_school_verifications(school_id);

create or replace function public.set_stem_schools_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_stem_schools_updated_at on public.stem_schools;
create trigger trg_stem_schools_updated_at
before update on public.stem_schools
for each row execute function public.set_stem_schools_updated_at();
