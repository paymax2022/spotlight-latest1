-- Mirror phone-only auth.users identities into platform_users too.
--
-- WHY: rbac_bridge_on_auth_insert() (20260904000000_rbac_identity_bridge.sql)
-- only mirrors `IF NEW.email IS NOT NULL`. Supabase Auth allows a user to be
-- created with a phone and no email (native phone/SMS signup, or an
-- admin.createUser call that omits email); such a row is never mirrored, so
-- every pgx-pool call site that treats "no platform_users row" as "not a
-- real user" silently degrades for that customer instead of erroring. The
-- money-path instance is orchestration.mainWalletAccountID (ADR-052): a
-- missing platform_users row makes it return ok=false, and the caller falls
-- back to routing that customer's NGN through the legacy orch_balances pot
-- instead of the main ledger — the exact "two pots for one currency" bug
-- class ADR-051 already fixed once, for a different root cause.
--
-- No registration flow in this codebase creates a phone-only auth.users row
-- today (RegisterUser always sends email; phone is patched onto
-- user_profiles afterward, never used to create the auth account) — so this
-- closes a latent gap, not a currently-exploitable one. Fixing it in the
-- bridge itself, rather than in each of the ~19 call sites, keeps the
-- "platform_users mirrors every auth identity" invariant true regardless of
-- how a future signup path creates the auth.users row.
--
-- (a) platform_users.email must become nullable for a phone-only mirror row
--     to insert at all. Additive: WIDENING a constraint (NOT NULL -> NULL),
--     not narrowing it. The UNIQUE index is untouched and allows any number
--     of NULLs, so this cannot collide two phone-only users on email.
-- (b) The insert/backfill also copies `phone`, since platform_users.phone
--     was never populated by the original bridge for ANY user (email-based
--     included) — a pre-existing separate gap, out of scope here beyond not
--     making it worse for the phone-only case this migration adds.
-- (c) Trigger/backfill logic changes only widen who gets mirrored (drop the
--     `email IS NOT NULL` gate); the email-confirmation grant path in
--     rbac_bridge_on_email_confirm() is untouched — it already no-ops
--     correctly for a NULL email_confirmed_at.
BEGIN;

ALTER TABLE public.platform_users ALTER COLUMN email DROP NOT NULL;

-- (a) Backfill any auth.users row (email- or phone-identified) still missing
-- its platform_users mirror.
INSERT INTO public.platform_users (id, first_name, last_name, email, phone, user_type, status, email_verified_at)
SELECT u.id,
       COALESCE(NULLIF(split_part(COALESCE(u.raw_user_meta_data->>'full_name',''), ' ', 1), ''), ''),
       COALESCE(NULLIF(regexp_replace(COALESCE(u.raw_user_meta_data->>'full_name',''), '^\S+\s*', ''), ''), ''),
       u.email,
       u.phone,
       'registered_user',
       'active',
       u.email_confirmed_at
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.platform_users p WHERE p.id = u.id);

-- (b) Grant 'registered-user' to any newly-backfilled platform user (same
-- idempotent shape as 20260904000000's step (b1)).
INSERT INTO public.user_roles (user_id, role_id, scope_type, scope_id, is_active)
SELECT p.id, r.id, 'global', NULL, true
FROM public.platform_users p
CROSS JOIN public.roles r
WHERE r.slug = 'registered-user' AND r.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p.id AND ur.role_id = r.id AND ur.scope_type = 'global' AND ur.scope_id IS NULL);

-- (c) On signup: mirror the platform_users row (any identity, not just
-- email) and grant registered-user.
CREATE OR REPLACE FUNCTION public.rbac_bridge_on_auth_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid;
BEGIN
  INSERT INTO public.platform_users (id, first_name, last_name, email, phone, user_type, status, email_verified_at)
  VALUES (NEW.id,
          COALESCE(NULLIF(split_part(COALESCE(NEW.raw_user_meta_data->>'full_name',''), ' ', 1), ''), ''),
          COALESCE(NULLIF(regexp_replace(COALESCE(NEW.raw_user_meta_data->>'full_name',''), '^\S+\s*', ''), ''), ''),
          NEW.email, NEW.phone, 'registered_user', 'active', NEW.email_confirmed_at)
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

COMMIT;
