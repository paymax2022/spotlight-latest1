-- Migration: event_settlement_reviews
-- Append-only reviewer decisions for the events admin console
-- (backend/internal/top5events/admin_settlement_review.go):
--   subject_kind = 'settlement_break' — investigate/resolve/reconcile on a
--                  derived settlement break (subject_id = settlement line id);
--                  break_kobo records the delta the reviewer saw.
--   subject_kind = 'vendor_payout'    — approve (settled via SettleVendor) or
--                  reject (hold) of a vendor's unsettled float.
-- These rows never move money; a correction is a reversing ledger entry.
--
-- SAFETY: additive-only. CREATE TABLE / INDEX IF NOT EXISTS, DROP POLICY IF
-- EXISTS before CREATE POLICY. No existing object is altered.

CREATE TABLE IF NOT EXISTS public.event_settlement_reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_kind    text NOT NULL CHECK (subject_kind IN ('settlement_break','vendor_payout')),
  subject_id      text NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 200),
  event_id        uuid REFERENCES public.events(id) ON DELETE CASCADE,
  action          text NOT NULL CHECK (action IN ('investigate','resolve','reconcile','approve','reject')),
  status          text NOT NULL CHECK (status IN ('investigating','resolved','reconciled','paid','rejected')),
  break_kobo      bigint NOT NULL DEFAULT 0 CHECK (break_kobo >= 0),
  note            text NOT NULL DEFAULT '',
  actor_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_settlement_reviews_subject
  ON public.event_settlement_reviews (subject_kind, subject_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_settlement_reviews_idem
  ON public.event_settlement_reviews (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Written only by the Go service (pgx, service role); admins may read.
ALTER TABLE public.event_settlement_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_settlement_reviews_read ON public.event_settlement_reviews;
CREATE POLICY event_settlement_reviews_read ON public.event_settlement_reviews
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS event_settlement_reviews_service ON public.event_settlement_reviews;
CREATE POLICY event_settlement_reviews_service ON public.event_settlement_reviews
  TO service_role USING (true) WITH CHECK (true);
