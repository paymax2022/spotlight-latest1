-- Paymax Mobility — interstate bus PROVIDER MARKETPLACE.
-- Turns the admin-driven, free-text bus catalog into a provider self-service,
-- state→state marketplace. Providers register once, publish interstate routes
-- (from_state <> to_state), and self-schedule departures; customers search by
-- state pair + provider; bookings settle to the ROUTE's provider owner.
--
-- ADDITIVE-ONLY: no DROP table/column, no RENAME, no type narrowing, no new
-- NOT NULL on an existing populated column. Reuses bus_routes / bus_schedules /
-- bus_tickets, settlements/escrow, and the transport audit sink.

-- ─── BUS PROVIDERS (self-service operator accounts) ───────────────────────────
CREATE TABLE IF NOT EXISTS bus_providers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id       UUID NOT NULL UNIQUE REFERENCES auth.users(id),
    business_name       TEXT NOT NULL,
    slug                TEXT,
    contact_phone       TEXT NOT NULL,
    contact_email       TEXT,
    logo_url            TEXT,
    description         TEXT,
    base_state          TEXT,
    verification_status TEXT NOT NULL DEFAULT 'pending'
                            CHECK (verification_status IN ('pending','verified','suspended')),
    status              TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','inactive')),
    rating_avg          NUMERIC NOT NULL DEFAULT 0,
    rating_count        INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bus_providers_status_state_idx ON bus_providers(status, base_state);

-- ─── bus_routes: provider ownership + interstate + fare/amenities ─────────────
-- All ADD COLUMN IF NOT EXISTS with defaults / nullable so existing rows pass.
ALTER TABLE bus_routes ADD COLUMN IF NOT EXISTS provider_id     UUID REFERENCES bus_providers(id);
ALTER TABLE bus_routes ADD COLUMN IF NOT EXISTS from_state      TEXT;
ALTER TABLE bus_routes ADD COLUMN IF NOT EXISTS to_state        TEXT;
ALTER TABLE bus_routes ADD COLUMN IF NOT EXISTS from_city       TEXT;
ALTER TABLE bus_routes ADD COLUMN IF NOT EXISTS to_city         TEXT;
ALTER TABLE bus_routes ADD COLUMN IF NOT EXISTS base_fare_kobo  BIGINT;
ALTER TABLE bus_routes ADD COLUMN IF NOT EXISTS amenities       JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE bus_routes ADD COLUMN IF NOT EXISTS active          BOOLEAN NOT NULL DEFAULT TRUE;

-- Interstate invariant. NULL-tolerant so pre-marketplace admin rows (which have
-- NULL from_state/to_state) pass; only rows carrying both states are constrained.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'bus_routes_diff_states'
    ) THEN
        ALTER TABLE bus_routes
            ADD CONSTRAINT bus_routes_diff_states
            CHECK (from_state IS NULL OR to_state IS NULL OR from_state <> to_state);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS bus_routes_states_active_idx ON bus_routes(from_state, to_state, active);
CREATE INDEX IF NOT EXISTS bus_routes_provider_idx      ON bus_routes(provider_id);

-- ─── RLS (mirrors the transport_modes.sql module pattern) ─────────────────────
ALTER TABLE bus_providers ENABLE ROW LEVEL SECURITY;

-- Owner can see + update their own provider row.
CREATE POLICY "bus_providers_owner_read"   ON bus_providers FOR SELECT TO authenticated
    USING (owner_user_id = auth.uid());
CREATE POLICY "bus_providers_owner_update" ON bus_providers FOR UPDATE TO authenticated
    USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY "bus_providers_owner_insert" ON bus_providers FOR INSERT TO authenticated
    WITH CHECK (owner_user_id = auth.uid());

-- Public catalog: any authenticated user can read ACTIVE providers.
CREATE POLICY "bus_providers_public_read"  ON bus_providers FOR SELECT TO authenticated
    USING (status = 'active');

-- Service role (Go backend / pgx) bypasses RLS.
CREATE POLICY "bus_providers_service"      ON bus_providers TO service_role USING (TRUE) WITH CHECK (TRUE);
