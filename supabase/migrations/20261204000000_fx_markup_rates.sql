-- Admin-tunable Paymax FX markup + its immutable audit trail.
--
-- WHY
-- Maplerad's FX endpoints return NO fee — the provider prices its margin into the
-- rate (see maplerad.ConvertFXResponse). fx.Service.GetQuote used to read a `fee`
-- field that does not exist on the wire, so fx_quotes.fee_kobo was structurally 0:
-- the customer was debited principal only and recordCommissionSafe never fired
-- (it early-returns on feeKobo <= 0). Paymax earned nothing on every live FX
-- conversion. ADR-030.
--
-- The markup therefore has to be ours, and it has to be operable: this migration
-- moves it out of a Go constant and into a table an admin can change at runtime
-- via PUT /api/finance/admin/fx/markup (RBAC finance.admin.fx_markup).
--
-- SHARED BY BOTH FX SURFACES (ADR-031). This table is the single source of truth
-- for FX markup across:
--   * the legacy wallet FX service   (backend/internal/finance/fx)
--   * the FX orchestration module    (backend/internal/orchestration, SpreadEngine)
-- Both read it directly. Orchestration additionally prices per CUSTOMER TIER,
-- which is why (corridor, tier) — not corridor alone — is the key.
--
-- UNITS
-- The rate is stored as INTEGER BASIS POINTS, matching commission_config's
-- commission_bps and every other rate in this schema. Admins enter and read a
-- PERCENTAGE (1% <-> 100 bps); the handler converts with exact rational
-- arithmetic, never floats, and rejects anything finer than 0.01%. Storing the
-- percent as a float would make the charged fee non-reproducible.
--
-- SAFETY: additive-only per CLAUDE.md — CREATE TABLE IF NOT EXISTS + INSERT ...
-- ON CONFLICT DO NOTHING only. No DROP, no RENAME, no type narrowing, no existing
-- row modified. Re-runnable.

BEGIN;

-- 1. The rate registry ---------------------------------------------------------
-- corridor is the canonical "SOURCE-TARGET" label, or the literal 'DEFAULT' row
-- that applies to any corridor without its own override.
-- tier is the customer tier the row applies to, or '' meaning "any tier".
-- UNIQUE(corridor, tier) makes the upsert path idempotent and keeps exactly one
-- active rate per (corridor, tier).
--
-- RESOLUTION (must match orchestration.SpreadEngine.resolve exactly): the most
-- specific matching row wins, scored corridor(+2) + tier(+1) — so
-- corridor+tier > corridor > tier > DEFAULT. The legacy fx service passes tier=''
-- and therefore only ever matches the tier-agnostic rows.
--
-- min_bps/max_bps are optional per-row guardrails preserved from SpreadEngine's
-- SpreadRule; NULL means unbounded. They clamp the resolved rate, so a corridor
-- can carry a tighter band than the global ceiling.
--
-- rate_bps upper bound is a FAT-FINGER GUARD, not a pricing decision: 1000 bps =
-- 10%. It exists so a mistyped "100" (meaning 1%) cannot silently charge 100% of
-- the principal. Raising it is a deliberate, reviewable migration.
CREATE TABLE IF NOT EXISTS public.fx_markup_rates (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    corridor    text        NOT NULL,
    tier        text        NOT NULL DEFAULT '',
    rate_bps    integer     NOT NULL CHECK (rate_bps >= 0 AND rate_bps <= 1000),
    min_bps     integer     CHECK (min_bps IS NULL OR (min_bps >= 0 AND min_bps <= 1000)),
    max_bps     integer     CHECK (max_bps IS NULL OR (max_bps >= 0 AND max_bps <= 1000)),
    CONSTRAINT fx_markup_rates_band_ck CHECK (min_bps IS NULL OR max_bps IS NULL OR min_bps <= max_bps),
    active      boolean     NOT NULL DEFAULT true,
    notes       text,
    updated_by  uuid,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS fx_markup_rates_corridor_tier_uniq
    ON public.fx_markup_rates (corridor, tier);

-- 2. Immutable audit trail -----------------------------------------------------
-- Every change to a customer-facing fee is recorded before/after with the actor.
-- Append-only by convention (the module never updates or deletes these rows), so
-- "who changed the FX fee, when, from what to what" is always answerable.
CREATE TABLE IF NOT EXISTS public.fx_markup_rate_audit (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    corridor     text        NOT NULL,
    tier         text        NOT NULL DEFAULT '',
    before_bps   integer,                 -- NULL on first create
    after_bps    integer     NOT NULL,
    before_active boolean,
    after_active boolean     NOT NULL,
    changed_by   uuid,
    note         text,
    changed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fx_markup_rate_audit_corridor_idx
    ON public.fx_markup_rate_audit (corridor, changed_at DESC);

-- 3. RLS: backend-only, deny-all -----------------------------------------------
-- Same posture as the wave-2 lockdown: these are money-configuration tables
-- reached only by the Go backend over pgx. Enabling RLS with no policy denies
-- every PostgREST/anon path outright.
ALTER TABLE public.fx_markup_rates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fx_markup_rate_audit ENABLE ROW LEVEL SECURITY;

-- 4. Seed the rate card --------------------------------------------------------
-- The DEFAULT row is the platform-wide baseline: 100 bps = 1%, per product.
--
-- The corridor rows below are the EXISTING orchestration SpreadEngine rules,
-- lifted verbatim out of finance_routes.go so that pointing orchestration at this
-- table is a pure refactor and reprices nothing (ADR-031). They are now editable
-- by an admin like any other row — including flattening them to 1%.
--
-- The one deliberate change: orchestration's in-code fallback was 105 bps, and
-- the shared DEFAULT is 100 bps, so a corridor with no explicit row moves
-- 1.05% -> 1.00%, converging on the product-set rate.
INSERT INTO public.fx_markup_rates (corridor, tier, rate_bps, min_bps, max_bps, active, notes)
VALUES
  ('DEFAULT', '',         100, NULL, NULL, true, 'Platform-wide Paymax FX markup (1%) — seeded by ADR-030'),
  ('USD-NGN', 'business',  75,   50,  150, true, 'Business-tier USD-NGN — lifted from SpreadEngine (ADR-031)'),
  ('USD-NGN', '',         120,   80,  200, true, 'Retail USD-NGN — lifted from SpreadEngine (ADR-031)'),
  ('USD-XAF', '',         150,  100,  250, true, 'USD-XAF — lifted from SpreadEngine (ADR-031)')
ON CONFLICT (corridor, tier) DO NOTHING;

-- 5. RBAC ----------------------------------------------------------------------
-- Separate from finance.admin.transfers/kyc: changing what every customer pays on
-- FX is a distinct, higher-blast-radius grant than working a queue.
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES (
  'Manage FX Markup',
  'finance.admin.fx_markup',
  'finance',
  'fx_markup',
  'manage',
  'Read and change the Paymax FX markup percentage charged on currency conversions across BOTH the legacy FX and orchestration surfaces, and read its audit history (GET/PUT /api/finance/admin/fx/markup)',
  true
)
ON CONFLICT (slug) DO NOTHING;

-- Grant to super-admin and system-admin only. No dedicated finance-ops platform
-- role exists yet (same rationale as 20260920000100_rbac_seed_gaps.sql for
-- finance.admin.transfers / finance.admin.kyc).
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.slug IN ('super-admin', 'system-admin')
  AND p.slug = 'finance.admin.fx_markup'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
