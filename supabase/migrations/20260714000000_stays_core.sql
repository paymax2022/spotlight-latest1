-- Paymax Stays / Hotel Booking — Core (SB0)
-- Ref: docs/estate/PRD_Paymax_Hotel_Booking.md §8 (data model), §11 (state machine),
--      docs/estate/STAYS-BUILD-PLAN.md §3 (shared DB contract SB0 OWNS).
--
-- ADDITIVE-ONLY: CREATE TABLE/INDEX/POLICY IF NOT EXISTS, idempotent seeds.
--   NO DROP TABLE/COLUMN/TYPE, NO RENAME, NO type narrowing.
--   DROP POLICY/TRIGGER IF EXISTS is used only to re-create them idempotently.
-- Money columns are BIGINT kobo (minor units). FKs to auth.users(id). PostGIS geo.
--
-- Money movement REUSES the finance ledger/settlement (ledger_accounts/entries +
-- settlements); these tables carry ONLY domain references to the posted ledger
-- entries — no balance column is ever added. Reuses public.is_admin() +
-- public.handle_updated_at(). RLS on every table with a service_role bypass.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

-- ════════════════════════════════════════════════════════════════════════════
-- SUPPLIER CONFIG — the data-driven routing table (rail+supplier → adapter).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stays_supplier_config (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_rail   text NOT NULL CHECK (source_rail IN ('BEDBANK','DIRECT')),
  supplier_code text NOT NULL,
  adapter       text NOT NULL,                 -- adapter Name(): bedbank | direct
  active        boolean NOT NULL DEFAULT false,
  config        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- non-secret config; secrets live in env
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_rail, supplier_code)
);

-- ════════════════════════════════════════════════════════════════════════════
-- PROPERTY — hotel; source rail; dedup mapped id; PostGIS geo; moderation status.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stays_property (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_rail           text NOT NULL CHECK (source_rail IN ('BEDBANK','DIRECT')),
  supplier_code         text NOT NULL,
  supplier_property_ref text NOT NULL,
  mapped_property_id    text,                            -- dedup group key (nullable)
  name                  text NOT NULL,
  geo                   geography(Point, 4326),          -- PostGIS point (lng,lat)
  address               text NOT NULL DEFAULT '',
  city                  text NOT NULL DEFAULT '',
  star_rating           int  NOT NULL DEFAULT 0 CHECK (star_rating BETWEEN 0 AND 5),
  property_type         text NOT NULL DEFAULT 'hotel',
  description           text,
  content_ref           text,
  status                text NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN ('DRAFT','PENDING_REVIEW','ACTIVE','SUSPENDED')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_code, supplier_property_ref)
);
CREATE INDEX IF NOT EXISTS idx_stays_property_geo   ON public.stays_property USING GIST (geo);
CREATE INDEX IF NOT EXISTS idx_stays_property_city  ON public.stays_property (city, status);
CREATE INDEX IF NOT EXISTS idx_stays_property_mapped ON public.stays_property (mapped_property_id);

-- ════════════════════════════════════════════════════════════════════════════
-- ROOM TYPE — per property; occupancy/bedding/size/photos.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stays_room_type (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id            uuid NOT NULL REFERENCES public.stays_property(id) ON DELETE CASCADE,
  supplier_room_type_ref text NOT NULL DEFAULT '',
  name                   text NOT NULL,
  occupancy              int  NOT NULL DEFAULT 2 CHECK (occupancy >= 1),
  bedding                text NOT NULL DEFAULT '',
  size_sqm               numeric,
  photos                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stays_room_type_property ON public.stays_room_type (property_id);

-- ════════════════════════════════════════════════════════════════════════════
-- RATE PLAN — per room type; board/refundability/mobile flag; base sell rate.
-- (Per-date rate/availability tables are owned by SB1; the base rate here lets the
--  direct adapter price + prebook until the calendar is live.)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stays_rate_plan (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_type_id           uuid NOT NULL REFERENCES public.stays_room_type(id) ON DELETE CASCADE,
  supplier_rate_plan_ref text NOT NULL DEFAULT '',
  rate_plan_type         text NOT NULL DEFAULT 'BAR'
                           CHECK (rate_plan_type IN ('BAR','NON_REFUNDABLE','BREAKFAST',
                                                     'MOBILE_ONLY','LOS_DISCOUNT','EARLY_BIRD','LAST_MINUTE')),
  board                  text NOT NULL DEFAULT 'room_only',
  refundable             boolean NOT NULL DEFAULT true,
  mobile_only            boolean NOT NULL DEFAULT false,
  cancellation_policy    jsonb NOT NULL DEFAULT '{}'::jsonb,
  base_sell_rate_kobo    bigint NOT NULL DEFAULT 0 CHECK (base_sell_rate_kobo >= 0),
  tax_kobo               bigint NOT NULL DEFAULT 0 CHECK (tax_kobo >= 0),
  currency               text NOT NULL DEFAULT 'NGN',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stays_rate_plan_room ON public.stays_rate_plan (room_type_id);

-- ════════════════════════════════════════════════════════════════════════════
-- OFFER — ephemeral search result (property+roomtype+rateplan+price+book_token); ttl.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stays_offer (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_user_id          uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  source_rail            text NOT NULL CHECK (source_rail IN ('BEDBANK','DIRECT')),
  supplier_code          text NOT NULL,
  supplier_property_ref  text NOT NULL,
  supplier_room_type_ref text NOT NULL DEFAULT '',
  supplier_rate_plan_ref text NOT NULL DEFAULT '',
  gross_amount_kobo      bigint NOT NULL DEFAULT 0 CHECK (gross_amount_kobo >= 0),
  currency               text NOT NULL DEFAULT 'NGN',
  offer_token            text,
  book_token             text,
  expires_at             timestamptz NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stays_offer_user    ON public.stays_offer (guest_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stays_offer_expires ON public.stays_offer (expires_at);

-- ════════════════════════════════════════════════════════════════════════════
-- RESERVATION — durable, guarded lifecycle; supplier_ref + idempotency unique.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stays_reservation (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id                 uuid,           -- soft ref (Rail A properties may be synced lazily)
  room_type_id                uuid,
  rate_plan_id                uuid,
  source_rail                 text NOT NULL CHECK (source_rail IN ('BEDBANK','DIRECT')),
  supplier_code               text NOT NULL DEFAULT '',
  supplier_ref                text,           -- NULL until CONFIRMED
  state                       text NOT NULL DEFAULT 'SEARCHING'
                                CHECK (state IN ('SEARCHING','OFFER_SELECTED','PREBOOK_OK',
                                                 'PAYMENT_HELD','BOOKING','CONFIRMED','COMPLETED',
                                                 'CANCELLED_BY_GUEST','CANCELLED_BY_HOTEL','NO_SHOW',
                                                 'BOOK_FAILED','PAYMENT_FAILED','PREBOOK_FAILED','VOID')),
  check_in                    date NOT NULL,
  check_out                   date NOT NULL,
  rooms                       int  NOT NULL DEFAULT 1 CHECK (rooms >= 1),
  occupancy                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  currency                    text NOT NULL DEFAULT 'NGN',
  gross_amount_kobo           bigint NOT NULL DEFAULT 0 CHECK (gross_amount_kobo >= 0),
  tax_amount_kobo             bigint NOT NULL DEFAULT 0 CHECK (tax_amount_kobo >= 0),
  net_rate_kobo               bigint NOT NULL DEFAULT 0 CHECK (net_rate_kobo >= 0),
  markup_kobo                 bigint NOT NULL DEFAULT 0 CHECK (markup_kobo >= 0),
  commission_kobo             bigint NOT NULL DEFAULT 0 CHECK (commission_kobo >= 0),
  payment_method              text NOT NULL DEFAULT 'WALLET'
                                CHECK (payment_method IN ('WALLET','CARD','TRANSFER','PAY_AT_PROPERTY','DEPOSIT')),
  cancellation_policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key             text NOT NULL,
  book_token_ref              text,
  voucher_ref                 text,
  version                     int NOT NULL DEFAULT 1,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
-- Idempotent book: one reservation per idempotency_key (replay-safe saga).
CREATE UNIQUE INDEX IF NOT EXISTS uq_stays_reservation_idem
  ON public.stays_reservation (idempotency_key);
-- One supplier reservation ref is unique per rail (no double-book projection).
CREATE UNIQUE INDEX IF NOT EXISTS uq_stays_reservation_supplier_ref
  ON public.stays_reservation (source_rail, supplier_ref)
  WHERE supplier_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stays_reservation_guest    ON public.stays_reservation (guest_user_id, state);
CREATE INDEX IF NOT EXISTS idx_stays_reservation_property ON public.stays_reservation (property_id, check_in);
CREATE INDEX IF NOT EXISTS idx_stays_reservation_state    ON public.stays_reservation (state, check_in);

-- ════════════════════════════════════════════════════════════════════════════
-- RESERVATION GUEST — lead guest + occupants (PII; shared post-consent only).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stays_reservation_guest (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.stays_reservation(id) ON DELETE CASCADE,
  first_name     text NOT NULL,
  last_name      text NOT NULL,
  email          text NOT NULL DEFAULT '',
  phone          text NOT NULL DEFAULT '',
  is_lead        boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stays_res_guest_res ON public.stays_reservation_guest (reservation_id);

-- ════════════════════════════════════════════════════════════════════════════
-- PAYMENT INTENT — links to wallet ledger entries; method; status (held/charged/released).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stays_payment_intent (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.stays_reservation(id) ON DELETE CASCADE,
  method         text NOT NULL,
  status         text NOT NULL DEFAULT 'held'
                   CHECK (status IN ('held','charged','released','refunded','failed')),
  ledger_ref     text NOT NULL DEFAULT '',
  idempotency_key text NOT NULL,
  amount_kobo    bigint NOT NULL DEFAULT 0 CHECK (amount_kobo >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_stays_payment_intent_res ON public.stays_payment_intent (reservation_id);

-- ════════════════════════════════════════════════════════════════════════════
-- CANCELLATION — policy snapshot; refund amount; ledger ref.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stays_cancellation (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id  uuid NOT NULL REFERENCES public.stays_reservation(id) ON DELETE CASCADE,
  reason          text NOT NULL DEFAULT '',
  refund_kobo     bigint NOT NULL DEFAULT 0 CHECK (refund_kobo >= 0),
  penalty_kobo    bigint NOT NULL DEFAULT 0 CHECK (penalty_kobo >= 0),
  policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ledger_ref      text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stays_cancellation_res ON public.stays_cancellation (reservation_id);

-- ════════════════════════════════════════════════════════════════════════════
-- CONSENT — NDPA; gates guest PII share to supplier/hotel.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stays_consent (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope      text NOT NULL DEFAULT 'supplier_data_share',
  version    text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, scope, version)
);
CREATE INDEX IF NOT EXISTS idx_stays_consent_user ON public.stays_consent (user_id);

-- ════════════════════════════════════════════════════════════════════════════
-- MAPPING RECORD — cross-supplier identity; confidence; status (dedup queue).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stays_mapping_record (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_rail                     text NOT NULL CHECK (source_rail IN ('BEDBANK','DIRECT')),
  supplier_code                   text NOT NULL,
  supplier_property_ref           text NOT NULL,
  candidate_rail                  text NOT NULL DEFAULT '',
  candidate_supplier_code         text NOT NULL DEFAULT '',
  candidate_supplier_property_ref text NOT NULL DEFAULT '',
  confidence                      numeric NOT NULL DEFAULT 0,
  mapped_property_id              text,
  status                          text NOT NULL DEFAULT 'PENDING_REVIEW'
                                    CHECK (status IN ('PENDING_REVIEW','MAPPED','REJECTED')),
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_rail, supplier_code, supplier_property_ref,
          candidate_rail, candidate_supplier_code, candidate_supplier_property_ref)
);
CREATE INDEX IF NOT EXISTS idx_stays_mapping_status ON public.stays_mapping_record (status, confidence DESC);
CREATE INDEX IF NOT EXISTS idx_stays_mapping_mapped ON public.stays_mapping_record (mapped_property_id);

-- ════════════════════════════════════════════════════════════════════════════
-- updated_at triggers (reuse public.handle_updated_at()).
-- ════════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_stays_supplier_config_updated ON public.stays_supplier_config;
CREATE TRIGGER trg_stays_supplier_config_updated BEFORE UPDATE ON public.stays_supplier_config
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_stays_property_updated ON public.stays_property;
CREATE TRIGGER trg_stays_property_updated BEFORE UPDATE ON public.stays_property
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_stays_room_type_updated ON public.stays_room_type;
CREATE TRIGGER trg_stays_room_type_updated BEFORE UPDATE ON public.stays_room_type
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_stays_rate_plan_updated ON public.stays_rate_plan;
CREATE TRIGGER trg_stays_rate_plan_updated BEFORE UPDATE ON public.stays_rate_plan
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_stays_reservation_updated ON public.stays_reservation;
CREATE TRIGGER trg_stays_reservation_updated BEFORE UPDATE ON public.stays_reservation
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_stays_mapping_record_updated ON public.stays_mapping_record;
CREATE TRIGGER trg_stays_mapping_record_updated BEFORE UPDATE ON public.stays_mapping_record
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — deny-by-default; guest owns reservation; service_role full.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.stays_supplier_config    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stays_property           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stays_room_type          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stays_rate_plan          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stays_offer              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stays_reservation        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stays_reservation_guest  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stays_payment_intent     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stays_cancellation       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stays_consent            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stays_mapping_record     ENABLE ROW LEVEL SECURITY;

-- Supplier config: admin read; service_role full.
DROP POLICY IF EXISTS stays_supplier_config_admin ON public.stays_supplier_config;
CREATE POLICY stays_supplier_config_admin ON public.stays_supplier_config
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS stays_supplier_config_service ON public.stays_supplier_config;
CREATE POLICY stays_supplier_config_service ON public.stays_supplier_config
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Property / room type / rate plan: ACTIVE rows readable by authenticated (search);
-- admin sees all; service_role full.
DROP POLICY IF EXISTS stays_property_read ON public.stays_property;
CREATE POLICY stays_property_read ON public.stays_property
  FOR SELECT TO authenticated USING (status = 'ACTIVE' OR public.is_admin());
DROP POLICY IF EXISTS stays_property_service ON public.stays_property;
CREATE POLICY stays_property_service ON public.stays_property
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS stays_room_type_read ON public.stays_room_type;
CREATE POLICY stays_room_type_read ON public.stays_room_type
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS stays_room_type_service ON public.stays_room_type;
CREATE POLICY stays_room_type_service ON public.stays_room_type
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS stays_rate_plan_read ON public.stays_rate_plan;
CREATE POLICY stays_rate_plan_read ON public.stays_rate_plan
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS stays_rate_plan_service ON public.stays_rate_plan;
CREATE POLICY stays_rate_plan_service ON public.stays_rate_plan
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Offer: owner select; service_role full.
DROP POLICY IF EXISTS stays_offer_own ON public.stays_offer;
CREATE POLICY stays_offer_own ON public.stays_offer
  FOR SELECT TO authenticated USING (guest_user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS stays_offer_service ON public.stays_offer;
CREATE POLICY stays_offer_service ON public.stays_offer
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Reservation: guest OWNS the reservation (object-level); admin sees all; service full.
DROP POLICY IF EXISTS stays_reservation_own ON public.stays_reservation;
CREATE POLICY stays_reservation_own ON public.stays_reservation
  FOR SELECT TO authenticated USING (guest_user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS stays_reservation_service ON public.stays_reservation;
CREATE POLICY stays_reservation_service ON public.stays_reservation
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Reservation guest (PII): owner-of-reservation select; service full.
DROP POLICY IF EXISTS stays_res_guest_own ON public.stays_reservation_guest;
CREATE POLICY stays_res_guest_own ON public.stays_reservation_guest
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.stays_reservation r
      WHERE r.id = stays_reservation_guest.reservation_id AND r.guest_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS stays_res_guest_service ON public.stays_reservation_guest;
CREATE POLICY stays_res_guest_service ON public.stays_reservation_guest
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Payment intent: owner-of-reservation select; service full.
DROP POLICY IF EXISTS stays_payment_intent_own ON public.stays_payment_intent;
CREATE POLICY stays_payment_intent_own ON public.stays_payment_intent
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.stays_reservation r
      WHERE r.id = stays_payment_intent.reservation_id AND r.guest_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS stays_payment_intent_service ON public.stays_payment_intent;
CREATE POLICY stays_payment_intent_service ON public.stays_payment_intent
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Cancellation: owner-of-reservation select; service full.
DROP POLICY IF EXISTS stays_cancellation_own ON public.stays_cancellation;
CREATE POLICY stays_cancellation_own ON public.stays_cancellation
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.stays_reservation r
      WHERE r.id = stays_cancellation.reservation_id AND r.guest_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS stays_cancellation_service ON public.stays_cancellation;
CREATE POLICY stays_cancellation_service ON public.stays_cancellation
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Consent: owner select; service full (the engine grants via service-role).
DROP POLICY IF EXISTS stays_consent_own ON public.stays_consent;
CREATE POLICY stays_consent_own ON public.stays_consent
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS stays_consent_service ON public.stays_consent;
CREATE POLICY stays_consent_service ON public.stays_consent
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Mapping record: admin select; service full.
DROP POLICY IF EXISTS stays_mapping_admin ON public.stays_mapping_record;
CREATE POLICY stays_mapping_admin ON public.stays_mapping_record
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS stays_mapping_service ON public.stays_mapping_record;
CREATE POLICY stays_mapping_service ON public.stays_mapping_record
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- RBAC permissions (additive; ON CONFLICT DO NOTHING). Reuses permissions/roles/
-- role_permissions. stays.search.view (public-ish), stays.booking.manage (own),
-- stays.admin.* (ops control plane).
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('View Stays Search',          'stays.search.view',         'stays','search',      'view',   'Search hotels/stays',                       true),
  ('Manage Own Stays Bookings',  'stays.booking.manage',      'stays','booking',     'manage', 'Prebook/book/cancel/modify own reservations', true),
  ('Manage Stays Suppliers',     'stays.admin.supplier',      'stays','supplier',    'manage', 'Manage supply connectivity config',         true),
  ('Manage Stays Mapping',       'stays.admin.mapping',       'stays','mapping',      'manage', 'Resolve the dedup mapping queue',           true),
  ('Moderate Stays Properties',  'stays.admin.moderation',    'stays','property',     'manage', 'Activate/suspend properties',               true),
  ('Search Stays Reservations',  'stays.admin.reservation',   'stays','reservation',  'view',   'Search reservations across guests (ops)',   true),
  ('Manage Stays Pricing',       'stays.admin.pricing',       'stays','pricing',      'manage', 'Manage markup/commission/FX rules',         true),
  ('View Stays Reconciliation',  'stays.admin.reconciliation','stays','reconciliation','view',  'View reservation money-leg reconciliation', true),
  ('Manage Stays Payouts',       'stays.admin.payout',        'stays','payout',       'manage', 'Action hotel payouts (Naira)',              true),
  ('Manage Stays Refunds',       'stays.admin.refund',        'stays','refund',       'manage', 'Action the refund queue',                   true),
  ('View Stays Audit',           'stays.admin.audit',         'stays','audit',        'view',   'View/export stays audit + consent log',     true)
ON CONFLICT (slug) DO NOTHING;

-- Grant the full stays.* set to super-admin and system-admin.
WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'stays.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'stays.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- SEED — sandbox suppliers + a couple of DIRECT properties (active=false until
-- live keys + production routing are confirmed). Illustrative, NOT real inventory.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.stays_supplier_config (source_rail, supplier_code, adapter, active)
VALUES
  ('BEDBANK', 'bedbank-sandbox', 'bedbank', false),
  ('DIRECT',  'paymax-direct',   'direct',  false)
ON CONFLICT (source_rail, supplier_code) DO NOTHING;

INSERT INTO public.stays_property
  (source_rail, supplier_code, supplier_property_ref, name, geo, address, city,
   star_rating, property_type, status)
VALUES
  ('DIRECT', 'paymax-direct', 'DIR-SEED-001', 'Sandbox Lagos Suites',
   ST_SetSRID(ST_MakePoint(3.4216, 6.4281), 4326)::geography,
   '1 Sandbox Way, Victoria Island', 'Lagos', 4, 'hotel', 'DRAFT'),
  ('DIRECT', 'paymax-direct', 'DIR-SEED-002', 'Sandbox Abuja Lodge',
   ST_SetSRID(ST_MakePoint(7.4951, 9.0579), 4326)::geography,
   '2 Sandbox Cres, Maitama', 'Abuja', 3, 'hotel', 'DRAFT')
ON CONFLICT (supplier_code, supplier_property_ref) DO NOTHING;

COMMIT;
