-- Estate & Private Voting module.
-- Additive-only — no DROP, no RENAME, no type narrowing.

-- ─── estates ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estates (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 200),
    address    TEXT,
    admin_id   UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS estates_admin_idx ON estates(admin_id);

-- ─── estate_residents ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estate_residents (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id  UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES auth.users(id),
    unit       TEXT NOT NULL DEFAULT '',
    role       TEXT NOT NULL DEFAULT 'resident'
                   CHECK (role IN ('resident','estate_admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (estate_id, user_id)
);

CREATE INDEX IF NOT EXISTS estate_residents_user_idx ON estate_residents(user_id);

-- ─── visitor_passes ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visitor_passes (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id    UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    issued_by    UUID NOT NULL REFERENCES auth.users(id),
    visitor_name TEXT NOT NULL,
    purpose      TEXT,
    qr_code      UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    valid_from   TIMESTAMPTZ NOT NULL,
    valid_until  TIMESTAMPTZ NOT NULL,
    used_at      TIMESTAMPTZ,
    status       TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','used','expired','revoked')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (valid_until > valid_from)
);

CREATE INDEX IF NOT EXISTS visitor_passes_estate_idx  ON visitor_passes(estate_id);
CREATE INDEX IF NOT EXISTS visitor_passes_issuer_idx  ON visitor_passes(issued_by);
CREATE INDEX IF NOT EXISTS visitor_passes_qr_idx      ON visitor_passes(qr_code);

-- ─── elections ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS elections (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id   UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    title       TEXT NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
    description TEXT,
    starts_at   TIMESTAMPTZ NOT NULL,
    ends_at     TIMESTAMPTZ NOT NULL,
    status      TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','open','closed','tallied')),
    created_by  UUID NOT NULL REFERENCES auth.users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS elections_estate_idx ON elections(estate_id);
CREATE INDEX IF NOT EXISTS elections_status_idx ON elections(status);

-- ─── election_candidates ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS election_candidates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    bio         TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS election_candidates_election_idx ON election_candidates(election_id);

-- ─── election_votes ───────────────────────────────────────────────────────────
-- voter_id is retained for eligibility enforcement (one vote per resident).
-- The combination UNIQUE(election_id, voter_id) prevents double-voting atomically.
CREATE TABLE IF NOT EXISTS election_votes (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id  UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    voter_id     UUID NOT NULL REFERENCES auth.users(id),
    candidate_id UUID NOT NULL REFERENCES election_candidates(id),
    cast_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (election_id, voter_id)
);

CREATE INDEX IF NOT EXISTS election_votes_election_idx ON election_votes(election_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE estates            ENABLE ROW LEVEL SECURITY;
ALTER TABLE estate_residents   ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor_passes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE elections          ENABLE ROW LEVEL SECURITY;
ALTER TABLE election_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE election_votes     ENABLE ROW LEVEL SECURITY;

-- Estates: readable only by residents.
CREATE POLICY "estates_select" ON estates FOR SELECT
    TO authenticated
    USING (
        EXISTS (SELECT 1 FROM estate_residents er WHERE er.estate_id = estates.id AND er.user_id = auth.uid())
    );

CREATE POLICY "estates_insert" ON estates FOR INSERT TO authenticated WITH CHECK (admin_id = auth.uid());

CREATE POLICY "estate_residents_select" ON estate_residents FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM estate_residents er2 WHERE er2.estate_id = estate_residents.estate_id AND er2.user_id = auth.uid())
    );

CREATE POLICY "visitor_passes_select" ON visitor_passes FOR SELECT
    TO authenticated
    USING (
        issued_by = auth.uid()
        OR EXISTS (
            SELECT 1 FROM estate_residents er
            WHERE er.estate_id = visitor_passes.estate_id
              AND er.user_id = auth.uid()
              AND er.role = 'estate_admin'
        )
    );

CREATE POLICY "visitor_passes_insert" ON visitor_passes FOR INSERT
    TO authenticated
    WITH CHECK (
        issued_by = auth.uid()
        AND EXISTS (SELECT 1 FROM estate_residents er WHERE er.estate_id = visitor_passes.estate_id AND er.user_id = auth.uid())
    );

-- Elections visible to all estate residents.
CREATE POLICY "elections_select" ON elections FOR SELECT
    TO authenticated
    USING (
        EXISTS (SELECT 1 FROM estate_residents er WHERE er.estate_id = elections.estate_id AND er.user_id = auth.uid())
    );

CREATE POLICY "elections_insert" ON elections FOR INSERT
    TO authenticated
    WITH CHECK (
        created_by = auth.uid()
        AND EXISTS (
            SELECT 1 FROM estate_residents er
            WHERE er.estate_id = elections.estate_id AND er.user_id = auth.uid() AND er.role = 'estate_admin'
        )
    );

-- Candidates visible to estate residents.
CREATE POLICY "candidates_select" ON election_candidates FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM elections el
            JOIN estate_residents er ON er.estate_id = el.estate_id
            WHERE el.id = election_candidates.election_id AND er.user_id = auth.uid()
        )
    );

-- Votes: each resident can see only their own vote.
CREATE POLICY "votes_select" ON election_votes FOR SELECT TO authenticated USING (voter_id = auth.uid());

-- Service role bypasses all RLS.
CREATE POLICY "estates_service"     ON estates             TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "residents_service"   ON estate_residents    TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "passes_service"      ON visitor_passes      TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "elections_service"   ON elections           TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "candidates_service"  ON election_candidates TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "votes_service"       ON election_votes      TO service_role USING (TRUE) WITH CHECK (TRUE);
