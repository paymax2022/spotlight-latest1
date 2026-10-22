-- Platform UAT (PLT-D001): close the user_roles duplicate-grant hole for
-- NULL-scoped (global) grants. UNIQUE (user_id, role_id, scope_type, scope_id)
-- never fires when scope_id IS NULL because Postgres treats NULLs as distinct,
-- so every idempotent replay of a global grant inserted a twin row (live proof:
-- re-approving an APPROVED onboarding application produced two ACTIVE
-- marketplace_seller rows 82ms apart). NULLS NOT DISTINCT (PG15+) makes the
-- index fire on global grants and lets the existing
--   ON CONFLICT (user_id, role_id, scope_type, scope_id)
-- clauses arbitrate as their writers assumed. Additive-only: one index.
--
-- Guarded: twin rows are a semantic question per consumer, not something to
-- blind-delete, so if any exist the index is skipped with a WARNING. Find them:
--   SELECT user_id, role_id, scope_type, COUNT(*) FROM public.user_roles
--   WHERE scope_id IS NULL GROUP BY 1,2,3 HAVING COUNT(*) > 1;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.user_roles WHERE scope_id IS NULL
    GROUP BY user_id, role_id, scope_type HAVING COUNT(*) > 1
  ) THEN
    RAISE WARNING 'user_roles_unique_nulls_not_distinct skipped: duplicate global grants exist — prune, then re-run';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS user_roles_unique_nulls_not_distinct
      ON public.user_roles (user_id, role_id, scope_type, scope_id)
      NULLS NOT DISTINCT;
  END IF;
END $$;
