-- Association content authoring + dues runs.
--
-- assoc_announcements, assoc_meetings, assoc_documents, assoc_events,
-- assoc_notifications and assoc_devices had READ endpoints and no writer
-- anywhere in the repo, so they were permanently empty. assoc_dues_invoices was
-- the same, which meant the whole money path had nothing it could ever settle:
-- PayInvoice needs an invoice and nothing created one.
--
-- This migration adds only what authoring needs that the existing tables cannot
-- express. Additive-only: new tables and new nullable/defaulted columns.

-- ── Dues runs ────────────────────────────────────────────────────────────────
-- A run raises one invoice per matching member. It MUST be replay-safe: a
-- retried request that re-billed an organisation's entire roster is the worst
-- failure mode in this module, so the idempotency key is a unique index rather
-- than an application-level check.
create table if not exists assoc_dues_runs (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references assoc_organisations(id),
  title           text not null,
  scope           text not null default 'NATIONAL',
  category_id     uuid references assoc_membership_categories(id),
  chapter_id      uuid references assoc_chapters(id),
  invoiced        integer not null default 0,
  skipped         integer not null default 0,
  total_kobo      bigint  not null default 0,
  idempotency_key text,
  created_by      uuid,
  created_at      timestamptz not null default now()
);

create unique index if not exists uq_assoc_dues_runs_idem
  on assoc_dues_runs (idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_assoc_dues_runs_org
  on assoc_dues_runs (organisation_id, created_at desc);

-- Link invoices back to the run that raised them, and make double-billing one
-- member within a single run impossible at the schema level.
alter table assoc_dues_invoices
  add column if not exists run_id uuid references assoc_dues_runs(id);

create unique index if not exists uq_assoc_dues_invoices_run_member
  on assoc_dues_invoices (run_id, membership_id)
  where run_id is not null;

-- ── Authoring provenance ─────────────────────────────────────────────────────
-- Who created a piece of content, so the audit trail and the "posted by" line
-- are answerable. assoc_documents.uploaded_by already exists but is free text.
alter table assoc_announcements
  add column if not exists created_by uuid,
  add column if not exists updated_at timestamptz not null default now();

alter table assoc_meetings
  add column if not exists created_by uuid;

alter table assoc_documents
  add column if not exists created_by uuid,
  add column if not exists description text;

alter table assoc_events
  add column if not exists created_by uuid;

-- ── Event registration payment ───────────────────────────────────────────────
-- assoc_events.paid / fee_kobo were read and rendered but nothing ever charged
-- them: RegisterEvent issued a ticket for free. Registrations now carry the
-- invoice that must be settled before the ticket is valid.
alter table assoc_event_registrations
  add column if not exists invoice_id uuid references assoc_dues_invoices(id),
  add column if not exists registered_at timestamptz;

-- ── Devices ──────────────────────────────────────────────────────────────────
-- assoc_devices had no writer, so /me/devices always returned [] and the revoke
-- endpoint always 403'd on zero rows affected.
alter table assoc_devices
  add column if not exists created_at timestamptz not null default now();
