-- Applicant dashboard core: profile enrichment, notifications, and cross-service status history

alter table public.user_profiles
  add column if not exists avatar_url text,
  add column if not exists date_of_birth date,
  add column if not exists lga text,
  add column if not exists address text,
  add column if not exists preferences jsonb not null default '{}'::jsonb,
  add column if not exists profile_completion integer not null default 0;

create table if not exists public.applicant_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  service_type text,
  application_id text,
  title text not null,
  message text not null,
  type text not null default 'info',
  is_read boolean not null default false,
  link text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table if not exists public.application_status_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  service_type text not null,
  application_id text not null,
  application_reference text,
  old_status text,
  new_status text not null,
  note text,
  next_action text,
  metadata jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_applicant_notifications_user_created
  on public.applicant_notifications(user_id, created_at desc);
create index if not exists idx_applicant_notifications_user_is_read
  on public.applicant_notifications(user_id, is_read);

create index if not exists idx_application_status_history_user_created
  on public.application_status_history(user_id, created_at desc);
create index if not exists idx_application_status_history_service_app
  on public.application_status_history(service_type, application_id);

alter table public.applicant_notifications enable row level security;
alter table public.application_status_history enable row level security;

drop policy if exists "applicant_notifications_owner_select" on public.applicant_notifications;
create policy "applicant_notifications_owner_select"
on public.applicant_notifications
for select
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.user_profiles up
    where up.id = auth.uid() and up.role = 'admin'
  )
);

drop policy if exists "applicant_notifications_owner_update" on public.applicant_notifications;
create policy "applicant_notifications_owner_update"
on public.applicant_notifications
for update
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.user_profiles up
    where up.id = auth.uid() and up.role = 'admin'
  )
)
with check (
  user_id = auth.uid()
  or exists (
    select 1 from public.user_profiles up
    where up.id = auth.uid() and up.role = 'admin'
  )
);

drop policy if exists "application_status_history_owner_select" on public.application_status_history;
create policy "application_status_history_owner_select"
on public.application_status_history
for select
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.user_profiles up
    where up.id = auth.uid() and up.role = 'admin'
  )
);
