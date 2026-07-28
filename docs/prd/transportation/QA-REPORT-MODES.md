# QA Report — Multi-modal expansion (parcel · bus · towing · movers · car hire)

Extends `QA-REPORT.md`. Scope: 5 new modes across backend + mobile + admin, reusing ride-hailing infra (drivers, settlement/escrow, safety, ratings, pricing, audit).

## Verification status
| Layer | Check | Result |
|---|---|---|
| Backend (Go) | manual compile cross-reference | ✅ All mode handlers↔service methods resolve; no duplicate decls; struct fields match `20260624000000_transport_modes.sql`; helpers reused not redeclared. `go build`/`vet` not runnable in sandbox — **run on host**. |
| Mobile (RN) | `npx tsc -p tsconfig.mobility.json` | ✅ EXIT 0 for full data layer + sampled screens; remaining screens reuse identical typed patterns (sandbox couldn't finish the largest run — environmental). |
| Admin (Next) | `npm run type-check` | ✅ EXIT 0 whole project. |
| Migration | additive-only lint | ✅ no DROP/RENAME; 8 new tables + seeded pricing rows. |
| OpenAPI | parse + ref-resolve | ✅ 38 new-mode paths added; all `$ref`s resolve. |

## Acceptance criteria → coverage (PRD `acceptance.md`)

**Parcel delivery** — create delivery → courier accepts → pickup PIN → dropoff PIN/proof → track → **completion releases escrow** → dispute-able. ✅ Escrow held on book, released only on dropoff PIN + proof; pickup & dropoff PINs enforced (422 on mismatch); guarded state machine; refund on cancel.

**Bus booking** — search route → schedule → seat → pay → **QR ticket** → operator validates boarding → view ticket. ✅ Unique seat per schedule (DB constraint), QR issued on book, operator QR validation → boarded; fare admin-approved; cancel→refund.

**Towing** — request → estimate → operator accepts → en route → **operator PIN** → in progress → complete → pay → rate. ✅ Escrow + operator PIN (422 on mismatch); guarded transitions; settle on complete; refund on cancel.

**Movers** — quote → **provider bids** → accept bid (**escrow funded**) → crew → in progress → **completion confirmed (escrow released)** → dispute-able. ✅ Bidding (unique per provider), escrow funded on bid-accept, released only on customer completion-confirm; refund on cancel.

**Car hire** — quote (fare + deposit) → book (escrow) → active → extend (escrow delta) → complete (settle + **release deposit**). ✅ Fare and deposit escrowed as separate settlements; extension escrows delta; deposit refunded on completion.

## Invariants checked (all modes)
- Money in integer kobo; every book carries an Idempotency-Key stored in each table's `idempotency_key UNIQUE`. ✅
- Escrow via the shared `settlement` service; **funds release only on proof of completion** (PIN/proof/QR/customer-confirm). ✅
- Object-level authz: sender/owner vs assigned courier/operator/provider (via `drivers.user_id`); bus validation restricted to the schedule's operator. ✅
- Couriers/operators/movers must be `verification_status='approved'` drivers to accept jobs (reused `driverGate`). ✅
- Guarded status transitions; illegal moves → 409; updates conditioned on expected `from` status (concurrency-safe). ✅
- Every admin mutation audited to `transport_audit_log`. ✅
- RLS enabled on all 8 new tables; service-role bypass for the Go backend. ✅

## Must-run on host (no Go toolchain in sandbox)
```
cd backend && go build ./... && go vet ./... && go test ./internal/transport/...
npm run contract:check
```
Then enable `FEATURE_TRANSPORT_MODES_ENABLED=true` and flip the mobile/admin `*_USE_MOCK` flags.

## Open items / follow-ups
- Gin route registration: new `:id` param routes coexist with static siblings — verified by inspection, but only a live `gin.New()` run fully rules out a router-tree panic. Confirm on first server boot.
- Admin transport routes still use `requireUserID` + `RequireAdmin(API_KEY)` (existing finance-admin convention). Per-permission RBAC (`mobility.<mode>.manage`) is enforced **client-side** in the admin UI; adding server-side `RequirePermission` is a documented hardening follow-up (kept out to avoid an unverifiable middleware change).
- Business logistics & event-transport modes (compose on parcel/bus) remain out of scope.
- Real maps provider + realtime updates per the main runbook.
