# Cluster Stays-B — Money + Ops lane (REQ-PAY/OPS/MOD/COM/FIN/ADM/SEC/INT/NFR, 186 cases)

Run date: 2026-10-21. Branch `uat/stays-b` @ f0816a2c4. Spec evidence: `go test ./internal/stays/...` (non-live + TEST_DATABASE_URL live-DB suites against shared local Supabase :54322).

## Module map

- **Booking saga** `backend/internal/stays/reservation/` — prebook→hold(wallet escrow)→book→charge(settle split)→release. States: SEARCHING→…→CONFIRMED→COMPLETED; CANCELLED_BY_GUEST/HOTEL, NO_SHOW, VOID. Idempotent on Idempotency-Key + supplier_ref.
- **Supply rail** `adapters/direct.go` — only DIRECT rail wired (own inventory). Row-locked per-night allotment decrement (oversell-impossible), idempotent decrement ledger, policy-snapshot refund math.
- **Hotelier extranet** `extranet/` — object-scope grants (stays_hotelier_profile), arrivals/departures/in-house, no-show, hotel cancel, staff, KYB queue, photos, messaging (host+now guest), payouts/commission/analytics.
- **Settlement** `settlement/` — hotel payouts (HELD→PAID to hotelier wallet from provider_clearing; completed-stay + cancel-wedge gates + clawback), commission accrual/reversal, supplier remittance recon (MATCHED/BREAK).
- **Admin** `admin/` — dashboard aggregates, property moderation, mapping queue, suppliers; settlement/review/KYB admin routes; + new admin force-cancel.
- **Supplier webhooks** `supplierwebhooks/` — HMAC-verified, deduped, FSM-guarded inbound state sync.
- **Reviews** `reviews/` — verified-guest (COMPLETED) gate, one-per-booking, hotelier response, flag/moderate, PII auto-flag.
- **Disputes** — generic `finance/disputes` + new `reservation.DisputeResolver` wired via `WithStaysResolver` (real refund legs).
- **BFF** `frontend-web/app/api/v1/stays/[...path]` + `/extranet/[...path]` proxies; admin console `frontend-admin/app/admin/stays/*` (~20 pages); mobile `app/stays/**` + `src/features/{stays,stayshotelier}`.
- **Flag** `FEATURE_STAYS_ENABLED` (default off) gates all routes; BFF returns 503 when off.

## Per-REQ results

| REQ | Cases | Implemented/works | Partial | Missing/Gaps | Notes |
|---|---|---|---|---|---|
| PAY | 25 | 11 pass (decline→void, auto-release, webhook dedup/OOO/HMAC, tamper-proof, idem book, fee split, currency fail-closed, refund once/partial/retry, token TTL) | 4 (multiroom model, voucher-not-invoice, no expiry sweeper, remittance-only recon) | 3 gateway rails (transfer/card/VA — shared_platform D005), deposit D002, staged-pay n/a | Wallet-funded rail only; money invariants proven live-DB |
| OPS | 22 | 2 (arrival manifest, no-show+cutoff fix) | 2 (dispute link, emergency info fields) | 12 — **check-in/out, room assign, housekeeping, turnover, damage (D001 S2)**, deposit (D002), opt-out/scheduled comms | Biggest gap cluster; pending migration authored |
| MOD | 21 | 11 (cancel full/penalty/nonref, modify ±delta, soldout refuse, hotel cancel, admin cancel fix, post-payout refund residual, extension-conflict, prebook void fix, policy snapshot fix) | 6 (in-stay cancel, extension approval step, occupancy cap-by-absence, no-show policy-blind D004, eventual-consistency) | 4 (occupancy modify, merchant-proposed change, request-to-book D011, relocation) | Refund machinery is excellent; ops-level nuance missing |
| COM | 18 | 9 (reviews gate/one-per/merchant-response/moderate, messaging thread+guest routes, PII auto-flag, dispute resolve refund) | 6 (notify unwired D003, open-ownership D009, opt-out, dedupe/failure queue, pre-booking inquiry) | 3 (merchant dispute response D006, emergency escalation, notify sinks) | Dispute resolve FOOD-004 shape closed for stays |
| FIN | 21 | 8 (earnings feeds, payout eligibility gates, idempotent payout, negative-balance residual, hold, cross-tenant deny, immutability, admin-release RBAC, non-retroactive commission) | 10 (wallet-rail payout vs bank, no statement/export/invoice, single commission constant D007, dispute-hold flag, tax config) | 3 (deposit liability D002, chargeback n/a, bank validation n/a) | Payout correctness strong; bank-transfer leg is platform wallet rail |
| ADM | 21 | 12 (dashboard, KYB queue+decision, moderation, suspend, reservation search, admin force-cancel fix, ledger immutability, RBAC deny, takedown) | 6 (refund-approval tiers D008, dispute merchant-side D006, audit sink unwired D003, export, lock/appeal partial, TZ) | 3 (policy config D007, bulk moderation, fee schedule) | Admin surface is broad; config + audit persistence thin |
| SEC | 22 | 12 (object-scope on property/availability/bookings/guest/uploads/refunds, self-approve impossible, RBAC per-request, session fail-closed, webhook dedup, param queries) | 9 (XSS render, CSRF web layer, masking logs, step-up bank n/a, suspended-user check shared, retention, TLS, antivirus, KYC-doc surface) | 1 (erasure path) | Object-level authZ is uniformly enforced |
| INT | 18 | 3 (provider-down void, offline retry idem, webhook backlog dedup) | 9 (graceful maps degradation, notify outage, KYC manual queue, bank-validation n/a, stale-search re-quote, ledger recon, crash-safe legs, push delay, job rerun) | 2 (export job, support handoff) | OTA cases n/a (conditional, uncontracted) |
| NFR | 18 | 3 (durability-by-construction, kobo integers, feature flag) | 15 mostly NEEDS_MANUAL (perf/load/a11y/device/browser) | 1 (retention job) | Nonfunctional mostly unmeasurable in lane |

## Fixes landed this lane (uat/stays-b)

1. `adapters/direct.go` — book_token v2 binds TTL; `ErrBookTokenExpired` refused at Book → auto-release (PAY-011). Tests: `TestBookTokenExpiryEnforced`.
2. `adapters/direct.go` — `refundable` injected into the policy snapshot (MOD-020); snapshot now beats a live plan edit.
3. `adapters/direct.go` — free-cancel deadline eval: `free_cancel_deadline_at` / `free_cancel_hours_before_checkin` (MOD-002). Test: `TestComputePolicyRefundCutoff`.
4. `extranet/repository.go` — MarkNoShow requires `check_in <= CURRENT_DATE` (OPS-009 cutoff); live fixture updated.
5. `reservation/service.go` — guest cancel of unpaid prebook states → VOID (MOD-013).
6. `extranet/{service,handler,repository}.go` + `app/stays_routes.go` — member-side reservation messaging (COM-003/004/005).
7. `extranet` + admin route — `POST /api/stays/admin/reservations/:id/cancel`, `stays.admin.reservation` guard (MOD-011/ADM-012).
8. `reservation/dispute_resolver.go` + `finance/disputes` + `finance_routes.go` — stays dispute resolve posts real capped refund legs (COM-016/ADM-009/011) — shared-file diffs kept minimal.
9. `reviews/service.go` — PII-shaped review content auto-flags to moderation (COM-018).

## Defects — see defects-stays-b.csv (12 recorded)

S2: D001 ops-fulfillment absent; D002 deposit absent — pending migration covers both. S3: D003 notify/audit sinks unwired; D004 no-show policy-blind; D005 card/transfer rails (shared_platform); D006 merchant dispute-response (shared); D007 commission config; D008 dispute-route permission slug (shared); D009 dispute-open ownership (shared); D010 no expiry sweeper; D011 request-to-book model; D012 invoice doc.

## Environment notes / blockers

- Shared `supabase` local stack (project spotlight, :54322) — restarted by this lane mid-run; all live-DB suites pass (incl. new cutoff guard after fixture fix).
- No spotlight Go API on :8080 in this environment (OrbStack forwards the port to nothing spotlight-side); module flag off by default → no live HTTP session executed; evidence is unit + live-DB test level plus code review.
- vitest BFF tests not run (no frontend change made in this lane).
