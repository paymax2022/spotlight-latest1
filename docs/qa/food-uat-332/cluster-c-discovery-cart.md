# Cluster C — Discovery, Cart & Pricing (RST-UAT-0104..0134)

Spec: `mobile-app/reactnative/tests/e2e/food-uat/cluster-c-discovery-cart.spec.ts` (31 case tests + 2 live UI probes).
Run: `E2E_BASE_URL=http://127.0.0.1:8083 npx playwright test .../cluster-c-discovery-cart.spec.ts --project=mobile-chrome` -> 30 passed, 1 skipped (0134), 2 live probes could not complete.

## Method and limits
- Status comes from READ-ONLY source verification (mobile `app/food/*`, `src/features/food/*`, backend `internal/restaurant/*`). The spec's SURFACE tests assert the verified present/absent fact, so a green test = "finding confirmed", not "case passed". Per-case verdict is the Status column.
- LIVE UI is **Blocked**: Metro on :8083 is bound to live Supabase and rejects the harness' seeded session (login screen shown; `loginAs` never reaches `/home`), and the Go food API needs a bearer token. The two live probes (0104L, 0112L) self-skip as Blocked; their teardown also hits Playwright `ENOENT` trace-artifact errors, an environment quirk.
- Existing invariants referenced: `frontend-web/tests/unit/restaurant/food-cart.spec.ts`, `mobile-app/reactnative/tests/unit/food/{estimate,cartPrune}.spec.ts`, backend `pricing_test.go`, `promo_test.go`, `deliveryfee_test.go`, `discovery_page_test.go` (live-DB variants gated on `TEST_DATABASE_URL`).
- Totals: 31 cases = Pass 12, Fail 15, N/A 3, Blocked 1 (0134). _(The original header said Pass 13 / Fail 14; the table and the spec's `status()` annotations both give 12/15 — corrected by the Phase 5 rerun tie-break.)_ Pass verdicts are code-level only; UI not driven.

## Results
| ID | Title | Pri | Core/Cond | Scope | Status | Evidence | Defect |
|---|---|---|---|---|---|---|---|
| 0104 | Browse nearby restaurants | P0 | Core | In | Pass (code) | `discovery_page.go` WHERE `is_open` + `listing_review_status='APPROVED'`; Nearby tile sorts by distance with device coords | |
| 0105 | Search exact restaurant and meal | P0 | Core | In | Pass (code-read, Phase-5) | Query matches only name/description/cuisine (`discovery_page.go buildDiscoveryWhere`); no menu_items join, so dish search finds nothing. **Phase-5: dish search via `EXISTS(menu_items ...)` in `buildDiscoveryWhere` (1ec0cb9d8)** | C-001 |
| 0106 | Filter by cuisine and order mode | P1 | Core | In | Fail | Cuisine + price chips exist; no delivery/pickup or open-now filter (list is open-only) | C-002 |
| 0107 | Sort restaurant listing | P1 | Core | In | Pass (code) | Server sorts rating/name/newest/eta/distance/likes with id tiebreak; exposed via Browse tiles (no in-screen sort control) | |
| 0108 | Handle no location permission | P0 | Core | In | Pass (code) | Nearby falls back to eta proxy; checkout has manual `AddressAutocompleteInput` | |
| 0109 | Reject unsupported area gracefully | P0 | Core | In | Fail | No service zone / radius concept anywhere in `restaurant/*.go`; any address gets a quote; no customer pickup mode exists | C-003 |
| 0110 | Protect unpublished/suspended stores | P0 | Core | In | Fail | `priceOrder` gates only on `is_open`; `GetRestaurantDetail` and order path never check `listing_review_status`; cached link to an unapproved store still loads and can order | C-004 |
| 0111 | Add item and valid modifiers | P0 | Core | In | Pass (code-read, Phase-5) | Backend `resolveLineModifiers` + `modifier_ids` supported; mobile detail/cart/checkout have no modifier UI and never send `modifier_ids`. **Phase-5: `ModifierSheet` on detail page + `modifier_ids` sent (76bb39660)** | C-005 |
| 0112 | Increase/decrease/remove quantity | P0 | Core | In | Pass (code) | `decrementItem`/`removeItem` reset cart when empty; checkout shows "Your cart is empty"; `food-cart.spec.ts` | |
| 0113 | Reopen cart after app restart | P1 | Core | In | Fail | `useCartSync` restores via `setState(parsed)`; no price/availability revalidation on restore (pruning only for gone restaurants) | C-006 |
| 0114 | Prevent multiple-store carts | P0 | Core | In | Pass (code) | By design multi-restaurant cart (cartStore header, per-item `restaurant_id`); policy "supported multi-store architecture" satisfied. Promo scoping limit documented in `priceOrder` | |
| 0115 | Validate stale cart price at checkout | P0 | Core | In | Pass (code-read, Phase-5) | Server reprices at order time but client never learns: `QuoteOrder` exists in service but has no handler/client call; no price-changed confirmation. **Phase-5: `POST /orders/quote` (5d975f5dc) + `quoteOrder`/price-changed confirm in checkout (76bb39660)** | C-007 |
| 0116 | Preserve order instructions | P1 | Core | In | Fail | Backend `special_instructions` (sanitized) exists; mobile has no note field and api.ts never sends it | C-008 |
| 0117 | Protect cart ownership | P0 | Core | N/A for guessed-ID attack | N/A | Cart is device-local; client posts `/api/v1/food/cart` but no such route exists (grep backend: none), failure swallowed. No server cart IDs to guess. Side finding: local key `food-cart-storage` was not user-scoped (C-009 dissolved Phase-5: `cartStorageKey(userId)`, legacy key purged; c66d5020a) | C-009 |
| 0118 | Compute subtotal and quantity | P0 | Core | In | Pass (code) | `(price+modifiers)*qty` integer kobo in `priceOrder`; client `price*qty`; `estimate.spec.ts` | |
| 0119 | Calculate configured delivery fee | P0 | Core | In | Pass (code) | `ComputeDeliveryFeeFromRoute` per distance/time with per-restaurant config, min/max; no zone-specific rules exist | |
| 0120 | Calculate configured service fee | P0 | Core | In | Pass (code-read, Phase-5) | `applyBp` floors on surged subtotal, per-restaurant `service_fee_bp`; no cap/minimum/published policy. **Phase-5: `serviceFeePolicyKobo` min/max/round policy (`polish_w7.go`, c66d5020a)** | C-010 |
| 0121 | Configurable tax | P0 | Core | N/A | N/A | No tax/VAT field in `service.go`, `pricing.go`, `model.go`; totals have no tax leg | |
| 0122 | Quoted price consistent through payment | P0 | Core | In | Pass (code-read, Phase-5) | Pay sheet uses client `estTotal` (omits service fee, surge); Paystack path hard-fails on mismatch (`ErrExternalAmountMismatch`); not a leak today because service_fee_bp=0. **Phase-5: pay button/sheet use server quote total (76bb39660)** | C-007 |
| 0123 | Zero-priced promos / max amounts | P0 | Cond | In | Pass (code) | `computeDiscount` clamps [0,subtotal]; `maxOrderSubtotalKobo` enforced; total always includes delivery+packaging so no zero-pay path | |
| 0124 | Prevent client fee manipulation | P0 | Core | In | Pass (code) | `PlaceOrderRequest` has no fee fields; tip clamped >=0 and bounded; server recomputes everything | |
| 0125 | Redeem applicable coupon | P1 | Cond | In | Pass (code-read, Phase-5) | Backend promos work (percent/fixed/free_delivery, cap, funder); mobile checkout has no promo entry and never sends `promo_code`. **Phase-5: promo entry + preview, `promo_code` sent (76bb39660)** | C-011 |
| 0126 | Reject expired/ineligible voucher | P1 | Cond | In | Pass (code-read, Phase-5) | Server returns `ErrPromoInvalid` (422); unreachable from UI. **Phase-5: promo entry UI surfaces `promoErrorMessage` (76bb39660)** | C-011 |
| 0127 | Single-use code atomically | P0 | Cond | In | Pass (code) | `reservePromoRedemption` FOR UPDATE + count in short tx; `promo_live_db_test.go` (gated) | |
| 0128 | Restore/forfeit after refund | P1 | Cond | In | Pass (code) | `releasePromoRedemption` called on cancel/refund paths (service.go x2) | |
| 0129 | Loyalty points | P1 | Cond | N/A | N/A | No "loyalty" reference in non-test `backend/internal/restaurant/*.go`; loyalty module not wired to Food | |
| 0130 | Save precise delivery location | P0 | Core | In | Fail | Order INSERT stores only `delivery_address` text (+distance/eta); lat/lng now persisted (35e0b9ce1) but no landmark/building/phone fields | C-012 |
| 0131 | Reject outside delivery perimeter | P0 | Core | In | Fail | Same as 0109; no perimeter check | C-003 |
| 0132 | Malformed address coordinates | P0 | Core | In | Fail | `DeliveryCoords()` returns raw values; `validGeoPointPair` (-90..90/-180..180) is not applied on order path; missing coords silently fall back to flat fee | C-013 |
| 0133 | Fee quote after address change | P0 | Core | In | Pass (code) | `useDeliveryQuote(restaurantId, addressLocation)` re-keys; typing clears location so fee shows "—"; breakdown shows km/ETA. No eligibility recheck (see C-003) | |
| 0134 | Protect delivery address visibility | P0 | Core | In | Blocked | Needs seeded assigned/unassigned rider pair; defer to Cluster E/H | |

## Defects
Severity: Major unless noted. Source of truth for repro is the file/line named; live repro blocked by auth, so all are code-verified.

- **FOOD-UAT-C-001 (Major)** Dish search missing. Repro: seed store with dish "Jollof"; search "Jollof" at `/food`. Expected store listed; actual none (`buildDiscoveryWhere` searches store fields only; placeholder says "Search restaurant or dish").
- **FOOD-UAT-C-002 (Minor)** No delivery/pickup or open-now filters; customer pickup flow absent.
- **FOOD-UAT-C-003 (Major)** No serviceability: no zone/radius check in quote or PlaceOrder. Repro: `POST /api/finance/restaurant/:id/delivery-quote {lat:0,lng:0}` returns a fee (only `max_fee_kobo` caps) and an order with such coords is accepted. Pickup alternative absent.
- **FOOD-UAT-C-004 (Major)** Unapproved/hidden store reachable by id and orderable. Repro: unapprove a restaurant (`listing_review_status != APPROVED`, still `is_open`), GET detail + place order by id.
- **FOOD-UAT-C-005 (Major)** Mobile has no modifier selection; backend modifiers/required groups unusable from customer app (required-group items would be rejected, optional extras never sold).
- **FOOD-UAT-C-006 (Minor)** Restored cart is not revalidated (prices, availability) on app start.
- **FOOD-UAT-C-007 (Major)** No client-visible price quote: `QuoteOrder` unexposed; no "price changed, confirm" step; pay sheet amount is the client estimate and omits service fee/surge, so any non-zero `service_fee_bp`/`surge_bp` makes wallet and Paystack amounts disagree with the estimate.
- **FOOD-UAT-C-008 (Major)** Order instructions/notes not capturable in mobile although backend supports and sanitizes them.
- **FOOD-UAT-C-009 (Minor)** Cart persistence key is global (`food-cart-storage`), not per user, so a second account on the same device inherits the cart; `/api/v1/food/cart` is called but unrouted (errors swallowed).
- **FOOD-UAT-C-010 (Minor)** Service fee has no cap/minimum/published rounding policy.
- **FOOD-UAT-C-011 (Major)** Promo codes unusable from mobile: no entry field, `promo_code` never sent; Offers tile and backend promo engine exist.
- **FOOD-UAT-C-012 (Major)** Delivery coordinates not snapshotted on the order; landmark/building/phone not captured, so riders get an address string only.
- **FOOD-UAT-C-013 (Major)** Order path accepts invalid lat/lng (e.g. 999) and silently falls back to flat fee when coords are absent; delivery order is created and escrowed.

Not a defect, noted: restaurant detail `Delivery` fee line hidden unless a flat fee is known (intentional per code comment).


## Phase 5 Wave 2 UI rerun

Run (desktop-chrome, workers=1, Metro :8083, patched harness): `npx playwright test tests/e2e/food-uat/cluster-c-discovery-cart.spec.ts --project=desktop-chrome` -> **34 passed, 1 skipped (0134)**, 0 failed. The previous "Blocked" live probes (0104L, 0112L) now run and pass; the harness login reaches `/home` reliably.

**Environment finding (changes the premise of the rerun).** The :8083 Metro is built with `EXPO_PUBLIC_FOOD_USE_MOCK=false` (`mobile-app/reactnative/.env:151`), so the Food surface is NOT on in-app mocks: it calls `localhost:3000/api/finance/restaurant*`, the harness' fixture JWT is answered `401`, and `AuthGate` signs the session out, bouncing `/food` to the login screen a few seconds after first paint. (The original 0104L assertion on "Food & Delivery" only passed by racing that bounce.) The live legs therefore stub only `**/api/finance/restaurant**`, `/api/v1/food/cart` (404, as the real backend) and `/api/v1/nutrition/**` (404) with Go-DTO-shaped fixtures, and drive the real RN UI. Server-side behaviour (SQL search, repricing, serviceability, order INSERT) is NOT exercised by these legs; those cases keep their code-read verdicts.

New live tests: `0104L/0105L/0106L` (hub, search, filters), `0111L/0112L/0113L/0116L/0125L` (detail -> add -> checkout -> reload -> remove), plus the original `0104L`, `0112L`.

| ID | Phase 3 verdict | Phase 5 rerun verdict | Change reason |
| --- | --- | --- | --- |
| 0104 | Pass (code) | **Pass (live)** | Hub renders the stubbed restaurant card "Mama Cass" and search box for a signed-in customer; no verdict change, evidence upgraded |
| 0105 | Pass (code-read, Phase-5) | Fail (partial live). **Phase-5: dish search via `EXISTS(menu_items ...)` in `buildDiscoveryWhere` (1ec0cb9d8)** | UI does send `q=Jollof` to `GET /api/finance/restaurant`; whether the server matches a dish is backend (`buildDiscoveryWhere`, store fields only) and not exercisable with a stub. Code-read Fail stands (C-001) |
| 0106 | Fail | **Fail (live-confirmed)** | `/food` shows 4 price chips + cuisine chips only; no pickup/delivery or open-now control in the page text (C-002) |
| 0107, 0108 | Pass (code) | Pass (code) | Server sort / no-location fallback; not UI-drivable with stubs |
| 0109, 0110, 0120, 0130-0132 | Fail | Fail (code, unchanged) | Backend behaviours (serviceability, `listing_review_status`, service-fee floor, order INSERT, coord validation); no UI leg can show them |
| 0111 | Pass (code-read, Phase-5) | **Fail (live-confirmed)**. **Phase-5: `ModifierSheet` on detail page + `modifier_ids` sent (76bb39660)** | Added "Jollof Rice + Chicken" from the detail page: item goes straight into the cart, zero modifier/extras/required-choice UI (C-005) |
| 0112 | Pass (code) | **Pass (live)** | Add -> checkout shows line at ₦2,800.00 -> "Remove one" -> "Your cart is empty" |
| 0113 | Fail | **Fail (live-confirmed)** | Cart persisted under `food-cart-storage`; with the server price changed to ₦3,500, reload of `/food/checkout` restores the line still at ₦2,800.00 (no revalidation) (C-006) |
| 0115, 0122 | Fail | Fail (UI-observed) | Checkout pay button shows the client estimate ("Pay & place order · ₦2,800.00"); it does carry a caveat that "the estimate is missing a charge the server will still apply, so the final amount will be higher", which mitigates but does not remove C-007 (no price-changed confirm, no server quote) |
| 0116 | Fail | **Fail (live-confirmed)** | Checkout has no note/instructions field (C-008) |
| 0125, 0126 | Fail | **Fail (live-confirmed)** | Checkout has no promo/coupon/voucher entry (C-011) |
| 0133 | Pass (code) | Pass (code, not UI-driven) | Needs the address autocomplete provider; not stubbed |
| 0134 | Blocked | Blocked | Needs seeded assigned/unassigned rider pair (Cluster E) |
| 0104L, 0112L probes | Blocked | **Resolved (pass)** | Previously self-skipped; now run and pass |
| 0114, 0117-0119, 0121, 0123, 0124, 0127-0129 | unchanged | unchanged | Code-level (or N/A) facts with no UI leg |

Net for Cluster C: **0 verdict flips and 0 DISSOLVED (no Fail passed live); 2 Pass (code) rows upgraded to Pass (live) (0104, 0112); 6 Fail rows live-confirmed (0106, 0111, 0113, 0116, 0125, 0126), 1 partially (0105), 2 UI-observed (0115, 0122); 15 Fail remain; 2 Blocked live probes resolved; 1 Blocked remains (0134).** Totals unchanged: Pass 12, Fail 15, N/A 3, Blocked 1. Tie-break on the self-inconsistent pass/fail lists: the table and the spec's status annotations agree on 12/15/3/1; the original header's 13/14 was wrong.

Flakiness: none in the final run. During development the session bounce above produced false "login screen" readings until the food API was stubbed. Recommend either seeding a real GoTrue user via `scripts/dev/ensure-dev-login.sh` or running Metro with `EXPO_PUBLIC_FOOD_USE_MOCK=true` for future UI UAT.


## Phase 5 Wave 9 UI rerun

Code-read (SURFACE) tests re-run after the Phase-5 fixes landed. Before: 10 of 31 case tests failed because their negative ("feature absent") assertions inverted. After: 30 passed, 1 skipped (0134), 0 failed. The 4 LIVE UI probes (0104L, 0105L/0106L, 0111L.., 0112L) still cannot log in on this host (Metro :8083 / harness session, environment-blocked) and were not re-verified; their "no modifier/note/promo UI" live assertions are stale vs. the code-read result and need a live rerun.

Status table: Pass 12 -> 19, Fail 15 -> 8, N/A 3, Blocked 1 (the 4 live probes are not counted).

Dissolved Fail -> Pass (code-read, Phase-5):
- **0105** (C-001) dish search, `EXISTS(menu_items ...)` in `buildDiscoveryWhere` - 1ec0cb9d8
- **0111** (C-005) `ModifierSheet` + `modifier_ids` - 76bb39660
- **0115** (C-007) `POST /orders/quote` handler (5d975f5dc) + `quoteOrder`/price-changed confirm (76bb39660)
- **0120** (C-010) service-fee min/max/round policy, `serviceFeePolicyKobo` - c66d5020a (`polish_w7.go`)
- **0122** (C-007) pay button and pay sheet use the server quote total - 76bb39660
- **0125** (C-011) promo entry + preview, `promo_code` sent - 76bb39660
- **0126** (C-011) promo entry UI surfaces rejection (`promoErrorMessage`) - 76bb39660

Status unchanged but evidence moved:
- **0117** stays N/A; side finding C-009 dissolved (user-scoped `cartStorageKey`, legacy key purged) - c66d5020a
- **0130** stays Fail (partial): delivery lat/lng/landmark/phone now persisted by the order INSERT (35e0b9ce1) but checkout still has no landmark/building/phone capture (C-012 open)
- **0116** stays Fail (C-008): the `TextInput` now in checkout is the promo field; no instructions field and `special_instructions` is still not sent. The assertion was narrowed to `/instruction/i` rather than inverted, since inverting `TextInput` would be a false Pass
- **0113** code-read assertions still pass, but C-006 appears addressed by `cartRevalidate` (revalidateRestoredCart); status row not changed in this wave
