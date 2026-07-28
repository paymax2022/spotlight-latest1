-- Migration: widen virtual_accounts.provider CHECK to include Maplerad.
-- Additive / forward-only (widening, not narrowing): the original table only
-- allowed provider='paystack', but Maplerad is the preferred NGN DVA provider
-- when MAPLERAD_SECRET_KEY is set (see finance_routes provider selection).
-- Without this, inserting a Maplerad-provisioned VA violates the CHECK.

ALTER TABLE public.virtual_accounts
  DROP CONSTRAINT IF EXISTS virtual_accounts_provider_check;

ALTER TABLE public.virtual_accounts
  ADD CONSTRAINT virtual_accounts_provider_check
  CHECK (provider IN ('paystack', 'maplerad'));
