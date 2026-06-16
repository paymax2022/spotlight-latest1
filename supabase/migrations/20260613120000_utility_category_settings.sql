-- Migration: utility_category_settings
-- Category-level controls for availability, limits, and default pricing policy.

CREATE TABLE IF NOT EXISTS public.utility_category_settings (
  category TEXT PRIMARY KEY
    CHECK (category IN ('airtime','data','electricity','cable_tv','internet','education')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  availability_message TEXT,
  daily_limit_kobo BIGINT CHECK (daily_limit_kobo IS NULL OR daily_limit_kobo > 0),
  min_amount_kobo BIGINT CHECK (min_amount_kobo IS NULL OR min_amount_kobo > 0),
  max_amount_kobo BIGINT CHECK (max_amount_kobo IS NULL OR max_amount_kobo > 0),
  default_commission_bps INTEGER NOT NULL DEFAULT 0 CHECK (default_commission_bps >= 0),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.utility_category_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "utility_category_settings_read_enabled" ON public.utility_category_settings
  FOR SELECT TO authenticated USING (enabled = true);

INSERT INTO public.utility_category_settings (category, enabled, daily_limit_kobo, min_amount_kobo, max_amount_kobo)
VALUES
  ('airtime', true, 5000000, 5000, 5000000),
  ('data', true, 10000000, 5000, 10000000),
  ('electricity', true, 20000000, 100000, 20000000),
  ('cable_tv', true, 15000000, 100000, 15000000),
  ('internet', true, 15000000, 100000, 15000000),
  ('education', true, 5000000, 100000, 5000000)
ON CONFLICT (category) DO NOTHING;
