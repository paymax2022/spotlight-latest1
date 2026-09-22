-- utility_provider_bind — the OUTBOUND purchase idempotency register for the
-- Utility Bills money path (backend/internal/utilitybills/provider_bind.go).
--
-- Mirrors the shape of insurance_provider_bind (see
-- 20270135000000_insurance_v2_purchasability.sql), with the columns Utility Bills
-- actually needs: it routes across MULTIPLE providers (provider_name), keys on a
-- biller + product code rather than a policy id, and stores the provider's own
-- transaction reference.
--
-- WHY THIS TABLE EXISTS AT ALL
-- VTpass's request_id is derived from an Africa/Lagos YYYYMMDDHHmm prefix plus the
-- idempotency key's last 20 alphanumerics, so the SAME key retried in the NEXT
-- minute produces a DIFFERENT request_id and VTpass sells the customer a second
-- unit of electricity. The guarantee therefore has to live here: claiming a key is
-- an INSERT on this primary key, so a replayed or concurrent attempt cannot claim
-- it and cannot reach the provider.
--
-- state:
--   in_flight — claimed, the call is being made right now.
--   succeeded — the provider ACCEPTED it (SUCCESS *or* PENDING). A replay returns
--               provider_transaction_ref instead of purchasing again.
--   failed    — the provider REFUSED it (or we refused pre-flight). Nothing was
--               created, so the key is re-armed and a retry/failover is safe.
--   unknown   — SENT, outcome never learned (timeout / transport error). LOCKED:
--               retrying might double-purchase, giving up might strand a debited
--               member. Resolved by Phase 3's requery job or a human, never guessed.
--
-- Additive-only: creates one new table, touches nothing existing. Idempotent.
BEGIN;

CREATE TABLE IF NOT EXISTS public.utility_provider_bind (
  -- The claim. One row per outbound provider attempt; the PK IS the mutex.
  idempotency_key          TEXT PRIMARY KEY,
  -- utility_providers.code of the provider this attempt targeted. Not an FK:
  -- this register must outlive a provider row being renamed or retired — an
  -- unresolved bind is exactly the thing you still need to reconcile afterwards.
  provider_name            TEXT NOT NULL,
  biller_code              TEXT,
  product_code             TEXT,
  -- The utility_transactions row this attempt belongs to. Nullable and ON DELETE
  -- SET NULL for the same reason: losing the transaction must not erase the
  -- evidence that money may have moved at the provider.
  transaction_id           UUID REFERENCES public.utility_transactions(id) ON DELETE SET NULL,
  provider_transaction_ref TEXT,
  state                    TEXT NOT NULL DEFAULT 'in_flight'
    CHECK (state IN ('in_flight','succeeded','failed','unknown')),
  attempts                 INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
  failure_text             TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The reconciliation queue read: "which purchases have an outcome nobody knows?"
-- Partial index because 'unknown' is (and must stay) a tiny fraction of the table.
CREATE INDEX IF NOT EXISTS idx_utility_provider_bind_unresolved
  ON public.utility_provider_bind (created_at)
  WHERE state = 'unknown';

CREATE INDEX IF NOT EXISTS idx_utility_provider_bind_transaction
  ON public.utility_provider_bind (transaction_id);

-- Reached ONLY by the Go backend over the pgx service pool (owner 'postgres',
-- which bypasses RLS). Enabling RLS with no policy = deny-all for anon and
-- authenticated. The wave-4 lockdown migration alongside this one applies the
-- same treatment to the rest of the utility money-path tables; it is repeated
-- here so this table is never briefly world-readable between the two.
ALTER TABLE public.utility_provider_bind ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.utility_provider_bind FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.utility_provider_bind FROM authenticated;
  END IF;
END $$;

COMMIT;
