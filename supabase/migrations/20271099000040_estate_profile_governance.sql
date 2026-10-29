-- Estate profile & ownership governance (UAT lane estate-a, module M02).
-- Additive-only — no DROP, no RENAME, no type narrowing, no backfill that can lose data.
--
-- Closes the four M02 gaps that `20271068001000_estates_lifecycle_status.sql` (which shipped the
-- pending/active/suspended/closed machine and legal hold) left open:
--   EST-UAT-0031  estate timezone            → estates.timezone, DB-validated against pg_timezone_names
--   EST-UAT-0036  estate branding & notices  → estates.branding (jsonb object) + estates.notice
--   EST-UAT-0032  governance policy version  → estate_config_revisions, written by a trigger so every
--                                              writer (Go service, BFF/PostgREST, psql) is captured
--   EST-UAT-0035  estate owner transfer      → estate_owner_transfers + one deciding writer
--                                              estate_owner_transfer_decide()
--   EST-UAT-0023  duplicate estate review    → estates.duplicate_suspected, set by CreateEstate when a
--                                              normalised (name, address) twin already exists; the
--                                              estate lands in the existing platform review queue
--                                              (lifecycle.go verify/reject) instead of going live.
--
-- Deliberately NOT in this file: bulk estate/unit import (EST-UAT-0033/0034 — Phase 2.5, already
-- drafted in migrations-estate-d/), and any change to the lifecycle states themselves.
--
-- Every new column defaults to today's behaviour, so an estate that exists right now reads exactly
-- as it did before this migration: Africa/Lagos is the timezone the platform has implicitly used,
-- branding/notice are empty, and no estate is flagged as a duplicate.

-- ─── estate profile ───────────────────────────────────────────────────────────

ALTER TABLE estates
    ADD COLUMN IF NOT EXISTS timezone            TEXT    NOT NULL DEFAULT 'Africa/Lagos',
    ADD COLUMN IF NOT EXISTS branding            JSONB   NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS notice              TEXT,
    ADD COLUMN IF NOT EXISTS duplicate_suspected BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN estates.timezone            IS 'IANA zone name; validated by estates_require_known_timezone, not by Go alone';
COMMENT ON COLUMN estates.branding            IS 'JSON object: logo_url / primary_color / accent_color — presentation only, never a privilege';
COMMENT ON COLUMN estates.notice              IS 'Notice shown to residents of this estate (announcements surface), max 2000 chars';
COMMENT ON COLUMN estates.duplicate_suspected IS 'EST-UAT-0023: a normalised (name, address) twin already exists — platform must verify or reject';

-- branding must stay an object: a scalar/array would let a client smuggle arbitrary payload into the
-- app's theme values.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estates_branding_is_object') THEN
    ALTER TABLE estates
      ADD CONSTRAINT estates_branding_is_object CHECK (jsonb_typeof(branding) = 'object');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estates_notice_length') THEN
    ALTER TABLE estates
      ADD CONSTRAINT estates_notice_length CHECK (notice IS NULL OR char_length(notice) <= 2000);
  END IF;
END $$;

-- Timezone gate in the database, not only in the service: the BFF and any operator with psql write
-- to this table too, and a typo'd zone name silently breaks every reminder and report built on it.
CREATE OR REPLACE FUNCTION estates_require_known_timezone()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.timezone IS NULL OR btrim(NEW.timezone) = '' THEN
    RAISE EXCEPTION 'estate timezone is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'unknown timezone %', NEW.timezone USING ERRCODE = '22023', HINT = 'use an IANA zone name, e.g. Africa/Lagos';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS estates_require_known_timezone_on_write ON estates;
CREATE TRIGGER estates_require_known_timezone_on_write
    BEFORE INSERT OR UPDATE OF timezone ON estates
    FOR EACH ROW EXECUTE FUNCTION estates_require_known_timezone();

CREATE INDEX IF NOT EXISTS idx_estates_duplicate_suspected
    ON estates (duplicate_suspected) WHERE duplicate_suspected;

-- ─── governance policy version history (EST-UAT-0032) ─────────────────────────

CREATE TABLE IF NOT EXISTS estate_config_revisions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id      UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    column_name    TEXT NOT NULL CHECK (column_name IN ('rules', 'subscription_plan')),
    version        INTEGER NOT NULL CHECK (version > 0),
    value          JSONB NOT NULL,
    previous_value JSONB,
    changed_by     UUID,
    changed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (estate_id, column_name, version)
);

CREATE INDEX IF NOT EXISTS estate_config_revisions_estate_idx
    ON estate_config_revisions (estate_id, column_name, version DESC);

-- The version counter is computed inside the trigger, so two concurrent config writes to the same
-- column would race on max(version)+1 and one would lose its revision to the UNIQUE. A transaction
-- advisory lock keyed on (estate, column) serialises exactly that pair and nothing else.
CREATE OR REPLACE FUNCTION estate_config_record_revision()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_col   TEXT;
    v_new   JSONB;
    v_old   JSONB;
    v_ver   INTEGER;
BEGIN
    FOREACH v_col IN ARRAY ARRAY['rules', 'subscription_plan'] LOOP
        v_new := to_jsonb(NEW) -> v_col;
        v_old := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) -> v_col ELSE NULL END;
        IF TG_OP = 'UPDATE' AND (v_old IS NOT DISTINCT FROM v_new) THEN
            CONTINUE;
        END IF;
        -- An insert that carries the column's empty default records no version: the estate never
        -- chose that policy, and minting a version for it would put a rule nobody wrote into the
        -- governance history the console shows.
        IF TG_OP = 'INSERT' AND (v_new IS NULL OR v_new = '{}'::jsonb) THEN
            CONTINUE;
        END IF;

        PERFORM pg_advisory_xact_lock(hashtext(NEW.estate_id::text), hashtext(v_col));

        SELECT COALESCE(MAX(r.version), 0) + 1 INTO v_ver
        FROM estate_config_revisions r
        WHERE r.estate_id = NEW.estate_id AND r.column_name = v_col;

        INSERT INTO estate_config_revisions (estate_id, column_name, version, value, previous_value, changed_by)
        VALUES (NEW.estate_id, v_col, v_ver,
                COALESCE(v_new, '{}'::jsonb), v_old,
                COALESCE(NEW.updated_by, auth.uid()));
    END LOOP;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS estate_config_record_revision_on_write ON estate_config;
CREATE TRIGGER estate_config_record_revision_on_write
    AFTER INSERT OR UPDATE ON estate_config
    FOR EACH ROW EXECUTE FUNCTION estate_config_record_revision();

-- ─── estate owner transfer (EST-UAT-0035) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS estate_owner_transfers (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id     UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    from_user_id  UUID NOT NULL,
    to_user_id    UUID NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
    reason        TEXT,
    decision_note TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at    TIMESTAMPTZ,
    CHECK (from_user_id <> to_user_id),
    CHECK ((status = 'pending') = (decided_at IS NULL))
);

-- One live transfer per estate: two pending requests would both be acceptable and the second would
-- silently move the estate a second time.
CREATE UNIQUE INDEX IF NOT EXISTS estate_owner_transfers_one_pending
    ON estate_owner_transfers (estate_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS estate_owner_transfers_to_idx ON estate_owner_transfers (to_user_id, status);

-- One deciding writer, so no caller can accept a transfer without the privilege move being atomic:
-- in one transaction it flips the estate's admin_id, promotes the incoming owner's membership,
-- demotes the outgoing owner to resident, records the decision and audits it.
--
-- p_estate_id is part of the lookup, not a post-check: a decision issued under the wrong estate in
-- the URL must not move the right estate's ownership on its way to returning 404.
DROP FUNCTION IF EXISTS estate_owner_transfer_decide(UUID, UUID, BOOLEAN, TEXT);
CREATE OR REPLACE FUNCTION estate_owner_transfer_decide(
    p_estate_id   UUID,
    p_transfer_id UUID,
    p_actor       UUID,
    p_accept      BOOLEAN,
    p_note        TEXT
) RETURNS TABLE (out_estate_id UUID, out_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v            estate_owner_transfers%ROWTYPE;
    v_member     BOOLEAN;
    v_banned     BOOLEAN;
    v_new_status TEXT;
BEGIN
    SELECT t.* INTO v FROM estate_owner_transfers t
     WHERE t.id = p_transfer_id AND t.estate_id = p_estate_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'owner transfer not found' USING ERRCODE = 'P0002';
    END IF;
    IF v.from_user_id <> p_actor AND v.to_user_id <> p_actor THEN
        RAISE EXCEPTION 'caller is not a party to this transfer' USING ERRCODE = '42501';
    END IF;
    IF v.status <> 'pending' THEN
        RAISE EXCEPTION 'transfer is already %', v.status USING ERRCODE = '55000';
    END IF;

    IF p_accept THEN
        IF p_actor <> v.to_user_id THEN
            RAISE EXCEPTION 'only the incoming owner can accept a transfer' USING ERRCODE = '42501';
        END IF;

        -- The target must be a live member: handing an estate to a banned or removed account would
        -- create an owner who cannot act, and an estate nobody administers.
        SELECT (r.deleted_at IS NULL), COALESCE(r.banned_at IS NOT NULL, FALSE)
          INTO v_member, v_banned
        FROM estate_residents r
        WHERE r.estate_id = v.estate_id AND r.user_id = v.to_user_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'incoming owner is not a member of this estate' USING ERRCODE = '55000';
        END IF;
        IF v_banned THEN
            RAISE EXCEPTION 'incoming owner is banned from this estate' USING ERRCODE = '42501';
        END IF;
        IF NOT v_member THEN
            RAISE EXCEPTION 'incoming owner is no longer a member of this estate' USING ERRCODE = '55000';
        END IF;

        UPDATE estates SET admin_id = v.to_user_id WHERE id = v.estate_id;

        INSERT INTO estate_residents (estate_id, user_id, unit, role)
        VALUES (v.estate_id, v.to_user_id, '', 'estate_admin')
        ON CONFLICT (estate_id, user_id) DO UPDATE SET role = 'estate_admin';

        UPDATE estate_residents SET role = 'resident'
        WHERE estate_id = v.estate_id AND user_id = v.from_user_id AND role = 'estate_admin';

        UPDATE estate_owner_transfers
        SET status = 'accepted', decided_at = NOW(), decision_note = p_note
        WHERE id = p_transfer_id;

        INSERT INTO estate_audit_log (estate_id, actor_id, action, subject_type, subject_id, metadata)
        VALUES (v.estate_id, p_actor, 'ESTATE_OWNER_TRANSFER_ACCEPTED', 'estate', v.estate_id::text,
                jsonb_build_object('from_user_id', v.from_user_id, 'to_user_id', v.to_user_id,
                                   'note', p_note));

        RETURN QUERY SELECT v.estate_id, 'accepted'::TEXT;
        RETURN;
    END IF;

    -- Declining is the target's call; the initiating owner may withdraw their own request.
    v_new_status := CASE WHEN p_actor = v.to_user_id THEN 'declined' ELSE 'cancelled' END;

    UPDATE estate_owner_transfers
    SET status = v_new_status, decided_at = NOW(), decision_note = p_note
    WHERE id = p_transfer_id;

    INSERT INTO estate_audit_log (estate_id, actor_id, action, subject_type, subject_id, metadata)
    VALUES (v.estate_id, p_actor, 'ESTATE_OWNER_TRANSFER_' || upper(v_new_status), 'estate',
            v.estate_id::text, jsonb_build_object('to_user_id', v.to_user_id, 'note', p_note));

    RETURN QUERY SELECT v.estate_id, v_new_status;
END $$;

REVOKE ALL ON FUNCTION estate_owner_transfer_decide(UUID, UUID, UUID, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION estate_owner_transfer_decide(UUID, UUID, UUID, BOOLEAN, TEXT) TO service_role, authenticated;

-- ─── RLS: service-role only ───────────────────────────────────────────────────
-- These tables are read and written through the Go service (service_role) and the admin console;
-- leaving RLS off would expose them through PostgREST to any signed-in resident.

ALTER TABLE estate_config_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE estate_owner_transfers  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profile_service ON estate_config_revisions;
CREATE POLICY profile_service ON estate_config_revisions TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS profile_service ON estate_owner_transfers;
CREATE POLICY profile_service ON estate_owner_transfers TO service_role USING (true) WITH CHECK (true);
