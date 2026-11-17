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
  ('learn',                'Learn',              'education',  NULL, 'Learn tile (/learn)'),
  ('investAi',             'Invest AI',          'investment', NULL, 'Invest AI tile (/invest-ai)'),
  ('spotlightWealth',      'Spotlight Wealth',   'investment', NULL, 'Spotlight Wealth tile (/spotlight-wealth)'),
  ('fractionalRealEstate', 'Real Estate Invest', 'investment', NULL, 'Real estate investment tile (/fractionalre)'),
  ('aiTrading',            'AI Trading',         'investment', NULL, 'AI Trading — custodial, eligibility-gated managed fund tile (/ai-trading)'),
  ('academy',              'StudyHub',           'education',  NULL, 'StudyHub learning tile (/learn/academy)'),
  ('dues',                 'Dues & Rent',        'property',   NULL, 'Dues & Rent tile (/dues)'),
  ('admin',                'Admin',              'ops',        NULL, 'In-app admin console tile (/admin)'),
  ('crypto',               'Crypto',             'investment', NULL, 'Crypto trading wallet tile (/crypto)'),
  ('education',            'Education',          'utility',    NULL, 'Education payments tile (/services/education)'),
  ('arena',                'Naija Driver',       'contest',    NULL, 'Arena competition engine tile (/arena)'),
  ('filmAcademy',          'Film Academy',       'education',  NULL, 'Film Academy native tile (/film-academy)'),
  ('connect',              'Connect',            'community',  NULL, 'Connect tile (/connect)'),
  ('marketplace',          'Marketplace',        'commerce',   NULL, 'Lifestyle marketplace shopping tile (/marketplace)'),
  ('shopping',             'Shopping',           'commerce',   NULL, 'Shopping tile (renders inert via its static coming-soon flag)'),
  ('parcel',               'Parcel',             'commerce',   NULL, 'Parcel tile (renders inert via its static coming-soon flag)')
ON CONFLICT (key) DO NOTHING;

-- The Contest tile maps onto #996's existing `competitions` module and Property Mgmt
-- onto `realtor` — no rows for those two here, by design. `competitions` is the one
-- key #996 registered that this migration republishes; see the R2 note below.

-- Environment states: everything visible in development; the preserve-list is
-- visible everywhere (current UX); the rest of the new rows hidden on
-- staging/production (registry doctrine: production is opt-in).
INSERT INTO public.platform_module_environments (module_key, environment, status)
SELECT m.key, e.env,
       CASE WHEN e.env = 'development'
              OR m.key IN ('crypto','education','arena','filmAcademy','connect','marketplace','shopping','parcel')
            THEN 'visible' ELSE 'hidden' END
  FROM public.platform_modules m
  CROSS JOIN (VALUES ('development'),('staging'),('production')) AS e(env)
  WHERE m.key IN ('investment','learn','investAi','spotlightWealth','fractionalRealEstate',
                  'aiTrading','academy','dues','admin','crypto','education','arena',
                  'filmAcademy','connect','marketplace','shopping','parcel')
ON CONFLICT (module_key, environment) DO NOTHING;

-- Spec R2, as an UPDATE rather than as a seed.
--
-- The INSERT above cannot carry R2 on its own: ON CONFLICT DO NOTHING never
-- overwrites a row that already exists, and on every plane that has already run
-- #996 those rows DO exist — 20271410000000 seeds marketplace/crypto/academy/
-- filmAcademy/competitions/arena/connect as hidden in staging AND production.
-- Measured live on 2026-11-17 against both backends: GET /api/v1/modules/visibility
-- reported none of crypto, education, arena, filmAcademy, connect, marketplace,
-- competitions as visible on staging or production. Before this PR those tiles
-- render unconditionally because serviceModuleKeys did not name them, so shipping
-- the mappings WITHOUT this UPDATE would drop seven live tiles on the next registry
-- fetch (≤ 60 s) — the opposite of "nothing changes on day one".
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
                          'marketplace','competitions','shopping','parcel')
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
-- about publication history, not about code quality: these tiles ship in the app
-- today. Staging ignores readiness, so only production-visible keys are touched, and
-- the audit row is module-scoped (environment NULL) the way SetReadiness writes it.
WITH before AS (
  SELECT m.key, m.readiness AS before_val
    FROM public.platform_modules m
    JOIN public.platform_module_environments e
      ON e.module_key = m.key AND e.environment = 'production' AND e.status = 'visible'
   WHERE m.key IN ('crypto','education','arena','filmAcademy','connect',
                   'marketplace','competitions','shopping','parcel')
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
       'Marked ready to match the production publication it already had (menu visibility spec 2026-11-17)'
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
