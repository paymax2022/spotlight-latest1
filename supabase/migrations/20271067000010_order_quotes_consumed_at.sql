-- FOOD-UAT-C-007 (W8): PlaceOrder consumes a quote exactly once. consumed_at is
-- claimed atomically (UPDATE ... WHERE consumed_at IS NULL) so a replayed quote_id
-- is refused. Additive-only.
BEGIN;
ALTER TABLE public.order_quotes ADD COLUMN IF NOT EXISTS consumed_at timestamptz;
COMMIT;
