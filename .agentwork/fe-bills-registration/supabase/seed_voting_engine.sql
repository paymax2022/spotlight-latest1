-- =============================================================================
-- VOTING ENGINE — Development Seed Data
-- Run after migrations to get a working voting setup locally.
-- Assumes the June 2026 Open Mic contest exists. Adjust IDs as needed.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Helper: lookup the first published Open Mic contest
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_contest_id   uuid;
  v_settings_id  uuid;
BEGIN

  SELECT id INTO v_contest_id
  FROM public.contests
  WHERE status IN ('published','voting_live','registration_open')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_contest_id IS NULL THEN
    RAISE NOTICE 'No published contest found — seed skipped. Publish a contest first.';
    RETURN;
  END IF;

  RAISE NOTICE 'Seeding voting engine for contest: %', v_contest_id;

  -- -------------------------------------------------------------------------
  -- 1. Voting Settings — hybrid (free + paid)
  -- -------------------------------------------------------------------------
  INSERT INTO public.voting_settings (
    contest_id,
    voting_enabled,
    voting_type,
    free_voting_enabled,
    free_votes_per_day,
    free_vote_limit_scope,
    require_login_for_free_vote,
    require_captcha,
    vote_cooldown_seconds,
    paid_voting_enabled,
    currency,
    payment_provider,
    payment_ref_prefix,
    allow_custom_vote_quantity,
    min_paid_votes,
    max_paid_votes_per_txn,
    show_public_vote_count,
    show_public_leaderboard,
    show_public_rank,
    allow_vote_sharing,
    voting_starts_at,
    voting_ends_at,
    timezone,
    leaderboard_freeze_enabled,
    fraud_detection_enabled,
    suspicious_ip_limit,
    bot_speed_threshold_ms,
    block_disposable_emails,
    detect_vote_spikes,
    enable_vote_quarantine,
    enable_manual_audit,
    status
  ) VALUES (
    v_contest_id,
    true,
    'hybrid',
    true,
    3,
    'user',
    true,
    false,
    0,
    true,
    'NGN',
    'paystack',
    'SPT-VOTE',
    false,
    1,
    10000,
    true,
    true,
    true,
    true,
    now() - interval '1 day',
    now() + interval '30 days',
    'Africa/Lagos',
    false,
    true,
    20,
    500,
    true,
    true,
    true,
    true,
    'active'
  )
  ON CONFLICT (contest_id) DO UPDATE SET
    voting_enabled = EXCLUDED.voting_enabled,
    status         = EXCLUDED.status,
    voting_ends_at = EXCLUDED.voting_ends_at;

  GET DIAGNOSTICS v_settings_id = ROW_COUNT;
  RAISE NOTICE 'Voting settings upserted for contest: %', v_contest_id;

  -- -------------------------------------------------------------------------
  -- 2. Vote Packages
  -- -------------------------------------------------------------------------
  -- Clear existing dev packages for this contest before re-seeding
  DELETE FROM public.vote_packages WHERE contest_id = v_contest_id;

  INSERT INTO public.vote_packages
    (contest_id, name, description, votes, bonus_votes, amount, currency, is_active, is_recommended, display_order)
  VALUES
    (v_contest_id, 'Starter Pack',   '10 votes to kick things off',         10,   0,  1000,  'NGN', true, false, 1),
    (v_contest_id, 'Supporter Pack', '50 votes — show your support',        50,   0,  5000,  'NGN', true, false, 2),
    (v_contest_id, 'Super Fan Pack', '100 votes — super fan territory',     100,  0, 10000, 'NGN', true, true,  3),
    (v_contest_id, 'Mega Fan Pack',  '500 votes — you''re a true fan',      500,  0, 50000, 'NGN', true, false, 4),
    (v_contest_id, 'Weekend Bonus',  'Buy 100 votes, get 20 extra!',        100, 20, 10000, 'NGN', true, false, 5);

  RAISE NOTICE 'Vote packages seeded (5 packages)';

  -- -------------------------------------------------------------------------
  -- 3. Voting Rounds
  -- -------------------------------------------------------------------------
  INSERT INTO public.voting_rounds
    (contest_id, name, slug, round_number, round_type, voting_type, status, starts_at, ends_at)
  VALUES
    (v_contest_id, 'Prequalification', 'prequalification', 1, 'prequalification', 'hybrid', 'active',
     now() - interval '1 day', now() + interval '14 days'),
    (v_contest_id, 'Top 20',           'top-20',           2, 'top20',           'hybrid', 'upcoming',
     now() + interval '15 days', now() + interval '22 days'),
    (v_contest_id, 'Grand Finale',     'grand-finale',     3, 'finale',          'paid',   'upcoming',
     now() + interval '28 days', now() + interval '30 days')
  ON CONFLICT (contest_id, slug) DO NOTHING;

  RAISE NOTICE 'Voting rounds seeded (3 rounds)';

  -- -------------------------------------------------------------------------
  -- 4. Sample vote totals (for testing leaderboard display)
  --    Uses real enrollment IDs if available, otherwise skips gracefully.
  -- -------------------------------------------------------------------------
  WITH contestants AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS rn
    FROM public.competition_enrollments
    WHERE contest_id = v_contest_id
    LIMIT 10
  )
  INSERT INTO public.vote_totals
    (contest_id, contestant_id, free_votes, paid_votes, bonus_votes, total_confirmed_votes, rank, last_vote_at)
  SELECT
    v_contest_id,
    id,
    -- Descending free votes: 1st gets 240, 2nd 200, ...
    GREATEST(0, 240 - (rn - 1) * 25)::bigint,
    -- Paid votes similarly staggered
    GREATEST(0, 3800 - (rn - 1) * 350)::bigint,
    0,
    GREATEST(0, (240 - (rn - 1) * 25) + (3800 - (rn - 1) * 350))::bigint,
    rn::integer,
    now() - ((rn - 1) * interval '2 hours')
  FROM contestants
  ON CONFLICT (contest_id, contestant_id, round_id) DO UPDATE SET
    free_votes            = EXCLUDED.free_votes,
    paid_votes            = EXCLUDED.paid_votes,
    total_confirmed_votes = EXCLUDED.total_confirmed_votes,
    rank                  = EXCLUDED.rank;

  RAISE NOTICE 'Sample vote totals seeded for existing contestants';

END $$;

COMMIT;
