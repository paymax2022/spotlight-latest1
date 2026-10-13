-- Admit the `crypto_clearing` standing-account type (ADR-PR709).
--
-- crypto_clearing mirrors the NGN held at the crypto provider on users' behalf: a buy
-- parks wallet NGN here until the provider confirms, a sell draws it down to pay the
-- wallet. Same shape as 20261207000100: its own short transaction because ADD CONSTRAINT
-- takes an ACCESS EXCLUSIVE lock on ledger_accounts.
--
-- SAFETY: additive CHECK widening — a strict SUPERSET of 20261207000100, with
-- `crypto_clearing` added. Nothing removed, nothing narrowed. Idempotent.

BEGIN;

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
    'trading_fee_income'::text,
    'legacy_wallet_contra'::text,
    'crypto_clearing'::text
  ]));

COMMIT;
