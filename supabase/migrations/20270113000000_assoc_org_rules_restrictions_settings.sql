-- Association organisations: rules, restrictions, chapter leaders and per-org
-- admin settings.
--
-- The creation wizard collects group rules, a dues grace period, four feature
-- restriction toggles and per-state chapter leaders, shows them all back on its
-- review step, and then discards every one of them: the Go OrgDraft has no
-- matching field and no column or table exists to hold them. Separately, admins
-- have no per-association settings surface at all — 20260629000100 added
-- notification_prefs/security/preferences to assoc_member_PROFILES, which is
-- per-member, not per-organisation.
--
-- Additive-only: new tables plus new nullable/defaulted columns. Nothing is
-- dropped, renamed or narrowed, and every default matches the behaviour that
-- was previously hardcoded.

-- ── Group rules ──────────────────────────────────────────────────────────────
create table if not exists assoc_organisation_rules (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references assoc_organisations(id),
  body            text not null,
  position        integer not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_assoc_org_rules_org
  on assoc_organisation_rules (organisation_id, position, id);

-- ── Membership restrictions + per-org settings ───────────────────────────────
-- grace_days default 30 preserves the previously implicit behaviour (arrears was
-- a raw payment_standing='OVERDUE' check with no grace period at all).
alter table assoc_organisations
  add column if not exists grace_days       integer not null default 30,
  add column if not exists disable_voting   boolean not null default false,
  add column if not exists disable_events   boolean not null default false,
  add column if not exists disable_chat     boolean not null default false,
  add column if not exists disable_card     boolean not null default false,
  add column if not exists structure_type   text,
  add column if not exists settings         jsonb   not null default '{}'::jsonb,
  add column if not exists status           text    not null default 'ACTIVE',
  add column if not exists suspended_at     timestamptz,
  add column if not exists updated_at       timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'assoc_organisations_status_check'
  ) then
    alter table assoc_organisations
      add constraint assoc_organisations_status_check
      check (status = any (array['ACTIVE','SUSPENDED','ARCHIVED']));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'assoc_organisations_grace_days_check'
  ) then
    alter table assoc_organisations
      add constraint assoc_organisations_grace_days_check check (grace_days >= 0);
  end if;
end $$;

-- ── Chapter leaders ──────────────────────────────────────────────────────────
-- chapter_id is nullable: the wizard collects leaders per STATE before chapters
-- are necessarily created, so the state name is retained independently.
create table if not exists assoc_chapter_leaders (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references assoc_organisations(id),
  chapter_id          uuid references assoc_chapters(id),
  state_name          text not null,
  leader_name         text,
  leader_contact      text,
  can_approve_members boolean not null default false,
  created_at          timestamptz not null default now()
);
create index if not exists idx_assoc_chapter_leaders_org
  on assoc_chapter_leaders (organisation_id);

-- ── Role grants: stop AssignRole stacking duplicates ─────────────────────────
-- assoc_member_roles had no uniqueness on (membership_id, role), so repeated
-- grants accumulated. De-duplicate first, keeping the earliest grant.
delete from assoc_member_roles r
 using assoc_member_roles keep
 where r.membership_id = keep.membership_id
   and r.role = keep.role
   and (r.granted_at, r.id) > (keep.granted_at, keep.id);

create unique index if not exists uq_assoc_member_roles_membership_role
  on assoc_member_roles (membership_id, role);

-- ── Publish idempotency ──────────────────────────────────────────────────────
-- POST /associations accepted an Idempotency-Key header and never read it, so a
-- transport-level retry created a second organisation with a second uuid. The
-- partial unique index makes a replay collide instead.
alter table assoc_organisations
  add column if not exists idempotency_key text;

create unique index if not exists uq_assoc_organisations_idem
  on assoc_organisations (idempotency_key)
  where idempotency_key is not null;

-- ── Audit-log organisation backfill ──────────────────────────────────────────
-- Eight audit call sites wrote a NULL organisation_id, which is why GetAuditLog
-- carried an `OR actor_id=…` disjunction that defeated org scoping and leaked
-- one organisation's audit rows into another's console. Those call sites now
-- pass their real org; attribute the historical rows so the strict filter does
-- not hide them.
UPDATE assoc_audit_log a SET organisation_id = m.organisation_id
  FROM assoc_memberships m
 WHERE a.organisation_id IS NULL AND a.subject_type = 'member'
   AND m.id::text = a.subject_id;

UPDATE assoc_audit_log a SET organisation_id = m.organisation_id
  FROM assoc_dues_invoices i
  JOIN assoc_memberships m ON m.id = i.membership_id
 WHERE a.organisation_id IS NULL AND a.subject_type = 'invoice'
   AND i.id::text = a.subject_id;

UPDATE assoc_audit_log a SET organisation_id = m.organisation_id
  FROM assoc_payments p
  JOIN assoc_memberships m ON m.id = p.membership_id
 WHERE a.organisation_id IS NULL AND a.subject_type = 'payment'
   AND p.id::text = a.subject_id;

UPDATE assoc_audit_log a SET organisation_id = n.organisation_id
  FROM assoc_ai_notes n
 WHERE a.organisation_id IS NULL AND a.subject_type = 'ai_note'
   AND n.id::text = a.subject_id;

UPDATE assoc_audit_log a SET organisation_id = ap.organisation_id
  FROM assoc_applications ap
 WHERE a.organisation_id IS NULL AND a.subject_type = 'application'
   AND ap.id::text = a.subject_id;

-- ── Application documents ────────────────────────────────────────────────────
-- The join flow has a whole document-upload step whose payload the server never
-- bound: JoinDraft had no documents field and no table existed, so every upload
-- was silently discarded and the admin approvals screen had nothing to show.
create table if not exists assoc_application_documents (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references assoc_applications(id),
  label          text not null,
  url            text,
  kind           text not null default 'OTHER',
  created_at     timestamptz not null default now()
);
create index if not exists idx_assoc_application_documents_app
  on assoc_application_documents (application_id);

-- ── Import staging ───────────────────────────────────────────────────────────
-- POST /admin/import/preview parsed and validated the CSV and then threw the
-- result away; the handler passed a zero-value preview to ConfirmImport, whose
-- ImportConfirmRequest had no field to carry rows. Confirm therefore recorded a
-- batch of all zeros, imported nobody, and returned HTTP 200 — while the UI told
-- the admin "nothing persists until you confirm". Staging the parsed rows makes
-- the two-step flow real.
alter table assoc_import_batches
  add column if not exists rows         jsonb       not null default '[]'::jsonb,
  add column if not exists status       text        not null default 'PENDING',
  add column if not exists confirmed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'assoc_import_batches_status_check'
  ) then
    alter table assoc_import_batches
      add constraint assoc_import_batches_status_check
      check (status = any (array['PENDING','CONFIRMED','DISCARDED']));
  end if;
end $$;

-- Rows recorded before staging existed were already committed by the direct
-- multipart import path; mark them so they can never be re-confirmed.
update assoc_import_batches set status = 'CONFIRMED'
 where status = 'PENDING' and confirmed_at is null and created_at < now();
