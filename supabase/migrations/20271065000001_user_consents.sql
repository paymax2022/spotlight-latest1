-- FOOD-UAT-H-001: durable per-user consent ledger (marketing / promo / future kinds).
-- Append-only: a withdrawal is a NEW row; the latest row per (user_id, kind) is
-- the effective state. ip_hash is a hash, never the raw address. Additive-only.
BEGIN;
CREATE TABLE IF NOT EXISTS public.user_consents (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL,
  kind        text        NOT NULL CHECK (length(kind) BETWEEN 1 AND 64),
  status      text        NOT NULL CHECK (status IN ('granted','withdrawn')),
  source      text,
  user_agent  text,
  ip_hash     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_consents_user_kind
  ON public.user_consents (user_id, kind, created_at DESC);
ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;
COMMIT;
