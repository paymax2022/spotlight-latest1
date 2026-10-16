-- Admit the Spotlight Global (cross-border) revenue/pricing standing-account types (SP-3a, spec §6).
--
--   revenue:fx_markup, receivable:verto_markup, expense:provider_fees,
--   tax_payable:vat, suspense:unmatched_inbound           -- fixed strings
--   revenue:platform_fee:{service}, fees_unswept:{companyId}:{ccy}
--                                                          -- parameterised
--
-- Standing accounts are unique on (type), so the two parameterised accounts carry
-- their parameter in the type string. They are admitted by STRICT regex only
-- (service = [a-z][a-z0-9_]{0,31}; companyId = canonical lowercase UUID; ccy = 3
-- uppercase letters) — never an open prefix — so the closed-enum invariant holds.
--
-- Same shape as 20271028000000: own short transaction (ADD CONSTRAINT takes an
-- ACCESS EXCLUSIVE lock on ledger_accounts).
--
-- SAFETY: additive CHECK widening — a strict SUPERSET of 20271028000000. Nothing
-- removed, nothing narrowed. Idempotent.

BEGIN;

ALTER TABLE public.ledger_accounts
  DROP CONSTRAINT IF EXISTS ledger_accounts_type_check;

ALTER TABLE public.ledger_accounts
  ADD CONSTRAINT ledger_accounts_type_check CHECK (
    type = ANY (ARRAY[
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
      'crypto_clearing'::text,
      'revenue:fx_markup'::text,
      'receivable:verto_markup'::text,
      'expense:provider_fees'::text,
      'tax_payable:vat'::text,
      'suspense:unmatched_inbound'::text
    ])
    OR type ~ '^revenue:platform_fee:[a-z][a-z0-9_]{0,31}$'
    OR type ~ '^fees_unswept:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[A-Z]{3}$'
  );

COMMIT;
