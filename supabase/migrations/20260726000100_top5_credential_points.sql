-- Paymax Top-5 Phase 2 — Shared Credential primitive + Points engine
-- Ref: docs/estate/TOP5-BUILD-PLAN.md §1 (reuse), §2 (primitives); CLAUDE.md
--      NL-4 (points != cash), NL-8 (ledger), NL-9 (idempotency), NL-12 (audit).
--
-- ADDITIVE-ONLY. Money-adjacent amounts are BIGINT kobo; points are BIGINT counts
-- (NOT kobo, NOT convertible to cash). FKs to auth.users(id). RLS everywhere with a
-- service_role bypass. Credentials back rotating-QR / NFC gate entry (single-use +
-- replay-reject enforced in app + by state). Points ledger is append-only: balance
-- is SUM(EARN) - SUM(REDEEM/EXPIRE) (NL-8); UNIQUE idempotency_key (NL-9).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- CREDENTIAL — rotating-QR / NFC issuance. ACTIVE→USED|REVOKED|EXPIRED.
-- The on-the-wire token (rotating per RotateTTL window) is computed in-app from
-- `secret`; this row is the authority. single_use + the ACTIVE→USED guard are the
-- replay defence.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.credentials (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_ref         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('event_ticket','wallet_band','vendor_pos','loyalty_perk','steward_pass')),
  state               text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','USED','REVOKED','EXPIRED')),
  secret              text NOT NULL,
  nfc_token           text,
  single_use          boolean NOT NULL DEFAULT true,
  allow_reentry       boolean NOT NULL DEFAULT false,
  reentry_window_secs bigint  NOT NULL DEFAULT 0 CHECK (reentry_window_secs >= 0),
  rotate_ttl_secs     bigint  NOT NULL DEFAULT 30 CHECK (rotate_ttl_secs > 0),
  valid_from          timestamptz NOT NULL DEFAULT now(),
  valid_to            timestamptz,
  issued_at           timestamptz NOT NULL DEFAULT now(),
  used_at             timestamptz
);
CREATE INDEX IF NOT EXISTS idx_credentials_subject ON public.credentials (subject_ref, kind, state);
CREATE UNIQUE INDEX IF NOT EXISTS uq_credentials_nfc ON public.credentials (nfc_token) WHERE nfc_token IS NOT NULL;

-- Append-only scan record (one row per accepted/rejected/pending scan). PENDING
-- rows are the offline-tolerant validation queue, reconciled to ACCEPTED/REJECTED.
CREATE TABLE IF NOT EXISTS public.credential_validations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id uuid NOT NULL REFERENCES public.credentials(id) ON DELETE CASCADE,
  gate_id       text NOT NULL DEFAULT '',
  window_bucket bigint NOT NULL DEFAULT 0,
  outcome       text NOT NULL CHECK (outcome IN ('ACCEPTED','REJECTED','PENDING')),
  reason        text NOT NULL DEFAULT '',
  scanned_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cred_validations_cred ON public.credential_validations (credential_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_cred_validations_pending ON public.credential_validations (outcome) WHERE outcome = 'PENDING';

-- ════════════════════════════════════════════════════════════════════════════
-- POINTS — append-only ledger + versioned earn rules + catalog + redemptions.
-- NL-4: points are NOT money. No kobo balance, no cash redemption path. value_kobo
-- on a catalog item is only a notional fulfilment value for airtime/bill rails.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.points_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type IN ('EARN','REDEEM','EXPIRE','ADJUST')),
  points          bigint NOT NULL CHECK (points > 0),
  rule_key        text NOT NULL DEFAULT '',
  module          text NOT NULL DEFAULT '',
  reference       text NOT NULL DEFAULT '',
  idempotency_key text NOT NULL,
  expires_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_points_ledger_idem ON public.points_ledger (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_points_ledger_user ON public.points_ledger (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_points_ledger_expiry ON public.points_ledger (expires_at) WHERE type = 'EARN' AND expires_at IS NOT NULL;

-- Versioned earn rules (per action/module). A new version supersedes; a rule edit
-- never rewrites past awards (the entry stamps the version in its idempotency key).
CREATE TABLE IF NOT EXISTS public.points_earn_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key        text NOT NULL,
  module          text NOT NULL DEFAULT '',
  version         int  NOT NULL DEFAULT 1 CHECK (version >= 1),
  points_fixed    bigint NOT NULL DEFAULT 0 CHECK (points_fixed >= 0),
  points_per_kobo double precision NOT NULL DEFAULT 0 CHECK (points_per_kobo >= 0),
  expiry_days     int  NOT NULL DEFAULT 0 CHECK (expiry_days >= 0),
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_key, version)
);
CREATE INDEX IF NOT EXISTS idx_points_rules_active ON public.points_earn_rules (rule_key, active, version DESC);

-- Redeemable catalog. kind is constrained to NON-CASH rails (NL-4): a 'cash' kind
-- can never be inserted, so there is no schema path to a cash-out item.
CREATE TABLE IF NOT EXISTS public.points_catalog (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku         text NOT NULL UNIQUE,
  title       text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('airtime','bill','ticket_discount','perk')),
  cost_points bigint NOT NULL CHECK (cost_points > 0),
  value_kobo  bigint NOT NULL DEFAULT 0 CHECK (value_kobo >= 0),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.points_redemptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sku         text NOT NULL,
  cost_points bigint NOT NULL CHECK (cost_points > 0),
  status      text NOT NULL DEFAULT 'REDEEMED' CHECK (status IN ('REDEEMED','FULFILLED','FAILED')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_points_redemptions_user ON public.points_redemptions (user_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — subject/owner scoped reads; service_role full writes.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.credentials            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credential_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.points_ledger          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.points_earn_rules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.points_catalog         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.points_redemptions     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credentials_own ON public.credentials;
CREATE POLICY credentials_own ON public.credentials
  FOR SELECT TO authenticated USING (subject_ref = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS credentials_service ON public.credentials;
CREATE POLICY credentials_service ON public.credentials
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS cred_validations_own ON public.credential_validations;
CREATE POLICY cred_validations_own ON public.credential_validations
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.credentials c
      WHERE c.id = credential_validations.credential_id AND c.subject_ref = auth.uid()
    )
  );
DROP POLICY IF EXISTS cred_validations_service ON public.credential_validations;
CREATE POLICY cred_validations_service ON public.credential_validations
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS points_ledger_own ON public.points_ledger;
CREATE POLICY points_ledger_own ON public.points_ledger
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS points_ledger_service ON public.points_ledger;
CREATE POLICY points_ledger_service ON public.points_ledger
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS points_rules_read ON public.points_earn_rules;
CREATE POLICY points_rules_read ON public.points_earn_rules
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS points_rules_service ON public.points_earn_rules;
CREATE POLICY points_rules_service ON public.points_earn_rules
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS points_catalog_read ON public.points_catalog;
CREATE POLICY points_catalog_read ON public.points_catalog
  FOR SELECT TO authenticated USING (active = TRUE OR public.is_admin());
DROP POLICY IF EXISTS points_catalog_service ON public.points_catalog;
CREATE POLICY points_catalog_service ON public.points_catalog
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS points_redemptions_own ON public.points_redemptions;
CREATE POLICY points_redemptions_own ON public.points_redemptions
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS points_redemptions_service ON public.points_redemptions;
CREATE POLICY points_redemptions_service ON public.points_redemptions
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- RBAC — credential.* / points.* . Additive; ON CONFLICT DO NOTHING.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Issue Credentials',     'credential.issue',    'credential','credential','issue',    'Issue rotating-QR / NFC credentials',        true),
  ('Validate Credentials',  'credential.validate', 'credential','credential','validate', 'Validate a credential at a gate (steward)',  true),
  ('Revoke Credentials',    'credential.revoke',   'credential','credential','revoke',   'Revoke an issued credential',                true),
  ('Manage Points Rules',   'points.rules.manage', 'points',    'rules',     'manage',   'Create/version points earn rules',           true),
  ('Manage Points Catalog', 'points.catalog.manage','points',   'catalog',   'manage',   'Manage redeemable points catalog',           true),
  ('View Points (Admin)',   'points.admin.view',   'points',    'admin',     'view',     'Ops oversight of points ledgers',            true)
ON CONFLICT (slug) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'credential.%' OR slug LIKE 'points.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'points.admin.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
