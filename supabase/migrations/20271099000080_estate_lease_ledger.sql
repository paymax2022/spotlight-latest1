-- Estate lease and deposit ledger (UAT lane estate-d, module M23) — close-out Phase 2.5b.
-- Additive only — no DROP, no RENAME, no type narrowing, no backfill that can lose data.
-- Re-appliable: every statement is IF NOT EXISTS / OR REPLACE / DROP-then-CREATE.
--
-- EST-UAT-0434 proved the importer can carry an estate's opening *dues* balances; EST-UAT-0435
-- ("opening rent balances", P0) could not be answered at all, and the reason was structural: nothing in
-- the schema held a lease. `estate_properties` has a `tenant_id` column and `tenancy_requests` a
-- start/end pair, but there is no record of the commercial terms a legacy roll actually carries — rent
-- amount, deposit amount, deposit disposition, term — and therefore nowhere for a rent receivable to
-- point. A rent invoice with no lease behind it is a number with no obligation attached, which is how
-- EST-UAT-0438's duplicated rent line becomes undetectable.
--
--   EST-UAT-0435  opening rent balances      → estate_leases (unit, tenant, term, rent, deposit) plus
--                                                estate_dues_invoices.lease_id, so an imported rent
--                                                receivable names the obligation it settles
--   EST-UAT-0438  duplicate historic payment → the same lease_id makes a duplicated rent line visible:
--                                                two open receivables against one lease and one term
--   EST-UAT-0440  dry-run counts comparison  → the ledger's destination counts (leases, deposit held)
--                                                join the reconciliation block the dry-run already
--                                                returns
--   EST-UAT-0439  bad legacy date            → term ordering is refused as a row exception by the
--                                                importer AND by a CHECK here, so neither writer can
--                                                land a reversed term
--
-- Design decisions worth stating:
--   * A lease is a NEW relation, not more columns on `estate_properties`. The party columns record who
--     is there now; they cannot hold a term that has not started, a deposit refunded under an earlier
--     tenancy, or the two leases one unit has had this year. Occupancy (20271099000060) answers "who is
--     behind this door"; this answers "under what terms, for how long, and who holds the money".
--   * The deposit is *state on the ledger*, not a money movement. No `estate_payments` row and no ledger
--     posting is written here: a deposit the estate holds is disclosed as an amount with a disposition
--     (unpaid|held|applied|refunded|forfeited) and the transition that set it, which is what a legacy
--     roll records. Settling it for real stays the payments surface's job.
--   * Rules live in a trigger, not in a service, so every writer — the lease routes, the bulk importer,
--     and any future BFF mirror — passes the same gate, exactly as occupancy's capacity rule does.
--   * `status` is never free-handled by the insert path: the record writer derives active/expired from
--     the term it is given, and only the disposition writer can say 'terminated'.
--
-- Deliberate limits, recorded rather than hidden:
--   * A lease does not create an occupancy registration and does not touch the unit's party columns.
--     Admitting a person to a unit remains estate_occupancy_admit()'s decision (capacity, overlap,
--     residency promotion); recording the terms they signed is a separate one. ESTD-D034 already records
--     that the importer does not admit, so an imported estate can hold a lease with no registration.
--   * A rent charge on a unit with no lease stays possible, with an explicit override and a reason —
--     the same posture EST-UAT-0048 chose for vacant units. Refusing it outright would make the dues
--     surface unusable for estates whose leases are still on paper.
--   * Terms are not re-amortised when a lease is amended: changing rent or deposit on a lease that has
--     already been billed is refused, because the number a resident was charged against must not move
--     underneath them. Correct it with a new charge.

-- ─── the lease ledger ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS estate_leases (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id      UUID NOT NULL REFERENCES estates(id) ON DELETE CASCADE,
    property_id    UUID NOT NULL REFERENCES estate_properties(id) ON DELETE CASCADE,
    tenant_id      UUID NOT NULL REFERENCES auth.users(id),
    landlord_id    UUID REFERENCES auth.users(id),
    status         TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'expired', 'terminated')),
    start_date     DATE NOT NULL,
    end_date       DATE,
    rent_kobo      BIGINT NOT NULL DEFAULT 0 CHECK (rent_kobo >= 0),
    rent_interval  TEXT NOT NULL DEFAULT 'monthly'
                       CHECK (rent_interval IN ('weekly', 'monthly', 'quarterly', 'yearly', 'one_off')),
    deposit_kobo   BIGINT NOT NULL DEFAULT 0 CHECK (deposit_kobo >= 0),
    deposit_status TEXT NOT NULL DEFAULT 'unpaid'
                       CHECK (deposit_status IN ('unpaid', 'held', 'applied', 'refunded', 'forfeited')),
    deposit_reason TEXT,
    note           TEXT,
    source         TEXT NOT NULL DEFAULT 'native' CHECK (source IN ('native', 'import')),
    created_by     UUID,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- EST-UAT-0435 / 0439: the term a roll carries has to be a term. A reversed range is refused here as
    -- well as in the importer, because the importer is not the only writer.
    CONSTRAINT estate_leases_term_ordered
        CHECK (end_date IS NULL OR end_date >= start_date),
    -- EST-UAT-0044's overlap rule, lease side: one account cannot be both sides of the agreement.
    CONSTRAINT estate_leases_parties_differ
        CHECK (landlord_id IS NULL OR landlord_id <> tenant_id),
    -- A deposit state with nothing to hold is a data-entry error, not a zero deposit.
    CONSTRAINT estate_leases_deposit_coherent
        CHECK (deposit_kobo > 0 OR deposit_status = 'unpaid'),
    -- A disposition is a decision, so it is never anonymous (same rule as the dues overrides).
    CONSTRAINT estate_leases_disposition_reason
        CHECK (deposit_status = 'unpaid' OR btrim(COALESCE(deposit_reason, '')) <> '')
);

COMMENT ON TABLE estate_leases IS
    'The commercial terms an estate agreed for one unit: who holds it as tenant, for what term, at what rent, and what the estate owes back as a deposit. Occupancy says who is in the unit; this says under what terms.';
COMMENT ON COLUMN estate_leases.deposit_status IS
    'EST-UAT-0435: disposition of the tenant deposit on the ledger — unpaid|held|applied|refunded|forfeited. State the estate asserts, not a money movement.';

-- One current lease per unit, in the database. A closed lease frees the slot and the history stays,
-- which is what lets an imported roll carry the tenancy that ended last year beside the one running now.
CREATE UNIQUE INDEX IF NOT EXISTS estate_leases_one_active_per_unit
    ON estate_leases (property_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS estate_leases_estate_idx
    ON estate_leases (estate_id, status);
CREATE INDEX IF NOT EXISTS estate_leases_tenant_idx
    ON estate_leases (estate_id, tenant_id);
CREATE INDEX IF NOT EXISTS estate_leases_landlord_idx
    ON estate_leases (estate_id, landlord_id) WHERE landlord_id IS NOT NULL;

-- ─── the lease rules, where the write happens ─────────────────────────────────
--
-- Six rules, none of which any single service could keep to on its own, because there is more than one
-- writer: the lease routes, the bulk importer, and the disposition path all touch this table.
CREATE OR REPLACE FUNCTION estate_enforce_lease_integrity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_prop estate_properties%ROWTYPE;
BEGIN
    SELECT * INTO v_prop
    FROM estate_properties
    WHERE id = NEW.property_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'unit not found' USING ERRCODE = 'P0002';
    END IF;
    -- The lease claims an estate; a unit in another estate is a mis-pathed or forged request — the same
    -- IDOR class ESTA-D030 found on the occupancy surface.
    IF v_prop.estate_id <> NEW.estate_id THEN
        RAISE EXCEPTION 'unit belongs to another estate' USING ERRCODE = '42501';
    END IF;
    IF v_prop.archived THEN
        RAISE EXCEPTION 'unit is archived' USING ERRCODE = '55000';
    END IF;

    -- A lease is also what makes a tenant somebody the estate carries, so the membership has to exist
    -- (and be live) before the terms do. A rent receivable would otherwise bill a non-member.
    IF NOT EXISTS (
        SELECT 1 FROM estate_residents r
        WHERE r.estate_id = NEW.estate_id AND r.user_id = NEW.tenant_id
          AND r.deleted_at IS NULL AND r.banned_at IS NULL
    ) THEN
        RAISE EXCEPTION 'tenant is not a member of this estate' USING ERRCODE = '55000';
    END IF;
    IF NEW.landlord_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM estate_residents r
        WHERE r.estate_id = NEW.estate_id AND r.user_id = NEW.landlord_id
          AND r.deleted_at IS NULL AND r.banned_at IS NULL
    ) THEN
        RAISE EXCEPTION 'landlord is not a member of this estate' USING ERRCODE = '55000';
    END IF;

    -- EST-UAT-0435: a lease whose term has run is history, and history is recorded as expired or
    -- terminated. 'active' with an end date in the past would make the out-of-term dues rule and every
    -- vacancy count in the module disagree with the ledger.
    IF NEW.status = 'active' AND NEW.end_date IS NOT NULL AND NEW.end_date < CURRENT_DATE THEN
        RAISE EXCEPTION 'a lease whose term has ended cannot be active' USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- A lease is between a named tenant and a named unit. Re-pointing either would silently move
        -- every receivable already attached to it; the successor is a new lease.
        IF OLD.property_id <> NEW.property_id OR OLD.tenant_id <> NEW.tenant_id THEN
            RAISE EXCEPTION 'the unit and the tenant of a lease are fixed' USING ERRCODE = '55000';
        END IF;
        IF OLD.status <> 'active' AND NEW.status = 'active' THEN
            RAISE EXCEPTION 'a closed lease cannot be reopened' USING ERRCODE = '55000';
        END IF;
        -- The deposit machine: unpaid -> held -> applied|refunded|forfeited, and a final state is final.
        IF OLD.deposit_status <> NEW.deposit_status THEN
            IF OLD.deposit_status = 'unpaid' AND NEW.deposit_status <> 'held' THEN
                RAISE EXCEPTION 'a deposit has to be held before it can be %', NEW.deposit_status
                    USING ERRCODE = '55000';
            END IF;
            IF OLD.deposit_status IN ('applied', 'refunded', 'forfeited') THEN
                RAISE EXCEPTION 'the deposit disposition is already final' USING ERRCODE = '55000';
            END IF;
        END IF;
        IF OLD.deposit_status <> 'unpaid' AND OLD.deposit_kobo <> NEW.deposit_kobo THEN
            RAISE EXCEPTION 'the deposit amount is fixed once the estate holds it' USING ERRCODE = '55000';
        END IF;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS estate_enforce_lease_integrity_on_write ON estate_leases;
CREATE TRIGGER estate_enforce_lease_integrity_on_write
    BEFORE INSERT OR UPDATE ON estate_leases
    FOR EACH ROW EXECUTE FUNCTION estate_enforce_lease_integrity();

-- A lease that has received money is not deletable: the receivable would keep pointing at a row that no
-- longer exists (ON DELETE SET NULL would silently un-name it), and the deposit it holds would vanish
-- from the ledger while still being owed.
CREATE OR REPLACE FUNCTION estate_block_lease_deletion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM estate_dues_invoices i WHERE i.lease_id = OLD.id)
       OR OLD.deposit_status IN ('held', 'applied', 'refunded', 'forfeited') THEN
        RAISE EXCEPTION 'a lease with rent receivables or a deposit on record cannot be deleted — close it with a disposition instead'
            USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS estate_block_lease_deletion_on_delete ON estate_leases;
CREATE TRIGGER estate_block_lease_deletion_on_delete
    BEFORE DELETE ON estate_leases
    FOR EACH ROW EXECUTE FUNCTION estate_block_lease_deletion();

-- ─── rent receivables name the lease they settle (EST-UAT-0435 / 0438) ─────────

ALTER TABLE estate_dues_invoices
    ADD COLUMN IF NOT EXISTS lease_id UUID REFERENCES estate_leases(id) ON DELETE SET NULL;

-- A receivable that waives the naming rule is a decision, so it carries a reason the same way the two
-- occupancy exemptions do (20271099000060).
ALTER TABLE estate_dues_invoices
    ADD COLUMN IF NOT EXISTS lease_override BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS lease_override_reason TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estate_dues_invoices_lease_override_reason') THEN
        ALTER TABLE estate_dues_invoices
            ADD CONSTRAINT estate_dues_invoices_lease_override_reason
            CHECK (NOT lease_override OR btrim(COALESCE(lease_override_reason, '')) <> '');
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS estate_dues_invoices_lease_idx
    ON estate_dues_invoices (estate_id, lease_id) WHERE lease_id IS NOT NULL;

COMMENT ON COLUMN estate_dues_invoices.lease_id IS
    'EST-UAT-0435: the lease a rent charge settles. Set for every imported rent receivable; the naming rule below is what makes a duplicated legacy rent line detectable instead of invisible.';

-- Rent follows the lease. Enforced on INSERT so no writer — route, BFF, importer or psql — can raise a
-- rent charge that disagrees with the ledger about who owes it or for which unit.
CREATE OR REPLACE FUNCTION estate_enforce_lease_receivable()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_lease estate_leases%ROWTYPE;
BEGIN
    IF NEW.category <> 'rent' THEN
        RETURN NEW;
    END IF;

    IF NEW.lease_id IS NOT NULL THEN
        SELECT * INTO v_lease FROM estate_leases WHERE id = NEW.lease_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'the lease this rent charge names does not exist' USING ERRCODE = '23514';
        END IF;
        IF v_lease.estate_id <> NEW.estate_id THEN
            RAISE EXCEPTION 'the lease this rent charge names belongs to another estate' USING ERRCODE = '42501';
        END IF;
        IF v_lease.tenant_id <> NEW.resident_id THEN
            RAISE EXCEPTION 'a rent charge must name the lease of the resident it bills' USING ERRCODE = '23514';
        END IF;
        IF NEW.property_id IS NOT NULL AND NEW.property_id <> v_lease.property_id THEN
            RAISE EXCEPTION 'a rent charge must name the unit its lease covers' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.lease_override THEN
        RETURN NEW;
    END IF;

    IF NEW.property_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM estate_leases l
        WHERE l.property_id = NEW.property_id AND l.status = 'active'
    ) THEN
        RAISE EXCEPTION 'this unit has an active lease — a rent charge against it must name the lease, or carry an explicit override and a reason'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS estate_enforce_lease_receivable_on_create ON estate_dues_invoices;
CREATE TRIGGER estate_enforce_lease_receivable_on_create
    BEFORE INSERT ON estate_dues_invoices
    FOR EACH ROW EXECUTE FUNCTION estate_enforce_lease_receivable();

-- ─── one recording writer ─────────────────────────────────────────────────────
--
-- Both halves of a lease decision used to be missing entirely, so this is the only door: it takes the
-- term and the money, derives the status from the term rather than from a caller's word, and writes the
-- audit line beside the row. An insert that lands a lease without an audit row is the failure ESTD-D040
-- records for refused writes; doing it here means the pair cannot come apart.
CREATE OR REPLACE FUNCTION estate_lease_record(
    p_estate   UUID,
    p_actor    UUID,
    p_lease    UUID,
    p_property UUID,
    p_tenant   UUID,
    p_landlord UUID,
    p_start    DATE,
    p_end      DATE,
    p_rent     BIGINT,
    p_interval TEXT,
    p_deposit  BIGINT,
    p_note     TEXT
) RETURNS TABLE (out_lease_id UUID, out_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_existing estate_leases%ROWTYPE;
    v_is_admin BOOLEAN;
    v_billed   BOOLEAN;
    v_status   TEXT;
    v_new_id   UUID;
    v_returned TEXT;
BEGIN
    IF p_interval NOT IN ('weekly', 'monthly', 'quarterly', 'yearly', 'one_off') THEN
        RAISE EXCEPTION 'unknown rent interval %', p_interval USING ERRCODE = '22023';
    END IF;
    IF p_rent < 0 OR p_deposit < 0 THEN
        RAISE EXCEPTION 'rent and deposit cannot be negative' USING ERRCODE = '22023';
    END IF;
    IF p_end IS NOT NULL AND p_end < p_start THEN
        RAISE EXCEPTION 'the lease end precedes its start' USING ERRCODE = '22023';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM estate_residents r
        WHERE r.estate_id = p_estate AND r.user_id = p_actor AND r.role = 'estate_admin'
          AND r.deleted_at IS NULL AND r.banned_at IS NULL
    ) INTO v_is_admin;
    -- Through PostgREST the caller holds a JWT; naming an admin while authenticated as somebody else
    -- must not work, exactly as in estate_occupancy_admit.
    IF auth.uid() IS NOT NULL AND auth.uid() <> p_actor THEN
        RAISE EXCEPTION 'actor must be the authenticated caller' USING ERRCODE = '42501';
    END IF;
    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'only an estate admin can record a lease' USING ERRCODE = '42501';
    END IF;

    -- The status is a fact about the term, not a caller's preference.
    v_status := CASE WHEN p_end IS NULL OR p_end >= CURRENT_DATE THEN 'active' ELSE 'expired' END;

    IF p_lease IS NULL THEN
        INSERT INTO estate_leases
            (estate_id, property_id, tenant_id, landlord_id, status, start_date, end_date,
             rent_kobo, rent_interval, deposit_kobo, note, source, created_by)
        VALUES (p_estate, p_property, p_tenant, p_landlord, v_status, p_start, p_end,
                p_rent, p_interval, p_deposit, NULLIF(btrim(COALESCE(p_note, '')), ''), 'native', p_actor)
        RETURNING id, status INTO v_new_id, v_returned;
    ELSE
        SELECT * INTO v_existing FROM estate_leases
        WHERE id = p_lease AND estate_id = p_estate
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'lease not found in this estate' USING ERRCODE = 'P0002';
        END IF;
        IF v_existing.status = 'terminated' THEN
            RAISE EXCEPTION 'a terminated lease cannot be amended' USING ERRCODE = '55000';
        END IF;

        SELECT EXISTS (SELECT 1 FROM estate_dues_invoices i WHERE i.lease_id = p_lease) INTO v_billed;
        IF v_billed AND (v_existing.rent_kobo <> p_rent OR v_existing.deposit_kobo <> p_deposit) THEN
            RAISE EXCEPTION 'the terms of a lease that has been billed cannot be amended' USING ERRCODE = '55000';
        END IF;

        UPDATE estate_leases
           SET landlord_id   = COALESCE(p_landlord, estate_leases.landlord_id),
               start_date    = p_start,
               end_date      = p_end,
               -- Amending the term can run a lease out; it cannot run one back. The trigger refuses a
               -- closed lease returning to 'active', so a shortening is recorded as expired here.
               status        = CASE WHEN estate_leases.status <> 'active' THEN estate_leases.status
                                    ELSE v_status END,
               rent_kobo     = p_rent,
               rent_interval = p_interval,
               deposit_kobo  = p_deposit,
               note          = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), estate_leases.note),
               updated_at    = NOW()
         WHERE id = p_lease
        RETURNING id, status INTO v_new_id, v_returned;
    END IF;

    INSERT INTO estate_audit_log (estate_id, actor_id, action, subject_type, subject_id, metadata)
    VALUES (p_estate, p_actor,
            CASE WHEN p_lease IS NULL THEN 'ESTATE_LEASE_RECORDED' ELSE 'ESTATE_LEASE_AMENDED' END,
            'lease', v_new_id::text,
            jsonb_build_object('property_id', p_property, 'tenant_id', p_tenant,
                               'start_date', p_start, 'end_date', p_end,
                               'rent_kobo', p_rent, 'rent_interval', p_interval,
                               'deposit_kobo', p_deposit, 'status', v_returned));

    RETURN QUERY SELECT v_new_id, v_returned;
END $$;

-- ─── one disposition writer ───────────────────────────────────────────────────
--
-- "The tenancy ended" and "the deposit came back" are the two decisions a lease ledger exists to record
-- after signature, and neither of them is a free-text field: the trigger owns the legal transitions, so
-- a closed lease cannot be reopened and a refunded deposit cannot be moved again. Both halves of the
-- reason are required because both are questions a later auditor asks.
CREATE OR REPLACE FUNCTION estate_lease_disposition(
    p_estate  UUID,
    p_lease   UUID,
    p_actor   UUID,
    p_status  TEXT,
    p_deposit TEXT,
    p_reason  TEXT
) RETURNS TABLE (out_status TEXT, out_deposit_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_lease    estate_leases%ROWTYPE;
    v_is_admin BOOLEAN;
    v_status   TEXT;
    v_deposit  TEXT;
    v_returned_status  TEXT;
    v_returned_deposit TEXT;
BEGIN
    IF btrim(COALESCE(p_reason, '')) = '' THEN
        RAISE EXCEPTION 'a lease disposition needs a reason' USING ERRCODE = '22023';
    END IF;
    IF p_status IS NOT NULL AND p_status NOT IN ('expired', 'terminated') THEN
        RAISE EXCEPTION 'unknown lease status %', p_status USING ERRCODE = '22023';
    END IF;
    IF p_deposit IS NOT NULL AND p_deposit NOT IN ('held', 'applied', 'refunded', 'forfeited') THEN
        RAISE EXCEPTION 'unknown deposit disposition %', p_deposit USING ERRCODE = '22023';
    END IF;
    IF p_status IS NULL AND p_deposit IS NULL THEN
        RAISE EXCEPTION 'a disposition changes the lease status, the deposit state, or both' USING ERRCODE = '22023';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM estate_residents r
        WHERE r.estate_id = p_estate AND r.user_id = p_actor AND r.role = 'estate_admin'
          AND r.deleted_at IS NULL AND r.banned_at IS NULL
    ) INTO v_is_admin;
    IF auth.uid() IS NOT NULL AND auth.uid() <> p_actor THEN
        RAISE EXCEPTION 'actor must be the authenticated caller' USING ERRCODE = '42501';
    END IF;
    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'only an estate admin can dispose of a lease' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_lease FROM estate_leases
    WHERE id = p_lease AND estate_id = p_estate
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'lease not found in this estate' USING ERRCODE = 'P0002';
    END IF;

    v_status  := COALESCE(p_status, v_lease.status);
    v_deposit := COALESCE(p_deposit, v_lease.deposit_status);

    UPDATE estate_leases
       SET status         = v_status,
           deposit_status = v_deposit,
           deposit_reason = CASE WHEN p_deposit IS NULL THEN estate_leases.deposit_reason ELSE p_reason END,
           updated_at     = NOW()
     WHERE id = p_lease
    RETURNING status, deposit_status INTO v_returned_status, v_returned_deposit;

    INSERT INTO estate_audit_log (estate_id, actor_id, action, subject_type, subject_id, metadata)
    VALUES (p_estate, p_actor, 'ESTATE_LEASE_DISPOSITION', 'lease', p_lease::text,
            jsonb_build_object('from_status', v_lease.status, 'to_status', v_returned_status,
                               'from_deposit', v_lease.deposit_status, 'to_deposit', v_returned_deposit,
                               'reason', p_reason));

    RETURN QUERY SELECT v_returned_status, v_returned_deposit;
END $$;
