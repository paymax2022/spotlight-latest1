-- Spotlight Rising Star — Prize Management, Multiple Winners & Contest Rules
-- (ADDITIONAL MASTER REQUIREMENTS §7 data model).
--
-- The Rising Star "edition" IS a public.connect_contests row — the same plane
-- registrations and voting already resolve through (see repo.go's roster query
-- and 20261223000000_connect_contests_bridge.sql). Every entity below keys off
-- connect_contests(id), NOT the legacy public.contests table, so an edition is
-- the single central configuration unit controlling its prizes, winning
-- positions, rules, winner-selection methodology and declared winners.
--
-- Additive only: no DROP, no renames, no type narrowing. The two new columns on
-- connect_contests have defaults so existing rows (and the bridge/mirror
-- triggers that write them) are unaffected.
--
-- Existing structured prizes (public.voting_contest_prizes, position/description/
-- value_kobo) are LEFT ALONE and remain the mobile ladder read. edition_prizes
-- below is the richer, configurable model the requirements ask for (cash +
-- non-cash + currency + fulfilment conditions + presentation timing, attached to
-- a named winning position). They coexist deliberately: nothing that reads
-- voting_contest_prizes changes shape.

-- ════════════════════════════════════════════════════════════════════════════
-- 0. connect_contests — edition-level winner configuration (additive columns)
-- ════════════════════════════════════════════════════════════════════════════

-- winner_methodology: how this edition determines its winners. Configurable per
-- edition; never auto-derived from registration order, views, popularity or vote
-- counts (§2). The CHECK is an allowlist so an unknown methodology is rejected at
-- the door rather than silently stored.
ALTER TABLE public.connect_contests
  ADD COLUMN IF NOT EXISTS winner_methodology text NOT NULL DEFAULT 'administrative_selection'
    CHECK (winner_methodology IN
      ('public_voting','judges_evaluation','administrative_selection',
       'combined_voting_judges','panel_evaluation','other'));

-- results_status: the deliberate, auditable winner-declaration lifecycle (§2).
-- Starts 'not_declared'; only an admin action moves it forward. Winners are shown
-- publicly only once it reaches 'results_published' (or later fulfilment states).
ALTER TABLE public.connect_contests
  ADD COLUMN IF NOT EXISTS results_status text NOT NULL DEFAULT 'not_declared'
    CHECK (results_status IN
      ('not_declared','finalists_announced','winners_declared',
       'results_published','prize_fulfilment_in_progress','prizes_fulfilled'));

-- ════════════════════════════════════════════════════════════════════════════
-- 1. edition_winning_positions — WinningPosition (§7)
--    The configurable ladder of award slots for an edition: 1st Place, 1st
--    Runner-Up, 2nd Runner-Up, … an admin can add/remove/rename/reorder these and
--    allow joint winners via recipients_allowed > 1 (§1).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.edition_winning_positions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connect_contest_id uuid NOT NULL REFERENCES public.connect_contests(id) ON DELETE CASCADE,
  title              text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  -- rank is the ordinal (1 = top). display_order allows visual reordering that
  -- need not match rank; both default to the same intent.
  rank               int  NOT NULL CHECK (rank > 0),
  display_order      int  NOT NULL DEFAULT 0,
  recipients_allowed int  NOT NULL DEFAULT 1 CHECK (recipients_allowed > 0),
  is_active          boolean NOT NULL DEFAULT true,
  created_by         uuid REFERENCES public.user_profiles(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connect_contest_id, rank)
);
CREATE INDEX IF NOT EXISTS idx_edition_winning_positions_contest
  ON public.edition_winning_positions (connect_contest_id, display_order, rank);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. edition_prizes — EditionPrize (§7)
--    One prize line attached to a winning position. prize_type distinguishes
--    cash / non_cash / package (a package combines both into one award, §1).
--    amount_kobo is the cash component (NULL for pure non-cash); currency lets an
--    edition award NGN, USD or another supported currency.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.edition_prizes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connect_contest_id     uuid NOT NULL REFERENCES public.connect_contests(id) ON DELETE CASCADE,
  position_id            uuid REFERENCES public.edition_winning_positions(id) ON DELETE SET NULL,
  prize_type             text NOT NULL DEFAULT 'cash'
                           CHECK (prize_type IN ('cash','non_cash','package')),
  title                  text NOT NULL DEFAULT '' CHECK (char_length(title) <= 200),
  amount_kobo            bigint CHECK (amount_kobo IS NULL OR amount_kobo >= 0),
  currency               text NOT NULL DEFAULT 'NGN' CHECK (char_length(currency) BETWEEN 3 AND 8),
  description            text NOT NULL DEFAULT '',
  fulfilment_conditions  text NOT NULL DEFAULT '',
  -- when the prize will be presented or delivered (§1)
  presentation_timing    text NOT NULL DEFAULT '',
  display_order          int  NOT NULL DEFAULT 0,
  is_active              boolean NOT NULL DEFAULT true,
  created_by             uuid REFERENCES public.user_profiles(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_edition_prizes_contest
  ON public.edition_prizes (connect_contest_id, display_order);
CREATE INDEX IF NOT EXISTS idx_edition_prizes_position
  ON public.edition_prizes (position_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. edition_rules — EditionRules (§7, §4)
--    Versioned rules & regulations for an edition. content is the structured
--    rule set (sections A–I of §4) as JSONB so an admin can configure any subset
--    per edition "without requiring a new application release" and without the
--    schema hardcoding which restrictions apply. Only one version is 'published'
--    at a time; superseded versions stay for the immutable acceptance history.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.edition_rules (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connect_contest_id uuid NOT NULL REFERENCES public.connect_contests(id) ON DELETE CASCADE,
  version            int  NOT NULL CHECK (version > 0),
  content            jsonb NOT NULL DEFAULT '{}'::jsonb,
  status             text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','published','archived')),
  effective_date     timestamptz,
  published_at       timestamptz,
  created_by         uuid REFERENCES public.user_profiles(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connect_contest_id, version)
);
CREATE INDEX IF NOT EXISTS idx_edition_rules_contest_status
  ON public.edition_rules (connect_contest_id, status);
-- At most one published version per edition.
CREATE UNIQUE INDEX IF NOT EXISTS uq_edition_rules_one_published
  ON public.edition_rules (connect_contest_id) WHERE status = 'published';

-- ════════════════════════════════════════════════════════════════════════════
-- 4. contestant_rules_acceptance — ContestantRulesAcceptance (§7, §5)
--    The immutable record that a registrant accepted a SPECIFIC rules version.
--    rules_version is denormalised from edition_rules so the accepted version
--    survives even if the rules row is later archived/changed (§5: "do not
--    silently replace the version the contestant originally accepted").
--
--    At registration-submit time the applicant is a USER with an application, not
--    yet a promoted `contestants` row, so acceptance keys on user_id (§5: capture
--    User ID, Edition ID, Rules version, timestamp). application_id records the
--    registration application it was captured against; contestant_id is filled
--    later when the applicant is promoted to the roster (nullable, SET NULL so a
--    roster cleanup never erases the acceptance history).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.contestant_rules_acceptance (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id     uuid,
  contestant_id      uuid REFERENCES public.contestants(id) ON DELETE SET NULL,
  connect_contest_id uuid NOT NULL REFERENCES public.connect_contests(id) ON DELETE CASCADE,
  rules_id           uuid NOT NULL REFERENCES public.edition_rules(id) ON DELETE RESTRICT,
  rules_version      int  NOT NULL,
  accepted_at        timestamptz NOT NULL DEFAULT now(),
  -- one acceptance per user per edition per rules version
  UNIQUE (user_id, connect_contest_id, rules_id)
);
CREATE INDEX IF NOT EXISTS idx_contestant_rules_acceptance_contest
  ON public.contestant_rules_acceptance (connect_contest_id);
CREATE INDEX IF NOT EXISTS idx_contestant_rules_acceptance_user
  ON public.contestant_rules_acceptance (user_id);
CREATE INDEX IF NOT EXISTS idx_contestant_rules_acceptance_contestant
  ON public.contestant_rules_acceptance (contestant_id);

-- ════════════════════════════════════════════════════════════════════════════
-- 5. edition_winners — EditionWinner (§7, §2)
--    A declared winner: a contestant assigned to a winning position. Multiple
--    rows may share a position_id where that position allows joint winners
--    (recipients_allowed > 1). declaration is a deliberate admin action; the
--    declaring admin and timestamp give the auditable record §2 requires.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.edition_winners (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connect_contest_id     uuid NOT NULL REFERENCES public.connect_contests(id) ON DELETE CASCADE,
  contestant_id          uuid NOT NULL REFERENCES public.contestants(id) ON DELETE CASCADE,
  position_id            uuid REFERENCES public.edition_winning_positions(id) ON DELETE SET NULL,
  is_finalist            boolean NOT NULL DEFAULT false,
  declaration_status     text NOT NULL DEFAULT 'not_declared'
                           CHECK (declaration_status IN
                             ('not_declared','finalist','declared','published','revoked')),
  announcement_date      timestamptz,
  prize_fulfilment_status text NOT NULL DEFAULT 'pending'
                           CHECK (prize_fulfilment_status IN
                             ('pending','in_progress','fulfilled','not_applicable')),
  admin_notes            text NOT NULL DEFAULT '',
  declared_at            timestamptz,
  declared_by            uuid REFERENCES public.user_profiles(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  -- a contestant occupies a given position at most once per edition
  UNIQUE (connect_contest_id, contestant_id, position_id)
);
CREATE INDEX IF NOT EXISTS idx_edition_winners_contest
  ON public.edition_winners (connect_contest_id, declaration_status);
CREATE INDEX IF NOT EXISTS idx_edition_winners_contestant
  ON public.edition_winners (contestant_id);

-- ════════════════════════════════════════════════════════════════════════════
-- updated_at triggers
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.update_rising_star_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS edition_winning_positions_updated_at ON public.edition_winning_positions;
CREATE TRIGGER edition_winning_positions_updated_at
  BEFORE UPDATE ON public.edition_winning_positions
  FOR EACH ROW EXECUTE FUNCTION public.update_rising_star_updated_at();

DROP TRIGGER IF EXISTS edition_prizes_updated_at ON public.edition_prizes;
CREATE TRIGGER edition_prizes_updated_at
  BEFORE UPDATE ON public.edition_prizes
  FOR EACH ROW EXECUTE FUNCTION public.update_rising_star_updated_at();

DROP TRIGGER IF EXISTS edition_rules_updated_at ON public.edition_rules;
CREATE TRIGGER edition_rules_updated_at
  BEFORE UPDATE ON public.edition_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_rising_star_updated_at();

DROP TRIGGER IF EXISTS edition_winners_updated_at ON public.edition_winners;
CREATE TRIGGER edition_winners_updated_at
  BEFORE UPDATE ON public.edition_winners
  FOR EACH ROW EXECUTE FUNCTION public.update_rising_star_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security
--   Admin (role='admin') may manage everything; the public may READ the parts
--   that are meant to be public: positions, prizes, the published rules version,
--   and winners once an edition's results are published. Acceptance rows are
--   private (admin + the owning contestant via the Go service layer, which runs
--   as service-role and bypasses RLS).
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.edition_winning_positions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edition_prizes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edition_rules               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contestant_rules_acceptance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edition_winners             ENABLE ROW LEVEL SECURITY;

-- admin manage (all verbs) on the four config/declaration tables
DROP POLICY IF EXISTS "admin_manage_edition_winning_positions" ON public.edition_winning_positions;
CREATE POLICY "admin_manage_edition_winning_positions" ON public.edition_winning_positions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "admin_manage_edition_prizes" ON public.edition_prizes;
CREATE POLICY "admin_manage_edition_prizes" ON public.edition_prizes
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "admin_manage_edition_rules" ON public.edition_rules;
CREATE POLICY "admin_manage_edition_rules" ON public.edition_rules
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "admin_manage_edition_winners" ON public.edition_winners;
CREATE POLICY "admin_manage_edition_winners" ON public.edition_winners
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin'));

-- acceptances: admin-only over RLS; the registration write path runs service-role.
DROP POLICY IF EXISTS "admin_read_contestant_rules_acceptance" ON public.contestant_rules_acceptance;
CREATE POLICY "admin_read_contestant_rules_acceptance" ON public.contestant_rules_acceptance
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin'));

-- public reads
DROP POLICY IF EXISTS "public_read_edition_winning_positions" ON public.edition_winning_positions;
CREATE POLICY "public_read_edition_winning_positions" ON public.edition_winning_positions
  FOR SELECT TO public USING (is_active);

DROP POLICY IF EXISTS "public_read_edition_prizes" ON public.edition_prizes;
CREATE POLICY "public_read_edition_prizes" ON public.edition_prizes
  FOR SELECT TO public USING (is_active);

DROP POLICY IF EXISTS "public_read_published_edition_rules" ON public.edition_rules;
CREATE POLICY "public_read_published_edition_rules" ON public.edition_rules
  FOR SELECT TO public USING (status = 'published');

-- Winners are publicly readable only once the edition's results are published.
DROP POLICY IF EXISTS "public_read_published_edition_winners" ON public.edition_winners;
CREATE POLICY "public_read_published_edition_winners" ON public.edition_winners
  FOR SELECT TO public USING (
    declaration_status = 'published'
    AND EXISTS (
      SELECT 1 FROM public.connect_contests cc
      WHERE cc.id = connect_contest_id
        AND cc.results_status IN ('results_published','prize_fulfilment_in_progress','prizes_fulfilled')
    )
  );

COMMENT ON TABLE public.edition_rules IS
  'Versioned Rising Star contest rules per edition (connect_contests). Only one '
  'version is published at a time; contestant_rules_acceptance pins the version a '
  'contestant actually agreed to so a later edit never silently replaces it.';
COMMENT ON TABLE public.edition_winners IS
  'Deliberately-declared Rising Star winners per edition. declaration_status and '
  'the connect_contests.results_status lifecycle gate public visibility; winners '
  'are never auto-derived from votes, views or registration order.';
