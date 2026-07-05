-- Paymax Top-5 Phase 1 — Social core (P2P send/request, split-bill, group pool)
-- Ref: docs/estate/BUILD-PLAN.md EPIC 1.4, TOP5-BUILD-PLAN.md §5, CLAUDE.md NL-8,9,10,12.
--
-- ADDITIVE-ONLY. Money is BIGINT kobo. FKs to auth.users(id). RLS everywhere with
-- a service_role bypass. Money moves through the finance ledger (NL-8) and is
-- idempotent on UNIQUE keys (NL-9). social_payments doubles as the AML velocity
-- source (NL-10). Object-level authZ is enforced in the service layer; RLS keeps
-- reads scoped to the parties involved.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- P2P PAYMENT — completed in-chat send. UNIQUE idempotency_key (NL-9). This table
-- is the AML velocity window source (per sender, rolling 24h) — NL-10.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.social_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_kobo     bigint NOT NULL CHECK (amount_kobo > 0),
  note            text NOT NULL DEFAULT '',
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (sender_id <> recipient_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_social_payments_idem ON public.social_payments (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_social_payments_sender_window ON public.social_payments (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_payments_recipient ON public.social_payments (recipient_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- PAYMENT REQUEST — PENDING→PAID|DECLINED|CANCELLED. Object-level authZ: only the
-- requester creates (as themselves), only the payer pays.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.social_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payer_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_kobo  bigint NOT NULL CHECK (amount_kobo > 0),
  note         text NOT NULL DEFAULT '',
  state        text NOT NULL DEFAULT 'PENDING'
                 CHECK (state IN ('PENDING','PAID','DECLINED','CANCELLED')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  CHECK (requester_id <> payer_id)
);
CREATE INDEX IF NOT EXISTS idx_social_requests_payer ON public.social_requests (payer_id, state);
CREATE INDEX IF NOT EXISTS idx_social_requests_requester ON public.social_requests (requester_id, state);

-- ════════════════════════════════════════════════════════════════════════════
-- SPLIT BILL — EQUAL|CUSTOM. OPEN→SETTLED|CANCELLED. Shares are tracked PENDING→PAID.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.split_bills (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organiser_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title        text NOT NULL DEFAULT '',
  total_kobo   bigint NOT NULL CHECK (total_kobo > 0),
  mode         text NOT NULL DEFAULT 'EQUAL' CHECK (mode IN ('EQUAL','CUSTOM')),
  state        text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','SETTLED','CANCELLED')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_split_bills_organiser ON public.split_bills (organiser_id, state);

CREATE TABLE IF NOT EXISTS public.split_shares (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  split_id    uuid NOT NULL REFERENCES public.split_bills(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  state       text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','PAID')),
  paid_at     timestamptz,
  UNIQUE (split_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_split_shares_split ON public.split_shares (split_id);
CREATE INDEX IF NOT EXISTS idx_split_shares_user  ON public.split_shares (user_id, state);

-- ════════════════════════════════════════════════════════════════════════════
-- GROUP POOL — many fund one pot; organiser pays out. OPEN→PAID_OUT|CLOSED.
-- Balance = SUM(amount_kobo) including a negative drain row at payout (NL-8).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.group_pools (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organiser_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title          text NOT NULL DEFAULT '',
  beneficiary_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  state          text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','PAID_OUT','CLOSED')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_group_pools_organiser ON public.group_pools (organiser_id, state);

-- Contributions (and the single negative drain row at payout). UNIQUE idem (NL-9).
CREATE TABLE IF NOT EXISTS public.pool_contributions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id         uuid NOT NULL REFERENCES public.group_pools(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_kobo     bigint NOT NULL CHECK (amount_kobo <> 0), -- positive contribution / negative payout drain
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pool_contributions_idem ON public.pool_contributions (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_pool_contributions_pool ON public.pool_contributions (pool_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- updated_at triggers.
-- ════════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_split_bills_updated ON public.split_bills;
CREATE TRIGGER trg_split_bills_updated BEFORE UPDATE ON public.split_bills
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_group_pools_updated ON public.group_pools;
CREATE TRIGGER trg_group_pools_updated BEFORE UPDATE ON public.group_pools
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — party/participant scoped reads; service_role full writes.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.social_payments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.split_bills         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.split_shares        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_pools         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pool_contributions  ENABLE ROW LEVEL SECURITY;

-- Payment: sender or recipient reads; admin all; service full.
DROP POLICY IF EXISTS social_payments_party ON public.social_payments;
CREATE POLICY social_payments_party ON public.social_payments
  FOR SELECT TO authenticated USING (
    sender_id = auth.uid() OR recipient_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS social_payments_service ON public.social_payments;
CREATE POLICY social_payments_service ON public.social_payments
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Request: requester or payer reads.
DROP POLICY IF EXISTS social_requests_party ON public.social_requests;
CREATE POLICY social_requests_party ON public.social_requests
  FOR SELECT TO authenticated USING (
    requester_id = auth.uid() OR payer_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS social_requests_service ON public.social_requests;
CREATE POLICY social_requests_service ON public.social_requests
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Split bill: organiser or a participant reads.
DROP POLICY IF EXISTS split_bills_participant ON public.split_bills;
CREATE POLICY split_bills_participant ON public.split_bills
  FOR SELECT TO authenticated USING (
    public.is_admin() OR organiser_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.split_shares s
      WHERE s.split_id = split_bills.id AND s.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS split_bills_service ON public.split_bills;
CREATE POLICY split_bills_service ON public.split_bills
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS split_shares_participant ON public.split_shares;
CREATE POLICY split_shares_participant ON public.split_shares
  FOR SELECT TO authenticated USING (
    public.is_admin() OR user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.split_bills b
      WHERE b.id = split_shares.split_id AND b.organiser_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS split_shares_service ON public.split_shares;
CREATE POLICY split_shares_service ON public.split_shares
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Pool: organiser, beneficiary or a contributor reads.
DROP POLICY IF EXISTS group_pools_party ON public.group_pools;
CREATE POLICY group_pools_party ON public.group_pools
  FOR SELECT TO authenticated USING (
    public.is_admin() OR organiser_id = auth.uid() OR beneficiary_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.pool_contributions pc
      WHERE pc.pool_id = group_pools.id AND pc.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS group_pools_service ON public.group_pools;
CREATE POLICY group_pools_service ON public.group_pools
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS pool_contributions_party ON public.pool_contributions;
CREATE POLICY pool_contributions_party ON public.pool_contributions
  FOR SELECT TO authenticated USING (
    public.is_admin() OR user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.group_pools p
      WHERE p.id = pool_contributions.pool_id AND p.organiser_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS pool_contributions_service ON public.pool_contributions;
CREATE POLICY pool_contributions_service ON public.pool_contributions
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- RBAC — social.* (member + admin oversight). Additive; ON CONFLICT DO NOTHING.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Send P2P Payments',     'social.pay.send',      'social','payment','manage', 'Send/request P2P on cashtag',      true),
  ('Manage Split Bills',    'social.split.manage',  'social','split',  'manage', 'Create/pay split bills',           true),
  ('Manage Group Pools',    'social.pool.manage',   'social','pool',   'manage', 'Create/fund/pay-out group pools',  true),
  ('View Social (Admin)',   'social.admin.view',    'social','admin',  'view',   'Ops oversight of social entities', true),
  ('Audit Social (Admin)',  'social.admin.audit',   'social','audit',  'view',   'View social/AML audit trail',      true)
ON CONFLICT (slug) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'social.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'social.admin.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
