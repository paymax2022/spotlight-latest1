-- Migration: admit the `legacy_wallet_contra` standing-account type.
-- ADR-PR98 (docs/adr/ADR-PR98-wallet-plane-double-entry.md).
--
-- Split out from the backfill (20261207000200) ON PURPOSE. `ALTER TABLE … ADD
-- CONSTRAINT` takes an ACCESS EXCLUSIVE lock on ledger_accounts and holds it to
-- COMMIT. The backfill scans the whole of ledger_entries three times, so running
-- both in one transaction would block EVERY wallet read and write for the
-- duration — `wallet_balance` joins ledger_accounts, `debit_wallet_atomic` does
-- SELECT … FOR UPDATE on it, and getOrCreateAccount reads it. Keeping the DDL in
-- its own short transaction bounds that lock to a constraint validation.
--
-- SAFETY: additive CHECK widening — a strict SUPERSET of 20261029000000, with
-- `legacy_wallet_contra` added. Nothing removed, nothing narrowed. Idempotent.

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
    'legacy_wallet_contra'::text
  ]));

COMMIT;
