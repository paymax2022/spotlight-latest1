-- Migration: tier_limit_events
-- Additive-only. Records every tier limit enforcement decision (allow and deny)
-- for audit, alerting, and future ML-based fraud signals.

CREATE TABLE IF NOT EXISTS public.tier_limit_events (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users(id),
  tier             smallint    NOT NULL CHECK (tier BETWEEN 0 AND 3),
  limit_type       text        NOT NULL CHECK (limit_type IN ('wallet_daily', 'vote_daily')),
  -- wallet_daily columns (NULL for vote_daily events)
  amount_kobo      bigint,
  daily_total_kobo bigint,
  limit_kobo       bigint,
  -- vote_daily columns (NULL for wallet_daily events)
  vote_count       integer,
  daily_vote_count integer,
  limit_votes      integer,
  -- outcome
  denied           boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tier_limit_events_user_created
  ON public.tier_limit_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tier_limit_events_denied
  ON public.tier_limit_events (denied, created_at DESC)
  WHERE denied = true;

COMMENT ON TABLE public.tier_limit_events IS
  'Immutable audit trail of every tier-limit check (wallet daily debit, vote daily count). '
  'Denied=true rows drive alerting. Never UPDATE or DELETE rows — append corrections only.';
