-- Migration: featured_placement_core
-- Module: Featured Placement (paid landing-page promotion)
-- ADDITIVE ONLY. No DROP, no column renames, no type narrowing.
--
-- Iron rules honored:
--   * Money columns are BIGINT kobo (integer minor units). Never float.
--   * Money MOVEMENT reuses the finance ledger standing accounts
--     (PLACEMENT_ESCROW / PLACEMENT_REVENUE) — created on first use in Go via
--     ledger.GetOrCreateStandingAccount, exactly like AccountEscrow. No new
--     payment engine, no balance columns; balances stay derived from the ledger.
--   * Overlap for EXCLUSIVE zones is made structurally impossible by a GiST
--     EXCLUDE constraint (btree_gist) — illegal states unreachable in the schema,
--     not just app code.
--   * Subjects are polymorphic (subject_type + subject_id TEXT, no FK) mirroring
--     maps.merchant_locations, so any listable entity (product/service/property/
--     event/store/creator) can be featured without copying its data.
--   * RLS enabled on every table; service_role (Go pgx pool) is the writer.
--
-- All windows stored UTC (timestamptz); presented in Africa/Lagos by clients.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- scalar '=' opclass for the GiST EXCLUDE (already enabled in 20260620020000)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) placement_zone — versioned inventory config (NOT code). Two layout types.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.placement_zone (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 TEXT        NOT NULL UNIQUE,                       -- HERO | SPOTLIGHT_CAROUSEL | FEATURED_GRID
  label                TEXT        NOT NULL,
  layout_type          TEXT        NOT NULL CHECK (layout_type IN ('EXCLUSIVE','POOLED')),
  capacity             INTEGER     NOT NULL DEFAULT 1 CHECK (capacity >= 1),  -- concurrent slots (=1 for EXCLUSIVE)
  base_daily_rate_kobo BIGINT      NOT NULL CHECK (base_daily_rate_kobo > 0),
  tier_multiplier      NUMERIC(6,3) NOT NULL DEFAULT 1.000 CHECK (tier_multiplier > 0), -- config factor; final price is integer kobo
  position             INTEGER     NOT NULL DEFAULT 0,
  is_active            BOOLEAN     NOT NULL DEFAULT TRUE,
  creative_spec        JSONB       NOT NULL DEFAULT '{}'::jsonb,          -- {image_ratio, headline_max, cta_options[]}
  rate_version         INTEGER     NOT NULL DEFAULT 1,                    -- bump on any pricing change; quotes lock to this
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) featured_campaign — the booking REQUEST + review state (distinct from the
--    durable reservation it produces on approval). One row never does both jobs.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.featured_campaign (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_type       TEXT        NOT NULL,                                -- 'product'|'service'|'property'|'event'|'store'|'creator'
  subject_id         TEXT        NOT NULL,                                -- polymorphic, no FK (mixed PK types across modules)
  zone_code          TEXT        NOT NULL REFERENCES public.placement_zone(code),
  window_start       TIMESTAMPTZ NOT NULL,
  window_end         TIMESTAMPTZ NOT NULL,
  duration_days      INTEGER     NOT NULL CHECK (duration_days > 0),
  creative           JSONB       NOT NULL DEFAULT '{}'::jsonb,            -- {headline, image_ref, cta, deep_link}
  quoted_price_kobo  BIGINT      NOT NULL CHECK (quoted_price_kobo >= 0),
  rate_version       INTEGER     NOT NULL,                                -- rate version the quote was locked against
  state              TEXT        NOT NULL DEFAULT 'DRAFT' CHECK (state IN (
                        'DRAFT','SUBMITTED','UNDER_REVIEW','NEEDS_MORE_INFO','REJECTED',
                        'PENDING_PAYMENT','SCHEDULED','ACTIVE','PAUSED','SUSPENDED',
                        'CANCELLED','CANCELLED_EARLY','COMPLETED')),
  review_reviewer_id UUID        REFERENCES auth.users(id),
  review_decision    TEXT,
  review_reason      TEXT,
  reviewed_at        TIMESTAMPTZ,
  payment_ref        TEXT,
  paused_intervals   JSONB       NOT NULL DEFAULT '[]'::jsonb,            -- [{from,to}] for window_end credit accounting
  activated_at       TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  version            INTEGER     NOT NULL DEFAULT 0,                      -- optimistic lock for guarded transitions
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (window_end > window_start)
);
CREATE INDEX IF NOT EXISTS idx_featured_campaign_merchant ON public.featured_campaign (merchant_id);
CREATE INDEX IF NOT EXISTS idx_featured_campaign_zone     ON public.featured_campaign (zone_code);
CREATE INDEX IF NOT EXISTS idx_featured_campaign_state    ON public.featured_campaign (state);
-- Anti-monopoly + serve-time scan helper: active windows per zone.
CREATE INDEX IF NOT EXISTS idx_featured_campaign_serving  ON public.featured_campaign (zone_code, state, window_start, window_end);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) placement_reservation — the durable, non-overlapping slot HOLD produced on
--    approval for EXCLUSIVE zones. One-to-one with a campaign. POOLED zones do
--    NOT reserve (capacity is checked transactionally at activation instead).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.placement_reservation (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID        NOT NULL UNIQUE REFERENCES public.featured_campaign(id) ON DELETE CASCADE,
  zone_code     TEXT        NOT NULL REFERENCES public.placement_zone(code),
  window_start  TIMESTAMPTZ NOT NULL,
  window_end    TIMESTAMPTZ NOT NULL,
  -- Mirrors the campaign lifecycle; only the "holding" states occupy the slot.
  state         TEXT        NOT NULL DEFAULT 'SCHEDULED' CHECK (state IN (
                  'SCHEDULED','ACTIVE','PAUSED','CANCELLED','COMPLETED','SUSPENDED')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (window_end > window_start),
  -- THE invariant: no two holding reservations may overlap in the same zone.
  -- Half-open '[)' ranges make back-to-back windows non-overlapping. btree_gist
  -- provides the '=' opclass for the scalar zone_code dimension.
  CONSTRAINT placement_reservation_no_overlap EXCLUDE USING gist (
    zone_code WITH =,
    tstzrange(window_start, window_end, '[)') WITH &&
  ) WHERE (state IN ('SCHEDULED','ACTIVE','PAUSED'))
);
CREATE INDEX IF NOT EXISTS idx_placement_reservation_zone ON public.placement_reservation (zone_code, state);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Analytics events — append-only, keyed by per-serve placement_token.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.placement_impression_event (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID        NOT NULL REFERENCES public.featured_campaign(id) ON DELETE CASCADE,
  zone_code       TEXT        NOT NULL,
  placement_token TEXT        NOT NULL,
  session_id      TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_placement_impression_campaign ON public.placement_impression_event (campaign_id, occurred_at);

CREATE TABLE IF NOT EXISTS public.placement_tap_event (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID        NOT NULL REFERENCES public.featured_campaign(id) ON DELETE CASCADE,
  zone_code       TEXT        NOT NULL,
  placement_token TEXT        NOT NULL,
  session_id      TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_placement_tap_campaign ON public.placement_tap_event (campaign_id, occurred_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) placement_audit_log — immutable record of every decision + money movement.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.placement_audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID        REFERENCES public.featured_campaign(id) ON DELETE CASCADE,
  actor_id    UUID,                                                       -- user/admin; NULL = system (scheduler)
  action      TEXT        NOT NULL,                                       -- e.g. 'placement.submit', 'placement.approve'
  before      JSONB,
  after       JSONB,
  metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_placement_audit_campaign ON public.placement_audit_log (campaign_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at triggers (reuse shared public.handle_updated_at()).
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_placement_zone_updated        ON public.placement_zone;
CREATE TRIGGER trg_placement_zone_updated        BEFORE UPDATE ON public.placement_zone        FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_featured_campaign_updated     ON public.featured_campaign;
CREATE TRIGGER trg_featured_campaign_updated     BEFORE UPDATE ON public.featured_campaign     FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_placement_reservation_updated ON public.placement_reservation;
CREATE TRIGGER trg_placement_reservation_updated BEFORE UPDATE ON public.placement_reservation FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — enabled everywhere. service_role (Go pgx pool) bypasses RLS and is the
-- only writer. Merchants may read their own campaigns via Supabase REST.
-- Zones are world-readable (the landing resolver is consumer-facing/public).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.placement_zone             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.featured_campaign          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.placement_reservation      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.placement_impression_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.placement_tap_event        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.placement_audit_log        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "placement_zone_select_all" ON public.placement_zone;
CREATE POLICY "placement_zone_select_all"
  ON public.placement_zone FOR SELECT TO anon, authenticated
  USING (is_active = TRUE);

DROP POLICY IF EXISTS "featured_campaign_select_own" ON public.featured_campaign;
CREATE POLICY "featured_campaign_select_own"
  ON public.featured_campaign FOR SELECT TO authenticated
  USING (auth.uid() = merchant_id);
-- No INSERT/UPDATE/DELETE policy → only service_role (Go) writes campaigns.

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed v1 zones (idempotent). Commercial knobs (§15) — change without re-arch.
--   base_daily_rate_kobo: HERO ₦50,000/day · CAROUSEL ₦8,000/day · GRID ₦3,000/day
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.placement_zone
  (code, label, layout_type, capacity, base_daily_rate_kobo, tier_multiplier, position, creative_spec)
VALUES
  ('HERO',               'Landing Hero',       'EXCLUSIVE',  1, 5000000, 1.000, 0,
     '{"image_ratio":"16:9","headline_max":48,"cta_options":["Shop now","Learn more","Book now","View"]}'::jsonb),
  ('SPOTLIGHT_CAROUSEL', 'Spotlight Carousel', 'POOLED',     8,  800000, 1.000, 1,
     '{"image_ratio":"4:3","headline_max":32,"cta_options":["Shop now","Learn more","View"]}'::jsonb),
  ('FEATURED_GRID',      'Featured Grid',      'POOLED',    12,  300000, 1.000, 2,
     '{"image_ratio":"1:1","headline_max":24,"cta_options":["View","Learn more"]}'::jsonb)
ON CONFLICT (code) DO NOTHING;

COMMIT;
