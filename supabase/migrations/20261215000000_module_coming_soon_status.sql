-- Platform module registry — add a third per-environment status: 'coming_soon'.
--
-- The registry could previously only say hidden or visible, so ops had no way to put a
-- module in front of users as a teaser without it also being tappable. "Coming soon"
-- existed only as a hardcoded flag in the mobile catalog
-- (mobile-app/reactnative/src/constants/modules.ts), which meant changing it required an
-- app release and could not differ per environment.
--
--   hidden       → not rendered
--   coming_soon  → rendered, inert (ModuleCard already drops onPress for this)
--   visible      → rendered and tappable
--
-- Additive superset: drop and re-add the named CHECK with the wider set (same pattern as
-- restaurant_promos_kind_check gaining 'free_delivery'). Every existing row is 'hidden'
-- or 'visible' and still satisfies it, and the column default is unchanged, so this
-- migration alters no data and no module changes state.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_module_environments_status_check') THEN
        ALTER TABLE platform_module_environments DROP CONSTRAINT platform_module_environments_status_check;
    END IF;
    ALTER TABLE platform_module_environments
        ADD CONSTRAINT platform_module_environments_status_check
        CHECK (status IN ('hidden','coming_soon','visible'));
END $$;
