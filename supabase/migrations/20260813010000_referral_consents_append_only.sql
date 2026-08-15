-- Make referral consent records append-only.
--
-- referral_consents was UNIQUE on (user_id, consent_type, version) and the write
-- path upserted on that key, so changing a consent at the same version
-- OVERWROTE the previous record. Granting then withdrawing left a single row
-- reading `false`: the current state was right, but "what did this user agree
-- to, and when did they withdraw it?" became unanswerable.
--
-- A consent record is evidence. It should accumulate, like the ledger does
-- (see ledger_entries: immutable, corrections via reversing entries only).
-- Every grant or withdrawal is now its own row, and current state is the most
-- recent row per (user_id, consent_type).
--
-- Additive in effect: dropping a uniqueness constraint only ADMITS rows that
-- were previously rejected. No existing row is altered, deleted, or invalidated.

-- ---------------------------------------------------------------------------
-- 1. Allow more than one row per (user, type, version).
-- ---------------------------------------------------------------------------
ALTER TABLE public.referral_consents
  DROP CONSTRAINT IF EXISTS referral_consents_user_id_consent_type_version_key;

-- The constraint may exist as a bare unique index rather than a table
-- constraint depending on how it was created; drop that form too.
DROP INDEX IF EXISTS public.referral_consents_user_id_consent_type_version_key;

-- ---------------------------------------------------------------------------
-- 2. A deterministic "latest".
--
-- created_at alone cannot order an append-only table: now() is constant within
-- a transaction, so two consents written together carry identical timestamps,
-- and id is a random UUID that cannot break the tie. Ordering by created_at
-- then picks arbitrarily — verified: a grant/withdraw/grant sequence resolved
-- to the WITHDRAWAL, i.e. the toggle would read off after the user turned it
-- back on.
--
-- seq is monotonic per insert, so the newest row is unambiguous. Existing rows
-- are backfilled in physical order; they were unique per (user, type, version)
-- before this migration, so their relative order was never meaningful anyway.
-- ---------------------------------------------------------------------------
ALTER TABLE public.referral_consents
  ADD COLUMN IF NOT EXISTS seq BIGSERIAL;

CREATE INDEX IF NOT EXISTS referral_consents_user_type_seq_idx
  ON public.referral_consents (user_id, consent_type, seq DESC);

-- ---------------------------------------------------------------------------
-- 3. Enforce immutability at the database, not by convention.
--
-- Without this, "append-only" is just a promise the application makes. A
-- trigger means a stray UPDATE from a migration, a console session or a future
-- code path fails loudly instead of quietly rewriting evidence.
--
-- Corrections are made by appending a new row (grant -> withdraw -> grant),
-- exactly as the ledger corrects with reversing entries.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.referral_consents_forbid_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'referral_consents is append-only: % is not permitted. Record a new consent row instead.',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS referral_consents_no_update ON public.referral_consents;
CREATE TRIGGER referral_consents_no_update
  BEFORE UPDATE ON public.referral_consents
  FOR EACH ROW EXECUTE FUNCTION public.referral_consents_forbid_mutation();

DROP TRIGGER IF EXISTS referral_consents_no_delete ON public.referral_consents;
CREATE TRIGGER referral_consents_no_delete
  BEFORE DELETE ON public.referral_consents
  FOR EACH ROW EXECUTE FUNCTION public.referral_consents_forbid_mutation();

COMMENT ON TABLE public.referral_consents IS
  'Append-only consent evidence. One row per grant/withdrawal; current state is the highest-seq row per (user_id, consent_type). UPDATE and DELETE are blocked by trigger.';
