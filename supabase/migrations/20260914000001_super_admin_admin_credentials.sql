-- Provision the super-admin account used by the admin console's login "admin".
--
-- Login flow: the admin console (frontend-admin/src/features/auth/adminAuth.ts)
-- rewrites the username "admin" -> email "admin@spotlight.internal" and signs in
-- via Supabase Auth. This migration wires that identity through BOTH auth systems:
--   1. auth.users              — Supabase Auth credential (see below)
--   2. user_profiles.role      — legacy gate the admin console checks (role='admin')
--   3. platform_users          — RBAC subject row the Go backend authorizes against
--   4. user_roles(super-admin) — global super-admin grant enforced by the Go backend
--
-- Additive & idempotent: creates rows if missing, updates in place otherwise.
--
-- NO PASSWORD IS SET HERE, and none belongs here. This file used to pin a
-- hard-coded value and reset the account's password on every run - a credential
-- in git history, and a rotation that the next migration run silently reverted.
-- Supply one for the run when a deterministic value is needed:
--     SET app.super_admin_password = '<value>';   -- same session as this migration
-- Otherwise a NEW account is created with an unguessable random password (the
-- NOTICE below says so). An EXISTING account's password is never touched:
--     local  -> scripts/dev/ensure-dev-login.sh
--     hosted -> PUT /auth/v1/admin/users/{id} on the Supabase admin API

DO $$
DECLARE
  admin_id       UUID;
  super_role_id  UUID;
  v_password     TEXT := NULLIF(btrim(COALESCE(current_setting('app.super_admin_password', true), '')), '');
  v_random       BOOLEAN := false;
BEGIN
  IF v_password IS NULL THEN
    v_password := gen_random_uuid()::text || gen_random_uuid()::text;
    v_random := true;
  END IF;

  -- 1. Supabase Auth user (create if absent; an existing row keeps its password).
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
      extensions.crypt(v_password, extensions.gen_salt('bf', 10)),
      now(), now(), now(),
      jsonb_build_object('full_name', 'Admin', 'role', 'admin'),
      jsonb_build_object('provider', 'email', 'providers', ARRAY['email']::TEXT[]),
      false, false, '', null, '', null, '', '', null, '', 0, '', null, null, '', '', null
    );
    IF v_random THEN
      RAISE WARNING 'Created admin auth user % with a RANDOM password (app.super_admin_password was not set) - it cannot log in until a credential is set out of band', admin_id;
    ELSE
      RAISE NOTICE 'Created admin auth user % with the password supplied via app.super_admin_password', admin_id;
    END IF;
  ELSE
    -- Metadata and confirmation only. The password is deliberately left alone so
    -- that re-running this migration never reverts a rotation.
    UPDATE auth.users
    SET raw_user_meta_data = jsonb_build_object('full_name', 'Admin', 'role', 'admin'),
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        updated_at = now()
    WHERE id = admin_id;
    RAISE NOTICE 'Admin auth user % already existed - password left untouched', admin_id;
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

  -- A global grant carries scope_id NULL, and NULLs are distinct in a unique index,
  -- so ON CONFLICT never fires for it and every run would append another grant row.
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = admin_id AND role_id = super_role_id
      AND scope_type = 'global' AND scope_id IS NULL
  ) THEN
    UPDATE public.user_roles
    SET is_active = true
    WHERE user_id = admin_id AND role_id = super_role_id
      AND scope_type = 'global' AND scope_id IS NULL;
  ELSE
    INSERT INTO public.user_roles (user_id, role_id, scope_type, is_active)
    VALUES (admin_id, super_role_id, 'global', true);
  END IF;

  RAISE NOTICE 'Super-admin provisioned for % (login: admin; password is not managed by this migration)', admin_id;
END $$;
