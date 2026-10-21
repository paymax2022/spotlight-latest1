# Restaurant Super App — Comprehensive UAT 332 (Food module, deep second pass)

**Source**: `/Users/paymax/Downloads/Restaurant_Super_App_Comprehensive_UAT_Workplan_Test_Cases.md` (+ companion `.xlsx`).

**Why this exists**: The Food module was previously signed off against the 33-case plan at `docs/qa/food-restaurant-test-plan.md` (SPOTLIGHT_UAT_BUG_TRACKER.md, Module 12). This workbook is ~10× bigger (332 Core+Conditional cases, 40 subprocess areas, 22 cross-role E2E journeys) and this pass runs it against the already-shipped Food surface to surface deeper defects. Previous blockers (FOOD-001..010) remain fixed; the new bug IDs allocated here are `FOOD-UAT-<cluster>-NNN`.

## Environment (verified live at 2026-10-20)

| Surface | URL / path | Status |
| --- | --- | --- |
| Mobile RN web (customer, restaurant owner, rider) | `http://localhost:8083` | UP (Metro, PID 4954) |
| Admin console | `http://localhost:3001/admin/restaurant/*` | UP (307 redirect to login — expected) |
| Supabase (local) | `http://localhost:54321`, PG `54322` | UP |
| Backend Go API | docker `:8080` | UP |

## Playwright harness

- Config: `mobile-app/reactnative/playwright.config.ts` (baseURL `http://127.0.0.1:8083`)
- Helpers: `tests/e2e/helpers/{auth,common,assertions,testData}.ts`
- Pattern seed: `tests/e2e/modules/food.spec.ts`, `restaurantmerchant.spec.ts`
- Admin console runs on port **3001**; specs that touch admin either hit `http://127.0.0.1:3001/...` directly from the Playwright page, or call `backend` HTTP from the test runner.

## Case ID vocabulary

- Workbook IDs: `RST-UAT-NNNN` (positive/negative/boundary/security per-case).
- Cross-role journeys: `EEJ-NN` from §8.
- Requirements: `R01..R46` from §6.

Every spec test's `test.describe` block carries the workbook `RST-UAT-NNNN` ID in its title so the per-case results doc lines up 1:1 with Playwright output.

## Scope decision rules

A case is marked:
- **In Scope — Pass** if the feature exists and verified behavior matches expected.
- **In Scope — Fail** if the feature exists but behavior diverges. Open a `FOOD-UAT-<cluster>-NNN` row in `SPOTLIGHT_UAT_BUG_TRACKER.md`.
- **In Scope — Blocked** if a dependency is down (seed data missing, upstream service unavailable).
- **Not Applicable** if the capability does not exist in the current Spotlight Food surface (e.g. "kitchen printer handshake" if there is no printer integration). The N/A reason MUST cite a code path or doc that proves absence — never guess.
- **Conditional — Deferred** if feature flag OFF per release scope.

## Clusters (one owning agent each)

| Cluster | Workbook §7 subprocess modules | UAT doc line range | Case count (approx) | Spec file | Results doc |
| --- | --- | --- | --- | --- | --- |
| **A — Identity / RBAC / Upgrades** | Customer Accounts, Owner Upgrade, Owner KYB, Rider Upgrade, Rider Verification, Role Lifecycle, RBAC & Tenant Isolation | 377–1160 | ~70 | `food-uat/cluster-a-identity-rbac.spec.ts` | `cluster-a-identity-rbac.md` |
| **B — Restaurant Store Setup & Catalog** | Restaurant Store Setup, Branches & Zones, Menu, Modifiers & Food Data, Stock & Availability, Hours & Closures | 1161–1664 | ~55 | `food-uat/cluster-b-store-catalog.spec.ts` | `cluster-b-store-catalog.md` |
| **C — Discovery, Cart & Pricing** | Discovery & Search, Cart, Prices/Tax/Fees, Promotions & Loyalty, Delivery Address & Serviceability | 1665–2056 | ~55 | `food-uat/cluster-c-discovery-cart.spec.ts` | `cluster-c-discovery-cart.md` |
| **D — Checkout, Payment & Order Lifecycle** | Checkout & Creation, Payment/Webhook/Recovery, Restaurant Order Lifecycle, Kitchen Execution | 2057–2480 | ~55 | `food-uat/cluster-d-checkout-payment.spec.ts` | `cluster-d-checkout-payment.md` |
| **E — Dispatch, Rider, Tracking & Pickup** | Dispatch & Assignment, Rider Availability & Jobs, Tracking/ETA/Privacy, Pickup Journey, Dine-In & Tables, Reservations | 2481–3104 | ~55 | `food-uat/cluster-e-dispatch-rider.spec.ts` | `cluster-e-dispatch-rider.md` |
| **F — Cancellation, Refunds, Disputes & Money** | Cancellation & Refunds, Complaints & Disputes, Wallets & Payouts, Commission Engine | 3105–3528 | ~45 | `food-uat/cluster-f-money-disputes.spec.ts` | `cluster-f-money-disputes.md` |
| **G — Admin, Reports & Reviews / Notifications** | Reviews & Reputation, Notifications, Admin Operations, Reports & Reconciliation, Audit Trail | 3529–3868 + 4277–4328 | ~30 | `food-uat/cluster-g-admin-reports.spec.ts` | `cluster-g-admin-reports.md` |
| **H — NFR / Security / Cross-cutting + 22 E2E journeys** | Privacy & App Security, Load & Failure Recovery, Accessibility, Integration Contracts, Localization, Consent, Food Safety, Account Closure, Multi-Device, Fraud, §8 journeys | 3869–4772 (plus NFR gaps) | ~90 + 22 EEJ | `food-uat/cluster-h-nfr-journeys.spec.ts` | `cluster-h-nfr-journeys.md` |

## Agent contract (per cluster)

Each agent MUST:

1. **Read-only on product code.** Create new files only (test spec + results doc). No edits to `app/`, `backend/`, `frontend-admin/` product code — those come in Phase 5 remediation after triage.
2. **Verify surface before testing.** For each `RST-UAT-NNNN` in your line range: before authoring a spec, grep the relevant feature path in `mobile-app/reactnative/app/food/*`, `frontend-admin/app/admin/restaurant/*`, or `backend/internal/restaurant/*`. If the capability does not exist, mark **Not Applicable** with the specific file/path cited as proof — do not fabricate.
3. **Author Playwright spec** at `mobile-app/reactnative/tests/e2e/food-uat/<cluster-file>.spec.ts` using the existing helper pattern. Each `test()` title MUST start with the workbook ID: `test('RST-UAT-0001 — Register using valid contact and OTP', ...)`. Group with `test.describe`.
4. **Run your own spec** against the live services (:8083, :3001). Use the existing `webServer.reuseExistingServer: true` in `playwright.config.ts` — Playwright will attach to the running Metro. Run with: `cd mobile-app/reactnative && npx playwright test tests/e2e/food-uat/<cluster-file>.spec.ts --reporter=list`. If local Playwright isn't installed, do a dry-run (`--list`) and leave specs for Phase 3 orchestrator to execute.
5. **Record outcomes** in `docs/qa/food-uat-332/<cluster-file>.md`: one row per case with `ID | Title | Priority | Core/Cond | Scope | Status | Evidence | Defect ID`.
6. **Draft defect rows** at the bottom of your results doc under `## Defects` with full repro steps. Do NOT edit the global tracker — the orchestrator will consolidate.
7. **Return a short summary**: cases attempted / Pass / Fail / Blocked / N/A, plus a sorted list of defect severities (Blocker/Major/Minor).

## Non-goals (this swarm)

- No product-code changes. Phase 5 remediation handles that in a separate swarm.
- No new backend/frontend features. If a capability is missing, it is an N/A with reason, logged as a feature-gap defect, and triaged separately.
- No modification of `SPOTLIGHT_UAT_BUG_TRACKER.md` by the authoring swarm — the orchestrator rolls defects up at the end.
- No modification of existing `docs/qa/food-restaurant-test-plan.md` (keep the prior 33-case history intact).
