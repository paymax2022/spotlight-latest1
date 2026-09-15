-- Fix rbac_bridge_on_auth_insert()'s phone source: it copies platform_users.phone
-- from the bare auth.users.phone column, which real signups never set.
--
-- WHY: ADR-053 (20270203000000_rbac_bridge_phone_only_identities.sql) added
-- `phone` to the mirror insert, copying `NEW.phone` -- GoTrue's own top-level
-- column. RegisterUser (backend/internal/services/auth_service.go) never sets
-- that column: it sends phone inside the signup/admin-create request's
-- "data"/"user_metadata" payload (both land in raw_user_meta_data), and
-- separately PATCHes it onto user_profiles.phone after the account exists.
-- Confirmed on local Supabase: 0 of 57,703 platform_users rows carry a phone,
-- while 5 of 6 populated user_profiles.phone rows have the same value sitting
-- in auth.users.raw_user_meta_data->>'phone' the whole time -- auth.users.phone
-- itself is blank on every one of them. So ADR-053's copy is a structural
-- no-op for every real user; only a synthetic direct-`NEW.phone` insert would
-- ever populate it.
--
-- handle_new_user() (20261224000000_user_profiles_phone_backfill.sql) already
-- solved this exact problem for user_profiles.phone by reading
-- COALESCE(raw_user_meta_data->>'phone', NEW.phone) instead of the raw column
-- alone. This migration applies the same precedent to the RBAC bridge so
-- platform_users -- the pgx-pool identity mirror ADR-052 establishes as
-- authoritative for every money-path call site -- actually holds real phone
-- numbers instead of silently depending on which trigger a future reader
-- happens to trust.
--
-- Scope note: backend/internal/app/health_triage_routes.go's WhatsApp lookup
-- does NOT need this -- it was independently repointed at user_profiles.phone
-- directly (commit 50fd9c83) after finding the same platform_users gap. This
-- migration is platform_users' own correctness fix, not a dependency of that
-- change. Additive only: CREATE OR REPLACE + a guarded backfill UPDATE.

BEGIN;

-- (a) On signup: same mirror as ADR-053, phone source corrected to match
-- handle_new_user's own COALESCE order (metadata first, raw column fallback).
CREATE OR REPLACE FUNCTION public.rbac_bridge_on_auth_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rid uuid;
  v_phone text;
BEGIN
  v_phone := COALESCE(NULLIF(NEW.raw_user_meta_data->>'phone', ''), NULLIF(NEW.phone, ''));

  INSERT INTO public.platform_users (id, first_name, last_name, email, phone, user_type, status, email_verified_at)
  VALUES (NEW.id,
          COALESCE(NULLIF(split_part(COALESCE(NEW.raw_user_meta_data->>'full_name',''), ' ', 1), ''), ''),
          COALESCE(NULLIF(regexp_replace(COALESCE(NEW.raw_user_meta_data->>'full_name',''), '^\S+\s*', ''), ''), ''),
          NEW.email, v_phone, 'registered_user', 'active', NEW.email_confirmed_at)
  ON CONFLICT (id) DO NOTHING;

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

-- (b) Backfill existing platform_users rows the same way ADR-053's own
-- backfill did, just reading the corrected source. Fills blanks only -- an
-- existing platform_users.phone always wins, so re-running this is a no-op.
UPDATE public.platform_users pu
SET    phone = COALESCE(NULLIF(u.raw_user_meta_data->>'phone', ''), NULLIF(u.phone, ''))
FROM   auth.users u
WHERE  u.id = pu.id
  AND  COALESCE(pu.phone, '') = ''
  AND  COALESCE(NULLIF(u.raw_user_meta_data->>'phone', ''), NULLIF(u.phone, '')) IS NOT NULL;

COMMIT;
