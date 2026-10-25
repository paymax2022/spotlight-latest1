# Task Implementation Status Report

Date: 2026-10-24 | Branch: feat/referral-home-production | Agent: Claude Haiku 4.5

---

## TASK 2: Restaurant Taxonomy Browsing - ✅ COMPLETE

All implementation is complete and tested:
- Backend contract documented with `cuisines` field and `sections` on RestaurantDetail
- Discovery filters implemented (CuisineIDs, CategoryIDs via `c.QueryArray`)
- `CuisineRef`, `MenuSection` types defined
- `groupMenuSections()`, `attachCuisines()`, `menuSections()` methods implemented
- `WithTaxonomy()` flag method working
- All backend tests passing in `discovery_test.go`
- Mobile types, data layer, and components fully implemented
- Unit tests passing on all food features
- Golden-path regression tests remain green

**Status**: Production-ready, no further work needed.

---

## TASK 3: Film Academy Area Options - 🟨 PARTIALLY COMPLETE

### Completed:
- Migration 20271095000003 created with correct schema (academy_area_options table)
  - Fields: id, area_id, label, duration_label, price_no_boarding_ngn, price_with_boarding_ngn, is_active, sort_order, timestamps
  - Indexes, constraints, and RLS enabled
  - New columns on academy_applications (selected_options jsonb, tuition_total_ngn)

### Remaining (8 Tasks per Plan):

**Task 3.1**: Contract updates - PENDING
- Add schema definitions for AreaOption, Selection, PricedSelection
- Document GET /api/academy/apply with `interestAreas[].options`
- Document POST /api/academy/apply with `selections` array
- Document /api/admin/academy/area-options routes (GET, POST, PUT)

**Task 3.2**: Pricing function (TypeScript) - PENDING
- File: `frontend-web/src/server/services/academy/areaOptionPricing.ts`
- Test-first implementation: 10+ test cases
- Pure function: `priceSelections(selections, options, maxAreas) -> {ok, error} | {ok, priced, total}`

**Task 3.3**: Apply route modifications - PENDING
- File: `frontend-web/app/api/academy/apply/route.ts`
- GET: nest active options under areas
- POST: accept selections, call priceSelections, snapshot results
- Legacy fallback for areas_of_interest only

**Task 3.4**: Admin API route - PENDING
- File: `frontend-web/app/api/admin/academy/area-options/route.ts`
- GET, POST, PUT endpoints
- Permission: programs:manage
- Validation and audit events

**Task 3.5**: Admin UI - PENDING
- File: `frontend-admin/app/admin/academy/film/page.tsx`
- Expandable options table per area
- Remove per-area fee input, show "from ₦X" summary
- Create, update, deactivate options

**Task 3.6**: Mobile data layer - PENDING
- File: `mobile-app/reactnative/src/features/filmAcademy/`
- Types, pricing helpers, API integration
- Test cases: optionPrice(), fromPrice(), summarise()

**Task 3.7**: Mobile UI - PENDING
- Files: `app/film-academy/index.tsx`, `apply.tsx`, `status.tsx`, components
- AreaOptionSheet bottom sheet picker
- Area cards with "from ₦X" or "Pricing coming soon"
- Sticky summary with tuition total
- Status screen showing selections

**Task 3.8**: Verification & ADR - PENDING
- All tests passing
- ledger-auditor review
- Create ADR-PR<number>-academy-area-options.md
- Re-check migration uniqueness before merge

---

## Implementation Notes

1. **Schema discrepancy**: Earlier migrations (20271060000000+) created `academy_area_pricing_options` with fixed 5-option structure. New migration (20271095000003) creates flexible schema per plan spec. Both exist; recommend confirming which to use.

2. **Reference code**: `frontend-web/src/server/services/academy/pricing.ts` has related pricing logic that can inform implementation.

3. **Design tokens**: All UI must use tokens from `mobile-app/reactnative/design.md` (no new colors).

4. **Money convention**: Academy tables use whole naira, never kobo.

5. **Snapshot immutability**: Once created, `selected_options` and `tuition_total_ngn` are never updated, even if option prices change later.

---

## Effort Estimate for Task 3 Completion

- Server-side (pricing, routes): 3-4 hours
- Admin UI: 2-3 hours
- Mobile implementation: 4-5 hours
- Testing & review: 2-3 hours
- **Total**: ~11-15 hours

---

## Commits Created This Session

Migration file created: `supabase/migrations/20271095000003_academy_area_options.sql`
Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>

(Awaiting Task 3 implementation to generate additional commits)

---

Next session: Start with Task 3.2 (pricing function) using test-first approach.
