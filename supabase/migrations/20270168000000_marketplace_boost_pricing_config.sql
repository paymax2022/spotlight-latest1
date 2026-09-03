-- ════════════════════════════════════════════════════════════════════════════
-- Marketplace boost pricing — admin-configurable packages + custom date-range
-- rate (ADM-002 / MO-002).
--
-- Before this migration, the boost catalog (backend/internal/marketplace/
-- fsm_boost.go BoostTiers) was a hardcoded Go slice: re-pricing a package meant
-- editing source and redeploying. This moves the catalog into Postgres so the
-- already-built admin pricing console (frontend-admin/app/admin/marketplace/
-- pricing/page.tsx BoostPackagesCard) can actually edit it, and adds a second,
-- flexible pricing mode: an admin-set ₦/day rate for a user-chosen date range
-- (start = purchase time, end = user-picked date+time), rounded up to whole
-- days. Per the pricing console's own disclosure (ADM-001): config changes
-- apply to NEW purchases only — mkt_boosts already freezes duration_days/
-- price_kobo on the row at purchase time, and this adds `weight` to that same
-- freeze (a purchased boost's search-rank weight no longer drifts if an admin
-- later reprices/reweights the package).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Boost packages (admin-editable catalog; supersedes the Go constant) ────
CREATE TABLE IF NOT EXISTS public.mkt_boost_packages (
  tier          text PRIMARY KEY,
  label         text NOT NULL,
  duration_days integer NOT NULL CHECK (duration_days > 0),
  price_kobo    bigint NOT NULL CHECK (price_kobo >= 0),
  weight        numeric NOT NULL DEFAULT 1.0 CHECK (weight >= 0),
  is_active     boolean NOT NULL DEFAULT true,
  updated_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── 2. Custom-range daily rate — one config row, admin-editable ("N100/day") ──
CREATE TABLE IF NOT EXISTS public.mkt_boost_daily_rate (
  id              text PRIMARY KEY DEFAULT 'default',
  daily_rate_kobo bigint NOT NULL CHECK (daily_rate_kobo >= 0),
  updated_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ── 3. Freeze the resolved search-boost weight onto each purchase ─────────────
-- (duration_days/price_kobo already froze the same way; weight was the one
-- term still resolved by a LIVE lookup against the tier catalog at index time —
-- service_listing.go maxBoostWeight — so an admin reweighting a package would
-- silently reweight every already-purchased boost of that tier too.)
ALTER TABLE public.mkt_boosts ADD COLUMN IF NOT EXISTS weight numeric NOT NULL DEFAULT 0;

-- ── 4. RLS: deny-by-default; the Go service (pgxpool, service-role) does all reads/writes ──
ALTER TABLE public.mkt_boost_packages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mkt_boost_daily_rate ENABLE ROW LEVEL SECURITY;

-- ── 5. Seed: the 5 packages that were previously hardcoded (unchanged values) ──
INSERT INTO public.mkt_boost_packages (tier, label, duration_days, price_kobo, weight, is_active) VALUES
  ('start',      'Start',      7,  50000,   1.0, true),
  ('vip',        'VIP',        14, 200000,  2.0, true),
  ('vip_gold',   'VIP Gold',   30, 500000,  3.0, true),
  ('diamond',    'Diamond',    30, 1500000, 5.0, true),
  ('enterprise', 'Enterprise', 60, 5000000, 8.0, true)
ON CONFLICT (tier) DO NOTHING;

-- Seed the default custom-range rate: ₦100/day.
INSERT INTO public.mkt_boost_daily_rate (id, daily_rate_kobo) VALUES ('default', 10000)
ON CONFLICT (id) DO NOTHING;

-- Backfill weight on any boosts purchased before this migration, from the
-- catalog values above — a one-time catch-up so §3's freeze starts correct for
-- pre-existing rows instead of silently zeroing their search-rank contribution.
UPDATE public.mkt_boosts b SET weight = p.weight
  FROM public.mkt_boost_packages p
  WHERE b.tier = p.tier AND b.weight = 0;
