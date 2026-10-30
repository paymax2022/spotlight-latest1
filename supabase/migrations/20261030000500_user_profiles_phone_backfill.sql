-- Populate user_profiles.phone so wallet-to-wallet recipient resolution works.
--
-- Problem: handle_new_user() copied only (id, email, full_name, role) from
-- auth.users, so user_profiles.phone stayed at its '' default for every user
-- created through the signup trigger. GET /api/v1/transfers/paymax/resolve
-- looks the recipient up by user_profiles.phone, so it 404'd for practically
-- every account on the platform.
--
-- Additive only: CREATE OR REPLACE on the trigger fn + an UPDATE backfill.
-- No DROP, no rename, no type change.

-- 1. Trigger now carries phone across from signup metadata / auth.users.phone.
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

-- 2. Backfill existing rows from auth.users. Only fills blanks — an existing
--    profile phone always wins.
UPDATE public.user_profiles p
SET    phone = COALESCE(
         NULLIF(u.raw_user_meta_data->>'phone', ''),
         NULLIF(u.phone, '')
       ),
       updated_at = CURRENT_TIMESTAMP
FROM   auth.users u
WHERE  u.id = p.id
  AND  COALESCE(p.phone, '') = ''
  AND  COALESCE(NULLIF(u.raw_user_meta_data->>'phone', ''), NULLIF(u.phone, '')) IS NOT NULL;

-- 3. Resolution index. The resolver probes several E.164/local variants of the
--    same number, so index the raw column the equality filters actually use.
CREATE INDEX IF NOT EXISTS idx_user_profiles_phone
  ON public.user_profiles (phone)
  WHERE COALESCE(phone, '') <> '';
