# Cluster events-b — Events commerce core (UAT 8.8–8.15, EVT-UAT-099…207)

Run date: 2026-10-21. 109 cases. Modules: 8.8 Ticket types & inventory (13), 8.9 Promotions/pricing/fees (11), 8.10 Cart/hold/reservation (12), 8.11 Payments & reconciliation (20), 8.12 Orders/tickets/self-service (13), 8.13 Admission/QR/attendance (16), 8.14 Lifecycle/refunds/exceptions (14), 8.15 Communications/reminders (10).

## Environment verdict (shapes all evidence)

**No live stack exists on this machine.** Port 8080 is held by an unrelated `rx-api-gateway` container (OrbStack). No Supabase/Postgres for this repo is running (`supabase status`: not linked; `docker ps` shows only other projects' containers). `TEST_DATABASE_URL` unset. All `*_live_db_test.go` suites (29 files in top5events) therefore skip — they exist as executable evidence for a live lane re-run.

**Consequence:** every DB-dependent case is `BLOCKED` with CODE_REVIEW evidence. Logic-level invariants were proven by `go test` (existing mirror/durability/handler suites + 6 new contract tests) and `tsc --noEmit` on the mobile app (symlinked node_modules from the main checkout).

## Module map

| Layer | Location | Role |
|---|---|---|
| Core | `backend/internal/top5events/` (10.8k LOC) | Events CMS (DRAFT→SUBMITTED→APPROVED→LIVE→CLOSED, +PAUSED/SUSPENDED/CANCELLED), tiers, promos, purchase (wallet.Debit→escrow, PENDING→PAID order, credential+ticket), gift, scan, stewards, cashless wallets, vendor tap-charge/settle, comps, announcements, team, admin reads, 2 reconcilers |
| Shared primitive | `backend/internal/credential/` | HMAC rotating-QR/NFC tokens, atomic single-use consume, replay/stale-window reject, offline enqueue+reconcile (unwired) |
| Wiring | `backend/internal/app/top5_routes.go RegisterEvents` | `/api/finance/events` + `/api/events/admin`; flags FEATURE_EVENTS_{ENABLED,EDIT_LIFECYCLE,TICKETING_DEPTH,TEAM_ROLES,COMPS} (all default off) |
| BFF | `frontend-web/app/api/v1/events/**` | thin proxy to Go; `app/api/admin/events` is a DIFFERENT legacy in-memory CMS (programs:manage) — not this module |
| Mobile | `mobile-app/reactnative/app/events/**` + `src/features/events/` | discovery, checkout (tiers/review/success), my-tickets, steward scan, organiser console, event wallet |
| Admin | `frontend-admin/app/admin/events/**` + `eventsAdminService.ts` | dashboards over `/api/events/admin/*` |

**Money model:** ticket checkout = `wallet.Debit` of the buyer's Paymax wallet into the platform escrow standing account. Balanced double-entry via `ledger.Service`. There is **no card/VA/gateway rail and no webhook** for ticket orders (EVTB-D013) — all Paystack-shaped 8.11 cases are unrunnable by construction, not by environment.

## Outcome

| Result | Count |
|---|---|
| PASSED (executed evidence) | 18 |
| FAILED (verified defect/gap) | 7 |
| BLOCKED (implemented, needs live DB/API) | 51 |
| NOT_RUN (feature absent) | 32 |
| NEEDS_MANUAL | 1 |

Implementation: IMPLEMENTED 52 · PARTIAL 29 · MISSING 28.

## Defects — fixed this lane

| ID | Sev | Fix |
|---|---|---|
| EVTB-D001 | S1 | Purchase now binds `quantity` + `promo_code` (and legacy `promo`), issues N tickets via per-unit derived idempotency keys (`key:i`, single keeps bare key), returns `{tickets[],total_kobo,fulfilled,partial,ticket}` matching the client contract. Before: client sent `{quantity:3,promo_code:X}` → silently charged+issued exactly 1 full-price ticket, then `res.tickets.length` crashed post-payment. Cap 1..10 enforced (`MaxTicketsPerOrder`); explicit `quantity:0` rejected (pointer binding). |
| EVTB-D002 | S2 | Gift accepts `cashtag` (client's field) as well as `recipient`; empty → 400. Before: every mobile gift hard-400'd. |
| EVTB-D003 | S1 | `GetEvent` now returns `tiers[]` (new `tiersForEvent`, cheapest-first). Before: no member-facing tier read existed — live checkout crashed on `e.tiers.filter` and buyers had no way to obtain a `tier_id`. |
| EVTB-D004 | S2 | Removed invented "Service fee (1.5%)" from `review.tsx` — disclosed total now equals charged total (server debits price×qty only). |
| EVTB-D005 | S2 | `UpdateEvent` locks **venue** with date/time once tickets are sold (`hardTimePatch`), matching the module's own documented lock reason. Before: silent venue edits after sale. |

New tests: `backend/internal/top5events/checkout_contract_test.go` — 6 tests (mobile body binding, promo alias precedence, cashtag binding, unit-key derivation, qty validation, venue hard-lock classification). All green; full `go test ./internal/top5events` + `./internal/credential` + `go build ./internal/...` clean.

## Defects — recorded, not fixed (with reason)

| ID | Sev | What / why not fixed |
|---|---|---|
| EVTB-D006 | S2 | No per-order/per-buyer limits (EVT-099/105/134). Needs schema columns — pending SQL at `docs/qa/events-uat-299/migrations-events-b/per-buyer-ticket-limits.pending.sql`. |
| EVTB-D007 | S3 | Reconciler auto-completes funded PENDING checkouts instead of TTL-releasing the hold (EVT-125/138). Semantics divergence vs hold-expiry spec. |
| EVTB-D008 | S3 | No manual lookup check-in; roster is read-only (EVT-178). |
| EVTB-D009 | S2 | Offline scan queue unwired: `credential.EnqueueOffline`/`Reconcile` exist but no route/ticker calls them; client optimistic-accepts (EVT-179/180). |
| EVTB-D010 | S2 | No transactional notifications on purchase/cancel/refund/reschedule; Announce is manual-only, no preference model (EVT-163,184,192,198-202,204). |
| EVTB-D011 | S2 | No customer-initiated refund flow: no request endpoint, no policy/cutoff, no partial-ticket refund; only organiser whole-event cancel at fixed fee split (EVT-185,186,188). |
| EVTB-D012 | S3 | Self-service gaps: no orders endpoint/receipt/PDF/attendee fields/check-in reversal/disputes (EVT-155-160,181,196). |
| EVTB-D013 | S1 | No external payment rail — wallet-debit only; all card/VA/webhook cases unrunnable (EVT-135/136/139/141-143/147/148/153/195). Product-scope question for orchestrator. |
| EVTB-D015 | S3 | Refund-vs-admission race: a USED ticket still gets refunded and overwritten REFUNDED; no precedence gate (EVT-191). |

(EVTB-D014 unused.)

## Per-module findings

**8.8 Tiers (13):** tier CRUD + sales windows + invite-only + pause + capacity-below-sold lock all implemented. Gaps: no per-buyer limits (D006), capacity=0 means *unlimited* not *rejected* (semantic divergence), no waitlist, no bundle pricing, comps behind `FEATURE_EVENTS_COMPS`.

**8.9 Promotions (11):** promo engine is solid — percent/fixed, event+tier scoping, validity windows, `FOR UPDATE` max_uses, per-user redemption counts, single-code (no stacking possible), server-authoritative pricing. Fixed: invented client fee (D004). Gaps: no promo-code field in the checkout UI (API accepts it), no tax/fee line items, `amount_off` can zero a ticket to free (intended).

**8.10 Cart/hold (12):** there is no cart or hold API — checkout is atomic: reserve-under-`FOR UPDATE` → PENDING order → debit → PAID → ticket. Idempotent on `Idempotency-Key` (replay resumes the same order). Sold-out/race protection is row-lock serialization. Hold-TTL semantics differ (D007): PENDING survives crash and is swept by `StartPendingOrderReconciler` (15-min grace, env-tunable) — completed if funded, expired+released if not.

**8.11 Payments (20):** the money invariants that exist internally are strong: one idem key → one order → one debit (`key:ticket`, `ledger.Posted` recheck on ambiguous failure) → one ticket (`uq_event_tickets_order`); EXPIRED/REFUNDED terminal; crash-resume safe. But the entire external surface the pack targets — card, VA, webhooks, signatures, amount-mismatch, 3DS, chargebacks — does not exist (D013).

**8.12 Orders (13):** `MyTickets` owner-scoped + `TicketToken` owner-only + `GiftTicket` (atomic owner move + credential reissue/revoke — fixed D002). Orders model exists internally (PENDING/PAID/REFUNDED/EXPIRED) but has no customer endpoint, receipts, attendee fields, or resend (D012). Transfer = direct assignment, no accept step; only ISSUED transferable.

**8.13 Admission (16):** strongest module. Rotating HMAC QR (30s), single-use atomic consume, replay/stale/tampered/wrong-event/cross-tenant/refunded/cancelled/out-of-window all rejected correctly. `checked_in_at` + `credential_validations` audit + realtime push. Gaps: manual check-in (D008), offline reconcile unwired (D009), no check-in reversal, 6h-fixed entry window not organiser-configurable.

**8.14 Lifecycle/refunds (14):** `Cancel` (owner-only, flag `FEATURE_EVENTS_EDIT_LIFECYCLE`) → whole-event refund sweep: per-ticket `pricePaid - feeBps` back to payer + fee→revenue, balanced, ticket-derived idempotency keys, crash-safe ordering (money→revoke→order→ticket), `ReconcileCancelledEvents` re-drive. Double-refund impossible by construction. Hard-time+venue lock after first sale (D005 fixed). Gaps: no customer refund request/policy/partial (D011), no holder notifications (D010), scan-refund race unhandled (D015), refunded seats never restock (conservative, spec-compliant).

**8.15 Communications (10):** only organiser `Announce` (idempotent fan-out, at-most-once, nil-safe) + realtime check-in push. Everything transactional — confirmations, reminders, cancel/refund notices, preferences — is absent (D010). Merchant-upgrade notifications are platform-owned (shared_platform).

## Commands run

```
cd backend && go test ./internal/top5events -count=1        # PASS (all non-live suites)
cd backend && go test ./internal/credential -count=1        # PASS
cd backend && go test ./internal/top5events -run 'TestPurchaseRequest|TestGiftRequest|TestUnitIdemKey|TestPurchaseTickets|TestHardTimePatch' -v  # 6/6 PASS
cd backend && go build ./internal/... && go vet ./internal/top5events  # clean
cd mobile-app/reactnative && tsc --noEmit -p tsconfig.json  # clean (symlinked node_modules)
curl localhost:8080/readyz                                  # unrelated rx-api container — no Spotlight stack
```

## Files changed

- `backend/internal/top5events/service.go` — PurchaseResult/MaxTicketsPerOrder/unitIdemKey/PurchaseTickets; GetEvent returns tiers; tiersForEvent
- `backend/internal/top5events/model.go` — Event.Tiers
- `backend/internal/top5events/handler.go` — purchaseRequest (quantity *int, promo_code alias), giftRequest (cashtag alias)
- `backend/internal/top5events/manage.go` — hardTimePatch; venue under hard lock
- `backend/internal/top5events/checkout_contract_test.go` — new, 6 tests
- `mobile-app/reactnative/app/events/checkout/review.tsx` — removed invented service fee
- `docs/qa/events-uat-299/` — this report, rtm/defects/exec CSVs, migrations-events-b pending SQL
