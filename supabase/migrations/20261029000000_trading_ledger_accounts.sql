-- Additive: widen ledger_accounts_type_check to permit the two standing-account
-- types the custodial trading fund posts through — 'trading_fund_clearing' (the
-- pooled cash the fund holds against issued units) and 'trading_fee_income' (the
-- platform's performance-fee income). Mirrors the widen-CHECK pattern used for
-- edtech_fees_vault (20261009000000): drop and re-add the CHECK with a strict
-- SUPERSET of the prior values — nothing removed or narrowed.
--
-- The Go code adds AccountType consts AccountTradingFundClearing /
-- AccountTradingFeeIncome and creates the accounts lazily via
-- GetOrCreateStandingAccount; no rows are seeded here. NGN-kobo, integer only.

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
    'edtech_fees_vault'::text,
    'trading_fund_clearing'::text,
    'trading_fee_income'::text
  ]));
