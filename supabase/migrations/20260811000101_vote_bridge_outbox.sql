-- Vote Bridge Outbox Table
-- Transactional outbox for async side effects (referrals, analytics, notifications)

CREATE TABLE IF NOT EXISTS public.bridge_outbox (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   text        NOT NULL,  -- 'votes.free.cast' | 'votes.paid.credited' | 'referral.triggered'
  payload      jsonb       NOT NULL,
  status       text        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','processing','done','failed')),
  attempts     integer     NOT NULL DEFAULT 0,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

-- No RLS needed — service_role only
ALTER TABLE public.bridge_outbox DISABLE ROW LEVEL SECURITY;

-- Index for fast pending event lookup
CREATE INDEX IF NOT EXISTS idx_bridge_outbox_pending
  ON public.bridge_outbox (status, created_at)
  WHERE status = 'pending';

-- Index for event type queries
CREATE INDEX IF NOT EXISTS idx_bridge_outbox_event_type
  ON public.bridge_outbox (event_type, created_at DESC);

-- Index for failed events
CREATE INDEX IF NOT EXISTS idx_bridge_outbox_failed
  ON public.bridge_outbox (status, attempts, created_at)
  WHERE status = 'failed';

COMMENT ON TABLE public.bridge_outbox IS
  'Transactional outbox for async side effects: referral credits, analytics, notifications.';
COMMENT ON COLUMN public.bridge_outbox.id IS
  'Unique event ID';
COMMENT ON COLUMN public.bridge_outbox.event_type IS
  'Event type: votes.free.cast, votes.paid.credited, referral.triggered, votes.analytics, leaderboard.updated';
COMMENT ON COLUMN public.bridge_outbox.payload IS
  'Event payload (JSON) with all context for processing';
COMMENT ON COLUMN public.bridge_outbox.status IS
  'Event status: pending (awaiting processing), processing, done (succeeded), failed (max retries exceeded)';
COMMENT ON COLUMN public.bridge_outbox.attempts IS
  'Number of processing attempts (max 3)';
COMMENT ON COLUMN public.bridge_outbox.last_error IS
  'Error message from last failed attempt';
COMMENT ON COLUMN public.bridge_outbox.created_at IS
  'Timestamp when event was enqueued';
COMMENT ON COLUMN public.bridge_outbox.processed_at IS
  'Timestamp when event was successfully processed';
