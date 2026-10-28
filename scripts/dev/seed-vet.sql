-- ============================================================================
-- LOCAL DEVELOPMENT SEED — Veterinary vertical.   DO NOT RUN IN ANY SHARED ENV.
--
-- Gives GET /api/finance/health/vet/vets real rows so the pet-owner app
-- (/health/vet/find-vet) has something to list once mocks are gone. It does NOT
-- create auth users: it attaches vet providers to existing local dev accounts
-- (spec.ng+staging1@gmail.com / spec.ng+staging2@gmail.com). If those accounts
-- do not exist the script does nothing, which is also what keeps it from doing
-- anything in a non-dev database.
--
-- Idempotent: providers/profiles are upserted; the seeded services and weekly
-- hours (code 'SEED-*') are replaced on every run. Money is integer kobo.
-- Run:  docker exec -i <supabase_db container> psql -U postgres < scripts/dev/seed-vet.sql
-- ============================================================================
BEGIN;

DO $seed$
DECLARE
  rec          record;
  spec_general uuid;
  spec_derm    uuid;
  prov_id      uuid;
  idx          int := 0;
BEGIN
  SELECT id INTO spec_general FROM public.doctor_specialties WHERE name = 'General Practice' LIMIT 1;
  SELECT id INTO spec_derm    FROM public.doctor_specialties WHERE name = 'Dermatology'      LIMIT 1;

  FOR rec IN
    SELECT id, email FROM auth.users
    WHERE email IN ('spec.ng+staging1@gmail.com', 'spec.ng+staging2@gmail.com')
    ORDER BY email
  LOOP
    idx := idx + 1;

    -- VCN-approved, published vet profile (what the listing joins on)
    INSERT INTO public.doctor_vet_profiles
      (user_id, vet_mode_enabled, licence_number, verification, is_published, profile_draft)
    VALUES (
      rec.id, true, 'VCN-DEV-' || lpad(idx::text, 4, '0'), 'approved', true,
      jsonb_build_object('draft', jsonb_build_object(
        'personalInfo', jsonb_build_object(
          'title', 'Dr.',
          'firstName', CASE idx WHEN 1 THEN 'Tunde' ELSE 'Ada' END,
          'lastName',  CASE idx WHEN 1 THEN 'Adeyemi' ELSE 'Okoro' END,
          'address',   CASE idx WHEN 1 THEN '24 Admiralty Way, Lekki Phase 1' ELSE '5 Awolowo Rd, Ikoyi' END,
          'city', 'Lagos', 'state', 'Lagos'),
        'bio', CASE idx
                 WHEN 1 THEN 'Small-animal vet with a special interest in dermatology and preventive care.'
                 ELSE 'Feline-focused vet offering tele-consults and clinic visits.' END,
        'specialtyId', CASE idx WHEN 1 THEN spec_derm ELSE spec_general END,
        'subSpecialtyIds', '[]'::jsonb,
        'speciesTreated', CASE idx WHEN 1 THEN '["dog","cat","rabbit"]'::jsonb ELSE '["cat","bird","rabbit"]'::jsonb END,
        'affiliations', jsonb_build_array(jsonb_build_object(
          'name', CASE idx WHEN 1 THEN 'PawCare Veterinary Clinic' ELSE 'Furry Friends Animal Hospital' END,
          'isPrimary', true))
      ))
    )
    ON CONFLICT (user_id) DO UPDATE SET
      vet_mode_enabled = true,
      licence_number   = EXCLUDED.licence_number,
      verification     = 'approved',
      is_published     = true,
      profile_draft    = EXCLUDED.profile_draft,
      updated_at       = now();

    -- the marketplace provider row, located (PostGIS point is lng, lat)
    INSERT INTO public.health_providers
      (owner_user_id, domain, provider_type, display_name, status, discoverable, geo)
    VALUES (
      rec.id, 'VET', 'vet',
      CASE idx WHEN 1 THEN 'Dr. Tunde Adeyemi' ELSE 'Dr. Ada Okoro' END,
      'APPROVED', true,
      ST_SetSRID(ST_MakePoint(
        CASE idx WHEN 1 THEN 3.4719 ELSE 3.4316 END,
        CASE idx WHEN 1 THEN 6.4406 ELSE 6.4503 END), 4326)::geography
    )
    ON CONFLICT (owner_user_id, domain, provider_type) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      status       = 'APPROVED',
      discoverable = true,
      geo          = EXCLUDED.geo,
      updated_at   = now()
    RETURNING id INTO prov_id;

    -- services: fees are kobo, visit types TELE / HOME / CLINIC
    DELETE FROM public.vet_services WHERE provider_id = prov_id AND code LIKE 'SEED-%';
    INSERT INTO public.vet_services (provider_id, code, name, visit_type, price_kobo, active) VALUES
      (prov_id, 'SEED-TELE',   'Tele-consult',   'TELE',   CASE idx WHEN 1 THEN 1500000 ELSE 1300000 END, true),
      (prov_id, 'SEED-CLINIC', 'Clinic visit',   'CLINIC', CASE idx WHEN 1 THEN 1800000 ELSE 1500000 END, true);
    IF idx = 1 THEN
      INSERT INTO public.vet_services (provider_id, code, name, visit_type, price_kobo, active)
      VALUES (prov_id, 'SEED-HOME', 'Home visit', 'HOME', 800000, true);
    END IF;

    -- weekly hours (weekday 0=Sun..6=Sat; minutes from midnight)
    DELETE FROM public.vet_weekly_hours WHERE provider_id = prov_id;
    INSERT INTO public.vet_weekly_hours (provider_id, weekday, start_minute, end_minute, visit_type, enabled)
    SELECT prov_id, d, 9 * 60, 17 * 60, 'CLINIC', true FROM generate_series(1, 5) AS d;
    INSERT INTO public.vet_weekly_hours (provider_id, weekday, start_minute, end_minute, visit_type, enabled)
    SELECT prov_id, d, 10 * 60, 14 * 60, 'TELE', true FROM generate_series(1, 6) AS d;

    -- one future blocked window so availability is not 100% open
    DELETE FROM public.vet_availability_blocks WHERE provider_id = prov_id AND reason = 'SEED-lunch-review';
    INSERT INTO public.vet_availability_blocks (provider_id, starts_at, ends_at, reason)
    VALUES (prov_id, date_trunc('day', now()) + interval '2 days 12 hours',
                     date_trunc('day', now()) + interval '2 days 13 hours', 'SEED-lunch-review');
  END LOOP;

  IF idx = 0 THEN
    RAISE NOTICE 'seed-vet: spec.ng+staging* dev accounts not found — nothing seeded';
  ELSE
    RAISE NOTICE 'seed-vet: seeded % vet provider(s)', idx;
  END IF;
END
$seed$;

COMMIT;
