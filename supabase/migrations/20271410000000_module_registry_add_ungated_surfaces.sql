-- Platform module registry — register the app surfaces an admin cannot currently gate.
--
-- WHY: the registry seeded 36 keys generated from frontend-web/src/lib/feature-flags.ts,
-- but several whole modules in the app were never in that file, so they have no registry
-- row and therefore no admin control at all:
--
--   Marketplace, Crypto, Learn / StudyHub, Film Academy, Contest, Connect, Arena
--
-- Those tiles carry no entry in the mobile mapping tables either, which by design means
-- "not registry-gated — always render". That was the correct call while the registry had
-- no key to point at; it is now the leak. With visibility failing closed on the client,
-- the gap is that these seven are the ones the fail-closed rule cannot reach: publishing
-- or hiding them in the admin portal changes nothing, and an unfinished one sits in the
-- store build regardless of what anyone decides.
--
-- env_flag is deliberately NULL, NOT a guessed FEATURE_* name. There is no such flag for
-- any of these (checked against feature-flags.ts), and Go treats a flag that does not
-- exist as OFF — so recording a plausible-looking name would make each module permanently
-- unpublished, with the console explaining it as "ops flag off". A NULL flag means the
-- registry alone decides, which is what the owner asked for: the admin portal is the
-- authority on public availability for these surfaces.
--
--   visible in production  → readiness 'ready' AND the production row says visible
--   anything else          → not served
--
-- Development is seeded visible to match the 20261210000000 convention: build it, see it
-- locally. STAGING AND PRODUCTION ARE SEEDED HIDDEN, which is a behaviour change for the
-- staging build: those tiles render there today because nothing gates them, and after this
-- migration an operator must publish each one in the admin portal to bring it back. That
-- is the point of the feature — it is the owner's instruction, applied consistently rather
-- than exempting the seven modules that were missed the first time.
--
-- Readiness lands on 'in_development' via the column default in 20271408000100. That is
-- the honest starting state for work that has never had a readiness decision, and it makes
-- the production interlock bite immediately: these rows cannot be published to production
-- until someone marks them ready.

INSERT INTO public.platform_modules (key, name, category, env_flag, description) VALUES
  ('marketplace',    'Marketplace',    'commerce',      NULL, 'Buy/sell listings in the app — mkt_listings surface, separate from the realtor property marketplace'),
  ('crypto',         'Crypto',         'investment',    NULL, 'Crypto holdings, deposits and swaps via the custodial provider'),
  ('academy',        'Learn / StudyHub','education',    NULL, 'Learning paths, lessons and quizzes reached from /learn'),
  ('filmAcademy',    'Film Academy',   'education',     NULL, 'Film Academy — cohorts, tuition instalments, assessments. FEATURE_FILM_ACADEMY_* flags gate individual web capabilities, not this module''s availability'),
  ('competitions',   'Contest',        'voting',        NULL, 'Contest and competition entry surface (/voting). Distinct from voteBridge, which is the wallet-paid vote money rail'),
  ('arena',          'Arena',          'entertainment', NULL, 'Naija Driver challenge / arena — live show participation and predictions'),
  ('connect',        'Connect',        'community',     NULL, 'Connect social discovery module')
ON CONFLICT (key) DO NOTHING;

-- Same three-tier shape as the original seed: development on, everything else off, so
-- registering a module never makes it visible somewhere it was not already reachable.
INSERT INTO public.platform_module_environments (module_key, environment, status)
SELECT m.key, 'development', 'visible'
  FROM public.platform_modules m
 WHERE m.key IN ('marketplace','crypto','academy','filmAcademy','competitions','arena','connect')
ON CONFLICT (module_key, environment) DO NOTHING;

INSERT INTO public.platform_module_environments (module_key, environment, status)
SELECT m.key, e.env, 'hidden'
  FROM public.platform_modules m
  CROSS JOIN (VALUES ('staging'), ('production')) AS e(env)
 WHERE m.key IN ('marketplace','crypto','academy','filmAcademy','competitions','arena','connect')
ON CONFLICT (module_key, environment) DO NOTHING;

COMMENT ON COLUMN public.platform_modules.env_flag IS
  'The ops kill switch consulted for this module, or NULL when there is none. NULL is an explicit statement that the registry alone decides — it does not mean "always off", and it must not be filled with a flag name that config does not define.';
