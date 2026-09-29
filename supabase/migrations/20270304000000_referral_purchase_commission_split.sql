-- Referral purchase-commission-split — a referrer earns 20% of Spotlight's
-- realized commission (commission_earnings.spotlight_revenue_kobo) on every
-- purchase made by someone they referred, capped at a fixed number of
-- rewarded purchases PER REFERRAL CODE (not per referred user — one code can
-- be used by N referred people, and the cap is shared across all of them).
-- Once a code hits its cap, it is retired: further purchases under it earn
-- nothing extra for the referrer and the 20% simply stays with Spotlight (the
-- "default referrer is Admin" policy — there is no separate admin payout to
-- make, since Spotlight already holds 100% of its own commission by default).
--
-- Deliberately does NOT touch commission_earnings, referral_attributions, or
-- referral_rewards' existing shape — this reuses referral_rewards (see
-- 20260910000001_referral_direct_rewards.sql) for the reward record itself,
-- distinguishing rows from that migration's tiered Direct-Referral-Rewards
-- engine via applied_rate = 0.20 (flat, never tiered) and config_version = 0
-- (a sentinel meaning "not tied to referral_program_config versioning — this
-- is the flat-rate purchase-commission-split scheme", since config_version's
-- normal meaning ties to that OTHER engine's versioned config table, which
-- this scheme does not use).
--
-- Additive only: ADD COLUMN IF NOT EXISTS, no DROP/RENAME/type narrowing.
BEGIN;

ALTER TABLE public.referral_links
  ADD COLUMN IF NOT EXISTS reward_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reward_cap   INTEGER NOT NULL DEFAULT 100;

-- Postgres has no "ADD CONSTRAINT IF NOT EXISTS", so guard it for idempotent replay.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referral_links_reward_count_non_negative') THEN
    ALTER TABLE public.referral_links
      ADD CONSTRAINT referral_links_reward_count_non_negative CHECK (reward_count >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referral_links_reward_cap_positive') THEN
    ALTER TABLE public.referral_links
      ADD CONSTRAINT referral_links_reward_cap_positive CHECK (reward_cap > 0);
  END IF;
END$$;

COMMENT ON COLUMN public.referral_links.reward_count IS
  'How many purchases have earned this code''s referrer a commission split so far. Incremented atomically (UPDATE ... WHERE reward_count < reward_cap) so concurrent purchases can never push it past reward_cap.';
COMMENT ON COLUMN public.referral_links.reward_cap IS
  'Maximum number of purchases (across every person referred by this one code) that earn the referrer a commission split. Defaults to 100. Once reward_count reaches this, the code is retired for commission purposes — the referrer earns nothing further and the split defaults back to Spotlight (Admin).';

COMMIT;
