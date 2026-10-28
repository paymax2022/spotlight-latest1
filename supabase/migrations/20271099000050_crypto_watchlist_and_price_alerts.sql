-- Crypto watchlist and price alerts (member-owned, non-money). Additive only.
-- Assets are referenced by crypto_assets.id; a watchlist row or alert is removed with its asset.

CREATE TABLE IF NOT EXISTS public.crypto_watchlist (
  user_id    uuid NOT NULL,
  asset_id   uuid NOT NULL REFERENCES public.crypto_assets(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, asset_id)
);

CREATE TABLE IF NOT EXISTS public.crypto_price_alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  asset_id     uuid NOT NULL REFERENCES public.crypto_assets(id) ON DELETE CASCADE,
  condition    text NOT NULL CHECK (condition IN ('above', 'below')),
  target_minor bigint NOT NULL CHECK (target_minor > 0),
  currency     text NOT NULL DEFAULT 'NGN' CHECK (currency IN ('NGN', 'USD')),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'triggered', 'paused')),
  triggered_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crypto_price_alerts_user
  ON public.crypto_price_alerts (user_id, created_at DESC);
