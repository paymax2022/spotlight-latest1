-- Insurance — provider catalog columns for live MyCover.ai integration.
--
-- WHY: MyCover exposes NO generic bind endpoint. Every product has its own
-- purchase path (`POST /products/{prefix}/buy-{slug}`), its own required-field
-- schema, and its own pricing model (flat naira price vs a percentage RATE of
-- the sum insured). The buy slug is NOT derivable from the product's route_name
-- — verified live, `bastion-flexicare-mini` → `/products/bastion/buy-flexicare-mini`
-- returns 404 — so it must be DISCOVERED and STORED per product.
--
-- These columns make that per-product knowledge DATA. Adding a 69th product is a
-- catalog sync (a row), never a code change: no adapter method branches on a
-- product identity.
--
-- ADDITIVE-ONLY: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS only.
--   NO DROP, NO RENAME, NO type narrowing. Existing rows keep their values and
--   every new column is nullable or defaulted, so the migration is safe to
--   replay and safe on a populated table.
--
-- MONEY: every *_kobo column is BIGINT MINOR UNITS. MyCover speaks naira decimal
--   strings; the conversion happens exactly once in the Go adapter
--   (backend/internal/provider/mycover/money.go, exact big.Rat math, half-up
--   rounding) and only kobo is ever persisted. provider_base_price_raw keeps the
--   provider's original decimal string verbatim for reconciliation ONLY — it is
--   never used for arithmetic.

BEGIN;

-- ── Per-product provider routing ────────────────────────────────────────────
ALTER TABLE public.insurance_products
  -- MyCover's own product uuid (endpoints that key on the uuid, not route_name).
  ADD COLUMN IF NOT EXISTS provider_product_id   text,
  -- The FULL provider-relative purchase path, e.g. /products/sti/buy-marine-cover.
  -- Discovered per product; NEVER computed at call time.
  ADD COLUMN IF NOT EXISTS provider_buy_path     text,
  -- Whether provider_buy_path has been confirmed against the live API (a POST
  -- with an empty body returning 400 validation errors rather than 404 proves
  -- the path exists). Unverified paths are usable but flagged in admin.
  ADD COLUMN IF NOT EXISTS buy_path_verified     boolean NOT NULL DEFAULT false,
  -- Underwriter prefix segment of the buy path.
  ADD COLUMN IF NOT EXISTS provider_prefix       text;

-- ── Pricing (Paymax units) ──────────────────────────────────────────────────
ALTER TABLE public.insurance_products
  -- Selects the pricing model. false => base_price_kobo is the flat premium.
  -- true  => rate_bps is applied to the sum insured.
  ADD COLUMN IF NOT EXISTS is_percentage         boolean NOT NULL DEFAULT false,
  -- Flat premium in KOBO (is_percentage = false).
  ADD COLUMN IF NOT EXISTS base_price_kobo       bigint  NOT NULL DEFAULT 0
                             CHECK (base_price_kobo >= 0),
  -- Premium rate in BASIS POINTS (is_percentage = true). 0.5% => 50 bps.
  -- Every live rate is exact at bps precision (0.25/0.46/0.5/0.65/0.9/1/1.04/
  -- 2.15/2.5/5/7 percent → 25…700 bps).
  ADD COLUMN IF NOT EXISTS rate_bps              bigint  NOT NULL DEFAULT 0
                             CHECK (rate_bps >= 0),
  -- Provider's verbatim decimal string, for reconciliation/audit only.
  ADD COLUMN IF NOT EXISTS provider_base_price_raw text,
  -- Product-declared cover amount in KOBO (MyCover meta.sum_insured), 0 when the
  -- product does not declare one and the member must supply it.
  ADD COLUMN IF NOT EXISTS default_sum_insured_kobo bigint NOT NULL DEFAULT 0
                             CHECK (default_sum_insured_kobo >= 0);

-- ── Commission split ────────────────────────────────────────────────────────
-- MyCover's sharing_formula states WHOLE PERCENTS. distributor_commission is
-- Paymax's revenue share and is what the admin commission screens report.
ALTER TABLE public.insurance_products
  ADD COLUMN IF NOT EXISTS distributor_commission_bps bigint NOT NULL DEFAULT 0
                             CHECK (distributor_commission_bps >= 0),
  ADD COLUMN IF NOT EXISTS mca_commission_bps         bigint NOT NULL DEFAULT 0
                             CHECK (mca_commission_bps >= 0),
  ADD COLUMN IF NOT EXISTS provider_commission_bps    bigint NOT NULL DEFAULT 0
                             CHECK (provider_commission_bps >= 0),
  -- original_premium | final_premium — which base the split applies to.
  ADD COLUMN IF NOT EXISTS commission_from            text;

-- ── Cover terms + display ───────────────────────────────────────────────────
ALTER TABLE public.insurance_products
  ADD COLUMN IF NOT EXISTS cover_period_days     int NOT NULL DEFAULT 0
                             CHECK (cover_period_days >= 0),
  ADD COLUMN IF NOT EXISTS is_renewable          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_claimable          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_certificateable    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_inspectable        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS provider_category     text,
  ADD COLUMN IF NOT EXISTS currency              text NOT NULL DEFAULT 'NGN',
  ADD COLUMN IF NOT EXISTS underwriter_logo_url  text,
  ADD COLUMN IF NOT EXISTS description           text,
  -- Provider copy, HTML. Render SANITISED — this is third-party markup.
  ADD COLUMN IF NOT EXISTS key_benefits_html     text,
  ADD COLUMN IF NOT EXISTS full_benefits_html    text,
  ADD COLUMN IF NOT EXISTS how_it_works_html     text,
  ADD COLUMN IF NOT EXISTS how_to_claim_html     text,
  ADD COLUMN IF NOT EXISTS document_url          text;

-- ── Dynamic form schema ─────────────────────────────────────────────────────
-- The per-product field schema the mobile app renders. Shape:
--   {"fields":[{"name","label","type","required","min","max","min_length",
--               "max_length","options":[{"value","label"}],"help","placeholder"}]}
-- Discovered by POSTing the buy path with an empty body and reading the 400
-- validation array (safe: validation rejects before anything is created).
-- Empty {} means "not yet discovered" — the member-facing schema endpoint says
-- so rather than rendering a blank form.
ALTER TABLE public.insurance_products
  ADD COLUMN IF NOT EXISTS form_schema           jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS form_schema_source    text,   -- probe | curated | seed
  -- Verbatim provider product object, kept for reconciliation and for fields we
  -- have not yet promoted to columns. Stored, never interpreted in SQL.
  ADD COLUMN IF NOT EXISTS provider_raw          jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_synced_at        timestamptz;

CREATE INDEX IF NOT EXISTS idx_insurance_products_provider_code
  ON public.insurance_products (provider, provider_product_code);
CREATE INDEX IF NOT EXISTS idx_insurance_products_category
  ON public.insurance_products (provider_category);
CREATE INDEX IF NOT EXISTS idx_insurance_products_synced
  ON public.insurance_products (last_synced_at DESC NULLS LAST);

-- ── Catalog sync run log ────────────────────────────────────────────────────
-- One row per sync so admin can show "last sync, N products, K failures" and so
-- a silently-failing sync is visible instead of looking like an empty catalog.
CREATE TABLE IF NOT EXISTS public.insurance_catalog_sync (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider       text NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  status         text NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running','succeeded','failed')),
  products_seen  int NOT NULL DEFAULT 0,
  products_upserted int NOT NULL DEFAULT 0,
  products_failed   int NOT NULL DEFAULT 0,
  -- Failure reason, provider-side. Must never contain a key or member PII.
  error_text     text,
  triggered_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_catalog_sync_provider
  ON public.insurance_catalog_sync (provider, started_at DESC);

ALTER TABLE public.insurance_catalog_sync ENABLE ROW LEVEL SECURITY;

-- Admins read the sync log; the engine writes it via service-role (which
-- bypasses RLS). No member-facing policy — this is operational data.
DROP POLICY IF EXISTS insurance_catalog_sync_admin_read ON public.insurance_catalog_sync;
CREATE POLICY insurance_catalog_sync_admin_read
  ON public.insurance_catalog_sync
  FOR SELECT
  USING (public.is_admin());

-- ── Quote inputs ────────────────────────────────────────────────────────────
-- The bind call needs the SAME product-specific answers that were collected at
-- quote time: MyCover's buy endpoints validate the full per-product field set,
-- so a bind that forwards no inputs is rejected outright. Persist them on the
-- quote so the saga can replay a bind without re-prompting the member.
--
-- ⚠️ This column holds member PII (name, email, phone, NIN on some products).
-- It inherits insurance_quote's existing RLS. Retention follows the quote TTL
-- sweep — quotes are ephemeral by design.
ALTER TABLE public.insurance_quote
  ADD COLUMN IF NOT EXISTS inputs jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
