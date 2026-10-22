# ADR-PR859: Crypto operational controls are one versioned record, enforced fail-closed on both rails

**Status:** Accepted · **Date:** 2026-10-22 · **Area:** crypto / operations / money path

## Context
The workplan's admin section (RQ-ADM) asks for a market switch, a global withdrawal kill switch, editable trade limits and a customer maintenance banner. Crypto runs on two rails today:
- **The Quidax rail** (`cryptosvc`: quote, confirm, settle).
- **The legacy internal-ledger book** (`internal/crypto`: buy/sell/swap/withdraw, admin withdrawal approval).

Any control that gated only one rail could be bypassed through the other. These switches are pulled during incidents, so a control that silently failed open would be worse than having none.

## Decision
- **One record, one store.** `crypto_controls` holds the whole operational state in each row: trading paused, withdrawals paused, disabled markets, per-trade NGN limit and the banner.
  - The active state is the highest version, and no row means everything is open.
  - Rows are append-only. Triggers refuse UPDATE, DELETE and TRUNCATE.
  - A change is a new row, written with its `crypto_audit_log` entry in one transaction under an advisory lock, so history can't be rewritten.
  - Writers state the version they read (409 if it's stale) and an Idempotency-Key. Every change needs a reason.
- **Enforced on both rails and fail-closed.** If the controls can't be read, quotes, confirms, legacy trades, withdrawals and approvals are refused. Nothing proceeds as if everything were open.
  - `cryptosvc` reads the store directly.
  - `internal/crypto` receives two plain funcs through `WithControls`, so it doesn't import `cryptosvc`. App wiring maps the refusals onto the legacy package's errors.
- **The trading pause is checked before money is held.** Quote and confirm check it before the NGN hold. A swap already at the provider settles normally, since stopping it there would strand funds.
- **The kill switch stops dispatch, not recovery.** New withdrawals and admin approvals are refused. Rejections stay allowed, because they return the customer's parked units.
- **One per-trade limit for both sides.** It caps the NGN value of a buy or sell quote. It can only be lower than the code ceiling (`MaxQuoteKobo`), never higher.
- **Customers read the same state** through `GET /crypto/status`, which returns 503 when unreadable, never "all open". The app uses it for the banner and to disable paused actions.

## Consequences
- **A database outage pauses crypto.** That's the intended trade-off for a safety control.
- **Controls are read once per request** (no cache), so a change applies to the next request on every replica.
- **Daily or per-user limits aren't covered.** Those are tier limits, enforced by the tiers service on the NGN debit.
