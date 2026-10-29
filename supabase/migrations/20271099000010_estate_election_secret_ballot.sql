-- estate-b UAT remediation (ESTB-D003 / ESTB-D011: EST-UAT-0213, EST-UAT-0216, EST-UAT-0228).
--
-- election_votes stored (election_id, voter_id, candidate_id) in a single row, so the
-- database permanently linked a resident's identity to their selection: a secret ballot
-- was impossible while both columns shared a table, whatever the API returned.
--
-- This splits the two concerns:
--   election_votes  -> participation registry (who voted, and when) with no choice;
--   election_ballots -> the choice, with no column that could ever identify a voter.
--
-- Additive first, then the link is emptied. Every legacy choice is copied into
-- election_ballots before election_votes.candidate_id is nulled, and the nulling is
-- gated per election on the copy having produced at least as many ballots as there
-- were linked rows — so a partially-applied re-run cannot lose a selection. The column
-- is left in place (nullable) rather than dropped: nothing is destroyed structurally,
-- and a re-point is recoverable if a writer still selects it.

BEGIN;

CREATE TABLE IF NOT EXISTS election_ballots (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id  UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    -- NULL = abstention / blank ballot (EST-UAT-0221).
    candidate_id UUID REFERENCES election_candidates(id) ON DELETE CASCADE
    -- Deliberately no cast_at: the participation row already carries the moment a
    -- voter voted, so a timestamp here would be a join key that rebuilds the
    -- voter→choice link the split exists to break. Same rule as the association
    -- domain (assoc_election_votes, asserted by
    -- backend/tests/association/election_integrity_test.go).
);

CREATE INDEX IF NOT EXISTS idx_election_ballots_election
    ON election_ballots (election_id, candidate_id);

-- There is deliberately no voter column, and no policy that lets a resident read a
-- ballot row: participation is verifiable by the voter, the selection is not.
ALTER TABLE election_ballots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ballots_service ON election_ballots;
CREATE POLICY ballots_service ON election_ballots
    TO service_role USING (true) WITH CHECK (true);

-- 1. Copy the choices out, one pass per election that has no ballots yet.
INSERT INTO election_ballots (election_id, candidate_id)
SELECT ev.election_id, ev.candidate_id
FROM election_votes ev
WHERE ev.candidate_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM election_ballots b WHERE b.election_id = ev.election_id);

-- 2. Only now may the registry stop carrying a choice.
ALTER TABLE election_votes ALTER COLUMN candidate_id DROP NOT NULL;

-- 3. Sever the link where the copy is provably complete for that election.
WITH legacy AS (
    SELECT election_id, COUNT(*) AS linked_rows
    FROM election_votes
    WHERE candidate_id IS NOT NULL
    GROUP BY election_id
), copied AS (
    SELECT election_id, COUNT(*) AS ballots
    FROM election_ballots
    GROUP BY election_id
)
UPDATE election_votes ev
SET candidate_id = NULL
FROM legacy l
JOIN copied c ON c.election_id = l.election_id AND c.ballots >= l.linked_rows
WHERE ev.election_id = l.election_id
  AND ev.candidate_id IS NOT NULL;

-- 4. One atomic write path for both tables, so a participation row can never exist
--    without its ballot (or the reverse) after the split. Raises 23505 on replay,
--    which both the Go service and the BFF already map to "already voted".
CREATE OR REPLACE FUNCTION estate_cast_vote(
    p_election_id  UUID,
    p_voter_id     UUID,
    p_candidate_id UUID
) RETURNS TABLE (ballot_id UUID, participation_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_new_part   UUID;
    v_ballot     UUID;
BEGIN
    IF p_candidate_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM election_candidates ec
        WHERE ec.id = p_candidate_id AND ec.election_id = p_election_id
    ) THEN
        RAISE EXCEPTION 'candidate does not belong to this election'
            USING ERRCODE = '23503';
    END IF;

    INSERT INTO election_votes (id, election_id, voter_id, candidate_id)
    VALUES (gen_random_uuid(), p_election_id, p_voter_id, NULL)
    ON CONFLICT (election_id, voter_id) DO NOTHING
    RETURNING id INTO v_new_part;

    IF v_new_part IS NULL THEN
        RAISE EXCEPTION 'voter has already cast a ballot in this election'
            USING ERRCODE = '23505';
    END IF;

    INSERT INTO election_ballots (election_id, candidate_id)
    VALUES (p_election_id, p_candidate_id)
    RETURNING id INTO v_ballot;

    RETURN QUERY SELECT v_ballot, v_new_part;
END;
$$;

REVOKE ALL ON FUNCTION estate_cast_vote(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION estate_cast_vote(UUID, UUID, UUID) TO service_role, authenticated;

COMMIT;
