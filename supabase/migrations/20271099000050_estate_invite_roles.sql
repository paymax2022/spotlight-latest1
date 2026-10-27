-- Phase 2.3 (estate-a M02): role-scoped estate invitations.
--
-- EST-UAT-0028 "Estate manager invite" (P0) was PARTIAL: an admin could mint a join code, but every
-- code granted the same thing — a plain resident. An owner who wants to hand day-to-day management
-- to a co-manager had to become the admin of the estate they invited the person into, which is not
-- the same operation. The column below lets an admin issue a *manager* code; the CHECK keeps the
-- set inside estate_residents_role_check so a code can never mint a role the membership table
-- rejects.
--
-- Additive and idempotent: safe to re-apply, and existing codes keep behaving exactly as before
-- because the default is 'resident'.

ALTER TABLE estate_invite_codes
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'resident';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'estate_invite_codes_role_check'
          AND conrelid = 'estate_invite_codes'::regclass
    ) THEN
        ALTER TABLE estate_invite_codes
            ADD CONSTRAINT estate_invite_codes_role_check
            CHECK (role IN ('resident', 'estate_admin'));
    END IF;
END
$$;

-- Codes are looked up by value at redemption time; the same lookup now returns the role, and the
-- admin-facing list filters on it.
CREATE INDEX IF NOT EXISTS estate_invite_codes_estate_role_idx
    ON estate_invite_codes (estate_id, role);
