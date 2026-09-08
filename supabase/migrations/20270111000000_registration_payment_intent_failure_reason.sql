-- registration_payment_intents.failure_reason
--
-- The table has existed since the module's original migration but nothing
-- ever wrote to it: findRegistrationPaymentIntentByIdempotencyKey,
-- createRegistrationPaymentIntent, getRegistrationPaymentIntentByReference,
-- markRegistrationPaymentIntentStatus, and applyRegistrationPaymentSuccess
-- all lived in the in-memory registration/store.ts instead (see that file's
-- own comment: "moves to Postgres only alongside a dedicated table mirroring
-- utility_paystack_intents" — the table was added, the code move never
-- happened). Consequence: every registration payment intent was lost on any
-- server restart, and applyRegistrationPaymentSuccess wrote a verified
-- Paystack success onto a draft copy that GET/PATCH never read, so a fully
-- successful charge never actually marked the application as paid.
--
-- This migration adds the one column the in-memory type carried that the
-- table didn't (failure_reason, used by markRegistrationPaymentIntentStatus's
-- failed-status audit note) so the Postgres-backed replacement in
-- supabase-store.ts has everywhere to put it. Additive only.

ALTER TABLE public.registration_payment_intents
  ADD COLUMN IF NOT EXISTS failure_reason TEXT;
