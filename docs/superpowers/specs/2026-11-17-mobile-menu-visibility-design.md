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
- **R6 — No unmapped tiles, ever.** A mobile spec asserts every `SERVICE_MODULES` id appears in exactly one of the registry-key maps; CI fails otherwise.
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
those keys. `20261216000100` still seeds its own rows with `ON CONFLICT (key) DO
NOTHING`, so on a database that already ran `20271410000000` the existing attributes
win and the seed is a no-op for the ten overlapping keys.

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

Two tiles map onto existing modules without new rows: **Contest → `voteBridge`**, **Property Mgmt → `realtor`** (matches the codebase's documented "unpublishing realtor hides the property pillars" coupling).

State changes for R1:
- `INSERT … ON CONFLICT (key) DO NOTHING` for all new rows (never clobbers admin edits, mirroring the original seed migration), plus `platform_module_environments` rows per the table above (development visible for everything).
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

1. **Mobile unit spec:** the completeness invariant + existing key-validation spec green (`node --test` inside `mobile-app/reactnative`).
2. **Migration replay:** fresh local stack `supabase migration up --include-all`, then `GET /api/v1/modules/visibility` (dev) and a staging-equivalent env read assert the exact visible/coming-soon key sets per the table above.
3. **Grid verification:** RN-web services grid in a browser — the 12 absent, every other tile present and unchanged, featured `invest` card hidden.
4. **Admin flow:** local admin console `/admin/modules` shows the new rows; toggling `investment` visible in the running environment makes the tile reappear on the next registry fetch (≤ 60 s); audit row appended.
5. **Go tests:** existing module service tests stay green (no Go changes).

## Out of scope

- Route-level blocking of disabled surfaces (registry is presentation-plane doctrine; API authz unchanged).
- Per-user or per-role menu configuration.
- Admin UI grouping/UX changes.
