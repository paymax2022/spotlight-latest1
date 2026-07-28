-- Paymax Top-5 Phase 3 — Spray engine + Escrow disputes
-- Ref: docs/estate/BUILD-PLAN.md EPIC 3.0; docs/estate/CLAUDE.md NL-6 (escrow holds,
--      never lends), NL-8 (ledger), NL-9 (idempotent), NL-10 (AML velocity on spray),
--      NL-12 (audit + dispute arbitration audit).
--
-- ADDITIVE-ONLY. No DROP/RENAME of existing objects (DROP POLICY IF EXISTS is OK to
-- keep RLS re-runnable). Money is kobo BIGINT; FKs to auth.users(id). RLS everywhere
-- with a service_role bypass; the Go money path runs as service_role.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- SPRAY — instant wallet→wallet transfer audit projection (the money itself lives
-- in the shared ledger). idempotency_key is UNIQUE so a replay is a no-op (NL-9).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.spray_transfers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  context_ref     text NOT NULL,                         -- live id / event id / creator id
  amount_kobo     bigint NOT NULL CHECK (amount_kobo > 0),
  idempotency_key text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (from_user_id <> to_user_id)
);
CREATE INDEX IF NOT EXISTS idx_spray_transfers_context ON public.spray_transfers (context_ref, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_spray_transfers_from_24h ON public.spray_transfers (from_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_spray_transfers_to ON public.spray_transfers (to_user_id, created_at DESC);

-- Denormalised leaderboard (truth = spray_transfers; this is a fast projection).
CREATE TABLE IF NOT EXISTS public.spray_leaderboard (
  context_ref text   NOT NULL,
  user_id     uuid   NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  total_kobo  bigint NOT NULL DEFAULT 0 CHECK (total_kobo >= 0),
  spray_count bigint NOT NULL DEFAULT 0 CHECK (spray_count >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (context_ref, user_id)
);
CREATE INDEX IF NOT EXISTS idx_spray_leaderboard_rank ON public.spray_leaderboard (context_ref, total_kobo DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- ESCROW DISPUTES — extend the existing escrow_holds state machine
-- HELD → DISPUTED → (RELEASED | REFUNDED). No change to escrow_holds itself; the
-- dispute case + evidence live in their own tables (additive). Arbitration decision
-- is recorded here and audited at the app layer (NL-12).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.escrow_disputes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id   uuid NOT NULL REFERENCES public.escrow_holds(id) ON DELETE CASCADE,
  raised_by   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state       text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','RESOLVED')),
  decision    text CHECK (decision IN ('RELEASE','REFUND')),
  arbiter_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_escrow_disputes_escrow ON public.escrow_disputes (escrow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_escrow_disputes_open ON public.escrow_disputes (state) WHERE state = 'OPEN';

CREATE TABLE IF NOT EXISTS public.escrow_dispute_evidence (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id   uuid NOT NULL REFERENCES public.escrow_disputes(id) ON DELETE CASCADE,
  submitted_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_escrow_evidence_dispute ON public.escrow_dispute_evidence (dispute_id, created_at);

-- ════════════════════════════════════════════════════════════════════════════
-- P2P MARKETPLACE — listings + escrow-backed orders + seller ratings. Orders carry
-- escrow_id → escrow_holds(id); the money + dispute loop live in the escrow core.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.p2p_listings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  price_kobo  bigint NOT NULL CHECK (price_kobo > 0),
  state       text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','SOLD','CLOSED')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_p2p_listings_active ON public.p2p_listings (state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_p2p_listings_seller ON public.p2p_listings (seller_id);

CREATE TABLE IF NOT EXISTS public.p2p_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      uuid NOT NULL REFERENCES public.p2p_listings(id) ON DELETE CASCADE,
  buyer_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_kobo     bigint NOT NULL CHECK (amount_kobo > 0),
  escrow_id       uuid NOT NULL REFERENCES public.escrow_holds(id) ON DELETE RESTRICT,
  state           text NOT NULL DEFAULT 'CHECKOUT' CHECK (state IN ('CHECKOUT','CONFIRMED','DISPUTED','REFUNDED')),
  idempotency_key text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (buyer_id <> seller_id)
);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_buyer ON public.p2p_orders (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_p2p_orders_seller ON public.p2p_orders (seller_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.p2p_seller_ratings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL UNIQUE REFERENCES public.p2p_orders(id) ON DELETE CASCADE,
  seller_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  buyer_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stars      int NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_p2p_ratings_seller ON public.p2p_seller_ratings (seller_id);

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — owner/party scoped reads; service_role writes (money path).
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.spray_transfers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spray_leaderboard       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escrow_disputes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escrow_dispute_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_listings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_orders              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_seller_ratings      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spray_transfers_party ON public.spray_transfers;
CREATE POLICY spray_transfers_party ON public.spray_transfers
  FOR SELECT TO authenticated USING (from_user_id = auth.uid() OR to_user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS spray_transfers_service ON public.spray_transfers;
CREATE POLICY spray_transfers_service ON public.spray_transfers
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS spray_leaderboard_read ON public.spray_leaderboard;
CREATE POLICY spray_leaderboard_read ON public.spray_leaderboard
  FOR SELECT TO authenticated USING (TRUE);  -- leaderboard is public per-context
DROP POLICY IF EXISTS spray_leaderboard_service ON public.spray_leaderboard;
CREATE POLICY spray_leaderboard_service ON public.spray_leaderboard
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS escrow_disputes_party ON public.escrow_disputes;
CREATE POLICY escrow_disputes_party ON public.escrow_disputes
  FOR SELECT TO authenticated USING (
    raised_by = auth.uid() OR public.is_admin()
    OR EXISTS (SELECT 1 FROM public.escrow_holds h
               WHERE h.id = escrow_disputes.escrow_id
                 AND (h.payer_id = auth.uid() OR h.payee_id = auth.uid())));
DROP POLICY IF EXISTS escrow_disputes_service ON public.escrow_disputes;
CREATE POLICY escrow_disputes_service ON public.escrow_disputes
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS escrow_evidence_party ON public.escrow_dispute_evidence;
CREATE POLICY escrow_evidence_party ON public.escrow_dispute_evidence
  FOR SELECT TO authenticated USING (submitted_by = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS escrow_evidence_service ON public.escrow_dispute_evidence;
CREATE POLICY escrow_evidence_service ON public.escrow_dispute_evidence
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS p2p_listings_read ON public.p2p_listings;
CREATE POLICY p2p_listings_read ON public.p2p_listings
  FOR SELECT TO authenticated USING (state = 'ACTIVE' OR seller_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS p2p_listings_service ON public.p2p_listings;
CREATE POLICY p2p_listings_service ON public.p2p_listings
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS p2p_orders_party ON public.p2p_orders;
CREATE POLICY p2p_orders_party ON public.p2p_orders
  FOR SELECT TO authenticated USING (buyer_id = auth.uid() OR seller_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS p2p_orders_service ON public.p2p_orders;
CREATE POLICY p2p_orders_service ON public.p2p_orders
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS p2p_ratings_read ON public.p2p_seller_ratings;
CREATE POLICY p2p_ratings_read ON public.p2p_seller_ratings
  FOR SELECT TO authenticated USING (TRUE);  -- seller ratings are public
DROP POLICY IF EXISTS p2p_ratings_service ON public.p2p_seller_ratings;
CREATE POLICY p2p_ratings_service ON public.p2p_seller_ratings
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- updated_at triggers.
-- ════════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_p2p_listings_updated ON public.p2p_listings;
CREATE TRIGGER trg_p2p_listings_updated BEFORE UPDATE ON public.p2p_listings
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_p2p_orders_updated ON public.p2p_orders;
CREATE TRIGGER trg_p2p_orders_updated BEFORE UPDATE ON public.p2p_orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- RBAC — spray.* (AML oversight) + escrow.dispute.* + p2p.* (arbitration). Additive.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('View Spray (AML)',         'spray.read',                'spray', 'admin',   'view',      'View spray leaderboards + AML oversight', true),
  ('Arbitrate Escrow Dispute', 'escrow.dispute.arbitrate',  'escrow','dispute', 'arbitrate', 'Resolve a disputed escrow hold',          true),
  ('View Escrow Disputes',     'escrow.dispute.read',       'escrow','dispute', 'view',      'View escrow dispute cases',               true),
  ('Arbitrate P2P Dispute',    'p2p.dispute.arbitrate',     'p2p',   'dispute', 'arbitrate', 'Resolve a disputed P2P order',            true),
  ('View P2P (Admin)',         'p2p.read',                  'p2p',   'admin',   'view',      'View P2P listings/orders + fraud/AML',    true)
ON CONFLICT (slug) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions
           WHERE slug IN ('spray.read','escrow.dispute.arbitrate','escrow.dispute.read','p2p.dispute.arbitrate','p2p.read'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
