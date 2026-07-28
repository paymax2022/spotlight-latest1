-- ── Referral vanity/invite links (M-INV-05) ──────────────────────────────────
-- Additive-only. Per-user custom invite aliases with UTM source/campaign and
-- click/signup counters. NON-money: no ledger, no wallet. RLS deny-by-default;
-- authenticated users see only their own rows.

CREATE TABLE IF NOT EXISTS public.referral_vanity_links (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL,
  alias      text        NOT NULL,
  source     text,
  campaign   text,
  clicks     int         NOT NULL DEFAULT 0,
  signups    int         NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, alias)
);

CREATE INDEX IF NOT EXISTS referral_vanity_links_user_created_idx
  ON public.referral_vanity_links (user_id, created_at DESC);

ALTER TABLE public.referral_vanity_links ENABLE ROW LEVEL SECURITY;

-- Own-row select for authenticated members.
CREATE POLICY referral_vanity_links_own ON public.referral_vanity_links
  FOR SELECT TO authenticated USING (user_id = auth.uid());
