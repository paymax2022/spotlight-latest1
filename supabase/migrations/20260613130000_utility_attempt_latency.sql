-- Migration: utility_attempt_latency
-- Adds explicit latency and timeout metadata for provider performance reporting.

ALTER TABLE public.utility_provider_attempts
  ADD COLUMN IF NOT EXISTS duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  ADD COLUMN IF NOT EXISTS timeout_ms INTEGER CHECK (timeout_ms IS NULL OR timeout_ms > 0);

CREATE INDEX IF NOT EXISTS idx_utility_attempts_status_started
  ON public.utility_provider_attempts(status, started_at DESC);
