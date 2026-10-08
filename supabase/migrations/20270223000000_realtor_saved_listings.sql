-- Realtor module — persisted saved/wishlisted listings (PROPMGMT-012).
-- ADDITIVE ONLY. The listing-detail heart-icon toggle was local useState only
-- (reset on navigation/restart, never synced across devices). This adds a
-- per-user bookmark table so the toggle can persist for real.
-- RLS mirrors the established "own row only" pattern used for
-- realtor_move_ins/realtor_move_outs (see 20260620010000_realtor_lease_payments.sql
-- and 20270221000000_realtor_escrow_release.sql): FOR ALL USING (user_id = auth.uid()).

CREATE TABLE IF NOT EXISTS realtor_saved_listings (
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    listing_id  UUID NOT NULL REFERENCES realtor_listings(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, listing_id)
);

ALTER TABLE realtor_saved_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "User manages own saved listings"
    ON realtor_saved_listings FOR ALL
    USING (user_id = auth.uid());
