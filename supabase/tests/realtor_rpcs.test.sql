-- Realtor backend — RPC invariant tests (run with `psql -v ON_ERROR_STOP=1 -f`).
-- Validates the money + availability iron rules against a real Postgres after
-- the realtor migrations are applied. Exits non-zero on any failed assertion.
--
-- Prereqs (supplied by CI / local harness before this file):
--   - pgcrypto + btree_gist extensions
--   - an `auth` schema with auth.users, auth.uid(), auth.role()
--   - all five realtor migrations applied
-- Identity is taken from the GUC request.jwt.claim.sub (Supabase-compatible).

BEGIN;

-- ── Fixtures ─────────────────────────────────────────────────────────────────
INSERT INTO auth.users(id,email) VALUES ('11111111-1111-1111-1111-111111111111','tenant@test.ng') ON CONFLICT DO NOTHING;
SET LOCAL request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

INSERT INTO realtor_portfolios(id,owner_id,name) VALUES ('20000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','P');
INSERT INTO realtor_properties(id,portfolio_id,name,property_type,address,area,city,state) VALUES ('20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','Bldg','apartment','1 St','Lekki','Lagos','Lagos');
INSERT INTO realtor_units(id,property_id,label,property_type) VALUES ('20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','3B','apartment');
INSERT INTO realtor_listings(id,unit_id,title,mode,status,nightly_kobo,caution_kobo) VALUES ('20000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000003','Shortlet','short_stay','published',8000000,15000000);
INSERT INTO realtor_rental_applications(id,listing_id,user_id,status,full_name,email,phone) VALUES ('20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','approved','T','t@x.ng','080');
INSERT INTO realtor_leases(id,application_id,listing_id,tenant_id,rent_kobo,caution_kobo,start_date,end_date) VALUES ('20000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111',650000000,65000000,current_date,current_date+372);
INSERT INTO realtor_invoices(id,lease_id,lines,total_kobo) VALUES ('20000000-0000-0000-0000-000000000007','20000000-0000-0000-0000-000000000006','[{"label":"Rent","amount_kobo":650000000},{"label":"Caution","amount_kobo":65000000,"refundable":true}]'::jsonb,715000000);
INSERT INTO realtor_hotels(id,name,area,city) VALUES ('30000000-0000-0000-0000-000000000001','H','VI','Lagos');
INSERT INTO realtor_room_types(id,hotel_id,name,total_rooms,available_rooms,rate_plans) VALUES ('30000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','King',1,1,'[{"id":"rp1","name":"Room only","nightly_kobo":9500000}]'::jsonb);

-- ── TEST 1: pay_invoice is idempotent (money path) ───────────────────────────
DO $$
DECLARE r1 text; r2 text; n int; lease_status text; escrow_n int;
BEGIN
  r1 := realtor_pay_invoice('20000000-0000-0000-0000-000000000007','WALLET','IDEMP-KEY-1')->>'reference';
  r2 := realtor_pay_invoice('20000000-0000-0000-0000-000000000007','WALLET','IDEMP-KEY-1')->>'reference';
  ASSERT r1 = r2, 'pay_invoice not idempotent: references differ';
  SELECT count(*) INTO n FROM realtor_payments WHERE idempotency_key='IDEMP-KEY-1';
  ASSERT n = 1, format('expected 1 payment row, got %s', n);
  SELECT status INTO lease_status FROM realtor_leases WHERE id='20000000-0000-0000-0000-000000000006';
  ASSERT lease_status = 'active', format('lease should be active, got %s', lease_status);
  SELECT count(*) INTO escrow_n FROM realtor_escrow_deposits WHERE lease_id='20000000-0000-0000-0000-000000000006' AND amount_kobo=65000000;
  ASSERT escrow_n = 1, 'caution deposit not held in escrow';
  RAISE NOTICE 'TEST 1 pay_invoice idempotency: PASS';
END $$;

-- ── TEST 2: shortlet cannot be double-booked (availability) ──────────────────
DO $$
DECLARE ok boolean := false;
BEGIN
  PERFORM realtor_create_shortlet_booking('20000000-0000-0000-0000-000000000004',current_date+5,current_date+8,2,'A','080','REF1');
  BEGIN
    PERFORM realtor_create_shortlet_booking('20000000-0000-0000-0000-000000000004',current_date+6,current_date+9,2,'B','081','REF2');
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%dates_unavailable%', format('unexpected error: %s', SQLERRM);
    ok := true;
  END;
  ASSERT ok, 'overlapping shortlet booking was NOT rejected';
  RAISE NOTICE 'TEST 2 shortlet no-double-booking: PASS';
END $$;

-- ── TEST 3: hotel room type sells out (availability) ─────────────────────────
DO $$
DECLARE ok boolean := false;
BEGIN
  PERFORM realtor_book_hotel_room('30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','rp1',current_date+5,current_date+8,2,'A','080',NULL,'HREF1');
  BEGIN
    PERFORM realtor_book_hotel_room('30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','rp1',current_date+6,current_date+9,2,'B','081',NULL,'HREF2');
  EXCEPTION WHEN OTHERS THEN
    ASSERT SQLERRM LIKE '%sold_out%', format('unexpected error: %s', SQLERRM);
    ok := true;
  END;
  ASSERT ok, 'overbooked hotel room was NOT rejected';
  RAISE NOTICE 'TEST 3 hotel sold-out guard: PASS';
END $$;

-- ── TEST 4: owner_dashboard aggregates ───────────────────────────────────────
DO $$
DECLARE d jsonb;
BEGIN
  d := realtor_owner_dashboard();
  ASSERT (d->>'totalUnits')::int >= 1, 'owner_dashboard totalUnits missing';
  ASSERT d ? 'properties', 'owner_dashboard properties missing';
  RAISE NOTICE 'TEST 4 owner_dashboard: PASS';
END $$;

ROLLBACK;  -- tests are side-effect free
