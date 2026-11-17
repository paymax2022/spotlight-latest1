# Mobile Menu Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every mobile services-grid tile admin-controllable via the existing platform-module registry, with 12 tiles shipping hidden in staging/production.

**Architecture:** One Supabase migration seeds 17 new `platform_modules` rows + per-environment states and flips `savings`/`loyalty`/`creators` to hidden (with audit rows); the mobile app's `serviceModuleKeys.ts` maps all 19 previously-unmapped tile ids onto registry keys and gains an exhaustiveness spec. The Go backend and admin console already implement toggling — zero changes there.

**Tech Stack:** Postgres/Supabase migration (psql-verifiable), React Native + Expo (pure-TS module, node:test unit specs), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-17-mobile-menu-visibility-design.md` (read it first — this plan argues from it)

> **AS EXECUTED — this plan is the pre-#996 draft and four of its literal blocks are
> wrong on purpose-preserved main. Do not copy them.** The spec's two reconciliation
> notes carry the shipped shape: (1) the migration is
> `20271410000100_mobile_menu_modules.sql`, slotted AFTER #996's
> `20271408000100`/`20271410000000` so #996 keeps its `name`/`category` and the
> `readiness` column already exists; (2) it seeds **14** rows, not 17 — no `shopping`,
> `parcel` or `learn` row, because a registry row must be gated by something (spec §1);
> (3) the "exactly these 12 keys end hidden" constraint is **11** keys for the same
> reason (`learn` is gated on `academy`); (4) `SERVICE_MODULE_REGISTRY_KEY` gains **9**
> entries plus one featured entry, not 19, because #996 already shipped eight of them,
> and day-one visibility comes from an audited `UPDATE` + `readiness = 'ready'`, not
> from a seed (spec §1 "State changes", reconciliation note 2).

## Global Constraints

- `env_flag` is NULL on every new registry row (spec §1: a FEATURE_* flag unset on a plane would silently hide the tile).
- Registry keys match the existing CHECK `^[a-zA-Z][a-zA-Z0-9]*$` (camelCase, no dashes/underscores).
- All inserts use `ON CONFLICT (key) DO NOTHING` — never clobber admin edits.
- Exactly these 12 keys end `hidden` in staging AND production: `savings`, `loyalty`, `creators`, `investment`, `learn`, `investAi`, `spotlightWealth`, `fractionalRealEstate`, `aiTrading`, `academy`, `dues`, `admin`.
- These 8 new rows end `visible` in staging AND production: `crypto`, `education`, `arena`, `filmAcademy`, `connect`, `marketplace`, `shopping`, `parcel`. Development is `visible` for every new row and for the 3 flips.
- Audit note text verbatim: `Default-disabled per mobile menu visibility spec 2026-11-17`.
- Contest tile maps to the existing `voteBridge`; Property tile maps to the existing `realtor` — no registry rows for those two tiles.
- No schema DDL beyond seeds; no RLS changes; no Go code changes; no frontend-admin code changes.
- Test runner is run from `/Users/paymax/Documents/spotlight/main/mobile-app/reactnative`: `npm run test:modules` (= `node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test "tests/unit/modules/*.spec.ts"`).
- Repo discipline (hard rules): stage + commit by exact path only — never `git add -A` or `git add .`; push with `git -c credential.helper='!gh auth git-credential' push`; never push or merge to `main` without the user's explicit word; squash is the merge method; `gh pr merge` prints nothing on success (verify with `gh pr view` afterwards); never pass `--delete-branch`.
- All paths below are absolute because the harness cwd resets between Bash calls.

---

### Task 1: Branch + failing registry-coverage spec

**Files:**
- Create: `/Users/paymax/Documents/spotlight/main/mobile-app/reactnative/tests/unit/modules/serviceModuleKeys.spec.ts`
- Commit (already in working tree, uncommitted): `docs/superpowers/specs/2026-11-17-mobile-menu-visibility-design.md`, `docs/superpowers/plans/2026-11-17-mobile-menu-visibility.md`

**Interfaces:**
- Consumes: `SERVICE_MODULES` and `FEATURED_SERVICES` arrays from `src/constants/modules.ts` (shape `{ id, label, route, category, ... }` / `{ id, title, ... }`); `registryKeyFor(id): string | null` and `featuredRegistryKeyFor(id): string | null` from `src/features/modules/serviceModuleKeys.ts`.
- Produces: test file `tests/unit/modules/serviceModuleKeys.spec.ts` executed by `npm run test:modules`; its failure output is the authoritative list of tiles Task 2 must map (19 service ids + 2 featured ids).

- [ ] **Step 1: Create the feature branch**

```bash
git -C /Users/paymax/Documents/spotlight/main checkout -b feat/mobile-menu-visibility
```

Expected: `Switched to a new branch 'feat/mobile-menu-visibility'`. (`main` ref does not move; the dirty shared working tree is carried along — do not stash, reset, or clean anything.)

- [ ] **Step 2: Commit the spec and plan docs**

```bash
git -C /Users/paymax/Documents/spotlight/main add docs/superpowers/specs/2026-11-17-mobile-menu-visibility-design.md docs/superpowers/plans/2026-11-17-mobile-menu-visibility.md
git -C /Users/paymax/Documents/spotlight/main commit -m "$(cat <<'EOF'
docs: spec + plan for admin-controlled mobile menu visibility
EOF
)"
```

- [ ] **Step 3: Write the failing coverage spec**

Create `/Users/paymax/Documents/spotlight/main/mobile-app/reactnative/tests/unit/modules/serviceModuleKeys.spec.ts` with exactly:

```ts
// Every services-grid tile must be registry-gated. Until 2026-11-17 the map was
// deliberately partial and an unmapped tile rendered unconditionally — safe while
// the registry only knew backend modules, but the admin console now owns the whole
// grid, so an unmapped id is a bug: nobody could ever toggle it off.
// Spec: docs/superpowers/specs/2026-11-17-mobile-menu-visibility-design.md (R6).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SERVICE_MODULES, FEATURED_SERVICES } from '@/constants/modules';
import { registryKeyFor, featuredRegistryKeyFor } from '@/features/modules/serviceModuleKeys';

describe('services-grid registry coverage (R6)', () => {
  it('maps every SERVICE_MODULES id to a registry key', () => {
    const unmapped = SERVICE_MODULES.filter((m) => registryKeyFor(m.id) === null);
    assert.deepEqual(
      unmapped.map((m) => `${m.id} (${m.label})`),
      [],
      'tiles with no registry mapping render unconditionally and cannot be toggled from /admin/modules',
    );
  });

  it('maps every FEATURED_SERVICES id to a registry key', () => {
    const unmapped = FEATURED_SERVICES.filter((f) => featuredRegistryKeyFor(f.id) === null);
    assert.deepEqual(
      unmapped.map((f) => `${f.id} (${f.title})`),
      [],
      'featured cards render on home unconditionally when unmapped',
    );
  });
});
```

- [ ] **Step 4: Run it and verify it fails with the expected list**

```bash
cd /Users/paymax/Documents/spotlight/main/mobile-app/reactnative && npm run test:modules 2>&1 | tail -60
```

Expected: FAIL on `maps every SERVICE_MODULES id` with exactly these 19 ids in the diff (`investment (Investment)`, `crypto (Crypto)`, `learn (Learn)`, `invest-ai (Invest AI)`, `spotlight-wealth (Spotlight Wealth)`, `fractionalre (Real Estate Invest)`, `ai-trading (AI Trading)`, `education (Education)`, `shopping (Shopping)`, `parcel (Parcel)`, `marketplace (Marketplace)`, `contest (Contest)`, `naija-driver (Naija Driver)`, `film-academy (Film Academy)`, `academy (StudyHub)`, `property (Property Mgmt)`, `dues (Dues & Rent)`, `connect (Connect)`, `admin (Admin)`), and FAIL on `maps every FEATURED_SERVICES id` with exactly `naija-driver (Nigerian Drivers Challenge)` and `invest (Own the companies shaping your future)`. If the import of `@/constants/modules` itself fails (transitive import from `src/constants/tokens.ts`), report BLOCKED with the error — do not rewrite production code to make the test importable without escalation.

- [ ] **Step 5: Commit the red test**

```bash
git -C /Users/paymax/Documents/spotlight/main add mobile-app/reactnative/tests/unit/modules/serviceModuleKeys.spec.ts
git -C /Users/paymax/Documents/spotlight/main commit -m "$(cat <<'EOF'
test(mobile): fail on any services tile without a registry mapping

R6 of the mobile-menu-visibility spec: the registry owns the whole grid.
EOF
)"
```

---

### Task 2: Wire the 19 tile mappings (+2 featured) until green

**Files:**
- Modify: `/Users/paymax/Documents/spotlight/main/mobile-app/reactnative/src/features/modules/serviceModuleKeys.ts` (header comment lines 1-7; map tail at lines 46-48; collision comment lines 58-65; `FEATURED_REGISTRY_KEY` lines 95-98)
- Test: the Task 1 spec

**Interfaces:**
- Consumes: nothing new — pure data change.
- Produces: `registryKeyFor` now resolves every `SERVICE_MODULES` id; `featuredRegistryKeyFor` resolves every `FEATURED_SERVICES` id. Registry keys introduced here MUST match the migration keys in Task 3 verbatim: `investment`, `learn`, `investAi`, `spotlightWealth`, `fractionalRealEstate`, `aiTrading`, `academy`, `dues`, `admin`, `crypto`, `education`, `arena`, `filmAcademy`, `connect`, `marketplace`, `shopping`, `parcel` (+ existing `voteBridge`, `realtor`, `utilityPayments`, `restaurant`).

- [ ] **Step 1: Replace the header comment**

In `src/features/modules/serviceModuleKeys.ts`, replace lines 1-7 (the comment block beginning `// the camelCase feature-flag names.` and containing `// DELIBERATELY PARTIAL.`) with:

```ts
// Registry keys live in the platform_modules table (Go backend internal/modules);
// this maps services-grid tile ids onto them. EXHAUSTIVE since 2026-11-17: every
// SERVICE_MODULES tile id must appear here — tests/unit/modules/serviceModuleKeys.spec.ts
// fails on any unmapped tile, because an unmapped tile renders unconditionally
// and cannot be toggled from /admin/modules.
// Spec: docs/superpowers/specs/2026-11-17-mobile-menu-visibility-design.md
```

- [ ] **Step 2: Append the 19 entries to `SERVICE_MODULE_REGISTRY_KEY`**

Anchor on the map tail (the `// Support` comment, `support: 'aiCare',` line, and closing `};`) and replace it with:

```ts
  // Support
  support: 'aiCare',

  // Investment & learning families plus the remaining tiles. Registered
  // 2026-11-17 so the whole grid is admin-controllable
  // (spec 2026-11-17-mobile-menu-visibility). Keys must exist in
  // platform_modules — migration 20271410000100 seeds them.
  investment: 'investment',
  crypto: 'crypto',
  learn: 'learn',
  'invest-ai': 'investAi',
  'spotlight-wealth': 'spotlightWealth',
  fractionalre: 'fractionalRealEstate',
  'ai-trading': 'aiTrading',
  education: 'education',
  // Contest rides the existing vote bridge module; Property Mgmt rides realtor,
  // matching the documented "unpublishing realtor hides the pillars" coupling.
  contest: 'voteBridge',
  'naija-driver': 'arena',
  'film-academy': 'filmAcademy',
  academy: 'academy',
  property: 'realtor',
  dues: 'dues',
  connect: 'connect',
  marketplace: 'marketplace',
  shopping: 'shopping',
  parcel: 'parcel',
  admin: 'admin',
};
```

- [ ] **Step 3: Update the id-space collision comment**

Replace the sentence `'marketplace' is a lifestyle shopping tile in SERVICE_MODULES and the property buy/rent marketplace in PROPERTY_SUBMODULES. Sharing one table would gate the shopping tile on the realtor module.` (inside the block comment above `PROPERTY_SUBMODULE_REGISTRY_KEY`) with:

```ts
// A SEPARATE map, not an extension of the one above. The two id-spaces collide:
// 'marketplace' is a lifestyle shopping tile in SERVICE_MODULES (registry key
// 'marketplace') and the property buy/rent pillar in PROPERTY_SUBMODULES
// (registry key 'realtor'). They are separate maps on purpose: hiding the
// shopping tile must not touch the property pillar.
```

- [ ] **Step 4: Extend `FEATURED_REGISTRY_KEY`**

Replace:

```ts
export const FEATURED_REGISTRY_KEY: Record<string, string> = {
  bills: 'utilityPayments',
  'food-ride': 'restaurant',
};
```

with:

```ts
export const FEATURED_REGISTRY_KEY: Record<string, string> = {
  bills: 'utilityPayments',
  'food-ride': 'restaurant',
  'naija-driver': 'arena',
  invest: 'investment',
};
```

- [ ] **Step 5: Run the suite green**

```bash
cd /Users/paymax/Documents/spotlight/main/mobile-app/reactnative && npm run test:modules
```

Expected: PASS, including the pre-existing suites in `tests/unit/modules/` (`visibility.spec.ts`, `coming-soon.spec.ts`, `moduleAvailability.spec.ts`, `aitradingMockPolicy.spec.ts`, `money-routes.spec.ts`). If a pre-existing suite goes red, the change broke it — investigate, do not widen the mapping to force green.

- [ ] **Step 6: Commit**

```bash
git -C /Users/paymax/Documents/spotlight/main add mobile-app/reactnative/src/features/modules/serviceModuleKeys.ts mobile-app/reactnative/tests/unit/modules/serviceModuleKeys.spec.ts
git -C /Users/paymax/Documents/spotlight/main commit -m "$(cat <<'EOF'
feat(mobile): registry-gate every services tile (12 ship hidden)

Maps the 19 unmapped grid ids onto platform_modules keys and locks the
exhaustiveness invariant. Staging/production defaults come from the
registry migration, not this file.
EOF
)"
```

---

### Task 3: Registry migration + local replay verification

**Files:**
- Create: `/Users/paymax/Documents/spotlight/main/supabase/migrations/20271410000100_mobile_menu_modules.sql`

**Interfaces:**
- Consumes: schema from `20261210000000_platform_module_registry.sql` (`platform_modules`, `platform_module_environments(module_key, environment, status, updated_at)`, `platform_module_audit(module_key, environment, action IN ('publish','hide','archive','restore'), before_val, after_val, note, actor_id)`).
- Produces: registry rows the admin console and `GET /api/v1/modules/visibility` read; the key set Task 2's mappings reference; audit rows citing the spec.

- [ ] **Step 1: Write the migration**

Create `/Users/paymax/Documents/spotlight/main/supabase/migrations/20271410000100_mobile_menu_modules.sql` with exactly:

```sql
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
```

- [ ] **Step 2: Simulate the live pre-state on the local DB**

The original seed migration already sets every module hidden on staging/production, so a bare replay would make the flip a no-op and audit nothing. Reproduce the live state verified 2026-11-17: all three published on staging; production rows stay hidden (the original seed's production-opt-in doctrine — if a live admin later published any of them on production, the flip audits those too, which is correct behavior, not a defect). On a truly FRESH replay from zero, `20261216000000_module_registry_seed_reachable.sql` publishes everything on staging+production first, so the flip there audits 6 rows (2 environments × 3 modules) and still converges to the same end state — audit=3 below is specific to this replay's faithful live pre-state.

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "UPDATE public.platform_module_environments SET status='visible' WHERE module_key IN ('savings','loyalty','creators') AND environment='staging';"
```

Expected: `UPDATE 3`.

- [ ] **Step 3: Apply the migration to the local stack**

```bash
cd /Users/paymax/Documents/spotlight/main && npx supabase migration up --include-all
```

Expected: applies `20271410000100_mobile_menu_modules.sql` with no errors. (`--include-all` repairs the local drift documented for this stack; other pending migrations applying here is fine — they are all previously reviewed.)

- [ ] **Step 4: Assert the resulting state**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -t -c "
SELECT 'rows=' || count(*) FROM public.platform_modules WHERE key IN ('investment','learn','investAi','spotlightWealth','fractionalRealEstate','aiTrading','academy','dues','admin','crypto','education','arena','filmAcademy','connect','marketplace','shopping','parcel');
SELECT 'hidden=' || string_agg(module_key, ',' ORDER BY module_key) FROM public.platform_module_environments WHERE environment='staging' AND status='hidden' AND module_key IN ('savings','loyalty','creators','investment','learn','investAi','spotlightWealth','fractionalRealEstate','aiTrading','academy','dues','admin','crypto','education','arena','filmAcademy','connect','marketplace','shopping','parcel');
SELECT 'visible=' || string_agg(module_key, ',' ORDER BY module_key) FROM public.platform_module_environments WHERE environment='staging' AND status='visible' AND module_key IN ('savings','loyalty','creators','investment','learn','investAi','spotlightWealth','fractionalRealEstate','aiTrading','academy','dues','admin','crypto','education','arena','filmAcademy','connect','marketplace','shopping','parcel');
SELECT 'audit=' || count(*) FROM public.platform_module_audit WHERE note = 'Default-disabled per mobile menu visibility spec 2026-11-17';
SELECT 'dev_visible=' || count(*) FROM public.platform_module_environments WHERE environment='development' AND status='visible' AND module_key IN ('investment','learn','investAi','spotlightWealth','fractionalRealEstate','aiTrading','academy','dues','admin','savings','loyalty','creators');
"
```

Expected, exactly:
- `rows=17`
- `hidden=academy,admin,aiTrading,creators,dues,fractionalRealEstate,investAi,investment,learn,loyalty,savings,spotlightWealth`
- `visible=arena,connect,crypto,education,filmAcademy,marketplace,parcel,shopping`
- `audit=3`
- `dev_visible=12`

Also verify idempotence (re-run is a no-op):

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f /Users/paymax/Documents/spotlight/main/supabase/migrations/20271410000100_mobile_menu_modules.sql
```

then re-run the assertion query — `audit=` must still be `3` (the guarded WHERE skipped already-hidden rows).

- [ ] **Step 5: Contingency — if the CI migration guard rejects the UPDATE**

The additive-only guard has only ever seen INSERT/DDL. If (and only if) CI rejects DML `UPDATE` in a migration, STOP before changing the approach yourself: report BLOCKED with the guard's message. The fallback (controller decision, already sanctioned by the spec's R1) is to split the flip into a post-deploy admin operation: after the migration (rows + INSERTs only) is applied to staging, an admin with `platform.modules.manage` sets `savings`/`loyalty`/`creators` to hidden in staging and production via `/admin/modules` (which writes the audit rows natively). Do not implement the fallback without the controller's ruling.

- [ ] **Step 6: Commit**

```bash
git -C /Users/paymax/Documents/spotlight/main add supabase/migrations/20271410000100_mobile_menu_modules.sql
git -C /Users/paymax/Documents/spotlight/main commit -m "$(cat <<'EOF'
feat(db): register all services tiles in the module registry

Seeds 17 platform_modules rows with per-environment states and flips
savings/loyalty/creators to hidden on staging+production with audit rows.
Spec: docs/superpowers/specs/2026-11-17-mobile-menu-visibility-design.md
EOF
)"
```

---

### Task 4: Staging-matrix regression test + live Go probe

**Files:**
- Create: `/Users/paymax/Documents/spotlight/main/mobile-app/reactnative/tests/unit/modules/menuVisibilityMatrix.spec.ts`

**Interfaces:**
- Consumes: `moduleStateFor(list, key)` from `src/features/modules/rules.ts` (returns `'visible' | 'comingSoon' | 'hidden'`; `null` list → `'visible'`), `registryKeyFor` from Task 2, `SERVICE_MODULES` from `src/constants/modules.ts`.
- Produces: a permanent regression lock on the 2026-11-17 staging decision — red if the migration or a mapping drifts.

- [ ] **Step 1: Write the matrix test**

Create `/Users/paymax/Documents/spotlight/main/mobile-app/reactnative/tests/unit/modules/menuVisibilityMatrix.spec.ts` with exactly:

```ts
// The 2026-11-17 menu-visibility decision, encoded as the registry response the
// staging plane must produce for the 20 keys this feature touched. Deliberately
// synthetic: it asserts THIS feature's keys only, so future admin toggles of
// unrelated modules cannot break it. If it goes red, either migration
// 20271410000100 drifted or a serviceModuleKeys mapping changed.
// Spec: docs/superpowers/specs/2026-11-17-mobile-menu-visibility-design.md.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SERVICE_MODULES } from '@/constants/modules';
import { moduleStateFor, type ModuleVisibility } from '@/features/modules/rules';
import { registryKeyFor } from '@/features/modules/serviceModuleKeys';

const HIDDEN_IN_STAGING = [
  'savings', 'loyalty', 'creators',
  'investment', 'learn', 'invest-ai', 'spotlight-wealth',
  'fractionalre', 'ai-trading', 'academy', 'dues', 'admin',
] as const;

const VISIBLE_IN_STAGING = [
  'crypto', 'education', 'naija-driver', 'film-academy',
  'connect', 'marketplace', 'shopping', 'parcel',
  'contest', 'property',
] as const;

const STAGING: ModuleVisibility = {
  environment: 'staging',
  modules: [
    'crypto', 'education', 'arena', 'filmAcademy', 'connect',
    'marketplace', 'shopping', 'parcel', 'voteBridge', 'realtor',
  ],
  comingSoon: [],
};

describe('staging menu-visibility matrix (2026-11-17 decision)', () => {
  const tiles = Object.fromEntries(SERVICE_MODULES.map((m) => [m.id, m]));

  for (const id of HIDDEN_IN_STAGING) {
    it(`hides ${id}`, () => {
      assert.ok(tiles[id], `${id} must be a real service tile`);
      const key = registryKeyFor(id);
      assert.ok(key, `${id} must be registry-gated`);
      assert.equal(moduleStateFor(STAGING, key), 'hidden');
    });
  }

  for (const id of VISIBLE_IN_STAGING) {
    it(`keeps ${id} visible`, () => {
      assert.ok(tiles[id], `${id} must be a real service tile`);
      const key = registryKeyFor(id);
      assert.ok(key, `${id} must be registry-gated`);
      assert.equal(moduleStateFor(STAGING, key), 'visible');
    });
  }
});
```

- [ ] **Step 2: Run the suite green**

```bash
cd /Users/paymax/Documents/spotlight/main/mobile-app/reactnative && npm run test:modules
```

Expected: PASS — 22 new assertions plus everything from Task 2.

- [ ] **Step 3: Probe the live local Go API**

The Go module endpoints are unchanged by this feature — the probe proves the backend serves the seeded rows from the DB it is wired to.

```bash
curl -sf --max-time 10 "http://localhost:8080/api/v1/modules/visibility" || echo "GO-API-DOWN"
```

- If it returns JSON: `environment` must be `development` and `data.modules` (or top-level `modules`, per the response envelope) must contain all 17 new keys plus `savings`, `loyalty`, `creators`. Record the output.
- If `GO-API-DOWN`: start the local stack before retrying — `docker ps | grep new-api` (compose project `new`); if the container exists but is stopped, `docker start new-api-1`, then poll `curl -sf http://localhost:8080/healthz` up to ~40 s. If there is no local Go API at all, start one per the repo's runbook (build from `backend/` with the local Supabase env) — do NOT modify any env files. If the stack cannot come up within ~10 minutes, record the miss and rely on Steps 1-2 plus the Task 3 SQL assertions as the verification evidence; say so plainly in the report rather than claiming the probe ran.

- [ ] **Step 4: RN-web render spot check (budgeted, with fallback)**

This proves the render chain (fetch → `useUserModuleState` → grid filter) end to end. Budget ~10 minutes.

1. Mutate the local dev registry so the gate has something to hide:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "UPDATE public.platform_module_environments SET status='hidden' WHERE module_key IN ('savings','investment') AND environment='development';"
```

2. Serve the app in a browser: from `/Users/paymax/Documents/spotlight/main/mobile-app/reactnative` run `npx expo start --web` (background, port 8081), navigate to `http://localhost:8081`, open the **All Services** tab, and confirm the **Savings** and **Investment** tiles are absent while, e.g., **Crypto** and **Wallet** remain.
3. Revert the mutation and re-confirm the tiles return after a reload:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "UPDATE public.platform_module_environments SET status='visible' WHERE module_key IN ('savings','investment') AND environment='development';"
```

Fallback: if Expo web cannot serve within the budget (Metro port conflicts, dependency resolution), STOP the attempt — do not debug Expo beyond the budget. The verification evidence then = Steps 1-2 (matrix test) + Step 3 (Go probe) + the Task 3 assertions, and the report must state the render chain was not browser-verified (the same gate already hides 25+ registry-hidden tiles in production, so the path is live-proven).

- [ ] **Step 5: Commit**

```bash
git -C /Users/paymax/Documents/spotlight/main add mobile-app/reactnative/tests/unit/modules/menuVisibilityMatrix.spec.ts
git -C /Users/paymax/Documents/spotlight/main commit -m "$(cat <<'EOF'
test(mobile): lock the staging menu-visibility matrix

Red if migration 20271410000100 or a tile mapping drifts from the
2026-11-17 default-disabled decision.
EOF
)"
```

---

### Task 5: Push + PR (merge is the user's word)

**Files:** none created; pushes the branch.

**Interfaces:**
- Consumes: commits from Tasks 1-4 on `feat/mobile-menu-visibility`.
- Produces: an open PR whose body carries the rollout facts the operator needs.

- [ ] **Step 1: Verify the branch state before pushing**

```bash
git -C /Users/paymax/Documents/spotlight/main log --oneline main..feat/mobile-menu-visibility
git -C /Users/paymax/Documents/spotlight/main status --porcelain | grep -E 'serviceModuleKeys|menuVisibilityMatrix|serviceModuleKeys.spec|20271410000100' || echo "WORKTREE-CLEAN-FOR-THIS-FEATURE"
```

Expected: 4-5 commits (docs, red test, mappings, migration, matrix test) and no unstaged leftovers from this feature's files.

- [ ] **Step 2: Push and open the PR**

```bash
git -C /Users/paymax/Documents/spotlight/main -c credential.helper='!gh auth git-credential' push -u origin feat/mobile-menu-visibility
cd /Users/paymax/Documents/spotlight/main && gh pr create --title "feat(mobile): admin-controlled menu visibility — 12 tiles ship hidden" --body "$(cat <<'EOF'
## Summary
- Registers all 17 previously-ungated services tiles in `platform_modules` (migration `20271410000100`) so `/admin/modules` can toggle any tile per environment (visible / coming soon / hidden) with audit.
- Flips `savings`, `loyalty`, `creators` to hidden on staging+production (audit rows cite the spec); 9 new tiles seed hidden there; 8 seed visible (current UX unchanged); development stays fully visible.
- Mobile: maps all 19 unmapped tile ids onto registry keys, gates the featured `invest`/`naija-driver` cards, and adds two regression specs (exhaustiveness + staging matrix).
- Zero Go and zero admin-console changes — both planes already implement the toggle UI/API.

## Rollout facts
- Merging fires the db-migrate lane: staging applies automatically; the production DB push lands as **pending approval** — an eligible user must approve it in CI.
- Staging flip is server-side instant for already-shipped APKs: Savings/Rewards/Creators disappear on them at merge; the other 9 keep rendering until the next APK build ships the new mappings (no server can hide a tile shipped code doesn't gate).
- Re-enabling any tile afterwards = `/admin/modules` in the admin console; no redeploy needed.

## Test plan
- [x] `npm run test:modules` green (exhaustiveness + staging matrix + pre-existing suites)
- [x] Migration replayed locally; status matrix + 3 audit rows asserted via psql (incl. simulated live pre-state)
- [x] Local Go `GET /api/v1/modules/visibility` serves the seeded rows
- [ ] Post-merge: staging visibility read shows the 12 hidden / 8 visible sets
EOF
)"
```

- [ ] **Step 3: Verify the PR exists and STOP — do not merge**

```bash
gh pr view --repo $(git -C /Users/paymax/Documents/spotlight/main remote get-url origin | sed -E 's#.*github.com[:/](.+/.+)\.git#\1#') feat/mobile-menu-visibility --json number,url,state --jq '"\(.number) \(.state) \(.url)"'
```

Expected: an OPEN PR number. The user's word is required before any merge (squash, no `--delete-branch`); report the URL and stop.

---

## Self-Review Notes

- Spec coverage: R1 (Task 3 flips + hidden seeds), R2 (Task 3 visible seeds + Task 2 mappings), R3 (zero-change admin page — no task needed, verified by design), R4 (Task 3 dev-visible assertion), R5 (Task 2 `invest` mapping + Task 4 matrix), R6 (Tasks 1-2), R7 (no new endpoints/tables/pages anywhere in the plan).
- Placeholder scan: none — every step carries literal code/SQL/commands.
- Type consistency: mapping keys in Task 2 match migration keys in Task 3 verbatim; matrix test keys match both; audit note string identical in Task 3 SQL and Global Constraints.
