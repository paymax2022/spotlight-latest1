# Restaurant 332-case UAT — Phase 4 consolidation summary

**Date:** 2026-10-20  |  **Scope:** second deep pass against the Food module (prior sign-off 2026-09-17 against 33-case plan still stands).

## Headline

- **8 clusters executed in parallel** (A–H), covering ~333 case rows + 22 cross-role journeys.
- **~90 raw defects drafted**; after dedup and discrediting a code-read artifact, **~85 unique findings**.
- **Prior sign-off invariants all re-proven** via Cluster F's live SQL: FOOD-003/008/009/010 and ADR-040 ledger conservation (6,632 food ledger entries net to exactly 0).
- **4 Blockers surfaced, all unverified live**. The harness that gated A/C/parts-of-D/E was fixed mid-pass (details below) but the Blocker rows themselves were authored before and still rest on code reads.

## Case-by-case roll-up

| Cluster | Scope | UAT-doc lines | Cases attempted | Pass | Fail | Blocked | N/A | Deferred | Defects drafted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | Identity/RBAC/Upgrades | 377–1160 | 63 | 1 | 13 | 37 | 12 | — | 14 |
| B | Store/Catalog | 1161–1664 | 40 | 15 | 8 | 3 | 14 | — | 10 + 1 env |
| C | Discovery/Cart/Pricing | 1665–2056 | 31 | 13 | 14 | 1 | 3 | — | 13 |
| D | Checkout/Payment/Lifecycle | 2057–2480 | 34 | 18 | 7 | 1 | 3 | 5 | 8 |
| E | Dispatch/Rider/Tracking | 2481–3104 | 50 | 11 | 17 | 3 | 19 | — | 15 |
| F | Money/Disputes/Payouts | 3105–3528 | 34 | 22 | 1 | — | 4 | 7 | 11 |
| G | Admin/Reports/Reviews | 3529–3868 + 4277–4328 | 32 | 7 (+2 API-only) | 7 | 4 | 2 | 1 | 13 |
| H | NFR + 22 journeys | 3869–4772 | 49 + 22 EEJ | 7 (+2 j) | 3 | 39 | — | 17 EEJ | 6 |

**Verification quality legend:**
- **Live-executed (real HTTP + SQL):** B, F (fully), G (admin APIs via cached JWT), D (back half), parts of E.
- **Route-mocked UI:** E (customer + rider screens against stateful mocks of the Go API).
- **Code-read only:** A (entirely), C (entirely), parts of H.

## Blockers (4) — require live reproduction before any remediation lands

All four are from code reads only. Before Phase 5 touches product code, each must be either reproduced live or discarded.

| ID | Cluster finding | Verification task |
| --- | --- | --- |
| **FOOD-UAT-D-001** | Order status transition is not compare-and-set — parallel accepts both succeed; accept-racing-cancel can overwrite refunded `cancelled` back to `preparing`. | Fire two concurrent `PATCH /api/finance/restaurant/orders/:id/status` on one order from different goroutines; assert exactly one 200. Also drive `UPDATE … WHERE id=$1 AND status=$prior` to prove whether the SQL is already atomic. |
| **FOOD-UAT-D-002** | `SweepUnacceptedOrders` service exists but has no scheduler and no admin route — a paid, unaccepted order sits in escrow until the customer cancels. | `grep -rn "SweepUnacceptedOrders" backend/` to confirm no caller; create a paid order; wait past the SLA window; assert it is NOT auto-cancelled. |
| **FOOD-UAT-D-005** | Card payment process-death-after-claim-before-resolve strands the intent in `processing`. **Flag OFF today** (`FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED` = false). Also, gateway currency never compared. | Lower urgency unless the flag is flipping soon. If so: simulate a kill between claim and resolve via a probe; assert sweep/webhook retry recovers. |
| **FOOD-UAT-E-018** | Rider console wire contract mismatch — `/rider/offers` returns `{"offers":[Order]}` but the client expects `Order[]`; `/rider/active` returns `{"deliveries":[...]}` but the client expects a single object. Hidden locally because food mock defaults ON. | `curl -H 'Authorization: Bearer <rider-jwt>' http://127.0.0.1:8080/api/finance/restaurant/rider/offers` and compare to `src/features/food/*` TypeScript types. Flip `EXPO_PUBLIC_FOOD_USE_MOCK=false` in a throwaway Metro to prove whether the rider screen renders. |

## Confirmed cross-cluster duplicates (dedup pass)

| Canonical | Also seen as | Resolution |
| --- | --- | --- |
| **F-001** admin disputes queue 500 (uuid-vs-text join) | G-001 | One finding, two independent proofs — strongest signal. Keep as F-001. |
| **A-003** restaurant admin decisions write no audit event | G-004 (merchant approve/reject no audit) | Same iron-rule violation (CLAUDE.md requires audit on every money/role mutation). Keep A-003. |
| **A-001** rider suspend doesn't reassign in-flight delivery | G-010 (no admin rider suspend/pause) | A-001 is the deeper issue (suspend path exists but doesn't reassign); G-010 is the admin UI gap. Treat as **two linked findings**, not a dupe. |
| **D-004** order notes/modifiers never reach kitchen (food-safety) | H-003 (no food-safety dispute category) | Different surfaces — D-004 is pre-order, H-003 is dispute-time taxonomy. Linked, not duplicate. |
| **B-009** opening hours/holiday closures/timed-pause unreachable | prior FOOD-011 (modifier groups unreachable) | Same **class** of defect ("backend complete, no route") but different features. Keep both; cite the pattern. |

## Discredited by live evidence

**FOOD-UAT-A-004** — "Approval allowed with no KYB submission or evidence" (code read). **Discredited by Cluster F live SQL** (case 0154 live-proved `is_open=true` requires `kyb_status='approved'`, and payout batch excludes unapproved restaurants). The pre-sign-off FOOD-003 and FOOD-010 fixes are intact. A-004 is **either (a) a stale code read against an older branch, or (b) reporting a different sub-path (direct DB update bypassing `AdminDecideApplication`)**. Must be re-walked against current `backend/internal/restaurant/admin_repo.go:215` before promoting.

## Major defects (33 unique after dedup)

Grouping for Phase 5 fix clusters. Each row below is an independent fix target (does not share files with any other row in the same group).

### Group M1 — Admin money/audit (3 fixes, no file overlap)
- **F-001 / G-001**: admin dispute queue 500 (uuid=text join). Fix in `handler_admin.go` + migration if column type changes. Smallest + safest first.
- **A-003 / G-004**: no audit event on merchant admin decisions. Fix: emit `audit_events` row from `AdminDecideApplication` and the admin force-open/close path.
- **G-013**: admin console `:3001` login never hydrates. **Verify stale dev-server first** (agent flagged possible env issue).

### Group M2 — Rider lifecycle & dispatch (6 fixes, overlapping transport/restaurant files — serial)
- **E-018** rider API wire contract (biggest impact; verify live first)
- **A-001** suspend doesn't reassign in-flight
- **A-013** rider approval ignores licence expiry
- **E-003** sweepers dead code (offers never expire)
- **E-002** AcceptDelivery no online/cap re-check
- **E-004** re-dispatch starvation

### Group M3 — Customer discovery/cart (independent files from M1/M2)
- **C-001** dish search missing
- **C-003** no serviceability zone/radius
- **C-004** unapproved store reachable + orderable
- **C-005** no modifier UI
- **C-007** no client price quote; pay-sheet omits service fee/surge
- **C-008** order notes not capturable in mobile
- **C-011** no promo code entry
- **C-012** delivery coordinates not persisted
- **C-013** invalid lat/lng accepted

### Group M4 — Store catalog admin (independent)
- **B-001** store update accepts blank name/address
- **B-002** payout bank add no step-up/audit
- **B-003** `is_verified` never enforced on withdrawal
- **B-004** prep-time PATCH silently ignored
- **B-007** dietary/allergen tags unreadable
- **B-009** hours/closures/pause unreachable

### Group M5 — Order lifecycle (independent)
- **D-001** order status not compare-and-set (verify live first)
- **D-002** SweepUnacceptedOrders unscheduled (verify live first)
- **D-003** reject-with-reason unrouted
- **D-004** order notes/modifiers never reach kitchen (food-safety)
- **D-006** staff role permissions never checked
- **D-007** pickup mode absent

### Group M6 — Compliance / consent (independent)
- **H-001** no marketing consent/opt-out
- **H-002** no permit-expiry / compliance-hold
- **H-004** no chargeback ingestion (**verify first** — agent didn't inspect frontend-web Paystack webhook)

### Group M7 — Admin reporting (independent)
- **G-003** no review mod routes
- **G-006** no admin order event history/trace
- **G-007** no exports / GMV dashboard

### Group M8 — Rider feedback & tracking
- **E-008** pickup/delivery code brute-forceable (security)
- **E-011** MarkDeliveryFailed unrouted
- **E-012** rider map uses server-stale location

## Known accepted exceptions (not re-raised)

- **FOOD-006** no customer-facing withdrawal UI (prior sign-off; feature gap, not money-unsafe as shipped)
- **FOOD-007** disburser bank-field population latent (no live provider wired)
- **FOOD-011** modifier groups unreachable (prior sign-off; same class as B-009 and H-002)

Explicit reference citations in Cluster F doc, cases 0239 / 0240 / 0243. Not re-logged.

## Minor defects / feature gaps (counted, not expanded)

- A-007..014 (minor gaps + feature holes in identity/KYB UX)
- B-005, B-006, B-008, B-010 (minor backend/validation gaps)
- C-002, C-006, C-009, C-010 (minor UX)
- D-008 (prep-time stale)
- E-001, E-005, E-009, E-013, E-014 (minor dispatch/tracking)
- F-007, F-009, F-010 (minor dispute UX)
- G-002, G-005, G-008, G-009, G-012 (minor admin UX)
- H-003 (dispute category)

Phase 5 defers minors until all Blockers + Majors close.

## Harness fixes landed this pass (test infrastructure, not product code)

- `tests/e2e/helpers/auth.ts` — added `paymax_secure_sb-localhost-auth-token` seed (previously only `sb-127` and `sb-wnicsubiznmishkmunsv`, neither matched the live Metro's `.env.development.local` Supabase URL). Widened home-anchor expect timeout to 30s.
- `tests/e2e/helpers/common.ts` — pre-stubbed 6 extra 401-prone home-grid endpoints (events, placements, banners, wallet balance, utility_transactions) so a trailing 401 can't sign the test session out mid-flow.

Verified live: baseline `tests/e2e/modules/food.spec.ts` test 1 (home grid) now PASSES.

## Side effects left in local environment

- 3 fixture restaurants from Cluster B: `UAT-B Store`, `UAT-B Outlet 2`, `UAT-B Probe (legacy)` (owner `qa-claude-test`).
- 9 `restaurant_withdrawals` rows from Cluster F (3 still `processing`).
- 13 `payment_intents` stuck in `processing` from Cluster D's Go claim test (not real signal).
- Restaurant `a7da21ac-4e74-4024-b546-f3da349dc19c` was approved+restored by Cluster G.
- Restaurant `88c613ab-9dfc-49cf-a4b7-1a51f23310b2` ("Test Kitchen Update") got `is_open:false` (prior value not recorded — operator check).
- User `uat-g-fixed@example.test` left in place for reuse.

Cleanup belongs with Phase 5 or a dedicated local-DB tidy task.

## Infra / env findings (not product defects)

- **ENV-B-001**: `:8080` Go API container predates PR #807; store-image presign returns 404. Rebuild the container to re-run Cluster B's blocked cases.
- **FOOD-UAT-G-013**: admin console at `:3001` login form never hydrates — likely stale `npm run dev`; may clear with a restart. Not a product bug until confirmed otherwise.
- **FOOD-UAT-H-005**: multi-session fixture harness missing — blocks 15 of 22 EEJ cross-role journeys. Design gap, not a product bug.
- **FOOD-UAT-H-006**: UI cases in H timed out at host load 150–350 while the whole swarm hammered Metro. Fix is `H_WARM=1` prewarm + `--project=desktop-chrome` + staggered runs.

## Phase 5 plan

1. **Blocker live-verify** — 4 parallel probes against the live backend to confirm (or discredit) D-001, D-002, D-005, E-018 before any product-code touches.
2. **Rediscover A-004** — walk the actual admin approval path against current source and reconcile with Cluster F's live proof.
3. **Group M1–M8 fix swarm** — once blockers triaged, dispatch independent fix agents per group (files don't overlap, so parallel is safe within a group but not across — see group notes).
4. **UI live-rerun for A/C** — now that the harness unlocks `/home` and `/food`, re-execute every A/C `Fail` row that was authored from code only. Many will dissolve; the surviving ones become real defects.

## Status for Module Completion Gate

**Module 12 — Food — Previously signed off ✅ for 33-case plan on 2026-09-17. This 332-case deep pass is NOT CLOSED.** Prior invariants hold. ~85 new findings are drafted. Minimum work remaining before this module can re-sign-off:
- Live-verify 4 Blockers
- Discredit or confirm A-004
- Close every Blocker + Major from Groups M1–M8 (or document explicitly accepted exceptions)
- Clean local-DB test leftovers listed above

## Phase 5 close-out

**Date:** 2026-10-20. Remediation code landed across Waves 1–9; live verification and two operator decisions remain.

### Final case roll-up (before Wave 2 vs after Wave 9)

**All "after" figures are ESTIMATES.** The clusters were not re-executed end-to-end after remediation; "after" is derived from the before counts by assuming each Fail row whose defect has a Phase-5 commit now passes, and leaving Blocked unchanged (the A-cluster Blocked rows should be partly unlocked by `ff796d282` deterministic test OTP, but that has not been re-run). The W9-SPEC-FIX dissolved-case list was not available when this was written; reconcile when it lands.

| Cluster | Fail before | Fail after (est.) | Blocked before | Blocked after (est.) | Pass before | Pass after (est.) |
| --- | --- | --- | --- | --- | --- | --- |
| A | 13 | ~2 | 37 | ≤37 (unrerun) | 1 | ~12 |
| B | 8 | ~4 | 3 | 3 | 15 | ~19 |
| C | 14 | ~5 | 1 | 1 | 13 | ~22 |
| D | 7 | ~2 | 1 | 1 | 18 | ~23 |
| E | 17 | ~8 | 3 | 3 | 11 | ~20 |
| F | 1 | 0 | — | — | 22 | ~23 |
| G | 7 | ~3 | 4 | 4 | 7 | ~11 |
| H | 3 | ~1 | 39 | 39 (unrerun) | 7 | ~9 |

### Phase 5 commits

| Commit | Scope | Defects closed |
| --- | --- | --- |
| `64ba29026` | Compare-and-set order transitions, reject-reason | D-001 (Blocker), D-003, new MarkDeliveryFailed race |
| `cfaf15b33` | Admin backend | F-001≡G-001, A-003≡G-004, G-005 |
| `c3c5ebc95` | Rider API shape | E-018 (Blocker) |
| `0558fdb17` | Chargeback pipeline | H-004 |
| `26af6e320` | Review mod, duplicate honesty, notif fallback | G-002, G-003, G-012 |
| `3eaf21de0` | Store catalog validation, dietary tags | B-001, B-004, B-005, B-007, B-010 |
| `19c3c1234` | Rider lifecycle + GPS | A-001, A-013, E-011, E-012 |
| `385def122` | Validation, security, staff perms | C-013, D-006, E-008 (partial) |
| `10817f260` | Sweepers + dispatch guards | D-002 (Blocker), E-003, E-004 |
| `a43b337bf` | Money hardening | F-004, F-010 (B-003 likely covered) |
| `ff796d282` | Deterministic test OTP | Unlocks A signup Blocked rows |
| `95fe18ac6` | Wave 4 follow-ups, review test | E-002, E-008 wiring, FOOD-UAT-WAVE5-FOLLOWUP-001 |
| `892421683` | Admin commission, two-tier refund | F-003, F-002 |
| `a7d244ba7` | Dual-approval payouts, consent, permit expiry | G-011, H-001, H-002 |
| `35e0b9ce1` | Order data, pickup/dine-in backend | C-012, C-008, D-007 (backend) |
| `5d975f5dc` | Promo + quote endpoints | C-011, C-007 (backend) |
| `1ec0cb9d8` | Dish search, serviceability zones | C-001, C-003 |
| `9ca013226` | KYB UX minors | A-005, A-007..A-012 (A-010 Option A), A-014 |
| `76bb39660` | Modifier UI, quote pay-sheet, promo entry | C-005, C-007, C-011 (mobile) |
| `51c5c803b` | Pickup/dine-in mobile intake | D-007 (mobile UX) |
| `e05da5b8a` | Admin dashboards | G-006, G-007 |

Discredited: **A-004** (narrowed to Minor policy advisory by V4 live SQL). Env-only: **G-013** (Next 16 `allowedDevOrigins` mismatch). D-005 intentionally Open (flag OFF).
Uncommitted at close-out and therefore NOT credited: W7-POLISH, W8-QUOTE-INTEGRATION, W9-MODIFIERS, W9-SPEC-FIX.

### Still-open items (no commit mapping)

**Blocker:** D-005 (card-rail process-death stranded intent; flag OFF, fix before flag flips).
**Major / Major-ish:** A-002 (no separation of duties on approvals), A-006 (no merchant suspend/revoke; owner can reopen admin-closed store), B-002 (bank add no step-up/audit), B-009 (hours/closures/pause unreachable; may be addressed by uncommitted W7-POLISH), C-004 (unapproved store reachable and orderable), D-004 (notes/modifiers to kitchen: capture landed in `35e0b9ce1`, kitchen-display leg unconfirmed), G-010 (admin rider suspend UI).
**Minor / feature gaps:** A (none beyond above), B-006, B-008, C-002, C-006, C-009, C-010, D-008, E-001, E-005, E-009, E-010, E-013..E-017, F-005, F-005b, F-006..F-009, F-011, G-008, G-009, H-003.
**Process / env:** H-005 (multi-session harness), H-006 (host load), ENV-B-001 (rebuild `:8080` container), local-DB test leftovers listed above.

### Verification gaps pending real sign-off

1. Migration chain-replay on an isolated DB.
2. Full `go test -race` clean run against a clean DB.
3. Live admin-portal 403 curl checks (non-admin against the new admin routes).
4. Metro live-UI drive of the modifier sheet (plus UI re-run of previously code-read A/C rows).

### Outstanding user confirmation

W6-D's handler swap to `AdminDecideApplicationChecked` on `/onboarding/:id/:decision` has not been confirmed by the user.

### Outstanding operational note

H-002 permit-backfill rollout: existing restaurants have `permit_expires_at IS NULL`; without W7-POLISH's backfill route (`permit_backfill.go`, uncommitted) or a data script, every store becomes un-openable at deploy.

**Module 12 — Food — NOT YET re-signed-off. Prior 33-case sign-off (2026-09-17) still stands for its narrower scope. Reaching 332-case sign-off requires the four verification gaps above to be closed and operator decisions on W6-D handler swap + H-002 rollout.**
