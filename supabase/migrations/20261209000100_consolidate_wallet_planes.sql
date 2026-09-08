-- Consolidate the two wallet planes onto 'user_wallet' (ADR-045).
-- Additive-only — no DROP, no RENAME, no type narrowing. Posts only balanced pairs.
--
-- WHY: users had TWO spendable ledger accounts. The base migration restricted
-- ledger_accounts.type to 'wallet', so the Next.js wallet created that; the Go
-- finance ledger creates 'user_wallet', and 20260912000001 widened the CHECK to
-- admit both rather than unifying. Mutations went to whichever plane the running
-- process used, and the displayed balance summed both — so the split stayed
-- invisible until money had to cross it.
--
-- It crossed when the card rail began funding checkouts (ADR-041): the top-up
-- credited 'wallet' while the Go module escrow debited 'user_wallet', so a
-- card-paid order was charged, credited, and then refused for insufficient funds.
--
-- The application half of this change repoints every Next.js mutation at
-- 'user_wallet'. This migration moves the balances already stranded on the legacy
-- plane, so nobody's money is left where the code no longer looks.

BEGIN;

-- Every user holding a legacy balance needs the destination account to exist.
-- ON CONFLICT (user_id, type) is the same arbiter the Go ledger upserts against
-- (ledger_accounts_user_type_key), so this converges on the row it already uses.
INSERT INTO public.ledger_accounts (id, user_id, type, currency)
SELECT gen_random_uuid(), wb.user_id, 'user_wallet', 'NGN'
  FROM public.wallet_balance wb
  JOIN public.ledger_accounts la ON la.id = wb.account_id
 WHERE la.type = 'wallet'
   AND wb.user_id IS NOT NULL
   AND wb.available_kobo > 0
ON CONFLICT (user_id, type) DO NOTHING;

-- Move each legacy balance as a BALANCED pair: DEBIT the legacy plane, CREDIT the
-- unified one. Value is conserved to the kobo — this is a transfer between two
-- accounts of the same user, not a credit, so global conservation (ADR-030) and
-- every user's total spendable balance are both unchanged.
--
-- Idempotent on ledger_entries.idempotency_key, keyed by the legacy account id, so
-- re-running is a no-op. It is deliberately NOT re-runnable for a LATER balance on
-- the same account: after this migration no code writes to the legacy plane, so a
-- second balance cannot accrue. Anything credited in the deploy window stays
-- visible via the balance read, which still sums both planes.
WITH legacy AS (
    SELECT wb.account_id AS from_id,
           ua.id         AS to_id,
           wb.available_kobo
      FROM public.wallet_balance wb
      JOIN public.ledger_accounts la ON la.id = wb.account_id
      JOIN public.ledger_accounts ua
        ON ua.user_id = la.user_id AND ua.type = 'user_wallet'
     WHERE la.type = 'wallet'
       AND wb.available_kobo > 0
)
INSERT INTO public.ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
SELECT from_id, 'DEBIT', available_kobo,
       'wallet-plane-consolidate:' || from_id,
       'wallet-plane-consolidate:' || from_id || ':debit'
  FROM legacy
UNION ALL
SELECT to_id, 'CREDIT', available_kobo,
       'wallet-plane-consolidate:' || from_id,
       'wallet-plane-consolidate:' || from_id || ':credit'
  FROM legacy
ON CONFLICT (idempotency_key) DO NOTHING;

COMMENT ON COLUMN public.ledger_accounts.type IS
    'Account plane. A user''s spendable naira balance is ''user_wallet'' — the single pot both the Go ledger and the Next.js wallet mutate (ADR-045). ''wallet'' is the pre-ADR-045 Next.js plane, swept empty by 20261209000100; read-only thereafter.';

COMMIT;
