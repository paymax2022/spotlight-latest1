# Cluster H — NFR / Security / Cross-cutting + 22 Cross-role Journeys

Spec: `mobile-app/reactnative/tests/e2e/food-uat/cluster-h-nfr-journeys.spec.ts`. Run date 2026-10-20, project `desktop-chrome`, workers=1.

Scope: RST-UAT-0280..0311 and 0316..0332 (49 cases; 0312-0315 belong to Cluster G) + EEJ-01..22 (workbook labels them E2E-NN).

**Run environment caveat:** host load average was 150-350 (many concurrent swarm agents); Metro cold-bundle renders exceeded the shared helper `loginAs` 10 s wait (`Explore Services`) and `Mama Cass` waits. UI-dependent results are therefore `Blocked (env)`, not product failures. Re-run on an idle host.

## Summary

| Status | Cases | Journeys |
|---|---|---|
| Pass | 7 (0280, 0282, 0287, 0308, 0323, 0330, 0331) | 2 (EEJ-01, EEJ-02; surface smoke only) |
| Fail | 3 (0309, 0310, 0317) | 0 |
| Blocked (env: host load) | 7 (0284, 0295, 0296, 0297, 0298, 0305, 0318) | 3 (EEJ-04, 05, 07) |
| Blocked (rig/fixture/harness) | 32 | 0 |
| In-Scope - Deferred (multi-session harness) | - | 17 (EEJ-03, 06, 08-22) |
| Not Applicable | 0 | 0 |

Pass results are partial layers where noted (anonymous/expired-token gates, static contract); cross-user and authenticated layers need seeded tokens.

## Cases

| ID | Title | Priority | Core/Cond | Scope | Status | Evidence | Defect ID |
|---|---|---|---|---|---|---|---|
| RST-UAT-0280 | Enforce backend ownership on direct object access | P0 | Core | In Scope | Pass | Anon + garbage-bearer on 10 order/store/KYB/admin routes all 401 (spec). Cross-user layer: backend authz_test.go (not re-run); live two-identity probe Blocked. | — |
| RST-UAT-0281 | Protect sensitive records in logs | P0 | Core | In Scope | Blocked | Needs log-sink access + error trigger harness | — |
| RST-UAT-0282 | Keep secrets out of mobile bundle | P0 | Core | In Scope | Pass | Dev bundle (~50MB) scanned: no sk_live/sk_test/private key; only JWT is role=anon. `service_role` text hits are supabase-js doc comments (false positive; test decodes JWT role). | — |
| RST-UAT-0283 | Require TLS and reject unsafe transport | P0 | Core | In Scope | Blocked | Local stack is HTTP; needs staging + MITM proxy | — |
| RST-UAT-0284 | Prevent injection in search and forms | P0 | Core | In Scope | Blocked (env) | UI search XSS payload test written; page never rendered (host load). API half: injection payload POST anon -> 401 (not reached) | — |
| RST-UAT-0285 | Verify secure local cache on logout | P0 | Core | In Scope | Blocked | Needs real merchant/rider session with PII | — |
| RST-UAT-0286 | Audit customer personal data request | P1 | Core | In Scope | Blocked | No food-scoped data-request UI found (only app/(doctor)/compliance/privacy.tsx); product decision needed | — |
| RST-UAT-0287 | Respect privacy in location tracking | P0 | Core | In Scope | Pass | Anon POST /orders/:id/location, GET /orders/:id/ws, GET /ws all 401. Cross-role retrieval Blocked (needs 2 tokens) | — |
| RST-UAT-0288 | Measure search and menu responsiveness | P0 | Core | In Scope | Blocked | Blocked (requires k6/jMeter rig) | — |
| RST-UAT-0289 | Measure checkout latency and failures | P0 | Core | In Scope | Blocked | Blocked (requires k6/jMeter rig) | — |
| RST-UAT-0290 | Measure dispatch processing under bursts | P0 | Core | In Scope | Blocked | Blocked (requires k6/jMeter rig) | — |
| RST-UAT-0291 | Recover from intermittent mobile network | P0 | Core | In Scope | Blocked | Needs live auth session / worker restart / authed WS | — |
| RST-UAT-0292 | Recover from service restart | P0 | Core | In Scope | Blocked | Needs live auth session / worker restart / authed WS | — |
| RST-UAT-0293 | Recover from stale push or websocket | P0 | Core | In Scope | Blocked | Needs live auth session / worker restart / authed WS | — |
| RST-UAT-0294 | Guard throttling and abuse under load | P0 | Core | In Scope | Blocked | Blocked (requires k6/jMeter rig) | — |
| RST-UAT-0295 | Navigate checkout with screen reader | P1 | Core | In Scope | Blocked (env) | Spec authored; /food never reached within helper 10s `Explore Services` / `Mama Cass` timeouts (host load avg 150-350). Re-run on idle host. Source shows 11 a11y attrs in restaurant/[id].tsx and "Nutrition & allergens" toggle (not a pass). | — |
| RST-UAT-0296 | Use large system font | P1 | Core | In Scope | Blocked (env) | Spec authored; /food never reached within helper 10s `Explore Services` / `Mama Cass` timeouts (host load avg 150-350). Re-run on idle host. Source shows 11 a11y attrs in restaurant/[id].tsx and "Nutrition & allergens" toggle (not a pass). | — |
| RST-UAT-0297 | Verify contrast and touch targets | P1 | Core | In Scope | Blocked (env) | Spec authored; /food never reached within helper 10s `Explore Services` / `Mama Cass` timeouts (host load avg 150-350). Re-run on idle host. Source shows 11 a11y attrs in restaurant/[id].tsx and "Nutrition & allergens" toggle (not a pass). | — |
| RST-UAT-0298 | Recover from validation errors clearly | P1 | Core | In Scope | Blocked (env) | Spec authored; /food never reached within helper 10s `Explore Services` / `Mama Cass` timeouts (host load avg 150-350). Re-run on idle host. Source shows 11 a11y attrs in restaurant/[id].tsx and "Nutrition & allergens" toggle (not a pass). | — |
| RST-UAT-0299 | Handle low-end device performance | P0 | Core | In Scope | Blocked | Needs physical min-spec device | — |
| RST-UAT-0300 | Handle payment provider API outage | P0 | Core | In Scope | Blocked | Needs provider/geocoder/queue/vendor fault injection | — |
| RST-UAT-0301 | Handle payout provider API outage | P0 | Core | In Scope | Blocked | Needs provider/geocoder/queue/vendor fault injection | — |
| RST-UAT-0302 | Handle maps geocoder disagreement | P1 | Core | In Scope | Blocked | Needs provider/geocoder/queue/vendor fault injection | — |
| RST-UAT-0303 | Reject duplicate event delivery from message queue | P0 | Core | In Scope | Blocked | Needs provider/geocoder/queue/vendor fault injection | — |
| RST-UAT-0304 | Handle notification vendor retry semantics | P1 | Core | In Scope | Blocked | Needs provider/geocoder/queue/vendor fault injection | — |
| RST-UAT-0305 | Display NGN consistently | P0 | Core | In Scope | Blocked (env) | Spec authored; /food never reached within helper 10s `Explore Services` / `Mama Cass` timeouts (host load avg 150-350). Re-run on idle host. Source shows 11 a11y attrs in restaurant/[id].tsx and "Nutrition & allergens" toggle (not a pass). | — |
| RST-UAT-0306 | Use local timezone for hours and cutoff | P0 | Core | In Scope | Blocked | Needs clock control + finance rollover fixture | — |
| RST-UAT-0307 | Correct fee rounding on small values | P0 | Core | In Scope | Blocked | Needs sandbox order path; unit coverage exists (src/features/food/__tests__, backend deliveryfee_test.go) - not executed here | — |
| RST-UAT-0308 | Validate translated or long text fallback | P1 | Core | In Scope | Pass | Unicode (Yoruba diacritics, Arabic, CJK, emoji, 300 chars) in search: no page error, hub still renders | — |
| RST-UAT-0309 | Choose marketing consent independently | P1 | Conditional | In Scope | Fail | Source scan of app/(auth), app/food, src/features/food, app/profile, app/(tabs): no marketing-consent control or promo opt-out | FOOD-UAT-H-001 |
| RST-UAT-0310 | Withdraw promotional consent | P1 | Conditional | In Scope | Fail | Source scan of app/(auth), app/food, src/features/food, app/profile, app/(tabs): no marketing-consent control or promo opt-out | FOOD-UAT-H-001 |
| RST-UAT-0311 | Verify transactional messaging unaffected | P1 | Conditional | In Scope | Blocked | Depends on consent model (H-001) | FOOD-UAT-H-001 |
| RST-UAT-0316 | Require jurisdiction-specific mandatory documents | P0 | Core | In Scope | Blocked | Needs owner session on /food/restaurant/kyb with jurisdiction config | — |
| RST-UAT-0317 | Handle permit expiry and compliance hold | P0 | Core | In Scope | Fail | KYB code (backend/internal/restaurant/kyb*.go) has `food_hygiene` doc type but no permit expiry / compliance-hold logic | FOOD-UAT-H-002 |
| RST-UAT-0318 | Make meal allergy information visible | P0 | Core | In Scope | Blocked (env) | Spec authored; /food never reached within helper 10s `Explore Services` / `Mama Cass` timeouts (host load avg 150-350). Re-run on idle host. Source shows 11 a11y attrs in restaurant/[id].tsx and "Nutrition & allergens" toggle (not a pass). | — |
| RST-UAT-0319 | Report food safety incident | P0 | Core | In Scope | Blocked | Needs completed-order fixture; food dispute types are non_delivery/wrong_item/no_show/other only | FOOD-UAT-H-003 |
| RST-UAT-0320 | Deactivate idle provider mode | P0 | Core | In Scope | Blocked | Needs provider session / obligation fixtures; no deletion endpoint under /api/finance/restaurant | — |
| RST-UAT-0321 | Prevent closure while financial obligation unresolved | P0 | Core | In Scope | Blocked | Needs provider session / obligation fixtures; no deletion endpoint under /api/finance/restaurant | — |
| RST-UAT-0322 | Request customer account deletion with provider role | P0 | Core | In Scope | Blocked | Needs provider session / obligation fixtures; no deletion endpoint under /api/finance/restaurant | — |
| RST-UAT-0323 | Prevent resurrection from stale token | P0 | Core | In Scope | Pass | Expired/invalid bearer on /mine, /earnings, /withdrawals -> 401. Post-deactivation (valid JWT, revoked role) layer Blocked | — |
| RST-UAT-0324 | Reflect profile across customer/merchant modes | P1 | Core | In Scope | Blocked | Deferred (requires multi-session fixture harness) | — |
| RST-UAT-0325 | Reflect menu across owner web and mobile | P0 | Core | In Scope | Blocked | Deferred (requires multi-session fixture harness) | — |
| RST-UAT-0326 | Prevent double rider pickup from two devices | P0 | Core | In Scope | Blocked | Deferred (requires multi-session fixture harness) | — |
| RST-UAT-0327 | Reflect payment result after app switch | P0 | Core | In Scope | Blocked | Deferred (requires multi-session fixture harness) | — |
| RST-UAT-0328 | Detect suspicious rapid merchant upgrade attempts | P0 | Core | In Scope | Blocked | Needs authed customer/2 rider tokens + fixtures | — |
| RST-UAT-0329 | Prevent forged order fulfillment | P0 | Core | In Scope | Blocked | Needs authed customer/2 rider tokens + fixtures | — |
| RST-UAT-0330 | Reject altered discount and delivery fee | P0 | Core | In Scope | Pass | PlaceOrderRequest has no discount/delivery_fee/total fields (server-derived; tip clamped); anon POST with forged fields -> 401. Authed forged-field probe Blocked | — |
| RST-UAT-0331 | Block payout to unverified beneficiary | P0 | Core | In Scope | Pass | Anon POST /withdrawals, /bank-accounts, PATCH default-account -> 401. Beneficiary-swap-before-transfer logic Blocked (needs owner token) | — |
| RST-UAT-0332 | Detect refund plus chargeback double credit | P0 | Core | In Scope | Blocked | No chargeback ingestion found in backend/internal/restaurant (only finance/maplerad); frontend-web Paystack webhook not checked | FOOD-UAT-H-004 |

## Cross-role journeys (EEJ)

| ID | Title | Priority | Status | Evidence | Defect |
|---|---|---|---|---|---|
| EEJ-01 | Customer→Merchant Upgrade | P0 Core | Pass (smoke) | Food hub shows "Sell food on Paymax"; /food/restaurant/kyb loads; admin /admin/restaurant/onboarding redirects (auth gate). Register→KYB→approve→publish state transitions not executed (no real accounts). | - |
| EEJ-02 | Customer→Rider Upgrade | P0 Core | Pass (smoke) | /food/rider loads; admin dispatch gated. Upgrade/approve/online not executed. | - |
| EEJ-03 | Role switching and simultaneous provider statuses | P0 Cond | In-Scope - Deferred (requires multi-session fixture harness) |  | FOOD-UAT-H-005 |
| EEJ-04 | Restaurant launch | P0 Core | Blocked (env) | Spec authored (owner console + customer browse); Mama Cass wait timed out under load | FOOD-UAT-H-006 |
| EEJ-05 | Normal paid delivery | P0 Core | Blocked (env) | Spec authored (browse→store→checkout→orders); timed out under load. Payment/POD never in scope of smoke | FOOD-UAT-H-006 |
| EEJ-06 | Owner unavailability / store rejection | P0 Core | In-Scope - Deferred (requires multi-session fixture harness) |  | FOOD-UAT-H-005 |
| EEJ-07 | Pickup without rider | P0 Core | Blocked (env) | Spec authored (checkout pickup option presence); timed out under load | FOOD-UAT-H-006 |
| EEJ-08 | Dispatch contention / recovery | P0 Core | In-Scope - Deferred (requires multi-session fixture harness) | | FOOD-UAT-H-005 |
| EEJ-09 | Payment uncertain but eventually successful | P0 Core | In-Scope - Deferred (requires multi-session fixture harness) | | FOOD-UAT-H-005 |
| EEJ-10 | Item out of stock at checkout | P0 Core | In-Scope - Deferred (requires multi-session fixture harness) | | FOOD-UAT-H-005 |
| EEJ-11 | Customer refund after completed delivery | P0 Core | In-Scope - Deferred (requires multi-session fixture harness) | | FOOD-UAT-H-005 |
| EEJ-12 | Merchant and rider payout | P0 Core | In-Scope - Deferred (requires multi-session fixture harness) | | FOOD-UAT-H-005 |
| EEJ-13 | Payout provider outage and recovery | P0 Core | In-Scope - Deferred (requires multi-session fixture harness) | | FOOD-UAT-H-005 |
| EEJ-14 | Cross-tenant and role abuse | P0 Core | In-Scope - Deferred (requires multi-session fixture harness) | | FOOD-UAT-H-005 |
| EEJ-15 | Rider offline / no available couriers | P0 Core | In-Scope - Deferred (requires multi-session fixture harness) | | FOOD-UAT-H-005 |
| EEJ-16 | Provider compliance expiry | P0 Core | In-Scope - Deferred (requires multi-session fixture harness) | | FOOD-UAT-H-005 |
| EEJ-17 | Multi-branch delivery | P0 Cond | In-Scope - Deferred (requires multi-session fixture harness) | | FOOD-UAT-H-005 |
| EEJ-18 | Dine-in QR shared bill | P1 Cond | In-Scope - Deferred (requires multi-session fixture harness) | | FOOD-UAT-H-005 |
| EEJ-19 | Reservation and no-show | P1 Cond | In-Scope - Deferred (requires multi-session fixture harness) | | FOOD-UAT-H-005 |
| EEJ-20 | COD reconciliation | P0 Cond | In-Scope - Deferred (requires multi-session fixture harness) | | FOOD-UAT-H-005 |
| EEJ-21 | Offline device disruption | P0 Core | In-Scope - Deferred (requires multi-session fixture harness) | | FOOD-UAT-H-005 |
| EEJ-22 | Closure retaining financial records | P0 Core | In-Scope - Deferred (requires multi-session fixture harness) | | FOOD-UAT-H-005 |

## Defects

### FOOD-UAT-H-001 (Major) — No marketing-consent capture or promo opt-out
Repro: scan `mobile-app/reactnative/app/(auth)`, `app/food`, `src/features/food`, `app/profile`, `app/(tabs)` for marketing consent / unsubscribe controls (spec RST-UAT-0309/0310 fails). Expected: independent promotional-consent choice at registration and a withdrawal control; transactional messages unaffected (0311). Actual: none found. Cases: 0309, 0310, 0311.

### FOOD-UAT-H-002 (Major) — No permit-expiry / compliance-hold handling for restaurants
Repro: read `backend/internal/restaurant/kyb.go`, `kyb_documents.go`. A `food_hygiene` document type exists but no expiry date, scheduled review, or store hold on expiry. Expected (0317, EEJ-16): expired permit triggers compliance hold blocking new orders. Actual: no such logic found.

### FOOD-UAT-H-003 (Minor) — No food-safety incident category
`foodDisputeTypes` in `backend/internal/restaurant/disputes_service.go` = non_delivery, wrong_item, no_show, other. Case 0319 expects a distinct food-safety incident report; only generic `other` is available.

### FOOD-UAT-H-004 (Major, needs confirmation) — No chargeback ingestion for restaurant payments
`chargeback` appears only in `backend/internal/finance/maplerad`; not in `backend/internal/restaurant` or `paystackcheckout`. The frontend-web Paystack webhook (live handler per CLAUDE.md) was not inspected here. Case 0332 (refund + chargeback double credit) cannot be demonstrated until confirmed.

### FOOD-UAT-H-005 (Process) — Multi-session fixture harness missing
Journeys EEJ-03, 06, 08-22 and cases 0324-0329 need concurrent customer/owner/rider/admin sessions with seeded real tokens. Tracking item for harness build.

### FOOD-UAT-H-006 (Environment) — UI cases not executed under host saturation
Load average 150-350 from concurrent agents; `loginAs` 10 s `Explore Services` wait and `Mama Cass` waits timed out for 0284, 0295-0298, 0305, 0318, EEJ-04/05/07. Re-run on idle host with `H_WARM=1` (spec pre-warms Metro). Not a product defect.

## Notes
- Non-UI cases run in under 2 s and are reproducible: `npx playwright test tests/e2e/food-uat/cluster-h-nfr-journeys.spec.ts --project=desktop-chrome --workers=1`.
- Without `--project`, the config runs every spec twice (mobile-chrome and desktop-chrome).
- Backend routes live under `/api/finance/restaurant/*` (customer/owner/rider) and `/api/restaurant/admin/*` (admin); `/api/v1/restaurant*` returns 404.

## Phase 5 Wave 1 verify — FOOD-UAT-H-004

Question: is there any chargeback / dispute / refund-event ingestion for restaurant (`foodorder-`) Paystack payments?

Evidence (static read):
- `frontend-web/app/api/webhooks/paystack/route.ts:67-75` is a pure dispatcher (`Promise.allSettled` over 7 handlers); it contains no event-type switch and no chargeback/dispute/refund branch.
- Every Next handler gates on `charge.success` or `transfer.*` only: `wallet/webhook.ts:40`, `virtual-accounts/webhook.ts:44`, `utility-handler.ts:30`, `gateway-handler.ts:161` (`!== 'charge.success'`), `bank-webhook.ts:66` (`startsWith('transfer.')`), `voting/payment/webhook.ts:75,107` (`charge.failed|abandoned`, `!== 'charge.success'`). Any other event returns `{processed:false}` and the route answers 200.
- `go-forward.ts:14,41-43` forwards only `event === 'charge.success'` with a `foodorder-` (etc.) reference to Go. A `charge.dispute.*` / `refund.processed` event for a food order is never forwarded.
- Go receiver `backend/internal/webhooks/webhooks.go:297-305` switch handles exactly `charge.success`, `transfer.success`, `transfer.failed`, `transfer.reversed`. No default branch; unknown events fall through to `200 {"ok":true}` (silent ack).
- `backend/internal/provider/paystack/paystack.go:444-450` normalizer maps only transfer.* and charge.success; default is `Type:"", Status:"pending"`.
- `grep -rn -i 'refund.processed|charge.dispute|charge.chargeback|dispute.create' backend frontend-web/{app,src}` (non-test): zero hits. The remaining "chargeback" hits are unrelated: academy risk view (`academy/platform/repo.go:244`), maplerad payout reversal (`finance/maplerad/model.go:207`), crowdfunding admin report (derived from rejected refunds), and voting `payment_status='chargeback'` enum (no writer from Paystack events).
- No ledger reversal or food-order state change is reachable from a chargeback event, so the ADR-040 reversal-on-chargeback path does not exist.

Verdict: **CONFIRMED — no chargeback ingestion anywhere** (not a no-op branch; the event types are simply absent at every layer and are acked 200 and dropped).

Fix site: add `charge.dispute.create|resolve` and `refund.processed` cases to `backend/internal/webhooks/webhooks.go:297` switch, extend `go-forward.ts:41-43` to forward those events for `foodorder-` references, and post a reversing ledger pair plus food-order status update in a new handler (idempotent on the dispute id).
