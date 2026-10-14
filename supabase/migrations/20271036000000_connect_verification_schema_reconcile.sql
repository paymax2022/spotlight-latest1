-- Reconcile connect_verification: two migrations created the same table with different shapes.
--
--   20260627000300 (first)  : status IN (pending, approved, rejected, expired); doc_type/doc_hash
--                             dedup columns; no unique(user_id).
--   20260702000000 (second) : CREATE TABLE IF NOT EXISTS, so it was SKIPPED. It was meant to add
--                             status IN (none, pending, l0_passed, l1_passed, failed, rejected),
--                             reason_code / provider / verified_at, and unique(user_id).
--
-- The Go StatusService (backend/internal/connect/verification) is written against the second shape,
-- so on any database built from the chain: GET failed (no reason_code), the first submit failed
-- (no unique(user_id) for ON CONFLICT) and status 'none'/'l0_passed' violated the CHECK. The
-- admin verification review queue is built on the same table.
--
-- ADDITIVE-ONLY and idempotent. Nothing is dropped or narrowed:
--   * the three missing columns are added (nullable);
--   * the status CHECK is widened to the UNION of both vocabularies, so every existing row
--     (pending/approved/rejected/expired) stays valid and the service's states become valid;
--   * unique(user_id) is created only when no user has more than one row, because the first
--     migration's design allowed several. If duplicates exist the index is skipped with a NOTICE
--     and the service's insert no longer depends on it (see the code change in the same PR).
-- The CHECK swap is its own short transaction: ADD CONSTRAINT takes an ACCESS EXCLUSIVE lock.

BEGIN;

ALTER TABLE public.connect_verification
  ADD COLUMN IF NOT EXISTS reason_code text,
  ADD COLUMN IF NOT EXISTS provider    text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

ALTER TABLE public.connect_verification
  DROP CONSTRAINT IF EXISTS connect_verification_status_check;

ALTER TABLE public.connect_verification
  ADD CONSTRAINT connect_verification_status_check CHECK (status IN (
    'none', 'pending', 'l0_passed', 'l1_passed', 'failed', 'rejected', 'approved', 'expired'
  ));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.connect_verification GROUP BY user_id HAVING count(*) > 1) THEN
    RAISE NOTICE 'connect_verification has users with more than one row; uq_connect_verification_user NOT created (dedupe first)';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_connect_verification_user
      ON public.connect_verification (user_id);
  END IF;
END $$;

COMMIT;
