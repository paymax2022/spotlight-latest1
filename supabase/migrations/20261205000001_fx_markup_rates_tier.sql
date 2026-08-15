-- Widen the FX markup rate card to (corridor, tier) so BOTH FX surfaces can
-- price from it. ADR-031.
--
-- WHY
-- 20261204000000_fx_markup_rates.sql (ADR-030) made the LEGACY wallet FX markup
-- admin-tunable, keyed on corridor alone. The FX ORCHESTRATION module
-- (backend/internal/orchestration) still priced from a hardcoded SpreadEngine
-- rule table in finance_routes.go, so the platform charged two different markups
-- for the same corridor depending on which endpoint the client hit, and only one
-- of them could be corrected without a deploy:
--
--                    legacy /api/finance/fx     orchestration /api/v1/fx/*
--   rate source      fx_markup_rates (DB)       hardcoded SpreadEngine
--   default          100 bps (1%)               105 bps
--   USD-NGN          100 bps (via DEFAULT)      120 retail / 75 business
--   admin-changeable yes                        NO — needed a deploy
--   per-tier         no                         yes
--
-- Orchestration prices per CUSTOMER TIER and the legacy service does not, so the
-- shared table needs a tier dimension before orchestration can read it. That is
-- what this migration adds.
--
-- RESOLUTION (must match orchestration.SpreadEngine.resolve exactly): the most
-- specific matching row wins, scored corridor(+2) + tier(+1) — so
-- corridor+tier > corridor > tier > DEFAULT. The legacy service passes tier=''
-- and therefore only ever matches the tier-agnostic rows, preserving its
-- existing behaviour exactly.
--
-- NOTHING IS REPRICED. The corridor rows seeded below are the EXISTING
-- orchestration SpreadEngine rules lifted verbatim out of finance_routes.go,
-- bands included, so pointing orchestration at this table is a pure refactor.
-- backend/tests/fx/spread_unification_live_db_test.go compares the resulting
-- card against a copy of the old in-code engine across the full corridor x tier
-- matrix and fails on any divergence.
--
-- The ONE deliberate change: orchestration's in-code fallback was 105 bps and
-- the shared DEFAULT is 100 bps, so a corridor with no explicit row moves
-- 1.05% -> 1.00%, converging on the product-set rate from ADR-030. That is
-- asserted explicitly in the same test rather than left to be discovered.
--
-- SAFETY: additive-only per CLAUDE.md. Columns are ADDed with defaults, never
-- dropped, renamed, or narrowed; no existing row is modified except the
-- permission description (a text correction, not schema). The one DROP is
-- `DROP INDEX IF EXISTS` on a UNIQUE index being WIDENED from (corridor) to
-- (corridor, tier) — an idempotent re-create pattern explicitly allowed by
-- .github/workflows/_reusable-migration-guard.yml, and a relaxation of a
-- constraint rather than a loss of data. Re-runnable.

BEGIN;

-- 1. Tier dimension ------------------------------------------------------------
-- '' means "any tier", mirroring SpreadEngine's empty-matches-anything semantics.
-- NOT NULL DEFAULT '' so every pre-existing row (the seeded DEFAULT) becomes a
-- tier-agnostic rule, which is exactly what it already was.
ALTER TABLE public.fx_markup_rates
    ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT '';

-- 2. Per-corridor guard band ---------------------------------------------------
-- Preserved from orchestration's SpreadRule{MinBPS, MaxBPS}: a corridor may carry
-- a tighter band than the global 0..1000 bps ceiling. NULL means unbounded.
ALTER TABLE public.fx_markup_rates
    ADD COLUMN IF NOT EXISTS min_bps integer,
    ADD COLUMN IF NOT EXISTS max_bps integer;

DO $ck$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fx_markup_rates_min_bps_ck') THEN
        ALTER TABLE public.fx_markup_rates ADD CONSTRAINT fx_markup_rates_min_bps_ck
            CHECK (min_bps IS NULL OR (min_bps >= 0 AND min_bps <= 1000));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fx_markup_rates_max_bps_ck') THEN
        ALTER TABLE public.fx_markup_rates ADD CONSTRAINT fx_markup_rates_max_bps_ck
            CHECK (max_bps IS NULL OR (max_bps >= 0 AND max_bps <= 1000));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fx_markup_rates_band_ck') THEN
        ALTER TABLE public.fx_markup_rates ADD CONSTRAINT fx_markup_rates_band_ck
            CHECK (min_bps IS NULL OR max_bps IS NULL OR min_bps <= max_bps);
    END IF;
END $ck$;

-- 3. Widen the uniqueness key --------------------------------------------------
-- One active rate per (corridor, tier) instead of per corridor, so a corridor can
-- carry both a tier-agnostic rate and tier-specific overrides. The old index must
-- go or the second row for a corridor is rejected; `IF EXISTS` keeps this
-- re-runnable and a no-op on a database provisioned after this migration.
DROP INDEX IF EXISTS public.fx_markup_rates_corridor_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS fx_markup_rates_corridor_tier_uniq
    ON public.fx_markup_rates (corridor, tier);

-- 4. Audit the tier too --------------------------------------------------------
-- A tier-specific rate change must be as attributable as any other.
ALTER TABLE public.fx_markup_rate_audit
    ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS fx_markup_rate_audit_corridor_tier_idx
    ON public.fx_markup_rate_audit (corridor, tier, changed_at DESC);

-- 5. Lift the orchestration rule card into the table ---------------------------
-- Verbatim from finance_routes.go's NewSpreadEngine(...) call. ON CONFLICT DO
-- NOTHING so a database that already carries operator-set rows is never
-- overwritten by this seed.
INSERT INTO public.fx_markup_rates (corridor, tier, rate_bps, min_bps, max_bps, active, notes)
VALUES
  ('USD-NGN', 'business',  75,  50, 150, true, 'Business-tier USD-NGN — lifted from SpreadEngine (ADR-031)'),
  ('USD-NGN', '',         120,  80, 200, true, 'Retail USD-NGN — lifted from SpreadEngine (ADR-031)'),
  ('USD-XAF', '',         150, 100, 250, true, 'USD-XAF — lifted from SpreadEngine (ADR-031)')
ON CONFLICT (corridor, tier) DO NOTHING;

-- 6. The permission now governs both surfaces ----------------------------------
UPDATE public.permissions
   SET description = 'Read and change the Paymax FX markup percentage charged on currency conversions across BOTH the legacy FX and orchestration surfaces, and read its audit history (GET/PUT /api/finance/admin/fx/markup)'
 WHERE slug = 'finance.admin.fx_markup';

COMMIT;
