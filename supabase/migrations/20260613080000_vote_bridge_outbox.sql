-- Migration: bridge_outbox
-- Additive only. Transactional outbox for async side effects triggered by
-- bridged vote calls: referral credits, analytics events, notifications.
-- A background worker polls for pending rows and processes them.

CREATE TABLE IF NOT EXISTS public.bridge_outbox (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type    TEXT        NOT NULL,
  payload       JSONB       NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts      INTEGER     NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ
);

-- Partial index — worker queries for pending rows ordered by created_at
CREATE INDEX IF NOT EXISTS idx_bridge_outbox_pending
  ON public.bridge_outbox (status, created_at)
  WHERE status = 'pending';

COMMENT ON TABLE public.bridge_outbox IS
  'Transactional outbox for async side effects: referral credits, analytics, notifications.';

-- No RLS — service_role only
