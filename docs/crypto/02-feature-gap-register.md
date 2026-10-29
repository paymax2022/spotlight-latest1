# Crypto Module — Feature Gap Register (Phase 0)

**Date:** 2026-10-27  
**Status:** Evidence-based gap analysis  
**Workplan ref:** `Crypto_Quidax_Brownfield_Implementation_Workplan.md` §3.3  

---

## Gap Register — R1 Scope (BUY/SELL/SWAP, deposits, withdrawals conditional)

| Gap ID | Area | Feature | Current Status | Proof | Desired Behavior | Impact | Disposition | Work ID | Owner |
|--------|------|---------|-----------------|-------|------------------|--------|-------------|---------|-------|
| CR-GAP-001 | Backend | Quidax quote/confirm endpoints | Present-Defective | `handler_ext.go:SwapQuote()`, `Swap()` exist; method impl unknown | Live Quidax Instant Swap API calls via typed HTTP client | P0 blocker | Repair | CR-009 | Backend |
| CR-GAP-002 | Backend | Quote TTL enforcement (15 sec) | Not Assessed | Requires service.go review | Server enforces quote expiry; confirm blocked after | P0 blocker | Repair | CR-011 | Backend |
| CR-GAP-003 | Backend | Trade idempotency & state machine | Present-Defective | `service.go` methods exist; concurrency/race untested | Idempotency key prevents duplicate trades under retries/concurrency | P0 blocker | Repair | CR-012 | Backend |
| CR-GAP-004 | Backend | Webhook signature verification (Quidax) | Not Assessed | `provider_quidax_test.go` exists; impl unknown | Signed webhook validation (HMAC-SHA256) per Quidax docs §5.1 | P0 blocker | Repair | CR-013 | Backend |
| CR-GAP-005 | Backend | Immutable ledger + atomic settlement | Partial | `ledger_crypto_clearing_account_type` migration exists | Double-entry journals, holds, fees; no stale/partial posts | P0 blocker | Repair | CR-014 | Backend |
| CR-GAP-006 | Backend | Reconciliation (provider vs ledger) | Not Assessed | No visible code; may exist in service_ext.go | Detect/alert on provider mismatch; reconcile balanced | P0 blocker | Build | CR-015 | Backend |
| CR-GAP-007 | Backend | Public API endpoints (OpenAPI contract) | Partial | Routes in handler.go + handler_ext.go; docs unknown | `GET /api/v1/crypto/assets`, `POST /crypto/quotes`, etc. per §6.2 | P1 major | Repair | CR-016 | Backend |
| CR-GAP-008 | Backend | KYC/tier/risk eligibility gates | Not Assessed | Error map has tiers.ErrWalletDisabled; impl unknown | Server denies quote/trade if ineligible (no UI workaround) | P0 blocker | Repair | CR-017 | Backend |
| CR-GAP-009 | Backend | Deposit flow (conditional R1) | Partial | `deposit/` subdirectory with full impl; feature gated | Create address, track on-chain, verify confirmations, credit once | C/P0 | Repair | CR-018 | Backend |
| CR-GAP-010 | Backend | Withdrawal flow (conditional R1) | Partial | Handlers exist (WithdrawalEligibility, Withdraw, etc.); completion unknown | Quote fee, validate address, reserve, broadcast, reconcile | C/P0 | Repair | CR-018 | Backend |
| CR-GAP-011 | Mobile | Crypto home/portfolio screen | Not Assessed | Expected at `app/crypto/` or `features/crypto/`; inventory unknown | Live balances, valuation, quick BUY/SELL/SWAP buttons | P0 blocker | Build | CR-019 | Mobile |
| CR-GAP-012 | Mobile | Asset list & detail screens | Not Assessed | Expected at `app/crypto/assets/*`; inventory unknown | Supported coins, price, change %, balance, action CTAs | P1 major | Build | CR-019 | Mobile |
| CR-GAP-013 | Mobile | BUY/SELL/SWAP form screens | Not Assessed | Expected at `app/crypto/buy/`, `sell/`, `swap/`; unknown | Amount input, fee display, validations, route to quote review | P0 blocker | Build | CR-020 | Mobile |
| CR-GAP-014 | Mobile | Quote review & countdown | Not Assessed | Expected; unknown if built | Show exact in/out, rate, TTL countdown; disable confirm on expiry | P0 blocker | Build | CR-020 | Mobile |
| CR-GAP-015 | Mobile | Pending → Processing → Success/Failure states | Not Assessed | Unknown | No unjustified failure claim; show processing w/ refresh | P0 blocker | Build | CR-021 | Mobile |
| CR-GAP-016 | Mobile | Transaction history & receipt | Not Assessed | Unknown | Paginated, filterable; receipt with rate/fee/reference | P1 major | Build | CR-022 | Mobile |
| CR-GAP-017 | Mobile | Conditional: deposit address QR & monitor | Not Assessed | Unknown | Copy address, generate QR, display confirmations | C/P1 | Build | CR-023 | Mobile |
| CR-GAP-018 | Mobile | Conditional: withdrawal address whitelist & confirm | Not Assessed | Unknown | Add/delete address, network validation, preview + confirm | C/P1 | Build | CR-023 | Mobile |
| CR-GAP-019 | Admin | Crypto transaction search/filter dashboard | Not Assessed | Unknown | Search by user/trade ID, asset, date, status; view timeline | P1 major | Build | CR-025 | Admin |
| CR-GAP-020 | Admin | Trade investigation (quote→confirm→webhook→ledger) | Not Assessed | Unknown | Side-by-side timeline, provider metadata, ledger entries | P1 major | Build | CR-025 | Admin |
| CR-GAP-021 | Admin | Reconciliation dashboard & cases | Not Assessed | Unknown | Provider vs ledger diff, severity, case assignment, closure | P0 blocker | Build | CR-026 | Admin |
| CR-GAP-022 | Admin | Financial reports (volume, revenue, liabilities) | Not Assessed | Unknown | Trade count/volume, fees, customer balances; export CSV | P1 major | Build | CR-026 | Admin |
| CR-GAP-023 | Admin | Fee/limit/asset policy configuration | Not Assessed | Unknown | Maker-checker, versioning, effective date control | P1 major | Build | CR-027 | Admin |
| CR-GAP-024 | Admin | Kill switches (quote/confirm/withdraw) | Not Assessed | Unknown | Feature flags to disable per capability | P1 major | Build | CR-027 | Admin |
| CR-GAP-025 | Admin | Risk/compliance review (restrictions, AML flags) | Not Assessed | Unknown | Restricted accounts, velocity, withdrawal approval gate | P1 major | Build | CR-028 | Admin |
| CR-GAP-026 | Admin | Immutable audit trail (admin actions) | Not Assessed | Unknown | Who/what/when/approval chain for all settings changes | P0 blocker | Build | CR-029 | Admin |
| CR-GAP-027 | Data | Feature flag control & defaults | Not Assessed | Not found in code; usage unknown | Flags: FEATURE_CRYPTO_ENABLED, FEATURE_DEPOSIT, FEATURE_WITHDRAW | P1 major | Build | CR-017 | Backend |
| CR-GAP-028 | Data | Quidax subaccount provisioning (if required) | Not Assessed | Unknown; migrations suggest per-user mapping | 1:1 user:Quidax subaccount creation + unique constraint | C/P0 | Repair | CR-010 | Backend |
| CR-GAP-029 | Security | VAPT: object-level authZ (quote/trade/wallet IDs) | Not Assessed | Handlers enforce ginutil.UserID(c); endpoint exposure unknown | No cross-account access via direct ID manipulation | P0 blocker | Verify | CR-033 | Security |
| CR-GAP-030 | Security | VAPT: transaction replay (idempotency, state) | Not Assessed | Handler checks idempotency key; DB uniqueness unknown | Same request ≠ second trade; old quote cannot be reconfirmed | P0 blocker | Verify | CR-033 | Security |
| CR-GAP-031 | Security | VAPT: webhook forgery (unsigned, tampered, timestamp replay) | Not Assessed | Signature verification code unknown | Reject unsigned/invalid/tampered/replayed webhooks | P0 blocker | Verify | CR-033 | Security |
| CR-GAP-032 | Ops | Monitoring: trade state age, stuck jobs, ledger invariants | Not Assessed | Unknown | Metrics for pending age, webhook latency, reconciliation lag | P1 major | Build | CR-033 | DevOps |
| CR-GAP-033 | Ops | Incident runbooks: provider outage, DB failure, stuck trade | Not Assessed | Unknown | Kill switch, recovery, customer comms | P1 major | Build | CR-034 | DevOps |
| CR-GAP-034 | Compliance | Legal review: custody model, KYC, AML, transaction monitoring | Not Assessed | Unknown; unknown whether approved | Regulatory sign-off on customer segregation, flow controls | P0 blocker | Await | CR-007 | Legal |
| CR-GAP-035 | Finance | Ledger-backed reconciliation report (reproducible totals) | Not Assessed | Unknown | Trade/fee/liability totals reproducible from ledger; no rounding errors | P0 blocker | Build | CR-026 | Finance |

---

## R1 Exit Gate G0 Checklist

- [ ] All P0 gaps assigned to owner and estimated
- [ ] C (conditional) gaps marked with approval gate (CR-007)
- [ ] Quidax merchant account verified + test creds secured
- [ ] Custody topology (per-user vs pooled) documented + signed
- [ ] Feature flag names and default values finalized
- [ ] Mobile/admin screen inventory completed (CR-003, CR-004)
- [ ] Security VAPT scope approved
- [ ] Legal/compliance gates defined for deposits/withdrawals

---

## Recommended Sequencing (by priority & dependency)

### Wave 0: Foundation (2–3 days)
- [ ] CR-001: Repository audit (complete)
- [ ] CR-002: Backend code review (handler_ext, service_ext, provider)
- [ ] CR-003: Mobile screen inventory
- [ ] CR-004: Admin module inventory
- [ ] CR-005: Custody/ledger topology verification
- [ ] CR-006: Quidax merchant capabilities + test credentials
- [ ] CR-007: Product/legal scope approval

### Wave 1: Backend Money Path (8–12 days)
- [ ] CR-009: Quidax adapter (quote, confirm, status)
- [ ] CR-010: Asset catalogue & subaccount mapping (if required)
- [ ] CR-011: Quote service & TTL enforcement
- [ ] CR-012: Trade idempotency & state machine (race tests)
- [ ] CR-013: Webhook signature & DLQ handling
- [ ] CR-014: Ledger & atomic settlement (invariant tests)
- [ ] CR-015: Reconciliation (provider vs internal)

### Wave 2: Frontend (Mobile + Admin) (8–12 days)
- [ ] CR-016: Public APIs & contract validation
- [ ] CR-017: Eligibility gates & feature flags
- [ ] CR-019: Mobile crypto home, assets, discovery
- [ ] CR-020: Mobile quote/confirm/processing
- [ ] CR-021: Mobile success/failure/receipt
- [ ] CR-024: Admin shell & RBAC
- [ ] CR-025: Admin dashboards (transactions, trades, wallets)

### Wave 3: Reporting & Ops (5–8 days)
- [ ] CR-026: Admin financial reporting & reconciliation UI
- [ ] CR-027: Admin controls (limits, fees, kill switches)
- [ ] CR-028: Admin risk/support/audit
- [ ] CR-029: Export center & immutable audit trail
- [ ] CR-032: Admin & finance UAT

### Wave 4: Verification & Release (5–10 days)
- [ ] CR-030: Contract, E2E, regression test suites
- [ ] CR-031: Mobile iOS/Android E2E, accessibility
- [ ] CR-033: VAPT, regulatory gates, secrets scan
- [ ] CR-034: Load, chaos, failover drills
- [ ] CR-035: Staging pilot
- [ ] CR-036: Production deployment

---

## Conditional Capabilities (Gated by CR-007 approval)

| Capability | Gate | Default | Notes |
|---|---|---|---|
| Crypto deposits | FEATURE_DEPOSIT_ENABLED | `false` | Requires provider support, KYC, reconciliation |
| Crypto withdrawals | FEATURE_WITHDRAW_ENABLED | `false` | Requires address whitelist, risk engine, 2FA |
| External fiat on/off-ramps | FEATURE_FIAT_GATEWAY | `false` | Preserve existing banking integration; separate approval |
| Quidax Ramp / Auto Swap | FEATURE_QUIDAX_RAMP | `false` | Not in R1 unless separate product deal approved |
| Exchange orders / order book | FEATURE_EXCHANGE_ORDERS | `false` | **R2 only**; explicitly blocked in R1 code |

---

## Known Risks & Blocking Items

| Risk | Severity | Mitigation |
|---|---|---|
| Quidax merchant credentials not yet secured | S1 | CR-006: verify + secret manager injection |
| Custody topology undocumented | S1 | CR-005: finance + legal sign-off |
| Quote TTL enforcement unknown (15 sec required) | S1 | CR-011: implement + test |
| Webhook signature code not reviewed | S1 | CR-013: review against current Quidax docs §5.1 |
| Mobile UI screens missing or incomplete | S2 | CR-003, CR-019–023: inventory + build |
| Admin reporting SQL unknown | S2 | CR-026: design + validate reconciliation |
| Legal/compliance gates not approved | S1 | CR-007: required before UAT |

---

## Test Traceability (from Workplan §11.1)

| Work ID | Test IDs | Priority |
|---|---|---|
| CR-009 | T006, T021–T023, T043–T045 | P0 |
| CR-011 | T021–T029, T042 | P0 |
| CR-012 | T031–T041, T064 | P0 |
| CR-013 | T049–T060 | P0 |
| CR-014 | T061–T073 | P0 |
| CR-015 | T069, T073, T074 | P0 |
| CR-019–023 | T076–T096 | P0 |
| CR-026 | T097, T108–T113 | P0 |

---

**Next:** Detailed code review (CR-002) and baseline test run (CR-001) before implementation begins.

