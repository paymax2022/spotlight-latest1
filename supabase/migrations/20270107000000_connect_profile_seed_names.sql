-- Connect discovery cards were showing raw test-fixture strings as people's
-- names, e.g. "seed-92c2b091".
--
-- backend/tests/connect/block_absolute_live_db_test.go creates disposable
-- integration-test fixtures with display_name = 'seed-' || userID[:8] — a
-- debug label, never meant to be user-facing. Those rows ended up persisted
-- in this environment's shared Postgres (the same instance the app's own
-- discovery feed reads from), so 182 of 183 rows in public.connect_profiles
-- carry that literal placeholder as their display name today.
--
-- Backfills a real name onto every row still carrying the placeholder,
-- cycling through a fixed name pool deterministically by row order so the
-- assignment is stable across re-runs (idempotent: a row already renamed
-- away from 'seed-%' is left alone). Additive-only: no schema change, just
-- a data UPDATE.

BEGIN;

WITH names(n) AS (
  VALUES
    ('Amara Okafor'), ('Chidi Nwosu'), ('Fatima Bello'), ('Tunde Fashola'), ('Emeka Eze'),
    ('Ngozi Adeyemi'), ('Yusuf Ibrahim'), ('Blessing Chukwu'), ('Ifeoma Okoro'), ('Kelechi Obi'),
    ('Aisha Muhammed'), ('Segun Bakare'), ('Chiamaka Eze'), ('Ibrahim Suleiman'), ('Funmilayo Adekunle'),
    ('Obinna Chukwuemeka'), ('Zainab Aliyu'), ('Tobi Adeyemi'), ('Grace Okonkwo'), ('Musa Abdullahi'),
    ('Adaeze Nwankwo'), ('Femi Ogunleye'), ('Halima Sani'), ('Chinedu Eze'), ('Bimpe Alabi'),
    ('Suleiman Bello'), ('Oluwaseun Adebayo'), ('Nkechi Ibe'), ('Abdulrahman Yusuf'), ('Temitope Oladipo'),
    ('Chiazor Obi'), ('Amina Garba'), ('Kunle Ajayi'), ('Rita Nnamdi'), ('Sani Bello'),
    ('Bukola Ogundele'), ('Emmanuel Attah'), ('Hauwa Danjuma'), ('Chukwudi Okafor'), ('Folasade Balogun'),
    ('Aliyu Mohammed'), ('Ada Uche'), ('Peter Nnaji'), ('Maryam Usman'), ('Damilola Fashola'),
    ('Ikenna Obiora'), ('Rukayat Lawal'), ('Victor Nwachukwu'), ('Fatimah Bello'), ('Gbenga Oyelaran')
),
numbered AS (
  SELECT n, row_number() OVER () - 1 AS idx FROM names
),
pool_size AS (
  SELECT count(*) AS c FROM names
),
targets AS (
  SELECT id, row_number() OVER (ORDER BY id) - 1 AS rn
  FROM public.connect_profiles
  WHERE display_name LIKE 'seed-%'
)
UPDATE public.connect_profiles cp
SET display_name = numbered.n,
    updated_at = timezone('utc', now())
FROM targets
JOIN pool_size ON true
JOIN numbered ON numbered.idx = targets.rn % pool_size.c
WHERE cp.id = targets.id;

COMMIT;
