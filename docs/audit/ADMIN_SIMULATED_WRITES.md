# Admin console — simulated writes

**Date:** 2026-08-19 · **Scope:** `frontend-admin/src/services/*.ts` · **Trigger:** the same defect found three times by accident (merchant onboarding `d9906930`, restaurant admin `fcfc72cb`, mobile merchant module `686a045b`).

## The shape

An admin service defaults to fixtures. Its **mutation** functions, in fixture mode, mutate an in-memory array (or nothing) and return a success value. The operator clicks Approve, sees success, and **nothing happens server-side**.

This is worse than a broken button. A broken button gets reported. A button that reports success trains people to trust it, and the divergence is discovered later — or never.

Concrete precedent, already fixed: the restaurant KYB console approved applications into an in-memory array while `payout.go` gates payouts on `kyb_status = 'approved'`. **709 outlets are currently trading and unpayable**, and a console reporting approvals it never performed is a plausible reason nobody noticed.

## Verified findings

Each read by hand, not pattern-matched.

### 1. `creatorsAdminService.decidePayout` — fabricated audit claim
```ts
return { id, status: 'approved', audit_id: aud(),
  message: `Creator ${id} payout approved. KYC gate (NL-10) passed. Recorded to immutable audit (NL-12).` };
```
Returns a message asserting a KYC gate passed and an immutable audit entry was written. **Neither happened.** It also simulates a `kyc_hold` branch, so the operator sees what looks like a working fail-closed control.
**Backend: not found.**

### 2. `escrowAdminService.decideEscrowFraud` — fabricated audit claim
```ts
return { id, status, audit_id: aud(),
  message: `Escrow fraud signal ${id}: ${action} applied. Recorded to immutable audit (NL-12).` };
```
Same fabricated "Recorded to immutable audit". Blocking or clearing an escrow fraud signal does nothing.
**Backend: not found.**

### 3. `tradingAdminService.bypassKyc` — a KYC bypass that never happened
Enforces maker-checker rules client-side (written justification, second approver, TTL ≤ max), then in fixture mode returns a record with `status: 'BYPASSED'` and a computed expiry. The operator sees a bypass applied, with an expiry date, against a user who was never bypassed.
**Backend: not found.**

### 4. `referralAdminOpsService.approvePayout` — money mutation, no-op
```ts
if (USE_MOCK) { await delay(); return { ok: true }; }
// Money mutation: backend requires Idempotency-Key + audit event.
```
The comment states the requirements one line below the branch that skips all of them.
**Backend: not found.**

### 5. `investAdminService.runSettlement` — reports work it did not do
```ts
if (USE_MOCK) { await delay(); return 3; }
```
Returns `3`, rendered as "3 settlements processed".
**Backend: EXISTS** (`settlement/run`) — this one is a default away from working.

### 6. `cryptoAdminService.adminDecideWithdrawal` — approves crypto withdrawals
Mutates `MOCK_WITHDRAWALS` and returns the updated withdrawal. Approving sets `status: 'pending'`, i.e. "queued for payout".
**Backend: EXISTS** (`internal/crypto/admin_handler.go` → `POST /admin/crypto/withdrawals/:id/decision`) — also a default away from working.

## Candidate list (NOT verified)

A scan flagged **214 mutation functions across ~40 services** whose fixture branch returns without a network call. That number is an upper bound and **over-reports** — it caught read-only functions (`getCampaign`, `getAnalytics`) through imprecise function-body splitting. Treat it as a work list, not a finding count.

Money-touching services in that list, highest concern first:

| Service | Examples |
|---|---|
| `cryptoAdminService` | `adminDecideWithdrawal`, `adminDecideAddress` |
| `escrowAdminService` | `decideEscrowFraud` |
| `creatorsAdminService` | `decidePayout`, `decideCreatorFraud`, `updateFeeConfig` |
| `eventsAdminService` | `decideVendorPayout`, `resolveSettlementBreak` |
| `referralAdminOpsService` | `approvePayout`, `decideReview` |
| `investAdminService` | `runSettlement`, `createDividend`, `updateFees` |
| `fxAdminService` | `forceReverseTransaction`, `retryTransaction`, `rebalanceNow` |
| `healthLab/Pharmacy/VetAdminService` | `decidePayout` (each) |
| `staysAdminService` | `decideRefund`, `resolveBreak` |
| `insuranceAdminService` | `decideRefund`, `resolveBreak` |
| `commissionService` | `createConfig`, `updateConfig` |
| `marketplaceAdminService` | `approveListing`, `rejectListing` (27 total) |

## What NOT to do

**Do not flip the defaults in bulk.** Four of six verified findings have **no backend at all** — the fixture is load-bearing, and flipping them live turns a silent no-op into a visible 404. That is better, but it is a product decision (the console loses the control entirely), not a mechanical change.

## Recommended sequence

1. **Flip the two that have backends** — `investAdminService.runSettlement`, `cryptoAdminService.adminDecideWithdrawal` — and pin each with a test asserting the default reaches the network, as done in `fcfc72cb`. Small, high value: a crypto withdrawal approval is currently a no-op.
2. **For the rest, make the state honest.** A control whose backend does not exist should be visibly disabled with "not yet available", not a button that returns success. The fastest safe change is to stop the fixture branches of *mutations* from returning success — throw "not implemented in this environment" instead. Reads can keep their fixtures.
3. **Delete the fabricated assurances now**, regardless of sequencing. `"Recorded to immutable audit (NL-12)"` and `"KYC gate (NL-10) passed"` are compliance claims about events that did not occur; they are the most dangerous strings in this codebase.
4. **Add a lint/CI guard**: a mutation function whose fixture branch returns a success shape is the pattern to ban. Cheaper than finding the fifth instance by accident.

## Confidence

- The six findings above: **verified by reading the code**.
- Backend existence: verified by grep over `backend/**/*.go`. An earlier pass reported "no backend" for all six — that was a **broken grep** (unquoted `--include=*.go` under zsh), corrected here. Two do exist.
- The 214 figure: **unverified upper bound** from pattern matching.
