-- B3: widen crypto_swap_orders.status for Quidax swap settlement.
--
-- The original CHECK (20260901001200) allowed only ('pending','filled','failed'),
-- so the Quidax webhook's transition to 'completed' was rejected and the
-- 'executing' state (swap confirmed with the provider, awaiting the callback)
-- could not be stored.
--
-- ADDITIVE / SAFE: replaces the CHECK with a strictly broader one (adds
-- 'executing' and 'completed'); every existing row stays valid. No table,
-- column or data is dropped, renamed or narrowed.
--
-- State machine:
--   filled     internal swap (no provider leg), terminal-ish
--   executing  Quidax quotation confirmed, ledger + holdings moved, awaiting webhook
--   completed  Quidax webhook reported success -> ledger_settled set by settlement
--   failed     provider reported failure
BEGIN;

DO $$
DECLARE
  c record;
BEGIN
  IF to_regclass('public.crypto_swap_orders') IS NULL THEN
    RETURN;
  END IF;

  -- Drop whichever CHECK constrains `status` (the inline constraint's name is
  -- Postgres-generated, so match on definition rather than assuming it).
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.crypto_swap_orders'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%status%'
       AND pg_get_constraintdef(oid) NOT ILIKE '%executing%'
  LOOP
    EXECUTE format('ALTER TABLE public.crypto_swap_orders DROP CONSTRAINT %I', c.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.crypto_swap_orders'::regclass
       AND conname = 'crypto_swap_orders_status_check'
  ) THEN
    ALTER TABLE public.crypto_swap_orders
      ADD CONSTRAINT crypto_swap_orders_status_check
      CHECK (status IN ('pending','filled','executing','completed','failed'));
  END IF;
END $$;

-- Webhook lookup is by provider transaction id.
CREATE INDEX IF NOT EXISTS idx_crypto_swap_orders_swap_tx
  ON public.crypto_swap_orders(swap_transaction_id)
  WHERE swap_transaction_id IS NOT NULL;

COMMIT;
