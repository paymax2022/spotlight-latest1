-- Phase 2.5b lease-ledger smoke test — every statement rolls back; nothing is left behind.
--
-- The vacancy override is supplied throughout because of the independent exemption rule from Phase 2.4:
-- no unit in the local database currently has a live occupant registration, so a rent charge against
-- any of them is refused as exempt before the lease rule is reached. Passing that rule's own override
-- (with the reason it requires) leaves the lease rule as the only gate under test.
BEGIN;
CREATE TEMP TABLE smoke (step TEXT, outcome TEXT) ON COMMIT DROP;

DO $$
DECLARE
    v_estate UUID := '8fa700dc-fa26-4867-97f4-542904e9d380';
    v_admin  UUID := '7945fbd0-24bf-4ee0-9de4-de37aa51fa21';
    v_tenant UUID := 'f30648f3-1e07-48f8-9cdf-d458799946d7';
    v_unit   UUID := '869e925c-3c18-4739-bd34-c79aa96842a7';
    v_lease  UUID;
    v_status TEXT;
BEGIN
    SELECT f.out_lease_id, f.out_status INTO v_lease, v_status
      FROM estate_lease_record(v_estate, v_admin, NULL, v_unit, v_tenant, NULL,
                               CURRENT_DATE - 30, CURRENT_DATE + 335,
                               15000000, 'yearly', 30000000, 'smoke test') f;
    INSERT INTO smoke VALUES ('record lease', 'status=' || v_status);

    BEGIN
        INSERT INTO estate_dues_invoices
            (estate_id, property_id, resident_id, category, amount_kobo, due_date,
             vacancy_override, vacancy_override_reason)
        VALUES (v_estate, v_unit, v_tenant, 'rent', 1000, CURRENT_DATE,
                TRUE, 'unit has no live registration in this seed');
        INSERT INTO smoke VALUES ('rent with no lease refused (lease rule)', 'FAIL — inserted');
    EXCEPTION WHEN others THEN
        INSERT INTO smoke VALUES ('rent with no lease refused (lease rule)', 'OK: ' || SQLERRM);
    END;

    BEGIN
        INSERT INTO estate_dues_invoices
            (estate_id, property_id, resident_id, category, amount_kobo, due_date, lease_id,
             vacancy_override, vacancy_override_reason)
        VALUES (v_estate, v_unit, v_tenant, 'rent', 1000, CURRENT_DATE, v_lease,
                TRUE, 'unit has no live registration in this seed');
        INSERT INTO smoke VALUES ('rent naming the lease accepted', 'OK');
    EXCEPTION WHEN others THEN
        INSERT INTO smoke VALUES ('rent naming the lease accepted', 'FAIL: ' || SQLERRM);
    END;

    BEGIN
        INSERT INTO estate_dues_invoices
            (estate_id, property_id, resident_id, category, amount_kobo, due_date,
             lease_override, vacancy_override, vacancy_override_reason)
        VALUES (v_estate, v_unit, v_tenant, 'rent', 1000, CURRENT_DATE,
                TRUE, TRUE, 'unit has no live registration in this seed');
        INSERT INTO smoke VALUES ('lease override with no reason refused', 'FAIL — inserted');
    EXCEPTION WHEN others THEN
        INSERT INTO smoke VALUES ('lease override with no reason refused', 'OK: ' || SQLERRM);
    END;

    BEGIN
        -- The admin is a real member of this estate, so the foreign key is satisfied and the only thing
        -- left to object is the rule that a rent charge names the billing resident's own lease.
        INSERT INTO estate_dues_invoices
            (estate_id, property_id, resident_id, category, amount_kobo, due_date, lease_id,
             vacancy_override, vacancy_override_reason)
        VALUES (v_estate, v_unit, v_admin, 'rent', 1000, CURRENT_DATE, v_lease,
                TRUE, 'unit has no live registration in this seed');
        INSERT INTO smoke VALUES ('rent for a resident who is not the tenant refused', 'FAIL — inserted');
    EXCEPTION WHEN others THEN
        INSERT INTO smoke VALUES ('rent for a resident who is not the tenant refused', 'OK: ' || SQLERRM);
    END;

    BEGIN
        PERFORM 1 FROM estate_lease_disposition(v_estate, v_lease, v_admin, NULL, 'held', 'tenant paid the deposit');
        INSERT INTO smoke VALUES ('deposit held through the disposition writer', 'OK');
    EXCEPTION WHEN others THEN
        INSERT INTO smoke VALUES ('deposit held through the disposition writer', 'FAIL: ' || SQLERRM);
    END;

    BEGIN
        PERFORM 1 FROM estate_lease_disposition(v_estate, v_lease, v_admin, 'terminated', 'refunded', 'tenancy ended');
        INSERT INTO smoke VALUES ('terminate and refund through the disposition writer', 'OK');
    EXCEPTION WHEN others THEN
        INSERT INTO smoke VALUES ('terminate and refund through the disposition writer', 'FAIL: ' || SQLERRM);
    END;

    BEGIN
        UPDATE estate_leases SET status = 'active' WHERE id = v_lease;
        INSERT INTO smoke VALUES ('reopening a terminated lease refused', 'FAIL — updated');
    EXCEPTION WHEN others THEN
        INSERT INTO smoke VALUES ('reopening a terminated lease refused', 'OK: ' || SQLERRM);
    END;

    INSERT INTO smoke VALUES ('audit rows for the lease',
        (SELECT count(*)::text FROM estate_audit_log
         WHERE subject_type = 'lease' AND subject_id = v_lease::text));
END $$;

SELECT step, outcome FROM smoke;
ROLLBACK;
