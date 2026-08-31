-- Insurance — catalog reconciliation + retire the fictional seed products.
--
-- ADDITIVE-ONLY: ADD COLUMN IF NOT EXISTS, and UPDATEs that flip flags.
--   NO DROP, NO RENAME, NO type narrowing. Nothing is hard-deleted: rows are
--   deactivated and flagged so the history stays auditable.
--
-- ════════════════════════════════════════════════════════════════════════════
-- WHY
-- ════════════════════════════════════════════════════════════════════════════
-- A sync that only ever UPSERTS leaves stale rows alive forever, and a stale row
-- is indistinguishable from a real one. The live consequence: after syncing all
-- 69 real MyCover products (which correctly landed inactive, pending review),
-- the member catalog served FOUR products — and two of them were fictional seed
-- rows carrying underwriters that do not exist in MyCover's catalog ("Hygeia
-- HMO", "AXA Mansard"). Members saw invented cover and none of the real cover.
--
-- Two independent defects produced that, and both are fixed here:
--   1. Nothing ever retired a catalog row the provider no longer lists.
--   2. `active` was operator-only, so a synced product could never become
--      visible without a manual flip — while legacy seeds were already active.

-- ── Reconciliation state ────────────────────────────────────────────────────
ALTER TABLE public.insurance_products
  -- Set when a sync completed for this provider and did NOT see this product.
  -- The row stays for audit and for any policy still referencing it, but it is
  -- deactivated: we must not sell what the provider no longer lists.
  ADD COLUMN IF NOT EXISTS provider_missing    boolean NOT NULL DEFAULT false,
  -- Human-readable reason the row was deactivated, so an operator looking at a
  -- dark product is not left guessing.
  ADD COLUMN IF NOT EXISTS deactivated_reason  text,
  -- Set when an ADMIN explicitly flips `active`. It marks the row as
  -- operator-governed so a later sync does not overturn a deliberate decision.
  -- NULL means "nobody has ruled on this", and sync may manage visibility.
  --
  -- This is what lets `active` be BOTH sync-managed and operator-owned without
  -- the two fighting: the override records that a human has an opinion.
  ADD COLUMN IF NOT EXISTS active_overridden_at timestamptz,
  ADD COLUMN IF NOT EXISTS active_overridden_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_insurance_products_provider_missing
  ON public.insurance_products (provider, provider_missing);

-- ── Retire the fictional seed products ──────────────────────────────────────
-- These nine rows were inserted by early scaffolding. Their
-- provider_product_codes (MYCOVER-DEVICE-BASIC, OCTAMILE-GIT-PARCEL-V1, …)
-- correspond to NO real product at either aggregator, and their underwriters do
-- not appear in MyCover's live catalog. Several were ACTIVE, which is how they
-- came to be the only thing members could see.
--
-- They are deactivated, never deleted: insurance_policy rows may reference these
-- codes, and destroying the product a policy points at would make that policy
-- unreadable. Deactivating stops new sales and keeps the history intact.
--
-- The Octamile ones are doubly unsellable — INSURANCE_OCTAMILE_API_KEY is the
-- literal placeholder "xxx", so no Octamile product could ever bind.
UPDATE public.insurance_products
SET active             = false,
    purchasable        = false,
    provider_missing   = true,
    provider_config_status = 'fictional_seed',
    deactivated_reason = 'Scaffolding seed product: no such product exists at the aggregator. '
                         'Retired by migration 20270130000000; the live catalog sync is the source of truth.',
    updated_at         = now()
WHERE code IN (
  'device-protect-basic',
  'mycover.device.gadget.v1',
  'octamile.git.parcel.v1',
  'mycover.health.micro.v1',
  'octamile.motor.comprehensive.v1',
  'octamile.motor.thirdparty.v1',
  'mycover.pa.income.v1',
  'mycover.sme.bundle.v1',
  'trip-passenger-ride'
);

-- Belt and braces: any remaining row whose provider_product_code is not a UUID
-- cannot be bought on MyCover v2, whose single quote/buy endpoints select the
-- product by a `product_id` UUID. Such a row is scaffolding by definition.
UPDATE public.insurance_products
SET active             = false,
    purchasable        = false,
    deactivated_reason = COALESCE(deactivated_reason,
                          'provider_product_code is not a provider UUID, so this product cannot be quoted or bought.'),
    updated_at         = now()
WHERE provider = 'mycover'
  AND active
  AND (provider_product_id IS NULL OR provider_product_id = '');

-- No Octamile product can bind while its credentials are placeholders. Keep the
-- rows, keep them dark.
UPDATE public.insurance_products
SET active             = false,
    purchasable        = false,
    deactivated_reason = COALESCE(deactivated_reason,
                          'Octamile credentials are placeholders; no Octamile product can bind.'),
    updated_at         = now()
WHERE provider = 'octamile' AND active;
