-- Paymax Mobility — multi-modal ratings (parcel / towing / movers).
-- ADDITIVE-ONLY: no DROP table/column, no RENAME, no type narrowing.
--
-- Why a new table instead of trip_ratings:
--   trip_ratings.trip_id is `UUID NOT NULL REFERENCES trips(id)`. Parcel /
--   towing / mover jobs are NOT rows in trips, so their ids cannot be stored
--   there without violating the FK. This table mirrors trip_ratings (stars +
--   optional comment + optional tip_kobo) but keys on (mode, job_id) where
--   job_id is a free TEXT id (no FK), so any mode's job id is accepted.
--   The ratee is the provider's auth user id (drivers.user_id), matching the
--   recompute target (drivers.rating WHERE user_id = ratee).

CREATE TABLE IF NOT EXISTS mode_ratings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mode        TEXT NOT NULL CHECK (mode IN ('parcel','towing','mover')),
    job_id      TEXT NOT NULL,
    rater_id    UUID NOT NULL REFERENCES auth.users(id),
    ratee_id    UUID NOT NULL REFERENCES auth.users(id),
    stars       SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
    comment     TEXT,
    tip_kobo    BIGINT NOT NULL DEFAULT 0 CHECK (tip_kobo >= 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (mode, job_id, rater_id)
);
CREATE INDEX IF NOT EXISTS mode_ratings_ratee_idx ON mode_ratings(ratee_id, mode);

ALTER TABLE mode_ratings ENABLE ROW LEVEL SECURITY;

-- Mirror trip_ratings: rater/ratee may read their own rows; only the rater may
-- insert; service_role bypasses for the backend money/audit path.
CREATE POLICY "mode_ratings_select" ON mode_ratings FOR SELECT TO authenticated
    USING (rater_id = auth.uid() OR ratee_id = auth.uid());
CREATE POLICY "mode_ratings_insert" ON mode_ratings FOR INSERT TO authenticated
    WITH CHECK (rater_id = auth.uid());
CREATE POLICY "mode_ratings_service" ON mode_ratings TO service_role
    USING (TRUE) WITH CHECK (TRUE);
