-- estate-b UAT remediation (ESTB-D003) — PENDING design proposal.
-- election_votes stores (election_id, voter_id, candidate_id) in one row, which
-- permanently links identity to selection — a true secret ballot is impossible
-- while they share a table (EST-UAT-0213/0216/0228). Target split:
--   election_votes keeps (election_id, voter_id) participation registry only;
--   candidate choice moves to an anonymous ballot table with no voter column.
-- Backfill drops voter_id from ballots after copying participation rows.
-- NOTE: requires coordinated writers change (Go CastVote + BFF vote route) and
-- a tally re-point (candidate counts read from the anonymous table). Writers
-- today already tolerate the split: vote route inserts only (election_id,
-- voter_id, candidate_id) — the columns below are ADDITIVE so the migration can
-- land before the writer change; the voter_id DROP must wait until writers
-- stop selecting it.
CREATE TABLE IF NOT EXISTS election_ballots (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id  UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL REFERENCES election_candidates(id) ON DELETE CASCADE,
    cast_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_election_ballots_election
    ON election_ballots (election_id, candidate_id);
-- No voter_id column by design: ballots are unlinkable to participants.
