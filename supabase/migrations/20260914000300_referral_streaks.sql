-- ── Referral gamification streaks (M-GAM-03) ─────────────────────────────────
-- Additive-only. One row per user tracking their consecutive-active streak.
-- NON-CASH: points/streaks are a status currency, never money. RLS
-- deny-by-default; authenticated users see only their own row.

CREATE TABLE IF NOT EXISTS public.referral_streaks (
  user_id          uuid        PRIMARY KEY,
  current          int         NOT NULL DEFAULT 0,
  longest          int         NOT NULL DEFAULT 0,
  last_active_date date,
  unit             text        NOT NULL DEFAULT 'day',
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.referral_streaks ENABLE ROW LEVEL SECURITY;

-- Own-row select for authenticated members.
CREATE POLICY referral_streaks_own ON public.referral_streaks
  FOR SELECT TO authenticated USING (user_id = auth.uid());
