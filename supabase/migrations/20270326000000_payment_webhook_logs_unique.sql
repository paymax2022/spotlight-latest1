-- payment_webhook_logs dedup unique index — the upsert target that never existed.
--
-- Both Paystack webhook handlers dedup on (provider, reference, event_type):
--   frontend-web/src/server/voting/payment/webhook.ts   (plain event types)
--   frontend-web/app/api/webhooks/paystack/gateway-handler.ts ("gateway:"-scoped)
-- Each calls supabase .upsert(..., { onConflict: 'provider,reference,event_type' }),
-- but the table created in 20260602100000_universal_voting_engine.sql only has a
-- NON-unique index on (reference, provider). PostgREST therefore rejected every
-- upsert with 42P10 "there is no unique or exclusion constraint matching the
-- ON CONFLICT specification" — verified live against the local REST API. The
-- insert fails wholesale: no log row is written, so the handlers' own
-- processed-flag dedup check can never observe a duplicate. (Downstream domain
-- idempotency — vote_transactions crediting, ledger idempotency keys — is what
-- actually prevented double-settlement; this restores the log-table dedup the
-- handlers were written against.)
--
-- Additive fix:
--   1. Defensive dedup before the index build: rows sharing the dedup key are
--      receipts for the SAME provider event — re-deliveries. Keep the earliest
--      (created_at, id) per key, delete the rest. Local DB had 0 rows; the
--      DELETE is a no-op there and a guard for any environment that picked up
--      rows through a non-upsert path.
--   2. CREATE UNIQUE INDEX (plain, not CONCURRENTLY — Supabase migrations run
--      inside a transaction). PostgREST resolves on_conflict against unique
--      indexes, so the existing onConflict target works unchanged.

DELETE FROM public.payment_webhook_logs a
USING public.payment_webhook_logs b
WHERE a.provider   = b.provider
  AND a.reference  = b.reference
  AND a.event_type = b.event_type
  AND (a.created_at, a.id) > (b.created_at, b.id);

CREATE UNIQUE INDEX IF NOT EXISTS payment_webhook_logs_dedup_uniq
  ON public.payment_webhook_logs (provider, reference, event_type);
