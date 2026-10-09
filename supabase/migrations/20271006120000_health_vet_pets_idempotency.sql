-- health.vet: idempotent pet creation.
--
-- POST /pets ignored a replayed Idempotency-Key: a retry wrote a SECOND pets row
-- (prod sweep, ecf0e0d8). The module convention is a stored key + UNIQUE
-- (vet_appointment_payments.idempotency_key, lab_orders, pharmacy_orders) — the
-- pets table simply never had the column. This adds it and a per-owner partial
-- unique index: keys are client-chosen, so uniqueness is scoped to the owner —
-- one owner replaying their key resolves to their original pet; two different
-- owners reusing the same string never collide.
--
-- Additive-only: nullable ADD COLUMN (existing rows keep NULL idempotency_key
-- and are exempted by the index predicate) + CREATE INDEX IF NOT EXISTS.

BEGIN;

ALTER TABLE public.pets
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS pets_owner_idem_key_ux
    ON public.pets (owner_user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

COMMIT;
