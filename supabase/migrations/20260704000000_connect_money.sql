-- Paymax Connect — Money path (gifting / voting / AML / payouts)
-- Ref: docs/prd/dating/connect/connect-paymax-prd.md §6.3 (voting), §6.4 (gifting),
--      §7 (CBN tiers + AML + NFIU STR/SAR), §8; docs/prd/dating/CLAUDE.md.
--
-- ADDITIVE-ONLY: CREATE TABLE/INDEX/POLICY IF NOT EXISTS, idempotent seeds.
--   NO DROP TABLE/COLUMN/TYPE, NO RENAME, NO type narrowing.
--   DROP POLICY IF EXISTS is used only to re-create policies idempotently.
-- Money columns are BIGINT kobo. FKs to auth.users(id).
--
-- Money movement REUSES the finance ledger/wallet (ledger_accounts/ledger_entries)
-- — these tables are backend-owned projections only; balances stay derived. No
-- balance column is ever added. Reused helpers: public.is_admin(),
-- public.handle_updated_at(). RLS on every table with a service_role bypass.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- GIFTING — backend-owned gift catalogue + immutable wallet→wallet gift log
-- ════════════════════════════════════════════════════════════════════════════

-- Backend-owned catalogue (prices live HERE, never hard-coded / client-supplied).
CREATE TABLE IF NOT EXISTS public.connect_gift_catalog (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  icon_ref    text,
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_gift_catalog_active
  ON public.connect_gift_catalog (active, amount_kobo);

-- Immutable gift transfer log. One row per settled gift; idempotency_key UNIQUE
-- mirrors the ledger key so a retried gift never double-charges. ledger_ref ties
-- the gift to its posted balanced double-entry (DR sender wallet, CR recipient).
CREATE TABLE IF NOT EXISTS public.connect_gifts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gift_code       text,                       -- catalogue code, NULL for custom amount
  amount_kobo     bigint NOT NULL CHECK (amount_kobo > 0),
  message         text,
  status          text NOT NULL DEFAULT 'sent'
                    CHECK (status IN ('sent','reversed')),
  idempotency_key text NOT NULL,
  ledger_ref      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (sender_id <> recipient_id),
  UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_connect_gifts_sender
  ON public.connect_gifts (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connect_gifts_recipient
  ON public.connect_gifts (recipient_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- VOTING — contests (free polls + paid voting) + immutable vote tally log
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.connect_contests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title               text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  description         text,
  status              text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','open','closed')),
  -- Price of ONE paid vote unit, kobo. 0 = paid voting disabled for this contest.
  paid_vote_kobo      bigint NOT NULL DEFAULT 0 CHECK (paid_vote_kobo >= 0),
  free_votes_per_user int NOT NULL DEFAULT 1 CHECK (free_votes_per_user >= 0),
  velocity_per_minute int NOT NULL DEFAULT 10 CHECK (velocity_per_minute >= 0),
  opens_at            timestamptz,
  closes_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_contests_status
  ON public.connect_contests (status, created_at DESC);

-- Immutable vote log. Free votes: paid=false, amount_kobo=0, ledger_ref NULL.
-- Paid votes: paid=true, amount_kobo>0, idempotency_key + ledger_ref set;
-- idempotency_key UNIQUE (where not null) makes a retried paid vote a no-op.
CREATE TABLE IF NOT EXISTS public.connect_votes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id      uuid NOT NULL REFERENCES public.connect_contests(id) ON DELETE CASCADE,
  voter_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  option_ref      text NOT NULL,             -- entrant / choice the vote is for
  paid            boolean NOT NULL DEFAULT false,
  quantity        int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  amount_kobo     bigint NOT NULL DEFAULT 0 CHECK (amount_kobo >= 0),
  idempotency_key text,
  ledger_ref      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((paid = false AND amount_kobo = 0) OR (paid = true AND amount_kobo > 0))
);
CREATE INDEX IF NOT EXISTS idx_connect_votes_contest
  ON public.connect_votes (contest_id, option_ref);
CREATE INDEX IF NOT EXISTS idx_connect_votes_voter
  ON public.connect_votes (contest_id, voter_id, created_at DESC);
-- A retried paid vote (same idempotency key) is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS uq_connect_votes_idem
  ON public.connect_votes (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- AML — event projection (scoring input), append-only alerts + NFIU STR/SAR cases
-- ════════════════════════════════════════════════════════════════════════════

-- Raw money-event projection used for velocity / structuring scoring.
-- Stores subject + kind + amount + ledger_ref ONLY — never counterpart PII.
CREATE TABLE IF NOT EXISTS public.connect_aml_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_kind  text NOT NULL CHECK (event_kind IN ('gift','paid_vote','payout')),
  amount_kobo bigint NOT NULL CHECK (amount_kobo >= 0),
  ledger_ref  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_aml_events_subject
  ON public.connect_aml_events (subject_id, event_kind, created_at DESC);

-- Append-only monitoring alerts. reason_code is a STABLE MACHINE CODE — never
-- free-text PII. window_count records the burst/aggregate size at flag time.
CREATE TABLE IF NOT EXISTS public.connect_aml_alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_kind   text NOT NULL CHECK (event_kind IN ('gift','paid_vote','payout')),
  reason_code  text NOT NULL
                 CHECK (reason_code IN
                   ('THRESHOLD_EXCEEDED','VELOCITY_BURST','STRUCTURING','SANCTIONS_HIT')),
  amount_kobo  bigint NOT NULL DEFAULT 0 CHECK (amount_kobo >= 0),
  window_count int NOT NULL DEFAULT 0 CHECK (window_count >= 0),
  ledger_ref   text,
  case_id      uuid,                          -- set if folded into an STR/SAR case
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_aml_alerts_subject
  ON public.connect_aml_alerts (subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connect_aml_alerts_reason
  ON public.connect_aml_alerts (reason_code, created_at DESC);

-- Append-only NFIU STR/SAR case scaffold. status is forward-only
-- (open → filed → closed); narrative is a compliance summary that MUST contain
-- reason codes only, never raw counterpart PII. reason_codes is a text[] of the
-- stable codes that motivated the case.
CREATE TABLE IF NOT EXISTS public.connect_aml_cases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_type  text NOT NULL CHECK (report_type IN ('str','sar')),
  status       text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','filed','closed')),
  reason_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  narrative    text,
  opened_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  filed_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  filed_ref    text,                          -- NFIU acknowledgement reference
  filed_at     timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_aml_cases_status
  ON public.connect_aml_cases (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connect_aml_cases_subject
  ON public.connect_aml_cases (subject_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- PAYOUTS — creator gift-revenue payout requests (Tier2+/KYC gated)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.connect_payouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_kobo     bigint NOT NULL CHECK (amount_kobo > 0),
  status          text NOT NULL DEFAULT 'requested'
                    CHECK (status IN ('requested','processing','settled','failed')),
  destination_ref text,                       -- tokenised settled bank-account reference
  idempotency_key text NOT NULL,
  ledger_ref      text NOT NULL,
  settlement_ref  text,                       -- provider settlement id
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_connect_payouts_creator
  ON public.connect_payouts (creator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connect_payouts_status
  ON public.connect_payouts (status, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- updated_at triggers (reuse generic public.handle_updated_at)
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'connect_gift_catalog','connect_contests','connect_aml_cases','connect_payouts'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated ON public.%1$s', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated BEFORE UPDATE ON public.%1$s '
      'FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at()', t);
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — deny-by-default; service_role bypass on every table.
-- The money path writes via the service-role backend; members read their own.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.connect_gift_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_gifts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_contests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_votes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_aml_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_aml_alerts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_aml_cases    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_payouts      ENABLE ROW LEVEL SECURITY;

-- gift catalogue: active items readable by anyone authed; only admin/service writes.
DROP POLICY IF EXISTS connect_gift_catalog_read ON public.connect_gift_catalog;
CREATE POLICY connect_gift_catalog_read ON public.connect_gift_catalog
  FOR SELECT TO authenticated USING (active OR public.is_admin());
DROP POLICY IF EXISTS connect_gift_catalog_admin ON public.connect_gift_catalog;
CREATE POLICY connect_gift_catalog_admin ON public.connect_gift_catalog
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS connect_gift_catalog_service ON public.connect_gift_catalog;
CREATE POLICY connect_gift_catalog_service ON public.connect_gift_catalog
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- gifts: either party reads own; admin reads all; writes service-only (immutable).
DROP POLICY IF EXISTS connect_gifts_party_read ON public.connect_gifts;
CREATE POLICY connect_gifts_party_read ON public.connect_gifts
  FOR SELECT TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS connect_gifts_service ON public.connect_gifts;
CREATE POLICY connect_gifts_service ON public.connect_gifts
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- contests: open/closed readable by anyone authed; only admin/service writes.
DROP POLICY IF EXISTS connect_contests_read ON public.connect_contests;
CREATE POLICY connect_contests_read ON public.connect_contests
  FOR SELECT TO authenticated
  USING (status IN ('open','closed') OR public.is_admin());
DROP POLICY IF EXISTS connect_contests_admin ON public.connect_contests;
CREATE POLICY connect_contests_admin ON public.connect_contests
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS connect_contests_service ON public.connect_contests;
CREATE POLICY connect_contests_service ON public.connect_contests
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- votes: voter reads own; admin reads all; writes service-only (immutable tally).
DROP POLICY IF EXISTS connect_votes_own ON public.connect_votes;
CREATE POLICY connect_votes_own ON public.connect_votes
  FOR SELECT TO authenticated USING (voter_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS connect_votes_service ON public.connect_votes;
CREATE POLICY connect_votes_service ON public.connect_votes
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- AML events: admin reads (compliance); writes service-only. No member access.
DROP POLICY IF EXISTS connect_aml_events_admin ON public.connect_aml_events;
CREATE POLICY connect_aml_events_admin ON public.connect_aml_events
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS connect_aml_events_service ON public.connect_aml_events;
CREATE POLICY connect_aml_events_service ON public.connect_aml_events
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- AML alerts: admin reads (compliance); writes service-only (append-only).
DROP POLICY IF EXISTS connect_aml_alerts_admin ON public.connect_aml_alerts;
CREATE POLICY connect_aml_alerts_admin ON public.connect_aml_alerts
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS connect_aml_alerts_service ON public.connect_aml_alerts;
CREATE POLICY connect_aml_alerts_service ON public.connect_aml_alerts
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- AML cases: admin reads (compliance); writes service-only (append-only scaffold).
DROP POLICY IF EXISTS connect_aml_cases_admin ON public.connect_aml_cases;
CREATE POLICY connect_aml_cases_admin ON public.connect_aml_cases
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS connect_aml_cases_service ON public.connect_aml_cases;
CREATE POLICY connect_aml_cases_service ON public.connect_aml_cases
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- payouts: creator reads own; admin reads all; writes service-only.
DROP POLICY IF EXISTS connect_payouts_own ON public.connect_payouts;
CREATE POLICY connect_payouts_own ON public.connect_payouts
  FOR SELECT TO authenticated USING (creator_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS connect_payouts_service ON public.connect_payouts;
CREATE POLICY connect_payouts_service ON public.connect_payouts
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- RBAC permissions for the AML admin actions (additive; ON CONFLICT DO NOTHING).
-- Reuses the enterprise RBAC tables from 20260527100000_enterprise_auth_rbac.sql.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('View Connect AML',  'connect.aml.view',   'connect', 'aml', 'view',   'View Connect AML alerts and cases', true),
  ('Manage Connect AML','connect.aml.manage', 'connect', 'aml', 'manage', 'Open Connect AML STR/SAR cases', true),
  ('File Connect AML',  'connect.aml.file',   'connect', 'aml', 'file',   'File Connect AML STR with the NFIU', true)
ON CONFLICT (slug) DO NOTHING;

-- Grant the full AML set to super-admin and system-admin.
WITH p AS (SELECT id FROM public.permissions WHERE slug IN
  ('connect.aml.view','connect.aml.manage','connect.aml.file'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug IN
  ('connect.aml.view','connect.aml.manage','connect.aml.file'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Connect-moderator gets read-only AML visibility (not case open/file).
WITH p AS (SELECT id FROM public.permissions WHERE slug IN ('connect.aml.view'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'connect-moderator'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- Seed a starter gift catalogue (idempotent). Prices in kobo, backend-owned.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.connect_gift_catalog (code, name, icon_ref, amount_kobo, active) VALUES
  ('rose',      'Rose',      'gift/rose',      50000,   true),  -- ₦500
  ('heart',     'Heart',     'gift/heart',     100000,  true),  -- ₦1,000
  ('bouquet',   'Bouquet',   'gift/bouquet',   250000,  true),  -- ₦2,500
  ('crown',     'Crown',     'gift/crown',     500000,  true),  -- ₦5,000
  ('superstar', 'Superstar', 'gift/superstar', 1000000, true)   -- ₦10,000
ON CONFLICT (code) DO NOTHING;

COMMIT;
