-- Estate UAT (ESTB-D004, lane estate-b): an invoice may carry at most one
-- successful receipt. The BFF payInvoice atomic claim closes the
-- cross-Idempotency-Key double-charge race in the app; this partial unique
-- index is the durable guarantee regardless of caller. Additive-only.
--
-- Guarded: skipped with a WARNING if live data already has an invoice with two
-- successful receipts (those need ledger reconciliation, not a blind delete).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM estate_payments
    WHERE invoice_id IS NOT NULL AND status = 'successful'
    GROUP BY invoice_id HAVING COUNT(*) > 1
  ) THEN
    RAISE WARNING 'uidx_estate_payments_invoice skipped: invoices with multiple successful receipts exist — reconcile, then re-run';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uidx_estate_payments_invoice
      ON estate_payments (invoice_id)
      WHERE invoice_id IS NOT NULL AND status = 'successful';
  END IF;
END $$;
