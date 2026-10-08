-- Add role column to user_profiles if not exists
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

-- Create index on role for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON public.user_profiles(role);

-- Function to check if current user is admin (uses auth metadata to avoid recursion)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
$$;

-- Update handle_new_user trigger to include role from metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'user')
  )
  ON CONFLICT (id) DO UPDATE
    SET role = COALESCE(NEW.raw_user_meta_data->>'role', 'user');
  RETURN NEW;
END;
$$;

-- Ensure trigger exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Seed the admin account: identity row, metadata, and profile role.
--
-- NO PASSWORD IS SET HERE, and none belongs here. A credential written into a
-- migration is a credential in git history: all three admin migrations used to
-- pin a hard-coded value, readable by anyone with the repo. Two of them also
-- rewrote the password of the existing account on every run, so rotating it by
-- hand was silently undone by the next migration run. Credentials are an
-- environment concern, not a schema one.
--
-- A run gets a deterministic password only if one is supplied to it:
--     SET app.super_admin_password = '<value>';   -- same session as this migration
-- Otherwise a NEW account is created with an unguessable random password (the
-- NOTICE below says so, and no one can log in until a real one is set). An
-- EXISTING account's password is never touched. To set a usable credential:
--     local  -> scripts/dev/ensure-dev-login.sh
--     hosted -> PUT /auth/v1/admin/users/{id} on the Supabase admin API
DO $$
DECLARE
  admin_uuid UUID := gen_random_uuid();
  v_password TEXT := NULLIF(btrim(COALESCE(current_setting('app.super_admin_password', true), '')), '');
  v_random   BOOLEAN := false;
BEGIN
  IF v_password IS NULL THEN
    v_password := gen_random_uuid()::text || gen_random_uuid()::text;
    v_random := true;
  END IF;

  -- GoTrue's email uniqueness is a PARTIAL index (WHERE is_sso_user = false), so
  -- ON CONFLICT (email) cannot infer it and would raise "no unique or exclusion
  -- constraint matching the ON CONFLICT specification" - swallowed by the handler
  -- below, turning this whole block into a silent no-op. Guard with a lookup.
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@spotlight.internal') THEN
    RAISE NOTICE 'admin@spotlight.internal already existed - password left untouched';
  ELSE
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_user_meta_data, raw_app_meta_data,
      is_sso_user, is_anonymous, confirmation_token, confirmation_sent_at,
      recovery_token, recovery_sent_at, email_change_token_new, email_change,
      email_change_sent_at, email_change_token_current, email_change_confirm_status,
      reauthentication_token, reauthentication_sent_at, phone, phone_change,
      phone_change_token, phone_change_sent_at
    ) VALUES (
      admin_uuid,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'admin@spotlight.internal',
      crypt(v_password, gen_salt('bf', 10)),
      now(),
      now(),
      now(),
      jsonb_build_object('full_name', 'Admin', 'role', 'admin'),
      jsonb_build_object('provider', 'email', 'providers', ARRAY['email']::TEXT[]),
      false, false, '', null, '', null, '', '', null, '', 0, '', null, null, '', '', null
    );

    IF v_random THEN
      RAISE WARNING 'created admin@spotlight.internal with a RANDOM password (app.super_admin_password was not set) - it cannot log in until a credential is set out of band';
    ELSE
      RAISE NOTICE 'created admin@spotlight.internal with the password supplied via app.super_admin_password';
    END IF;
  END IF;

  -- Ensure user_profiles row has admin role (in case trigger already ran or conflict occurred)
  UPDATE public.user_profiles
  SET role = 'admin'
  WHERE email = 'admin@spotlight.internal';

EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Admin seed failed: %', SQLERRM;
END $$;
