-- Paymax Mobility — RECURRING DEPARTURE TEMPLATES for the bus PROVIDER MARKETPLACE.
-- ADR-020 deferred item. Lets a provider declare a weekly recurring departure
-- pattern (e.g. "Lagos→Abuja, Mon/Wed/Fri at 07:30, 14 seats, ₦12,000") once,
-- and have concrete bus_schedules rows materialized forward over a rolling
-- horizon by the transport-scheduler worker (MaterializeBusDepartures).
--
-- ADDITIVE-ONLY: no DROP table/column, no RENAME, no type narrowing, no new
-- NOT NULL on an existing populated column. Reuses bus_providers / bus_routes /
-- bus_schedules and the transport audit sink.

-- ─── BUS DEPARTURE TEMPLATES (recurring departure patterns) ───────────────────
CREATE TABLE IF NOT EXISTS bus_departure_templates (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id   UUID NOT NULL REFERENCES bus_providers(id),
    route_id      UUID NOT NULL REFERENCES bus_routes(id),
    days_of_week  INT[] NOT NULL,                 -- 0=Sunday .. 6=Saturday (Go time.Weekday)
    depart_time   TEXT NOT NULL,                  -- 'HH:MM' local (Africa/Lagos)
    total_seats   INT NOT NULL DEFAULT 14 CHECK (total_seats BETWEEN 1 AND 80),
    fare_kobo     BIGINT NOT NULL CHECK (fare_kobo >= 0),
    horizon_days  INT NOT NULL DEFAULT 14 CHECK (horizon_days BETWEEN 1 AND 60),
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS bus_departure_templates_provider_idx ON bus_departure_templates(provider_id);
CREATE INDEX IF NOT EXISTS bus_departure_templates_route_idx    ON bus_departure_templates(route_id);
CREATE INDEX IF NOT EXISTS bus_departure_templates_active_idx   ON bus_departure_templates(active);

-- ─── Link materialized schedules back to their template ───────────────────────
ALTER TABLE bus_schedules ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES bus_departure_templates(id);

-- Idempotent materialization target: one schedule per (template, departure_time).
-- Partial predicate keeps admin/provider-manual schedules (template_id IS NULL)
-- entirely out of the uniqueness constraint. The ON CONFLICT target in
-- MaterializeBusDepartures mirrors this predicate EXACTLY.
CREATE UNIQUE INDEX IF NOT EXISTS bus_schedules_template_dep_uniq
    ON bus_schedules(template_id, departure_time) WHERE template_id IS NOT NULL;
