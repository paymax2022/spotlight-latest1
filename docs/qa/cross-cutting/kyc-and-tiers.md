# Cross-cutting: KYC & Account Tiers

**Risk tier: 0.** Tiers gate money limits fail-closed; KYC is a state machine feeding tier
upgrades and gating sensitive actions. Sources: `backend/internal/finance/tiers/`
(`service.go`, `service_test.go`), `backend/internal/finance/kyc/`,
`backend/internal/finance/kycverify/` (state machine + orchestrator + provider routing +
webhooks, `statemachine_test.go`), web `frontend-web/tests/unit/tiers/tier-limits.spec.ts`,
`frontend-web/tests/unit/kyc/`.

## 1. Facts

- **Tier limits** resolve per user; `EnforceWalletDebitLimit` blocks a debit over the daily/
  per-tx limit. **Fail-closed:** a tier-lookup or daily-debit-query **error** must block (503),
  never allow. Boundary-at-exact-limit is allowed.
- **KYC verify** is FSM-driven with provider routing (Dojah/SmileID/YouVerify) and webhook
  ingestion of results. Tier upgrades depend on KYC level; some actions (bank transfer,
  crypto withdraw, referral withdraw) are KYC-gated.

## 2. KYC state machine (transitions to test — verify exact names in `kycverify/statemachine.go`)

| From | Event | To | Side effect |
|---|---|---|---|
| `unverified` | submit | `pending` | provider request created |
| `pending` | provider approve (webhook) | `verified` | tier upgrade eligible; audit |
| `pending` | provider reject (webhook) | `rejected` | no upgrade; reason recorded |
| `pending` | needs-more-info | `needs_info` | resubmit allowed |
| `needs_info` | resubmit | `pending` | new provider request |
| `verified` | submit again | `verified` (idempotent) | no duplicate upgrade |
| `rejected` | resubmit | `pending` | allowed |

Illegal transitions (e.g. `unverified → verified` directly, or approving a `rejected` record
without resubmit) must be **rejected**.

## 3. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| TIERS-UNIT-001 | Debit under limit allowed | P0 | `qa-user-a` Tier 1, limit L | Debit `L-1` | under limit | Allowed |
| TIERS-UNIT-002 | Debit at exact limit allowed | P0 | Tier 1, limit L | Debit exactly `L` | boundary | Allowed |
| TIERS-UNIT-003 | Debit over limit rejected | P0 | Tier 1, limit L | Debit `L+1` | over | Rejected (limit error) |
| TIERS-SEC-001 | Fail-closed on tier lookup error | P0 | force tier lookup to error | Attempt a debit | — | **Blocked (503)**, never allowed |
| TIERS-SEC-002 | Fail-closed on daily-debit query error | P0 | force daily-debit query to error | Attempt a debit | — | Blocked (503) |
| TIERS-UNIT-004 | Daily aggregate enforced | P1 | multiple debits same day | Sum approaching limit, then exceed | — | Debit crossing daily cap rejected |
| TIERS-SEC-003 | Tier-limit flag off behavior | P1 | `FEATURE_TIER_LIMITS_ENABLED` off | Debit over nominal limit | — | Per documented off-behavior (no enforcement) — confirm intended for env |
| KYC-FSM-001 | Submit → pending | P0 | `qa-user-kyc0` | Submit KYC | valid docs | State `pending`; provider request created |
| KYC-FSM-002 | Approve webhook → verified | P0 | pending KYC | POST signed approve webhook | sandbox | State `verified`; tier upgrade eligible; audit |
| KYC-FSM-003 | Reject webhook → rejected | P0 | pending | POST reject webhook | — | State `rejected`; no upgrade |
| KYC-FSM-004 | Needs-info → resubmit loop | P1 | pending | needs-info → resubmit → pending | — | Loop works; new provider request |
| KYC-FSM-005 | Re-submit when verified is idempotent | P0 | verified | Submit again | — | No duplicate tier upgrade |
| KYC-FSM-006 | Illegal transition rejected | P0 | unverified | Attempt direct `→ verified` (spoofed) | — | Rejected |
| KYC-SEC-001 | KYC-gated action blocked without KYC | P0 | `qa-user-kyc0` | Attempt bank transfer / crypto withdraw / referral withdraw | — | Blocked with KYC-required error |
| KYC-SEC-002 | KYC webhook signature enforced | P0 | pending | POST unsigned/forged result | forged | Rejected; state unchanged |
| KYC-INT-001 | Provider routing | P1 | multiple KYC providers configured | Submit; observe routed provider | — | Correct provider adapter invoked; failover per config |

## 4. Automated specs to add

- Integration test for `EnforceWalletDebitLimit` DB-error branch with a faked/erroring pool
  (TIERS-SEC-001/002, gap G6).
- Extend `kycverify/statemachine_test.go` with the illegal-transition and idempotent-reverify
  cases (KYC-FSM-005/006).
- KYC webhook signature test (KYC-SEC-002) alongside `webhooks-and-providers.md`.

## 5. Coverage target & exit criteria

`finance/tiers` + `finance/kycverify` ≥ 85% pure-logic. Exit: fail-closed proven at the DB
seam; all KYC allowed + rejected transitions proven; KYC-gated actions denied without
verification.
