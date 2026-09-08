-- Insurance — MyCover v2: product purchasability + outbound bind idempotency.
--
-- ADDITIVE-ONLY: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS.
--   NO DROP, NO RENAME, NO type narrowing.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 1. PURCHASABILITY — not every listed product can be sold
-- ════════════════════════════════════════════════════════════════════════════
-- VERIFIED LIVE: 7 of MyCover's 69 products are broken on THEIR side.
--   * 4 have no purchase config — `compute-price` refuses them and their public
--     form schema is empty but for `product_id`, so there is nothing to collect
--     and nothing to buy.
--   * 3 have `sharing_formula: null` — no distributor commission is configured,
--     so Paymax would earn zero AND pricing fails.
--
-- These may be listed and described. They must never be SELLABLE: taking a
-- member's money for cover the provider cannot issue is the worst failure this
-- module has. `purchasable` therefore defaults to FALSE and is granted only by
-- evidence gathered during a sync (a usable schema AND a commission split).
--
-- It is deliberately SEPARATE from `active`. `active` is the operator's
-- decision ("do we offer this?"); `purchasable` is the provider's capability
-- ("can this be bought at all?"). A sync may freely overwrite the second and
-- must never touch the first.
ALTER TABLE public.insurance_products
  ADD COLUMN IF NOT EXISTS purchasable            boolean NOT NULL DEFAULT false,
  -- ok | broken | schema_unavailable | unknown
  ADD COLUMN IF NOT EXISTS provider_config_status text NOT NULL DEFAULT 'unknown',
  -- The provider's own explanation, verbatim. Provider-side text only — never a
  -- credential, never member PII.
  ADD COLUMN IF NOT EXISTS provider_config_error  text;

CREATE INDEX IF NOT EXISTS idx_insurance_products_purchasable
  ON public.insurance_products (purchasable, active);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. OUTBOUND BIND IDEMPOTENCY — ours to enforce, because MyCover has none
-- ════════════════════════════════════════════════════════════════════════════
-- VERIFIED: MyCover documents NO idempotency mechanism on POST /products/buy.
-- A retried purchase therefore creates a SECOND policy and debits our prefunded
-- float twice. Paymax's iron rule requires an Idempotency-Key on every money
-- mutation, so the guarantee has to live entirely on our side.
--
-- This table is the claim register for outbound purchase calls. The unique
-- primary key IS the mechanism: a second attempt with the same key cannot insert,
-- so it cannot reach the provider.
--
-- STATES:
--   in_flight — claimed, provider call issued, outcome not yet known.
--   succeeded — provider confirmed; provider_policy_ref is set. A replay returns
--               this instead of buying again.
--   failed    — the provider REJECTED the call (validation, empty float). Nothing
--               was created, so the key is released and a retry is safe.
--   unknown   — the call was sent but we never learned the outcome (timeout,
--               connection reset). This is the dangerous one: a policy may or may
--               not exist. It is NEVER auto-retried, because retrying might buy a
--               second policy and not retrying might strand a member. It requires
--               reconciliation against the provider's policy list.
--
-- The unknown state exists because a transport error genuinely does not tell you
-- whether the write landed. Collapsing it into `failed` would silently authorise
-- a double purchase; collapsing it into `succeeded` would strand the member.
CREATE TABLE IF NOT EXISTS public.insurance_provider_bind (
  idempotency_key     text PRIMARY KEY,
  provider            text NOT NULL,
  product_code        text NOT NULL,
  policy_id           uuid,
  state               text NOT NULL DEFAULT 'in_flight'
                        CHECK (state IN ('in_flight','succeeded','failed','unknown')),
  provider_policy_ref text,
  premium_kobo        bigint NOT NULL DEFAULT 0 CHECK (premium_kobo >= 0),
  -- Provider-side failure text. Never a credential, never member PII.
  failure_text        text,
  attempts            int NOT NULL DEFAULT 1 CHECK (attempts >= 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_insurance_provider_bind_state
  ON public.insurance_provider_bind (state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_insurance_provider_bind_policy
  ON public.insurance_provider_bind (policy_id);
-- Reconciliation reads this: every outbound call whose outcome we never learned.
CREATE INDEX IF NOT EXISTS idx_insurance_provider_bind_unknown
  ON public.insurance_provider_bind (created_at DESC)
  WHERE state = 'unknown';

ALTER TABLE public.insurance_provider_bind ENABLE ROW LEVEL SECURITY;

-- Operational data: admins read, the engine writes via service-role (bypasses
-- RLS). No member-facing policy.
DROP POLICY IF EXISTS insurance_provider_bind_admin_read ON public.insurance_provider_bind;
CREATE POLICY insurance_provider_bind_admin_read
  ON public.insurance_provider_bind
  FOR SELECT
  USING (public.is_admin());
