-- Referral Earning System — §7A Attribution & Default-Referrer core
-- Ref: docs/prd/referal/referral-PRD.md §7A, §11, §12;
--      docs/prd/referal/REFERRAL-BUILD-PLAN.md §3 (SHARED DB CONTRACT — RB0 owns).
--
-- ADDITIVE-ONLY: CREATE TABLE/INDEX/POLICY IF NOT EXISTS, idempotent seeds.
--   NO DROP TABLE/COLUMN/TYPE, NO RENAME, NO type narrowing.
--   DROP POLICY IF EXISTS is used only to re-create policies idempotently.
-- Money columns are BIGINT kobo. FKs to auth.users(id). RLS on every table with a
-- service_role bypass; the engine writes via the service-role backend.
--
-- §7A invariants encoded here:
--   * Every signup is attributed (resolver always resolves; house is last resort).
--   * House account is a governed SYSTEM account (owner_user_id nullable, resolved
--     at runtime from env), non-withdrawable.
--   * House reward-ledger accruals are tagged is_house, excluded_from_override and
--     excluded_from_kfactor — never roll up to a human upline, never in K-factor.
--   * Reassignments are audited; house-benefiting ones require a distinct co-signer.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- HOUSE ACCOUNTS — governed system/Super-Admin capture accounts (NOT a wallet)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.referral_house_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope           text NOT NULL DEFAULT 'global'
                    CHECK (scope IN ('global','regional')),
  region          text,
  owner_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  code            text NOT NULL UNIQUE,
  non_withdrawable boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_house_accounts_scope
  ON public.referral_house_accounts (scope, region);

-- ════════════════════════════════════════════════════════════════════════════
-- ATTRIBUTIONS — one row per referred user (UNIQUE), idempotent resolver output
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.referral_attributions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referred_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  referrer_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  house_account_id uuid REFERENCES public.referral_house_accounts(id) ON DELETE SET NULL,
  attribution_type text NOT NULL
                     CHECK (attribution_type IN
                       ('code','deeplink','context','regional_house','global_house')),
  code_used        text,
  is_house         boolean NOT NULL DEFAULT false,
  risk_flag        text,        -- e.g. 'self_referral', 'invalid_code', NULL otherwise
  status           text NOT NULL DEFAULT 'grace'
                     CHECK (status IN ('grace','locked')),
  grace_expires_at timestamptz,
  reassigned_from  text,
  reassigned_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_attributions_referrer
  ON public.referral_attributions (referrer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_attributions_house
  ON public.referral_attributions (is_house, status);

-- ════════════════════════════════════════════════════════════════════════════
-- REWARD LEDGER — state machine over referral accruals (kobo, idempotent)
-- House accruals are notional (no wallet posting); real payouts post to the
-- finance ledger and carry ledger_entry_id.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.referral_reward_ledger (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beneficiary_id        uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  house_account_id      uuid REFERENCES public.referral_house_accounts(id) ON DELETE SET NULL,
  referred_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  campaign_id           uuid,
  kind                  text NOT NULL DEFAULT 'referrer'
                          CHECK (kind IN ('referrer','referee','override','mission','manual')),
  state                 text NOT NULL DEFAULT 'earned'
                          CHECK (state IN
                            ('earned','pending','vesting','eligible','paid','clawed_back')),
  amount_kobo           bigint NOT NULL CHECK (amount_kobo >= 0),
  currency              text NOT NULL DEFAULT 'NGN',
  is_house              boolean NOT NULL DEFAULT false,
  excluded_from_override boolean NOT NULL DEFAULT false,
  excluded_from_kfactor boolean NOT NULL DEFAULT false,
  vesting_schedule_id   uuid,
  ledger_entry_id       text,          -- finance ledger idempotency ref for real payouts
  idempotency_key       text NOT NULL UNIQUE,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- House accruals are notional: a real beneficiary OR a house account, never both null.
  CHECK (beneficiary_id IS NOT NULL OR house_account_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_referral_reward_ledger_beneficiary
  ON public.referral_reward_ledger (beneficiary_id, state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_reward_ledger_house
  ON public.referral_reward_ledger (house_account_id, state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_reward_ledger_referred
  ON public.referral_reward_ledger (referred_user_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- REASSIGNMENTS — late-claim / fraud-correction / dispute audit + co-sign
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.referral_reassignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attribution_id  uuid NOT NULL REFERENCES public.referral_attributions(id) ON DELETE CASCADE,
  from_party      text,          -- 'house' or a user id
  to_party        text,          -- 'house' or a user id
  reason          text,
  requested_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cosigned_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  benefits_house  boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz,
  -- Separation of duties: a house-benefiting change can never have the same person
  -- request and co-sign it.
  CHECK (NOT (benefits_house AND cosigned_by IS NOT NULL AND cosigned_by = requested_by))
);
CREATE INDEX IF NOT EXISTS idx_referral_reassignments_attribution
  ON public.referral_reassignments (attribution_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_reassignments_status
  ON public.referral_reassignments (status, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- ENGINE EVENTS — append-only event stream (idempotent by key)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.referral_engine_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      text NOT NULL,
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  referrer_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  campaign_id     uuid,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_engine_events_type
  ON public.referral_engine_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_engine_events_user
  ON public.referral_engine_events (user_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- CONFIG — singleton (id bool PK DEFAULT true forces a single row)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.referral_config (
  id                     boolean PRIMARY KEY DEFAULT true CHECK (id),
  attribution_window_hours int NOT NULL DEFAULT 72 CHECK (attribution_window_hours >= 0),
  grace_window_hours     int NOT NULL DEFAULT 72 CHECK (grace_window_hours >= 0),
  fallback_chain         jsonb NOT NULL DEFAULT
    '["code","deeplink","context","regional_house","global_house"]'::jsonb,
  house_account_code     text NOT NULL DEFAULT 'SPOT-HOUSE',
  budget_neutral         boolean NOT NULL DEFAULT true,
  welcome_reward_enabled boolean NOT NULL DEFAULT false,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- updated_at triggers (reuse generic public.handle_updated_at)
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'referral_attributions','referral_reward_ledger','referral_config'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated ON public.%1$s', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated BEFORE UPDATE ON public.%1$s '
      'FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at()', t);
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — deny-by-default; service_role bypass on every table.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.referral_house_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_attributions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_reward_ledger  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_reassignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_engine_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_config         ENABLE ROW LEVEL SECURITY;

-- house accounts: admin reads; writes service-only (governed system accounts).
DROP POLICY IF EXISTS referral_house_accounts_admin ON public.referral_house_accounts;
CREATE POLICY referral_house_accounts_admin ON public.referral_house_accounts
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS referral_house_accounts_service ON public.referral_house_accounts;
CREATE POLICY referral_house_accounts_service ON public.referral_house_accounts
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- attributions: the referred user reads own; admin reads all; writes service-only.
DROP POLICY IF EXISTS referral_attributions_own ON public.referral_attributions;
CREATE POLICY referral_attributions_own ON public.referral_attributions
  FOR SELECT TO authenticated
  USING (referred_user_id = auth.uid() OR referrer_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS referral_attributions_service ON public.referral_attributions;
CREATE POLICY referral_attributions_service ON public.referral_attributions
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- reward ledger: beneficiary reads own; admin reads all; writes service-only.
DROP POLICY IF EXISTS referral_reward_ledger_own ON public.referral_reward_ledger;
CREATE POLICY referral_reward_ledger_own ON public.referral_reward_ledger
  FOR SELECT TO authenticated
  USING (beneficiary_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS referral_reward_ledger_service ON public.referral_reward_ledger;
CREATE POLICY referral_reward_ledger_service ON public.referral_reward_ledger
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- reassignments: admin reads (governance); writes service-only (audited).
DROP POLICY IF EXISTS referral_reassignments_admin ON public.referral_reassignments;
CREATE POLICY referral_reassignments_admin ON public.referral_reassignments
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS referral_reassignments_service ON public.referral_reassignments;
CREATE POLICY referral_reassignments_service ON public.referral_reassignments
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- engine events: admin reads (audit); writes service-only (append-only).
DROP POLICY IF EXISTS referral_engine_events_admin ON public.referral_engine_events;
CREATE POLICY referral_engine_events_admin ON public.referral_engine_events
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS referral_engine_events_service ON public.referral_engine_events;
CREATE POLICY referral_engine_events_service ON public.referral_engine_events
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- config: admin reads; writes service-only (singleton).
DROP POLICY IF EXISTS referral_config_admin ON public.referral_config;
CREATE POLICY referral_config_admin ON public.referral_config
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS referral_config_service ON public.referral_config;
CREATE POLICY referral_config_service ON public.referral_config
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- RBAC permissions (additive; ON CONFLICT DO NOTHING).
-- Reuses the enterprise RBAC tables from 20260527100000_enterprise_auth_rbac.sql.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('View Referral Config',         'referral.config.view',         'referral', 'config',      'view',    'View referral attribution config',                true),
  ('Manage Referral Config',       'referral.config.manage',       'referral', 'config',      'manage',  'Edit attribution/fallback/grace/house config',    true),
  ('View Referral Attribution',    'referral.attribution.view',    'referral', 'attribution', 'view',    'View referral attributions',                      true),
  ('Reassign Referral Attribution','referral.attribution.reassign','referral', 'attribution', 'reassign','Reassign/dispute attribution (co-sign for house)',true),
  ('View Referral House Ledger',   'referral.house.view',          'referral', 'house',       'view',    'View house/system account referral ledger',       true),
  ('View Referral Reward Ledger',  'referral.ledger.view',         'referral', 'ledger',      'view',    'View referral reward ledger across states',       true)
ON CONFLICT (slug) DO NOTHING;

-- Grant the full referral.* core set to super-admin and system-admin.
WITH p AS (SELECT id FROM public.permissions WHERE slug IN
  ('referral.config.view','referral.config.manage','referral.attribution.view',
   'referral.attribution.reassign','referral.house.view','referral.ledger.view'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug IN
  ('referral.config.view','referral.config.manage','referral.attribution.view',
   'referral.attribution.reassign','referral.house.view','referral.ledger.view'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- SEEDS — one global house row + the singleton config defaults (idempotent).
-- owner_user_id stays NULL: the house is a governed SYSTEM account; the runtime
-- resolves the actual owner from env (SUPER_ADMIN_REFERRAL_CODE / SUPER_ADMIN_USER_ID).
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.referral_house_accounts (scope, region, owner_user_id, code, non_withdrawable)
VALUES ('global', NULL, NULL, 'SPOT-HOUSE', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.referral_config
  (id, attribution_window_hours, grace_window_hours, house_account_code, budget_neutral, welcome_reward_enabled)
VALUES
  (true, 72, 72, 'SPOT-HOUSE', true, false)
ON CONFLICT (id) DO NOTHING;

COMMIT;
