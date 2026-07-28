-- Events schema drift fix.
--
-- WHY THIS MIGRATION EXISTS:
-- Two independent migrations both do `CREATE TABLE IF NOT EXISTS` on the SAME
-- table names (`events`, `event_tickets`):
--   - 20260616240000_events.sql            (legacy EPIC events CMS; columns:
--     organizer_id, venue_address, status, ticket_type_id, qr_code, ...)
--   - 20260726000200_events.sql            (Top-5 Phase-2 event ticketing +
--     cashless event wallet; columns: organiser_id, venue, state, fee_bps,
--     tier_id, order_id, credential_id, ...)
--
-- Because 20260616240000 sorts BEFORE 20260726000200 and both use
-- `CREATE TABLE IF NOT EXISTS`, the legacy (June) migration's `events` and
-- `event_tickets` tables win in any environment that replays migrations in
-- order — the July migration silently no-ops on just those two tables (all of
-- its OTHER new tables — event_ticket_tiers, event_promo_codes, event_orders,
-- event_wallets, event_wallet_ledger, event_vendors, vendor_charges,
-- vendor_float, event_settlements — have unique names and are unaffected).
--
-- The result: the live `events`/`event_tickets` tables may currently have the
-- OLD (legacy) column shape while the `top5events` Go package (the canonical,
-- product-owner-approved implementation the mobile app is built against)
-- queries for the NEW columns, which don't exist yet.
--
-- This migration is purely ADDITIVE: it adds the missing columns with
-- `ADD COLUMN IF NOT EXISTS`, backfills them from the legacy columns where a
-- safe mapping exists, and adds supporting indexes. No column is dropped,
-- renamed, or narrowed. Existing RLS policies are left untouched — the
-- top5events service queries through the pgx service-role pool, which bypasses
-- RLS per CLAUDE.md.

-- ════════════════════════════════════════════════════════════════════════════
-- events: add the top5events (July) column set alongside the legacy columns.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE events ADD COLUMN IF NOT EXISTS organiser_id uuid REFERENCES auth.users(id);
ALTER TABLE events ADD COLUMN IF NOT EXISTS venue text NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'DRAFT'
    CHECK (state IN ('DRAFT','SUBMITTED','APPROVED','LIVE','CLOSED','SUSPENDED'));
ALTER TABLE events ADD COLUMN IF NOT EXISTS fee_bps int NOT NULL DEFAULT 0
    CHECK (fee_bps >= 0 AND fee_bps <= 10000);
ALTER TABLE events ADD COLUMN IF NOT EXISTS category text;

-- Backfill from legacy columns where present. Wrapped in a DO block with an
-- exception guard so this migration is bulletproof in any environment where
-- the legacy (June) columns never existed (e.g. a fresh DB where the July
-- migration happened to run first and created the new-shape table directly).
DO $$
BEGIN
    UPDATE events SET organiser_id = organizer_id
     WHERE organiser_id IS NULL AND organizer_id IS NOT NULL;
EXCEPTION
    WHEN undefined_column THEN NULL;
END $$;

DO $$
BEGIN
    UPDATE events SET venue = venue_address
     WHERE (venue = '' OR venue IS NULL) AND venue_address IS NOT NULL;
EXCEPTION
    WHEN undefined_column THEN NULL;
END $$;

DO $$
BEGIN
    UPDATE events SET state = CASE status
        WHEN 'draft'     THEN 'DRAFT'
        WHEN 'published' THEN 'LIVE'
        WHEN 'cancelled' THEN 'SUSPENDED'
        WHEN 'completed' THEN 'CLOSED'
        ELSE state
    END
    WHERE status IS NOT NULL;
EXCEPTION
    WHEN undefined_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_events_organiser ON events (organiser_id, state);
CREATE INDEX IF NOT EXISTS idx_events_category ON events (category);

-- ════════════════════════════════════════════════════════════════════════════
-- event_tickets: add the top5events (July) column set alongside legacy columns.
-- credential_id references public.credentials(id), created in
-- 20260726000100_top5_credential_points.sql (confirmed present in this repo),
-- so the FK is safe to add.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS tier_id uuid REFERENCES event_ticket_tiers(id);
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES event_orders(id);
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS state text DEFAULT 'ISSUED'
    CHECK (state IN ('ISSUED','TRANSFERRED','USED','REFUNDED'));
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS credential_id uuid REFERENCES public.credentials(id) ON DELETE SET NULL;

-- tier_id/order_id/credential_id are left nullable: there is no safe backfill
-- source for legacy rows (the legacy schema used ticket_type_id against a
-- different table, event_ticket_types, not event_ticket_tiers).
DO $$
BEGIN
    UPDATE event_tickets SET state = CASE status
        WHEN 'issued'    THEN 'ISSUED'
        WHEN 'used'      THEN 'USED'
        WHEN 'refunded'  THEN 'REFUNDED'
        WHEN 'cancelled' THEN 'REFUNDED'
        ELSE state
    END
    WHERE status IS NOT NULL;
EXCEPTION
    WHEN undefined_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_event_tickets_owner ON event_tickets (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_tickets_cred ON event_tickets (credential_id);
