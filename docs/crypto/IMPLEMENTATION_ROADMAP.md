# Crypto Module Implementation Roadmap

**Status:** Phase 0 Discovery Complete → Phase 1 Technical Design  
**Started:** 2026-10-27  
**Target R1 Release:** 2026-11-30 (indicative)  
**Workplan:** `Crypto_Quidax_Brownfield_Implementation_Workplan.md`

---

## Current State Summary

### What Already Exists (Substantial)
- ✅ **Backend crypto module** (`backend/internal/crypto/`) with 30+ files
  - Handler routes: assets, quotes, swaps, addresses, deposits, withdrawals
  - Service layer: business logic for trading, settlement, risk gates
  - Repository: data access, idempotency tracking
  - Models: Order, Quote, Asset, Withdrawal definitions
  - Tests: invariants, live DB, concurrency, atomicity
- ✅ **Database schema** (~8 migrations) for accounts, quotes, trades, webhooks, deposits
- ✅ **Double-entry ledger** (existing platform ledger extended for crypto)
- ✅ **Deposit/withdrawal service** fully structured

### What's Broken / Incomplete
- ❌ **Quidax provider adapter** (code exists but unknown if live-wired)
- ❌ **Quote TTL enforcement** (15-second expiry logic location unknown)
- ❌ **Webhook signature verification** (Quidax HMAC-SHA256 implementation unclear)
- ❌ **Mobile screens** (inventory not done; likely missing or partial)
- ❌ **Admin reporting & reconciliation UI** (backend data exists; UI unknown)
- ❌ **Feature flags** (logic not found; needed for rollout control)

### Blockers for R1 Release
1. **Quidax credentials** not yet secured (required for CR-006)
2. **Custody topology** not documented (required for CR-005)
3. **Legal/compliance approval** for KYC, AML, transaction monitoring (required for CR-007)
4. **Mobile UI completion** (screens missing or untested)
5. **Financial sign-off** on ledger reconciliation (required for CR-032)

---

## Phase 1: Technical Design (2–3 days)

### CR-002: Backend Code Deep Dive
**Owner:** Backend Lead  
**Tasks:**
- [ ] Read `service_ext.go` → understand business logic completeness
- [ ] Read `provider.go` → catalog provider interfaces vs Quidax docs
- [ ] Search for "Quidax" in all files → find live adapter location (if exists)
- [ ] Check error map and error definitions → catalog error handling vs Workplan §4.3
- [ ] Verify idempotency enforcement in service + DB constraints
- [ ] List all database tables and constraints from migrations

**Deliverable:** `03-backend-code-review.md` with:
- Quidax adapter status (live, mock, missing)
- Quote TTL enforcement location
- Webhook signature validation approach
- Error handling completeness vs spec
- Race condition/atomicity test coverage

### CR-003: Mobile Screen Inventory
**Owner:** Mobile Lead  
**Tasks:**
- [ ] Find and screenshot all crypto routes in `mobile-app/reactnative/app/`
- [ ] Mark each as: Existing / Partial / Broken / Missing
- [ ] Cross-reference against Workplan §7.1 (M01–M30 screen inventory)
- [ ] Check for feature flag gating (FEATURE_CRYPTO_ENABLED)
- [ ] Note any dead CTAs or incomplete forms

**Deliverable:** `04-mobile-screen-inventory.md` with:
- Grid mapping existing code to required screens
- Screenshots of each state (loading, empty, error, success)
- Gaps and effort estimates for each screen

### CR-004: Admin Module Inventory
**Owner:** Admin Lead  
**Tasks:**
- [ ] Find and screenshot all crypto admin pages
- [ ] Mark against Workplan §8.1 (A01–A28 screens)
- [ ] Check RBAC implementation (support, risk, finance, ops, super-admin)
- [ ] Verify financial report SQL (if separate views exist)
- [ ] Check for audit trail implementation

**Deliverable:** `05-admin-screen-inventory.md` with:
- Grid mapping existing code to required screens
- RBAC matrix test coverage
- Report SQL completeness
- Effort estimates

### CR-005: Custody Topology Verification
**Owner:** Finance + Tech Lead  
**Tasks:**
- [ ] Trace `crypto_accounts` table schema → understand user:subaccount mapping
- [ ] Document whether Quidax per-user subaccount or pooled model
- [ ] Verify customer asset segregation (no commingling)
- [ ] Map existing fiat funding → crypto funding flow
- [ ] Document ledger account structure (asset, liability, clearing, fee accounts)

**Deliverable:** Signed ADR: `06-custody-topology-decision.md` with:
- User to subaccount model (1:1, N:1, or direct pooled)
- Proof of customer segregation (DB constraints, audits)
- Ledger account mapping
- Approval signatures from Finance + Compliance

### CR-006: Quidax Merchant Verification
**Owner:** Backend + DevOps  
**Tasks:**
- [ ] Obtain Quidax test merchant credentials (already approved? or pending?)
- [ ] Verify Quidax Open API version in use (docs snapshot: 2026-10-27)
- [ ] Test quote → confirm → transaction flow in sandbox
- [ ] Obtain webhook secret and signature test vector
- [ ] Verify supported asset/pair list for the merchant account

**Deliverable:**
- Secured credentials in secret manager (no commit)
- Quidax API contract fixture (`provider_quidax_test.go` updated)
- Webhook secret + test signature vector in code comments
- Supported assets list from Quidax discovery

### CR-007: Scope & Gates Approval
**Owner:** Product + Legal  
**Tasks:**
- [ ] Confirm R1 scope: BUY, SELL, SWAP only (no exchange orders, no limit orders)
- [ ] Approve deposits conditional on: provider, KYC, on-chain reconciliation
- [ ] Approve withdrawals conditional on: 2FA, address whitelist, limits
- [ ] Define feature flags: FEATURE_CRYPTO, FEATURE_DEPOSIT, FEATURE_WITHDRAW, FEATURE_EXCHANGE_ORDERS
- [ ] Obtain legal sign-off on custody, KYC, AML, transaction monitoring

**Deliverable:** Signed PRD: `scope-and-feature-flags.md` with:
- Feature matrix: R1 (done), R1 conditional (gated), R2 (blocked)
- Flag names and defaults
- Legal/compliance approval signatures

---

## Phase 2: Backend Money Path Implementation (8–12 days)

### CR-009–015: Core Trading Lifecycle
**Sequence:** CR-009 → CR-010 → CR-011 → CR-012 → CR-013 → CR-014 → CR-015

**CR-009: Quidax Adapter Implementation**
- Typed HTTP client for Quidax Exchange Open API
- Request/response DTOs matching Quidax schema
- Credential injection from secret manager
- Error translation (provider → internal errors)
- Correlation ID tracking
- Rate limiting + circuit breaker
- **Test:** `provider_quidax_test.go` against real Quidax sandbox

**CR-011: Quote Service & TTL Enforcement**
- Quote creation with 15-second expiry
- Quote refresh (fee/price change → re-approve)
- Expiry validation before confirm
- Error handling for expired/stale quotes
- **Test:** CR-T026 (quote expiry) + TTL tests

**CR-012: Trade Idempotency & State Machine**
- Idempotency key uniqueness constraint
- State transitions: DRAFT → QUOTED → CONFIRMED → SUBMITTED → PROCESSING → COMPLETED/FAILED
- Concurrent reserve protection (no overspend)
- Duplicate confirm prevention
- **Test:** CR-T038 (duplicate taps), CR-T039 (concurrent confirms), atomicity

**CR-013: Webhook Signature & DLQ**
- HMAC-SHA256 verification per Quidax docs
- Timestamp replay protection
- Deduplication (webhook fingerprint)
- Durable persistence (no loss before ACK)
- Async worker + DLQ for failed processing
- **Test:** CR-T049–T060 (webhook security & reliability)

**CR-014: Atomic Settlement & Ledger**
- Reserve → submit → finalize transaction (no partial)
- Double-entry journal per trade (source debit, dest credit, fee)
- Hold release on failure
- Immutable ledger (no edits, reversing entries only)
- **Test:** CR-T061–T073 (ledger invariants, ledger balance checks)

**CR-015: Reconciliation**
- Scheduled provider vs ledger comparison
- Difference detection + alerting
- Case workflow (open → investigate → resolve)
- Controlled journal adjustment (maker-checker)
- **Test:** CR-T069–T074 (reconciliation correctness)

### CR-016–017: API Contract & Eligibility
- OpenAPI spec for all routes (existing + new)
- Contract tests (request/response shape)
- KYC/tier/risk gates (fail-closed)
- Feature flag checks (quote/confirm/withdraw gated)

---

## Phase 3: Frontend Implementation (Mobile + Admin) (8–12 days)

### CR-019–023: Mobile Screens (Parallel to Phase 2)
- Crypto home with live balances
- Asset list / detail with price & history
- BUY/SELL/SWAP forms with validation
- Quote review with countdown
- Processing → success / failure / recovery
- Transaction history & receipt
- Conditional: deposit QR, withdrawal confirm

### CR-024–029: Admin Dashboard & Controls
- Transaction search/filter/timeline
- Reconciliation cases + investigation
- Financial reports (volume, revenue, liability)
- Policy controls (limits, fees, asset pairs, kill switches)
- Risk/support/audit tooling
- Immutable audit trail
- Export center

---

## Phase 4: Verification & Release (10–15 days)

### CR-030–034: Testing & Hardening
- **CR-030:** Contract, E2E, concurrency, regression tests
  - 140 test cases from Workplan §11.1 (CR-T001–T140)
  - Test matrix: unit, integration, live DB, provider mock + sandbox
  - Evidence: test run results with no P0 failures
- **CR-031:** Mobile E2E iOS/Android + accessibility
  - Each screen tested on real devices
  - Loading/empty/error/success states verified
  - Accessibility: WCAG compliance + reader support
- **CR-033:** Security VAPT + regulatory gates
  - Object-level authZ (no cross-account access)
  - Transaction replay (idempotency, state transitions)
  - Webhook forgery (unsigned, tampered, replayed)
  - Secrets scanning (no committed credentials)
  - Legal/compliance review sign-off
- **CR-034:** Chaos & load tests
  - Provider outage + recovery
  - DB failure + restore
  - Webhook loss + DLQ
  - Load: p95 trade completion time under agreed load
  - Drill: incident runbook verification

### CR-035–037: Production Release
- **CR-035:** Staging pilot
  - Canary: small user cohort with real-time monitoring
  - Finance validates settlement
  - Incident response team on standby
- **CR-036:** Production deployment
  - Feature flags rolled out incrementally
  - Kill switches verified (quote/confirm/withdraw)
  - Monitoring dashboards + alerts active
- **CR-037:** Hypercare
  - Daily reconciliation sign-off (7 days)
  - Incident log + post-mortems
  - Customer communication templates

---

## Work Breakdown Structure (WBS)

| Phase | CR Tasks | Effort | Timeline | Owner |
|-------|----------|--------|----------|-------|
| 0. Discovery | CR-001–CR-007 | 3–5 days | Oct 27–Nov 1 | TL + Product + Finance |
| 1. Backend | CR-009–CR-017 | 10–15 days | Nov 2–Nov 16 | Backend (parallel) |
| 2. Mobile/Admin | CR-019–CR-029 | 10–15 days | Nov 2–Nov 16 | Mobile + Admin (parallel to Phase 1) |
| 3. Verification | CR-030–CR-034 | 8–12 days | Nov 17–Nov 28 | QA + Security + SRE |
| 4. Release | CR-035–CR-037 | 2–5 days + stabilization | Nov 29–Dec 6 | DevOps + Product |

**Total Estimate:** 33–52 business days (7–10 weeks with parallel streams)

---

## Critical Path & Dependencies

```
CR-001 (baseline) → CR-006 (Quidax creds) → CR-009 (adapter) → CR-012 (state machine)
                 ↓
              CR-005 (custody) → CR-014 (ledger)
                 ↓
              CR-007 (scope approval) → CR-017 (flags)
                                           ↓
                        CR-019 (mobile) & CR-025 (admin)
                                           ↓
                        CR-030 (tests) → CR-035 (pilot) → CR-036 (go-live)
```

---

## Risk Register (Top Blockers)

| Risk | Likelihood | Impact | Mitigation | Owner |
|------|-----------|--------|-----------|-------|
| Quidax credentials not yet available | Medium | P0 blocker | CR-006: daily follow-up with partner | Backend |
| Quote TTL logic missing or untested | Medium | P0 blocker | CR-011: code review + test CR-T026 | Backend |
| Mobile screens heavily incomplete | High | P0 blocker | CR-003: early inventory + CR-019 timeline | Mobile |
| Webhook signature code doesn't match Quidax docs | Medium | P0 blocker | CR-013: contract test against fixtures | Backend |
| Legal/compliance approval delayed | Medium | P0 blocker | CR-007: early engagement, parallel track | Product |
| Ledger reconciliation not trusted by Finance | Low | P0 blocker | CR-032: finance UAT with real data | Finance |

---

## Success Criteria (Release Gates)

### G0: Architecture (CR-001–CR-007)
- [ ] Gap register complete with no "Not Assessed" gaps
- [ ] Custody topology documented & signed
- [ ] Quidax merchant confirmed + credentials secured
- [ ] Legal/compliance approval for R1 scope
- [ ] Feature flag names finalized

### G1: Backend (CR-009–CR-017)
- [ ] All Quidax adapter calls (quote/confirm/status) live-tested
- [ ] Quote TTL enforcement with tests passing CR-T026
- [ ] Trade idempotency with concurrent race tests passing
- [ ] Webhook signature verification implemented + tested CR-T049–T053
- [ ] Ledger invariant tests passing (no rounding errors, no overspend)
- [ ] Reconciliation detection + case workflow working
- [ ] All P0 backend test cases passing (CR-T001–T140 P0 subset)

### G2: Mobile (CR-019–CR-023 + CR-031)
- [ ] All in-scope R1 screens built & routing verified
- [ ] Loading/empty/error/success states present
- [ ] E2E BUY/SELL/SWAP flows tested on iOS + Android
- [ ] Accessibility: screens readable, contrast passing
- [ ] No dead CTAs or incomplete forms

### G3: Admin (CR-024–CR-029 + CR-032)
- [ ] Transaction search + timeline investigation working
- [ ] Reconciliation dashboard shows real data + exceptions
- [ ] Financial reports (volume, fees, liability) reproducible from ledger
- [ ] RBAC tested: support/risk/finance/ops role isolation
- [ ] Audit trail captures all settings changes

### G4: Security & Compliance (CR-033)
- [ ] No open critical/high VAPT findings
- [ ] Object-level authZ verified (no cross-account reads)
- [ ] Transaction replay (idempotency) verified
- [ ] Webhook forgery (signature) verified
- [ ] Secrets scanning clean (no committed credentials)
- [ ] Legal/compliance sign-off on final implementation

### G5: Testing (CR-030–CR-034)
- [ ] 100% of in-scope P0 test cases executed
- [ ] E2E evidence: BUY/SELL/SWAP with provider + ledger + mobile + admin agreement
- [ ] Chaos drills: provider outage, DB failure, stuck trade recovery
- [ ] Load test: p95 trade completion < 2 sec (local), SLOs met under agreed load
- [ ] No unexplained monetary discrepancies at final Finance sign-off

### G6: Launch (CR-036)
- [ ] Feature flags verified on/off/kill-switch
- [ ] Canary cohort tested with real settlement
- [ ] Monitoring dashboards + incident response active
- [ ] Runbooks tested: outage response, escalation paths
- [ ] Named on-call engineer confirmed

---

## Next Immediate Actions (This Week)

1. **CR-006 (today):** Contact Quidax partner → confirm merchant account + sandbox credentials
2. **CR-002 (today/tomorrow):** Backend deep dive → identify adapter status + TTL location
3. **CR-005 (tomorrow):** Finance review of custody topology + ledger schema
4. **CR-003 (tomorrow):** Mobile lead inventory audit + screenshot all crypto screens
5. **CR-007 (Wed/Thu):** Product + Legal alignment meeting → approve scope + feature flags
6. **Baseline test run (Friday):** `go test ./...` + `npm run test:regression` + mobile E2E

---

## Documents Produced (Phase 0)

- [01-current-state-audit.md](01-current-state-audit.md) — What exists, baselines, open questions
- [02-feature-gap-register.md](02-feature-gap-register.md) — Every gap mapped to work, impact, disposition
- [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md) — This document (timeline, sequencing, gates)
- (Forthcoming) 03-backend-code-review.md
- (Forthcoming) 04-mobile-screen-inventory.md
- (Forthcoming) 05-admin-screen-inventory.md
- (Forthcoming) 06-custody-topology-decision.md

---

**Status:** Ready for CR-002 code deep dive.  
**Updated:** 2026-10-28  
**Next review:** After CR-006 + CR-007 gates

