-- Platform module registry — a readiness axis, separate from availability.
--
-- WHY: the registry could only say what to SHOW (hidden / coming_soon / visible), so
-- two very different situations shared one value:
--
--   • "this is finished and we have chosen not to launch it yet"
--   • "this is still being built and would not survive a user"
--
-- Both are `hidden`, which means the admin portal cannot answer the question it most
-- needs to: is this module safe to publish? The publish action and the state of the
-- code were one decision, so a build could be published by someone who could not see
-- that it was unfinished.
--
-- This adds the missing half of the owner's instruction: readiness describes the
-- product (in_development -> testing -> ready), availability stays the per-environment
-- publication decision. They are deliberately not derived from one another: a `ready`
-- module is not automatically live anywhere, and a module live in staging is not
-- automatically ready.
--
-- Readiness is enforced in Go, in BOTH directions:
--   • publishing to production refuses anything below 'ready'
--     (backend/internal/modules/model.go, AssertPublishableIn);
--   • a production deployment will not SERVE a module below 'ready'
--     (backend/internal/modules/model.go, VisibleIn), so demoting readiness withdraws
--     a module from live users without anyone having to find the second toggle.
-- A CHECK constraint cannot express either: each spans two tables and one row of each.
--
-- DEPLOY ORDER — migration FIRST, then the backend. The registry query reads this
-- column, so a backend built against it and deployed before the column exists fails
-- every module read, which the mobile app then degrades to its offline allowlist.
--
-- Additive-only: one column with a default, a widened audit action set, and an
-- UPDATE that records today's facts. No DROP, no rename, no type narrowing. Existing
-- rows never lose a value, and nothing changes what any environment displays — that
-- last property comes from the backfill below, NOT from the default, so it must not be
-- edited away.
--
-- VERSION: 20271408000000 was already taken by 20271408000000_preconsult_intake_schema_ui.sql
-- on main when this branch merged it. The version is the primary key, so a shared number
-- makes `db push` apply one file, record the version and skip the other with no error.

ALTER TABLE public.platform_modules
    ADD COLUMN IF NOT EXISTS readiness TEXT NOT NULL DEFAULT 'in_development';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_modules_readiness_check') THEN
        ALTER TABLE public.platform_modules
            ADD CONSTRAINT platform_modules_readiness_check
            CHECK (readiness IN ('in_development','testing','ready'));
    END IF;
END $$;

-- Backfill from what the registry already knows, so the board is true on day one
-- rather than a wall of 'in_development' that nobody will hand-correct:
--
--   visible in production  -> ready          (it is serving live users today)
--   visible in staging     -> testing        (someone is using it, publicly it is not)
--   anything else          -> in_development (the column default, left alone)
--
-- The first branch is load-bearing, not cosmetic. Production now hides any module that
-- is not 'ready', so backfilling 'ready' over the modules already visible there is what
-- keeps this migration from pulling live modules off the app the moment it runs.
--
-- This is a statement about publication history, not about code quality: an admin can
-- move any module to any readiness at any time. It only sets the starting point.
UPDATE public.platform_modules m
   SET readiness = CASE
           WHEN EXISTS (
               SELECT 1 FROM public.platform_module_environments e
                WHERE e.module_key = m.key AND e.environment = 'production' AND e.status = 'visible'
           ) THEN 'ready'
           WHEN EXISTS (
               SELECT 1 FROM public.platform_module_environments e
                WHERE e.module_key = m.key AND e.environment = 'staging' AND e.status = 'visible'
           ) THEN 'testing'
           ELSE 'in_development'
       END;

-- Readiness changes must be as traceable as publication changes: "who said this was
-- ready, and when" is the record an incident review asks for. Additive superset, same
-- named-CHECK pattern as 20261215000000_module_coming_soon_status.sql.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_module_audit_action_check') THEN
        ALTER TABLE public.platform_module_audit DROP CONSTRAINT platform_module_audit_action_check;
    END IF;
    ALTER TABLE public.platform_module_audit
        ADD CONSTRAINT platform_module_audit_action_check
        CHECK (action IN ('publish','hide','archive','restore','readiness'));
END $$;

COMMENT ON COLUMN public.platform_modules.readiness IS
    'Product readiness of the module itself: in_development | testing | ready. Independent of per-environment publication. Go will neither publish nor serve a module in production until this is ready; a coming_soon teaser is exempt, because a teaser is inert.';
