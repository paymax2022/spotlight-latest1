-- Referral Earning System — TRUST/FINANCE half (RB2)
-- risk/fraud · compliance · finance/payouts · analytics.
-- Ref: docs/prd/referal/referral-PRD.md §6 (FR-RISK, FR-COMPLY, FR-FIN),
--      §8B (A-RSK, A-CMPL, A-FIN, A-BI, A-USR), §7A.6 (K-factor EXCLUDES house),
--      §10 (fraud/compliance by design);
--      docs/prd/referal/REFERRAL-BUILD-PLAN.md §3 (SHARED DB CONTRACT — RB0 owns
--        referral_reward_ledger / referral_attributions / referral_house_accounts /
--        referral_engine_events / referral_config; this migration REFERENCES them
--        by name and does NOT recreate them).
--
-- ADDITIVE-ONLY: CREATE TABLE/INDEX/POLICY IF NOT EXISTS, idempotent seeds.
--   NO DROP TABLE/COLUMN/TYPE, NO RENAME, NO type narrowing.
--   DROP POLICY IF EXISTS is used only to re-create policies idempotently.
-- Money columns are BIGINT kobo. FKs to auth.users(id). Reused helpers:
--   public.is_admin(), public.handle_updated_at(). RLS on every table with a
--   service_role bypass — the trust/finance engine writes via the service-role
--   backend. Never stores raw PII: identity dedup uses argon2id/sha256 hashes and
--   alerts carry reason codes only.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- RISK / FRAUD
-- ════════════════════════════════════════════════════════════════════════════

-- Configurable rules engine: KYC/BVN/NIN dedup, device fingerprint, velocity,
-- behavioural cohort. params jsonb holds per-rule thresholds (no client input).
CREATE TABLE IF NOT EXISTS public.referral_risk_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,                 -- stable rule code (kyc_dedup, device, velocity, cohort, self_referral)
  name          text NOT NULL,
  rule_type     text NOT NULL
                  CHECK (rule_type IN ('kyc_dedup','device','velocity','cohort','self_referral','blocklist')),
  enabled       boolean NOT NULL DEFAULT true,
  action        text NOT NULL DEFAULT 'review'
                  CHECK (action IN ('review','hold','clawback','block')),
  params        jsonb NOT NULL DEFAULT '{}'::jsonb,
  severity      text NOT NULL DEFAULT 'medium'
                  CHECK (severity IN ('low','medium','high','critical')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_risk_rules_enabled
  ON public.referral_risk_rules (enabled, rule_type);

-- Append-only fraud alerts. Reason codes + hashed/id references only — never PII.
CREATE TABLE IF NOT EXISTS public.referral_risk_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rule_code       text NOT NULL,
  reason_code     text NOT NULL,
  severity        text NOT NULL DEFAULT 'medium'
                    CHECK (severity IN ('low','medium','high','critical')),
  reward_id       uuid REFERENCES public.referral_reward_ledger(id) ON DELETE SET NULL,
  attribution_id  uuid REFERENCES public.referral_attributions(id) ON DELETE SET NULL,
  identity_hash   text,                               -- argon2id/sha256, never raw BVN/NIN
  device_hash     text,                               -- hashed device fingerprint, never raw
  window_count    int  NOT NULL DEFAULT 1,
  status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','reviewing','dismissed','confirmed')),
  case_id         uuid,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_risk_alerts_subject
  ON public.referral_risk_alerts (subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_risk_alerts_status
  ON public.referral_risk_alerts (status, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_risk_alerts_reward
  ON public.referral_risk_alerts (reward_id);

-- Investigation cases (workbench). Append + forward-only status transitions.
CREATE TABLE IF NOT EXISTS public.referral_cases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','investigating','resolved','escalated')),
  reason_codes  text[] NOT NULL DEFAULT '{}',
  resolution    text,
  opened_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_referral_cases_status
  ON public.referral_cases (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_cases_subject
  ON public.referral_cases (subject_id, created_at DESC);

-- Block / allow list. entry_type distinguishes the listed dimension; entry_value
-- is a user id or a hash — never raw PII.
CREATE TABLE IF NOT EXISTS public.referral_blocklist (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_type    text NOT NULL DEFAULT 'block'
                 CHECK (list_type IN ('block','allow')),
  entry_type   text NOT NULL
                 CHECK (entry_type IN ('user','identity_hash','device_hash','ip_hash','email_hash')),
  entry_value  text NOT NULL,                         -- user id or hash — never raw PII
  reason       text,
  added_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (list_type, entry_type, entry_value)
);
CREATE INDEX IF NOT EXISTS idx_referral_blocklist_lookup
  ON public.referral_blocklist (entry_type, entry_value, active);

-- Review queue: rewards held pending a human decision (ledger stays 'pending').
CREATE TABLE IF NOT EXISTS public.referral_review_queue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_id     uuid REFERENCES public.referral_reward_ledger(id) ON DELETE CASCADE,
  subject_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  alert_id      uuid REFERENCES public.referral_risk_alerts(id) ON DELETE SET NULL,
  reason_code   text NOT NULL,
  status        text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','approved','rejected','clawed_back')),
  decided_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_review_queue_status
  ON public.referral_review_queue (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_review_queue_reward
  ON public.referral_review_queue (reward_id);

-- ════════════════════════════════════════════════════════════════════════════
-- COMPLIANCE
-- ════════════════════════════════════════════════════════════════════════════

-- Versioned disclosures / T&Cs (earning disclosures, override disclosures).
CREATE TABLE IF NOT EXISTS public.referral_disclosures (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL,                        -- e.g. earning_terms, override_disclosure
  version       int  NOT NULL DEFAULT 1 CHECK (version >= 1),
  title         text NOT NULL,
  body          text NOT NULL,
  jurisdiction  text NOT NULL DEFAULT 'NG',
  active        boolean NOT NULL DEFAULT true,
  effective_at  timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug, version)
);
CREATE INDEX IF NOT EXISTS idx_referral_disclosures_active
  ON public.referral_disclosures (slug, active, version DESC);

-- NDPC consent capture (data-processing / marketing / earnings disclosures).
CREATE TABLE IF NOT EXISTS public.referral_consents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  disclosure_id  uuid REFERENCES public.referral_disclosures(id) ON DELETE SET NULL,
  consent_type   text NOT NULL
                   CHECK (consent_type IN ('ndpc_data','earnings_terms','marketing','override_disclosure')),
  granted        boolean NOT NULL DEFAULT true,
  version        int,
  source         text,                                -- e.g. signup, settings, claim
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, consent_type, version)
);
CREATE INDEX IF NOT EXISTS idx_referral_consents_user
  ON public.referral_consents (user_id, consent_type);

-- AML flags specific to referral earnings (mirrors connect AML alert shape).
CREATE TABLE IF NOT EXISTS public.referral_aml_flags (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason_code   text NOT NULL,                        -- THRESHOLD_EXCEEDED, VELOCITY, STRUCTURING
  amount_kobo   bigint NOT NULL DEFAULT 0 CHECK (amount_kobo >= 0),
  window_count  int  NOT NULL DEFAULT 1,
  status        text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','reviewing','cleared','reported')),
  reward_id     uuid REFERENCES public.referral_reward_ledger(id) ON DELETE SET NULL,
  reported_ref  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_aml_flags_subject
  ON public.referral_aml_flags (subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_aml_flags_status
  ON public.referral_aml_flags (status, created_at DESC);

-- Activity-based-earning / structural policy consumed by override + reward engines.
-- Singleton keyed policy values (pyramid-line depth cap, tier cap, jurisdiction).
CREATE TABLE IF NOT EXISTS public.referral_policy (
  id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
  max_pyramid_depth   int  NOT NULL DEFAULT 2  CHECK (max_pyramid_depth >= 0),   -- override line cap (anti-pyramid)
  tier_cap_kobo       bigint NOT NULL DEFAULT 0 CHECK (tier_cap_kobo >= 0),      -- 0 = no cap
  require_activity    boolean NOT NULL DEFAULT true,                             -- activity-based earning required
  allowed_jurisdictions text[] NOT NULL DEFAULT ARRAY['NG'],
  updated_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- FINANCE / PAYOUTS
-- ════════════════════════════════════════════════════════════════════════════

-- Payout queue + approvals. Tier/KYC gated, idempotent; on approval posts via the
-- finance ledger to the beneficiary wallet (recorded reward_id → reward_ledger).
CREATE TABLE IF NOT EXISTS public.referral_payouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beneficiary_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reward_id       uuid REFERENCES public.referral_reward_ledger(id) ON DELETE SET NULL,
  amount_kobo     bigint NOT NULL CHECK (amount_kobo > 0),
  currency        text NOT NULL DEFAULT 'NGN',
  status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','approved','paid','rejected','failed')),
  requested_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ledger_entry_id text,                               -- finance ledger idempotency ref
  idempotency_key text NOT NULL UNIQUE,
  reject_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_referral_payouts_beneficiary
  ON public.referral_payouts (beneficiary_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_payouts_status
  ON public.referral_payouts (status, created_at DESC);

-- Reconciliation snapshots: reward ledger eligible/paid ↔ wallet payout postings.
CREATE TABLE IF NOT EXISTS public.referral_reconciliation (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start       timestamptz NOT NULL,
  period_end         timestamptz NOT NULL,
  ledger_paid_kobo   bigint NOT NULL DEFAULT 0,
  wallet_paid_kobo   bigint NOT NULL DEFAULT 0,
  variance_kobo      bigint NOT NULL DEFAULT 0,
  status             text NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','balanced','variance')),
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_reconciliation_period
  ON public.referral_reconciliation (period_end DESC);

-- Budget envelopes + burn tracking per program/campaign/region.
CREATE TABLE IF NOT EXISTS public.referral_budgets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope           text NOT NULL DEFAULT 'program'
                    CHECK (scope IN ('program','campaign','region')),
  scope_ref       text,                               -- campaign id / region code / 'global'
  budget_kobo     bigint NOT NULL CHECK (budget_kobo >= 0),
  spent_kobo      bigint NOT NULL DEFAULT 0 CHECK (spent_kobo >= 0),
  alert_threshold_pct int NOT NULL DEFAULT 80 CHECK (alert_threshold_pct BETWEEN 0 AND 100),
  period_start    timestamptz,
  period_end      timestamptz,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, scope_ref)
);
CREATE INDEX IF NOT EXISTS idx_referral_budgets_active
  ON public.referral_budgets (active, scope);

-- Float positions: liability/funding snapshots for the reward program.
CREATE TABLE IF NOT EXISTS public.referral_float (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_kobo   bigint NOT NULL DEFAULT 0,           -- can be negative (net liability)
  liability_kobo  bigint NOT NULL DEFAULT 0 CHECK (liability_kobo >= 0),
  funded_kobo     bigint NOT NULL DEFAULT 0 CHECK (funded_kobo >= 0),
  as_of           timestamptz NOT NULL DEFAULT now(),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_float_asof
  ON public.referral_float (as_of DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- updated_at triggers (reuse generic public.handle_updated_at)
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'referral_risk_rules','referral_cases','referral_policy',
    'referral_payouts','referral_budgets'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated ON public.%1$s', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated BEFORE UPDATE ON public.%1$s '
      'FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at()', t);
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — deny-by-default; service_role bypass on every table.
-- Admin reads via public.is_admin(); members read only their own rows where it
-- makes sense (alerts/consents/payouts). Writes are service-only (engine).
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.referral_risk_rules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_risk_alerts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_cases          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_blocklist      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_review_queue   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_disclosures    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_consents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_aml_flags      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_policy         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_payouts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_budgets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_float          ENABLE ROW LEVEL SECURITY;

-- risk rules: admin reads; writes service-only.
DROP POLICY IF EXISTS referral_risk_rules_admin ON public.referral_risk_rules;
CREATE POLICY referral_risk_rules_admin ON public.referral_risk_rules
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS referral_risk_rules_service ON public.referral_risk_rules;
CREATE POLICY referral_risk_rules_service ON public.referral_risk_rules
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- risk alerts: subject reads own (my fraud-status); admin reads all; service writes.
DROP POLICY IF EXISTS referral_risk_alerts_own ON public.referral_risk_alerts;
CREATE POLICY referral_risk_alerts_own ON public.referral_risk_alerts
  FOR SELECT TO authenticated
  USING (subject_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS referral_risk_alerts_service ON public.referral_risk_alerts;
CREATE POLICY referral_risk_alerts_service ON public.referral_risk_alerts
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- cases: admin reads; service writes.
DROP POLICY IF EXISTS referral_cases_admin ON public.referral_cases;
CREATE POLICY referral_cases_admin ON public.referral_cases
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS referral_cases_service ON public.referral_cases;
CREATE POLICY referral_cases_service ON public.referral_cases
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- blocklist: admin reads; service writes.
DROP POLICY IF EXISTS referral_blocklist_admin ON public.referral_blocklist;
CREATE POLICY referral_blocklist_admin ON public.referral_blocklist
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS referral_blocklist_service ON public.referral_blocklist;
CREATE POLICY referral_blocklist_service ON public.referral_blocklist
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- review queue: admin reads; service writes.
DROP POLICY IF EXISTS referral_review_queue_admin ON public.referral_review_queue;
CREATE POLICY referral_review_queue_admin ON public.referral_review_queue
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS referral_review_queue_service ON public.referral_review_queue;
CREATE POLICY referral_review_queue_service ON public.referral_review_queue
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- disclosures: active disclosures readable by any authenticated user; admin reads
-- all; service writes.
DROP POLICY IF EXISTS referral_disclosures_read ON public.referral_disclosures;
CREATE POLICY referral_disclosures_read ON public.referral_disclosures
  FOR SELECT TO authenticated USING (active OR public.is_admin());
DROP POLICY IF EXISTS referral_disclosures_service ON public.referral_disclosures;
CREATE POLICY referral_disclosures_service ON public.referral_disclosures
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- consents: user reads own; admin reads all; service writes.
DROP POLICY IF EXISTS referral_consents_own ON public.referral_consents;
CREATE POLICY referral_consents_own ON public.referral_consents
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS referral_consents_service ON public.referral_consents;
CREATE POLICY referral_consents_service ON public.referral_consents
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- aml flags: admin reads; service writes.
DROP POLICY IF EXISTS referral_aml_flags_admin ON public.referral_aml_flags;
CREATE POLICY referral_aml_flags_admin ON public.referral_aml_flags
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS referral_aml_flags_service ON public.referral_aml_flags;
CREATE POLICY referral_aml_flags_service ON public.referral_aml_flags
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- policy: admin reads; service writes.
DROP POLICY IF EXISTS referral_policy_admin ON public.referral_policy;
CREATE POLICY referral_policy_admin ON public.referral_policy
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS referral_policy_service ON public.referral_policy;
CREATE POLICY referral_policy_service ON public.referral_policy
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- payouts: beneficiary reads own; admin reads all; service writes.
DROP POLICY IF EXISTS referral_payouts_own ON public.referral_payouts;
CREATE POLICY referral_payouts_own ON public.referral_payouts
  FOR SELECT TO authenticated
  USING (beneficiary_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS referral_payouts_service ON public.referral_payouts;
CREATE POLICY referral_payouts_service ON public.referral_payouts
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- reconciliation: admin reads; service writes.
DROP POLICY IF EXISTS referral_reconciliation_admin ON public.referral_reconciliation;
CREATE POLICY referral_reconciliation_admin ON public.referral_reconciliation
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS referral_reconciliation_service ON public.referral_reconciliation;
CREATE POLICY referral_reconciliation_service ON public.referral_reconciliation
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- budgets: admin reads; service writes.
DROP POLICY IF EXISTS referral_budgets_admin ON public.referral_budgets;
CREATE POLICY referral_budgets_admin ON public.referral_budgets
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS referral_budgets_service ON public.referral_budgets;
CREATE POLICY referral_budgets_service ON public.referral_budgets
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- float: admin reads; service writes.
DROP POLICY IF EXISTS referral_float_admin ON public.referral_float;
CREATE POLICY referral_float_admin ON public.referral_float
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS referral_float_service ON public.referral_float;
CREATE POLICY referral_float_service ON public.referral_float
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- RBAC permissions (additive; ON CONFLICT DO NOTHING).
-- Reuses the enterprise RBAC tables from 20260527100000_enterprise_auth_rbac.sql.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('View Referral Risk',         'referral.risk.view',        'referral', 'risk',       'view',     'View referral fraud dashboard/alerts/cases',         true),
  ('Manage Referral Risk',       'referral.risk.manage',      'referral', 'risk',       'manage',   'Manage rules/cases/review-queue/clawbacks',          true),
  ('Manage Referral Blocklist',  'referral.risk.blocklist',   'referral', 'risk',       'blocklist','Manage referral block/allow list',                   true),
  ('View Referral Compliance',   'referral.compliance.view',  'referral', 'compliance', 'view',     'View disclosures/consents/AML/claims/reports',       true),
  ('Manage Referral Compliance', 'referral.compliance.manage','referral', 'compliance', 'manage',   'Version disclosures, manage consents/AML/policy',    true),
  ('Manage Referral Payouts',    'referral.payout.manage',    'referral', 'payout',     'manage',   'Approve/reject/execute referral payouts',            true),
  ('View Referral Payouts',      'referral.payout.view',      'referral', 'payout',     'view',     'View referral payout queue + history',               true),
  ('View Referral Finance',      'referral.finance.view',     'referral', 'finance',    'view',     'View reconciliation/budgets/float/burn',             true),
  ('View Referral Analytics',    'referral.analytics.view',   'referral', 'analytics',  'view',     'View K-factor/funnel/CAC/LTV/segmentation',          true),
  ('View Referral Users',        'referral.users.view',       'referral', 'users',      'view',     'View user-360 referral profile (A-USR-01)',          true)
ON CONFLICT (slug) DO NOTHING;

-- Grant the full referral trust/finance set to super-admin and system-admin.
WITH p AS (SELECT id FROM public.permissions WHERE slug IN
  ('referral.risk.view','referral.risk.manage','referral.risk.blocklist',
   'referral.compliance.view','referral.compliance.manage',
   'referral.payout.manage','referral.payout.view','referral.finance.view',
   'referral.analytics.view','referral.users.view'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug IN
  ('referral.risk.view','referral.risk.manage','referral.risk.blocklist',
   'referral.compliance.view','referral.compliance.manage',
   'referral.payout.manage','referral.payout.view','referral.finance.view',
   'referral.analytics.view','referral.users.view'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- SEEDS — default risk rules, policy singleton, default disclosures (idempotent).
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.referral_risk_rules (code, name, rule_type, enabled, action, severity, params)
VALUES
  ('kyc_dedup', 'KYC identity dedup (one earning identity per human)', 'kyc_dedup', true, 'hold', 'high',
     '{"hash_source":"finance_kyc","scope":"bvn_or_nin"}'::jsonb),
  ('device_fingerprint', 'Shared device fingerprint', 'device', true, 'review', 'medium',
     '{"max_accounts_per_device":3}'::jsonb),
  ('signup_velocity', 'Signup velocity burst per referrer', 'velocity', true, 'review', 'medium',
     '{"window_hours":24,"max_signups":25}'::jsonb),
  ('self_referral', 'Self-referral detection', 'self_referral', true, 'block', 'high',
     '{"route_to_house":true}'::jsonb)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.referral_policy (id, max_pyramid_depth, tier_cap_kobo, require_activity, allowed_jurisdictions)
VALUES (true, 2, 0, true, ARRAY['NG'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.referral_disclosures (slug, version, title, body, jurisdiction, active)
VALUES
  ('earning_terms', 1, 'Referral Earning Terms',
     'Referral rewards are activity-based, paid in NGN to your wallet subject to KYC and tier limits, and may be clawed back for fraud or invalid attribution.',
     'NG', true),
  ('override_disclosure', 1, 'Ambassador/Agent Override Disclosure',
     'Override earnings are capped, activity-based, and exclude house-default attributions. They are not a multi-level marketing scheme; payouts require qualifying downline activity.',
     'NG', true)
ON CONFLICT (slug, version) DO NOTHING;

COMMIT;
