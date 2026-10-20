-- FOOD-UAT-C-007: server-signed, TTL'd price snapshots for food orders, so the
-- client can show the exact pay-sheet amount and detect a price change at
-- checkout. Additive-only; backend-only access (RLS on, no policies).
BEGIN;
CREATE TABLE IF NOT EXISTS public.order_quotes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL,
  restaurant_id uuid        NOT NULL,
  payload_jsonb jsonb       NOT NULL,
  signature     text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_quotes_user_created
  ON public.order_quotes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_quotes_expires
  ON public.order_quotes (expires_at);
ALTER TABLE public.order_quotes ENABLE ROW LEVEL SECURITY;
COMMIT;
