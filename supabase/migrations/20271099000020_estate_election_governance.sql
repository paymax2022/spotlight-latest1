-- estate-b UAT Phase 2.2 — election governance (EST-UAT-0203/0204/0205/0208/0209/0210/0211/
-- 0219/0221/0223/0225/0227/0229/0230; defect ESTB-D014).
--
-- The election domain had a ballot and an eligibility switch, and nothing else: no roll that
-- could be published or challenged, no nomination lifecycle, no quorum or tie-break rule, no
-- complaint/recount entity, no cancellation, no poll type. Each gap was a P0 UAT row that could
-- only be closed by building the entity, so this migration adds them additively.
--
-- Secrets rule carried forward from 20271099000010: nothing written here may create a column
-- that joins a voter to a choice. The one relaxation is on the PARTICIPATION table
-- (election_votes), which stores no choice at all, to let a multi-unit owner appear once per
-- unit (EST-UAT-0205).
--
-- Deliberately NOT implemented (see EST-UAT-0222): ranked-choice / multi-seat ballots. Both
-- need the tabulator to know a voter's ordered or repeated selections, i.e. a persisted
-- voter→choice link, which is exactly what EST-UAT-0216 (PASSED) forbids.

BEGIN;

-- ---------------------------------------------------------------- 1. election configuration
ALTER TABLE elections
    ADD COLUMN IF NOT EXISTS kind                 text NOT NULL DEFAULT 'binding'
        CHECK (kind IN ('binding', 'poll')),
    ADD COLUMN IF NOT EXISTS weighting            text NOT NULL DEFAULT 'one_person_one_vote'
        CHECK (weighting IN ('one_person_one_vote', 'one_vote_per_unit')),
    ADD COLUMN IF NOT EXISTS quorum_type          text NOT NULL DEFAULT 'none'
        CHECK (quorum_type IN ('none', 'percent', 'count')),
    ADD COLUMN IF NOT EXISTS quorum_value         int  NOT NULL DEFAULT 0
        CHECK (quorum_value >= 0),
    ADD COLUMN IF NOT EXISTS tie_break            text NOT NULL DEFAULT 'none'
        CHECK (tie_break IN ('none', 'earliest_candidate', 'runoff')),
    ADD COLUMN IF NOT EXISTS nomination_opens_at  timestamptz,
    ADD COLUMN IF NOT EXISTS nomination_closes_at timestamptz,
    ADD COLUMN IF NOT EXISTS roll_frozen_at       timestamptz,
    ADD COLUMN IF NOT EXISTS rules_locked_at      timestamptz,
    ADD COLUMN IF NOT EXISTS cancelled_at         timestamptz,
    ADD COLUMN IF NOT EXISTS cancelled_by         uuid REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS cancellation_reason  text;

-- EST-UAT-0229 needs a terminal 'cancelled' status. Replacing a CHECK is not additive, but the
-- replacement is strictly wider (the old four values plus 'cancelled'), so no row can newly
-- violate it; the drop is wrapped so a re-run is a no-op.
ALTER TABLE elections DROP CONSTRAINT IF EXISTS elections_status_check;
ALTER TABLE elections ADD CONSTRAINT elections_status_check
    CHECK (status IN ('draft', 'open', 'closed', 'tallied', 'cancelled'));

-- A cancelled election must carry its reason (0229: cancellation is an audited act, not a delete).
ALTER TABLE elections DROP CONSTRAINT IF EXISTS elections_cancellation_has_reason;
ALTER TABLE elections ADD CONSTRAINT elections_cancellation_has_reason CHECK (
    status <> 'cancelled'
    OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
        AND char_length(btrim(coalesce(cancellation_reason, ''))) >= 5)
);

-- Nomination windows must be sane when present (0209/0210).
ALTER TABLE elections DROP CONSTRAINT IF EXISTS elections_nomination_window_ordered;
ALTER TABLE elections ADD CONSTRAINT elections_nomination_window_ordered CHECK (
    nomination_opens_at IS NULL OR nomination_closes_at IS NULL
    OR nomination_closes_at > nomination_opens_at
);

-- ---------------------------------------------------------------- 2. rule approval (0203)
-- The in-force row stays where it is, so every election configured before this migration keeps
-- behaving identically. Approval is a separate proposal object.
ALTER TABLE election_eligibility_rules
    ADD COLUMN IF NOT EXISTS rule_version int NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS approved_by  uuid REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS approved_at  timestamptz;

CREATE TABLE IF NOT EXISTS election_rule_proposals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id     UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    require_kyc     boolean NOT NULL DEFAULT false,
    require_payment boolean NOT NULL DEFAULT false,
    resident_types  text[]  NOT NULL DEFAULT '{}',
    proposed_by     uuid REFERENCES auth.users(id),
    proposed_at     timestamptz NOT NULL DEFAULT now(),
    state           text NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'approved', 'rejected', 'withdrawn')),
    decided_by      uuid REFERENCES auth.users(id),
    decided_at      timestamptz,
    decision_note   text
);
-- One live proposal per election: an admin editing twice before approval replaces one draft.
CREATE UNIQUE INDEX IF NOT EXISTS election_rule_proposals_one_pending
    ON election_rule_proposals (election_id) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS election_rule_proposals_election
    ON election_rule_proposals (election_id, proposed_at DESC);

-- ---------------------------------------------------------------- 3. electoral roll (0204/0208/0219)
CREATE TABLE IF NOT EXISTS election_rolls (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id    UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    version        int  NOT NULL DEFAULT 1,
    status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'frozen')),
    built_by       uuid REFERENCES auth.users(id),
    built_at       timestamptz NOT NULL DEFAULT now(),
    frozen_by      uuid REFERENCES auth.users(id),
    frozen_at      timestamptz,
    eligible_count int  NOT NULL DEFAULT 0,
    UNIQUE (election_id, version)
);

CREATE TABLE IF NOT EXISTS election_roll_entries (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    roll_id        UUID NOT NULL REFERENCES election_rolls(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- EST-UAT-0205: a one_vote_per_unit election gives a holder one ballot per unit held.
    weight         int  NOT NULL DEFAULT 1 CHECK (weight >= 1),
    source         text NOT NULL DEFAULT 'built' CHECK (source IN ('built', 'exception')),
    status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
    removed_by     uuid REFERENCES auth.users(id),
    removed_at     timestamptz,
    removal_reason text,
    UNIQUE (roll_id, user_id)
);
CREATE INDEX IF NOT EXISTS election_roll_entries_roll ON election_roll_entries (roll_id, status);

CREATE TABLE IF NOT EXISTS election_roll_challenges (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id     UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    roll_id         UUID NOT NULL REFERENCES election_rolls(id) ON DELETE CASCADE,
    subject_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    raised_by       UUID NOT NULL REFERENCES auth.users(id),
    reason          text NOT NULL CHECK (char_length(btrim(reason)) >= 5),
    state           text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'upheld', 'rejected')),
    resolved_by     uuid REFERENCES auth.users(id),
    resolved_at     timestamptz,
    resolution      text,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS election_roll_challenges_open
    ON election_roll_challenges (election_id, created_at DESC);

-- ---------------------------------------------------------------- 4. nominations (0209/0210/0211)
CREATE TABLE IF NOT EXISTS election_nominations (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id      UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    nominee_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    nominated_by     UUID NOT NULL REFERENCES auth.users(id),
    seat             text,
    statement        text,
    state            text NOT NULL DEFAULT 'nominated'
        CHECK (state IN ('nominated', 'accepted', 'declined', 'withdrawn', 'rejected', 'certified')),
    vetting_state    text NOT NULL DEFAULT 'pending'
        CHECK (vetting_state IN ('pending', 'cleared', 'flagged')),
    decided_by       uuid REFERENCES auth.users(id),
    decided_at       timestamptz,
    reason           text,
    -- Set only when an accepted + cleared nomination is certified onto the ballot.
    candidate_id     uuid REFERENCES election_candidates(id) ON DELETE SET NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (election_id, nominee_user_id)
);
CREATE INDEX IF NOT EXISTS election_nominations_election
    ON election_nominations (election_id, state);
-- A certified nomination owns exactly one ballot line.
CREATE UNIQUE INDEX IF NOT EXISTS election_nominations_one_candidate
    ON election_nominations (candidate_id) WHERE candidate_id IS NOT NULL;

-- ---------------------------------------------------------------- 5. complaints + recounts (0227)
CREATE TABLE IF NOT EXISTS election_complaints (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    raised_by   UUID NOT NULL REFERENCES auth.users(id),
    kind        text NOT NULL DEFAULT 'complaint' CHECK (kind IN ('complaint', 'recount')),
    detail      text NOT NULL CHECK (char_length(btrim(detail)) >= 5),
    state       text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'upheld', 'dismissed')),
    resolved_by uuid REFERENCES auth.users(id),
    resolved_at timestamptz,
    resolution  text,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS election_complaints_open ON election_complaints (election_id, created_at DESC);

-- A recount stores aggregate totals only. jsonb here is built from election_ballots counts, so
-- there is no way for a recount snapshot to smuggle a voter→choice link back in.
CREATE TABLE IF NOT EXISTS election_recounts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id  UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    requested_by uuid REFERENCES auth.users(id),
    complaint_id uuid REFERENCES election_complaints(id) ON DELETE SET NULL,
    tallied_at   timestamptz NOT NULL DEFAULT now(),
    totals       jsonb NOT NULL,
    ballots_cast int  NOT NULL DEFAULT 0,
    abstentions  int  NOT NULL DEFAULT 0,
    note         text
);

-- ---------------------------------------------------------------- 6. weighted participation (0205)
-- election_votes stores no choice (since 20271099000010), so letting a row carry the UNIT that
-- authorised it adds no linkage between a voter and a selection. The old unconditional
-- UNIQUE(election_id, voter_id) is replaced by two partial uniques whose predicates cover the
-- same ground for every row that exists today (all have unit_id IS NULL):
--   * one_person_one_vote  -> still exactly one row per (election, voter)
--   * one_vote_per_unit    -> one row per (election, unit), so a multi-unit holder votes once per
--                             unit they hold and twice for nothing.
ALTER TABLE election_votes
    ADD COLUMN IF NOT EXISTS unit_id uuid REFERENCES estate_properties(id) ON DELETE CASCADE;

ALTER TABLE election_votes DROP CONSTRAINT IF EXISTS election_votes_election_id_voter_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS election_votes_one_per_voter
    ON election_votes (election_id, voter_id) WHERE unit_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS election_votes_one_per_unit
    ON election_votes (election_id, unit_id) WHERE unit_id IS NOT NULL;

-- ---------------------------------------------------------------- 7. one write path, upgraded
-- estate_cast_vote(voter, candidate) is kept for single-ballot callers and delegates here. The
-- 4-arg form takes the unit that authorises the ballot (NULL for one_person_one_vote) and
-- enforces, in the statement that writes, everything the UAT rows ask for:
--   * election must exist, be 'open', inside its window and not cancelled        (0229)
--   * candidate, if given, must belong to the election; NULL is an abstention     (0221)
--   * a frozen roll must contain an ACTIVE entry for the voter                    (0204/0219)
--   * weighting: a unit ballot requires the voter to hold that unit               (0205)
--   * replay raises 23505, exactly as before                                      (0213)
CREATE OR REPLACE FUNCTION estate_cast_vote(
    p_election_id  UUID,
    p_voter_id     UUID,
    p_candidate_id UUID,
    p_unit_id      UUID
) RETURNS TABLE (ballot_id UUID, participation_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status     text;
    v_starts_at  timestamptz;
    v_ends_at    timestamptz;
    v_weighting  text;
    v_new_part   UUID;
    v_ballot     UUID;
    v_on_roll    boolean;
BEGIN
    SELECT e.status, e.starts_at, e.ends_at, e.weighting
      INTO v_status, v_starts_at, v_ends_at, v_weighting
    FROM elections e WHERE e.id = p_election_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'election not found' USING ERRCODE = '23503';
    END IF;
    IF v_status = 'cancelled' THEN
        RAISE EXCEPTION 'election has been cancelled' USING ERRCODE = '42501';
    END IF;
    IF v_status <> 'open' OR now() < v_starts_at OR now() >= v_ends_at THEN
        RAISE EXCEPTION 'election is not open for voting' USING ERRCODE = '55000';
    END IF;

    IF p_candidate_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM election_candidates ec
        WHERE ec.id = p_candidate_id AND ec.election_id = p_election_id
    ) THEN
        RAISE EXCEPTION 'candidate does not belong to this election'
            USING ERRCODE = '23503';
    END IF;

    -- Frozen roll wins over membership heuristics: being on the published roll is the right to
    -- vote, and removing the entry is how that right is taken away mid-poll (0219). A roll that
    -- has not been frozen yet constrains nothing, which keeps elections configured before this
    -- migration working unchanged.
    SELECT EXISTS (
        SELECT 1
        FROM election_rolls r
        JOIN election_roll_entries en ON en.roll_id = r.id
        WHERE r.election_id = p_election_id
          AND r.status = 'frozen'
          AND r.version = (SELECT MAX(version) FROM election_rolls
                           WHERE election_id = p_election_id AND status = 'frozen')
          AND en.user_id = p_voter_id
          AND en.status = 'active'
    ) INTO v_on_roll;

    IF EXISTS (SELECT 1 FROM election_rolls
               WHERE election_id = p_election_id AND status = 'frozen')
       AND NOT v_on_roll THEN
        RAISE EXCEPTION 'voter is not on the frozen electoral roll'
            USING ERRCODE = '42501';
    END IF;

    IF v_weighting = 'one_vote_per_unit' THEN
        IF p_unit_id IS NULL THEN
            RAISE EXCEPTION 'this election counts one vote per unit held; unit is required'
                USING ERRCODE = '23514';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM estate_properties p
            WHERE p.id = p_unit_id AND p.archived = FALSE
              AND (p.landlord_id = p_voter_id OR p.tenant_id = p_voter_id)
        ) THEN
            RAISE EXCEPTION 'voter does not hold this unit' USING ERRCODE = '23514';
        END IF;
    ELSIF p_unit_id IS NOT NULL THEN
        RAISE EXCEPTION 'this election is one person, one vote' USING ERRCODE = '23514';
    END IF;

    IF p_unit_id IS NOT NULL THEN
        INSERT INTO election_votes (id, election_id, voter_id, candidate_id, unit_id)
        VALUES (gen_random_uuid(), p_election_id, p_voter_id, NULL, p_unit_id)
        ON CONFLICT (election_id, unit_id) WHERE unit_id IS NOT NULL DO NOTHING
        RETURNING id INTO v_new_part;
    ELSE
        INSERT INTO election_votes (id, election_id, voter_id, candidate_id, unit_id)
        VALUES (gen_random_uuid(), p_election_id, p_voter_id, NULL, NULL)
        ON CONFLICT (election_id, voter_id) WHERE unit_id IS NULL DO NOTHING
        RETURNING id INTO v_new_part;
    END IF;

    IF v_new_part IS NULL THEN
        RAISE EXCEPTION 'this ballot has already been cast' USING ERRCODE = '23505';
    END IF;

    INSERT INTO election_ballots (election_id, candidate_id)
    VALUES (p_election_id, p_candidate_id)
    RETURNING id INTO v_ballot;

    RETURN QUERY SELECT v_ballot, v_new_part;
END;
$$;

CREATE OR REPLACE FUNCTION estate_cast_vote(
    p_election_id  UUID,
    p_voter_id     UUID,
    p_candidate_id UUID
) RETURNS TABLE (ballot_id UUID, participation_id UUID)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT ballot_id, participation_id
    FROM estate_cast_vote(p_election_id, p_voter_id, p_candidate_id, NULL::uuid);
$$;

REVOKE ALL ON FUNCTION estate_cast_vote(UUID, UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION estate_cast_vote(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION estate_cast_vote(UUID, UUID, UUID, UUID) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION estate_cast_vote(UUID, UUID, UUID) TO service_role, authenticated;

-- ---------------------------------------------------------------- 8. row level security
-- Every governance object is estate-private and written through the service role only; nothing
-- here is a resident-readable surface, and the roll/challenge/complaint rows name residents, so
-- leaving RLS off would expose them through PostgREST.
ALTER TABLE election_rule_proposals  ENABLE ROW LEVEL SECURITY;
ALTER TABLE election_rolls           ENABLE ROW LEVEL SECURITY;
ALTER TABLE election_roll_entries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE election_roll_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE election_nominations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE election_complaints      ENABLE ROW LEVEL SECURITY;
ALTER TABLE election_recounts        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS governance_service ON election_rule_proposals;
CREATE POLICY governance_service ON election_rule_proposals TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS governance_service ON election_rolls;
CREATE POLICY governance_service ON election_rolls TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS governance_service ON election_roll_entries;
CREATE POLICY governance_service ON election_roll_entries TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS governance_service ON election_roll_challenges;
CREATE POLICY governance_service ON election_roll_challenges TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS governance_service ON election_nominations;
CREATE POLICY governance_service ON election_nominations TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS governance_service ON election_complaints;
CREATE POLICY governance_service ON election_complaints TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS governance_service ON election_recounts;
CREATE POLICY governance_service ON election_recounts TO service_role USING (true) WITH CHECK (true);

COMMIT;
