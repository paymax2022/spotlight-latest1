-- Direct Referral Rewards ENGINE — single-level, purchase-triggered revenue share.
-- Ref: docs/prd/referal/Spotlight-Direct-Referral-Rewards-Master-PRD.md
--      §2 (reward mechanics), §3 (data model), §4 (state machines), §7 (endpoints).
--
-- SUPERSEDES the older house-accounts/reassignment model (20260706 referral_core,
-- 20260707 referral_econ/trust) with a NO-NETWORK-DEPTH design. This migration is
-- ADDITIVE ONLY: it CREATEs new tables and REUSES the existing
-- public.referral_attributions table (referrer_id, referred_user_id) untouched.
--
--   NO DROP TABLE/COLUMN/TYPE, NO RENAME, NO type narrowing.
--   DROP POLICY IF EXISTS is used only to re-create policies idempotently.
-- Money columns are BIGINT kobo (integer minor units — the PRD writes ₦, stored ×100).
-- FKs to auth.users(id). RLS deny-by-default with a service_role bypass on every
-- table; the engine writes via the service-role backend / pgx pool.
--
-- §3 invariants encoded here:
--   * source_transaction_id UNIQUE in referral_rewards — one reward per purchase, ever.
--   * a reward only exists where a referral_attributions row exists for the payer
--     (enforced in the service layer; the FK-less source_transaction_id keeps the
--      engine decoupled from any specific module's transactions table).
--   * config changes are NEW versioned rows, effective_from forward — never retroactive.
--   * milestone idempotency_key UNIQUE — one payout per (referrer_id, threshold), ever.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- LINKS — one referral code per referrer (distinct from the older
-- finance_referral_codes seed; this is the engine's canonical code table).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.referral_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id  uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  code         text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_links_code
  ON public.referral_links (code);

-- ════════════════════════════════════════════════════════════════════════════
-- REWARDS — per-purchase ongoing-share accruals (kobo). source_transaction_id is
-- the idempotency anchor (one reward per settled purchase). status is the reward
-- state machine (PENDING → CREDITED → REVERSED).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.referral_rewards (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- text (not uuid FK) so the engine stays decoupled from any module's txn table.
  source_transaction_id text NOT NULL UNIQUE,
  module                text NOT NULL,
  margin_kobo           bigint NOT NULL CHECK (margin_kobo >= 0),
  applied_rate          numeric NOT NULL CHECK (applied_rate >= 0),  -- tier rate at txn time (e.g. 0.05)
  reward_kobo           bigint NOT NULL CHECK (reward_kobo >= 0),    -- floor(margin_kobo * applied_rate)
  status                text NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','CREDITED','REVERSED')),
  config_version        int NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  credited_at           timestamptz,
  reversed_at           timestamptz
);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer
  ON public.referral_rewards (referrer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_referred
  ON public.referral_rewards (referred_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_module
  ON public.referral_rewards (module, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_status
  ON public.referral_rewards (status, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- TIER STATUS — one row per referrer; the rolling active-count + current rate the
-- engine applies to FUTURE transactions. Recomputed nightly (§5.2 / §4.3).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.referral_tier_status (
  referrer_id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  active_referral_count int NOT NULL DEFAULT 0 CHECK (active_referral_count >= 0),
  current_tier          text NOT NULL DEFAULT 'STARTER'
                          CHECK (current_tier IN ('STARTER','GROWTH','PRO','ELITE')),
  current_rate          numeric NOT NULL DEFAULT 0.05 CHECK (current_rate >= 0),
  last_recalculated_at  timestamptz NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- MILESTONES — one-time count-threshold bonuses (kobo). idempotency_key UNIQUE is
-- one payout per (referrer_id, threshold), ever. status: ACHIEVED → PAID / VOIDED.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.referral_milestones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  threshold       int NOT NULL CHECK (threshold > 0),
  bonus_kobo      bigint NOT NULL CHECK (bonus_kobo >= 0),
  status          text NOT NULL DEFAULT 'ACHIEVED'
                    CHECK (status IN ('ACHIEVED','PAID','VOIDED')),
  idempotency_key text NOT NULL UNIQUE,   -- 'referral:milestone:<referrer>:<threshold>'
  achieved_at     timestamptz NOT NULL DEFAULT now(),
  paid_at         timestamptz,
  voided_at       timestamptz,
  UNIQUE (referrer_id, threshold)
);
CREATE INDEX IF NOT EXISTS idx_referral_milestones_referrer
  ON public.referral_milestones (referrer_id, achieved_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_milestones_status
  ON public.referral_milestones (status, achieved_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- PROGRAM CONFIG — versioned, admin-editable tier/milestone tables. A new version
-- is a NEW row with a later effective_from; the engine reads the active version
-- whose effective_from <= now(). Never retroactively recomputes past rewards.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.referral_program_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version         int NOT NULL UNIQUE,
  tier_table      jsonb NOT NULL,   -- [{tier,min_count,max_count,rate}, ...]  (max_count null = open-ended)
  milestone_table jsonb NOT NULL,   -- [{threshold,bonus_kobo}, ...]
  is_active       boolean NOT NULL DEFAULT true,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_program_config_effective
  ON public.referral_program_config (effective_from DESC, version DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- FRAUD QUEUE (A3) — thin table so the fraud-queue admin endpoints have durable
-- storage. Flags are inserted by future anti-abuse jobs; admins clear/action them.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.referral_fraud_flags (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  referred_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason            text NOT NULL,
  evidence          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            text NOT NULL DEFAULT 'OPEN'
                      CHECK (status IN ('OPEN','CLEARED','VOIDED','SUSPENDED')),
  reviewed_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_note       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  reviewed_at       timestamptz
);
CREATE INDEX IF NOT EXISTS idx_referral_fraud_flags_status
  ON public.referral_fraud_flags (status, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- CASE ADJUSTMENTS (A5) — audit trail for manual reward adjustments. Every manual
-- adjust requires a logged reason; never a silent edit.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.referral_case_adjustments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  adjust_kobo     bigint NOT NULL,   -- signed: positive credit, negative debit
  reason          text NOT NULL,
  adjusted_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_case_adjustments_referrer
  ON public.referral_case_adjustments (referrer_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — deny-by-default; service_role bypass on every table.
-- User-owned rows readable by the owner; admin reads governed via is_admin().
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.referral_links            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_rewards          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_tier_status      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_milestones       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_program_config   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_fraud_flags      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_case_adjustments ENABLE ROW LEVEL SECURITY;

-- links: referrer reads own; admin reads all; writes service-only.
DROP POLICY IF EXISTS referral_links_own ON public.referral_links;
CREATE POLICY referral_links_own ON public.referral_links
  FOR SELECT TO authenticated USING (referrer_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS referral_links_service ON public.referral_links;
CREATE POLICY referral_links_service ON public.referral_links
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- rewards: referrer reads own; admin reads all; writes service-only.
DROP POLICY IF EXISTS referral_rewards_own ON public.referral_rewards;
CREATE POLICY referral_rewards_own ON public.referral_rewards
  FOR SELECT TO authenticated USING (referrer_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS referral_rewards_service ON public.referral_rewards;
CREATE POLICY referral_rewards_service ON public.referral_rewards
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- tier status: referrer reads own; admin reads all; writes service-only.
DROP POLICY IF EXISTS referral_tier_status_own ON public.referral_tier_status;
CREATE POLICY referral_tier_status_own ON public.referral_tier_status
  FOR SELECT TO authenticated USING (referrer_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS referral_tier_status_service ON public.referral_tier_status;
CREATE POLICY referral_tier_status_service ON public.referral_tier_status
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- milestones: referrer reads own; admin reads all; writes service-only.
DROP POLICY IF EXISTS referral_milestones_own ON public.referral_milestones;
CREATE POLICY referral_milestones_own ON public.referral_milestones
  FOR SELECT TO authenticated USING (referrer_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS referral_milestones_service ON public.referral_milestones;
CREATE POLICY referral_milestones_service ON public.referral_milestones
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- program config: any authenticated member reads the active config (explainer
-- screen); admin reads all; writes service-only.
DROP POLICY IF EXISTS referral_program_config_read ON public.referral_program_config;
CREATE POLICY referral_program_config_read ON public.referral_program_config
  FOR SELECT TO authenticated USING (is_active OR public.is_admin());
DROP POLICY IF EXISTS referral_program_config_service ON public.referral_program_config;
CREATE POLICY referral_program_config_service ON public.referral_program_config
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- fraud flags / case adjustments: admin-read only; writes service-only.
DROP POLICY IF EXISTS referral_fraud_flags_admin ON public.referral_fraud_flags;
CREATE POLICY referral_fraud_flags_admin ON public.referral_fraud_flags
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS referral_fraud_flags_service ON public.referral_fraud_flags;
CREATE POLICY referral_fraud_flags_service ON public.referral_fraud_flags
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS referral_case_adjustments_admin ON public.referral_case_adjustments;
CREATE POLICY referral_case_adjustments_admin ON public.referral_case_adjustments
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS referral_case_adjustments_service ON public.referral_case_adjustments;
CREATE POLICY referral_case_adjustments_service ON public.referral_case_adjustments
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- RBAC permissions (additive; ON CONFLICT DO NOTHING). Reuses the enterprise RBAC
-- tables from 20260527100000_enterprise_auth_rbac.sql. These gate the /v1/admin/
-- referrals console (A1–A7).
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Manage Referral Rewards Config',    'referral.admin.config',     'referral', 'rewards-config',   'manage',  'Edit versioned tier/milestone config (A1)',        true),
  ('View Referral Rewards Analytics',   'referral.admin.analytics',  'referral', 'rewards-analytics','view',    'Program-level reward analytics (A2)',              true),
  ('Manage Referral Fraud Queue',       'referral.admin.fraud',      'referral', 'rewards-fraud',    'manage',  'Review/action fraud & anti-abuse flags (A3)',      true),
  ('View Referral Rewards Ledger',      'referral.admin.ledger',     'referral', 'rewards-ledger',   'view',    'Full exportable referral reward ledger (A4)',      true),
  ('Manage Referral Referrer Case',     'referral.admin.case',       'referral', 'rewards-case',     'manage',  'Referrer case view + manual adjustment (A5)',      true),
  ('View Referral Milestones Log',      'referral.admin.milestones', 'referral', 'rewards-milestone','view',    'Milestone payout log (A6)',                        true),
  ('View Referral Module Status',       'referral.admin.module',     'referral', 'rewards-module',   'view',    'Per-module PurchaseSettled integration health (A7)', true)
ON CONFLICT (slug) DO NOTHING;

-- Grant the full referral.admin.* set to super-admin and system-admin.
WITH p AS (SELECT id FROM public.permissions WHERE slug IN
  ('referral.admin.config','referral.admin.analytics','referral.admin.fraud',
   'referral.admin.ledger','referral.admin.case','referral.admin.milestones','referral.admin.module'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug IN
  ('referral.admin.config','referral.admin.analytics','referral.admin.fraud',
   'referral.admin.ledger','referral.admin.case','referral.admin.milestones','referral.admin.module'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- SEED — v1 program config (PRD §2.2 tiers + §2.3 milestones). Rates are fractions
-- (0.05 = 5%). Milestone bonuses stored in KOBO (₦5,000 = 500000 kobo). Idempotent:
-- only inserts version 1 if no config row exists yet.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.referral_program_config
  (version, tier_table, milestone_table, is_active, effective_from)
SELECT
  1,
  '[
     {"tier":"STARTER","min_count":1,   "max_count":49,   "rate":0.05},
     {"tier":"GROWTH", "min_count":50,  "max_count":249,  "rate":0.08},
     {"tier":"PRO",    "min_count":250, "max_count":999,  "rate":0.12},
     {"tier":"ELITE",  "min_count":1000,"max_count":null, "rate":0.15}
   ]'::jsonb,
  '[
     {"threshold":10,   "bonus_kobo":500000},
     {"threshold":50,   "bonus_kobo":2000000},
     {"threshold":250,  "bonus_kobo":10000000},
     {"threshold":1000, "bonus_kobo":50000000}
   ]'::jsonb,
  true,
  now()
WHERE NOT EXISTS (SELECT 1 FROM public.referral_program_config);

COMMIT;
