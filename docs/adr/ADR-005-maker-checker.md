# ADR-005 — Maker-Checker Pattern for Manual Wallet Adjustments

**Status:** Accepted  
**Date:** 2026-06-16  
**Author:** Engineering (Block 9 — Fintech Admin RBAC)

---

## Context

Ops and finance teams occasionally need to credit or debit user wallets outside normal transaction flows — e.g., compensation for a failed bank transfer, chargeback resolution, or contest prize disbursement. These are high-risk operations because they directly affect real money balances with no automatic counterparty or payment provider record.

The risk profile splits cleanly by amount:

| Amount | Risk | Required control |
|--------|------|-----------------|
| < ₦100,000 | Low (common ops task, easily spotted in audit) | Single authorized person (maker) |
| ≥ ₦100,000 | High (material amount; fraud/error hard to reverse) | Second authorized person (checker) |

---

## Decision

Implement a **two-tier approval flow** (maker-checker) for manual adjustments:

1. A `finance_maker` (or `finance_admin`) calls `POST /api/v1/admin/adjustments`.
2. If `amount_kobo < 10,000,000` (₦100,000): adjustment **executes immediately** in the same request.
3. If `amount_kobo ≥ 10,000,000`: adjustment is persisted as `pending_approval`; a different user with `finance:adjust:approve` must call `POST /api/v1/admin/adjustments/:id/approve`.
4. Self-approval is blocked at two layers: service-layer guard + `CHECK (checker_id <> initiator_id)` in the `admin_adjustments` table.

### Key design choices

**Checker stamps before execution.** The `checker_id / checker_role / checked_at` columns are written to the DB before the ledger mutation fires. If the ledger call fails mid-flight, the audit trail still shows who approved and when, and ops can retry without losing the attribution.

**Idempotency-Key on both routes.** The initiation route requires `Idempotency-Key` to prevent double-submission on retry. The approve route also accepts one (forwarded to the internal `creditWallet`/`debitWallet` call as `admin-adjustment:<key>`) so the ledger entry is idempotent.

**Immediate-execute path shares code.** Small adjustments still create an `admin_adjustments` row (for audit), immediately transition it to `executed`, and run the same `executeAdjustment()` path that the approve route uses. No separate code path.

**Finance roles** (RBAC):
- `finance_maker`: can initiate, cannot approve
- `finance_checker`: can approve/reject, cannot initiate  
- `finance_admin`: can do both (senior ops lead role)
- `finance_viewer`: read-only

---

## Alternatives Considered

**No threshold, always require checker.** Too slow for routine ₦500 support credits. Adds friction without proportional risk reduction.

**No threshold, always auto-execute.** Removes the audit trail for large amounts. Increases fraud risk for high-value adjustments.

**Threshold configurable via env var.** Adds complexity. The ₦100,000 threshold is a business rule, not an env-tunable constant. It should live in code where it's visible and version-controlled.

---

## Consequences

- Every manual adjustment — even auto-executed ones — has an immutable row in `admin_adjustments`.
- The `ledger_entries` table gains `admin_adjustments.ledger_entry_id` as a soft reference for the audit trail.
- `finance_admin` role can now unilaterally approve its own adjustments (it holds both `initiate` + `approve`). This is intentional for senior leads but should be monitored via the `audit:view` logs.
- Block 12 (beneficiary management) is independent and can proceed in parallel.
