-- Paymax Top-5 Phase 2 — Event Ticketing + cashless Event Wallet
-- Ref: docs/estate/BUILD-PLAN.md EPIC 2.1-2.2, TOP5-BUILD-PLAN.md §5 (state machines);
--      CLAUDE.md NL-3 (closed-loop), NL-4 (no cash-out), NL-8/9/10/12.
--
-- ADDITIVE-ONLY. Money is BIGINT kobo. FKs to auth.users(id). RLS everywhere with a
-- service_role bypass. The event wallet is a CLOSED-LOOP sub-balance (NL-3):
-- event_wallet_ledger TOPUP/CHARGE/REFUND nets to a balance; on close the residual
-- is REFUNDed and the matching ledger credit returns it to the MAIN wallet — there
-- is no open-loop cash-out. Vendor float accrues per tap-charge and is paid out net
-- of fees at settlement, KYC-gated in app (NL-10). Idempotency keys are UNIQUE (NL-9).
--
-- NOTE: an unrelated legacy `events` table family may exist from the EPIC events CMS.
-- These Top-5 tables are NAMED to coexist (events / event_* / *_charges) and are
-- created with IF NOT EXISTS; the Go module lives in package `top5events` to avoid
-- any package collision with the legacy `events` package (brownfield iron rule).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- EVENT — organiser CMS + approval. DRAFT→SUBMITTED→APPROVED→LIVE→CLOSED|SUSPENDED.
-- Organiser is a capability on a single identity (organiser_id = auth.users.id).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organiser_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title        text NOT NULL,
  description  text NOT NULL DEFAULT '',
  venue        text NOT NULL DEFAULT '',
  state        text NOT NULL DEFAULT 'DRAFT'
                 CHECK (state IN ('DRAFT','SUBMITTED','APPROVED','LIVE','CLOSED','SUSPENDED')),
  starts_at    timestamptz NOT NULL DEFAULT now(),
  ends_at      timestamptz NOT NULL DEFAULT now(),
  fee_bps      int NOT NULL DEFAULT 0 CHECK (fee_bps >= 0 AND fee_bps <= 10000),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
-- Collision guard: an earlier migration (20260616240000_events.sql) may already
-- own public.events with the legacy EPIC-CMS shape, so the CREATE above no-ops.
-- Ensure the columns this (Top-5) migration relies on exist — mirrors
-- 20260902_events_schema_drift_fix so the July schema is self-sufficient
-- regardless of apply order. Additive; nullable/defaulted (no CHECK on the guard
-- to stay safe over any legacy rows).
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS organiser_id uuid REFERENCES auth.users(id);
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS venue text NOT NULL DEFAULT '';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'DRAFT';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS fee_bps int NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_events_organiser ON public.events (organiser_id, state);

CREATE TABLE IF NOT EXISTS public.event_ticket_tiers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name       text NOT NULL,
  price_kobo bigint NOT NULL CHECK (price_kobo >= 0),
  capacity   int NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  sold       int NOT NULL DEFAULT 0 CHECK (sold >= 0),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_tiers_event ON public.event_ticket_tiers (event_id);

-- Versioned promo codes (config-driven). UNIQUE (event,code,version).
CREATE TABLE IF NOT EXISTS public.event_promo_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  code        text NOT NULL,
  version     int NOT NULL DEFAULT 1 CHECK (version >= 1),
  percent_off int NOT NULL DEFAULT 0 CHECK (percent_off >= 0 AND percent_off <= 100),
  max_uses    int NOT NULL DEFAULT 0 CHECK (max_uses >= 0),
  used        int NOT NULL DEFAULT 0 CHECK (used >= 0),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, code, version)
);

CREATE TABLE IF NOT EXISTS public.event_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  buyer_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  total_kobo      bigint NOT NULL CHECK (total_kobo >= 0),
  status          text NOT NULL DEFAULT 'PAID' CHECK (status IN ('PAID','REFUNDED')),
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_orders_idem ON public.event_orders (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_event_orders_buyer ON public.event_orders (buyer_id, created_at DESC);

-- Ticket: ISSUED→TRANSFERRED?→USED|REFUNDED. credential_id links the rotating-QR.
CREATE TABLE IF NOT EXISTS public.event_tickets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  tier_id         uuid NOT NULL REFERENCES public.event_ticket_tiers(id) ON DELETE CASCADE,
  order_id        uuid NOT NULL REFERENCES public.event_orders(id) ON DELETE CASCADE,
  owner_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state           text NOT NULL DEFAULT 'ISSUED' CHECK (state IN ('ISSUED','TRANSFERRED','USED','REFUNDED')),
  credential_id   uuid REFERENCES public.credentials(id) ON DELETE SET NULL,
  price_paid_kobo bigint NOT NULL DEFAULT 0 CHECK (price_paid_kobo >= 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- Collision guard: legacy 20260616240000_events.sql may already own
-- public.event_tickets (with ticket_type_id/qr_code/status, no credential_id).
-- Ensure the Top-5 columns referenced below exist. Additive; nullable/defaulted.
ALTER TABLE public.event_tickets ADD COLUMN IF NOT EXISTS event_id uuid;
ALTER TABLE public.event_tickets ADD COLUMN IF NOT EXISTS tier_id uuid REFERENCES public.event_ticket_tiers(id);
ALTER TABLE public.event_tickets ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.event_orders(id);
ALTER TABLE public.event_tickets ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id);
ALTER TABLE public.event_tickets ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'ISSUED';
ALTER TABLE public.event_tickets ADD COLUMN IF NOT EXISTS credential_id uuid REFERENCES public.credentials(id) ON DELETE SET NULL;
ALTER TABLE public.event_tickets ADD COLUMN IF NOT EXISTS price_paid_kobo bigint NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_event_tickets_owner ON public.event_tickets (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_tickets_cred ON public.event_tickets (credential_id);

-- ════════════════════════════════════════════════════════════════════════════
-- CASHLESS EVENT WALLET — closed-loop sub-balance (NL-3). OPEN→SPENDING→CLOSED.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.event_wallets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  owner_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state         text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','SPENDING','CLOSED')),
  credential_id uuid REFERENCES public.credentials(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, owner_id)
);
CREATE INDEX IF NOT EXISTS idx_event_wallets_owner ON public.event_wallets (owner_id, state);

-- Append-only sub-ledger: balance = SUM(TOPUP) - SUM(CHARGE+REFUND). UNIQUE idem (NL-9).
CREATE TABLE IF NOT EXISTS public.event_wallet_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id       uuid NOT NULL REFERENCES public.event_wallets(id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type IN ('TOPUP','CHARGE','REFUND')),
  amount_kobo     bigint NOT NULL CHECK (amount_kobo > 0),
  reference       text NOT NULL DEFAULT '',
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_wallet_ledger_idem ON public.event_wallet_ledger (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_event_wallet_ledger_wallet ON public.event_wallet_ledger (wallet_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- VENDORS — POS-lite. Tap-charge accrues vendor_float; settle pays out net of fees.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.event_vendors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  credential_id uuid REFERENCES public.credentials(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_vendors_event ON public.event_vendors (event_id);
CREATE INDEX IF NOT EXISTS idx_event_vendors_user ON public.event_vendors (user_id);

CREATE TABLE IF NOT EXISTS public.vendor_charges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id       uuid NOT NULL REFERENCES public.event_vendors(id) ON DELETE CASCADE,
  wallet_id       uuid NOT NULL REFERENCES public.event_wallets(id) ON DELETE CASCADE,
  amount_kobo     bigint NOT NULL CHECK (amount_kobo > 0),
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_charges_idem ON public.vendor_charges (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_vendor_charges_vendor ON public.vendor_charges (vendor_id, created_at DESC);

-- Vendor float accrual ledger. settled flips at payout (idempotent settlement).
CREATE TABLE IF NOT EXISTS public.vendor_float (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id       uuid NOT NULL REFERENCES public.event_vendors(id) ON DELETE CASCADE,
  amount_kobo     bigint NOT NULL CHECK (amount_kobo > 0),
  reference       text NOT NULL DEFAULT '',
  idempotency_key text NOT NULL,
  settled         boolean NOT NULL DEFAULT false,
  settled_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_float_idem ON public.vendor_float (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_vendor_float_vendor ON public.vendor_float (vendor_id, settled);

CREATE TABLE IF NOT EXISTS public.event_settlements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  vendor_id       uuid NOT NULL REFERENCES public.event_vendors(id) ON DELETE CASCADE,
  gross_kobo      bigint NOT NULL CHECK (gross_kobo >= 0),
  fee_kobo        bigint NOT NULL DEFAULT 0 CHECK (fee_kobo >= 0),
  net_kobo        bigint NOT NULL CHECK (net_kobo >= 0),
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_settlements_idem ON public.event_settlements (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_event_settlements_event ON public.event_settlements (event_id);

-- ════════════════════════════════════════════════════════════════════════════
-- updated_at triggers.
-- ════════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_events_updated ON public.events;
CREATE TRIGGER trg_events_updated BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_event_wallets_updated ON public.event_wallets;
CREATE TRIGGER trg_event_wallets_updated BEFORE UPDATE ON public.event_wallets
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — organiser/owner/vendor scoped reads; service_role writes.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.events              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_ticket_tiers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_promo_codes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_tickets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_wallets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_wallet_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_vendors       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_charges      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_float        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_settlements   ENABLE ROW LEVEL SECURITY;

-- Events: public read of LIVE; organiser reads own at any state.
DROP POLICY IF EXISTS events_read ON public.events;
CREATE POLICY events_read ON public.events
  FOR SELECT TO authenticated USING (state = 'LIVE' OR organiser_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS events_service ON public.events;
CREATE POLICY events_service ON public.events
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS event_tiers_read ON public.event_ticket_tiers;
CREATE POLICY event_tiers_read ON public.event_ticket_tiers
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.events e WHERE e.id = event_ticket_tiers.event_id
        AND (e.state = 'LIVE' OR e.organiser_id = auth.uid())
    )
  );
DROP POLICY IF EXISTS event_tiers_service ON public.event_ticket_tiers;
CREATE POLICY event_tiers_service ON public.event_ticket_tiers
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS event_promos_read ON public.event_promo_codes;
CREATE POLICY event_promos_read ON public.event_promo_codes
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.events e WHERE e.id = event_promo_codes.event_id AND e.organiser_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS event_promos_service ON public.event_promo_codes;
CREATE POLICY event_promos_service ON public.event_promo_codes
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS event_orders_own ON public.event_orders;
CREATE POLICY event_orders_own ON public.event_orders
  FOR SELECT TO authenticated USING (buyer_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS event_orders_service ON public.event_orders;
CREATE POLICY event_orders_service ON public.event_orders
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS event_tickets_own ON public.event_tickets;
CREATE POLICY event_tickets_own ON public.event_tickets
  FOR SELECT TO authenticated USING (
    owner_id = auth.uid() OR public.is_admin() OR EXISTS (
      SELECT 1 FROM public.events e WHERE e.id = event_tickets.event_id AND e.organiser_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS event_tickets_service ON public.event_tickets;
CREATE POLICY event_tickets_service ON public.event_tickets
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS event_wallets_own ON public.event_wallets;
CREATE POLICY event_wallets_own ON public.event_wallets
  FOR SELECT TO authenticated USING (owner_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS event_wallets_service ON public.event_wallets;
CREATE POLICY event_wallets_service ON public.event_wallets
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS event_wallet_ledger_own ON public.event_wallet_ledger;
CREATE POLICY event_wallet_ledger_own ON public.event_wallet_ledger
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.event_wallets w WHERE w.id = event_wallet_ledger.wallet_id AND w.owner_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS event_wallet_ledger_service ON public.event_wallet_ledger;
CREATE POLICY event_wallet_ledger_service ON public.event_wallet_ledger
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS event_vendors_read ON public.event_vendors;
CREATE POLICY event_vendors_read ON public.event_vendors
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR public.is_admin() OR EXISTS (
      SELECT 1 FROM public.events e WHERE e.id = event_vendors.event_id AND e.organiser_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS event_vendors_service ON public.event_vendors;
CREATE POLICY event_vendors_service ON public.event_vendors
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS vendor_charges_read ON public.vendor_charges;
CREATE POLICY vendor_charges_read ON public.vendor_charges
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.event_vendors v WHERE v.id = vendor_charges.vendor_id AND v.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS vendor_charges_service ON public.vendor_charges;
CREATE POLICY vendor_charges_service ON public.vendor_charges
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS vendor_float_read ON public.vendor_float;
CREATE POLICY vendor_float_read ON public.vendor_float
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.event_vendors v WHERE v.id = vendor_float.vendor_id AND v.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS vendor_float_service ON public.vendor_float;
CREATE POLICY vendor_float_service ON public.vendor_float
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS event_settlements_read ON public.event_settlements;
CREATE POLICY event_settlements_read ON public.event_settlements
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.event_vendors v WHERE v.id = event_settlements.vendor_id AND v.user_id = auth.uid()
    ) OR EXISTS (
      SELECT 1 FROM public.events e WHERE e.id = event_settlements.event_id AND e.organiser_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS event_settlements_service ON public.event_settlements;
CREATE POLICY event_settlements_service ON public.event_settlements
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- RBAC — events.* . Additive; ON CONFLICT DO NOTHING.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Manage Own Events',  'events.manage',  'events','event',     'manage',  'Create/configure own events (organiser)',  true),
  ('Approve Events',     'events.approve', 'events','event',     'approve', 'Approve a submitted event',                true),
  ('Suspend Events',     'events.suspend', 'events','event',     'suspend', 'Suspend an event',                         true),
  ('Settle Vendors',     'events.settle',  'events','settlement','settle',  'Pay out an event vendor net of fees',      true),
  ('View Events (Admin)','events.admin.view','events','admin',   'view',    'Ops oversight of events',                  true)
ON CONFLICT (slug) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'events.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug IN ('events.approve','events.suspend','events.settle','events.admin.view'))
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
