# Production-Readiness Audit — all modules (2026-07-06)

Method: 5-agent parallel deep-audit of `backend/internal/*` + `mobile-app` +
`provider/*`. **Verdict: the backends are REAL and DB-integrated — pgx persistence,
double-entry ledger, idempotency keys, KYC/tier gates — NOT static mock.** The
production gaps are three kinds: (A) real code bugs, (B) third-party provider
integrations (see `docs/third-party-credentials.md`), (C) mobile `USE_MOCK` flags
default `true` (config flip + end-to-end validation, no rewrite).

## Module status (backend)

| Module | Backend | Money-path | Real? | Main gap |
|---|---|---|---|---|
| money transfer | finance/transfers + orchestration | ✅ ledger+idem | REAL | orch `GetTransferByReference` stub |
| fx exchange | finance/fx + maplerad | ✅ | REAL | rate history/alerts are display stubs |
| **virtual cards** | orchestration/handler_cards | ❌ | **STUB** | no card issuer wired (whole vertical) |
| savings | savings | ✅ | REAL | list-all-circles, early-withdraw route |
| social pay | social | ✅ +AML | REAL | confirm AML fail-closed |
| rewards (loyalty/points) | loyalty, points | ✅ | REAL | verify loyalty redeem idempotent |
| **crypto** | crypto | ✅ ledger | REAL money, **mock market** | no price feed / custody / on-chain |
| investment | invest | ✅ | REAL | broker+market-data default mock |
| invest AI | investai | n/a | REAL | needs ANTHROPIC_API_KEY |
| spotlight wealth | spotlightwealth | ✅ | REAL | seed content; fund paymax_revenue |
| real estate invest | fractionalre | ✅ | REAL | title/valuation provider (or accept admin NAV) |
| **telemedicine** | telemedicine + health/* | ✅ escrow | REAL | 🔴 booking NOT gated on MDCN-approved credential |
| **pharmacy** | health/pharmacy | ✅ escrow | REAL | 🔴 dispatch coords hardcoded (0,0)/"n/a" |
| laboratory | health/lab | ✅ escrow | REAL | no partner LIS ingestion; nil audit sink |
| veterinary | health/vet | ✅ escrow | REAL | (production-ready; minor) |
| AI care + triage | aicare, health/triage | n/a | REAL | ANTHROPIC/Infermedica keys; nil audit sink |
| nutrition | nutrition | n/a | REAL | (production-ready) |
| food | restaurant | ✅ 80/10/10 split | REAL | settlement reconciliation worker |
| ride + naija driver | transport | ✅ | REAL | 2 source TODOs (notif, track URL); reconciliation worker |
| marketplace | marketplace | ✅ | REAL (post ADR-023) | delete dead order/escrow FSM; ES or accept ILIKE |
| events tickets | top5events (wired) | ✅ | REAL | remove dead legacy `events/` pkg; KYC on SettleVendor |
| p2p market | p2pmarket | ✅ escrow | REAL | nil Auditor at wiring |
| real estate (realtor) | realtor | ⚠ out-of-band | PARTIAL | settlement in Supabase RPCs, not reconciled to Go ledger; no dispute act endpoints |
| estate / property mgmt | estate, property | ✅ | REAL | election vote replay guard; property object-level authz |
| connect | connect (30+ subpkgs) | ✅ | REAL | 🔴 RTC hmac stub; 🔴 KYC StubProvider |
| association | association | ✅ | REAL | tests/soak |
| crowdfunding | crowdfunding | ✅ (except…) | REAL | 🔴 withdrawal files PENDING only — never moves money |
| learn | learn | n/a | REAL | Next proxy dep before flip |
| academy | academy (16 subpkgs) | ✅ | REAL | BNPL/payout rails need provider URL |
| contest (votebridge/arena) | votebridge, arena | ✅ | REAL | tests |
| insurance | insurance | ✅ | REAL | 🟡 MyCover/Octamile live contract confirm |
| groups | groups | ✅ | REAL | thin surface |

## Prioritised backlog

### P0 — real code bugs / money-path holes — EXECUTED 2026-07-07 (swarm; full `go build ./...` exit 0)
1. ✅ **Telemedicine**: `BookAppointment`/consult `Start` now gate on the doctor's
   `doctor_verifications.status='approved'` (the real MDCN signal — note
   `health_provider_applications` has no `doctor` type), + slot-collision guard.
   Settle→COMPLETED was already correctly ordered.
2. ✅ **Pharmacy**: dispatch now sources real pharmacy geo + patient contact and
   **fails-closed** if absent (instead of 0,0). Flags a schema gap: `pharmacy_orders`
   captures no per-order delivery address — the single seam to wire (`patientDropoff`).
3. ✅ **Crowdfunding withdrawal**: `ApproveWithdrawal` money-path — DEBIT
   `AccountEscrow` / CREDIT `AccountProviderClearing`, idempotent
   (`cf:withdraw:payout:<id>` + header), guarded PENDING→APPROVED→COMPLETED, audit
   event, payout-rail hook (no fabricated success). Guard tests pass.
4. ✅ **Spray AML**: real NGN-kobo limits (₦500k single / ₦2m daily / 500-count).
5. ✅ **Nil audit sinks**: real Supabase-backed audit sink injected into
   p2pmarket, spray, lab, triage, preconsult.
6. ✅ **Orchestration**: `GetTransferByReference` now does a real object-scoped
   lookup of the persisted transfer (status/amounts/rates/fees).
7. ✅ **Marketplace**: ADR-023 order/escrow/dispute FSM confirmed unwired but still
   compiled-against — annotated `// DEPRECATED (ADR-023)` for a dedicated removal PR.
8. ✅ **Events**: legacy `internal/events` confirmed unwired — annotated
   `// DEPRECATED: superseded by internal/top5events`.
9. ✅ **Estate**: `CastVote` now `ON CONFLICT (election_id, voter_id) DO NOTHING`
   (the UNIQUE already existed) — double-vote returns a clear error.
10. ✅ **Reconciliation workers** — `restaurant.ReconcileStuckSettlements` +
    `transport.ReconcileStuckSettlements` (crash-recovery re-drive of escrow stuck
    past a grace window), registered on the periodic runtime under their feature
    flags, idempotent via the shared `settlement.Settle` (`FOR UPDATE` no-op +
    `ON CONFLICT (idempotency_key)`). Also fixed a real bug: transport's
    `settlement_status='pending'` violated the migration CHECK — corrected to
    `'settlement_pending'`. Tests pass.

### Cleanup executed 2026-07-07
- **Stays → own inventory**: removed the third-party bedbank aggregator adapter
  (`internal/stays/adapters/bedbank.go`) and made the gateway resolve to the
  **Direct rail only** (own `stays_property`/extranet supply — a hotels.com-style
  in-house marketplace). No `STAYS_BEDBANK_*` creds needed.
- **Dead code removed**: marketplace ADR-023 order/escrow/dispute FSM (+ its dead
  handlers/webhooks/cron jobs) and the legacy `internal/events` package (superseded
  by `top5events`). Full `go build ./...` + `go vet` clean.

### Stays → 100% own-supply complete (2026-07-07)
The hotels.com-style in-house build is feature-complete and verified on the live DB:
- **Availability/oversell engine** — `stays_availability_day` + `direct.go` real
  `FOR UPDATE` decrement/restore/ARI, idempotent. Oversell guard **proven on live
  Supabase** (concurrent race → one winner, no oversell).
- **Reservation modify** now a real money-path (delta charge via escrow+settle /
  refund via reversal, Idempotency-Key required, row mutated only after funds move).
- **Voucher R2 presign** wired (fail-closed), **extranet messaging** persisted
  (`stays_message`), **agent-assisted booking** backend built (`internal/stays/agent`,
  reuses the saga + existing commission split) with mobile `agent.ts` wired.
- New live migrations: `20260909000001`, `20260914000400`, `20260914000500`.
- Optional/owner-side only: pricing FX engine (NGN-only own supply errors clearly on
  cross-currency), `EXPO_PUBLIC_STAYS_USE_MOCK=false` flip + ledger-auditor sign-off.

> Remaining: the P1 provider integrations (need procured creds) + the P2 config
> flips. Money-path changes (crowdfunding withdrawal, telemedicine gate, stays
> modify) still want a ledger-auditor eyeball before real funds move.

### P1 — provider integrations (need creds/provider; see credentials doc)
Virtual cards issuer · crypto price+custody+on-chain · connect RTC (Agora) + KYC ·
invest broker/market-data · insurance live contracts · academy rails · maps key ·
AI keys · lab LIS ingestion · realtor Supabase↔Go ledger reconciliation.

### P2 — config / launch
Flip each `EXPO_PUBLIC_*_USE_MOCK=false`, set feature flags, run end-to-end per
module against the live backend. Standardise mobile default posture (some default
mock, events defaults live). Wire CI `go test` (backend has extensive tests, no
runner configured).
