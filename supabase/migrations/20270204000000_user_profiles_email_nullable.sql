-- Let handle_new_user() mirror a phone-only auth.users row without erroring.
--
-- WHY: public.user_profiles.email is TEXT NOT NULL (20260401004207_create_user_profiles.sql).
-- handle_new_user() (AFTER INSERT ON auth.users, most recently amended by
-- 20261224000000_user_profiles_phone_backfill.sql) inserts NEW.email verbatim.
-- For a phone-only Supabase Auth signup (email NULL), that INSERT violates the
-- NOT NULL constraint, has no exception handler, and aborts the WHOLE
-- auth.users insert transaction -- not a silent degrade, a hard failure that
-- currently makes phone-only signup impossible in every environment. See
-- ADR-054 for the full picture, including what this migration deliberately
-- does NOT fix (phone-only login, SMS/OTP delivery).
--
-- Additive: widens a constraint (NOT NULL -> NULL), does not narrow one. The
-- UNIQUE index (user_profiles_email_key) is untouched -- Postgres allows
-- unlimited NULLs under UNIQUE, so this cannot collide two phone-only users.
--
-- handle_new_user()'s own INSERT statement needs no change: it already just
-- passes NEW.email through with no NOT-NULL-enforcing expression around it --
-- the column constraint was the only blocker.
BEGIN;

ALTER TABLE public.user_profiles ALTER COLUMN email DROP NOT NULL;

COMMIT;
