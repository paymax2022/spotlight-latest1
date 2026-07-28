-- Migration: bridge_idempotency_keys
-- Additive only. Dedup store for bridged vote calls.
-- Clients must send X-Idempotency-Key header; the bridge claims the key before
-- calling the underlying vote service and stores the result afterwards.
-- TTL enforcement (24h sweep) is handled at the application layer.

CREATE TABLE IF NOT EXISTS public.bridge_idempotency_keys (
  key         TEXT        PRIMARY KEY,
  response    JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.bridge_idempotency_keys IS
  'Dedup store for bridge vote calls. TTL enforced by application sweep (24h).';

-- No RLS — service_role only (same security model as votes table)
