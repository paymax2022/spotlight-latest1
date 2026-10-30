-- Migration: event_fraud_reviews
-- Append-only reviewer decisions for the events admin fraud queue
-- (backend/internal/top5events/admin_fraud.go). Signals themselves are derived
-- on read from existing tables; this table only records what a reviewer
-- decided, keyed by the deterministic signal id. The newest row per signal_id
-- is that signal's status.
--
-- SAFETY: additive-only. CREATE TABLE / INDEX IF NOT EXISTS, DROP POLICY IF
-- EXISTS before CREATE POLICY. No existing object is altered.

CREATE TABLE IF NOT EXISTS public.event_fraud_reviews (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id  text NOT NULL CHECK (length(signal_id) BETWEEN 1 AND 200),
  kind       text NOT NULL CHECK (kind IN ('dup_scan','abnormal_topup','vendor_self_charge','rapid_refund')),
  event_id   uuid REFERENCES public.events(id) ON DELETE CASCADE,
  action     text NOT NULL CHECK (action IN ('investigate','clear','block')),
  status     text NOT NULL CHECK (status IN ('investigating','cleared','blocked')),
  note       text NOT NULL DEFAULT '',
  actor_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_fraud_reviews_signal
  ON public.event_fraud_reviews (signal_id, created_at DESC);

-- Written only by the Go service (pgx, service role); admins may read.
ALTER TABLE public.event_fraud_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_fraud_reviews_read ON public.event_fraud_reviews;
CREATE POLICY event_fraud_reviews_read ON public.event_fraud_reviews
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS event_fraud_reviews_service ON public.event_fraud_reviews;
CREATE POLICY event_fraud_reviews_service ON public.event_fraud_reviews
  TO service_role USING (true) WITH CHECK (true);
