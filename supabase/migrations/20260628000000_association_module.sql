-- ─────────────────────────────────────────────────────────────────────────────
-- Association / Group Membership module — additive schema
-- Spec: contracts/associations.openapi.yaml  ·  Client: src/features/association
--
-- IRON RULES honoured:
--   • ADDITIVE ONLY — every statement is CREATE ... IF NOT EXISTS / ADD COLUMN
--     IF NOT EXISTS. No DROP, no rename, no type narrowing.
--   • All monetary columns are BIGINT in minor units (kobo).
--   • Feature-flagged at the app layer (EXPO_PUBLIC_ASSOCIATION_USE_MOCK); this
--     migration only creates tables and is safe to apply ahead of the rollout.
--   • Money mutations (dues payments, offline-payment approvals) post to the
--     existing double-entry ledger — no balance columns are mutated here.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Organisation graph ──────────────────────────────────────────────────────
create table if not exists assoc_organisations (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  acronym                text,
  category               text not null,
  description            text,
  logo_url               text,
  cover_url              text,
  group_type             text not null default 'CLOSED'
                           check (group_type in ('OPEN','CLOSED','INVITE_ONLY','CODE_BASED','PAID')),
  approval_rule          text not null default 'ADMIN'
                           check (approval_rule in ('AUTO','ADMIN','CHAPTER_THEN_NATIONAL','PAYMENT_FIRST')),
  registration_fee_kobo  bigint not null default 0,
  requires_payment       boolean not null default false,
  founded_year           int,
  location               text,
  website                text,
  verified               boolean not null default false,
  published              boolean not null default false,
  created_by             uuid,
  created_at             timestamptz not null default now()
);

create table if not exists assoc_chapters (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references assoc_organisations(id),
  name            text not null,
  level           text not null check (level in ('REGION','ZONE','STATE','LOCAL','BRANCH')),
  parent_id       uuid references assoc_chapters(id),
  created_at      timestamptz not null default now()
);
create index if not exists idx_assoc_chapters_org on assoc_chapters(organisation_id);

create table if not exists assoc_committees (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references assoc_organisations(id),
  name            text not null,
  purpose         text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_assoc_committees_org on assoc_committees(organisation_id);

create table if not exists assoc_membership_categories (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references assoc_organisations(id),
  label           text not null,
  description     text,
  dues_kobo       bigint not null default 0,
  cadence         text not null default 'ANNUAL'
                    check (cadence in ('ONE_OFF','MONTHLY','QUARTERLY','ANNUAL','LIFETIME')),
  created_at      timestamptz not null default now()
);

-- ── Membership ──────────────────────────────────────────────────────────────
create table if not exists assoc_memberships (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references assoc_organisations(id),
  user_id         uuid not null,
  member_code     text,                          -- formatted member ID, e.g. NMA/LA/2024/0192
  category_id     uuid references assoc_membership_categories(id),
  chapter_id      uuid references assoc_chapters(id),
  status          text not null default 'PENDING'
                    check (status in ('DRAFT','PENDING','ACTIVE','INACTIVE','SUSPENDED','EXPIRED','RESTRICTED','REJECTED','REMOVED')),
  payment_standing text not null default 'DUE'
                    check (payment_standing in ('PAID','DUE','OVERDUE')),
  verified        boolean not null default false,
  valid_through   timestamptz,
  joined_at       timestamptz,
  created_at      timestamptz not null default now(),
  unique (organisation_id, user_id)
);
create index if not exists idx_assoc_memberships_org_status on assoc_memberships(organisation_id, status);
create index if not exists idx_assoc_memberships_user on assoc_memberships(user_id);

create table if not exists assoc_member_profiles (
  membership_id   uuid primary key references assoc_memberships(id),
  full_name       text,
  photo_url       text,
  email           text,
  phone           text,
  profession      text,
  location        text,
  dob             date,
  bio             text,
  emergency       jsonb not null default '{}'::jsonb,
  next_of_kin     jsonb not null default '{}'::jsonb,
  contact_restricted boolean not null default false,
  privacy         jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now()
);

create table if not exists assoc_member_roles (
  id              uuid primary key default gen_random_uuid(),
  membership_id   uuid not null references assoc_memberships(id),
  role            text not null
                    check (role in ('NONE','CHAPTER_ADMIN','FINANCE_ADMIN','SECRETARY','NATIONAL_ADMIN','SUPER_ADMIN')),
  jurisdiction    text not null default 'CHAPTER',
  granted_by      uuid,
  granted_at      timestamptz not null default now()
);
create index if not exists idx_assoc_member_roles_membership on assoc_member_roles(membership_id);

create table if not exists assoc_applications (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references assoc_organisations(id),
  user_id         uuid not null,
  category_id     uuid references assoc_membership_categories(id),
  chapter_id      uuid references assoc_chapters(id),
  sponsor_name    text,
  documents       jsonb not null default '[]'::jsonb,
  status          text not null default 'PENDING'
                    check (status in ('SUBMITTED','PENDING_CHAPTER','PENDING_NATIONAL','PENDING_PAYMENT','PENDING','INFO_REQUESTED','APPROVED','REJECTED')),
  jurisdiction    text not null default 'CHAPTER',
  paid            boolean not null default false,
  submitted_at    timestamptz not null default now()
);
create index if not exists idx_assoc_applications_org_status on assoc_applications(organisation_id, status);

-- ── Dues, invoices, payments (money path → ledger) ───────────────────────────
create table if not exists assoc_dues_invoices (
  id              uuid primary key default gen_random_uuid(),
  membership_id   uuid not null references assoc_memberships(id),
  title           text not null,
  description     text,
  amount_kobo     bigint not null,
  cadence         text not null default 'ANNUAL',
  scope           text not null default 'NATIONAL' check (scope in ('NATIONAL','STATE','LOCAL','COMMITTEE')),
  status          text not null default 'DUE' check (status in ('PAID','DUE','OVERDUE','PROCESSING')),
  due_date        timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists idx_assoc_invoices_membership on assoc_dues_invoices(membership_id, status);

create table if not exists assoc_payments (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references assoc_dues_invoices(id),
  membership_id   uuid not null references assoc_memberships(id),
  amount_kobo     bigint not null,
  method          text not null check (method in ('WALLET','PAYSTACK','BANK_TRANSFER','CASH','USSD')),
  reference       text,
  status          text not null default 'PENDING' check (status in ('PENDING','SUCCESS','FAILED','REVERSED')),
  offline         boolean not null default false,
  approved_by     uuid,
  ledger_txn_id   uuid,                          -- FK to the canonical ledger (set by money service)
  idempotency_key text,
  created_at      timestamptz not null default now()
);
create unique index if not exists uq_assoc_payments_idem on assoc_payments(idempotency_key) where idempotency_key is not null;

create table if not exists assoc_revenue_splits (
  id          uuid primary key default gen_random_uuid(),
  payment_id  uuid not null references assoc_payments(id),
  label       text not null,
  amount_kobo bigint not null
);

-- ── Engagement: announcements, notifications ────────────────────────────────
create table if not exists assoc_announcements (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references assoc_organisations(id),
  title           text not null,
  body            text,
  audience        text,
  author          text,
  urgent          boolean not null default false,
  requires_ack    boolean not null default false,
  posted_at       timestamptz not null default now()
);
create table if not exists assoc_announcement_reads (
  announcement_id uuid not null references assoc_announcements(id),
  membership_id   uuid not null references assoc_memberships(id),
  read_at         timestamptz,
  acknowledged_at timestamptz,
  primary key (announcement_id, membership_id)
);
create table if not exists assoc_notifications (
  id            uuid primary key default gen_random_uuid(),
  membership_id uuid not null references assoc_memberships(id),
  kind          text not null,
  title         text not null,
  body          text,
  route         text,
  read          boolean not null default false,
  created_at    timestamptz not null default now()
);

-- ── Meetings ────────────────────────────────────────────────────────────────
create table if not exists assoc_meetings (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references assoc_organisations(id),
  title           text not null,
  description     text,
  mode            text not null default 'PHYSICAL' check (mode in ('PHYSICAL','VIRTUAL','HYBRID')),
  starts_at       timestamptz not null,
  ends_at         timestamptz,
  location        text,
  state           text not null default 'UPCOMING' check (state in ('UPCOMING','LIVE','PAST','CANCELLED')),
  agenda          jsonb not null default '[]'::jsonb,
  minutes_published boolean not null default false,
  attendance_code text,
  created_at      timestamptz not null default now()
);
create table if not exists assoc_meeting_attendance (
  meeting_id    uuid not null references assoc_meetings(id),
  membership_id uuid not null references assoc_memberships(id),
  rsvp          text check (rsvp in ('YES','NO','MAYBE')),
  checked_in_at timestamptz,
  primary key (meeting_id, membership_id)
);

-- ── Tasks ───────────────────────────────────────────────────────────────────
create table if not exists assoc_tasks (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references assoc_organisations(id),
  title           text not null,
  description     text,
  status          text not null default 'ASSIGNED'
                    check (status in ('DRAFT','ASSIGNED','ACCEPTED','IN_PROGRESS','BLOCKED','AWAITING_REVIEW','COMPLETED','REJECTED','REOPENED','CANCELLED','OVERDUE')),
  priority        text not null default 'MEDIUM' check (priority in ('LOW','MEDIUM','HIGH')),
  due_date        timestamptz,
  assignee_id     uuid references assoc_memberships(id),
  committee_id    uuid references assoc_committees(id),
  meeting_id      uuid references assoc_meetings(id),
  checklist       jsonb not null default '[]'::jsonb,
  created_by      uuid,
  created_at      timestamptz not null default now()
);
create index if not exists idx_assoc_tasks_assignee on assoc_tasks(assignee_id, status);

-- ── Documents ───────────────────────────────────────────────────────────────
create table if not exists assoc_documents (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references assoc_organisations(id),
  title           text not null,
  category        text not null,
  kind            text not null default 'pdf' check (kind in ('pdf','image','doc')),
  storage_key     text,
  size_label      text,
  version         text not null default 'v1',
  restricted      boolean not null default false,
  requires_ack    boolean not null default false,
  ai_summary      text,
  uploaded_by     text,
  updated_at      timestamptz not null default now()
);
create table if not exists assoc_document_acks (
  document_id   uuid not null references assoc_documents(id),
  membership_id uuid not null references assoc_memberships(id),
  acknowledged_at timestamptz not null default now(),
  primary key (document_id, membership_id)
);

-- ── Chat ────────────────────────────────────────────────────────────────────
create table if not exists assoc_chat_threads (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references assoc_organisations(id),
  title           text not null,
  scope           text not null,
  posting_block   text,
  created_at      timestamptz not null default now()
);
create table if not exists assoc_chat_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references assoc_chat_threads(id),
  author_id   uuid,
  body        text not null,
  pinned      boolean not null default false,
  system      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_assoc_chat_msgs_thread on assoc_chat_messages(thread_id, created_at);

-- ── AI notes ────────────────────────────────────────────────────────────────
create table if not exists assoc_ai_notes (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references assoc_organisations(id),
  meeting_id      uuid references assoc_meetings(id),
  meeting_title   text not null,
  source          text not null check (source in ('RECORD','AUDIO','VIDEO','TRANSCRIPT')),
  status          text not null default 'PROCESSING'
                    check (status in ('PROCESSING','READY','APPROVED','PUBLISHED','FAILED')),
  summary         text,
  minutes         text,
  decisions       jsonb not null default '[]'::jsonb,
  action_items    jsonb not null default '[]'::jsonb,
  attendees       jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);

-- ── Events ──────────────────────────────────────────────────────────────────
create table if not exists assoc_events (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references assoc_organisations(id),
  title           text not null,
  description     text,
  starts_at       timestamptz not null,
  ends_at         timestamptz,
  location        text,
  paid            boolean not null default false,
  fee_kobo        bigint not null default 0,
  capacity        int,
  organiser       text,
  cover_url       text,
  created_at      timestamptz not null default now()
);
create table if not exists assoc_event_registrations (
  event_id      uuid not null references assoc_events(id),
  membership_id uuid not null references assoc_memberships(id),
  rsvp          text check (rsvp in ('GOING','NOT_GOING')),
  registered    boolean not null default false,
  ticket_code   text,
  checked_in_at timestamptz,
  feedback      jsonb,
  primary key (event_id, membership_id)
);

-- ── Support ─────────────────────────────────────────────────────────────────
create table if not exists assoc_support_tickets (
  id              uuid primary key default gen_random_uuid(),
  membership_id   uuid not null references assoc_memberships(id),
  subject         text not null,
  category        text not null check (category in ('MEMBERSHIP','PAYMENT','TECHNICAL','OTHER')),
  status          text not null default 'OPEN' check (status in ('OPEN','IN_PROGRESS','RESOLVED')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create table if not exists assoc_support_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references assoc_support_tickets(id),
  author      text not null,
  from_support boolean not null default false,
  body        text not null,
  created_at  timestamptz not null default now()
);

-- ── Devices & member import batches ──────────────────────────────────────────
create table if not exists assoc_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  name         text,
  platform     text,
  location     text,
  last_active  timestamptz,
  revoked_at   timestamptz
);
create table if not exists assoc_import_batches (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references assoc_organisations(id),
  file_name       text,
  total           int not null default 0,
  imported        int not null default 0,
  skipped         int not null default 0,
  invited         int not null default 0,
  uploaded_by     uuid,
  created_at      timestamptz not null default now()
);

-- ── Audit log (every sensitive action) ───────────────────────────────────────
create table if not exists assoc_audit_log (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid,
  actor_id        uuid,
  action          text not null,                 -- e.g. MEMBER_SUSPEND, APPROVAL_DECISION, OFFLINE_PAYMENT_APPROVE
  subject_type    text,
  subject_id      text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists idx_assoc_audit_org_created on assoc_audit_log(organisation_id, created_at);
