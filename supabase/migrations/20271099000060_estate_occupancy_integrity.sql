-- Estate occupancy integrity (UAT lane estate-a, module M03) — close-out Phase 2.4.
-- Additive only — no DROP, no RENAME, no type narrowing, no backfill that can lose data.
--
-- M03 held four rows the code could not answer, and the reason was the same in every case: nothing in
-- the schema recorded *who occupies which unit*. `estate_residents` is one row per (estate, user) with
-- a free-text `unit` label and no foreign key, so occupancy was not countable; `estate_properties` had
-- no capacity; a tenancy approval threw away the lease dates it had just been given; a unit's owner and
-- its tenant were two UUID columns with no rule between them; and dues took whatever amount the caller
-- typed. That is these four cases:
--
--   EST-UAT-0044  owner and tenant overlap validated   → estate_unit_occupants + two partial uniques
--                                                        (one live owner, one live tenant per unit) +
--                                                        capacity on the unit + one admitting writer
--                                                        estate_occupancy_admit()
--   EST-UAT-0045  move-in effective date gates things  → effective_from / effective_until on the
--                                                        occupancy row, read by the membership check
--                                                        (access) and by estate_enforce_out_of_term_billing
--                                                        (dues)
--   EST-UAT-0048  vacant-unit fee policy               → a vacant unit cannot be billed unless the
--                                                        invoice carries an explicit override and a
--                                                        reason (the product rule chosen: exemption,
--                                                        not a discount)
--   EST-UAT-0051  occupancy proof verification         → resident_profiles.proof_* state, and the
--                                                        reviewer identity tenancy_requests was missing
--
-- Design decision worth stating: occupancy is a NEW relation, not a column on `estate_residents`.
-- Adding `property_id` there cannot work — that table is `UNIQUE (estate_id, user_id)`, so one account
-- could only ever be attached to one unit, which is the opposite of EST-UAT-0043 (one customer,
-- multiple units, records kept per unit). One row per (unit, person) is also what makes "overlap beyond
-- capacity" a countable predicate instead of a string comparison.
--
-- Deliberate limits, recorded rather than hidden:
--   * capacity counts *occupancy registrations*. Household members and domestic staff recorded on a
--     profile are dependants listed in `household_members`/`domestic_staff`; they are not occupancy
--     rows and do not consume a bed. A manager who needs dependants counted has to register them.
--   * Existing `estate_residents` rows get no occupancy row from this migration. A member with no
--     registration is treated exactly as today (EST-UAT-0045's "NULL = unrestricted" rule) — backfilling
--     one from a free-text `unit` label would invent occupancy data the ledger then has to disbelieve.
--   * A unit that becomes vacant after being billed keeps its existing receivable. The exemption is a
--     rule about *raising* a charge, enforced on INSERT only; arrears do not evaporate because somebody
--     moved out.

-- ─── unit capacity ────────────────────────────────────────────────────────────

ALTER TABLE estate_properties
    ADD COLUMN IF NOT EXISTS capacity INTEGER NOT NULL DEFAULT 6;

COMMENT ON COLUMN estate_properties.capacity IS
    'EST-UAT-0044: how many occupancy registrations the unit accepts. Default 6 — a household, not a hotel room. Enforced by estate_enforce_unit_capacity and by estate_occupancy_admit.';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estate_properties_capacity_positive') THEN
        ALTER TABLE estate_properties
            ADD CONSTRAINT estate_properties_capacity_positive CHECK (capacity > 0);
    END IF;
END $$;

-- ─── occupancy registrations (EST-UAT-0044 / 0045 / 0043) ─────────────────────

CREATE TABLE IF NOT EXISTS estate_unit_occupants (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id      UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    property_id    UUID NOT NULL REFERENCES estate_properties(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES auth.users(id),
    occupancy_type TEXT NOT NULL DEFAULT 'resident'
                        CHECK (occupancy_type IN ('resident', 'tenant', 'homeowner')),
    effective_from DATE,
    effective_until DATE,
    admitted_by    UUID,
    note           TEXT,
    ended_at       TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (property_id, user_id),
    -- A registration whose move-out precedes its move-in is a data-entry error that would silently
    -- never admit anybody; refuse it here rather than in one service.
    CONSTRAINT estate_unit_occupants_window_ordered
        CHECK (effective_from IS NULL OR effective_until IS NULL OR effective_until >= effective_from)
);

-- One live owner and one live tenant per unit, in the database. These two indexes ARE the overlap rule
-- of EST-UAT-0044: no service, BFF or psql session can create a second current owner of a unit, and a
-- released registration (ended_at) frees the slot for its successor without deleting the history.
CREATE UNIQUE INDEX IF NOT EXISTS estate_unit_occupants_one_live_owner
    ON estate_unit_occupants (property_id)
    WHERE occupancy_type = 'homeowner' AND ended_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS estate_unit_occupants_one_live_tenant
    ON estate_unit_occupants (property_id)
    WHERE occupancy_type = 'tenant' AND ended_at IS NULL;

-- EST-UAT-0043: "one customer, multiple units" is a lookup on the person, per estate.
CREATE INDEX IF NOT EXISTS estate_unit_occupants_user_idx
    ON estate_unit_occupants (estate_id, user_id);
CREATE INDEX IF NOT EXISTS estate_unit_occupants_live_idx
    ON estate_unit_occupants (property_id) WHERE ended_at IS NULL;

COMMENT ON TABLE estate_unit_occupants IS
    'Who occupies which unit, from when to when, as owner, tenant or plain resident. The estate membership row (estate_residents) says a person belongs to the estate; this says which door they belong to.';

-- Capacity is enforced where the write happens, so no caller path can skip it.
CREATE OR REPLACE FUNCTION estate_enforce_unit_capacity()
RETURNS trigger LANGUAGE plpgsql AS $$
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
END $$;

DROP TRIGGER IF EXISTS estate_enforce_unit_capacity_on_write ON estate_unit_occupants;
CREATE TRIGGER estate_enforce_unit_capacity_on_write
    BEFORE INSERT OR UPDATE ON estate_unit_occupants
    FOR EACH ROW EXECUTE FUNCTION estate_enforce_unit_capacity();

-- ─── one admitting writer (EST-UAT-0044) ──────────────────────────────────────
--
-- Admitting an occupant is four writes that only make sense together: the residency (so the person can
-- act in the estate), the occupancy registration (capacity + overlap), the unit's party column
-- (owner/tenant, which the voting roll and the analytics read), and the profile label the resident card
-- prints. Before this, each caller did a subset: a tenancy approval wrote the first two and could
-- DEMOTE an estate_admin to resident while doing it, an ownership-claim approval wrote none of them,
-- and an admin assignment wrote only the third. One writer means one rule set.
DROP FUNCTION IF EXISTS estate_occupancy_admit(UUID, UUID, UUID, UUID, TEXT, DATE, DATE, TEXT);
CREATE OR REPLACE FUNCTION estate_occupancy_admit(
    p_estate        UUID,
    p_property      UUID,
    p_user          UUID,
    p_actor         UUID,
    p_kind          TEXT,
    p_from          DATE,
    p_until         DATE,
    p_note          TEXT,
    p_replace_owner BOOLEAN
) RETURNS TABLE (out_occupant_id UUID, out_resident_id UUID, out_role TEXT, out_occupancy_type TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
END $$;

REVOKE ALL ON FUNCTION estate_occupancy_admit(UUID, UUID, UUID, UUID, TEXT, DATE, DATE, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION estate_occupancy_admit(UUID, UUID, UUID, UUID, TEXT, DATE, DATE, TEXT, BOOLEAN) TO service_role, authenticated;

-- ─── one releasing writer (EST-UAT-0046) ──────────────────────────────────────
--
-- Move-out was, until here, account deletion. Ending an occupancy has to keep the history (the ledger
-- and the audit trail both point at it) while freeing the unit's owner/tenant slot and recomputing
-- whether anybody is still in the unit.
DROP FUNCTION IF EXISTS estate_occupancy_release(UUID, UUID, UUID, UUID, TEXT);
CREATE OR REPLACE FUNCTION estate_occupancy_release(
    p_estate   UUID,
    p_property UUID,
    p_user     UUID,
    p_actor    UUID,
    p_reason   TEXT
) RETURNS TABLE (out_occupant_id UUID, out_occupancy_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
END $$;

REVOKE ALL ON FUNCTION estate_occupancy_release(UUID, UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION estate_occupancy_release(UUID, UUID, UUID, UUID, TEXT) TO service_role, authenticated;

-- ─── vacant units are exempt from dues (EST-UAT-0048) ─────────────────────────
--
-- The product rule adopted here is exemption rather than a discounted rate: an invoice may not be
-- raised against a unit that is recorded as vacant. The escape hatch is explicit and auditable — an
-- override flag that requires a reason — because a managing agent does legitimately bill an empty unit
-- sometimes (a levy that funds the vacant unit's security, a charge raised before the vacancy date).

ALTER TABLE estate_dues_invoices
    ADD COLUMN IF NOT EXISTS vacancy_override        BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS vacancy_override_reason TEXT;

COMMENT ON COLUMN estate_dues_invoices.vacancy_override IS
    'EST-UAT-0048: bill a vacant unit anyway. Requires vacancy_override_reason; audited as INVOICE_VACANCY_OVERRIDE.';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estate_dues_invoices_vacancy_override_reason') THEN
        ALTER TABLE estate_dues_invoices
            ADD CONSTRAINT estate_dues_invoices_vacancy_override_reason
            CHECK (NOT vacancy_override OR btrim(COALESCE(vacancy_override_reason, '')) <> '');
    END IF;
END $$;

CREATE OR REPLACE FUNCTION estate_enforce_vacant_unit_exemption()
RETURNS trigger LANGUAGE plpgsql AS $$
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
END $$;

-- INSERT only, on purpose: a receivable raised while the unit was occupied is still owed after the
-- occupant leaves, and refusing the payment update would make the arrear unpayable.
DROP TRIGGER IF EXISTS estate_enforce_vacant_unit_exemption_on_create ON estate_dues_invoices;
CREATE TRIGGER estate_enforce_vacant_unit_exemption_on_create
    BEFORE INSERT ON estate_dues_invoices
    FOR EACH ROW EXECUTE FUNCTION estate_enforce_vacant_unit_exemption();

-- The other half of the same product decision (EST-UAT-0045: "outside the window a member is not
-- charged"). A unit can still be occupied — by a co-resident, a family member, the owner — while the
-- person being billed has a registration on it whose term excludes today. The vacancy rule cannot see
-- that, because the unit is not vacant.
--
-- Separate column pair and separate trigger rather than one broadened rule, so each exemption names the
-- product decision it implements and an override is never ambiguous about which rule it waived.
ALTER TABLE estate_dues_invoices
    ADD COLUMN IF NOT EXISTS term_override        BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS term_override_reason TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estate_dues_invoices_term_override_reason') THEN
        ALTER TABLE estate_dues_invoices
            ADD CONSTRAINT estate_dues_invoices_term_override_reason
            CHECK (NOT term_override OR btrim(COALESCE(term_override_reason, '')) <> '');
    END IF;
END $$;

CREATE OR REPLACE FUNCTION estate_enforce_out_of_term_billing()
RETURNS trigger LANGUAGE plpgsql AS $$
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
END $$;

DROP TRIGGER IF EXISTS estate_enforce_out_of_term_billing_on_create ON estate_dues_invoices;
CREATE TRIGGER estate_enforce_out_of_term_billing_on_create
    BEFORE INSERT ON estate_dues_invoices
    FOR EACH ROW EXECUTE FUNCTION estate_enforce_out_of_term_billing();

-- ─── occupancy proof verification (EST-UAT-0051) ──────────────────────────────
--
-- Before this the module stored a document URL and nothing else: `resident_profiles.occupancy_type`
-- (the word printed on the resident ID card a guard reads) was pure self-declaration, changeable at
-- will, with no state between "the resident said so" and "the estate checked". These columns make that
-- distinction exist in the database instead of in a comment.

ALTER TABLE resident_profiles
    ADD COLUMN IF NOT EXISTS proof_status       TEXT    NOT NULL DEFAULT 'unverified',
    ADD COLUMN IF NOT EXISTS proof_verified_by  UUID    REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS proof_verified_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS proof_review_note  TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resident_profiles_proof_status_check') THEN
        ALTER TABLE resident_profiles
            ADD CONSTRAINT resident_profiles_proof_status_check
            CHECK (proof_status IN ('unverified', 'pending', 'verified', 'rejected'));
    END IF;
END $$;

COMMENT ON COLUMN resident_profiles.proof_status IS
    'EST-UAT-0051: what the estate has done about the declared documents. unverified/pending/verified/rejected; reset whenever a document is replaced.';

CREATE OR REPLACE FUNCTION estate_reset_proof_on_redeclaration()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    -- A fresh document is a fresh claim. The previous approval covered the old file, so it must not
    -- survive the swap — otherwise 'verified' would certify a document nobody reviewed.
    IF NEW.ownership_doc_url IS DISTINCT FROM OLD.ownership_doc_url
       OR NEW.agreement_url IS DISTINCT FROM OLD.agreement_url THEN
        NEW.proof_status      := 'unverified';
        NEW.proof_verified_by := NULL;
        NEW.proof_verified_at := NULL;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS estate_reset_proof_on_redeclaration_on_write ON resident_profiles;
CREATE TRIGGER estate_reset_proof_on_redeclaration_on_write
    BEFORE UPDATE ON resident_profiles
    FOR EACH ROW EXECUTE FUNCTION estate_reset_proof_on_redeclaration();

-- The tenancy review path could set a status but could not say who did it or why it was refused;
-- `estate_join_requests` and `property_ownership_claims` both already carried these.
ALTER TABLE tenancy_requests
    ADD COLUMN IF NOT EXISTS reviewed_by  UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS reject_reason TEXT;

-- Ownership claims are reviewed from a queue, and the queue was un-indexable (there was no reader of
-- this table at all, so no query shape existed for it).
CREATE INDEX IF NOT EXISTS property_ownership_claims_pending_idx
    ON property_ownership_claims (status, created_at);

-- ─── RLS: service-role only ──────────────────────────────────────────────────

ALTER TABLE estate_unit_occupants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS occupancy_service ON estate_unit_occupants;
CREATE POLICY occupancy_service ON estate_unit_occupants TO service_role USING (true) WITH CHECK (true);

-- ─── take the writers off the anon role ──────────────────────────────────────
--
-- Supabase's default privileges grant EXECUTE on every function created in `public` to the named roles
-- `anon`, `authenticated` and `service_role`. `REVOKE ALL ... FROM PUBLIC` above does not remove a
-- *named* grant, so both SECURITY DEFINER writers stayed callable by an unauthenticated REST caller —
-- verified before this block existed: as `anon`, estate_occupancy_admit() ran far enough to raise
-- 'unit not found in this estate' from inside its own body.
--
-- That matters more here than the ACL alone suggests, because `auth.uid()` is NULL for `anon`, and the
-- "the actor must be the authenticated caller" guard is deliberately conditional — it has to be, since
-- the Go service calls these writers as service_role with no JWT at all. Removing anon closes the only
-- path where a NULL auth.uid() meant "no caller to check" rather than "trusted backend caller".
-- `estate_owner_transfer_decide` shipped the same way in 20271099000040; it is fixed forward here
-- rather than by editing an applied migration.
REVOKE ALL ON FUNCTION estate_occupancy_admit(UUID, UUID, UUID, UUID, TEXT, DATE, DATE, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION estate_occupancy_admit(UUID, UUID, UUID, UUID, TEXT, DATE, DATE, TEXT, BOOLEAN) TO service_role, authenticated;

REVOKE ALL ON FUNCTION estate_occupancy_release(UUID, UUID, UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION estate_occupancy_release(UUID, UUID, UUID, UUID, TEXT) TO service_role, authenticated;

REVOKE ALL ON FUNCTION estate_owner_transfer_decide(UUID, UUID, UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION estate_owner_transfer_decide(UUID, UUID, UUID, BOOLEAN, TEXT) TO service_role, authenticated;

-- estate_cast_vote is different in kind, and the difference is worth spelling out: it takes p_voter_id as
-- an argument and never compares it to auth.uid(), because the Go service and the BFF admin client both
-- call it as service_role and pass the voter deliberately. Leaving it executable by anon or authenticated
-- therefore let any REST caller cast a ballot *as somebody else* in an open election — a P0 voting
-- integrity hole, not a defence-in-depth nit. Those two grants are removed outright. Both callers run as
-- service_role (backend/internal/estate/service.go:410 and frontend-web/app/api/v1/elections/[id]/vote/route.ts:86
-- via createAdminClient), and no mobile or contract caller exists, so no supported path loses access.
REVOKE ALL ON FUNCTION estate_cast_vote(UUID, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION estate_cast_vote(UUID, UUID, UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION estate_cast_vote(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION estate_cast_vote(UUID, UUID, UUID) TO service_role;
