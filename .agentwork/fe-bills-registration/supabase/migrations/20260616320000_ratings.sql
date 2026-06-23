-- Ratings table: one rating per (rater_id, transaction_ref).
-- Additive-only migration. No DROP, no RENAME.
CREATE TABLE IF NOT EXISTS ratings (
    id              TEXT PRIMARY KEY,
    rater_id        UUID NOT NULL REFERENCES auth.users(id),
    entity_id       TEXT NOT NULL,
    entity_type     TEXT NOT NULL,   -- EntityType enum value
    transaction_ref TEXT NOT NULL,   -- order_id / appointment_id / trip_id etc.
    score           NUMERIC(3,1) NOT NULL CHECK (score >= 1.0 AND score <= 5.0),
    comment         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- At-most-once: one rating per rater per transaction.
    CONSTRAINT ratings_rater_txn_unique UNIQUE (rater_id, transaction_ref)
);

CREATE INDEX IF NOT EXISTS ratings_entity_idx ON ratings (entity_id, entity_type);

-- RLS: raters see their own; entity owners see ratings about them via service_role.
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY ratings_select_own ON ratings FOR SELECT
    USING (auth.uid() = rater_id);

CREATE POLICY ratings_insert_own ON ratings FOR INSERT
    WITH CHECK (auth.uid() = rater_id);
