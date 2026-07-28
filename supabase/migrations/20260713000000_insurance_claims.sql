-- Paymax Insurance / Protection — Claims + Embedded + Webhooks + Reconciliation
-- Ref: docs/prd/Insurance/PRD_Paymax_Microinsurance_Integration.md
--      §10.2 (claim lifecycle), §10.3 (embedded bind), §11 (money/ledger),
--      §12.2/§12.3 (events/webhooks), §17 (reconciliation), §B (webhook catalog).
-- Builds on 20260712000000_insurance_core.sql (IB0). REFERENCES, never recreates,
-- public.insurance_policy / public.insurance_premium_transaction.
--
-- ADDITIVE-ONLY: CREATE TABLE/INDEX/POLICY IF NOT EXISTS, idempotent seeds.
--   NO DROP TABLE/COLUMN/TYPE, NO RENAME, NO type narrowing.
--   DROP POLICY IF EXISTS is used only to re-create policies idempotently.
-- Money columns are BIGINT kobo (minor units). FKs to auth.users(id) +
-- public.insurance_policy(id). Money movement REUSES the finance ledger/wallet;
-- these tables carry ONLY domain references to posted ledger entries — never a
-- balance column. Reuses public.is_admin() + public.handle_updated_at().

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- CLAIM — guarded lifecycle projection (state machine lives in the backend).
-- DRAFT → FNOL_SUBMITTED → UNDER_ASSESSMENT → {NEEDS_MORE_INFO ⇄, APPROVED →
--   PAYOUT_PENDING → SETTLED, REJECTED}. Payout idempotent on idempotency_key.
-- provider_claim_ref is UNIQUE per provider (set after FNOL hand-off).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.insurance_claim (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id            uuid NOT NULL REFERENCES public.insurance_policy(id) ON DELETE CASCADE,
  claimant_user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider             text NOT NULL,                       -- aggregator
  provider_claim_ref   text,                                -- NULL until provider hand-off
  state                text NOT NULL DEFAULT 'DRAFT'
                         CHECK (state IN ('DRAFT','FNOL_SUBMITTED','UNDER_ASSESSMENT',
                                          'NEEDS_MORE_INFO','APPROVED','PAYOUT_PENDING',
                                          'SETTLED','REJECTED')),
  loss_event_at        timestamptz NOT NULL,
  reported_at          timestamptz NOT NULL DEFAULT now(),
  description          text NOT NULL DEFAULT '',
  claimed_amount_kobo  bigint NOT NULL DEFAULT 0 CHECK (claimed_amount_kobo >= 0),
  approved_amount_kobo bigint NOT NULL DEFAULT 0 CHECK (approved_amount_kobo >= 0),
  currency             text NOT NULL DEFAULT 'NGN',
  payout_ledger_ref    text,                                -- set on SETTLED (nullable)
  idempotency_key      text NOT NULL UNIQUE,                -- FNOL + payout idempotency
  version              int NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
-- One provider claim ref is unique per aggregator.
CREATE UNIQUE INDEX IF NOT EXISTS uq_insurance_claim_provider_ref
  ON public.insurance_claim (provider, provider_claim_ref)
  WHERE provider_claim_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_insurance_claim_claimant_state
  ON public.insurance_claim (claimant_user_id, state);
CREATE INDEX IF NOT EXISTS idx_insurance_claim_policy
  ON public.insurance_claim (policy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_insurance_claim_state
  ON public.insurance_claim (state);

-- ════════════════════════════════════════════════════════════════════════════
-- CLAIM EVIDENCE — signed-URL object refs only (bytes never touch the backend).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.insurance_claim_evidence (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id      uuid NOT NULL REFERENCES public.insurance_claim(id) ON DELETE CASCADE,
  file_name     text NOT NULL,
  content_type  text NOT NULL DEFAULT '',
  storage_ref   text NOT NULL,                              -- R2 object key (not bytes)
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_claim_evidence_claim
  ON public.insurance_claim_evidence (claim_id, created_at);

-- ════════════════════════════════════════════════════════════════════════════
-- CLAIM PAYOUT — domain record of each payout money move; references the ledger
-- entry. idempotency_key UNIQUE makes a retried settlement a safe no-op.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.insurance_claim_payout (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id          uuid NOT NULL REFERENCES public.insurance_claim(id) ON DELETE CASCADE,
  wallet_ledger_ref text NOT NULL,
  idempotency_key   text NOT NULL UNIQUE,
  amount_kobo       bigint NOT NULL CHECK (amount_kobo >= 0),
  status            text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted')),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_claim_payout_claim
  ON public.insurance_claim_payout (claim_id);

-- ════════════════════════════════════════════════════════════════════════════
-- PROVIDER EVENT — webhook idempotency ledger. UNIQUE(provider, external_event_id)
-- drops duplicate provider webhooks. No raw PII / no raw JSON stored.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.insurance_provider_event (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text NOT NULL,
  external_event_id text NOT NULL,
  event_type        text NOT NULL DEFAULT '',
  received_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_event_id)
);
CREATE INDEX IF NOT EXISTS idx_insurance_provider_event_type
  ON public.insurance_provider_event (provider, event_type, received_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- COMMISSION ENTRY — domain record of commission postings on the SEPARATE
-- commission ledger account. idempotency_key UNIQUE; status confirm/reverse.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.insurance_commission_entry (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id       uuid NOT NULL REFERENCES public.insurance_policy(id) ON DELETE CASCADE,
  provider        text NOT NULL,
  amount_kobo     bigint NOT NULL DEFAULT 0 CHECK (amount_kobo >= 0),
  ledger_ref      text NOT NULL DEFAULT '',
  idempotency_key text NOT NULL UNIQUE,
  status          text NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','CONFIRMED','REVERSED')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_commission_entry_policy
  ON public.insurance_commission_entry (policy_id);
CREATE INDEX IF NOT EXISTS idx_insurance_commission_entry_status
  ON public.insurance_commission_entry (status, provider);

-- ════════════════════════════════════════════════════════════════════════════
-- RECONCILIATION RECORD — premium↔provider-statement match attempts; breaks are
-- worked in the admin workbench.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.insurance_reconciliation_record (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider              text NOT NULL,
  policy_id             uuid REFERENCES public.insurance_policy(id) ON DELETE SET NULL,
  premium_tx_id         uuid REFERENCES public.insurance_premium_transaction(id) ON DELETE SET NULL,
  statement_ref         text NOT NULL DEFAULT '',
  expected_amount_kobo  bigint NOT NULL DEFAULT 0,
  statement_amount_kobo bigint NOT NULL DEFAULT 0,
  status                text NOT NULL DEFAULT 'BREAK'
                          CHECK (status IN ('MATCHED','BREAK','RESOLVED')),
  break_reason          text NOT NULL DEFAULT '',
  resolution_note       text NOT NULL DEFAULT '',
  created_at            timestamptz NOT NULL DEFAULT now(),
  resolved_at          timestamptz
);
CREATE INDEX IF NOT EXISTS idx_insurance_reconciliation_status
  ON public.insurance_reconciliation_record (status, provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_insurance_reconciliation_policy
  ON public.insurance_reconciliation_record (policy_id);

-- ════════════════════════════════════════════════════════════════════════════
-- updated_at triggers (reuse the shared helper).
-- ════════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_insurance_claim_updated ON public.insurance_claim;
CREATE TRIGGER trg_insurance_claim_updated BEFORE UPDATE ON public.insurance_claim
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_insurance_commission_entry_updated ON public.insurance_commission_entry;
CREATE TRIGGER trg_insurance_commission_entry_updated BEFORE UPDATE ON public.insurance_commission_entry
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — deny-by-default; owner SELECT; service_role bypass.
-- The engine writes via the service-role connection (pgx pool); admin reads go
-- through is_admin(). Internal/back-office tables are admin/service only.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.insurance_claim                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_claim_evidence         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_claim_payout           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_provider_event         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_commission_entry       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_reconciliation_record  ENABLE ROW LEVEL SECURITY;

-- Claim: claimant select (object-level ownership) + admin.
DROP POLICY IF EXISTS insurance_claim_own ON public.insurance_claim;
CREATE POLICY insurance_claim_own ON public.insurance_claim
  FOR SELECT TO authenticated USING (claimant_user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS insurance_claim_service ON public.insurance_claim;
CREATE POLICY insurance_claim_service ON public.insurance_claim
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Claim evidence: claimant-of-claim select; service_role full.
DROP POLICY IF EXISTS insurance_claim_evidence_own ON public.insurance_claim_evidence;
CREATE POLICY insurance_claim_evidence_own ON public.insurance_claim_evidence
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.insurance_claim c
      WHERE c.id = insurance_claim_evidence.claim_id
        AND c.claimant_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS insurance_claim_evidence_service ON public.insurance_claim_evidence;
CREATE POLICY insurance_claim_evidence_service ON public.insurance_claim_evidence
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Claim payout: claimant-of-claim select; service_role full.
DROP POLICY IF EXISTS insurance_claim_payout_own ON public.insurance_claim_payout;
CREATE POLICY insurance_claim_payout_own ON public.insurance_claim_payout
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.insurance_claim c
      WHERE c.id = insurance_claim_payout.claim_id
        AND c.claimant_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS insurance_claim_payout_service ON public.insurance_claim_payout;
CREATE POLICY insurance_claim_payout_service ON public.insurance_claim_payout
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Provider event: admin select only; service_role full.
DROP POLICY IF EXISTS insurance_provider_event_admin ON public.insurance_provider_event;
CREATE POLICY insurance_provider_event_admin ON public.insurance_provider_event
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS insurance_provider_event_service ON public.insurance_provider_event;
CREATE POLICY insurance_provider_event_service ON public.insurance_provider_event
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Commission entry: admin select only; service_role full.
DROP POLICY IF EXISTS insurance_commission_entry_admin ON public.insurance_commission_entry;
CREATE POLICY insurance_commission_entry_admin ON public.insurance_commission_entry
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS insurance_commission_entry_service ON public.insurance_commission_entry;
CREATE POLICY insurance_commission_entry_service ON public.insurance_commission_entry
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Reconciliation record: admin select only; service_role full.
DROP POLICY IF EXISTS insurance_reconciliation_admin ON public.insurance_reconciliation_record;
CREATE POLICY insurance_reconciliation_admin ON public.insurance_reconciliation_record
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS insurance_reconciliation_service ON public.insurance_reconciliation_record;
CREATE POLICY insurance_reconciliation_service ON public.insurance_reconciliation_record
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- RBAC permissions (additive; ON CONFLICT DO NOTHING). The insurance.claim.*,
-- insurance.reconciliation.*, insurance.commission.view perms were seeded by IB0
-- (20260712000000_insurance_core.sql); this block adds the finer-grained
-- claim search/decide perms used by the claims layer and re-grants idempotently.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Search Insurance Claims',  'insurance.claim.search',  'insurance','claim','search', 'Search claims across users',            true),
  ('Decide Insurance Claims',  'insurance.claim.decide',  'insurance','claim','decide', 'Assess/approve/reject/settle a claim',  true)
ON CONFLICT (slug) DO NOTHING;

-- Grant the full insurance.* set (incl. the two new perms) to super-admin and
-- system-admin (idempotent).
WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'insurance.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'insurance.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
