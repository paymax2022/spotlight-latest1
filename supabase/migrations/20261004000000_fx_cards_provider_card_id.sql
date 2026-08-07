-- Additive: add the issuer card id column to orch_fx_cards for the Maplerad
-- card-issuer seam. Idempotent (IF NOT EXISTS) so it applies cleanly whether the
-- base migration 20261003000000_fx_cards_collections.sql predates the column
-- (already-applied DBs) or already includes it (fresh `db reset` installs).
ALTER TABLE orch_fx_cards ADD COLUMN IF NOT EXISTS provider_card_id text;
