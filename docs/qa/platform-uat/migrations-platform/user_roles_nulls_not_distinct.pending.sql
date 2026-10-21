-- PENDING (platform UAT lane — orchestrator applies/renumbers at consolidation)
--
-- Close the user_roles duplicate-grant hole for NULL-scoped (global) grants.
--
-- DEFECT (PLT-D001): public.user_roles carries
--   UNIQUE (user_id, role_id, scope_type, scope_id)
-- but every global-scoped grant inserts scope_id = NULL, and Postgres unique
-- indexes treat NULLs as distinct — so the constraint NEVER fires for global
-- grants. The writers that rely on it:
--   * backend/internal/onboarding/repository.go grantRole (fixed in code this
--     lane — NULL-scoped upsert instead of ON CONFLICT)
--   * backend/internal/restaurant/service.go (same ON CONFLICT pattern —
--     cross-cutting instance recorded for the restaurant lane)
-- insert a fresh duplicate user_roles row on EVERY replay. Live proof on the
-- UAT stack: admin approving an already-APPROVED onboarding application (an
-- explicitly-supported idempotent retry) produced two identical ACTIVE
-- marketplace_seller rows 82ms apart.
--
-- FIX: a UNIQUE index with NULLS NOT DISTINCT (PG15+; this project is PG17).
-- With NULLs treated as equal, the index fires on global grants, AND it serves
-- as the conflict arbiter for the existing
--   ON CONFLICT (user_id, role_id, scope_type, scope_id)
-- clauses — making them work as the writers already assumed. Sequential AND
-- concurrent first-grants then converge on one row.
--
-- DEDUP NOTE: run this only after pruning existing duplicates. Local UAT DBs
-- that exercised idempotent approvals may already carry twin rows. A prune
-- statement is included below but commented out — duplicates are a test-data
-- artifact, not something to blind-apply against a production table without a
-- reviewed dedup query per consumer semantics.
--
-- Additive-only: one index, nothing dropped, nothing narrowed.

-- Optional pre-step (review before enabling): keep the OLDEST active grant per
-- (user_id, role_id, scope_type, NULL scope_id), delete newer twins.
-- DELETE FROM public.user_roles a
-- USING public.user_roles b
-- WHERE a.ctid <> b.ctid
--   AND a.user_id = b.user_id
--   AND a.role_id = b.role_id
--   AND a.scope_type = b.scope_type
--   AND a.scope_id IS NULL AND b.scope_id IS NULL
--   AND a.created_at > b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_unique_nulls_not_distinct
    ON public.user_roles (user_id, role_id, scope_type, scope_id)
    NULLS NOT DISTINCT;
