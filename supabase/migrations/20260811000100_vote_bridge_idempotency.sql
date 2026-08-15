-- Vote Bridge Idempotency Keys Table
-- Deduplicates concurrent vote requests using idempotency keys

CREATE TABLE IF NOT EXISTS public.bridge_idempotency_keys (
  key          text        PRIMARY KEY,
  response     jsonb       NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- No RLS needed — service_role only (same as votes table)
ALTER TABLE public.bridge_idempotency_keys DISABLE ROW LEVEL SECURITY;

-- TTL index for cleanup
CREATE INDEX IF NOT EXISTS idx_bridge_idempotency_keys_created_at
  ON public.bridge_idempotency_keys (created_at DESC);

COMMENT ON TABLE public.bridge_idempotency_keys IS
  'Dedup store for bridge vote calls. TTL enforced by application sweep (24h).';
COMMENT ON COLUMN public.bridge_idempotency_keys.key IS
  'Unique idempotency key from X-Idempotency-Key header';
COMMENT ON COLUMN public.bridge_idempotency_keys.response IS
  'Cached response body (VoteResponse JSON)';
COMMENT ON COLUMN public.bridge_idempotency_keys.created_at IS
  'Timestamp for TTL management (24h expiry)';
