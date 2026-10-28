-- LOCAL DEV ONLY. Idempotent. Seeds three approved MLSCN labs with profiles,
-- licences, a catalog and packages — the data the mobile Lab screens used to
-- fake client-side. Never run against a shared or production database.
-- Usage: docker exec -i supabase_db_spotlight psql -U postgres < scripts/dev/seed-health-lab.sql

DO $$
DECLARE
  lab record;
  uid uuid; pid uuid; aid uuid;
BEGIN
  FOR lab IN SELECT * FROM (VALUES
    ('0a1b0001-0000-4000-8000-000000000001'::uuid, 'SynLab Diagnostics',  'ISO-accredited diagnostic laboratory',            '15 Adeola Odeku St, Victoria Island, Lagos', true,  true, 250000, 'Results in 24 hrs',     6.4281, 3.4219, 'MLSCN-LAG-2291'),
    ('0a1b0001-0000-4000-8000-000000000002'::uuid, 'Clina-Lancet Labs',   'Reference laboratory · Pan-African network',      '5 Saka Tinubu St, Victoria Island, Lagos',  true,  true, 300000, 'Results in 24-48 hrs', 6.4314, 3.4256, 'MLSCN-LAG-1187'),
    ('0a1b0001-0000-4000-8000-000000000003'::uuid, 'Afriglobal Medicare', 'Walk-in diagnostics & wellness centre',           '23 Awolowo Rd, Ikoyi, Lagos',               false, true, 0,      'Results same day',     6.4503, 3.4316, 'MLSCN-LAG-3340')
  ) AS v(id, name, headline, address, home, walkin, fee, eta, lat, lng, licence)
  LOOP
    uid := lab.id;
    INSERT INTO auth.users (id, email) VALUES (uid, 'lab-seed-' || right(uid::text, 4) || '@seed.local') ON CONFLICT DO NOTHING;

    INSERT INTO public.health_providers (id, owner_user_id, domain, provider_type, display_name, status, discoverable, geo)
    VALUES (uid, uid, 'LAB', 'lab', lab.name, 'APPROVED', true, ST_SetSRID(ST_MakePoint(lab.lng, lab.lat), 4326)::geography)
    ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, status = 'APPROVED', discoverable = true, geo = EXCLUDED.geo;
    pid := uid;

    INSERT INTO public.lab_profiles (lab_provider_id, headline, address, supports_home_collection, supports_walk_in, home_collection_fee_kobo, result_eta_label)
    VALUES (pid, lab.headline, lab.address, lab.home, lab.walkin, lab.fee, lab.eta)
    ON CONFLICT (lab_provider_id) DO UPDATE SET headline = EXCLUDED.headline, address = EXCLUDED.address,
      supports_home_collection = EXCLUDED.supports_home_collection, home_collection_fee_kobo = EXCLUDED.home_collection_fee_kobo,
      result_eta_label = EXCLUDED.result_eta_label, updated_at = now();

    aid := uid; -- deterministic application id = provider id
    INSERT INTO public.health_provider_applications (id, owner_user_id, domain, provider_type, display_name, state, provider_id)
    VALUES (aid, uid, 'LAB', 'lab', lab.name, 'APPROVED', pid)
    ON CONFLICT (id) DO UPDATE SET state = 'APPROVED', provider_id = pid;

    DELETE FROM public.health_credential_docs WHERE application_id = aid AND cred_type = 'MLSCN';
    INSERT INTO public.health_credential_docs (application_id, owner_user_id, cred_type, reference_no, storage_key, verified, expires_at)
    VALUES (aid, uid, 'MLSCN', lab.licence, 'seed/' || lab.licence, true, now() + interval '2 years');

    -- Catalog (same price list on every lab; kobo).
    INSERT INTO public.lab_tests (id, lab_provider_id, code, name, specimen, prep_instructions, tat_hours, ref_range, price_kobo, category, description, home_collection, fasting_required)
    SELECT md5(pid::text || t.code)::uuid, pid, t.code, t.name, t.specimen, t.prep, t.tat, t.ref, t.price, t.cat, t.descr, true, t.fast
    FROM (VALUES
      ('FBC',    'Full Blood Count',     'BLOOD', 'No special preparation needed. Stay hydrated.',                  12, '',                 650000, 'haematology', 'Measures red and white cells, haemoglobin and platelets — screens for anaemia, infection and clotting issues.', false),
      ('HbA1c',  'HbA1c (Diabetes)',     'BLOOD', 'No fasting required. Avoid heavy meals just before the draw.',   24, '< 5.7 %',          850000, 'endocrine',   'Average blood sugar over the last ~3 months. Used to diagnose and monitor diabetes.',                          false),
      ('LIPID',  'Lipid Profile',        'BLOOD', 'Fast for 9-12 hours. Water only.',                               24, '',                 950000, 'cardiac',     'Total cholesterol, HDL, LDL and triglycerides — assesses cardiovascular risk.',                                true),
      ('LFT',    'Liver Function Test',  'BLOOD', 'Fast for 8 hours. Avoid alcohol for 24 hours.',                  24, '',                 880000, 'chemistry',   'ALT, AST, bilirubin and proteins to assess liver health.',                                                     true),
      ('MP',     'Malaria Parasite',     'BLOOD', 'No special preparation needed.',                                 12, 'Negative',         350000, 'infectious',  'Microscopy for malaria parasites. Recommended for fever and chills.',                                          false),
      ('TSH',    'Thyroid (TSH)',        'BLOOD', 'No fasting required.',                                           48, '0.4 - 4.0 mIU/L',  720000, 'endocrine',   'Thyroid-stimulating hormone — screens for thyroid over/underactivity.',                                        false),
      ('URIN',   'Urinalysis',           'URINE', 'Provide a clean midstream sample. No fasting.',                  12, '',                 300000, 'chemistry',   'Screens urine for infection, kidney issues, glucose and protein.',                                             false)
    ) AS t(code, name, specimen, prep, tat, ref, price, cat, descr, fast)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, price_kobo = EXCLUDED.price_kobo, category = EXCLUDED.category,
      description = EXCLUDED.description, fasting_required = EXCLUDED.fasting_required, active = true, updated_at = now();

    INSERT INTO public.lab_packages (id, lab_provider_id, name, description, prep_instructions, tat_hours, price_kobo, test_ids)
    SELECT md5(pid::text || 'pkg-basic')::uuid, pid, 'Basic Health Check', 'FBC, lipid profile and liver function in one visit.',
           'Fast for 9-12 hours.', 24, 2200000,
           ARRAY(SELECT id FROM public.lab_tests WHERE lab_provider_id = pid AND code IN ('FBC','LIPID','LFT'))
    ON CONFLICT (id) DO UPDATE SET price_kobo = EXCLUDED.price_kobo, test_ids = EXCLUDED.test_ids, active = true, updated_at = now();
  END LOOP;
END $$;
