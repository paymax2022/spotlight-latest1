-- =============================================================================
-- UNIVERSAL CONTEST VOTING ENGINE
-- Migration: 20260602100000_universal_voting_engine
-- Supports: free voting, paid voting, hybrid, multi-round, multi-contest,
--           fraud detection, audit trail, real-time leaderboard, RBAC
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- VOTING SETTINGS — one row per contest, configures the entire voting module
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.voting_settings (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id                   uuid NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  voting_enabled               boolean NOT NULL DEFAULT false,
  voting_type                  text NOT NULL DEFAULT 'free'
                                 CHECK (voting_type IN ('free','paid','hybrid')),

  -- Free voting
  free_voting_enabled          boolean NOT NULL DEFAULT true,
  free_votes_per_day           integer NOT NULL DEFAULT 3,
  free_votes_per_contest       integer,                        -- NULL = unlimited if daily passes
  free_votes_per_contestant    integer,                        -- NULL = not restricted per contestant
  free_vote_reset_time         time NOT NULL DEFAULT '00:00:00', -- UTC time to reset daily count
  free_vote_limit_scope        text NOT NULL DEFAULT 'user'
                                 CHECK (free_vote_limit_scope IN ('user','email','phone','device','ip','session')),
  allow_anonymous_free_vote    boolean NOT NULL DEFAULT false,
  require_login_for_free_vote  boolean NOT NULL DEFAULT true,
  require_phone_for_free_vote  boolean NOT NULL DEFAULT false,
  require_email_for_free_vote  boolean NOT NULL DEFAULT false,
  require_captcha              boolean NOT NULL DEFAULT false,
  vote_cooldown_seconds        integer NOT NULL DEFAULT 0,
  max_failed_attempts          integer NOT NULL DEFAULT 10,

  -- Paid voting
  paid_voting_enabled          boolean NOT NULL DEFAULT false,
  currency                     text NOT NULL DEFAULT 'NGN',
  payment_provider             text NOT NULL DEFAULT 'paystack'
                                 CHECK (payment_provider IN ('paystack','flutterwave','monnify','squad')),
  allow_custom_vote_quantity   boolean NOT NULL DEFAULT false,
  min_paid_votes               integer NOT NULL DEFAULT 1,
  max_paid_votes_per_txn       integer NOT NULL DEFAULT 10000,
  payment_ref_prefix           text NOT NULL DEFAULT 'SPT-VOTE',
  apply_payment_fees_to_user   boolean NOT NULL DEFAULT false,
  refund_policy                text,

  -- Visibility
  show_public_vote_count       boolean NOT NULL DEFAULT true,
  show_public_leaderboard      boolean NOT NULL DEFAULT true,
  show_public_rank             boolean NOT NULL DEFAULT true,
  allow_vote_sharing           boolean NOT NULL DEFAULT true,

  -- Voting window
  voting_starts_at             timestamptz,
  voting_ends_at               timestamptz,
  timezone                     text NOT NULL DEFAULT 'Africa/Lagos',

  -- Leaderboard
  leaderboard_freeze_enabled   boolean NOT NULL DEFAULT false,
  leaderboard_freeze_at        timestamptz,
  leaderboard_scope            text NOT NULL DEFAULT 'overall'
                                 CHECK (leaderboard_scope IN ('overall','category','region','gender')),
  leaderboard_tie_breaker      text NOT NULL DEFAULT 'first_milestone'
                                 CHECK (leaderboard_tie_breaker IN ('first_milestone','paid_votes','free_votes','judge_score','admin')),
  show_top_n                   integer,                         -- NULL = show all

  -- Fraud control
  fraud_detection_enabled      boolean NOT NULL DEFAULT true,
  suspicious_ip_limit          integer NOT NULL DEFAULT 20,
  bot_speed_threshold_ms       integer NOT NULL DEFAULT 500,    -- min ms between votes before flagged
  block_disposable_emails      boolean NOT NULL DEFAULT true,
  detect_vote_spikes           boolean NOT NULL DEFAULT true,
  enable_vote_quarantine       boolean NOT NULL DEFAULT true,
  enable_manual_audit          boolean NOT NULL DEFAULT true,

  status                       text NOT NULL DEFAULT 'draft'
                                 CHECK (status IN ('draft','active','paused','closed')),
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),

  UNIQUE(contest_id)
);

-- ---------------------------------------------------------------------------
-- VOTE PACKAGES — admin-created paid vote bundles per contest
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vote_packages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id       uuid NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  name             text NOT NULL,
  description      text,
  votes            integer NOT NULL CHECK (votes > 0),
  bonus_votes      integer NOT NULL DEFAULT 0,
  amount           numeric(12,2) NOT NULL CHECK (amount >= 0),
  currency         text NOT NULL DEFAULT 'NGN',
  is_active        boolean NOT NULL DEFAULT true,
  is_recommended   boolean NOT NULL DEFAULT false,
  promo_label      text,
  display_order    integer NOT NULL DEFAULT 0,
  starts_at        timestamptz,
  ends_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- VOTER PROFILES — lightweight voter identity (can be anonymous or linked)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.voter_profiles (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email                text,
  phone                text,
  display_name         text,
  device_fingerprint   text,
  ip_address           inet,
  is_anonymous         boolean NOT NULL DEFAULT false,
  is_verified          boolean NOT NULL DEFAULT false,
  ban_reason           text,
  banned_at            timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- VOTES — immutable ledger; never DELETE, only status changes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.votes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id         uuid NOT NULL REFERENCES public.contests(id),
  contestant_id      uuid NOT NULL,                              -- references submissions/entries table
  voter_profile_id   uuid REFERENCES public.voter_profiles(id),
  voter_user_id      uuid REFERENCES auth.users(id),
  vote_type          text NOT NULL
                       CHECK (vote_type IN ('free','paid','bonus','admin_adjustment','sponsor_bundle','refund_reversal','fraud_reversal')),
  vote_quantity      integer NOT NULL CHECK (vote_quantity != 0),  -- negative for reversals
  vote_status        text NOT NULL DEFAULT 'pending'
                       CHECK (vote_status IN ('pending','confirmed','rejected','reversed','quarantined','failed')),
  transaction_id     uuid,                                       -- fk to vote_transactions
  payment_reference  text,
  round_id           uuid,                                       -- fk to voting_rounds if applicable
  ip_address         inet,
  device_fingerprint text,
  user_agent         text,
  source             text,                                       -- share code, direct, etc.
  share_code         text,
  fraud_score        integer NOT NULL DEFAULT 0,
  fraud_status       text NOT NULL DEFAULT 'clean'
                       CHECK (fraud_status IN ('clean','suspicious','flagged','quarantined','cleared')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  confirmed_at       timestamptz,
  reversed_at        timestamptz,
  reversal_reason    text
);

-- ---------------------------------------------------------------------------
-- VOTE TRANSACTIONS — paid vote purchases; one per payment attempt
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vote_transactions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id             uuid NOT NULL REFERENCES public.contests(id),
  contestant_id          uuid NOT NULL,
  voter_profile_id       uuid REFERENCES public.voter_profiles(id),
  voter_user_id          uuid REFERENCES auth.users(id),
  vote_package_id        uuid REFERENCES public.vote_packages(id),
  payment_provider       text NOT NULL DEFAULT 'paystack',
  payment_reference      text NOT NULL UNIQUE,                   -- our reference
  provider_reference     text,                                   -- provider's own ref
  amount_expected        numeric(12,2) NOT NULL,
  amount_paid            numeric(12,2),
  currency               text NOT NULL DEFAULT 'NGN',
  votes_purchased        integer NOT NULL,
  bonus_votes            integer NOT NULL DEFAULT 0,
  total_votes_to_credit  integer NOT NULL,
  payment_status         text NOT NULL DEFAULT 'pending'
                           CHECK (payment_status IN ('pending','successful','failed','abandoned','refunded','chargeback')),
  vote_credit_status     text NOT NULL DEFAULT 'pending'
                           CHECK (vote_credit_status IN ('pending','credited','skipped','reversed')),
  idempotency_key        text UNIQUE,                            -- prevents double-credit
  voter_email            text,
  voter_name             text,
  metadata               jsonb NOT NULL DEFAULT '{}'::jsonb,
  paid_at                timestamptz,
  verified_at            timestamptz,
  credited_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- PAYMENT WEBHOOK LOGS — raw webhook receipts for idempotency & audit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_webhook_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider         text NOT NULL,
  event_type       text NOT NULL,
  reference        text NOT NULL,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed        boolean NOT NULL DEFAULT false,
  error_message    text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- VOTE TOTALS — pre-aggregated counters; updated atomically
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vote_totals (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id              uuid NOT NULL REFERENCES public.contests(id),
  contestant_id           uuid NOT NULL,
  round_id                uuid,
  free_votes              bigint NOT NULL DEFAULT 0,
  paid_votes              bigint NOT NULL DEFAULT 0,
  bonus_votes             bigint NOT NULL DEFAULT 0,
  admin_adjustment_votes  bigint NOT NULL DEFAULT 0,
  reversed_votes          bigint NOT NULL DEFAULT 0,
  quarantined_votes       bigint NOT NULL DEFAULT 0,
  total_confirmed_votes   bigint NOT NULL DEFAULT 0,
  rank                    integer,
  last_vote_at            timestamptz,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE(contest_id, contestant_id, round_id)
);

-- ---------------------------------------------------------------------------
-- VOTER DAILY LIMITS — tracks per-voter free-vote usage per day
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.voter_daily_limits (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id              uuid NOT NULL REFERENCES public.contests(id),
  voter_identifier        text NOT NULL,                         -- user_id | email | phone | device | ip
  voter_identifier_type   text NOT NULL
                            CHECK (voter_identifier_type IN ('user','email','phone','device','ip','session')),
  vote_date               date NOT NULL,
  free_votes_used         integer NOT NULL DEFAULT 0,
  free_votes_limit        integer NOT NULL DEFAULT 3,
  last_vote_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE(contest_id, voter_identifier, voter_identifier_type, vote_date)
);

-- ---------------------------------------------------------------------------
-- CONTESTANT SHARE LINKS — unique public URL + QR per contestant per contest
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contestant_share_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id       uuid NOT NULL REFERENCES public.contests(id),
  contestant_id    uuid NOT NULL,
  share_code       text NOT NULL UNIQUE,                         -- e.g. SPT238
  share_url        text NOT NULL,
  qr_code_url      text,
  click_count      bigint NOT NULL DEFAULT 0,
  vote_count       bigint NOT NULL DEFAULT 0,
  paid_vote_count  bigint NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(contest_id, contestant_id)
);

-- ---------------------------------------------------------------------------
-- CONTESTANT SHARE EVENTS — click/share analytics
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contestant_share_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_link_id   uuid NOT NULL REFERENCES public.contestant_share_links(id) ON DELETE CASCADE,
  event_type      text NOT NULL CHECK (event_type IN ('click','share','vote','paid_vote')),
  channel         text,                                          -- whatsapp | instagram | twitter | direct
  ip_address      inet,
  user_agent      text,
  referrer        text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- LEADERBOARD SNAPSHOTS — periodic immutable snapshots for history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leaderboard_snapshots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id     uuid NOT NULL REFERENCES public.contests(id),
  round_id       uuid,
  snapshot_at    timestamptz NOT NULL DEFAULT now(),
  is_final       boolean NOT NULL DEFAULT false,
  snapshot_data  jsonb NOT NULL DEFAULT '[]'::jsonb               -- ranked array
);

-- ---------------------------------------------------------------------------
-- FRAUD FLAGS — one flag per suspicious vote/voter/transaction
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fraud_flags (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id      uuid NOT NULL REFERENCES public.contests(id),
  contestant_id   uuid,
  voter_profile_id uuid REFERENCES public.voter_profiles(id),
  vote_id         uuid REFERENCES public.votes(id),
  transaction_id  uuid REFERENCES public.vote_transactions(id),
  flag_type       text NOT NULL
                    CHECK (flag_type IN (
                      'duplicate_ip','duplicate_device','bot_speed','vote_spike',
                      'suspicious_payment','duplicate_webhook','self_vote',
                      'disposable_email','vpn_proxy','suspicious_phone','location_mismatch',
                      'high_volume_account','vote_farming'
                    )),
  severity        text NOT NULL DEFAULT 'medium'
                    CHECK (severity IN ('low','medium','high','critical')),
  description     text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','under_review','resolved','dismissed','actioned')),
  action_taken    text,
  reviewed_by     uuid REFERENCES auth.users(id),
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- Ensure voter_profile_id exists on the already-created fraud_flags table.
ALTER TABLE public.fraud_flags
  ADD COLUMN IF NOT EXISTS voter_profile_id uuid REFERENCES public.voter_profiles(id);

-- ---------------------------------------------------------------------------
-- VOTE AUDIT LOGS — append-only; every vote-state change recorded here
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vote_audit_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id          text NOT NULL,                               -- user_id or 'system'
  actor_role        text NOT NULL,
  action            text NOT NULL,
  entity_type       text NOT NULL,
  entity_id         uuid NOT NULL,
  contest_id        uuid REFERENCES public.contests(id),
  contestant_id     uuid,
  old_value         jsonb,
  new_value         jsonb,
  reason            text,
  ip_address        inet,
  device_fingerprint text,
  user_agent        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- ADMIN VOTE ADJUSTMENTS — manual changes requiring approval trail
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_vote_adjustments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id      uuid NOT NULL REFERENCES public.contests(id),
  contestant_id   uuid NOT NULL,
  admin_id        uuid NOT NULL REFERENCES auth.users(id),
  approved_by     uuid REFERENCES auth.users(id),
  adjustment_type text NOT NULL
                    CHECK (adjustment_type IN ('add','subtract','reverse','quarantine','restore')),
  vote_quantity   integer NOT NULL,
  reason          text NOT NULL,
  before_total    bigint NOT NULL,
  after_total     bigint NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','applied')),
  applied_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- VOTE RECEIPTS — issued after successful paid vote
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vote_receipts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id   uuid NOT NULL REFERENCES public.vote_transactions(id),
  contest_id       uuid NOT NULL REFERENCES public.contests(id),
  contestant_id    uuid NOT NULL,
  voter_email      text,
  voter_name       text,
  receipt_number   text NOT NULL UNIQUE,
  votes_purchased  integer NOT NULL,
  bonus_votes      integer NOT NULL DEFAULT 0,
  amount_paid      numeric(12,2) NOT NULL,
  currency         text NOT NULL DEFAULT 'NGN',
  payment_ref      text NOT NULL,
  issued_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- VOTING ROUNDS — supports multi-round voting per contest
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.voting_rounds (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id            uuid NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  slug                  text NOT NULL,
  round_number          integer NOT NULL DEFAULT 1,
  round_type            text NOT NULL DEFAULT 'standard'
                          CHECK (round_type IN (
                            'prequalification','top50','top20','top10','eviction',
                            'wildcard','finale','fan_favorite','sponsor','standard'
                          )),
  voting_type           text NOT NULL DEFAULT 'hybrid'
                          CHECK (voting_type IN ('free','paid','hybrid')),
  free_votes_per_day    integer,                                 -- overrides contest default
  carry_forward_votes   boolean NOT NULL DEFAULT false,
  reset_votes           boolean NOT NULL DEFAULT false,
  vote_weight           numeric(5,2) NOT NULL DEFAULT 1.0,
  judge_score_weight    numeric(5,2) NOT NULL DEFAULT 0.0,
  public_vote_weight    numeric(5,2) NOT NULL DEFAULT 1.0,
  elimination_count     integer,
  qualification_count   integer,
  status                text NOT NULL DEFAULT 'upcoming'
                          CHECK (status IN ('upcoming','active','closed','results_published')),
  starts_at             timestamptz,
  ends_at               timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE(contest_id, slug)
);

-- ---------------------------------------------------------------------------
-- INDEXES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS votes_contest_contestant_idx
  ON public.votes (contest_id, contestant_id);
CREATE INDEX IF NOT EXISTS votes_status_idx
  ON public.votes (vote_status);
CREATE INDEX IF NOT EXISTS votes_voter_profile_idx
  ON public.votes (voter_profile_id);
CREATE INDEX IF NOT EXISTS votes_created_at_idx
  ON public.votes (created_at DESC);
CREATE INDEX IF NOT EXISTS votes_fraud_status_idx
  ON public.votes (fraud_status) WHERE fraud_status != 'clean';

CREATE INDEX IF NOT EXISTS vote_transactions_reference_idx
  ON public.vote_transactions (payment_reference);
CREATE INDEX IF NOT EXISTS vote_transactions_status_idx
  ON public.vote_transactions (payment_status);
CREATE INDEX IF NOT EXISTS vote_transactions_contest_idx
  ON public.vote_transactions (contest_id);

CREATE INDEX IF NOT EXISTS vote_totals_contest_rank_idx
  ON public.vote_totals (contest_id, rank NULLS LAST);
CREATE INDEX IF NOT EXISTS vote_totals_contestant_idx
  ON public.vote_totals (contestant_id);

CREATE INDEX IF NOT EXISTS voter_daily_limits_lookup_idx
  ON public.voter_daily_limits (contest_id, voter_identifier, voter_identifier_type, vote_date);

CREATE INDEX IF NOT EXISTS fraud_flags_contest_idx
  ON public.fraud_flags (contest_id, status);
CREATE INDEX IF NOT EXISTS fraud_flags_voter_idx
  ON public.fraud_flags (voter_profile_id);

CREATE INDEX IF NOT EXISTS vote_audit_logs_entity_idx
  ON public.vote_audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS vote_audit_logs_contest_idx
  ON public.vote_audit_logs (contest_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payment_webhook_logs_ref_idx
  ON public.payment_webhook_logs (reference, provider);

-- ---------------------------------------------------------------------------
-- UPDATED_AT TRIGGERS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'voting_settings','vote_packages','voter_profiles','vote_transactions',
    'vote_totals','voter_daily_limits','contestant_share_links','voting_rounds',
    'admin_vote_adjustments'
  ]) LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON public.%1$s;
       CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$s
       FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- ROW-LEVEL SECURITY
-- ---------------------------------------------------------------------------
ALTER TABLE public.voting_settings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vote_packages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voter_profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vote_transactions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhook_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vote_totals             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voter_daily_limits      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contestant_share_links  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contestant_share_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaderboard_snapshots   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fraud_flags             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vote_audit_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_vote_adjustments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vote_receipts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voting_rounds           ENABLE ROW LEVEL SECURITY;

-- Public can read published voting settings, packages, totals, leaderboard, share links
CREATE POLICY voting_settings_public_read ON public.voting_settings
  FOR SELECT USING (status = 'active');

CREATE POLICY vote_packages_public_read ON public.vote_packages
  FOR SELECT USING (is_active = true);

CREATE POLICY vote_totals_public_read ON public.vote_totals
  FOR SELECT USING (true);

CREATE POLICY leaderboard_snapshots_public_read ON public.leaderboard_snapshots
  FOR SELECT USING (true);

CREATE POLICY contestant_share_links_public_read ON public.contestant_share_links
  FOR SELECT USING (true);

CREATE POLICY voting_rounds_public_read ON public.voting_rounds
  FOR SELECT USING (status IN ('active','results_published'));

-- Voters can read and write their own profiles
CREATE POLICY voter_profiles_own ON public.voter_profiles
  FOR ALL USING (user_id = auth.uid());

-- Voters can read their own daily limits
CREATE POLICY voter_daily_limits_own ON public.voter_daily_limits
  FOR SELECT USING (voter_identifier = auth.uid()::text);

-- Voters can read their own transactions
CREATE POLICY vote_transactions_own ON public.vote_transactions
  FOR SELECT USING (voter_user_id = auth.uid());

-- Voters can read their own receipts
CREATE POLICY vote_receipts_own ON public.vote_receipts
  FOR SELECT USING (voter_email = (
    SELECT email FROM auth.users WHERE id = auth.uid()
  ));

-- Service role / admin bypass (all tables)
-- The API layer uses service-role client for all admin & webhook writes.

COMMIT;
