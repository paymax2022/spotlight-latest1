-- Additive: widen ledger_accounts_type_check to permit the 'edtech_fees_vault'
-- account type (SF-5 segregated fees vault). Migration 20260918000000 added the
-- Go AccountType `AccountEdtechFeesVault = "edtech_fees_vault"` and the code path
-- `GetOrCreateStandingAccount("edtech_fees_vault")`, but never widened this CHECK,
-- so creating a fees vault fails with a check-constraint violation in production.
-- Caught by tests/edtechfees live-DB integration.
--
-- Additive-only: this widens the allowed set (adds one value); it drops and re-adds
-- the CHECK with a strict superset of the prior values — the same widen-CHECK pattern
-- used in 20260918000000 for academy_savings_pots_status_check. No data is removed and
-- no existing value is narrowed away.

ALTER TABLE public.ledger_accounts
  DROP CONSTRAINT IF EXISTS ledger_accounts_type_check;

ALTER TABLE public.ledger_accounts
  ADD CONSTRAINT ledger_accounts_type_check CHECK (type = ANY (ARRAY[
    'wallet'::text,
    'user_wallet'::text,
    'virtual_account'::text,
    'escrow'::text,
    'refund'::text,
    'provider_clearing'::text,
    'paymax_revenue'::text,
    'commission'::text,
    'referral_reward_expense'::text,
    'fx_spread_income'::text,
    'settlement'::text,
    'failed_transfer_suspense'::text,
    'placement_escrow'::text,
    'placement_revenue'::text,
    'group_wallet'::text,
    'arena_support_pot'::text,
    'arena_playalong_cashback'::text,
    'edtech_fees_vault'::text
  ]));
