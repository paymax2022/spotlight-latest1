# Test Plan

Test risk, not lines. Critical paths here are **money movement, webhook settlement, reconciliation, and authorization** — they get the deepest coverage. Push logic to fast unit tests; reserve integration tests for the seams (DB, queue, Maplerad adapter mocked at the network edge); keep e2e to a few smoke journeys.

## Invariant → test mapping

Each CLAUDE.md invariant must have failing-test protection:

| # | Invariant | Tests (level) |
|---|---|---|
| 1 | Domain calls ports only; Maplerad confined to adapter | Static/lint check: no Maplerad import outside `/adapters/maplerad` (unit/CI). Adapter satisfies the port contract (unit). |
| 2 | Ledger append-only; balances derived | DB rejects UPDATE/DELETE on ledger (integration). Derived balance = sum of entries (unit). No mutable balance field exists (schema test). |
| 3 | Client reference idempotency on money calls | Same `ref` twice → one provider call, one ledger effect (integration). |
| 4 | Webhooks verified, deduped, idempotent, audited | See "Webhooks" below. |
| 5 | Guarded state machines | See "Transfer state machine" below. |
| 6 | Immutable audit on money + webhooks | Every money op / webhook receipt writes an audit row; audit is append-only (integration). |
| 7 | KYC tier gates capability before Maplerad | Under-tier user blocked before any adapter call (unit + integration). |
| 8 | Secrets in vault; sandbox/live separated | No secret literals in repo/image (CI scan). Wrong-env key never used in prod config (unit). |

## Transfer state machine (unit-heavy)

- **Allowed transitions** produce correct next state + ledger effect: INITIATED→PENDING posts a hold; PENDING→SUCCESS finalizes; PENDING→FAILED reverses hold; PENDING→REVERSED writes compensating entry.
- **Disallowed transitions rejected:** e.g. INITIATED→SUCCESS (skipping webhook), SUCCESS→PENDING, terminal→anything.
- **Idempotent terminals:** replaying SUCCESS/FAILED is a no-op (no double finalize/reverse).
- **Insufficient balance** at INITIATED is rejected before any provider call.
- **Orphan:** PENDING past TTL with no webhook → re-query resolves to correct terminal (integration).

## Webhooks (integration-heavy)

- **Signature:** valid passes; invalid/missing rejected (no ledger effect).
- **Dedupe/replay:** same `event_id` delivered 3× → exactly one ledger posting.
- **Out-of-order:** reversal arriving before/after success resolves to correct final ledger state.
- **Unknown event type:** stored + logged, not dropped, no crash.
- **ACK timing:** endpoint acks fast; heavy work is enqueued (assert async path).
- **Inbound VA credit:** webhook → exactly one CREDIT keyed by event ref; user notified once.

## Reconciliation (integration)

- **In sync:** ledger == Maplerad report → no drift, no alert.
- **Injected drift:** seed a mismatch → quarantined + alert fired to owner; **no silent auto-correct**.
- **Resolution:** correction is an append-only compensating entry, audited — never a balance edit.
- **Orphan sweep:** dangling PENDING transfers are picked up and resolved.

## Authorization (unit + integration)

- Every protected action: **allowed caller succeeds, denied caller forbidden.**
- **Object-level:** user A cannot open/inspect/transfer on user B's wallet, VA, or transfer.
- Role split honored: only system/scheduler may drive activation/expiry-type transitions.

## Money & ledger invariants

- Balance always reconciles to ledger sum.
- No disallowed negative balance.
- Double-submit / retry never double-charges (ties to invariant 3).
- Currency rules enforced (NGN v1; USD wallet-type routing when phase 2 lands).

## Contract tests (adapter ⇄ Maplerad)

- Mock Maplerad at the network boundary; assert request/response mapping for Identity, Collections, Transfer, Counterparty, Bills.
- A breaking shape change (renamed field, status code) fails CI, not production.
- Pin to the caveats in `caveats-and-decisions.md` (VA naming, bills sync/webhook) so regressions surface early.

## Suite hygiene & CI gate

- Tests isolated, deterministic, no order dependence; synthetic data only, never real PII.
- Remove nondeterminism (freeze time, seed randomness, no live network).
- Full unit + integration suite blocks merge; deploy pipeline runs a smoke e2e (open VA → simulate credit → transfer → reconcile) + dependency/secret scan.
- Every escaped bug gets a reproducing regression test first.

## Definition of done

- [ ] Each CLAUDE.md invariant has at least one protecting test
- [ ] State machine: allowed + rejected transitions + idempotent terminals
- [ ] Webhooks: signature, replay/dedupe, out-of-order, unknown-type
- [ ] Reconciliation: in-sync, injected drift alerts, no silent auto-correct
- [ ] AuthZ: allowed + denied + object-level for every protected action
- [ ] Money: reconciles, no bad negatives, double-submit safe
- [ ] Adapter contract tests catch breaking Maplerad changes in CI
- [ ] Suite deterministic + fast; CI gates merge; smoke e2e on deploy
