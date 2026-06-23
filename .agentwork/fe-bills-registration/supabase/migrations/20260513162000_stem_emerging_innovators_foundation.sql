-- STEM Emerging Future Innovators onboarding foundation

create extension if not exists pgcrypto;

create table if not exists public.stem_emerging_innovators (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text,
  country text default 'Nigeria',
  state text,
  lga_city text,
  education_background text,
  current_status text,
  stem_skill_area text,
  innovation_track text,
  portfolio_url text,
  linkedin_url text,
  github_url text,
  social_links jsonb not null default '{}'::jsonb,
  business_name text,
  team_name text,
  prototype_available boolean not null default false,
  pitch_deck_url text,
  video_demo_url text,
  photo_url text,
  id_verification_url text,
  verification_status text not null default 'PENDING',
  verification_notes text,
  submitted_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_stem_emerging_innovators_email on public.stem_emerging_innovators(lower(email));
create index if not exists idx_stem_emerging_innovators_state on public.stem_emerging_innovators(state);
create index if not exists idx_stem_emerging_innovators_status on public.stem_emerging_innovators(verification_status);
create index if not exists idx_stem_emerging_innovators_created_at on public.stem_emerging_innovators(created_at desc);

create or replace function public.set_stem_emerging_innovators_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_stem_emerging_innovators_updated_at on public.stem_emerging_innovators;
create trigger trg_stem_emerging_innovators_updated_at
before update on public.stem_emerging_innovators
for each row execute function public.set_stem_emerging_innovators_updated_at();
