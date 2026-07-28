-- Migration: ledger_entries
-- Additive only — creates a new immutable append-only table.
--
-- Design decisions:
--   - amount_kobo is BIGINT (never NUMERIC/FLOAT) — no rounding errors
--   - amount_kobo > 0 always; credit/debit direction is encoded in `type`
--   - idempotency_key UNIQUE — prevents double-crediting on retries
--   - No UPDATE/DELETE RLS — corrections via reversing entries only
--   - Entry types: CREDIT, DEBIT, REVERSAL_CREDIT, REVERSAL_DEBIT

CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID        NOT NULL REFERENCES public.ledger_accounts(id),
  type             TEXT        NOT NULL
                               CHECK (type IN (
                                 'CREDIT',
                                 'DEBIT',
                                 'REVERSAL_CREDIT',
                                 'REVERSAL_DEBIT'
                               )),
  amount_kobo      BIGINT      NOT NULL CHECK (amount_kobo > 0),
  reference        TEXT        NOT NULL,
  idempotency_key  TEXT        NOT NULL UNIQUE,
  description      TEXT,
  metadata         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookup by account_id (for balance projection and transaction listing)
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_id
  ON public.ledger_entries (account_id);

-- Lookup by reference (e.g. find entry for a payment ref)
CREATE INDEX IF NOT EXISTS idx_ledger_entries_reference
  ON public.ledger_entries (reference);

-- Lookup by idempotency_key (dedup check on write path)
CREATE INDEX IF NOT EXISTS idx_ledger_entries_idempotency_key
  ON public.ledger_entries (idempotency_key);

-- RLS
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;

-- Users can read their own entries (via account_id join)
CREATE POLICY "ledger_entries_select_own"
  ON public.ledger_entries
  FOR SELECT
  TO authenticated
  USING (
    account_id IN (
      SELECT id FROM public.ledger_accounts WHERE user_id = auth.uid()
    )
  );

-- NO INSERT/UPDATE/DELETE policies for authenticated role.
-- service_role bypasses RLS and is the only writer.
-- Immutability is enforced: no corrections via UPDATE, only reversing entries.
