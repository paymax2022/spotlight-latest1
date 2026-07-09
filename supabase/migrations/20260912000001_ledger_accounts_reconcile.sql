-- Migration: reconcile ledger_accounts with the finance-ledger code (additive-only).
--
-- WHY: the base table (20260613020000_ledger_accounts) restricted `type` to
-- CHECK (type IN ('wallet')), kept user_id NOT NULL, and used
-- UNIQUE (user_id, type, currency). But internal/finance/ledger (used by wallet,
-- transfers, referral rewards, crypto, estate, top5events, association, groups, …):
--   • creates many account TYPES (user_wallet, escrow, provider_clearing,
--     referral_reward_expense, commission, settlement, …; plus group_wallet),
--   • creates STANDING/system accounts with user_id NULL, one per type,
--   • upserts user accounts with ON CONFLICT (user_id, type).
-- ledger_accounts is single-currency (always NGN via GetOrCreateUserWallet);
-- multi-currency wallets live in the separate `currency_wallets` table, so a
-- (user_id, type) key is safe here.
--
-- Without this, a fresh `db reset` + the ledger code fails on EVERY account
-- creation (CHECK/NOT NULL/ON CONFLICT mismatches).
--
-- SAFETY: all changes are additive/relaxing — widen a CHECK domain, drop a
-- NOT NULL, add indexes. No DROP of data, no type narrowing. Safe to re-run.
--
-- ⚠ MONEY-PATH: requires ledger-auditor review before merge (touches the ledger
-- account constraints). Verified locally: the referral withdraw integration test
-- passes against a schema carrying exactly these indexes/constraints.

BEGIN;

-- 1) Widen the account-type domain to every type the backend creates.
ALTER TABLE public.ledger_accounts DROP CONSTRAINT IF EXISTS ledger_accounts_type_check;
ALTER TABLE public.ledger_accounts
  ADD CONSTRAINT ledger_accounts_type_check CHECK (type IN (
    'wallet',
    'user_wallet', 'virtual_account', 'escrow', 'refund', 'provider_clearing',
    'paymax_revenue', 'commission', 'referral_reward_expense', 'fx_spread_income',
    'settlement', 'failed_transfer_suspense', 'placement_escrow', 'placement_revenue',
    'group_wallet', 'arena_support_pot', 'arena_playalong_cashback'
  ));

-- 2) Standing (system) accounts are keyed by type with a NULL user_id.
ALTER TABLE public.ledger_accounts ALTER COLUMN user_id DROP NOT NULL;

-- 3a) User accounts: exactly one per (user_id, type) — the arbiter for the code's
--     ON CONFLICT (user_id, type). NULL user_id rows are distinct here (standing
--     and group wallets), so this does not constrain them.
CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_user_type_key
  ON public.ledger_accounts (user_id, type);

-- 3b) Standing finance-ledger accounts: one per type where BOTH user_id and
--     group_id are NULL. Scoped to exclude group wallets, which are keyed by
--     group_id via ledger_accounts_group_wallet_idx (added in 20260616230000).
CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_standing_type_key
  ON public.ledger_accounts (type) WHERE user_id IS NULL AND group_id IS NULL;

COMMIT;
