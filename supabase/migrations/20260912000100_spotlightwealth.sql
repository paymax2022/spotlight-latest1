-- Spotlight Wealth — education-first Spotlight ⇄ Invest growth surface.
-- Backs backend/internal/spotlightwealth (routes /api/v1/spotlight/*). Mirrors
-- mobile-app/reactnative/src/features/spotlightwealth.
--
-- ADDITIVE-ONLY. STRICT RULES (docs/crypto/product.md):
--   • Leaderboards rank LEARNING points — never profit (spotlight_learning_points).
--   • Challenge rewards are WALLET CREDIT — never a guaranteed return. Reward
--     amounts are BIGINT kobo and are redistributed via the finance ledger; the
--     spotlight_reward_ledger records the member's reward history (balance =
--     SUM(entries), NL-8). No yield / no minting.
-- RLS: content readable by any authenticated member; per-user membership,
-- reward ledger and points are owner-scoped; service_role bypass for Go writes.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- Content config: videos, challenges, campaigns.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.spotlight_videos (
  id              text PRIMARY KEY,
  title           text NOT NULL,
  creator         text NOT NULL,
  thumbnail_color text NOT NULL DEFAULT '#000000',
  duration_mins   int  NOT NULL DEFAULT 0 CHECK (duration_mins >= 0),
  topic           text NOT NULL DEFAULT 'budgeting'
                    CHECK (topic IN ('budgeting','investing-basics','crypto','stocks','saving','mindset')),
  sort_order      int  NOT NULL DEFAULT 0,
  published       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_spotlight_videos_topic ON public.spotlight_videos (topic, sort_order);

-- Challenge: reward is WALLET CREDIT (kobo) on completion — never a return.
CREATE TABLE IF NOT EXISTS public.spotlight_challenges (
  id          text PRIMARY KEY,
  title       text NOT NULL,
  description text NOT NULL DEFAULT '',
  reward_kobo bigint NOT NULL DEFAULT 0 CHECK (reward_kobo >= 0),
  currency    text NOT NULL DEFAULT 'NGN',
  ends_at     timestamptz NOT NULL,
  kind        text NOT NULL DEFAULT 'literacy' CHECK (kind IN ('literacy','quiz','savings')),
  published   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Membership: JOINED → COMPLETED. One row per (challenge,user). The completion
-- transition gates the (idempotent) reward credit in the service.
CREATE TABLE IF NOT EXISTS public.spotlight_challenge_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id text NOT NULL REFERENCES public.spotlight_challenges(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state        text NOT NULL DEFAULT 'JOINED' CHECK (state IN ('JOINED','COMPLETED')),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (challenge_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_spotlight_ch_members_user ON public.spotlight_challenge_members (user_id);

CREATE TABLE IF NOT EXISTS public.spotlight_campaigns (
  id          text PRIMARY KEY,
  title       text NOT NULL,
  description text NOT NULL DEFAULT '',
  icon_color  text NOT NULL DEFAULT '#000000',
  cta         text NOT NULL DEFAULT '',
  sort_order  int  NOT NULL DEFAULT 0,
  published   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- LEARNING points leaderboard (NOT profit). Aggregated per user.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.spotlight_learning_points (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT 'Learner',
  points       int  NOT NULL DEFAULT 0 CHECK (points >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_spotlight_points_rank ON public.spotlight_learning_points (points DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- Reward wallet sub-ledger — append-only credits/redemptions in kobo. Balance is
-- SUM(amount_kobo) (NL-8). UNIQUE idempotency_key makes a replayed reward a
-- no-op (NL-9). Positive = credit earned, negative = redeemed.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.spotlight_reward_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label           text NOT NULL DEFAULT '',
  amount_kobo     bigint NOT NULL,
  currency        text NOT NULL DEFAULT 'NGN',
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_spotlight_reward_ledger_idem ON public.spotlight_reward_ledger (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_spotlight_reward_ledger_user ON public.spotlight_reward_ledger (user_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.spotlight_videos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spotlight_challenges         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spotlight_challenge_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spotlight_campaigns          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spotlight_learning_points    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spotlight_reward_ledger      ENABLE ROW LEVEL SECURITY;

-- Public-to-members content + the leaderboard (learning points are public rank).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['spotlight_videos','spotlight_challenges','spotlight_campaigns','spotlight_learning_points']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_read ON public.%I FOR SELECT TO authenticated USING (TRUE)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_service ON public.%I TO service_role USING (TRUE) WITH CHECK (TRUE)', t, t);
  END LOOP;
END $$;

-- Membership + reward ledger: owner-scoped reads only.
DROP POLICY IF EXISTS spotlight_ch_members_own ON public.spotlight_challenge_members;
CREATE POLICY spotlight_ch_members_own ON public.spotlight_challenge_members
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS spotlight_ch_members_service ON public.spotlight_challenge_members;
CREATE POLICY spotlight_ch_members_service ON public.spotlight_challenge_members
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS spotlight_reward_ledger_own ON public.spotlight_reward_ledger;
CREATE POLICY spotlight_reward_ledger_own ON public.spotlight_reward_ledger
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS spotlight_reward_ledger_service ON public.spotlight_reward_ledger;
CREATE POLICY spotlight_reward_ledger_service ON public.spotlight_reward_ledger
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- Seed content (matches mobile spotlight.mock.ts). Rewards are kobo (major×100).
-- ends_at is seeded relative to now() so challenges are joinable after migration.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.spotlight_videos (id, title, creator, thumbnail_color, duration_mins, topic, sort_order) VALUES
  ('vid_1','How to build your first budget on any income','Ada Talks Money','#8B5CF6',8,'budgeting',1),
  ('vid_2','What is an index fund, really?','Tunde Explains','#E0E7FF',11,'investing-basics',2),
  ('vid_3','Crypto risk 101: volatility, scams & safety','ChainSimple','#D4AF37',14,'crypto',3),
  ('vid_4','Reading a stock before you ever buy it','Market Mornings','#0EA5A4',9,'stocks',4),
  ('vid_5','The 50/30/20 rule, adapted for Naira earners','Ada Talks Money','#8B5CF6',6,'budgeting',5),
  ('vid_6','Why you can''t time the market (and what to do)','Tunde Explains','#E0E7FF',12,'investing-basics',6),
  ('vid_7','Building a 3-month emergency fund from zero','Save With Zara','#FCE7F3',7,'saving',7),
  ('vid_8','Patience, FOMO and your money brain','MindOverMoney','#2563EB',10,'mindset',8),
  ('vid_9','Stablecoins explained without the hype','ChainSimple','#D4AF37',13,'crypto',9),
  ('vid_10','Dividends, splits & what corporate actions mean','Market Mornings','#0EA5A4',15,'stocks',10)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.spotlight_challenges (id, title, description, reward_kobo, currency, ends_at, kind) VALUES
  ('chl_1','7-Day Money Habits','Watch one short literacy lesson a day for a week and log a takeaway. Build the habit, earn reward credit — no investing required.',250000,'NGN', now() + interval '72 hours','literacy'),
  ('chl_2','Investing Basics Quiz','Answer 10 questions on diversification, risk and fees. Pass to earn reward credit and unlock the next lesson set.',150000,'NGN', now() + interval '120 hours','quiz'),
  ('chl_3','Save ₦1,000 Streak','Set aside a small amount toward a goal each day for 14 days. Completing the streak earns reward credit for sticking with it.',300000,'NGN', now() + interval '312 hours','savings'),
  ('chl_4','Crypto Safety Challenge','Complete the scam-spotting and wallet-safety lessons, then pass the safety check. Reward credit on completion.',200000,'NGN', now() + interval '48 hours','literacy')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.spotlight_campaigns (id, title, description, icon_color, cta, sort_order) VALUES
  ('cmp_1','Spotlight Wealth Academy','A guided track of creator-led lessons covering budgeting, saving and the basics of investing — at your own pace, with reward credit along the way.','#2563EB','Start learning',1),
  ('cmp_2','Bring a Friend to Learn','Invite a friend to complete their first literacy lesson. When they finish, you both receive reward credit. Education-first, no purchase required.','#8B5CF6','Invite a friend',2),
  ('cmp_3','Youth Money Week','A week of live creator sessions and short challenges focused on financial literacy for young earners. Join sessions and earn reward credit for participating.','#0EA5A4','See the schedule',3)
ON CONFLICT (id) DO NOTHING;

COMMIT;
