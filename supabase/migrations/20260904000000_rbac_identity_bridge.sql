-- RBAC identity bridge: make platform_users mirror the Supabase auth identity,
-- then grant the default member roles.
--
-- WHY: RBAC (user_roles/user_permissions/profiles) FK to public.platform_users,
-- but the backend authorises by the Supabase auth id (auth.users.id) and the app
-- creates only public.user_profiles on signup — platform_users was never synced,
-- so it sat empty and NO member could ever hold a role (every RBAC-gated route
-- 403s; e.g. connect.discovery.access). The intended model is
-- platform_users.id = auth.users.id. This migration wires that:
--   (a) backfill platform_users from existing auth.users,
--   (b) grant 'registered-user' to every user, 'verified-user' to confirmed emails,
--   (c) AFTER INSERT on auth.users → mirror platform_users + grant registered-user,
--   (d) AFTER UPDATE OF email_confirmed_at → grant verified-user.
-- Semantics (per product): registered-user = signed up; verified-user = email
-- confirmed (OTP/third-party verification can grant it later the same way).
--
-- Idempotent (NOT EXISTS guards — user_roles' UNIQUE treats NULL scope_id as
-- distinct, so ON CONFLICT alone would not dedupe). Additive; no drops.
-- The triggers are SECURITY DEFINER and EXCEPTION-safe: a mirror/grant failure
-- must NEVER abort the underlying auth.users write (would break signup/login).
BEGIN;

-- (a) Backfill platform_users for existing auth users (id = auth id).
INSERT INTO public.platform_users (id, first_name, last_name, email, user_type, status, email_verified_at)
SELECT u.id,
       COALESCE(NULLIF(split_part(COALESCE(u.raw_user_meta_data->>'full_name',''), ' ', 1), ''), ''),
       COALESCE(NULLIF(regexp_replace(COALESCE(u.raw_user_meta_data->>'full_name',''), '^\S+\s*', ''), ''), ''),
       u.email,
       'registered_user',
       'active',
       u.email_confirmed_at
FROM auth.users u
WHERE u.email IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.platform_users p WHERE p.id = u.id);

-- (b1) Grant 'registered-user' to every platform user.
INSERT INTO public.user_roles (user_id, role_id, scope_type, scope_id, is_active)
SELECT p.id, r.id, 'global', NULL, true
FROM public.platform_users p
CROSS JOIN public.roles r
WHERE r.slug = 'registered-user' AND r.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p.id AND ur.role_id = r.id AND ur.scope_type = 'global' AND ur.scope_id IS NULL);

-- (b2) Grant 'verified-user' to users whose email is already confirmed.
INSERT INTO public.user_roles (user_id, role_id, scope_type, scope_id, is_active)
SELECT u.id, r.id, 'global', NULL, true
FROM auth.users u
JOIN public.platform_users p ON p.id = u.id
CROSS JOIN public.roles r
WHERE r.slug = 'verified-user' AND r.is_active = true
  AND u.email_confirmed_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = u.id AND ur.role_id = r.id AND ur.scope_type = 'global' AND ur.scope_id IS NULL);

-- (c) On signup: mirror the platform_users row and grant registered-user.
CREATE OR REPLACE FUNCTION public.rbac_bridge_on_auth_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid;
BEGIN
  IF NEW.email IS NOT NULL THEN
    INSERT INTO public.platform_users (id, first_name, last_name, email, user_type, status, email_verified_at)
    VALUES (NEW.id,
            COALESCE(NULLIF(split_part(COALESCE(NEW.raw_user_meta_data->>'full_name',''), ' ', 1), ''), ''),
            COALESCE(NULLIF(regexp_replace(COALESCE(NEW.raw_user_meta_data->>'full_name',''), '^\S+\s*', ''), ''), ''),
            NEW.email, 'registered_user', 'active', NEW.email_confirmed_at)
    ON CONFLICT (id) DO NOTHING;
  END IF;

  SELECT id INTO rid FROM public.roles WHERE slug = 'registered-user' AND is_active = true;
  IF rid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = NEW.id AND role_id = rid AND scope_type = 'global' AND scope_id IS NULL
  ) THEN
    INSERT INTO public.user_roles (user_id, role_id, scope_type, scope_id, is_active)
    VALUES (NEW.id, rid, 'global', NULL, true);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the auth.users insert on an RBAC mirror hiccup.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_rbac_bridge ON auth.users;
CREATE TRIGGER on_auth_user_rbac_bridge
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.rbac_bridge_on_auth_insert();

-- (d) On email confirmation: grant verified-user.
CREATE OR REPLACE FUNCTION public.rbac_bridge_on_email_confirm()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid;
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND OLD.email_confirmed_at IS NULL THEN
    UPDATE public.platform_users SET email_verified_at = NEW.email_confirmed_at, updated_at = now()
    WHERE id = NEW.id AND email_verified_at IS NULL;

    SELECT id INTO rid FROM public.roles WHERE slug = 'verified-user' AND is_active = true;
    IF rid IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = NEW.id AND role_id = rid AND scope_type = 'global' AND scope_id IS NULL
    ) THEN
      INSERT INTO public.user_roles (user_id, role_id, scope_type, scope_id, is_active)
      VALUES (NEW.id, rid, 'global', NULL, true);
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_confirmed_rbac ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed_rbac
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.rbac_bridge_on_email_confirm();

COMMIT;
