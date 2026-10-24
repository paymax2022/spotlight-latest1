# Film Academy Area Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tuition is priced per option under each area of interest (schedule × with/without boarding); applicants pick up to 2 areas, one option and a boarding choice each, and tuition is the server-computed sum.

**Architecture:** New `academy_area_options` table (additive) read by the existing `/api/academy/apply` route; a pure pricing function turns validated `selections` into a snapshot + total, so the route, tests and admin share one rule. Admin gets an options CRUD route and an expandable table; mobile gets a bottom-sheet picker and sticky summary.

**Tech Stack:** Supabase/Postgres migration, Next.js route handlers (frontend-web, Vitest), Next.js admin (frontend-admin), React Native/Expo (mobile-app/reactnative), OpenAPI.

**Spec:** `docs/superpowers/specs/2026-10-24-film-academy-area-options-design.md`

## Global Constraints

- Money is whole naira in academy tables (not kobo); never floats; client-supplied prices are ignored.
- Max 2 areas per application (`MAX_INTEREST_AREAS_PER_APPLICATION`); no duplicate area.
- Tuition payable only on acceptance and refundable; ₦5,000 application fee flow unchanged.
- Migrations additive-only; unique version (`scripts/ci/check-migration-versions.sh`); re-check before merge.
- API changes start in `contracts/academy.openapi.yaml`.
- Never modify protected Spotlight modules (contests, voting, applicants, legacy auth).
- No new colours/fonts: tokens from `mobile-app/reactnative/design.md`; 48dp targets, 8pt grid.
- `cd frontend-web && npm run test:regression` green before and after.
- ADR named `docs/adr/ADR-PR<pr-number>-academy-area-options.md`; never pick a number.
- Conventional Commits; reference the feature flag already gating academy.

## Review Focus

- Applicant changes an option's price in admin after applying → their `tuition_total_ngn` and snapshot must not change (Task 3).
- `boarding: true` on an option with `price_with_boarding_ngn = null` → 400, never priced at the no-boarding amount (Task 2).
- Option id from a different area, or inactive/deleted option → 400 (Task 2).
- Area with zero active options → shown disabled "Pricing coming soon" and not selectable; server rejects it (Tasks 3, 7).
- Old mobile build sending only `areas_of_interest` for an area that has options → clear 400, not a ₦0 tuition (Task 3).

---

### Task 1: Migration and API contract

**Files:**
- Create: `supabase/migrations/20271095000000_academy_area_options.sql`
- Modify: `contracts/academy.openapi.yaml`

**Interfaces:**
- Produces: table `academy_area_options(id uuid pk, area_id uuid fk academy_interest_areas, label text not null, duration_label text, price_no_boarding_ngn bigint not null check >=0, price_with_boarding_ngn bigint check >=0, is_active bool default true, sort_order int default 0, created_at, updated_at)`; column `academy_applications.selected_options jsonb`.

- [ ] **Step 1:** Re-check the latest migration version (`ls supabase/migrations | tail`) and pick an unused one above it. Write the migration (additive only) with RLS mirroring `20261222000000_academy_interest_areas_rls.sql` (backend/service-role only).
- [ ] **Step 2:** In `contracts/academy.openapi.yaml` add `options` to the interest-area schema, `selections: [{area, option_id, boarding}]` to the apply request, `selected_options` to the application schema, and the `/api/admin/academy/area-options` GET/POST/PUT paths.
- [ ] **Step 3:** Run `supabase db reset` (dev) and `cd frontend-web && npm run contract:check`. Expected: migration applies; contracts parse.
- [ ] **Step 4:** Commit `feat(academy): area options table and contract`.

### Task 2: Pricing function (pure, test-first)

**Files:**
- Create: `frontend-web/src/server/services/academy/areaOptionPricing.ts`
- Test: `frontend-web/tests/unit/academy/areaOptionPricing.spec.ts`

**Interfaces:**
- Produces: `type OptionRow = { id: string; area_slug: string; label: string; duration_label: string | null; price_no_boarding_ngn: number; price_with_boarding_ngn: number | null; is_active: boolean }`; `type Selection = { area: string; option_id: string; boarding: boolean }`; `type PricedSelection = { area_slug: string; option_id: string; label: string; duration_label: string | null; boarding: boolean; price_ngn: number }`; `priceSelections(selections: Selection[], options: OptionRow[], max: number): { ok: true; priced: PricedSelection[]; total_ngn: number } | { ok: false; error: string }`.

- [ ] **Step 1: Write failing tests** with these names/assertions: `prices without boarding` (total = `price_no_boarding_ngn`); `prices with boarding` (total = `price_with_boarding_ngn`); `sums two areas`; `rejects boarding when price_with_boarding_ngn is null` (`ok:false`); `rejects option from another area`; `rejects inactive option`; `rejects unknown option id`; `rejects duplicate area`; `rejects more than max`; `rejects empty selections`; `ignores any price field on the selection` (extra `price_ngn: 1` key has no effect).
- [ ] **Step 2:** Run `cd frontend-web && npx vitest run tests/unit/academy/areaOptionPricing.spec.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `priceSelections` per the signature; error strings are user-safe sentences; all failures are `ok:false`, never throw.
- [ ] **Step 4:** Re-run. Expected: all PASS.
- [ ] **Step 5:** Commit `feat(academy): server-side area option pricing`.

### Task 3: Apply route (GET options, POST selections, snapshot)

**Files:**
- Modify: `frontend-web/app/api/academy/apply/route.ts` (POST ~L208-520, GET ~L625-670)
- Test: `frontend-web/tests/unit/academy/apply-area-options.spec.ts` (mock pattern from `tests/unit/golden-path/academy-apply.spec.ts`)

**Interfaces:**
- Consumes: `priceSelections` from Task 2.
- Produces: GET `interestAreas[].options: { id, label, duration_label, price_no_boarding_ngn, price_with_boarding_ngn }[]` (active, by `sort_order`); POST accepts `selections`; writes `selected_options`, `tuition_total_ngn`, `areas_of_interest` (derived).

- [ ] **Step 1: Write failing tests:** `GET nests active options under each area`; `POST prices from DB rows, not client price`; `POST stores selected_options snapshot and tuition_total_ngn`; `POST 400 for area with options when only areas_of_interest sent` (legacy payload); `POST legacy payload still works for an area with no options`; `POST 400 when selected area has no active options`; `snapshot is unchanged after the option price is later edited` (assert the stored row, not a re-read).
- [ ] **Step 2:** Run `npx vitest run tests/unit/academy/apply-area-options.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** In POST, when `body.selections` is present, load options for the selected areas, call `priceSelections`, keep existing area-active and batch-offered checks, replace the `fee_ngn` sum; derive `areas_of_interest` from selections. In GET, query `academy_area_options` for the returned areas and nest them. Keep `fee_ngn` in the response for old clients.
- [ ] **Step 4:** Run the new spec plus `npm run test:regression`. Expected: all PASS.
- [ ] **Step 5:** Commit `feat(academy): price applications from area options`.

### Task 4: Admin API route

**Files:**
- Create: `frontend-web/app/api/admin/academy/area-options/route.ts` (GET `?area_id=`, POST, PUT; pattern from `interest-areas/route.ts`)
- Test: `frontend-web/tests/unit/academy/area-options-admin.spec.ts`

**Interfaces:**
- Produces: JSON `{ success, options }` / `{ success, option }`; permission `programs:manage`; no DELETE (deactivate via `is_active`).

- [ ] **Step 1: Write failing tests:** `403 without programs:manage`; `POST rejects negative or non-integer price`; `POST accepts null price_with_boarding_ngn`; `PUT updates price and bumps updated_at`; `PUT 404 for unknown id`; `writes an audit event` (assert the audit helper the sibling route uses is called).
- [ ] **Step 2:** Run the spec. Expected: FAIL.
- [ ] **Step 3:** Implement the route reusing `parseFee`-style whole-naira validation and the sibling route's audit/permission helpers.
- [ ] **Step 4:** Run the spec. Expected: PASS.
- [ ] **Step 5:** Commit `feat(academy): admin area options endpoint`.

### Task 5: Admin UI

**Files:**
- Modify: `frontend-admin/src/services/filmAcademyAdminService.ts` (add `AcademyAreaOption`, `listAreaOptions(areaId)`, `createAreaOption`, `updateAreaOption`)
- Modify: `frontend-admin/app/admin/academy/film/page.tsx` (SettingsTab areas table; remove per-area fee input; batch checkbox suffix)

**Interfaces:**
- Consumes: Task 4 routes.

- [ ] **Step 1:** Add service functions with the existing `call<T>` helper.
- [ ] **Step 2:** Replace the per-area fee input with an expandable options table: Schedule, Duration, Price without boarding, Price with boarding (blank = not offered), Active, Save, plus "Add option" row; read-only "from ₦X" summary on the area row.
- [ ] **Step 3:** Run `cd frontend-admin && npm run type-check`. Expected: no errors.
- [ ] **Step 4:** Sign in locally (`scripts/dev/ensure-dev-login.sh`, needs Python) and verify create → edit → deactivate in the browser.
- [ ] **Step 5:** Commit `feat(academy): admin area options editor`.

### Task 6: Mobile data layer and pricing helper (test-first)

**Files:**
- Modify: `mobile-app/reactnative/src/features/filmAcademy/types.ts`, `api.ts` (`getOverview`, `applyToBatch` payload)
- Create: `mobile-app/reactnative/src/features/filmAcademy/optionPricing.ts`
- Test: `mobile-app/reactnative/tests/unit/filmAcademy/optionPricing.spec.ts`

**Interfaces:**
- Produces: `FilmAcademyAreaOption`; `FilmAcademyInterestArea.options: FilmAcademyAreaOption[]`; `optionPrice(o: FilmAcademyAreaOption, boarding: boolean): number | null`; `fromPrice(area: FilmAcademyInterestArea): number | null`; `summarise(picks: { area: FilmAcademyInterestArea; option: FilmAcademyAreaOption; boarding: boolean }[]): { lines: { label: string; price: number }[]; total: number }`.

- [ ] **Step 1: Write failing tests:** `optionPrice returns null when boarding unavailable`; `fromPrice is the lowest active no-boarding price`; `fromPrice is null with no options`; `summarise sums lines`.
- [ ] **Step 2:** Run the project's mobile unit runner on this spec. Expected: FAIL.
- [ ] **Step 3:** Implement helpers; extend types and `getOverview` defaults (`options: []`); `applyToBatch` sends `selections`.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(academy): mobile area option types and pricing helpers`.

### Task 7: Mobile UI

**Files:**
- Modify: `mobile-app/reactnative/app/film-academy/index.tsx` (area cards "from ₦X" / disabled "Pricing coming soon")
- Modify: `mobile-app/reactnative/app/film-academy/apply.tsx` (replace chip picker + totals)
- Create: `mobile-app/reactnative/src/features/filmAcademy/components/AreaOptionSheet.tsx`
- Modify: `mobile-app/reactnative/app/film-academy/status.tsx` (chosen option + boarding per area)

**Interfaces:**
- Consumes: Task 6 helpers. `AreaOptionSheet` props: `{ area: FilmAcademyInterestArea; initial?: { option_id: string; boarding: boolean }; onSelect(p: { option: FilmAcademyAreaOption; boarding: boolean }): void; onClose(): void }`.

- [ ] **Step 1:** Build `AreaOptionSheet`: segmented Without/With boarding (With disabled per option when price null), one selectable card per option (label, duration, exact price, "+₦X with boarding" hint), one primary "Select" button; loading skeleton, empty, and error states; accessibility labels include price and boarding.
- [ ] **Step 2:** `apply.tsx`: tapping an area opens the sheet; picks held as `{area_slug, option_id, boarding}`; sticky summary uses `summarise`; limit message at 2 of 2; submit sends `selections`.
- [ ] **Step 3:** `index.tsx`: area cards per spec; remove tuition-note copy that no longer applies.
- [ ] **Step 4:** `status.tsx`: render chosen options from `selected_options`.
- [ ] **Step 5:** Run `cd mobile-app/reactnative && npx tsc --noEmit -p .` Expected: no errors in these files; verify in the browser at `http://localhost:8083/film-academy` (choose option, toggle boarding, total updates, 3rd area blocked, dark mode).
- [ ] **Step 6:** Commit `feat(academy): mobile area option picker`.

### Task 8: Verification and review

**Files:**
- Create: `docs/adr/ADR-PR<pr-number>-academy-area-options.md` (after the PR number exists)

- [ ] **Step 1:** Run `cd frontend-web && npm run test:regression && npm run test:money && npm run contract:check`. Expected: all green.
- [ ] **Step 2:** Request `ledger-auditor` review (tuition computation, snapshot immutability).
- [ ] **Step 3:** Re-run `scripts/ci/check-migration-versions.sh` immediately before merge; renumber if another PR took the version.
- [ ] **Step 4:** Write the ADR and open the PR (<400 lines per PR where possible: tasks 1–4 server, 5–7 UI).
