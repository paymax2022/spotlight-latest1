-- platform_users bridge repair: re-assert the auth.users -> platform_users
-- mirror AND heal the accounts its failure already orphaned.
--
-- WHY: on prod, register returns 200 + a real GoTrue id, but no platform_users
-- row is ever written. LoginUser's findPlatformUserByEmail lookup then finds
-- zero rows and, per the AUTH-014 gate, refuses with "invalid credentials" —
-- so every account created while the bridge is dead can NEVER log in.
--
-- The bridge's migration chain (20260904000000_rbac_identity_bridge.sql,
-- 20270203000000_rbac_bridge_phone_only_identities.sql,
-- 20270204010000_rbac_bridge_phone_metadata_source.sql) is recorded-applied
-- in prod's schema_migrations, yet the mirror does not happen. Two candidate
-- causes, both repaired here because they are indistinguishable from outside:
--   1. Post-drift reconciliation marked the version applied without the DDL
--      ever running (docs/devops/cloud-migration-reconciliation-runbook.md) —
--      the function and/or the auth.users trigger simply do not exist.
--   2. The trigger exists but its INSERT dies on a constraint the code did not
--      anticipate (e.g. the email UNIQUE colliding under a different id, or a
--      NOT NULL column prod gained out-of-band), and EXCEPTION WHEN OTHERS
--      swallows it silently — by design it must never abort the auth.users
--      write, so the ONLY symptom is the missing row.
-- In-repo platform_users gained no NOT NULL column without a default after the
-- bridge was written (20260701000000_session_hardening.sql's three columns all
-- carry defaults), so the insert shape below covers every repo-known column.
--
-- WHAT IT DOES (all idempotent / additive):
--   (a) CREATE OR REPLACE both bridge functions. The mirror insert keeps
--       ON CONFLICT DO NOTHING but drops the (id) target so a unique
--       collision on email cannot error the row away either. The role grant
--       moves into its own nested EXCEPTION block so a user_roles failure can
--       no longer roll the mirror insert back with it. The outer handler keeps
--       never aborting auth.users writes but now RAISEs WARNING with SQLERRM
--       + SQLSTATE — the next failure is visible in Postgres logs instead of
--       producing a permanently-unable-to-login account in silence.
--   (b) DROP TRIGGER IF EXISTS + CREATE TRIGGER for both auth.users triggers —
--       repairs triggers whose version was repair-marked applied while the
--       CREATE TRIGGER never ran.
--   (c) Backfill platform_users for every auth.users row still missing its
--       mirror, then grant registered-user (and verified-user where the email
--       is already confirmed) — this heals already-broken accounts with no
--       manual data fix. Untargeted ON CONFLICT DO NOTHING here too.
--   (d) RAISE NOTICE/WARNING with the post-backfill orphan count so `db push`
--       output states plainly whether anything remains unmirrored (a leftover
--       means an email collision under a different id — inspect by hand).
BEGIN;

-- ── (a1) Signup mirror: any identity (email or phone), all mirrored columns ──
CREATE OR REPLACE FUNCTION public.rbac_bridge_on_auth_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rid uuid;
  v_phone text;
BEGIN
  v_phone := COALESCE(NULLIF(NEW.raw_user_meta_data->>'phone', ''), NULLIF(NEW.phone, ''));

  -- Untargeted ON CONFLICT: covers id AND the email UNIQUE — either collision
  -- skips the insert instead of raising into the exception handler.
  INSERT INTO public.platform_users (id, first_name, last_name, email, phone, user_type, status, email_verified_at)
  VALUES (NEW.id,
          COALESCE(NULLIF(split_part(COALESCE(NEW.raw_user_meta_data->>'full_name',''), ' ', 1), ''), ''),
          COALESCE(NULLIF(regexp_replace(COALESCE(NEW.raw_user_meta_data->>'full_name',''), '^\S+\s*', ''), ''), ''),
          NEW.email, v_phone, 'registered_user', 'active', NEW.email_confirmed_at)
  ON CONFLICT DO NOTHING;

  -- Role grant in its own block: a user_roles/roles failure must NOT roll the
  -- mirror insert back (plpgsql exceptions undo the whole enclosing block).
  BEGIN
    SELECT id INTO rid FROM public.roles WHERE slug = 'registered-user' AND is_active = true;
    IF rid IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = NEW.id AND role_id = rid AND scope_type = 'global' AND scope_id IS NULL
    ) THEN
      INSERT INTO public.user_roles (user_id, role_id, scope_type, scope_id, is_active)
      VALUES (NEW.id, rid, 'global', NULL, true);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'rbac_bridge_on_auth_insert: registered-user grant failed for auth.users id=%: % (%)',
      NEW.id, SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the auth.users insert on a mirror failure — but no longer
  -- silently: the warning lands in Postgres/GoTrue logs with the real error.
  RAISE WARNING 'rbac_bridge_on_auth_insert: mirror failed for auth.users id=% email=%: % (%)',
    NEW.id, NEW.email, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;

-- ── (a2) Email-confirmation grant: verified-user + email_verified_at stamp ───
CREATE OR REPLACE FUNCTION public.rbac_bridge_on_email_confirm()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid;
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND OLD.email_confirmed_at IS NULL THEN
    UPDATE public.platform_users SET email_verified_at = NEW.email_confirmed_at, updated_at = now()
    WHERE id = NEW.id AND email_verified_at IS NULL;

    BEGIN
      SELECT id INTO rid FROM public.roles WHERE slug = 'verified-user' AND is_active = true;
      IF rid IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.user_roles WHERE user_id = NEW.id AND role_id = rid AND scope_type = 'global' AND scope_id IS NULL
      ) THEN
        INSERT INTO public.user_roles (user_id, role_id, scope_type, scope_id, is_active)
        VALUES (NEW.id, rid, 'global', NULL, true);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'rbac_bridge_on_email_confirm: verified-user grant failed for auth.users id=%: % (%)',
        NEW.id, SQLERRM, SQLSTATE;
    END;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'rbac_bridge_on_email_confirm: failed for auth.users id=%: % (%)',
    NEW.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;

-- ── (b) Re-assert both triggers — no-ops if they already exist correctly ──────
DROP TRIGGER IF EXISTS on_auth_user_rbac_bridge ON auth.users;
CREATE TRIGGER on_auth_user_rbac_bridge
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.rbac_bridge_on_auth_insert();

DROP TRIGGER IF EXISTS on_auth_user_email_confirmed_rbac ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed_rbac
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.rbac_bridge_on_email_confirm();

-- ── (c) Backfill orphans: every auth.users row still missing its mirror ──────
-- Untargeted ON CONFLICT so an email-collision-under-different-id skips rather
-- than aborts the whole backfill; those rows surface in the (d) orphan count.
INSERT INTO public.platform_users (id, first_name, last_name, email, phone, user_type, status, email_verified_at)
SELECT u.id,
       COALESCE(NULLIF(split_part(COALESCE(u.raw_user_meta_data->>'full_name',''), ' ', 1), ''), ''),
       COALESCE(NULLIF(regexp_replace(COALESCE(u.raw_user_meta_data->>'full_name',''), '^\S+\s*', ''), ''), ''),
       u.email,
       COALESCE(NULLIF(u.raw_user_meta_data->>'phone', ''), NULLIF(u.phone, '')),
       'registered_user',
       'active',
       u.email_confirmed_at
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.platform_users p WHERE p.id = u.id)
ON CONFLICT DO NOTHING;

-- Grant registered-user to every mirrored user still lacking it (same
-- idempotent NOT EXISTS guard as the original bridge — user_roles' UNIQUE
-- treats NULL scope_id as distinct, so ON CONFLICT alone would not dedupe).
INSERT INTO public.user_roles (user_id, role_id, scope_type, scope_id, is_active)
SELECT p.id, r.id, 'global', NULL, true
FROM public.platform_users p
CROSS JOIN public.roles r
WHERE r.slug = 'registered-user' AND r.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p.id AND ur.role_id = r.id AND ur.scope_type = 'global' AND ur.scope_id IS NULL);

-- And verified-user where the email is already confirmed (mirrors step b2 of
-- 20260904000000 — orphaned accounts that confirmed while the bridge was dead
-- earned the role but never received it).
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

-- ── (d) Report: how many auth.users rows remain unmirrored after backfill ────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM auth.users u
  WHERE NOT EXISTS (SELECT 1 FROM public.platform_users p WHERE p.id = u.id);
  IF n > 0 THEN
    RAISE WARNING 'platform_users bridge repair: % auth.users row(s) still unmirrored after backfill — likely an email UNIQUE collision under a different id; inspect manually', n;
  ELSE
    RAISE NOTICE 'platform_users bridge repair: all auth.users rows are mirrored';
  END IF;
END $$;

COMMIT;
