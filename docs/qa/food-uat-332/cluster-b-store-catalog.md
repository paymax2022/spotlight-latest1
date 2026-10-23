# Cluster B - Restaurant Store Setup & Catalog (RST-UAT-0064..0103)

**Cases attempted:** 40 (workbook lines 1161-1664 hold 40 cases, not ~55)  |  **Pass:** 15  |  **Fail:** 8  |  **Blocked:** 3  |  **N/A:** 14

Spec: `mobile-app/reactnative/tests/e2e/food-uat/cluster-b-store-catalog.spec.ts` (40 live-API/proof tests + 7 UI tests).

## Run notes (read first)

- Worktree `node_modules` is a symlink to the main checkout's. Run:
  `cd mobile-app/reactnative && E2E_BASE_URL=http://127.0.0.1:8083 npx playwright test tests/e2e/food-uat/cluster-b-store-catalog.spec.ts --project=desktop-chrome --workers=1 --reporter=list --output=<private dir>`.
  Use a private `--output`; the default `test-results/` is shared by concurrent cluster agents and caused hangs / ENOENT teardown.
- **Live run (desktop-chrome, 40 tests): 29 passed, 8 failed, 3 skipped.** The 8 failures are the *defect detectors* for 0065, 0068, 0069, 0081, 0085, 0090, 0097, 0101 (tests assert the correct behaviour, so red = product gap). The 3 skips are Blocked 0066 / 0075 / 0089. A green "[N/A proof]" test means the capability is confirmed ABSENT (404 route + source grep); it flips red if a later build adds the capability.
- Live legs run as the dev fixture `qa-claude-test@spotlight.internal` (documented password in `scripts/dev/ensure-dev-login.sh`; token cached in `os.tmpdir()` because Playwright restarts the worker after each failure and re-login trips the limiter) with `admin@spotlight.internal` as the non-staff "other user". Fixture stores created in local DB: "UAT-B Store", "UAT-B Outlet 2", "UAT-B Probe (legacy)" (all owned by the QA user, closed, no KYB).
- **UI legs are Blocked (harness):** `loginAs()` never reaches `/home` on the shared :8083 Metro ("Explore Services" never renders) - identical to clusters A and C. The 7 UI tests are skipped unless `E2E_FOOD_UI=1`. UI evidence is therefore source-level only (cited below).
- **Environment finding (not a product defect):** the running `:8080` api container (`new-api-1`, built 2026-10-18) predates #807. `POST /restaurant/:id/images/presign` is unmounted (404) and `PATCH /restaurant/:id {logo_url:"file:///etc/passwd"}` returns 200 although `validateStoreImageRefs` in source rejects it. Rebuild the container before re-running 0066.
- Order-level legs (0075, 0089, 0095-0097 order side) need an **open** store; opening is KYB-gated (FOOD-010, verified live: `PATCH /availability {is_open:true}` -> 403 "business verification must be approved") so no fixture can take an order. Cluster D owns those.
- Modifier admin (0086-0088, 0092): treated N/A per FOOD-011. Re-proved this pass: `GET/POST .../menu/items/:id/{modifier-groups,modifiers,options,option-groups}` all 404 live, and `finance_routes.go` references none of `CreateModifierGroup`/`AddModifier`/`ListItemModifierGroups`. The pricing side (`modifier_ids` on order lines, `resolveLineModifiers`) exists but cannot be fed.

## Results

| ID | Title | Priority | Core/Cond | Scope | Status | Evidence | Defect ID |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RST-UAT-0064 | Complete restaurant profile | P0 | Core | In | Pass | Live: PATCH name/description/address -> 200, GET `/restaurant/:id` echoes all three. Logo/banner via `StoreImagePicker` in `manage.tsx:380`. Discovery visibility is gated by KYB-open + listing review so not exercised; UI leg Blocked (harness) | - |
| RST-UAT-0065 | Validate mandatory store details | P0 | Core | In | Fail | Live: PATCH `{name:"   "}` -> 200, `{address:""}` -> 200, `{address:"   "}` -> 200 (only `name:""` rejected, `delivery.go UpdateRestaurant`). Fixture left with blank address, GET returned `"address":""`. Mobile create form blocks blank (`manage.tsx:submit`) but the API does not | FOOD-UAT-B-001 |
| RST-UAT-0066 | Approve or moderate storefront images | P1 | Core | In | Blocked | `:8080` image predates #807 (presign 404, file:// logo accepted). Source: `store_images.go` classifyStoreImageRef / `validateStoreImageRefs`, `store_images_test.go`. Re-run after rebuilding the api container | - |
| RST-UAT-0067 | Configure restaurant payout profile | P0 | Core | In | Fail | Live: POST `/bank-accounts` 201, response `account_number_masked:"****6789"`, full number absent from POST and GET bodies (pass). But account saved with `is_verified:false` and the client-typed `account_name`; `is_verified` is never read by the withdrawal path (`withdrawal.go` only stores/returns it); accounts are keyed by `user_id`, not merchant. Spec test passes (asserts masking); verdict is on the "verified beneficiary" half | FOOD-UAT-B-003 |
| RST-UAT-0068 | Protect bank changes by step-up | P0 | Core | In | Fail | Live: POST `/bank-accounts` with only a bearer token -> 201 ("Attacker Co"). No PIN/OTP/step-up header, no hold; `AddBankAccount` has no challenge and no audit event | FOOD-UAT-B-002 |
| RST-UAT-0069 | Set food prep lead time | P1 | Core | In | Fail | Live: PATCH `{prep_time_minutes:25}` on the store -> 200 but ignored (GET still 15); `UpdateRestaurantRequest` has no prep field. Item-level override works (PATCH item `prep_time_minutes:40` -> `prep_minutes:40`; 4 -> rejected "5 to 180"). Create-item response reports `prep_minutes:0` | FOOD-UAT-B-004 |
| RST-UAT-0070 | Toggle store accepting orders | P0 | Core | In | Pass | Live: close -> 200, GET `is_open:false`; open without KYB -> 403 (FOOD-010 gate holds); POST `/orders` on closed store -> 4xx body contains "closed" (`ErrRestaurantClosed`, `service.go:497`). Switch UI: `manage.tsx:331-345` (UI leg Blocked). Note: closed stores are simply not listed (discovery filters `is_open`), no "visible but unavailable" state | - |
| RST-UAT-0071 | Prevent suspended store publishing | P0 | Core | N/A | N/A | No merchant/restaurant suspension state: `Restaurant` struct and `service.go`/`delivery.go` have no suspended/status concept (`StaffSuspended` in `staff_roles.go` is per-staff). Nearest control: admin force-close `AdminSetAvailability` (`handler_admin_store.go:180`), which does not block owner edits. Test `[N/A proof]` green | - |
| RST-UAT-0072 | Create additional branch | P1 | Cond | In | Pass | Live: second `POST /restaurant` -> 201; `GET /mine` lists both under the same owner. Branch = independent `restaurants` row; no parent/branch-manager/per-branch-prep fields (`model.go`; test asserts absence). UI: "Add outlet" chip `manage.tsx:256` | - |
| RST-UAT-0073 | Restrict manager to assigned branch | P0 | Cond | In | Pass | Live, non-staff user (`admin@spotlight.internal`) against the QA store: PATCH store, PATCH item, PATCH bulk-availability, POST item all in {401,403,404}; item and store name unchanged afterwards. Staff grants are per-restaurant (`staff_roles.go AssertStaffPermission`). A true branch-A-manager token was not available | - |
| RST-UAT-0074 | Use branch-specific menu and hours | P0 | Cond | In | Pass | Live: item created on store 1 is absent from outlet 2's menu; price read back correct. Per-branch hours -> see 0099 (N/A). Observation: empty menu returns `"categories":null` | FOOD-UAT-B-010 |
| RST-UAT-0075 | Route order to correct branch | P0 | Cond | In | Blocked | Needs two open KYB-approved outlets + funded customer. Route is `/:id/orders` so the branch is explicit; dispatch reads that row's `geo_lat/lng`. Cluster D | - |
| RST-UAT-0076 | Handle branch disabled | P1 | Cond | In | Pass | Live: outlet 2 `PATCH /availability {is_open:false}` -> 200; order against it -> 4xx "closed"; sibling store name/state unaffected | - |
| RST-UAT-0077 | Create category and food item | P0 | Core | In | Pass | Live: POST category 201; POST item 201; GET detail lists the item under its category; ids unique. POST accepts but drops `prep_time_minutes` on create (see 0069). UI: `manage.tsx` AddItem | - |
| RST-UAT-0078 | Save draft without publishing | P0 | Core | N/A | N/A | `MenuItem` has no draft/published/status field (`model.go:67-84`); PATCH `{is_published:false,status:"draft"}` echoes neither; new items are immediately `is_available:true`. Closest: listing-level review (`listing_review.go`, FEATURE_FOODHUB_MODERATION) gates the whole restaurant, not items | - |
| RST-UAT-0079 | Publish and unpublish item | P0 | Core | In | Pass | Live: PATCH `is_available:false` -> GET false; back to true -> GET true (publish == availability flag). No cache layer in the path to invalidate | - |
| RST-UAT-0080 | Update item price | P0 | Core | In | Pass | Live: PATCH price 100000 -> 150000, GET shows 150000. Order lines snapshot price/subtotal (`model.go` `SubtotalKobo`, `OrderItem`); existing-order immutability not exercised end to end | - |
| RST-UAT-0081 | Reject invalid item price | P0 | Core | In | Fail | Live: create with -100, 12.5, "abc", null -> 400 (pass). Over-ceiling 100000001 / 1e12 -> blocked but **403**; PATCH price -5 -> blocked but **403** (`validateItemPriceKobo` error mapped via `ownerErrStatus`). Free items (0) also rejected ("required" tag). Item price unchanged after rejects. UI uses `parseNaira` bounds (`manage.tsx:711`) | FOOD-UAT-B-005 |
| RST-UAT-0082 | Reorder categories and featured meals | P2 | Core | N/A | N/A | No `sort_order`/featured on items or categories (`UpdateItemRequest`, `delivery.go`; PATCH `{sort_order,is_featured}` ignored). `IsFeatured` on `Restaurant` is paid placement only | - |
| RST-UAT-0083 | Replace and delete item photo | P1 | Core | N/A | N/A | `UpdateItemRequest` has no image field; no `/menu/items/:id/image(s)` route (`finance_routes.go`); live POST `.../images/presign` under an item -> 404. Only store logo/banner upload exists (`/:id/images/presign`) | - |
| RST-UAT-0084 | Bulk update menu items | P2 | Cond | In | Pass | CSV/list import does not exist (`finance_routes.go` has no import route) - N/A for that half. Bulk availability `PATCH .../availability/bulk {ids,is_available}` tested with one malformed id: either rejected with both valid rows untouched, or valid rows applied; no half-state | - |
| RST-UAT-0085 | Prevent concurrent overwrite of menu | P1 | Core | In | Fail | Live: PATCH with stale `If-Match: "stale-version"` -> 200 (last write wins). No version/ETag on items; editor is never told | FOOD-UAT-B-006 |
| RST-UAT-0086 | Create required option group | P0 | Core | N/A | N/A | FOOD-011. Live 404 on all modifier-group routes; no handler registered | FOOD-011 (existing) |
| RST-UAT-0087 | Enforce modifier min and max | P0 | Core | N/A | N/A | FOOD-011 (see 0086). Server-side check exists in `resolveLineModifiers` but no group can be created | FOOD-011 (existing) |
| RST-UAT-0088 | Price optional extras accurately | P0 | Core | N/A | N/A | FOOD-011 (see 0086) | FOOD-011 (existing) |
| RST-UAT-0089 | Persist kitchen preparation note | P0 | Core | In | Blocked | `sanitizeInstructions` (`menucart.go:53`) wired at `service.go:949`; only reachable via PlaceOrder on an open store (KYB-gated). Go tests `menucart_test.go`. Cluster D | - |
| RST-UAT-0090 | Display allergens and dietary flags | P0 | Core | In | Fail | API half passes: `dietary_tags:["Contains Nuts","vegetarian"]` stored normalised `["contains_nuts","vegetarian"]` and returned on GET menu. Customer half fails: no file under `src/features/food` or `app/food` reads `dietary_tags`/`dietaryTags`; the only "allergens" UI is an estimated-nutrition card (`app/food/restaurant/[id].tsx:46`, `checkout.tsx:537`). Merchant `mapItem` also drops the field, so owners cannot set it either | FOOD-UAT-B-007 |
| RST-UAT-0091 | Reject unsafe input as instructions | P0 | Core | In | Pass | Live: `description:"<script>..."` stored verbatim, returned as `application/json` (JSON-escaped), never text/html. Render path is RN `<Text>`/React (no `dangerouslySetInnerHTML`), so inert. No server-side sanitisation of description/item description (stored raw HTML) - acceptable only while every client encodes. UI inertness leg Blocked (harness). Order-note sanitiser: see 0089 | - |
| RST-UAT-0092 | Do not silently substitute modifier after order | P0 | Core | N/A | N/A | FOOD-011 (see 0086). Order lines snapshot modifiers (`OrderItemModifier`) but none can be selected | FOOD-011 (existing) |
| RST-UAT-0093 | Mark item sold out | P0 | Core | In | Pass | Live: PATCH `is_available:false` -> GET false; order for that item -> 4xx. `ErrMenuItemUnavailable` at `service.go:527`. UI: per-item "in stock" switch `manage.tsx:593` | - |
| RST-UAT-0094 | Restore inventory | P1 | Core | In | Pass | Live: `is_available:false` + `unavailable_until` (future) accepted; manual restore -> true; past restock time refused (4xx). "Only when store open" enforced by the closed-store check (0070) | - |
| RST-UAT-0095 | Prevent oversell at checkout | P0 | Core | N/A | N/A | No stock counts: availability is a boolean + `unavailable_until` (`availability.go`); PATCH `{stock_quantity:1}` ignored; no `stock_quantity`/`quantity_available` anywhere in `availability.go`. Nothing to oversell | - |
| RST-UAT-0096 | Release reserved stock on failure | P0 | Core | N/A | N/A | No stock reservation (`reserveStock`/`ReleaseStock`/`stock_reservation` absent from `service.go`, `availability.go`, `menucart.go`). Only promo redemptions reserve (`promo.go reservePromoRedemption`) | - |
| RST-UAT-0097 | Apply max per-item quantity | P0 | Core | In | Fail | Server-side cap exists but is global: `maxLineQuantity = 1000` (`menucart.go:33`, enforced `service.go:537`). No seller-configurable per-item limit: PATCH `{max_per_order:2}` ignored. Forged-quantity leg not exercised live (store cannot open) - covered by Go tests | FOOD-UAT-B-008 |
| RST-UAT-0098 | Hide deleted item from new cart | P0 | Core | In | Pass | Live: DELETE item 200/204; GET menu no longer lists it; order referencing it -> 4xx (no substitution) | - |
| RST-UAT-0099 | Configure recurring hours | P0 | Core | N/A | N/A | Service + read side exist (`hours.go SetBusinessHours`, `scheduled.go` uses `loadBusinessHours`) but **no HTTP route**: `finance_routes.go` references none of SetBusinessHours/SetHoliday/GetBusinessHours; live GET/PUT `/hours`, `/business-hours` -> 404; no RN screen. Same class as FOOD-011 | FOOD-UAT-B-009 |
| RST-UAT-0100 | Respect overnight opening | P0 | Core | N/A | N/A | Cross-day logic is implemented and unit-tested (`hours.go windowContains/isOpenAt`, `hours_test.go`) but owner cannot set a schedule (see 0099) | FOOD-UAT-B-009 |
| RST-UAT-0101 | Pause orders temporarily | P0 | Core | N/A | N/A | Timed pause absent: live POST/PATCH `/pause` -> 404. Manual open/close works and blocks new checkout (0070, 0103); no auto-resume after N minutes. Spec test red by design | FOOD-UAT-B-009 |
| RST-UAT-0102 | Close on holiday exception | P1 | Core | N/A | N/A | `SetHoliday`/`DeleteHoliday` exist in `hours.go`, no route (live `/holidays`, `/holiday`, `/closures` -> 404) | FOOD-UAT-B-009 |
| RST-UAT-0103 | Prevent last-second closed-store payment | P0 | Core | In | Pass | `PlaceOrder` re-reads `is_open` at submit (`service.go:468-497`, `!isOpen && scheduledFor == nil` -> `ErrRestaurantClosed`); live: store closed after item creation -> order 4xx "closed". Hours-based closure re-check cannot be tested (no hours config) | - |

## Defects

All are drafts for the orchestrator; none are filed in `SPOTLIGHT_UAT_BUG_TRACKER.md`. Repros use `T=<bearer from POST :8080/api/auth/login>` and `R=<store id owned by T>`.

### FOOD-UAT-B-001 - Major - Store update accepts blank name and blank address
`PATCH /api/finance/restaurant/$R` with `{"name":"   "}`, `{"address":""}` or `{"address":"   "}` returns 200 and persists the blank. `UpdateRestaurant` (`backend/internal/restaurant/delivery.go`) only rejects `name == ""` (not whitespace) and has no address check, so a store can lose its address (breaking geocoding, delivery-fee quote and dispatch pickup) through any client. Expected: 400 on empty/whitespace name or address (trim first). Test: RST-UAT-0065.

### FOOD-UAT-B-002 - Major - Payout bank account can be added without any step-up or hold
`POST /api/finance/restaurant/bank-accounts` `{"account_number":"0123456780","bank_code":"058","bank_name":"GTBank","account_name":"Attacker Co"}` with only a bearer token returns 201 and sets it as default (first account). No PIN/OTP/step-up token, no verification hold, no audit event in `AddBankAccount` (`withdrawal.go:724`). A stolen/idle session can redirect the next withdrawal. Expected: step-up challenge (transaction PIN as for transfers) or a verification hold plus audit event. Test: RST-UAT-0068.

### FOOD-UAT-B-003 - Major - Unverified, client-named bank accounts are accepted and `is_verified` is never enforced
With no resolver wired (or on resolver error) `AddBankAccount` soft-fails and stores the client-supplied `account_name` with `is_verified=false`; `is_verified` is not consulted in the withdrawal path, and accounts are keyed by `user_id` rather than the merchant. Repro: POST any 10-digit number with an arbitrary name -> 201 `"is_verified":false`. Expected: a payout beneficiary must be provider-verified (or held) before `RequestWithdrawal` can target it. Test: RST-UAT-0067 (annotation records `is_verified`).

### FOOD-UAT-B-004 - Major (feature gap) - Store default prep time cannot be set; PATCH silently ignores it
`PATCH /api/finance/restaurant/$R` `{"prep_time_minutes":25}` -> 200 and GET still reports 15; `UpdateRestaurantRequest` has no prep field (only per-item override exists). A merchant cannot set the lead time used for ETA/checkout. Secondary: create-item ignores `prep_time_minutes` and returns `prep_minutes:0` (inconsistent with the inherited 15). Expected: owner-settable default (5-180) or a 400 for the unknown field. Test: RST-UAT-0069.

### FOOD-UAT-B-005 - Minor - Price validation failures return 403 instead of 400
`POST .../menu/items` with `price_kobo=100000001` and `PATCH .../menu/items/:id` with `price_kobo=-5` return 403 "price_kobo must be ..." (the generic `ownerErrStatus` mapping). Clients that treat 403 as "not allowed/log out" will mishandle a typo. Data is correctly protected (no write). Expected: 400. Test: RST-UAT-0081 (soft assertions).

### FOOD-UAT-B-006 - Minor - No optimistic concurrency on menu edits
Two editors: PATCH with a stale `If-Match` is applied (200). Last write wins silently; no version, no conflict message. Expected: 409/412 with the latest values returned. Test: RST-UAT-0085.

### FOOD-UAT-B-007 - Major - Dietary/allergen tags are stored but never shown to customers (and not settable in the merchant app)
API stores/returns normalised `dietary_tags`; nothing in `mobile-app/reactnative/src/features/food` or `app/food` reads them, and the merchant `mapItem` (`src/features/restaurantmerchant/api.ts`) drops them. Allergen information is a safety-relevant P0 expectation ("contains nuts" must be visible at product details). Only an estimated-nutrition card exists. Test: RST-UAT-0090.

### FOOD-UAT-B-008 - Minor (feature gap) - No seller-configured max quantity per item
Only a global `maxLineQuantity = 1000` exists. Sellers cannot cap a single item (e.g. 5 per order). Test: RST-UAT-0097.

### FOOD-UAT-B-009 - Major (feature gap, same class as FOOD-011) - Opening hours, holiday closures and timed pause are implemented but unreachable
`hours.go` (`SetBusinessHours`, `SetHoliday`, `DeleteHoliday`, overnight windows) and the read side in `scheduled.go` exist and are unit-tested, but no route is registered and no owner UI exists, so schedules can never be configured and hours never gate discovery/checkout. Live GET/PUT `/hours`, `/business-hours`, POST `/holidays`, `/pause` all 404. No timed "pause 30 minutes" at all. Affects 0099, 0100, 0101, 0102 (and hours leg of 0074/0103). Expected: owner routes + RN screen, then re-run.

### FOOD-UAT-B-010 - Minor - Empty menu returns `categories: null`
`GET /api/finance/restaurant/:id` for a store with no categories returns `"categories":null` (not `[]`). The RN merchant mapper tolerates it (`?? []`); stricter clients (web/admin/OpenAPI consumers) may not. Observed in RST-UAT-0074.

### ENV-B-001 - Environment - `:8080` api container is stale (predates #807)
`POST /restaurant/:id/images/presign` 404 live; `logo_url:"file:///etc/passwd"` accepted live. Rebuild (restart is not enough) then re-run RST-UAT-0066 before judging store-image moderation.

### Already known (not re-filed)
FOOD-011 (modifier groups unreachable) - cases 0086, 0087, 0088, 0092.

## Not in scope of this pass / carried to other clusters
- 0075, 0089: Cluster D (needs an approved + open outlet and a funded customer).
- Order-side proofs for 0080 (existing receipt unchanged), 0092, 0097 forged qty, 0103 timing: Cluster D.
- UI legs for 0064, 0065, 0070, 0072, 0081, 0091, 0093 are authored (flag-gated by `E2E_FOOD_UI=1`) but unexecuted until the :8083 login harness is fixed.
