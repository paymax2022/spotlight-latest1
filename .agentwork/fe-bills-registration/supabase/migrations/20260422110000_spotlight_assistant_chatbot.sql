-- Spotlight Assistant core tables

create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  anonymous_id text,
  user_id uuid null,
  page_context text not null,
  initial_url text,
  referrer text,
  user_agent text,
  locale text,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  ended_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role text not null check (role in ('user','assistant','system','tool')),
  message_text text,
  message_json jsonb,
  intent text,
  confidence numeric(5,4),
  page_context text,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_messages_session_id on public.chat_messages(session_id);
create index if not exists idx_chat_messages_created_at on public.chat_messages(created_at);

create table if not exists public.chat_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  event_name text not null,
  event_payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_events_session_id on public.chat_events(session_id);
create index if not exists idx_chat_events_event_name on public.chat_events(event_name);

create table if not exists public.lead_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.chat_sessions(id) on delete set null,
  lead_type text not null check (lead_type in ('applicant','sponsor','support')),
  status text not null default 'new',
  score integer not null default 0,
  source_page text,
  name text,
  email text,
  phone text,
  notes text,
  transcript_excerpt text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sponsor_leads (
  id uuid primary key default gen_random_uuid(),
  lead_record_id uuid not null references public.lead_records(id) on delete cascade,
  company_name text not null,
  contact_role text,
  industry text,
  interest_area text,
  budget_band text,
  desired_timeline text,
  followup_preference text,
  extra_payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.applicant_leads (
  id uuid primary key default gen_random_uuid(),
  lead_record_id uuid not null references public.lead_records(id) on delete cascade,
  program_interest text not null,
  age_band text,
  state text,
  team_or_individual text,
  stage_of_interest text,
  extra_payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.handoff_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  lead_record_id uuid references public.lead_records(id) on delete set null,
  handoff_type text not null check (handoff_type in ('email','whatsapp','callback')),
  destination text,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  resolved_at timestamptz null
);

create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  domain text not null,
  title text not null,
  version text not null,
  source_type text not null,
  visibility text not null check (visibility in ('public','internal')),
  storage_url text,
  external_file_id text,
  status text not null default 'active',
  created_by uuid null,
  created_at timestamptz not null default now(),
  archived_at timestamptz null
);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
