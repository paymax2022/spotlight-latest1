-- Mobile menu visibility (spec: docs/superpowers/specs/2026-11-17-mobile-menu-visibility-design.md)
-- Registers every services-grid tile in the platform module registry so
-- /admin/modules can toggle any tile per environment. Product decision
-- 2026-11-17: the tiles flipped/seeded HIDDEN below ship disabled in staging +
-- production; every other row keeps the visibility users already have.
-- Development keeps everything visible. env_flag stays NULL on every new row:
-- coupling a menu tile to a FEATURE_* flag that may be unset on a plane would
-- silently hide it; the ops-flag lane can add flags later.
--
-- VERSION SLOT. This file deliberately sorts AFTER
-- 20271408000100_module_readiness.sql and 20271410000000_module_registry_add_ungated_surfaces.sql,
-- for two reasons that are both measured rather than assumed:
--   1. #996 registered marketplace/crypto/academy/filmAcademy/competitions/arena/connect
--      itself. Sorting earlier made this seed win ON CONFLICT and fix their
--      name/category against #996's text; sorting later lets #996 win, which is what
--      main's own route/label/deep-link assertions are written against.
--   2. `readiness` does not exist until 20271408000100, and production refuses to
--      SERVE a module whose readiness is not 'ready' (Module.VisibleIn in
--      backend/internal/modules/model.go). A row created here as production-visible
--      could only say so honestly if the column already exists.

INSERT INTO public.platform_modules (key, name, category, env_flag, description) VALUES
  ('investment',           'Investment',         'investment', NULL, 'Investment tile — stocks & ETFs entry (/investment)'),
  ('investAi',             'Invest AI',          'investment', NULL, 'Invest AI tile (/invest-ai)'),
  ('spotlightWealth',      'Spotlight Wealth',   'investment', NULL, 'Spotlight Wealth tile (/spotlight-wealth)'),
  ('fractionalRealEstate', 'Real Estate Invest', 'investment', NULL, 'Real estate investment tile (/fractionalre)'),
  ('aiTrading',            'AI Trading',         'investment', NULL, 'AI Trading — custodial, eligibility-gated managed fund tile (/ai-trading)'),
  ('academy',              'StudyHub',           'education',  NULL, 'StudyHub learning tile (/learn/academy)'),
  ('dues',                 'Dues & Rent',        'property',   NULL, 'Dues & Rent tile (/dues)'),
  ('admin',                'Admin',              'ops',        NULL, 'In-app admin console tile (/admin) — hides the tile only; /admin routes are deliberately never release-gated'),
  ('crypto',               'Crypto',             'investment', NULL, 'Crypto trading wallet tile (/crypto)'),
  ('education',            'Education',          'utility',    NULL, 'Education payments tile (/services/education)'),
  ('arena',                'Naija Driver',       'contest',    NULL, 'Arena competition engine tile (/arena)'),
  ('filmAcademy',          'Film Academy',       'education',  NULL, 'Film Academy native tile (/film-academy)'),
  ('connect',              'Connect',            'community',  NULL, 'Connect tile (/connect)'),
  ('marketplace',          'Marketplace',        'commerce',   NULL, 'Lifestyle marketplace shopping tile (/marketplace)')
ON CONFLICT (key) DO NOTHING;

-- The Contest tile maps onto #996's existing `competitions` module and Property Mgmt
-- onto `realtor` — no rows for those two here, by design. `competitions` is the one
-- key #996 registered that this migration republishes; see the R2 note below.
--
-- NO ROWS FOR `shopping` / `parcel`. The original design listed them (visible,
-- commerce) so the admin would own every tile, but a registry row is only useful if
-- the client gates on it, and gating them is exactly what main forbids:
-- visibility.spec.ts asserts `registryKeyFor('shopping') === null` and calls them
-- "a coming-soon placeholder with no engine and no registry row", and gating one
-- empties its category group in the `a category group that gates to empty is dropped
-- entirely` case. So they stay unmapped, which makes a row for them a control that
-- lies: it would appear in /admin/modules, accept toggles, write audit rows and
-- change nothing in the shipped app. Two tiles of the 22 are therefore NOT
-- admin-togglable yet; they become togglable in the change that gives them engines
-- and maps them, and the `NO_REGISTRY_ROW` exemption in
-- tests/unit/modules/serviceModuleKeys.spec.ts is what keeps that honest in the
-- meantime. Spec R2's "whole-grid control" is satisfied for every tile the client
-- actually gates.
--
-- NO `learn` ROW EITHER. The Learn tile id ('learn') is gated on #996's `academy` key,
-- which is what main's own assertions encode: routeModuleKeys.ts maps the /learn route
-- to 'academy' and visibility.spec.ts asserts ['learn', 'academy']. A `learn` row would
-- be a second toggle that gates nothing, for the same reason as the two above.
--
-- WHAT THE `admin` SWITCH DOES NOT DO, AND WHERE THE TILES AND THE ROUTES DIVERGE.
-- Hiding a tile removes the grid entry point; it is not the same control as the
-- deep-link guard in routeModuleKeys.ts. That file lists 'admin' among the surfaces
-- that are "never release-gated", so the console stays reachable by URL while its tile
-- is off, and the row's description says so outright because /admin/modules is where an
-- operator would otherwise conclude the toggle is broken. It has no entry for the other
-- investment tiles, `dues` or `property` either — the investment family is documented
-- there as having no single module key, dues/property as gated through the property
-- hub — EXCEPT one: routeModuleKeys.ts:59 gates the `/fractionalre` ROUTE on 'realtor'
-- (the key b66c16aa5 chose), while this change gates the fractionalre TILE on
-- 'fractionalRealEstate'. Those two switches are deliberately not unified here: moving
-- the route onto the tile's key would make an existing page fail closed on exactly the
-- planes where this migration ships that tile hidden. Authz on the pages themselves is
-- a separate layer this migration does not move.

-- Environment states: everything visible in development; the preserve-list is
-- visible everywhere (current UX); the rest of the new rows hidden on
-- staging/production (registry doctrine: production is opt-in).
INSERT INTO public.platform_module_environments (module_key, environment, status)
SELECT m.key, e.env,
       CASE WHEN e.env = 'development'
              OR m.key IN ('crypto','education','arena','filmAcademy','connect','marketplace')
            THEN 'visible' ELSE 'hidden' END
  FROM public.platform_modules m
  CROSS JOIN (VALUES ('development'),('staging'),('production')) AS e(env)
  WHERE m.key IN ('investment','investAi','spotlightWealth','fractionalRealEstate',
                  'aiTrading','academy','dues','admin','crypto','education','arena',
                  'filmAcademy','connect','marketplace')
ON CONFLICT (module_key, environment) DO NOTHING;

-- Spec R2, as an UPDATE rather than as a seed.
--
-- The INSERT above cannot carry R2 on its own: ON CONFLICT DO NOTHING never
-- overwrites a row that already exists, and on every plane that has already run
-- #996 those rows DO exist — 20271410000000 seeds marketplace/crypto/academy/
-- filmAcademy/competitions/arena/connect as hidden in staging AND production.
-- Measured live on 2026-11-17 against both backends: GET /api/v1/modules/visibility
-- reported none of crypto, education, arena, filmAcademy, connect, marketplace,
-- competitions as visible on staging or production. SIX of those seven are already
-- gated, because #996 (3654f6b3f) shipped the mobile mappings itself -- crypto, arena,
-- filmAcademy, connect, marketplace and contest -> competitions are all in main's
-- SERVICE_MODULE_REGISTRY_KEY today; only 'education' is mapped by the feature branch.
-- So any build containing those mappings already hides those tiles, and whether the
-- installed store artifact is such a build is not something this repo can measure
-- (ADR-PR1026: local Gradle, gitignored .env.production, no tracked build date).
-- Without this UPDATE the six stay hidden -- a drop for builds that shipped the
-- mappings, and a permanent drop waiting at the next registry fetch for any that did
-- not -- which is the opposite of "nothing changes on day one".
--
-- competitions is included because the Contest tile maps to it (see
-- serviceModuleKeys.ts and #996's own comment: voteBridge is the wallet-paid vote
-- money rail, not the contest surface). This overrides #996's "hidden until someone
-- marks them ready" park for that one key, on the grounds that users already see the
-- tile; an admin can hide it from /admin/modules without a deploy.
--
-- Guarded and idempotent, same shape as the hide flip below.
WITH before AS (
  SELECT e.module_key, e.environment, e.status AS before_val
    FROM public.platform_module_environments e
   WHERE e.module_key IN ('crypto','education','arena','filmAcademy','connect',
                          'marketplace','competitions')
     AND e.environment IN ('staging','production')
     AND e.status <> 'visible'
   FOR UPDATE
), flipped AS (
  UPDATE public.platform_module_environments e
     SET status = 'visible', updated_at = now()
    FROM before b
   WHERE e.module_key = b.module_key
     AND e.environment = b.environment
  RETURNING e.module_key, e.environment
)
INSERT INTO public.platform_module_audit (module_key, environment, action, before_val, after_val, note)
SELECT f.module_key, f.environment, 'publish', b.before_val, 'visible',
       'Day-one visibility preserved per mobile menu visibility spec 2026-11-17 (R2)'
  FROM flipped f
  JOIN before b ON b.module_key = f.module_key AND b.environment = f.environment;

-- Production only SERVES a module whose readiness is 'ready' (Module.VisibleIn), so
-- flipping the environment row is half the job: without this the rows above say
-- visible and the production payload still omits the module. This mirrors exactly
-- what 20271408000100's backfill asserts — "an empty/in_development readiness must
-- not pull a module that production already ships" — and it is the same statement
-- about publication history, not about code quality. It is NOT a claim that
-- production serves these modules today: the live production payload omits all seven
-- (measured 2026-11-17), which is exactly why the UPDATE above publishes them and why
-- readiness has to move in the same migration or the rows would say visible while the
-- payload still left them out. Staging ignores readiness, so only production-visible
-- keys are touched, and the audit row is module-scoped (environment NULL) the way
-- SetReadiness writes it.
WITH before AS (
  SELECT m.key, m.readiness AS before_val
    FROM public.platform_modules m
    JOIN public.platform_module_environments e
      ON e.module_key = m.key AND e.environment = 'production' AND e.status = 'visible'
   WHERE m.key IN ('crypto','education','arena','filmAcademy','connect',
                   'marketplace','competitions')
     AND m.readiness <> 'ready'
   FOR UPDATE OF m
), flipped AS (
  UPDATE public.platform_modules m
     SET readiness = 'ready', updated_at = now()
    FROM before b
   WHERE m.key = b.key
  RETURNING m.key
)
INSERT INTO public.platform_module_audit (module_key, environment, action, before_val, after_val, note)
SELECT f.key, NULL, 'readiness', b.before_val, 'ready',
       'Marked ready so the R2 day-one publication is actually served in production (menu visibility spec 2026-11-17)'
  FROM flipped f
  JOIN before b ON b.key = f.key;

-- Product decision 2026-11-17 (spec R1): savings/loyalty/creators are already
-- published on staging/production — flip them to hidden and record why. The
-- guarded WHERE makes a re-run a no-op and keeps the audit row count honest.
WITH before AS (
  SELECT module_key, environment, status AS before_val
    FROM public.platform_module_environments
   WHERE module_key IN ('savings','loyalty','creators')
     AND environment IN ('staging','production')
     AND status <> 'hidden'
   FOR UPDATE
), flipped AS (
  UPDATE public.platform_module_environments e
     SET status = 'hidden', updated_at = now()
    FROM before b
   WHERE e.module_key = b.module_key
     AND e.environment = b.environment
  RETURNING e.module_key, e.environment
)
INSERT INTO public.platform_module_audit (module_key, environment, action, before_val, after_val, note)
SELECT f.module_key, f.environment, 'hide', b.before_val, 'hidden',
       'Default-disabled per mobile menu visibility spec 2026-11-17'
  FROM flipped f
  JOIN before b ON b.module_key = f.module_key AND b.environment = f.environment;
