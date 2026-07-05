-- Block 45: settings & account.
--
-- Extends member settings with privacy + security + visitor-default preferences,
-- and adds a soft-delete marker to estate_residents so account deletion can
-- anonymise PII without hard-deleting membership history. Additive-only.

ALTER TABLE estate_member_settings
    ADD COLUMN IF NOT EXISTS privacy_show_unit    BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS privacy_show_vehicle BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS privacy_show_profile BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS biometric_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS two_factor_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS default_visitor_hours INTEGER NOT NULL DEFAULT 24,
    ADD COLUMN IF NOT EXISTS default_code_type    TEXT    NOT NULL DEFAULT 'one_time';

ALTER TABLE estate_residents
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
