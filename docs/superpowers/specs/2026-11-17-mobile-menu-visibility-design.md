# Mobile Menu Visibility — Admin-Controlled Service Grid

- **Date:** 2026-11-17
- **Status:** Approved (design approved in session; user pre-approved proceeding to implementation plan)
- **Surfaces:** `supabase/migrations` (one migration), `mobile-app/reactnative` (one module + spec), `frontend-admin` (zero changes), Go backend (zero changes)

## Problem

The production APK still shows 12 menu tiles that product wants off:

Savings, Rewards (Loyalty), Investment, Learn, Invest AI, Spotlight Wealth, Real Estate Invest, AI Trading, Creators, StudyHub (Academy), Dues & Rent, Admin.

Only 3 of them (`savings`→`savings`, `loyalty`→`loyalty`, `creators`→`creators`) are wired to the platform module registry; they are currently **published visible on staging** (verified live 2026-11-17 via `GET /api/v1/modules/visibility`), which is the plane the production APK talks to. The other 9 have no registry rows and no `SERVICE_MODULE_REGISTRY_KEY` mapping, so the shipped app renders them unconditionally.

Additionally, the admin portal must be able to enable/disable any mobile menu item per environment — including a greyed "coming soon" teaser state — without a code change.

## Existing architecture this rides (no new plane)

- **Tables:** `platform_modules` (key PK, name, category, env_flag, description, lifecycle, access_level), `platform_module_environments` (module_key + environment, status ∈ `hidden|visible|coming_soon`), `platform_module_audit` (append-only). Introduced by `20261210000000_platform_module_registry.sql`; RLS deny-all by design (`20261215000100_module_registry_rls.sql`) — backend-only via pgx.
- **Go service:** `backend/internal/modules/service.go` — `List`, `VisibleKeys`, `ComingSoonKeys`, `SetVisibility` (env row upsert + audit row in one tx). `VisibleIn` is fail-closed on every axis (archived, env flag off, environment never decided, status ≠ visible).
- **Endpoints:** public `GET /api/v1/modules/visibility` → `{environment, modules[], comingSoon[]}`; admin `GET/PATCH /api/v1/admin/modules…` behind `mapsAuth + requireUserID + RequirePermission('platform.modules.read'/'platform.modules.manage')`.
- **Admin console:** `frontend-admin/app/admin/modules/page.tsx` ("App Modules", `/admin/modules`, sidebar "Platform" section) lists every registry row grouped by category and toggles status per environment with a confirmation dialog and audit note. New registry rows appear there automatically.
- **Mobile:** static `SERVICE_MODULES` in `mobile-app/reactnative/src/constants/modules.ts`; gate = `useUserModuleState()` (`src/features/modules/visibility.ts`) fed by `GET /api/v1/modules/visibility` (react-query, 60 s staleTime); id→registry-key translation in `src/features/modules/serviceModuleKeys.ts` (deliberately partial — unmapped ids always render); tri-state rules in `src/features/modules/rules.ts` (`moduleStateFor`: registry unreachable → visible; key in `modules[]` → visible; in `comingSoon[]` → rendered inert; else hidden). Gated surfaces today: services grid (`app/(tabs)/services.tsx`) and home Explore card (`app/(tabs)/home.tsx`).

## Requirements

- **R1 — Default-off list.** These 12 tiles ship hidden in staging and production; development keeps them visible: Savings (`savings`), Rewards (`loyalty`), Investment (`investment`), Learn (`learn`), Invest AI (`invest-ai`), Spotlight Wealth (`spotlight-wealth`), Real Estate Invest (`fractionalre`), AI Trading (`ai-trading`), Creators (`creators`), StudyHub (`academy`), Dues & Rent (`dues`), Admin (`admin`). Of these, `savings` / `loyalty` / `creators` already have registry rows (currently visible on staging) and flip via UPDATE; the other 9 are new rows seeded hidden.
- **R2 — Whole-grid control.** Every `SERVICE_MODULES` tile id maps to a registry key. Tiles beyond R1 keep their current visibility: new registry rows for them are seeded visible in staging and production so nothing changes for users on day one.
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
eleven keys of its own). Verified empirically, not
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
Those tiles render today only because `serviceModuleKeys` did not name them, so shipping
the mappings without anything else would have dropped seven live tiles on the next
registry fetch (≤ 60 s) — the exact opposite of "nothing changes on day one".

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
  marks them ready". Mapping `contest` to it and keeping R2 means publishing it here.
  Accepted because users already see the tile and an admin can hide it again from
  `/admin/modules` without a deploy.

This is also why the file moved to `20271410000100`: `readiness` does not exist until
`20271408000100`, so a migration that sets it cannot sort before it. That closes the
version-slot question left open in the note above.

Both database shapes were replayed on a real Postgres rather than reasoned about: a
`#996`-landed plane (the flip changes `competitions` from hidden to visible and is a
no-op for the already-visible keys) and an empty plane (development serves all 18 keys,
staging and production serve exactly the nine preserve keys, and #996's attributes
win). Second run of the migration inside the same transaction writes no new audit rows.
Scripts: `/private/tmp/spot-menuvis-spike/pushed-plane-replay.sql`,
`fresh-plane-replay.sh`.

## Design

### 1. Registry migration (one file, additive + deliberate DML)

New `platform_modules` rows (env_flag deliberately **NULL on every new row** — coupling a menu tile to a `FEATURE_*` flag that may be unset on a plane would silently hide it; the ops-flag lane remains available later). Keys satisfy the existing `^[a-zA-Z][a-zA-Z0-9]*$` CHECK. The `marketplace` row backs the lifestyle shopping tile (`/marketplace`), whose id collides with the property pillar id in `PROPERTY_SUBMODULE_REGISTRY_KEY` by deliberate design — the two maps stay separate:

| key | name | category | default status (staging/prod) |
|---|---|---|---|
| `investment` | Investment | investment | hidden |
| `learn` | Learn | education | hidden |
| `investAi` | Invest AI | investment | hidden |
| `spotlightWealth` | Spotlight Wealth | investment | hidden |
| `fractionalRealEstate` | Real Estate Invest | investment | hidden |
| `aiTrading` | AI Trading | investment | hidden |
| `academy` | StudyHub | education | hidden |
| `dues` | Dues & Rent | property | hidden |
| `admin` | Admin | ops | hidden |
| `crypto` | Crypto | investment | visible |
| `education` | Education | utility | visible |
| `arena` | Naija Driver | contest | visible |
| `filmAcademy` | Film Academy | education | visible |
| `connect` | Connect | community | visible |
| `marketplace` | Marketplace | commerce | visible |
| `shopping` | Shopping | commerce | visible |
| `parcel` | Parcel | commerce | visible |

Two tiles map onto modules this migration does not create: **Contest → `competitions`**
and **Property Mgmt → `realtor`** (matches the codebase's documented "unpublishing
realtor hides the property pillars" coupling). `competitions` is registered by #996,
which is also what forces the override described in reconciliation note 2; the earlier
draft of this spec mapped Contest to `voteBridge`, which #996 documents as "the
wallet-paid vote money rail", not the contest surface.

State changes for R1:
- `INSERT … ON CONFLICT (key) DO NOTHING` for all new rows (never clobbers admin edits, mirroring the original seed migration), plus `platform_module_environments` rows per the table above (development visible for everything).
- **The visible half of the table above cannot be a seed alone** — on any plane that already ran #996 the environment rows exist as `hidden`, and `ON CONFLICT DO NOTHING` will not move them. The preserve list is therefore an explicit audited `UPDATE` to `visible` in staging + production, with `readiness = 'ready'` alongside it for production, because `VisibleIn` will not serve a production module below `ready` whatever its row says. See reconciliation note 2.
- Deliberate one-time `UPDATE` of `platform_module_environments` to `hidden` for `savings`, `loyalty`, `creators` in staging + production, each accompanied by a `platform_module_audit` row (note cites this spec and date). Idempotent: re-running the migration is a no-op on already-hidden rows.
- No schema DDL beyond seeds (additive-only migration gate unaffected); no RLS changes.

### 2. Mobile (`serviceModuleKeys.ts` + spec)

`SERVICE_MODULE_REGISTRY_KEY` gains 19 entries — `investment`, `crypto`, `learn`, `'invest-ai'→investAi`, `spotlight-wealth`→`spotlightWealth`, `fractionalre`→`fractionalRealEstate`, `'ai-trading'→aiTrading`, `education`, `contest`→`voteBridge`, `'naija-driver'`→`arena`, `'film-academy'`→`filmAcademy`, `academy`, `property`→`realtor`, `dues`, `connect`, `marketplace`→`marketplace`, `shopping`→`shopping`, `parcel`, `admin` — and the deliberately-partial comment is retired (the map is now exhaustive). `FEATURED_REGISTRY_KEY` gains `'invest'→'investment'` and `'naija-driver'→'arena'` (R5). Quick-action and property-submodule maps unchanged.

New invariant spec at `tests/unit/modules/serviceModuleKeys.spec.ts` (node:test conventions matching the sibling `moduleAvailability.spec.ts`, run by `npm run test:modules`): every `SERVICE_MODULES` tile id must resolve via `registryKeyFor` to a real registry key, and every `FEATURED_SERVICES` id must resolve via `featuredRegistryKeyFor` — zero exceptions; failure names the unmapped id. (The two id-spaces stay separate; `PROPERTY_SUBMODULE_REGISTRY_KEY` governs property pillars and is out of this invariant.)

### 3. Admin console — zero changes

`/admin/modules` already renders rows grouped by category with the per-environment tri-state toggle, confirmation, and audit note. New categories (`investment`, `education`, `contest`) group naturally.

### 4. Behavior & rollout

- Registry state is per environment. Staging flip is effective server-side the moment the migration lands there; production likewise when it lands there.
- **Partial-APK reality:** shipped APKs gate only the three already-mapped tiles, so `savings`/`loyalty`/`creators` disappear from current APKs as soon as staging flips; the other 9 keep rendering until the next APK build ships the new mappings. This is inherent — no server can hide a tile the shipped code doesn't gate. Documented, accepted.
- Fail-open on registry fetch failure is preserved (render decision ≠ authorization; API authz still protects every surface).
- `creators` sits in the approved disable list; it is currently published on staging and flips to hidden like `savings`/`loyalty`.

### 5. Verification

Done, with the evidence:

1. **Mobile unit spec — green.** 130/130 via
   `node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test
   "tests/unit/modules/*.spec.ts"` in `mobile-app/reactnative` (main's baseline is 105).
   Includes the completeness invariant, the `shopping`/`parcel` exemption, and the
   staging matrix fixture. `tsc` was mutation-proved to actually read the changed files
   (clean run emits no diagnostics; an injected type error is reported at its line).
2. **Migration replay on a real engine — done, both database shapes.**
   `pushed-plane-replay.sql` runs #996's chain and then this file inside one rolled-back
   transaction on the developer Postgres (port 54322): the preserve list ends up
   `visible` + `ready`, the R1 list ends up `hidden`, the audit trail records
   `publish`/`hide`/`readiness` with before-values, and a second run writes no new rows.
   `fresh-plane-replay.sh` builds two databases from empty, with and without this file:
   with it, development serves all 18 keys and staging/production serve exactly the nine
   preserve keys; without it, staging and production serve none of them — which is the
   R2 regression this note describes, reproduced rather than asserted. Both scripts stub
   only what the registry chain needs to exist at all (`auth.users`, RBAC
   `permissions`/`roles`/`role_permissions`, `restaurant_staff`); no table under test is
   stubbed.
3. **Live-plane measurement — done.** `GET /api/v1/modules/visibility` against the
   staging and production backends, recorded in reconciliation note 2 and re-read after
   the migration change.

Not done yet, and required before this ships:

4. **Grid verification in a browser** — RN-web services grid with a registry pointed at
   the migrated database: the 12 absent, every other tile present, featured `invest`
   card hidden. CI does not cover this.
5. **Admin flow** — `/admin/modules` shows the new rows, toggling `investment` visible
   brings the tile back within one 60 s stale window, audit row appended.
6. **Go tests** — expected untouched (no Go changes), but they have not been re-run in
   this reconciliation; the branch's `backend` CI job is the evidence so far.

## Out of scope

- Route-level blocking of disabled surfaces (registry is presentation-plane doctrine; API authz unchanged).
- Per-user or per-role menu configuration.
- Admin UI grouping/UX changes.
