-- Provision a super-admin account with login "admin" / password "admin".
--
-- Login flow: the admin console (frontend-admin/src/features/auth/adminAuth.ts)
-- rewrites the username "admin" -> email "admin@spotlight.internal" and signs in
-- via Supabase Auth. This migration wires that identity through BOTH auth systems:
--   1. auth.users              — Supabase Auth credential (password = "admin")
--   2. user_profiles.role      — legacy gate the admin console checks (role='admin')
--   3. platform_users          — RBAC subject row the Go backend authorizes against
--   4. user_roles(super-admin) — global super-admin grant enforced by the Go backend
--
-- Additive & idempotent: creates rows if missing, updates in place otherwise.
-- NOTE: "admin"/"admin" is a weak dev credential. Rotate before any shared/prod use.

DO $$
DECLARE
  admin_id       UUID;
  super_role_id  UUID;
BEGIN
  -- 1. Supabase Auth user (create if absent, otherwise reset password to "admin").
  SELECT id INTO admin_id
  FROM auth.users
  WHERE email = 'admin@spotlight.internal'
  LIMIT 1;

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
      crypt('admin', gen_salt('bf', 10)),
      now(), now(), now(),
      jsonb_build_object('full_name', 'Admin', 'role', 'admin'),
      jsonb_build_object('provider', 'email', 'providers', ARRAY['email']::TEXT[]),
      false, false, '', null, '', null, '', '', null, '', 0, '', null, null, '', '', null
    );
    RAISE NOTICE 'Created admin auth user %', admin_id;
  ELSE
    UPDATE auth.users
    SET encrypted_password = crypt('admin', gen_salt('bf', 10)),
        raw_user_meta_data = jsonb_build_object('full_name', 'Admin', 'role', 'admin'),
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        updated_at = now()
    WHERE id = admin_id;
    RAISE NOTICE 'Reset password for admin auth user %', admin_id;
  END IF;

  -- 2. Legacy admin-console gate: user_profiles.role = 'admin'.
  INSERT INTO public.user_profiles (id, email, full_name, role)
  VALUES (admin_id, 'admin@spotlight.internal', 'Admin', 'admin')
  ON CONFLICT (id) DO UPDATE
    SET role = 'admin',
        email = 'admin@spotlight.internal',
        full_name = COALESCE(NULLIF(public.user_profiles.full_name, ''), 'Admin');

  -- 3. Enterprise RBAC subject row (id shared with auth.users), active.
  INSERT INTO public.platform_users (id, first_name, last_name, email, user_type, status, email_verified_at)
  VALUES (admin_id, 'Super', 'Admin', 'admin@spotlight.internal', 'admin', 'active', now())
  ON CONFLICT (id) DO UPDATE
    SET status = 'active',
        email  = 'admin@spotlight.internal',
        updated_at = now();

  -- 4. Ensure the super-admin role exists, then grant it globally.
  INSERT INTO public.roles (name, slug, description, role_type, is_system_role)
  VALUES ('Super Admin', 'super-admin', 'System wide unrestricted control', 'system', true)
  ON CONFLICT (slug) DO NOTHING;

  SELECT id INTO super_role_id FROM public.roles WHERE slug = 'super-admin' LIMIT 1;

  INSERT INTO public.user_roles (user_id, role_id, scope_type, is_active)
  VALUES (admin_id, super_role_id, 'global', true)
  ON CONFLICT (user_id, role_id, scope_type, scope_id) DO UPDATE
    SET is_active = true;

  RAISE NOTICE 'Super-admin provisioned for % (login: admin / admin)', admin_id;
END $$;
