-- Populate user_profiles.phone so wallet-to-wallet recipient resolution can work.
--
-- Problem: handle_new_user() copies only (id, email, full_name, role) from
-- auth.users (latest definition: 20260405200000_admin_role_setup.sql), so
-- user_profiles.phone stayed at its '' default for every account created before
-- the app-layer compensating upserts landed in 1d0b6f48 (2026-08-25). That fix
-- was FORWARD-ONLY -- no existing row was ever repaired.
--
-- GET /api/v1/transfers/paymax/resolve looks the recipient up by
-- user_profiles.phone, so it 404s for every account with a blank phone.
--
-- SCOPE: this migration only fills blanks from data already held in auth.users.
-- It is one half of the fix. The other half -- landing alongside it -- is the
-- resolver in backend/internal/finance/transfers/service.go, which used to
-- match with `WHERE phone = $1`, an EXACT string equality against a column that
-- was never normalised (stored values range from bare NSNs to 0-prefixed to
-- +234 E.164; see 20261217000000_user_module_grants.sql). It now matches on the
-- 10-digit NSN, so a row backfilled in ANY of those formats resolves.
--
-- Neither half works alone: normalising an empty column still finds nothing,
-- and backfilling a column an exact-match query cannot read still 404s.
--
-- Additive only: CREATE OR REPLACE + a guarded UPDATE.
-- No DROP, no rename, no type narrowing. Re-running it is a no-op.

-- ─── 1. Trigger carries phone across, as defence in depth ────────────────────
-- Largely superseded by the per-path upserts added in 1d0b6f48, but those live
-- in three separate call sites (web, mobile, Go); a fourth signup path added
-- later would silently reintroduce the gap. Doing it in the trigger makes the
-- database the backstop rather than trusting every caller to remember.
-- Also adds `SET search_path = public`, which the existing SECURITY DEFINER
-- definition lacks.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone TEXT;
BEGIN
  v_phone := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    NULLIF(NEW.phone, ''),
    ''
  );

  INSERT INTO public.user_profiles (id, email, full_name, role, phone)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'user'),
    v_phone
  )
  ON CONFLICT (id) DO UPDATE
    SET role  = COALESCE(NEW.raw_user_meta_data->>'role', 'user'),
        -- never blank out a phone the app already wrote
        phone = COALESCE(NULLIF(EXCLUDED.phone, ''), public.user_profiles.phone);
  RETURN NEW;
END;
$$;

-- ─── 2. Backfill existing rows from auth.users ───────────────────────────────
-- THE ACTUAL FIX. Fills blanks only -- an existing profile phone always wins,
-- so re-running this is a no-op and it can never clobber app-written data.
UPDATE public.user_profiles p
SET    phone      = COALESCE(
         NULLIF(u.raw_user_meta_data->>'phone', ''),
         NULLIF(u.phone, '')
       ),
       updated_at = CURRENT_TIMESTAMP
FROM   auth.users u
WHERE  u.id = p.id
  AND  COALESCE(p.phone, '') = ''
  AND  COALESCE(NULLIF(u.raw_user_meta_data->>'phone', ''), NULLIF(u.phone, '')) IS NOT NULL;

-- ─── 3. Resolution index: deliberately NOT added ─────────────────────────────
-- The stashed draft added `idx_user_profiles_phone` on the raw column, to serve
-- the resolver's old `WHERE phone = $1`. Two reasons it is omitted:
--
--   a) The resolver no longer filters on the raw column. It now matches the
--      10-digit NSN using exactly the expression and partial predicate of the
--      EXISTING user_profiles_phone_nsn_idx (20261217000000), which serves it
--      with a real Index Cond -- verified with EXPLAIN on staging. A raw-column
--      index would never be chosen. No other query in the backend filters
--      user_profiles by phone; every other read is by id.
--
--   b) The draft's partial predicate `WHERE COALESCE(phone,'') <> ''` was
--      unusable anyway: the planner cannot prove it applies to `phone = $1`
--      and refused the index, silently falling back to a filtered scan.
--
-- If a raw-column lookup is ever reintroduced, the predicate must be written
-- `WHERE phone IS NOT NULL AND phone <> ''` for the planner to prove it.
