-- Reconcile three migrations that were edited IN PLACE in the golive branch (an
-- additive-only violation). Databases that already applied the ORIGINAL versions will
-- NOT re-run those files (Supabase tracks by filename), so the edits are silently lost.
-- This forward migration idempotently converges every environment to the intended end
-- state, regardless of history. Fully guarded (to_regclass + IF NOT EXISTS + exception
-- handling) so it is a safe no-op where the state is already correct, and never hard-fails.
--
-- Originals reconciled here:
--   20260527100000_enterprise_auth_rbac.sql   — user_roles / user_permissions UNIQUE keys
--                                                changed COALESCE(scope_id,'') → scope_id
--   20260602100000_universal_voting_engine.sql — fraud_flags.voter_profile_id column added
--   20260602120000_contestant_voting_slug.sql  — competition_enrollments (competition_id, slug)
--                                                UNIQUE (invalid `ADD CONSTRAINT IF NOT EXISTS`
--                                                in the original → guarded DO block here)

-- ── 1. RBAC scope uniqueness (enterprise_auth_rbac) ──────────────────────────
-- Intended: a user may hold a (role|permission) once per (scope_type, scope_id), with
-- NULL scope_id treated as DISTINCT (the point of dropping COALESCE). Ensured as an
-- explicit named unique index; drops the old COALESCE-based functional index if present.
DO $$
BEGIN
  IF to_regclass('public.user_roles') IS NOT NULL THEN
    -- Remove the superseded COALESCE variant if some environment created it as a
    -- functional index (it enforced NULL-collision, contradicting the new intent).
    DROP INDEX IF EXISTS public.user_roles_scope_coalesce_uniq;
    BEGIN
      CREATE UNIQUE INDEX IF NOT EXISTS user_roles_scope_uniq
        ON public.user_roles (user_id, role_id, scope_type, scope_id);
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'user_roles_scope_uniq not created — duplicate (user_id,role_id,scope_type,scope_id) rows exist; dedup then re-run';
    END;
  END IF;

  IF to_regclass('public.user_permissions') IS NOT NULL THEN
    DROP INDEX IF EXISTS public.user_permissions_scope_coalesce_uniq;
    BEGIN
      CREATE UNIQUE INDEX IF NOT EXISTS user_permissions_scope_uniq
        ON public.user_permissions (user_id, permission_id, effect, scope_type, scope_id);
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'user_permissions_scope_uniq not created — duplicate rows exist; dedup then re-run';
    END;
  END IF;
END $$;

-- ── 2. fraud_flags.voter_profile_id (universal_voting_engine) ─────────────────
DO $$
BEGIN
  IF to_regclass('public.fraud_flags') IS NOT NULL AND to_regclass('public.voter_profiles') IS NOT NULL THEN
    ALTER TABLE public.fraud_flags
      ADD COLUMN IF NOT EXISTS voter_profile_id uuid REFERENCES public.voter_profiles(id);
  END IF;
END $$;

-- ── 3. competition_enrollments (competition_id, slug) UNIQUE (contestant_voting_slug) ──
DO $$
BEGIN
  IF to_regclass('public.competition_enrollments') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_enrollment_contest_slug') THEN
    BEGIN
      ALTER TABLE public.competition_enrollments
        ADD CONSTRAINT uq_enrollment_contest_slug UNIQUE (competition_id, slug);
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'uq_enrollment_contest_slug not added — duplicate (competition_id, slug) rows exist; dedup then re-add';
    END;
  END IF;
END $$;
