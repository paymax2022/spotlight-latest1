-- 20260918000000_academy_fees_edtech.sql
-- EdTech School-Fees — net-new entities (Invoice, AcademicSession, per-school Class,
-- per-school Student enrollment, Payment, PromotionRecord, Competition + registrations,
-- ComplianceExport) + additive extensions to the existing academy/edupay spine.
-- Additive-only (no DROP TABLE/COLUMN, no rename, no type-narrow). Re-runnable.
-- EXTENDS the existing academy module (REUSE-MAP.md is source of truth): reuses
-- finance/ledger (money), academy/edupay (academy_schools, academy_fee_schedules,
-- academy_edupay_accounts, academy_savings_pots = FeesVault), academy/identity
-- (guardian links/consent), academy/gamification (academy_leaderboards).
-- Every money mutation posts a balanced ledger entry + audit_logs row (module 'academy.fees').
-- All money is bigint minor units (kobo); suffix _minor. FKs reference existing primitives:
-- auth.users(id), public.academy_schools(id), public.academy_fee_schedules(id),
-- public.academy_savings_pots(id), public.academy_edupay_accounts(id).
-- Backend-only: RLS enabled with no policy (deny-all for anon/authenticated); owner
-- 'postgres' (Go backend) and service_role bypass RLS. REVOKE guarded on role existence.
BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- A) EXTEND public.academy_schools — verification tier (gates escrow / gov-reporting /
--    competition eligibility), level, owner identity. (SF-11 gov-reporting eligibility)
-- ═══════════════════════════════════════════════════════════════════════════════
DO $ext$ BEGIN
  IF to_regclass('public.academy_schools') IS NOT NULL THEN
    ALTER TABLE public.academy_schools
      ADD COLUMN IF NOT EXISTS verification_tier text NOT NULL DEFAULT 'unverified';
    ALTER TABLE public.academy_schools
      ADD COLUMN IF NOT EXISTS level text;
    ALTER TABLE public.academy_schools
      ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id);
    -- (re)assert the verification_tier CHECK (widening-safe: drop-if-exists then add)
    ALTER TABLE public.academy_schools
      DROP CONSTRAINT IF EXISTS academy_schools_verification_tier_check;
    ALTER TABLE public.academy_schools
      ADD CONSTRAINT academy_schools_verification_tier_check
      CHECK (verification_tier IN ('unverified','pending','verified','premium'));
  END IF;
END $ext$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- B) EXTEND public.academy_fee_schedules — session/class linkage, structured fee items,
--    installment policy, immutability flag. SF-1: FeeSchedule immutable once referenced
--    by an issued Invoice — `locked` flag is the DB-visible guard; enforcement lives in
--    the service layer (feeschedule package) + the guard trigger below.
-- ═══════════════════════════════════════════════════════════════════════════════
DO $ext$ BEGIN
  IF to_regclass('public.academy_fee_schedules') IS NOT NULL THEN
    ALTER TABLE public.academy_fee_schedules
      ADD COLUMN IF NOT EXISTS session_id uuid;
    ALTER TABLE public.academy_fee_schedules
      ADD COLUMN IF NOT EXISTS class_id uuid;
    ALTER TABLE public.academy_fee_schedules
      ADD COLUMN IF NOT EXISTS fee_items jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE public.academy_fee_schedules
      ADD COLUMN IF NOT EXISTS installment_policy jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE public.academy_fee_schedules
      ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;
  END IF;
END $ext$;
-- SF-1 defence-in-depth: a locked fee schedule may not have its money-shaping columns
-- changed. Additive trigger; only blocks mutation of amount/fee_items/installment_policy
-- while locked=true. (Primary enforcement is the service layer; this is the DB backstop.)
CREATE OR REPLACE FUNCTION public.academy_fee_schedule_immutable_when_locked()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.locked = true THEN
    IF NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
       OR NEW.fee_items IS DISTINCT FROM OLD.fee_items
       OR NEW.installment_policy IS DISTINCT FROM OLD.installment_policy THEN
      RAISE EXCEPTION 'academy_fee_schedules % is locked (SF-1): fee amount/items/installment_policy are immutable once referenced by an issued invoice', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
DO $trg$ BEGIN
  IF to_regclass('public.academy_fee_schedules') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_academy_fee_schedule_lock ON public.academy_fee_schedules;
    CREATE TRIGGER trg_academy_fee_schedule_lock
      BEFORE UPDATE ON public.academy_fee_schedules
      FOR EACH ROW EXECUTE FUNCTION public.academy_fee_schedule_immutable_when_locked();
  END IF;
END $trg$;
-- Partial index: quickly find locked (issued) schedules per school.
CREATE INDEX IF NOT EXISTS idx_academy_fee_schedules_locked
  ON public.academy_fee_schedules(school_id) WHERE locked = true;

-- ═══════════════════════════════════════════════════════════════════════════════
-- C) academy_sessions — AcademicSession (e.g. '2026/2027', 3-term).
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.academy_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES public.academy_schools(id),
  name           text NOT NULL,                        -- e.g. '2026/2027'
  term_structure jsonb NOT NULL DEFAULT '{}'::jsonb,
  start_date     date,
  end_date       date,
  status         text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','closed','archived')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_sessions_school ON public.academy_sessions(school_id, status);

-- ═══════════════════════════════════════════════════════════════════════════════
-- D) academy_fee_classes — per-school Class instance (fees domain). Named
--    academy_fee_classes to avoid collision with the NERDC curriculum catalog
--    public.academy_classes. Rolls over each session via PromotionRecord.
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.academy_fee_classes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             uuid NOT NULL REFERENCES public.academy_schools(id),
  session_id            uuid REFERENCES public.academy_sessions(id),
  name                  text NOT NULL,
  level                 text,
  class_teacher_user_id uuid REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_fee_classes_school ON public.academy_fee_classes(school_id, session_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- E) academy_students — per-school enrollment. Distinct from academy_edupay_accounts
--    (the guardian↔payer link). minor_flag drives SF-7 leaderboard PII stripping.
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.academy_students (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id          uuid NOT NULL REFERENCES public.academy_schools(id),
  class_id           uuid REFERENCES public.academy_fee_classes(id),
  edupay_account_id  uuid REFERENCES public.academy_edupay_accounts(id),
  admission_number   text,
  student_user_id    uuid REFERENCES auth.users(id),           -- nullable: minors may lack own login
  guardian_user_ids  uuid[] NOT NULL DEFAULT '{}',
  status             text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','promoted','repeated','graduated','withdrawn')),
  minor_flag         boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, admission_number)
);
CREATE INDEX IF NOT EXISTS idx_academy_students_class ON public.academy_students(class_id);
CREATE INDEX IF NOT EXISTS idx_academy_students_school ON public.academy_students(school_id, status);

-- ═══════════════════════════════════════════════════════════════════════════════
-- F) academy_invoices — Invoice (genuinely new).
--    SF-2: balance is DERIVED from academy_invoice_payments (SUM of succeeded payments),
--    NEVER stored/mutated. Therefore this table has NO balance or amount_paid column —
--    do not add one. Any `UPDATE ... SET balance` is forbidden (SF-2).
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.academy_invoices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         uuid NOT NULL REFERENCES public.academy_students(id),
  fee_schedule_id    uuid NOT NULL REFERENCES public.academy_fee_schedules(id),
  total_amount_minor bigint NOT NULL,
  due_date           date,
  status             text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','issued','partially_paid','paid',
                                         'overdue','frozen','waived','written_off')),
  issued_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_invoices_student ON public.academy_invoices(student_id, status);
CREATE INDEX IF NOT EXISTS idx_academy_invoices_schedule ON public.academy_invoices(fee_schedule_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- G) academy_invoice_payments — Payment (append-only thin record referencing the real
--    finance/ledger transaction; balance is derived from these rows per SF-2).
--    Never UPDATE/DELETE except status transitions via reversing ledger entries.
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.academy_invoice_payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id        uuid NOT NULL REFERENCES public.academy_invoices(id),
  guardian_user_id  uuid NOT NULL REFERENCES auth.users(id),
  amount_minor      bigint NOT NULL,
  gateway_ref       text,
  ledger_reference  text,                                  -- reference into finance/ledger
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','succeeded','failed','reversed')),
  idempotency_key   text NOT NULL UNIQUE,
  created_at        timestamptz NOT NULL DEFAULT now()     -- append-only
);
CREATE INDEX IF NOT EXISTS idx_academy_invoice_payments_invoice
  ON public.academy_invoice_payments(invoice_id, status);

-- ═══════════════════════════════════════════════════════════════════════════════
-- H) academy_promotion_records — PromotionRecord (SF-3: two human approvals required
--    before `applied`; no path may skip promotion_computed → applied).
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.academy_promotion_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id          uuid NOT NULL REFERENCES public.academy_students(id),
  from_class_id       uuid REFERENCES public.academy_fee_classes(id),
  to_class_id         uuid REFERENCES public.academy_fee_classes(id),
  session_id          uuid REFERENCES public.academy_sessions(id),
  exam_score          numeric,
  decision            text CHECK (decision IN ('promoted','repeated','conditional')),
  state               text NOT NULL DEFAULT 'promotion_computed'
                        CHECK (state IN ('session_active','results_finalized',
                                         'promotion_computed','promotion_reviewed',
                                         'promotion_approved','applied')),
  teacher_approved_by uuid REFERENCES auth.users(id),
  teacher_approved_at timestamptz,
  admin_approved_by   uuid REFERENCES auth.users(id),
  admin_approved_at   timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- SF-3 DB backstop: state='applied' requires BOTH approver columns present.
  CONSTRAINT academy_promotion_records_two_approvals_check
    CHECK (state <> 'applied'
           OR (teacher_approved_by IS NOT NULL AND admin_approved_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_academy_promotion_records_student
  ON public.academy_promotion_records(student_id, session_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- I) academy_competitions + academy_competition_registrations (§3.4).
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.academy_competitions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     text NOT NULL,
  scope                    text NOT NULL
                             CHECK (scope IN ('class','school','city','state','national')),
  subject                  text,
  participating_school_ids uuid[] NOT NULL DEFAULT '{}',
  sponsor                  text,
  start_date               date,
  end_date                 date,
  status                   text NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft','open_registration','registration_closed',
                                               'in_progress','results_pending','completed','archived')),
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_competitions_status ON public.academy_competitions(status);

CREATE TABLE IF NOT EXISTS public.academy_competition_registrations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.academy_competitions(id),
  school_id      uuid NOT NULL REFERENCES public.academy_schools(id),
  registered_at  timestamptz DEFAULT now(),
  UNIQUE (competition_id, school_id)
);
CREATE INDEX IF NOT EXISTS idx_academy_competition_regs_school
  ON public.academy_competition_registrations(school_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- J) academy_compliance_exports — ComplianceExport (SF-11: opt-in per school/category,
--    append-only immutable log of what was shared with which regulator, when).
--    Never UPDATE/DELETE.
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.academy_compliance_exports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       uuid NOT NULL REFERENCES public.academy_schools(id),
  report_type     text NOT NULL,
  period          text,
  data_categories text[] NOT NULL DEFAULT '{}',
  requested_by    uuid REFERENCES auth.users(id),
  generated_at    timestamptz NOT NULL DEFAULT now(),
  payload_ref     text
);
CREATE INDEX IF NOT EXISTS idx_academy_compliance_exports_school
  ON public.academy_compliance_exports(school_id, generated_at);

-- ═══════════════════════════════════════════════════════════════════════════════
-- K) WIDEN existing CHECK constraints (additive: add values, keep all existing).
--    Guarded by to_regclass so this never aborts if a table is absent.
--    K.1 academy_leaderboards.scope: add 'city','state' (E7 competition scopes).
--    K.2 academy_savings_pots.status: add FeesVault state-machine states (§3.2).
-- ═══════════════════════════════════════════════════════════════════════════════
DO $widen$ BEGIN
  IF to_regclass('public.academy_leaderboards') IS NOT NULL THEN
    ALTER TABLE public.academy_leaderboards
      DROP CONSTRAINT IF EXISTS academy_leaderboards_scope_check;
    ALTER TABLE public.academy_leaderboards
      ADD CONSTRAINT academy_leaderboards_scope_check
      CHECK (scope IN ('class','school','national','friends','city','state'));
  END IF;
END $widen$;

DO $widen$ BEGIN
  IF to_regclass('public.academy_savings_pots') IS NOT NULL THEN
    ALTER TABLE public.academy_savings_pots
      DROP CONSTRAINT IF EXISTS academy_savings_pots_status_check;
    ALTER TABLE public.academy_savings_pots
      ADD CONSTRAINT academy_savings_pots_status_check
      CHECK (status IN ('active','closed','target_reached','applied_to_invoice','withdrawn','locked'));
  END IF;
END $widen$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- L) RLS lockdown — backend-only. Enable RLS (deny-all for anon/authenticated with no
--    policy) + REVOKE anon/authenticated grants. Owner 'postgres' + service_role bypass.
--    Guarded on table existence (to_regclass) and role existence (pg_roles) so a bare
--    Postgres CI without the Supabase role shim is a no-op.
-- ═══════════════════════════════════════════════════════════════════════════════
DO $rls$
DECLARE
  new_tables text[] := ARRAY[
    'academy_sessions',
    'academy_fee_classes',
    'academy_students',
    'academy_invoices',
    'academy_invoice_payments',
    'academy_promotion_records',
    'academy_competitions',
    'academy_competition_registrations',
    'academy_compliance_exports'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY new_tables LOOP
    IF to_regclass('public.'||t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
    END IF;
  END LOOP;
END $rls$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SF-invariant coverage map (which invariant each object backs; DB vs service layer)
-- ───────────────────────────────────────────────────────────────────────────────
-- SF-1  FeeSchedule immutable once invoiced
--         DB:      academy_fee_schedules.locked + trg_academy_fee_schedule_lock
--                  (blocks amount/fee_items/installment_policy changes while locked)
--         Service: feeschedule package sets locked=true on first issued invoice.
-- SF-2  Invoice balance derived from Payment events, never stored/mutated
--         DB:      academy_invoices has NO balance/amount_paid column (structural);
--                  academy_invoice_payments is append-only (idempotency_key UNIQUE).
--         Service: balance = SUM(succeeded academy_invoice_payments); no UPDATE ... balance.
-- SF-3  Promotion requires two human approvals before 'applied'
--         DB:      academy_promotion_records_two_approvals_check (applied ⇒ both approvers)
--                  + state CHECK enumerates the guarded chain.
--         Service: statemachine forbids promotion_computed → applied skip.
-- SF-4  Academic access never gated by fee status
--         Service/AuthZ only — no DB coupling between fees tables and academic content
--         (fees tables reference no academic-authorization column by design).
-- SF-5  FeesVault funds in segregated purpose-tagged ledger sub-account
--         Ledger:  new AccountType 'edtech_fees_vault' (finance/ledger); academy_savings_pots
--                  status widened for the vault state machine (K.2). No shadow balance.
-- SF-6  Installment terms locked/disclosed at issuance
--         DB:      academy_fee_schedules.installment_policy + SF-1 lock.
--         Service: disclosure screen (mobile PA-06).
-- SF-7  Minor leaderboard PII default-stripped
--         DB:      academy_students.minor_flag flag (drives serializer).
--         Service: API serializer strips PII unless recorded guardian consent.
-- SF-8  Nightly reconciliation
--         Service/Job only (academy_invoice_payments + savings pots vs ledger/webhooks).
-- SF-9  Hardship/freeze → human review queue, never auto-approved
--         DB:      invoice status 'frozen' exists but no auto-transition to it.
--         Service: workflow engine routes to human queue.
-- SF-10 Full data export for verified schools
--         DB:      academy_schools.verification_tier gates eligibility.
--         Service: export API.
-- SF-11 Gov/regulator sync opt-in per school/category, every export logged immutably
--         DB:      academy_compliance_exports append-only (no UPDATE/DELETE);
--                  data_categories[] records opt-in categories.
-- SF-12 At-risk correlation flag private to counselor/admin
--         RBAC/Service only — no such column exposed to student capability here.
-- ───────────────────────────────────────────────────────────────────────────────
-- NEW TABLES:    academy_sessions, academy_fee_classes, academy_students,
--                academy_invoices, academy_invoice_payments, academy_promotion_records,
--                academy_competitions, academy_competition_registrations,
--                academy_compliance_exports
-- ALTERED TABLES: academy_schools (+verification_tier,+level,+owner_user_id),
--                academy_fee_schedules (+session_id,+class_id,+fee_items,
--                  +installment_policy,+locked, +lock trigger),
--                academy_leaderboards (scope CHECK widened +city,+state),
--                academy_savings_pots (status CHECK widened for FeesVault SM)
-- ═══════════════════════════════════════════════════════════════════════════════
