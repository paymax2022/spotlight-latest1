-- Paymax Connect — Phase 6A + 6D (Professional Network: Jobs, Company Pages, Referral Bounty)
-- Ref: docs/connect/PAYMAX-CONNECT-PHASE6-PROFESSIONAL-NETWORK.md (§3 model, §4 state machines,
--      §5 RBAC, invariants PN-2/PN-6/PN-9/PN-10).
--
-- Additive-only: CREATE TABLE/INDEX/POLICY IF NOT EXISTS, idempotent seeds. NO existing
-- table is modified, no DROP of data, no column narrowing. Money = BIGINT kobo (never float).
-- The finance ledger/wallet (ledger_accounts/ledger_entries) is REUSED for the paid-posting
-- fee (wallet debit) and the referral bounty payout (ledger credit) — balances stay DERIVED,
-- this migration adds NO balance table (PN-8/PN-10).
--
-- Reused helpers: public.is_admin(), public.handle_updated_at(). RLS on every table with a
-- service_role bypass; owner/reader policies deny-by-default. State columns are guarded by CHECK
-- constraints so illegal states are physically unreachable in the DB as well as the service.
--
-- PN-2 (single-level referral): connect_referral_bounties has NO parent_bounty / referrer-chain
-- column, by design and as a compliance line — a referral-of-referral is not representable.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- Company Pages (claim flow tied to existing business verification, PN-6)
-- ════════════════════════════════════════════════════════════════════════════

-- A company page is a claimed presence for a verified business. claim_state is a
-- guarded state machine (CompanyPageClaim FSM, §4). Only claim_state='verified'
-- unlocks paid job posting (PN-6, enforced server-side too).
CREATE TABLE IF NOT EXISTS public.connect_company_pages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- FK to the existing business capability/verification record. Nullable until a
  -- claim is approved; kept as a soft reference (no cross-module hard FK) so this
  -- module stays self-contained and additive.
  verified_business_id  uuid,
  name                  text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 200),
  about                 text,
  -- CompanyPageClaim FSM: CLAIM_SUBMITTED → UNDER_REVIEW ⇄ NEEDS_MORE_INFO → VERIFIED | REJECTED
  claim_state           text NOT NULL DEFAULT 'claim_submitted'
                          CHECK (claim_state IN
                            ('claim_submitted','under_review','needs_more_info','verified','rejected')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
  -- NOTE: follower_count is DERIVED from connect_company_followers (never stored raw).
);
CREATE INDEX IF NOT EXISTS idx_connect_company_pages_state
  ON public.connect_company_pages (claim_state);

-- Object-scoped capability grants (PN-9): each row is an independently revocable grant
-- of a company-scoped capability (company_page_admin | recruiter) to a user for ONE page.
-- Revoking one row never affects other capabilities of the same user (single identity).
CREATE TABLE IF NOT EXISTS public.connect_company_admins (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_page_id  uuid NOT NULL REFERENCES public.connect_company_pages(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role             text NOT NULL CHECK (role IN ('company_page_admin','recruiter')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_page_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_connect_company_admins_user
  ON public.connect_company_admins (user_id);

-- Derived follower list — follower_count = COUNT(*) over this table for a page (never stored).
CREATE TABLE IF NOT EXISTS public.connect_company_followers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_page_id  uuid NOT NULL REFERENCES public.connect_company_pages(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_page_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_connect_company_followers_page
  ON public.connect_company_followers (company_page_id);

-- ════════════════════════════════════════════════════════════════════════════
-- Jobs (JobPosting §3; status guarded state machine)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.connect_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_page_id   uuid NOT NULL REFERENCES public.connect_company_pages(id) ON DELETE CASCADE,
  poster_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title             text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  description       text,
  requirements      text,
  location          text,
  employment_type   text CHECK (employment_type IS NULL OR employment_type IN
                        ('full_time','part_time','contract','internship','temporary')),
  salary_min_kobo   bigint CHECK (salary_min_kobo IS NULL OR salary_min_kobo >= 0),
  salary_max_kobo   bigint CHECK (salary_max_kobo IS NULL OR salary_max_kobo >= 0),
  CONSTRAINT connect_jobs_salary_range CHECK
    (salary_min_kobo IS NULL OR salary_max_kobo IS NULL OR salary_max_kobo >= salary_min_kobo),
  positions_open    int NOT NULL DEFAULT 1 CHECK (positions_open > 0),
  positions_filled  int NOT NULL DEFAULT 0 CHECK (positions_filled >= 0),
  CONSTRAINT connect_jobs_positions CHECK (positions_filled <= positions_open),
  -- Posting fee in kobo charged (via wallet debit) on activation when > 0 (PN-6).
  fee_kobo          bigint NOT NULL DEFAULT 0 CHECK (fee_kobo >= 0),
  -- JobPosting FSM: draft → pending_review → active → closed ; any → rejected (moderation).
  status            text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','pending_review','active','closed','rejected')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_jobs_active
  ON public.connect_jobs (status, created_at DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_connect_jobs_company
  ON public.connect_jobs (company_page_id, status);

-- One active application per (job, applicant) — the UNIQUE constraint makes a second
-- concurrent application unreachable at the DB layer.
CREATE TABLE IF NOT EXISTS public.connect_job_applications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id             uuid NOT NULL REFERENCES public.connect_jobs(id) ON DELETE CASCADE,
  applicant_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resume_ref         text,
  cover_note         text,
  -- JobApplication FSM (§4).
  state              text NOT NULL DEFAULT 'draft'
                       CHECK (state IN ('draft','submitted','under_review','needs_info',
                         'shortlisted','interview','offered','hired','rejected','withdrawn')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, applicant_user_id)
);
CREATE INDEX IF NOT EXISTS idx_connect_job_apps_job
  ON public.connect_job_applications (job_id, state);
CREATE INDEX IF NOT EXISTS idx_connect_job_apps_applicant
  ON public.connect_job_applications (applicant_user_id, state);

-- Profile-level "Open to Work" signal (JB-07). Visible to recruiters only — never a
-- public-facing field, and no numeric/trust score (PN-1).
CREATE TABLE IF NOT EXISTS public.connect_open_to_work (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  open        boolean NOT NULL DEFAULT false,
  headline    text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- Referral bounties (single-level ONLY — PN-2)
-- ════════════════════════════════════════════════════════════════════════════

-- ReferralBounty FSM: REFERRED → APPLICATION_LINKED → HIRE_CONFIRMED → BOUNTY_PAYABLE → PAID
--                     any pre-HIRE_CONFIRMED state → EXPIRED
-- BOUNTY_PAYABLE → PAID is the ledger-writing transition, idempotency key = id (PN-10).
--
-- PN-2 (compliance line, NOT style): there is deliberately NO parent_bounty_id / source
-- referral column here. A referral-of-referral cannot be represented — a referrer is only
-- ever tied to a single job_application. Do not add such a column.
CREATE TABLE IF NOT EXISTS public.connect_referral_bounties (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_application_id   uuid REFERENCES public.connect_job_applications(id) ON DELETE SET NULL,
  amount_kobo          bigint NOT NULL CHECK (amount_kobo >= 0),
  state                text NOT NULL DEFAULT 'referred'
                         CHECK (state IN ('referred','application_linked','hire_confirmed',
                           'bounty_payable','paid','expired')),
  -- Set once the BOUNTY_PAYABLE → PAID ledger credit is posted (audit trail to the entry).
  ledger_entry_ref     text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_ref_bounties_referrer
  ON public.connect_referral_bounties (referrer_user_id, state);
CREATE INDEX IF NOT EXISTS idx_connect_ref_bounties_app
  ON public.connect_referral_bounties (job_application_id);
-- A single active bounty per (referrer, application) — no fan-out, reinforces single-level.
CREATE UNIQUE INDEX IF NOT EXISTS uq_connect_ref_bounty_referrer_app
  ON public.connect_referral_bounties (referrer_user_id, job_application_id)
  WHERE job_application_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- updated_at triggers (reuse generic public.handle_updated_at)
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'connect_company_pages','connect_jobs','connect_job_applications',
    'connect_open_to_work','connect_referral_bounties'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated ON public.%1$s', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated BEFORE UPDATE ON public.%1$s '
      'FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at()', t);
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — deny-by-default; service_role bypass on every table.
-- The Go service runs under service_role (money/state writes); authenticated
-- policies are the defence-in-depth read/own-write layer.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.connect_company_pages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_company_admins      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_company_followers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_jobs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_job_applications    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_open_to_work        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_referral_bounties   ENABLE ROW LEVEL SECURITY;

-- company pages: verified pages readable by anyone authed; page admins + platform admin manage.
DROP POLICY IF EXISTS connect_company_pages_read ON public.connect_company_pages;
CREATE POLICY connect_company_pages_read ON public.connect_company_pages
  FOR SELECT TO authenticated
  USING (claim_state = 'verified' OR public.is_admin()
         OR EXISTS (SELECT 1 FROM public.connect_company_admins a
                    WHERE a.company_page_id = connect_company_pages.id AND a.user_id = auth.uid()));
DROP POLICY IF EXISTS connect_company_pages_admin_write ON public.connect_company_pages;
CREATE POLICY connect_company_pages_admin_write ON public.connect_company_pages
  FOR ALL TO authenticated
  USING (public.is_admin()
         OR EXISTS (SELECT 1 FROM public.connect_company_admins a
                    WHERE a.company_page_id = connect_company_pages.id
                      AND a.user_id = auth.uid() AND a.role = 'company_page_admin'))
  WITH CHECK (public.is_admin()
         OR EXISTS (SELECT 1 FROM public.connect_company_admins a
                    WHERE a.company_page_id = connect_company_pages.id
                      AND a.user_id = auth.uid() AND a.role = 'company_page_admin'));
DROP POLICY IF EXISTS connect_company_pages_service ON public.connect_company_pages;
CREATE POLICY connect_company_pages_service ON public.connect_company_pages
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- company admins (object-scoped grants): the user sees own grants; page admin + platform admin manage.
DROP POLICY IF EXISTS connect_company_admins_read ON public.connect_company_admins;
CREATE POLICY connect_company_admins_read ON public.connect_company_admins
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin()
         OR EXISTS (SELECT 1 FROM public.connect_company_admins a2
                    WHERE a2.company_page_id = connect_company_admins.company_page_id
                      AND a2.user_id = auth.uid() AND a2.role = 'company_page_admin'));
DROP POLICY IF EXISTS connect_company_admins_service ON public.connect_company_admins;
CREATE POLICY connect_company_admins_service ON public.connect_company_admins
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- followers: a user manages own follow; page admins/platform admin read the list (CP-04).
DROP POLICY IF EXISTS connect_company_followers_owner ON public.connect_company_followers;
CREATE POLICY connect_company_followers_owner ON public.connect_company_followers
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS connect_company_followers_read ON public.connect_company_followers;
CREATE POLICY connect_company_followers_read ON public.connect_company_followers
  FOR SELECT TO authenticated
  USING (public.is_admin()
         OR EXISTS (SELECT 1 FROM public.connect_company_admins a
                    WHERE a.company_page_id = connect_company_followers.company_page_id
                      AND a.user_id = auth.uid()));
DROP POLICY IF EXISTS connect_company_followers_service ON public.connect_company_followers;
CREATE POLICY connect_company_followers_service ON public.connect_company_followers
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- jobs: active jobs readable by anyone authed; page admins/recruiters + platform admin manage.
DROP POLICY IF EXISTS connect_jobs_read ON public.connect_jobs;
CREATE POLICY connect_jobs_read ON public.connect_jobs
  FOR SELECT TO authenticated
  USING (status = 'active' OR public.is_admin()
         OR EXISTS (SELECT 1 FROM public.connect_company_admins a
                    WHERE a.company_page_id = connect_jobs.company_page_id AND a.user_id = auth.uid()));
DROP POLICY IF EXISTS connect_jobs_manage ON public.connect_jobs;
CREATE POLICY connect_jobs_manage ON public.connect_jobs
  FOR ALL TO authenticated
  USING (public.is_admin()
         OR EXISTS (SELECT 1 FROM public.connect_company_admins a
                    WHERE a.company_page_id = connect_jobs.company_page_id AND a.user_id = auth.uid()))
  WITH CHECK (public.is_admin()
         OR EXISTS (SELECT 1 FROM public.connect_company_admins a
                    WHERE a.company_page_id = connect_jobs.company_page_id AND a.user_id = auth.uid()));
DROP POLICY IF EXISTS connect_jobs_service ON public.connect_jobs;
CREATE POLICY connect_jobs_service ON public.connect_jobs
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- applications: applicant reads/creates own; recruiters of the job's company read; service updates state.
DROP POLICY IF EXISTS connect_job_apps_read ON public.connect_job_applications;
CREATE POLICY connect_job_apps_read ON public.connect_job_applications
  FOR SELECT TO authenticated
  USING (applicant_user_id = auth.uid() OR public.is_admin()
         OR EXISTS (SELECT 1 FROM public.connect_jobs j
                    JOIN public.connect_company_admins a ON a.company_page_id = j.company_page_id
                    WHERE j.id = connect_job_applications.job_id AND a.user_id = auth.uid()));
DROP POLICY IF EXISTS connect_job_apps_applicant_write ON public.connect_job_applications;
CREATE POLICY connect_job_apps_applicant_write ON public.connect_job_applications
  FOR INSERT TO authenticated WITH CHECK (applicant_user_id = auth.uid());
DROP POLICY IF EXISTS connect_job_apps_service ON public.connect_job_applications;
CREATE POLICY connect_job_apps_service ON public.connect_job_applications
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- open to work: owner manages own; recruiters/platform admin may read (visible to recruiters only).
DROP POLICY IF EXISTS connect_open_to_work_owner ON public.connect_open_to_work;
CREATE POLICY connect_open_to_work_owner ON public.connect_open_to_work
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS connect_open_to_work_recruiter_read ON public.connect_open_to_work;
CREATE POLICY connect_open_to_work_recruiter_read ON public.connect_open_to_work
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin()
         OR EXISTS (SELECT 1 FROM public.connect_company_admins a
                    WHERE a.user_id = auth.uid() AND a.role = 'recruiter'));
DROP POLICY IF EXISTS connect_open_to_work_service ON public.connect_open_to_work;
CREATE POLICY connect_open_to_work_service ON public.connect_open_to_work
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- referral bounties: referrer reads own; platform admin reads all (payout queue); writes service-only
-- (the ledger-writing PAID transition posts under service-role — never client-writable).
DROP POLICY IF EXISTS connect_ref_bounties_own ON public.connect_referral_bounties;
CREATE POLICY connect_ref_bounties_own ON public.connect_referral_bounties
  FOR SELECT TO authenticated USING (referrer_user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS connect_ref_bounties_service ON public.connect_referral_bounties;
CREATE POLICY connect_ref_bounties_service ON public.connect_referral_bounties
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- RBAC permissions (additive; ON CONFLICT DO NOTHING). Reuses the enterprise RBAC
-- tables from 20260527100000_enterprise_auth_rbac.sql. PN-9: these are capabilities
-- on the single identity, each independently grantable/revocable (per-row for object
-- scope via connect_company_admins).
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Administer Connect Company Page', 'connect.company.admin',   'connect', 'company_page', 'admin',  'Manage a claimed company page: team, recruiters, jobs', true),
  ('Manage Connect Job Postings',     'connect.recruiter.manage','connect', 'company_page', 'recruit','Post/manage jobs and applicant pipeline for a company page', true),
  ('Review Connect Company Claims',   'connect.company.review',  'connect', 'company_page', 'review', 'Approve/reject company page claims (business verification)', true)
ON CONFLICT (slug) DO NOTHING;

-- Platform review capability → super-admin, system-admin, connect-moderator.
WITH p AS (SELECT id FROM public.permissions WHERE slug = 'connect.company.review')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM p CROSS JOIN public.roles r
WHERE r.slug IN ('super-admin','system-admin','connect-moderator')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- The object-scoped capabilities (company.admin/recruiter.manage) are granted per company
-- page via connect_company_admins rows, not via a blanket role grant. Platform admins retain
-- them globally for support.
WITH p AS (SELECT id FROM public.permissions WHERE slug IN ('connect.company.admin','connect.recruiter.manage'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM p CROSS JOIN public.roles r
WHERE r.slug IN ('super-admin','system-admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
