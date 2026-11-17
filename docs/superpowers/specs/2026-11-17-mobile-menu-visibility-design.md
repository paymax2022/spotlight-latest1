# Mobile Menu Visibility — Admin-Controlled Service Grid

- **Date:** 2026-11-17
- **Status:** Approved (design approved in session; user pre-approved proceeding to implementation plan)
- **Surfaces:** `supabase/migrations` (one migration), `mobile-app/reactnative` (one module + spec), `frontend-admin` (zero changes), `frontend-web` (zero changes — see the web bullet under "Existing architecture"), Go backend (zero changes)

## Problem

The production APK still shows 12 menu tiles that product wants off:

Savings, Rewards (Loyalty), Investment, Learn, Invest AI, Spotlight Wealth, Real Estate Invest, AI Trading, Creators, StudyHub (Academy), Dues & Rent, Admin.

Measured 2026-11-17 against `origin/main`'s `SERVICE_MODULE_REGISTRY_KEY` and against both live backends (`GET /api/v1/modules/visibility`), the 12 fall into three groups, not two:

- **3 are wired and served today** — `savings`, `loyalty`, `creators` map to their own keys and
  those keys answer on **staging and production both**, so they really are visible and the
  deliberate `UPDATE` to `hidden` is what turns them off. (The draft said "staging only";
  production serves them too, and production is where `ADR-PR1026` points a store build — its
  §"Context" reads production answering 31 modules from 36 published-and-ready rows, which is
  what the live call returned here. That ADR also records why the plane question is not
  guesswork: `build-aab.sh`/`build-apk.sh` use local Gradle, Expo picks its env from
  `NODE_ENV`, and the gitignored `.env.production` used to hold the *staging* URL, so admin
  publication on production governed nothing on the device until eas.json became the single
  source of truth. Either way, both planes must carry the hide.)
- **2 are wired and already hidden** — the Learn and StudyHub tiles map to #996's single
  `academy` key (`learn → academy`, `academy → academy`, both from `3654f6b3f`, landed
  2026-11-12), and `academy` is absent from staging *and* production payloads today. So any
  build that contains those mappings already hides both tiles. Which side of that line the
  installed store artifact is on cannot be measured from the repo: the ADR above establishes
  the artifact is cut by local Gradle against a gitignored `.env.production`, and nothing
  tracked records its build date. For R1 the ambiguity is harmless — hidden is the requested
  end state either way, and this PR adds no `academy` row and publishes nothing that would
  bring these two back. What it does mean is that the same uncertainty applies to the six
  preserve keys in R2, where hidden is *not* wanted: if the store build carries #996's
  mappings, those six tiles are already gone for real users and the day-one `UPDATE` restores
  them rather than merely preventing a future drop. Consequence worth keeping in view: Learn
  and StudyHub are one switch, and publishing `academy` brings both back.
- **7 are neither mapped nor registered** — Investment, Invest AI, Spotlight Wealth, Real
  Estate Invest, AI Trading, Dues & Rent, Admin. No `SERVICE_MODULE_REGISTRY_KEY` entry and no
  `platform_modules` row, so the shipped app renders them unconditionally and the admin portal
  cannot see them at all. This migration creates their rows hidden and this PR adds the
  mappings.

Additionally, the admin portal must be able to enable/disable any mobile menu item per environment — including a greyed "coming soon" teaser state — without a code change.

## Existing architecture this rides (no new plane)

- **Tables:** `platform_modules` (key PK, name, category, env_flag, description, lifecycle, access_level), `platform_module_environments` (module_key + environment, status ∈ `hidden|visible|coming_soon`), `platform_module_audit` (append-only). Introduced by `20261210000000_platform_module_registry.sql`; RLS deny-all by design (`20261215000100_module_registry_rls.sql`) — backend-only via pgx.
- **Go service:** `backend/internal/modules/service.go` — `List`, `VisibleKeys`, `ComingSoonKeys`, `SetVisibility` (env row upsert + audit row in one tx). `VisibleIn` is fail-closed on every axis (archived, env flag off, environment never decided, status ≠ visible).
- **Endpoints:** public `GET /api/v1/modules/visibility` → `{environment, modules[], comingSoon[]}`; admin `GET/PATCH /api/v1/admin/modules…` behind `mapsAuth + requireUserID + RequirePermission('platform.modules.read'/'platform.modules.manage')`.
- **Admin console:** `frontend-admin/app/admin/modules/page.tsx` ("App Modules", `/admin/modules`, sidebar "Platform" section) lists every registry row grouped by category and toggles status per environment with a confirmation dialog and audit note. New registry rows appear there automatically.
- **Mobile:** static `SERVICE_MODULES` in `mobile-app/reactnative/src/constants/modules.ts`; gate = `useUserModuleState()` (`src/features/modules/visibility.ts`) fed by `GET /api/v1/modules/visibility` (react-query, 60 s staleTime); id→registry-key translation in `src/features/modules/serviceModuleKeys.ts` (deliberately partial — unmapped ids always render); tri-state rules in `src/features/modules/rules.ts` (`moduleStateFor`: key in `modules[]` → visible; in `comingSoon[]` → rendered inert; else hidden). A missing answer is **not** "show everything": with neither a live response nor a cache, `rules.ts:95` keeps only the five `STABLE_MODULE_KEYS` and hides every other tile. Gated surfaces today: services grid (`app/(tabs)/services.tsx`) and home Explore card (`app/(tabs)/home.tsx`).
- **Web — reads the same registry, gates nothing yet.** #996 also shipped a web consumer of this endpoint: the BFF proxy `frontend-web/app/api/v1/modules/visibility/route.ts` and the server-side gate `frontend-web/src/server/modules/visibility.ts`, whose `isModuleVisible(key)` = ops `FEATURE_*` flag **AND** registry publication. Neither the migration nor this PR touches either file, and `isModuleVisible` has **zero callers** (measured 2026-11-17 by grepping `frontend-web/src`, `app`, `components` for `isModuleVisible|publishedModules` — only the definitions themselves answer; `frontend-web/config/production-module-flags.env:23` records the same fact). So no web surface changes on any environment flip in this migration: the web's live gates are the accessor `process.env` reads, which the registry does not touch. Two things to carry forward: the day someone wires `isModuleVisible` into a route, every key flipped here becomes a web decision too; and that gate fails **open** (`publishedModules()` returns `null` → `visibility.ts:64` answers `true`), the opposite polarity from the mobile grid's allowlist, so the two clients can disagree on a plane whose endpoint is broken. Related and worth knowing: #996's own `frontend-web/tests/unit/api/module-visibility-route.spec.ts` header states that the mobile clients "fail OPEN — every module renders" on a 404, which `rules.ts` contradicts. That comment is on `main` and outside this PR's scope, so it is recorded here rather than edited; fixing the misnomer repo-wide is a separate pass.

## Requirements

- **R1 — Default-off list.** These 12 tiles ship hidden in staging and production; development keeps them visible: Savings (`savings`), Rewards (`loyalty`), Investment (`investment`), Learn (`learn`), Invest AI (`invest-ai`), Spotlight Wealth (`spotlight-wealth`), Real Estate Invest (`fractionalre`), AI Trading (`ai-trading`), Creators (`creators`), StudyHub (`academy`), Dues & Rent (`dues`), Admin (`admin`). Measured against `main`'s map and both live payloads, that is three different jobs, not one: `savings` / `loyalty` / `creators` have rows and are **served on staging and production both**, so they flip via an audited `UPDATE`; the Learn and StudyHub tiles ride #996's existing `academy` key, which is hidden on both planes already, so they need no row and no flip (and stay one switch); the remaining **seven** (Investment, Invest AI, Spotlight Wealth, Real Estate Invest, AI Trading, Dues & Rent, Admin) have neither row nor mapping and are created hidden here.
- **R2 — Whole-grid control.** Every `SERVICE_MODULES` tile id maps to a registry key. Tiles beyond R1 keep their visibility: for the new rows that is a seed, and for keys #996 already parked as hidden it is an audited `UPDATE` to `visible` (plus `readiness = 'ready'` on production), because a seed cannot move an existing row — see reconciliation note 2. "Nothing changes for users on day one" is the goal and is true of the installed builds product is complaining about; for the six preserve keys that `main` already maps, the `UPDATE` is what keeps the next build from hiding tiles that today's payloads already leave unserved.
- **R3 — Admin toggles.** Per-environment visible / coming soon / hidden from the existing `/admin/modules` page, with audit — no new admin UI.
- **R4 — Dev stays open.** Development environment shows everything.
- **R5 — Featured card obeys.** The home featured card `invest` ("Own the companies shaping your future", route `/investment`) is registry-gated to `investment`.
- **R6 — No unmapped tiles, ever.** A mobile spec asserts every `SERVICE_MODULES` id is either mapped to a real registry key or listed in the two-item no-registry-row exemption (`shopping`, `parcel`; see the reconciliation note above). **Enforcement today is `npm run test:modules`, not CI** — no workflow executes any mobile `.spec.ts`, because the suite needs `--experimental-strip-types` (node ≥ 22.6) and the only mobile job pins node 20 through `_reusable-node-typecheck.yml`'s default. Wiring it is a CI-minute decision; the ready patch is written out in `/private/tmp/spot-menuvis-spike/proposed-ci-mobile-specs.md` (spike scratch, deliberately not committed).
- **R7 — No new endpoints, tables, or pages.** Reuse only.

### Reconciliation note — written when this rebased onto #996

R2 and R6 as first written ("every `SERVICE_MODULES` id maps to a registry key, CI
fails otherwise") do not survive contact with `#996`'s three-state model. Measured,
not theorised: mapping `shopping` makes main's own
`visibility.spec.ts::unmapped tiles are never registry-gated` red — its comment says
*"'shopping' is a coming-soon placeholder with no engine and no registry row"* — and
its `a category group that gates to empty is dropped entirely` case then loses the
whole "Learn" group. So the shipped rule is narrower and explicit:

> **Every tile that has a `platform_modules` row must be registry-gated. Tiles with
> no row (`shopping`, `parcel`) must stay unmapped, and a test pins both halves.**

"Coming soon" is *not* the discriminating property, which is worth stating because it
is the tempting generalisation: `support` carries `comingSoon: true` in
`constants/modules.ts` and is legitimately gated on `aiCare`, a real registered
module. Having a registry row is what makes gating safe; a badge flag does not make
gating unsafe. The exemption list is therefore a two-item set in
`serviceModuleKeys.spec.ts`, not a rule over `comingSoon`.

Two further deltas from the original plan, both forced by main rather than chosen:
`contest` rides `competitions` (#996's key) instead of `voteBridge`, and
`learn` rides `academy` instead of a new `learn` row, because #996 registered both
in `20271410000000` and main's route/label/deep-link assertions are written against
those keys. `20271410000100` still seeds its own rows with `ON CONFLICT (key) DO
NOTHING`, so on a database that already ran `20271410000000` the existing attributes
win and the seed is a no-op for the six overlapping keys (`academy`, `arena`, `connect`,
`crypto`, `filmAcademy`, `marketplace`; `competitions` is #996-only and this file adds
eight keys of its own). Verified empirically, not
argued: replaying the registry chain into an empty database with and without this file
shows `academy` keeping #996's `Learn / StudyHub` / `education` and `arena` keeping
`Arena` / `entertainment`.

### Reconciliation note 2 — written against the live planes

Seeding the desired state is not enough, and the first push of this feature proved it.
`INSERT … ON CONFLICT DO NOTHING` cannot express R2 on a database that has already run
#996, because #996's `20271410000000` already seeded `marketplace`, `crypto`, `academy`,
`filmAcademy`, `competitions`, `arena` and `connect` as **hidden in staging and
production**. Measured 2026-11-17 against both live backends —
`GET /api/v1/modules/visibility` reports none of `crypto`, `education`, `arena`,
`filmAcademy`, `connect`, `marketplace` or `competitions` on staging or production.
That measured list is R2's preserve list, not #996's seven seeded-hidden keys: `academy` —
which gates the Learn and StudyHub tiles — is deliberately **not** published, because R1 wants
those tiles off, and `education` is a row this file creates rather than one #996 parked.
Six of those seven are **already mapped on `main`** (`crypto`, `arena`, `filmAcademy`,
`connect`, `marketplace`, `competitions` — measured 2026-11-17 by reading
`SERVICE_MODULE_REGISTRY_KEY` out of `git show origin/main:…/serviceModuleKeys.ts`; only
`education` is new here). So a build containing those mappings already hides all six: mapped +
unserved = `hidden` under `rules.ts`, and the live payloads confirm the keys are served on
neither plane. Whether the *installed* store artifact is one of those builds cannot be measured
from the repo — `ADR-PR1026` documents that the artifact is cut by local Gradle against a
gitignored `.env.production`, and no tracked file records its build date — so both branches have
to be stated: if the artifact predates #996's mappings, the flip prevents a drop at the next
registry read (≤ 60 s); if it postdates them, six tiles are already gone for real users and the
flip is a restore. Either way the mappings that hid them arrived with #996, not with this PR, and
shipping without the flip keeps them hidden. `marketplace` → `marketplace`, `crypto` → `crypto`
etc. therefore stay
visible on staging and production by this migration's audited `UPDATE`, and the ≤ 60 s fetch
window is what makes the difference land on the next registry read rather than the next release.

So R2 is carried by an explicit audited `UPDATE` to `visible` (staging + production) for
the preserve list, not by a seed. Two consequences worth writing down:

- **Production also checks readiness.** `Module.VisibleIn`
  (`backend/internal/modules/model.go`) refuses to *serve* a production module whose
  `readiness` is not `ready`, independent of its environment row. Flipping the row alone
  leaves the payload unchanged, so the migration sets `readiness = 'ready'` for the
  production-visible preserve keys too, with a module-scoped audit row — the same
  statement about publication history (not code quality) that
  `20271408000100`'s own backfill makes. Staging ignores readiness, which is why the
  environment rows for it are half the job on their own.
- **`competitions` is the one deliberate override.** #996 parked it hidden "until someone
  marks them ready" — and #996 also shipped the `contest → competitions` mapping itself, so the
  Contest tile is already gated on it in any build from `main`. Keeping R2 means publishing the
  key here, against that "until someone marks them ready" stance. Accepted because users
  already see the tile in installed builds and an admin can hide it again from
  `/admin/modules` without a deploy.

This is also why the file moved to `20271410000100`: `readiness` does not exist until
`20271408000100`, so a migration that sets it cannot sort before it. That closes the
version-slot question left open in the note above.

Both database shapes were replayed on a real Postgres rather than reasoned about, and the
empty-plane run re-measured at this branch's head after the `shopping`/`parcel`/`learn` rows
were dropped: with the file, development serves exactly **15** keys and staging + production
each serve exactly the **seven** preserve keys with #996's attributes winning on the shared
rows; without it, staging and production serve nothing at all. Those are `env_flag`-NULL
counts from the replay's predicate, not live payload sizes — see §5. The `#996`-landed run reaches
the same end state but its attribute-precedence half is evidence about that particular
developer database, not about `main` — see §5 for why. Second run of the migration inside the
same transaction writes no new audit rows.
Scripts: `/private/tmp/spot-menuvis-spike/pushed-plane-replay.sql`,
`fresh-plane-replay.sh`.

## Design

### 1. Registry migration (one file, additive + deliberate DML)

New `platform_modules` rows (env_flag deliberately **NULL on every new row** — coupling a menu tile to a `FEATURE_*` flag that may be unset on a plane would silently hide it; the ops-flag lane remains available later). Keys satisfy the existing `^[a-zA-Z][a-zA-Z0-9]*$` CHECK. The `marketplace` row backs the lifestyle shopping tile (`/marketplace`), whose id collides with the property pillar id in `PROPERTY_SUBMODULE_REGISTRY_KEY` by deliberate design — the two maps stay separate:

| key | name | category | default status (staging/prod) |
|---|---|---|---|
| `investment` | Investment | investment | hidden |
| `investAi` | Invest AI | investment | hidden |
| `spotlightWealth` | Spotlight Wealth | investment | hidden |
| `fractionalRealEstate` | Real Estate Invest | investment | hidden |
| `aiTrading` | AI Trading | investment | hidden |
| `academy` | StudyHub — #996's `Learn / StudyHub` wins on any plane that ran it | education | hidden |
| `dues` | Dues & Rent | property | hidden |
| `admin` | Admin | ops | hidden |
| `crypto` | Crypto | investment | visible |
| `education` | Education | utility | visible |
| `arena` | Naija Driver — #996's `Arena` / `entertainment` wins on any plane that ran it | contest | visible |
| `filmAcademy` | Film Academy | education | visible |
| `connect` | Connect | community | visible |
| `marketplace` | Marketplace | commerce | visible |

Seventeen rows became fourteen when this rebased onto #996. The draft also listed
`shopping` (Shopping, commerce, visible), `parcel` (Parcel, commerce, visible) and
`learn` (Learn, education, hidden) so that the admin would own all 22 tiles. All three
are gone, for one rule worth keeping written down: **a registry row is only honest if
something gates on it.**

`shopping` and `parcel` cannot be gated. `visibility.spec.ts` asserts
`registryKeyFor('shopping') === null` and calls it "a coming-soon placeholder with no
engine and no registry row", and gating either tile empties its category group in that
file's `a category group that gates to empty is dropped entirely` case. They stay
unmapped — and an unmapped tile never consults the registry, so a row for them would be
a control that lies: `/admin/modules` would list Shopping and Parcel, accept toggles and
write audit rows while the shipped app ignored every one of them. They are the only two
tiles on the grid that are **not** admin-togglable, and they become togglable in the
change that gives them engines and maps them; `NO_REGISTRY_ROW` in
`serviceModuleKeys.spec.ts` keeps that claim checked rather than merely asserted (see
**Out of scope**).

`learn` was a different mistake: the Learn tile *is* gated, but on #996's `academy` key,
which is what main's own assertions encode — `routeModuleKeys.ts` maps the `/learn`
route to `academy` and `visibility.spec.ts` asserts `['learn', 'academy']`. A `learn`
row would have gated nothing and put a second, redundant "Learn" switch beside the real
one.

Two tiles map onto modules this migration does not create: **Contest → `competitions`**
and **Property Mgmt → `realtor`** (matches the codebase's documented "unpublishing
realtor hides the property pillars" coupling). Measured live on both backends 2026-11-17
(`GET /api/v1/modules/visibility`): `realtor` is already **served on staging and production**
(34 keys on staging, 31 on production, `realtor`, `estate` and `stays` among them), so adding
the `property → realtor` mapping hides nothing and needs no day-one flip here. `competitions`
is **absent from both**, so the same mapping would silently drop the Contest tile — which is
also what forces the override described in reconciliation note 2. The earlier draft of this
spec mapped Contest to `voteBridge`, which #996 documents as "the wallet-paid vote money rail",
not the contest surface; `voteBridge` is served on both planes, so that draft would have made
the bug worse by gating Contest against a module that is always on.

`realtor` is worth stating precisely, because it is not the same shape as the rows this
migration inserts. `VisibleIn` has three fail-closed axes, not one: `model.go:161`
(lifecycle), `model.go:164` (`EnvFlagEnabled`) and `model.go:167` (production readiness),
plus the per-environment row at 170-174. `service.go:84` computes the flag axis as
`envFlag == "" || s.flag(envFlag)`, so a NULL `env_flag` means "the registry alone
decides" and a named flag means the admin switch can hide a module but cannot bring back
one the ops flag has off. Every one of the 36 keys in the base registry
(`20261210000000_platform_module_registry.sql`) names an ops flag — 35 `FEATURE_*` plus
`VOTES_BRIDGE_ENABLED`, and none is NULL — `realtor`
included (`FEATURE_REALTOR_ENABLED`, true in `frontend-web/config/production-module-flags.env:57`),
while #996's seven and every row here are NULL. That is why binding a menu tile to a flag
was rejected: a flag no plane defines would hide the tile silently and make the
`/admin/modules` switch look broken.

**A tile switch is not the deep-link switch.** `routeModuleKeys.ts` is a separate plane,
shipped by `b66c16aa5`, and it does not cover the same surfaces: it lists `admin` among the
paths deliberately "never release-gated" (hiding the Admin tile leaves `/admin` reachable by
URL), has no entry at all for the other investment tiles, `dues` or `property`, and — the one
real divergence — gates the `/fractionalre` **route** on `realtor` (line 59) while this change
gates the fractionalre **tile** on `fractionalRealEstate`. Unifying them was considered and
declined: pointing the route at the tile's key would make an existing page fail closed on
precisely the planes where this migration ships that tile hidden, which R2 forbids. The
divergence is recorded in the migration's own comments so the next reader does not "fix" it by
accident.

State changes for R1:
- `INSERT … ON CONFLICT (key) DO NOTHING` for all new rows (never clobbers admin edits, mirroring the original seed migration), plus `platform_module_environments` rows per the table above (development visible for everything).
- **The visible half of the table above cannot be a seed alone** — on any plane that already ran #996 the environment rows exist as `hidden`, and `ON CONFLICT DO NOTHING` will not move them. The preserve list is therefore an explicit audited `UPDATE` to `visible` in staging + production, with `readiness = 'ready'` alongside it for production, because `VisibleIn` will not serve a production module below `ready` whatever its row says. See reconciliation note 2.
- Deliberate one-time `UPDATE` of `platform_module_environments` to `hidden` for `savings`, `loyalty`, `creators` in staging + production, each accompanied by a `platform_module_audit` row (note cites this spec and date). Idempotent: re-running the migration is a no-op on already-hidden rows.
- No schema DDL beyond seeds (additive-only migration gate unaffected); no RLS changes.

### 2. Mobile (`serviceModuleKeys.ts` + spec)

Measured against `origin/main` rather than from the draft's list: this PR adds **nine**
`SERVICE_MODULE_REGISTRY_KEY` entries — `investment`, `'invest-ai'→investAi`,
`spotlight-wealth→spotlightWealth`, `fractionalre→fractionalRealEstate`,
`'ai-trading'→aiTrading`, `education`, `dues`, `admin`, `property→realtor` — plus one
`FEATURED_REGISTRY_KEY` entry, `'invest'→'investment'` (R5). The draft counted 19 and
listed `crypto`, `learn`, `academy`, `'film-academy'`, `contest`, `'naija-driver'`,
`connect`, `marketplace→marketplace`, `shopping` and `parcel` as additions; the first
eight are #996's own lines, already on main (so the branch does not re-add them),
`contest` rides `competitions` not `voteBridge`, and `shopping`/`parcel` stay unmapped
per the note above. The deliberately-partial comment on the map is retired for the
tiles this feature reaches; `Quick-action` and `PROPERTY_SUBMODULE_REGISTRY_KEY` are
untouched.

New invariant spec at `tests/unit/modules/serviceModuleKeys.spec.ts` (node:test
conventions matching the sibling `moduleAvailability.spec.ts`, run by
`npm run test:modules`) pins **both halves** of the shipped rule: every
`SERVICE_MODULES` id outside `NO_REGISTRY_ROW = {shopping, parcel}` must resolve via
`registryKeyFor`, and no id inside it may resolve — so a future edit that maps a
placeholder or forgets a real tile fails, and the failure names the id. Every
`FEATURED_SERVICES` id must resolve via `featuredRegistryKeyFor`, zero exceptions.
(The two id-spaces stay separate; `PROPERTY_SUBMODULE_REGISTRY_KEY` governs property
pillars and is out of this invariant.) `menuVisibilityMatrix.spec.ts` then asserts the
2026-11-17 decision itself against a synthetic staging payload: the 12 hidden tiles
hidden, the 8 kept tiles visible, the 2 placeholders ungated.

### 3. Admin console — zero changes

`/admin/modules` already renders rows grouped by category with the per-environment tri-state toggle, confirmation, and audit note. New categories (`investment`, `education`, `contest`) group naturally.

### 4. Behavior & rollout

- Registry state is per environment. Staging flip is effective server-side the moment the migration lands there; production likewise when it lands there.
- **Partial-APK reality:** an installed APK gates exactly the tiles its own build of `serviceModuleKeys.ts` named — nothing more. So the tiles whose rows flip to hidden here (`savings`, `loyalty`, `creators`) disappear only from builds that already map them, and the nine this PR newly maps keep rendering in every APK in the field until a build carrying the new lines ships. Which mappings a given distributed APK contains is not derivable from the repository, so this spec does not claim a number; no server can hide a tile the installed code does not gate. Documented, accepted.
- **Unreachable registry is not "show everything".** `moduleStateFor` answers from the last good read when there is one; when there is neither a live answer nor a cache, it renders only `STABLE_MODULE_KEYS` — `wallet`, `walletTransfers`, `walletBankTransfers`, `beneficiaries`, `virtualAccounts` — and hides every other tile (`src/features/modules/rules.ts`, whose comment forbids adding keys to that list to fix a visibility complaint). Render decision ≠ authorization still holds: API authz protects every surface regardless of what the grid shows.
- **Consequence of the above for this PR.** Nine tiles move from "unmapped, so it always renders" to "mapped, so it obeys the registry" (the `git diff origin/main...HEAD` count: `investment`, `invest-ai`, `spotlight-wealth`, `fractionalre`, `ai-trading`, `education`, `dues`, `admin`, `property`), which means on a plane whose visibility endpoint is broken the grid gets *emptier*, not unchanged. Development is exactly that plane today: measured 2026-11-17, `GET /api/v1/modules/visibility` on `backend-development-502c.up.railway.app` answers HTTP 500 `could not load module visibility`, consistent with that database being behind the registry migrations (the local stack is measurably behind — no `readiness` column). R4 therefore cannot be observed until the development plane is migrated; repairing it is an ops step (`db-migrate` dispatch), not a client change, and definitely not an addition to the stable-keys list.
- `creators` sits in the approved disable list; it is currently published on staging and flips to hidden like `savings`/`loyalty`.

### 5. Verification

Done, with the evidence:

1. **Mobile unit spec — green.** 130/130, 0 skipped, via the declared script
   `npm run test:modules` in `mobile-app/reactnative` (main's baseline is 105).
   Includes the completeness invariant, the `shopping`/`parcel` exemption, and the
   staging matrix fixture. Re-run at this head after the three dead registry rows were
   dropped, because the fixture's staging payload changed with them. `tsc` was
   mutation-proved to actually read the changed files
   (clean run emits no diagnostics; an injected type error is reported at its line).
   **None of this is enforced by CI**, and that is not my inference alone:
   `ADR-PR1026` §Decision 6 says the same thing in the repo's own words — "The RN specs
   require `--experimental-strip-types` (Node 22+) against CI's pinned Node 20, and no RN
   unit spec runs in CI today; a guard nobody executes is a guard that rots". Wiring the
   suite in is the CI-minutes decision recorded under Out of scope.
2. **Migration replay on a real engine — done, both database shapes.**
   `fresh-plane-replay.sh` (empty database, migrations in filename order, with and
   without this file) is the authoritative run. Its "served" query mirrors the Go decision
   only for rows the registry can answer without a process env — `lifecycle='active' AND
   env_flag IS NULL AND status='visible'`, plus `readiness='ready'` on production — so the
   counts below count `env_flag`-NULL keys, not the size of a live payload. Re-measured
   2026-11-17 at this branch's head, after the `shopping`/`parcel`/`learn` rows were
   dropped, because the earlier 15/7 numbers came out of the 17-row file:
   - **with** the file: development serves 15 such keys (`academy, admin, aiTrading, arena,
     competitions, connect, crypto, dues, education, filmAcademy, fractionalRealEstate,
     investAi, investment, marketplace, spotlightWealth`) and staging and production each
     serve exactly the seven preserve keys (`arena`, `competitions`, `connect`, `crypto`,
     `education`, `filmAcademy`, `marketplace`), with #996's attributes winning on the
     shared rows (`academy` stays `Learn / StudyHub` / `education`, `arena` stays `Arena` /
     `entertainment`);
   - **without** the file: staging and production serve **nothing at all** — #996 leaves its
     keys hidden on both — so the audited `UPDATE` is the only thing carrying day-one
     visibility. That is the R2 regression reproduced rather than asserted.

   Read the caveat against the live measurement below: staging answers 34 keys and production
   31 today, because every module that carries a `FEATURE_*` flag (`realtor`, `estate`,
   `savings`, `loyalty`, `creators`, …) sits outside the replay's filter.
   `pushed-plane-replay.sql` runs the chain plus this file inside one rolled-back
   transaction on the developer Postgres (port 54322) and reaches the same end state,
   with the audit trail (`publish`/`hide`/`readiness`, before-values) and a second
   in-transaction run writing no new rows. **Its attribute-precedence section is
   evidence about that database, not about main:** the developer stack already carries
   committed rows from an earlier draft of this migration — `shopping`, `parcel`,
   `StudyHub`, `Naija Driver` and three `hide` audit rows stamped 2026-11-17 11:13 UTC
   — and it predates #996 (no `readiness` column outside the transaction), so it models
   a plane where this file ran *first*, which no plane migrated from main can be. Use
   the fresh-plane run for precedence; removing the residue from the developer stack is
   an ops step, listed under Out of scope. Both scripts stub only what the registry
   chain needs to exist at all (`auth.users`, RBAC
   `permissions`/`roles`/`role_permissions`, `restaurant_staff`); no table under test is
   stubbed.
   **Row set and test mirror agree, by construction now that the three dead keys are
   gone:** main's `visibility.spec.ts` keeps `REGISTRY_KEYS`, a hand-mirrored list of
   registered modules, and asserts every value in `SERVICE_MODULE_REGISTRY_KEY` is in
   it. All 14 keys this migration inserts appear in that set, and `learn`, `shopping`
   and `parcel` appear in neither the insert nor the set — which is the checkable form
   of "a row exists iff a tile gates on it". The pre-edit file inserted three rows the
   mirror did not know about; the suite could not see that, because it only walks
   map→key, never key→row.
3. **Live-plane measurement — done.** `GET /api/v1/modules/visibility` against the
   staging and production backends, recorded in reconciliation note 2 and re-read after
   the migration change. The development backend was probed too and answers HTTP 500 —
   see the R4 consequence in §4.
4. **Go module suites — green, with the reach of each check stated.**
   `go test ./internal/modules/... -count=1 -v` → 28 `--- PASS`, 0 FAIL, 0 SKIP across
   `internal/modules` and `internal/modules/modulegate`. Those suites are **in-memory**:
   no file under `internal/modules/` reads `TEST_DATABASE_URL` (the grep finds it only
   in `internal/handlers/`), so they gate no Postgres state and CI's live-DB lane says
   nothing about them. What CI *does* prove about this PR's SQL is `integration-verify`'s
   `make migrate-reset` — drop `public`, re-apply every migration from zero, then
   `rls-check` — which is the fresh-plane shape this spec's replay reproduces and
   extends with the served-payload assertions. What CI structurally cannot see is the
   already-pushed shape reconciliation note 2 is about: a from-zero replay never meets
   #996's existing `hidden` rows, and that workflow's anti-skip canary names
   `internal/savings`, `internal/handlers`, `internal/trading/wallet` and
   `tests/voting` — no module-registry name at all. The two-shape local replay is
   therefore not belt-and-braces; for this class of defect it is the only evidence that
   exists. (An earlier draft of this section credited the `backend` job with running
   these suites against Postgres. It does not: `backend` is `go build` + `vet`.)

Not done yet, and required before this ships:

5. **Grid verification in a browser** — RN-web services grid with a registry pointed at
   the migrated database: the 12 absent, every other tile present, featured `invest`
   card hidden. **Attempted via the existing Playwright harness and blocked, not by
   this PR:** `npx playwright test tests/e2e/modules/featured.spec.ts` fails 4/4 at
   `loginAs` (the 'Explore Services' home anchor never appears within its 30 s widen)
   on this branch **and identically on a clean `origin/main` worktree at `cefcd12fd`**,
   so the mobile e2e suite cannot currently render any gated surface, and no CI job
   runs it (`grep -rl "playwright" .github/workflows` → nothing). Writing a new
   `services-grid` spec was therefore rejected: an unrunnable test is not evidence. The
   check needs either the harness repaired first (separate work — the login helper, not
   the registry) or the manual pass against a plane that has run the migration.
6. **Admin flow** — `/admin/modules` shows the new rows, toggling `investment` visible
   brings the tile back within one 60 s stale window, audit row appended. Needs a plane
   that has run the migration plus an admin login, i.e. the owner's staging credentials
   and deploy; the console code path itself is unchanged by this PR (spec §3, zero
   admin diff), which is why no test is added for it here.

## Out of scope

- Route-level blocking of disabled surfaces (registry is presentation-plane doctrine; API authz unchanged).
- Per-user or per-role menu configuration.
- Admin UI grouping/UX changes.
- **Admin control over `shopping` and `parcel`.** The two coming-soon placeholders get
  no registry row, so `/admin/modules` does not list them; giving them a row without
  mapping the tiles would ship toggles that provably do nothing. They become
  togglable together with the change that maps them, which needs their category groups
  in `visibility.spec.ts` first.
- **Removing this feature's draft rows from the developer stack on port 54322.** The
  local database carries committed `shopping`/`parcel`/`StudyHub`/`Naija Driver` rows
  and three `hide` audit rows from an earlier replay (§5.2). Deleting committed rows
  from a shared database is the owner's call, not a side effect of a PR.
