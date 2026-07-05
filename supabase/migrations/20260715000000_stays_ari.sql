-- Paymax Stays / Hotel Booking — ARI + Extranet + Settlement + Reviews (SB1)
-- Ref: docs/estate/PRD_Paymax_Hotel_Booking.md §9 (ARI), §10 (pricing), §12 (money/
--      settlement), §13 (cancel/modify/no-show), §14 (reviews), §18 (extranet),
--      §21 (RBAC), appendix B (ARI events).
--      docs/estate/STAYS-BUILD-PLAN.md §2 (invariants), §3 (SB1 tables).
--
-- ADDITIVE-ONLY: CREATE TABLE/INDEX/POLICY IF NOT EXISTS, idempotent seeds.
--   NO DROP TABLE/COLUMN/TYPE, NO RENAME, NO type narrowing.
--   DROP POLICY/TRIGGER IF EXISTS is used only to re-create them idempotently.
-- Money columns are BIGINT kobo (minor units). FKs to auth.users(id) +
--   public.stays_property / public.stays_reservation (owned by SB0).
--
-- Money movement REUSES the finance ledger/settlement (ledger_accounts/entries +
-- settlements). These tables carry ONLY domain references to the posted ledger
-- entries — no balance column is ever added. Reuses public.is_admin() +
-- public.handle_updated_at(). RLS on every table with a service_role bypass.
--
-- Invariants enforced here / by the service:
--   * Oversell impossible — stays_availability_day(allotment,sold) decremented
--     transactionally + row-locked (SELECT ... FOR UPDATE) at book time.
--   * Idempotent ARI/webhook ingest — stays_ari_event UNIQUE(source, external_event_id).
--   * Idempotent payouts — stays_hotel_payout UNIQUE(idempotency_key).
--   * Commission on a SEPARATE ledger account (AccountCommission) — recorded here
--     via stays_commission_entry referencing the posted ledger entry.
--   * Review requires a COMPLETED reservation — enforced in service + a partial
--     UNIQUE(reservation_id) (one review per reservation).
--   * Hotelier object-level authZ — stays_hotelier_profile grants a user a role
--     ON a property; RLS + service checks scope every extranet read/write.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- HOTELIER PROFILE — grants a user an extranet role ON a property (object scope).
-- A user may hold grants on multiple properties; a property may have many staff.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stays_hotelier_profile (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.stays_property(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'OWNER'
                CHECK (role IN ('OWNER','MANAGER','FRONT_DESK','FINANCE','READ_ONLY')),
  status      text NOT NULL DEFAULT 'ACTIVE'
                CHECK (status IN ('PENDING','ACTIVE','SUSPENDED')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, property_id)
);
CREATE INDEX IF NOT EXISTS idx_stays_hotelier_user     ON public.stays_hotelier_profile (user_id, status);
CREATE INDEX IF NOT EXISTS idx_stays_hotelier_property ON public.stays_hotelier_profile (property_id, status);

-- ════════════════════════════════════════════════════════════════════════════
-- RATE DAY — per rate-plan, per-date price + restrictions (the calendar grid).
-- PK (rate_plan_id, date). Money kobo. Restrictions: min/max LOS, CTA/CTD, stop_sell.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stays_rate_day (
  rate_plan_id  uuid NOT NULL REFERENCES public.stays_rate_plan(id) ON DELETE CASCADE,
  date          date NOT NULL,
  price_kobo    bigint NOT NULL DEFAULT 0 CHECK (price_kobo >= 0),
  currency      text NOT NULL DEFAULT 'NGN',
  min_los       int  NOT NULL DEFAULT 1 CHECK (min_los >= 1),
  max_los       int  NOT NULL DEFAULT 0 CHECK (max_los >= 0),  -- 0 = unbounded
  cta           boolean NOT NULL DEFAULT false,                 -- closed-to-arrival
  ctd           boolean NOT NULL DEFAULT false,                 -- closed-to-departure
  stop_sell     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rate_plan_id, date)
);
CREATE INDEX IF NOT EXISTS idx_stays_rate_day_date ON public.stays_rate_day (date);

-- ════════════════════════════════════════════════════════════════════════════
-- AVAILABILITY DAY — per room-type, per-date allotment + sold + stop_sell.
-- The row-locked decrement target: SELECT ... FOR UPDATE on (room_type_id,date)
-- rows for the stay nights; reject when (allotment - sold) < rooms (OVERSELL_BLOCKED).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stays_availability_day (
  room_type_id uuid NOT NULL REFERENCES public.stays_room_type(id) ON DELETE CASCADE,
  date         date NOT NULL,
  allotment    int  NOT NULL DEFAULT 0 CHECK (allotment >= 0),
  sold         int  NOT NULL DEFAULT 0 CHECK (sold >= 0),
  stop_sell    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_type_id, date),
  CONSTRAINT stays_availability_no_oversell CHECK (sold <= allotment)
);
CREATE INDEX IF NOT EXISTS idx_stays_availability_date ON public.stays_availability_day (date);

-- ════════════════════════════════════════════════════════════════════════════
-- PROMOTION — rule-driven discount applied over a date range to rate plans.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stays_promotion (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    uuid NOT NULL REFERENCES public.stays_property(id) ON DELETE CASCADE,
  rate_plan_id   uuid REFERENCES public.stays_rate_plan(id) ON DELETE CASCADE,  -- NULL = all plans
  name           text NOT NULL,
  promo_type     text NOT NULL DEFAULT 'PERCENT'
                   CHECK (promo_type IN ('PERCENT','FIXED','EARLY_BIRD','LAST_MINUTE','LOS')),
  discount_bps   int  NOT NULL DEFAULT 0 CHECK (discount_bps >= 0 AND discount_bps <= 10000),
  discount_kobo  bigint NOT NULL DEFAULT 0 CHECK (discount_kobo >= 0),
  min_los        int  NOT NULL DEFAULT 0 CHECK (min_los >= 0),
  lead_days      int  NOT NULL DEFAULT 0 CHECK (lead_days >= 0),
  date_from      date NOT NULL,
  date_to        date NOT NULL,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (date_to >= date_from)
);
CREATE INDEX IF NOT EXISTS idx_stays_promotion_property ON public.stays_promotion (property_id, active);
CREATE INDEX IF NOT EXISTS idx_stays_promotion_dates    ON public.stays_promotion (date_from, date_to);

-- ════════════════════════════════════════════════════════════════════════════
-- HOTEL PAYOUT — Naira payout to a hotelier (direct rail). Idempotent; held until
-- the hotelier has a first confirmed+completed stay (fraud control). REUSES the
-- finance settlement/wallet for the actual money leg; this row references it.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stays_hotel_payout (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     uuid NOT NULL REFERENCES public.stays_property(id) ON DELETE CASCADE,
  hotelier_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reservation_id  uuid REFERENCES public.stays_reservation(id) ON DELETE SET NULL,
  amount_kobo     bigint NOT NULL DEFAULT 0 CHECK (amount_kobo >= 0),
  currency        text NOT NULL DEFAULT 'NGN',
  status          text NOT NULL DEFAULT 'HELD'
                    CHECK (status IN ('HELD','PENDING','PAID','FAILED','CANCELLED')),
  hold_reason     text NOT NULL DEFAULT '',
  ledger_ref      text NOT NULL DEFAULT '',
  settlement_id   text NOT NULL DEFAULT '',
  idempotency_key text NOT NULL,
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_stays_hotel_payout_property ON public.stays_hotel_payout (property_id, status);
CREATE INDEX IF NOT EXISTS idx_stays_hotel_payout_status   ON public.stays_hotel_payout (status, created_at);

-- ════════════════════════════════════════════════════════════════════════════
-- SUPPLIER REMITTANCE — Rail A supplier remittance lines for reconciliation
-- (matched against Paymax-side expected net-rate remittances).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stays_supplier_remittance (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_code   text NOT NULL,
  reservation_id  uuid REFERENCES public.stays_reservation(id) ON DELETE SET NULL,
  supplier_ref    text NOT NULL DEFAULT '',
  expected_kobo   bigint NOT NULL DEFAULT 0,
  remitted_kobo   bigint NOT NULL DEFAULT 0,
  currency        text NOT NULL DEFAULT 'NGN',
  status          text NOT NULL DEFAULT 'UNMATCHED'
                    CHECK (status IN ('UNMATCHED','MATCHED','BREAK','RESOLVED')),
  break_reason    text NOT NULL DEFAULT '',
  external_ref    text NOT NULL DEFAULT '',
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_stays_remittance_supplier ON public.stays_supplier_remittance (supplier_code, status);
CREATE INDEX IF NOT EXISTS idx_stays_remittance_status   ON public.stays_supplier_remittance (status, created_at);

-- ════════════════════════════════════════════════════════════════════════════
-- COMMISSION ENTRY — Paymax commission per reservation, posted to the SEPARATE
-- AccountCommission ledger account. A refund reverses the commission (sign < 0 on
-- the reversal row). References the posted ledger entry by ledger_ref.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stays_commission_entry (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id  uuid NOT NULL REFERENCES public.stays_reservation(id) ON DELETE CASCADE,
  property_id     uuid REFERENCES public.stays_property(id) ON DELETE SET NULL,
  amount_kobo     bigint NOT NULL DEFAULT 0,   -- positive on accrual; negative on reversal
  currency        text NOT NULL DEFAULT 'NGN',
  kind            text NOT NULL DEFAULT 'ACCRUAL'
                    CHECK (kind IN ('ACCRUAL','REVERSAL')),
  ledger_ref      text NOT NULL DEFAULT '',
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_stays_commission_res      ON public.stays_commission_entry (reservation_id);
CREATE INDEX IF NOT EXISTS idx_stays_commission_property ON public.stays_commission_entry (property_id, created_at);

-- ════════════════════════════════════════════════════════════════════════════
-- REVIEW — verified-guest review (binds reservation + guest + property). Unlocked
-- only after a COMPLETED reservation (enforced in service). One review per
-- reservation (partial UNIQUE). Sub-scores in JSONB; overall 1..5; moderation flag.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stays_review (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.stays_reservation(id) ON DELETE CASCADE,
  property_id    uuid NOT NULL REFERENCES public.stays_property(id) ON DELETE CASCADE,
  guest_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  overall_score  int  NOT NULL CHECK (overall_score BETWEEN 1 AND 5),
  sub_scores     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {cleanliness, location, staff, value, comfort}
  title          text NOT NULL DEFAULT '',
  body           text NOT NULL DEFAULT '',
  status         text NOT NULL DEFAULT 'PUBLISHED'
                   CHECK (status IN ('PUBLISHED','FLAGGED','HIDDEN','PENDING')),
  flagged_reason text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- One verified review per reservation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stays_review_reservation ON public.stays_review (reservation_id);
CREATE INDEX IF NOT EXISTS idx_stays_review_property ON public.stays_review (property_id, status);
CREATE INDEX IF NOT EXISTS idx_stays_review_guest    ON public.stays_review (guest_user_id);

-- ════════════════════════════════════════════════════════════════════════════
-- REVIEW RESPONSE — hotelier response to a review (one per review).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stays_review_response (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id        uuid NOT NULL REFERENCES public.stays_review(id) ON DELETE CASCADE,
  property_id      uuid NOT NULL REFERENCES public.stays_property(id) ON DELETE CASCADE,
  responder_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body             text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id)
);
CREATE INDEX IF NOT EXISTS idx_stays_review_response_property ON public.stays_review_response (property_id);

-- ════════════════════════════════════════════════════════════════════════════
-- ARI EVENT — idempotent Rail-B ARI + reservation-sync webhook ingest.
-- UNIQUE(source, external_event_id) makes a re-delivered webhook a safe no-op.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stays_ari_event (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source            text NOT NULL,            -- supplier_code / channel id
  external_event_id text NOT NULL,
  event_type        text NOT NULL,            -- rate.updated | availability.updated | restriction.updated | stop_sell.toggled | reservation.*
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            text NOT NULL DEFAULT 'APPLIED'
                      CHECK (status IN ('RECEIVED','APPLIED','FAILED','IGNORED')),
  error             text NOT NULL DEFAULT '',
  received_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_event_id)
);
CREATE INDEX IF NOT EXISTS idx_stays_ari_event_type ON public.stays_ari_event (event_type, received_at);

-- ════════════════════════════════════════════════════════════════════════════
-- updated_at triggers (reuse public.handle_updated_at()).
-- ════════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_stays_hotelier_profile_updated ON public.stays_hotelier_profile;
CREATE TRIGGER trg_stays_hotelier_profile_updated BEFORE UPDATE ON public.stays_hotelier_profile
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_stays_rate_day_updated ON public.stays_rate_day;
CREATE TRIGGER trg_stays_rate_day_updated BEFORE UPDATE ON public.stays_rate_day
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_stays_availability_day_updated ON public.stays_availability_day;
CREATE TRIGGER trg_stays_availability_day_updated BEFORE UPDATE ON public.stays_availability_day
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_stays_promotion_updated ON public.stays_promotion;
CREATE TRIGGER trg_stays_promotion_updated BEFORE UPDATE ON public.stays_promotion
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_stays_hotel_payout_updated ON public.stays_hotel_payout;
CREATE TRIGGER trg_stays_hotel_payout_updated BEFORE UPDATE ON public.stays_hotel_payout
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_stays_supplier_remittance_updated ON public.stays_supplier_remittance;
CREATE TRIGGER trg_stays_supplier_remittance_updated BEFORE UPDATE ON public.stays_supplier_remittance
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_stays_review_updated ON public.stays_review;
CREATE TRIGGER trg_stays_review_updated BEFORE UPDATE ON public.stays_review
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_stays_review_response_updated ON public.stays_review_response;
CREATE TRIGGER trg_stays_review_response_updated BEFORE UPDATE ON public.stays_review_response
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — deny-by-default; hotelier object-scoped; guest owns review;
-- service_role full.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.stays_hotelier_profile    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stays_rate_day            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stays_availability_day    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stays_promotion           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stays_hotel_payout        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stays_supplier_remittance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stays_commission_entry    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stays_review              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stays_review_response     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stays_ari_event           ENABLE ROW LEVEL SECURITY;

-- Helper predicate (inlined per-policy): a user is a hotelier for a property when
-- they hold an ACTIVE stays_hotelier_profile grant on it.

-- Hotelier profile: a user sees their own grants; admin sees all; service full.
DROP POLICY IF EXISTS stays_hotelier_profile_own ON public.stays_hotelier_profile;
CREATE POLICY stays_hotelier_profile_own ON public.stays_hotelier_profile
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS stays_hotelier_profile_service ON public.stays_hotelier_profile;
CREATE POLICY stays_hotelier_profile_service ON public.stays_hotelier_profile
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Rate day: hotelier-of-property OR admin select; service full (writes via service-role).
DROP POLICY IF EXISTS stays_rate_day_hotelier ON public.stays_rate_day;
CREATE POLICY stays_rate_day_hotelier ON public.stays_rate_day
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.stays_rate_plan rp
      JOIN public.stays_room_type rt ON rt.id = rp.room_type_id
      JOIN public.stays_hotelier_profile hp ON hp.property_id = rt.property_id
      WHERE rp.id = stays_rate_day.rate_plan_id
        AND hp.user_id = auth.uid() AND hp.status = 'ACTIVE'
    )
  );
DROP POLICY IF EXISTS stays_rate_day_service ON public.stays_rate_day;
CREATE POLICY stays_rate_day_service ON public.stays_rate_day
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Availability day: hotelier-of-property OR admin select; service full.
DROP POLICY IF EXISTS stays_availability_day_hotelier ON public.stays_availability_day;
CREATE POLICY stays_availability_day_hotelier ON public.stays_availability_day
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.stays_room_type rt
      JOIN public.stays_hotelier_profile hp ON hp.property_id = rt.property_id
      WHERE rt.id = stays_availability_day.room_type_id
        AND hp.user_id = auth.uid() AND hp.status = 'ACTIVE'
    )
  );
DROP POLICY IF EXISTS stays_availability_day_service ON public.stays_availability_day;
CREATE POLICY stays_availability_day_service ON public.stays_availability_day
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Promotion: hotelier-of-property OR admin select; service full.
DROP POLICY IF EXISTS stays_promotion_hotelier ON public.stays_promotion;
CREATE POLICY stays_promotion_hotelier ON public.stays_promotion
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.stays_hotelier_profile hp
      WHERE hp.property_id = stays_promotion.property_id
        AND hp.user_id = auth.uid() AND hp.status = 'ACTIVE'
    )
  );
DROP POLICY IF EXISTS stays_promotion_service ON public.stays_promotion;
CREATE POLICY stays_promotion_service ON public.stays_promotion
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Hotel payout: hotelier-of-property OR admin select; service full.
DROP POLICY IF EXISTS stays_hotel_payout_hotelier ON public.stays_hotel_payout;
CREATE POLICY stays_hotel_payout_hotelier ON public.stays_hotel_payout
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.stays_hotelier_profile hp
      WHERE hp.property_id = stays_hotel_payout.property_id
        AND hp.user_id = auth.uid() AND hp.status = 'ACTIVE'
    )
  );
DROP POLICY IF EXISTS stays_hotel_payout_service ON public.stays_hotel_payout;
CREATE POLICY stays_hotel_payout_service ON public.stays_hotel_payout
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Supplier remittance: admin select; service full.
DROP POLICY IF EXISTS stays_supplier_remittance_admin ON public.stays_supplier_remittance;
CREATE POLICY stays_supplier_remittance_admin ON public.stays_supplier_remittance
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS stays_supplier_remittance_service ON public.stays_supplier_remittance;
CREATE POLICY stays_supplier_remittance_service ON public.stays_supplier_remittance
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Commission entry: hotelier-of-property OR admin select; service full.
DROP POLICY IF EXISTS stays_commission_entry_hotelier ON public.stays_commission_entry;
CREATE POLICY stays_commission_entry_hotelier ON public.stays_commission_entry
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.stays_hotelier_profile hp
      WHERE hp.property_id = stays_commission_entry.property_id
        AND hp.user_id = auth.uid() AND hp.status = 'ACTIVE'
    )
  );
DROP POLICY IF EXISTS stays_commission_entry_service ON public.stays_commission_entry;
CREATE POLICY stays_commission_entry_service ON public.stays_commission_entry
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Review: PUBLISHED readable by authenticated; guest OWNS their review; hotelier of
-- the property + admin read all; service full.
DROP POLICY IF EXISTS stays_review_read ON public.stays_review;
CREATE POLICY stays_review_read ON public.stays_review
  FOR SELECT TO authenticated USING (
    status = 'PUBLISHED'
    OR guest_user_id = auth.uid()
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.stays_hotelier_profile hp
      WHERE hp.property_id = stays_review.property_id
        AND hp.user_id = auth.uid() AND hp.status = 'ACTIVE'
    )
  );
DROP POLICY IF EXISTS stays_review_service ON public.stays_review;
CREATE POLICY stays_review_service ON public.stays_review
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Review response: PUBLISHED-review responses readable by authenticated; hotelier of
-- the property + admin; service full.
DROP POLICY IF EXISTS stays_review_response_read ON public.stays_review_response;
CREATE POLICY stays_review_response_read ON public.stays_review_response
  FOR SELECT TO authenticated USING (
    public.is_admin()
    OR EXISTS (SELECT 1 FROM public.stays_review r WHERE r.id = stays_review_response.review_id AND r.status = 'PUBLISHED')
    OR EXISTS (
      SELECT 1 FROM public.stays_hotelier_profile hp
      WHERE hp.property_id = stays_review_response.property_id
        AND hp.user_id = auth.uid() AND hp.status = 'ACTIVE'
    )
  );
DROP POLICY IF EXISTS stays_review_response_service ON public.stays_review_response;
CREATE POLICY stays_review_response_service ON public.stays_review_response
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ARI event: admin select; service full (webhooks ingest via service-role).
DROP POLICY IF EXISTS stays_ari_event_admin ON public.stays_ari_event;
CREATE POLICY stays_ari_event_admin ON public.stays_ari_event
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS stays_ari_event_service ON public.stays_ari_event;
CREATE POLICY stays_ari_event_service ON public.stays_ari_event
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- RBAC permissions (additive; ON CONFLICT DO NOTHING).
--   stays.hotelier.* — object-scoped extranet capabilities (object check IN service).
--   stays.admin.*    — a few new ops perms not seeded by SB0 (settlement/commission/
--                      hotelier/review). The SB0 set (supplier/mapping/moderation/
--                      reservation/pricing/reconciliation/payout/refund/audit) stays.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Use Stays Extranet',           'stays.hotelier.access',     'stays','extranet',    'view',   'Access the hotelier extranet for granted properties', true),
  ('Manage Stays Content',         'stays.hotelier.content',    'stays','content',     'manage', 'Edit property content, room types, rate plans',       true),
  ('Manage Stays Calendar',        'stays.hotelier.calendar',   'stays','calendar',    'manage', 'Edit rates/availability/restrictions (ARI grid)',     true),
  ('Manage Stays Promotions',      'stays.hotelier.promotion',  'stays','promotion',   'manage', 'Create/manage promotions + derived rates',            true),
  ('Manage Stays Reservations',    'stays.hotelier.reservation','stays','reservation', 'manage', 'View/modify/cancel/no-show reservations on property', true),
  ('Respond to Stays Reviews',     'stays.hotelier.review',     'stays','review',      'manage', 'Respond to + flag reviews on property',               true),
  ('View Stays Finance',           'stays.hotelier.finance',    'stays','finance',     'view',   'View payouts/statements/commission/deposit recon',    true),
  ('View Stays Analytics',         'stays.hotelier.analytics',  'stays','analytics',   'view',   'View occupancy/ADR/RevPAR analytics',                 true),
  ('Manage Stays Staff',           'stays.hotelier.staff',      'stays','staff',       'manage', 'Manage extranet users + roles within property',       true),
  ('Manage Stays Settlement',      'stays.admin.settlement',    'stays','settlement',  'manage', 'Action hotel payouts + remittance reconciliation',    true),
  ('Manage Stays Commission',      'stays.admin.commission',    'stays','commission',  'view',   'View commission ledger + breaks',                     true),
  ('Manage Stays Hoteliers',       'stays.admin.hotelier',      'stays','hotelier',    'manage', 'Approve/suspend hotelier profiles + grants',          true),
  ('Moderate Stays Reviews',       'stays.admin.review',        'stays','review',      'manage', 'Moderate (hide/flag) reviews across properties',      true)
ON CONFLICT (slug) DO NOTHING;

-- Grant the full new stays.* set to super-admin and system-admin.
WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'stays.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'stays.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
