-- estate-b UAT remediation (ESTB-D004) — PENDING, additive-only.
-- estate_payments has no DB-level guard limiting an invoice to one successful
-- receipt. The BFF payInvoice now claims the invoice by flipping unpaid -> paid
-- before debiting, which closes the cross-idempotency-key double-charge race at
-- the application layer; this partial unique index is the durable belt-and-
-- braces guarantee so a second receipt row can never be written for the same
-- invoice regardless of caller.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_estate_payments_invoice
    ON estate_payments (invoice_id)
    WHERE invoice_id IS NOT NULL AND status = 'successful';
