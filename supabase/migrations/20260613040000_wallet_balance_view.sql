-- Migration: wallet_balance view
-- Additive only — creates a view, no changes to existing tables.
--
-- Balance formula (double-entry projection):
--   CREDIT           → +amount_kobo  (money in)
--   DEBIT            → -amount_kobo  (money out)
--   REVERSAL_CREDIT  → -amount_kobo  (reversal of a credit: money returned)
--   REVERSAL_DEBIT   → +amount_kobo  (reversal of a debit: money restored)
--
-- available_kobo is always 0 when no entries exist (COALESCE).
-- Wallet service MUST NOT store a balance column directly — always query this view.

CREATE OR REPLACE VIEW public.wallet_balance AS
SELECT
  la.id          AS account_id,
  la.user_id,
  la.type        AS account_type,
  la.currency,
  COALESCE(
    SUM(
      CASE
        WHEN le.type IN ('CREDIT', 'REVERSAL_DEBIT') THEN  le.amount_kobo
        WHEN le.type IN ('DEBIT', 'REVERSAL_CREDIT') THEN -le.amount_kobo
        ELSE 0
      END
    ),
    0
  ) AS available_kobo,
  MAX(le.created_at) AS last_transaction_at
FROM public.ledger_accounts la
LEFT JOIN public.ledger_entries le ON le.account_id = la.id
GROUP BY la.id, la.user_id, la.type, la.currency;

-- Grant SELECT on the view to authenticated role (inherits ledger_entries RLS indirectly)
GRANT SELECT ON public.wallet_balance TO authenticated;
