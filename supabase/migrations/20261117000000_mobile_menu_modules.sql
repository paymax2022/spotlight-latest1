-- Mobile menu visibility (spec: docs/superpowers/specs/2026-11-17-mobile-menu-visibility-design.md)
-- Registers every services-grid tile in the platform module registry so
-- /admin/modules can toggle any tile per environment. Product decision
-- 2026-11-17: the tiles flipped/seeded HIDDEN below ship disabled in staging +
-- production; every other new row is visible there (current UX unchanged).
-- Development keeps everything visible. env_flag stays NULL on every new row:
-- coupling a menu tile to a FEATURE_* flag that may be unset on a plane would
-- silently hide it; the ops-flag lane can add flags later.

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

-- Contest and Property Mgmt tiles map onto the existing voteBridge and realtor
-- modules in the app — no rows here, by design.

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
