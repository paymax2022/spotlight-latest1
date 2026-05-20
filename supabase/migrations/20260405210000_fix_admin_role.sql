-- Fix admin user role: ensure admin@spotlight.internal has role='admin' in user_profiles
-- This migration handles all edge cases:
-- 1. Admin auth user exists but profile has wrong role
-- 2. Admin auth user exists but profile row is missing
-- 3. Admin auth user does not exist at all

DO $$
DECLARE
  admin_id UUID;
BEGIN
  -- Step 1: Get the existing admin auth user id (if exists)
  SELECT id INTO admin_id
  FROM auth.users
  WHERE email = 'admin@spotlight.internal'
  LIMIT 1;

  -- Step 2: If admin auth user does not exist, create it
  IF admin_id IS NULL THEN
    admin_id := gen_random_uuid();
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_user_meta_data, raw_app_meta_data,
      is_sso_user, is_anonymous, confirmation_token, confirmation_sent_at,
      recovery_token, recovery_sent_at, email_change_token_new, email_change,
      email_change_sent_at, email_change_token_current, email_change_confirm_status,
      reauthentication_token, reauthentication_sent_at, phone, phone_change,
      phone_change_token, phone_change_sent_at
    ) VALUES (
      admin_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'admin@spotlight.internal',
      crypt('Miraculous@1', gen_salt('bf', 10)),
      now(),
      now(),
      now(),
      jsonb_build_object('full_name', 'Admin', 'role', 'admin'),
      jsonb_build_object('provider', 'email', 'providers', ARRAY['email']::TEXT[]),
      false, false, '', null, '', null, '', '', null, '', 0, '', null, null, '', '', null
    );
    RAISE NOTICE 'Admin auth user created with id: %', admin_id;
  ELSE
    -- Step 3: Admin auth user exists — update their metadata to include role=admin
    UPDATE auth.users
    SET
      raw_user_meta_data = jsonb_build_object('full_name', 'Admin', 'role', 'admin'),
      encrypted_password = crypt('Miraculous@1', gen_salt('bf', 10)),
      email_confirmed_at = COALESCE(email_confirmed_at, now()),
      updated_at = now()
    WHERE id = admin_id;
    RAISE NOTICE 'Admin auth user updated with id: %', admin_id;
  END IF;

  -- Step 4: Upsert the user_profiles row with role='admin'
  INSERT INTO public.user_profiles (id, email, full_name, role)
  VALUES (admin_id, 'admin@spotlight.internal', 'Admin', 'admin')
  ON CONFLICT (id) DO UPDATE
    SET role = 'admin',
        email = 'admin@spotlight.internal',
        full_name = COALESCE(NULLIF(public.user_profiles.full_name, ''), 'Admin');

  RAISE NOTICE 'Admin user_profiles row upserted with role=admin for id: %', admin_id;

EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Admin fix migration failed: %', SQLERRM;
END $$;
