-- Block 41: admin panel & configuration.
--
-- Estate-wide config (rules + subscription plan) and a ban marker on memberships.
-- Additive-only.

CREATE TABLE IF NOT EXISTS estate_config (
    estate_id         UUID PRIMARY KEY REFERENCES estates(id) ON DELETE CASCADE,
    rules             JSONB NOT NULL DEFAULT '{}'::jsonb,
    subscription_plan JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_by        UUID REFERENCES auth.users(id),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE estate_residents
    ADD COLUMN IF NOT EXISTS banned_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ban_reason TEXT;
