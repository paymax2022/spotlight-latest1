-- Estate occupancy and unit rules (UAT module M03) — close-out Phase 2.4.
-- Additive only — no DROP, no RENAME, no type narrowing, no backfill that can lose data.
-- Re-appliable: every statement is IF NOT EXISTS / OR REPLACE / DROP-then-CREATE.
--
-- PROVENANCE: this file was reconstructed on 2026-10-30 from the objects already live in the local
-- database (estate_unit_occupants, the three guard functions, the two SECURITY DEFINER writers,
-- estate_properties.capacity and the four *_override columns on estate_dues_invoices). The original
-- copy of this migration was never committed, which meant a fresh environment could not replay it —
-- and the lease ledger that follows (20271099000080) references these objects. Definitions here are
-- the applied ones, extracted rather than retyped.
--
--   EST-UAT-0044  duplicate / over-capacity occupancy → estate_unit_occupants plus
--                                                       estate_enforce_unit_capacity (capacity, one
--                                                       live tenant, one live owner per unit)
--   EST-UAT-0048  billing a vacant unit              → estate_enforce_vacant_unit_exemption and the
--                                                       vacancy_override pair that excuses it
--   EST-UAT-0045  billing outside an occupant's term → estate_enforce_out_of_term_billing and the
--                                                       term_override pair that excuses it
--
-- Design decisions worth stating:
--   * `estate_properties.tenant_id` / `landlord_id` record who is on the deed *now*; they cannot say
--     from when, until when, or that a person lived there last year. This table is that history.
--   * Rules live in triggers, not services, so the BFF mirror, the importer and any future writer all
--     pass the same gate — the party columns cannot be moved by a path that skipped a service.
--   * Admission is a transaction: membership, registration, party columns, profile label and audit row
--     all move together, so a unit cannot be 'occupied' with nobody on the deed.
--   * Exemptions are recorded, not silent: both dues overrides require a reason and are audited
--     (INVOICE_VACANCY_OVERRIDE / INVOICE_TERM_OVERRIDE).

-- ─── unit capacity ────────────────────────────────────────────────────────────

-- EST-UAT-0044: how many occupancy registrations a unit accepts. 6 is a household, not a hotel room;
-- an estate that genuinely houses more raises it on the unit rather than the rule being softened.
ALTER TABLE estate_properties
    ADD COLUMN IF NOT EXISTS capacity INTEGER NOT NULL DEFAULT 6;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estate_properties_capacity_positive') THEN
        ALTER TABLE estate_properties
            ADD CONSTRAINT estate_properties_capacity_positive CHECK (capacity > 0);
    END IF;
END $$;

COMMENT ON COLUMN estate_properties.capacity IS
    'EST-UAT-0044: how many occupancy registrations the unit accepts. Default 6 — a household, not a hotel room. Enforced by estate_enforce_unit_capacity and by estate_occupancy_admit.';

-- ─── who is behind which door ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS estate_unit_occupants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id       UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    property_id     UUID NOT NULL REFERENCES estate_properties(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES auth.users(id),
    occupancy_type  TEXT NOT NULL DEFAULT 'resident'
                        CHECK (occupancy_type IN ('resident', 'tenant', 'homeowner')),
    effective_from  DATE,
    effective_until DATE,
    admitted_by     UUID,
    note            TEXT,
    ended_at        TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- A registration is one row per person per unit; a re-admission reopens it rather than stacking a
    -- second live row, which is what makes the "one live tenant" index below total.
    CONSTRAINT estate_unit_occupants_property_id_user_id_key UNIQUE (property_id, user_id),
    -- EST-UAT-0045: a term that ends before it starts is a data-entry error, not an exemption.
    CONSTRAINT estate_unit_occupants_window_ordered
        CHECK (effective_from IS NULL OR effective_until IS NULL OR effective_until >= effective_from)
);

COMMENT ON TABLE estate_unit_occupants IS
    'Who occupies which unit, from when to when, as owner, tenant or plain resident. The estate membership row (estate_residents) says a person belongs to the estate; this says which door they belong to.';

CREATE INDEX IF NOT EXISTS estate_unit_occupants_live_idx
    ON estate_unit_occupants (property_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS estate_unit_occupants_user_idx
    ON estate_unit_occupants (estate_id, user_id);
-- EST-UAT-0044: a unit has at most one live owner and at most one live tenant. Plain residents are
-- bounded by capacity instead, so a household can hold several.
CREATE UNIQUE INDEX IF NOT EXISTS estate_unit_occupants_one_live_owner
    ON estate_unit_occupants (property_id)
    WHERE occupancy_type = 'homeowner' AND ended_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS estate_unit_occupants_one_live_tenant
    ON estate_unit_occupants (property_id)
    WHERE occupancy_type = 'tenant' AND ended_at IS NULL;

ALTER TABLE estate_unit_occupants ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    -- Readers go through the estate surface (service role). There is deliberately no authenticated
    -- policy: the console and the app both read occupancy through the BFF, which carries the actor's
    -- authority check itself.
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                   AND tablename = 'estate_unit_occupants' AND policyname = 'occupancy_service') THEN
        CREATE POLICY "occupancy_service" ON estate_unit_occupants TO service_role
            USING (TRUE) WITH CHECK (TRUE);
    END IF;
END $$;

-- ─── capacity, where the write happens ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.estate_enforce_unit_capacity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_capacity INTEGER;
    v_archived BOOLEAN;
    v_estate   UUID;
    v_used     INTEGER;
BEGIN
    -- Releasing an occupancy never fails on capacity.
    IF NEW.ended_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Lock the unit: two concurrent admissions to the last bed must serialise, not both count N-1.
    SELECT ep.capacity, ep.archived, ep.estate_id
      INTO v_capacity, v_archived, v_estate
    FROM estate_properties ep
    WHERE ep.id = NEW.property_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'unit not found' USING ERRCODE = 'P0002';
    END IF;
    -- The registration claims an estate; a unit in another estate is a mis-pathed or forged request.
    IF v_estate <> NEW.estate_id THEN
        RAISE EXCEPTION 'unit belongs to another estate' USING ERRCODE = '42501';
    END IF;
    IF v_archived THEN
        RAISE EXCEPTION 'unit is archived' USING ERRCODE = '55000';
    END IF;

    SELECT COUNT(*) INTO v_used
    FROM estate_unit_occupants o
    WHERE o.property_id = NEW.property_id
      AND o.ended_at IS NULL
      AND o.id IS DISTINCT FROM NEW.id;

    IF v_used >= v_capacity THEN
        RAISE EXCEPTION 'unit is full (% occupancy registrations)', v_capacity USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS estate_enforce_unit_capacity_on_write ON estate_unit_occupants;
CREATE TRIGGER estate_enforce_unit_capacity_on_write
    BEFORE INSERT OR UPDATE ON estate_unit_occupants
    FOR EACH ROW EXECUTE FUNCTION estate_enforce_unit_capacity();

-- ─── the two dues exemptions ──────────────────────────────────────────────────

-- Both exemptions follow the same posture: absent information (no unit, no registration) means the
-- rule has nothing to say; a deliberate waiver carries a reason and is audited.
ALTER TABLE estate_dues_invoices
    ADD COLUMN IF NOT EXISTS vacancy_override BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS vacancy_override_reason TEXT,
    ADD COLUMN IF NOT EXISTS term_override BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS term_override_reason TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estate_dues_invoices_vacancy_override_reason') THEN
        ALTER TABLE estate_dues_invoices
            ADD CONSTRAINT estate_dues_invoices_vacancy_override_reason
            CHECK (NOT vacancy_override OR btrim(COALESCE(vacancy_override_reason, '')) <> '');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estate_dues_invoices_term_override_reason') THEN
        ALTER TABLE estate_dues_invoices
            ADD CONSTRAINT estate_dues_invoices_term_override_reason
            CHECK (NOT term_override OR btrim(COALESCE(term_override_reason, '')) <> '');
    END IF;
END $$;

COMMENT ON COLUMN estate_dues_invoices.vacancy_override IS
    'EST-UAT-0048: bill a vacant unit anyway. Requires vacancy_override_reason; audited as INVOICE_VACANCY_OVERRIDE.';

CREATE OR REPLACE FUNCTION public.estate_enforce_vacant_unit_exemption()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_status TEXT;
BEGIN
    -- The rule needs a unit to speak about; an invoice with no property is out of its scope, which is
    -- recorded as a limit of EST-UAT-0048 rather than a loophole in the code.
    IF NEW.property_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT ep.occupancy_status INTO v_status FROM estate_properties ep WHERE ep.id = NEW.property_id;
    IF v_status IS DISTINCT FROM 'vacant' THEN
        RETURN NEW;
    END IF;
    IF NEW.vacancy_override THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'unit is vacant — dues are exempt; bill it only with an explicit override and a reason'
        USING ERRCODE = '23514';
END $function$;

DROP TRIGGER IF EXISTS estate_enforce_vacant_unit_exemption_on_create ON estate_dues_invoices;
CREATE TRIGGER estate_enforce_vacant_unit_exemption_on_create
    BEFORE INSERT ON estate_dues_invoices
    FOR EACH ROW EXECUTE FUNCTION estate_enforce_vacant_unit_exemption();

CREATE OR REPLACE FUNCTION public.estate_enforce_out_of_term_billing()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_out_of_term BOOLEAN;
BEGIN
    -- No unit named, or no registration for the billed person on this unit: the rule has nothing to
    -- say, which is the "NULL = unrestricted" posture of EST-UAT-0045 rather than a permission.
    IF NEW.property_id IS NULL OR NEW.resident_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.term_override THEN
        RETURN NEW;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM estate_unit_occupants o
        WHERE o.property_id = NEW.property_id
          AND o.user_id     = NEW.resident_id
          AND o.ended_at IS NULL
          -- The registration exists and is live, yet today falls outside its term.
          AND (o.effective_from IS NOT NULL AND o.effective_from > CURRENT_DATE
               OR o.effective_until IS NOT NULL AND o.effective_until < CURRENT_DATE)
    ) INTO v_out_of_term;

    IF v_out_of_term THEN
        RAISE EXCEPTION 'this occupant''s term on the unit does not run today — dues are exempt; bill only with an explicit term override and a reason'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS estate_enforce_out_of_term_billing_on_create ON estate_dues_invoices;
CREATE TRIGGER estate_enforce_out_of_term_billing_on_create
    BEFORE INSERT ON estate_dues_invoices
    FOR EACH ROW EXECUTE FUNCTION estate_enforce_out_of_term_billing();

-- ─── admission and release writers ───────────────────────────────────────────
--
-- Membership, registration, party columns, profile label and the audit row move in one transaction;
-- the guards above decide whether the write is allowed. Approval of a tenancy request is the landlord
-- admitting a tenant — the only occupancy type a non-admin may create.

CREATE OR REPLACE FUNCTION public.estate_occupancy_admit(p_estate uuid, p_property uuid, p_user uuid, p_actor uuid, p_kind text, p_from date, p_until date, p_note text, p_replace_owner boolean)
 RETURNS TABLE(out_occupant_id uuid, out_resident_id uuid, out_role text, out_occupancy_type text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_prop     estate_properties%ROWTYPE;
    v_admin    BOOLEAN;
    v_landlord BOOLEAN;
    v_used     INTEGER;
    v_res_id   UUID;
    v_role     TEXT;
    v_occupant estate_unit_occupants%ROWTYPE;
BEGIN
    IF p_kind NOT IN ('resident', 'tenant', 'homeowner') THEN
        RAISE EXCEPTION 'unknown occupancy type %', p_kind USING ERRCODE = '22023';
    END IF;
    IF p_from IS NOT NULL AND p_until IS NOT NULL AND p_until < p_from THEN
        RAISE EXCEPTION 'move-out date precedes move-in date' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_prop
    FROM estate_properties ep
    WHERE ep.id = p_property AND ep.estate_id = p_estate AND ep.archived = FALSE
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unit not found in this estate' USING ERRCODE = 'P0002';
    END IF;

    -- Privilege. An estate admin may admit any occupancy type. The unit's recorded landlord may admit
    -- a *tenant* — that is what approving a tenancy request is — and nothing else. Nobody else may.
    SELECT EXISTS (
        SELECT 1 FROM estate_residents r
        WHERE r.estate_id = p_estate AND r.user_id = p_actor AND r.role = 'estate_admin'
          AND r.deleted_at IS NULL AND r.banned_at IS NULL
    ) INTO v_admin;
    v_landlord := (p_kind = 'tenant' AND v_prop.landlord_id = p_actor);
    IF NOT v_admin AND NOT v_landlord THEN
        RAISE EXCEPTION 'not authorised to admit this occupancy' USING ERRCODE = '42501';
    END IF;
    -- Through PostgREST the caller has a JWT; naming an admin as p_actor while holding a resident token
    -- must not work.
    IF auth.uid() IS NOT NULL AND auth.uid() <> p_actor THEN
        RAISE EXCEPTION 'actor must be the authenticated caller' USING ERRCODE = '42501';
    END IF;

    -- EST-UAT-0044, the overlap half: an admission may not silently displace a recorded owner. A
    -- reviewed ownership *transfer* says so explicitly (p_replace_owner); an approval that just found a
    -- unit with somebody else on the deed is refused and the admin has to transfer first.
    IF p_kind = 'homeowner' AND v_prop.landlord_id IS NOT NULL AND v_prop.landlord_id <> p_user THEN
        IF NOT p_replace_owner THEN
            RAISE EXCEPTION 'unit already has an owner — transfer it first' USING ERRCODE = '55000';
        END IF;
        UPDATE estate_unit_occupants
           SET ended_at = NOW(), updated_at = NOW()
         WHERE property_id = p_property
           AND occupancy_type = 'homeowner'
           AND user_id <> p_user
           AND ended_at IS NULL;
    END IF;

    -- EST-UAT-0044, the capacity half. The trigger is the durable guard; this pre-check exists so the
    -- refusal names the limit before the party columns are touched.
    SELECT COUNT(*) INTO v_used
    FROM estate_unit_occupants o
    WHERE o.property_id = p_property AND o.ended_at IS NULL AND o.user_id <> p_user;
    IF v_used >= v_prop.capacity THEN
        RAISE EXCEPTION 'unit is full (% occupancy registrations)', v_prop.capacity USING ERRCODE = '23514';
    END IF;

    -- Residency, promotion-only. A person who is already the estate admin stays the estate admin when
    -- their tenant is admitted; a banned or removed membership is not revived by an admission.
    INSERT INTO estate_residents (estate_id, user_id, unit, role)
    VALUES (p_estate, p_user,
            btrim(COALESCE(v_prop.block, '') || ' ' || COALESCE(v_prop.floor, '') || ' ' || v_prop.unit_label),
            'resident')
    ON CONFLICT (estate_id, user_id) DO UPDATE
       SET unit = CASE WHEN estate_residents.unit <> '' THEN estate_residents.unit ELSE EXCLUDED.unit END
     WHERE estate_residents.deleted_at IS NULL AND estate_residents.banned_at IS NULL
    RETURNING id, role INTO v_res_id, v_role;
    IF v_res_id IS NULL THEN
        RAISE EXCEPTION 'this estate membership is no longer active' USING ERRCODE = '55000';
    END IF;

    INSERT INTO estate_unit_occupants
        (estate_id, property_id, user_id, occupancy_type, effective_from, effective_until, admitted_by, note)
    VALUES (p_estate, p_property, p_user, p_kind, p_from, p_until, p_actor, p_note)
    ON CONFLICT (property_id, user_id) DO UPDATE
       SET occupancy_type  = EXCLUDED.occupancy_type,
           effective_from  = EXCLUDED.effective_from,
           effective_until = EXCLUDED.effective_until,
           ended_at        = NULL,
           admitted_by     = EXCLUDED.admitted_by,
           note            = COALESCE(EXCLUDED.note, estate_unit_occupants.note),
           updated_at      = NOW()
    RETURNING * INTO v_occupant;

    -- Party columns and the occupancy flag, in the same statement, so a unit cannot be 'occupied' with
    -- nobody on the deed.
    UPDATE estate_properties ep
       SET landlord_id      = CASE WHEN p_kind = 'homeowner' THEN p_user ELSE ep.landlord_id END,
           tenant_id        = CASE WHEN p_kind = 'tenant'    THEN p_user ELSE ep.tenant_id END,
           occupancy_status = CASE WHEN ep.occupancy_status = 'vacant' THEN 'occupied' ELSE ep.occupancy_status END
     WHERE ep.id = p_property;

    -- The profile keeps the owner/tenant label the resident card and the console read.
    INSERT INTO resident_profiles (resident_id, occupancy_type)
    VALUES (v_res_id, p_kind)
    ON CONFLICT (resident_id) DO UPDATE
        SET occupancy_type = EXCLUDED.occupancy_type, updated_at = NOW();

    INSERT INTO estate_audit_log (estate_id, actor_id, action, subject_type, subject_id, metadata)
    VALUES (p_estate, p_actor, 'ESTATE_UNIT_OCCUPANT_ADMITTED', 'property', p_property::text,
            jsonb_build_object('user_id', p_user, 'occupancy_type', p_kind,
                               'effective_from', p_from, 'effective_until', p_until,
                               'replaced_owner', p_replace_owner));

    RETURN QUERY SELECT v_occupant.id, v_res_id, v_role, p_kind::TEXT;
END $function$;

CREATE OR REPLACE FUNCTION public.estate_occupancy_release(p_estate uuid, p_property uuid, p_user uuid, p_actor uuid, p_reason text)
 RETURNS TABLE(out_occupant_id uuid, out_occupancy_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_occ     estate_unit_occupants%ROWTYPE;
    v_admin   BOOLEAN;
    v_status  TEXT;
    v_still   INTEGER;
BEGIN
    SELECT * INTO v_occ
    FROM estate_unit_occupants o
    WHERE o.estate_id = p_estate AND o.property_id = p_property AND o.user_id = p_user AND o.ended_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'no live occupancy of this unit' USING ERRCODE = 'P0002';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM estate_residents r
        WHERE r.estate_id = p_estate AND r.user_id = p_actor AND r.role = 'estate_admin'
          AND r.deleted_at IS NULL AND r.banned_at IS NULL
    ) INTO v_admin;
    -- An occupant may end their own registration; only an admin ends somebody else's.
    IF NOT v_admin AND p_actor <> p_user THEN
        RAISE EXCEPTION 'not authorised to end this occupancy' USING ERRCODE = '42501';
    END IF;
    IF auth.uid() IS NOT NULL AND auth.uid() <> p_actor THEN
        RAISE EXCEPTION 'actor must be the authenticated caller' USING ERRCODE = '42501';
    END IF;

    UPDATE estate_unit_occupants
       SET ended_at = NOW(), updated_at = NOW(),
           note = COALESCE(note || CASE WHEN p_reason IS NULL OR btrim(p_reason) = '' THEN '' ELSE ' | ' || p_reason END, p_reason)
     WHERE id = v_occ.id;

    -- Whoever was on the deed as this person comes off it; somebody else in the unit stays.
    UPDATE estate_properties ep
       SET landlord_id = CASE WHEN ep.landlord_id = p_user THEN NULL ELSE ep.landlord_id END,
           tenant_id   = CASE WHEN ep.tenant_id   = p_user THEN NULL ELSE ep.tenant_id END
     WHERE ep.id = p_property;

    SELECT COUNT(*) INTO v_still
    FROM estate_unit_occupants o
    WHERE o.property_id = p_property AND o.ended_at IS NULL;

    v_status := CASE WHEN v_still > 0 THEN 'occupied' ELSE 'vacant' END;
    UPDATE estate_properties ep SET occupancy_status = v_status
     WHERE ep.id = p_property
       AND ep.occupancy_status <> 'reserved';

    INSERT INTO estate_audit_log (estate_id, actor_id, action, subject_type, subject_id, metadata)
    VALUES (p_estate, p_actor, 'ESTATE_UNIT_OCCUPANT_RELEASED', 'property', p_property::text,
            jsonb_build_object('user_id', p_user, 'occupancy_type', v_occ.occupancy_type, 'reason', p_reason));

    RETURN QUERY SELECT v_occ.id, v_status;
END $function$;

-- ─── privileges ───────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER functions are executable by PUBLIC until told otherwise; both writers are revoked
-- from anon and handed back to the API roles explicitly. The trigger guards keep the default ACL —
-- PostgreSQL refuses to call a trigger function outside a trigger anyway.
REVOKE ALL ON FUNCTION estate_occupancy_admit(UUID, UUID, UUID, UUID, TEXT, DATE, DATE, TEXT, BOOLEAN)
    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION estate_occupancy_release(UUID, UUID, UUID, UUID, TEXT)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION estate_occupancy_admit(UUID, UUID, UUID, UUID, TEXT, DATE, DATE, TEXT, BOOLEAN)
    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION estate_occupancy_release(UUID, UUID, UUID, UUID, TEXT)
    TO authenticated, service_role;
