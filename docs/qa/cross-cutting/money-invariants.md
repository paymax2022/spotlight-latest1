# Cross-cutting: Money Invariants

**Risk tier: 0. These invariants apply to EVERY money mutation in every module.** A module
file's money cases inherit this list — run these against the module's own debit/credit
operations. Failure of any invariant is an **S1 blocker**.

Sources: `backend/internal/finance/ledger/` (`service.go`, `repository.go`, reversal/TOCTOU
tests), `backend/internal/escrow/`, `backend/internal/finance/settlement/`,
`backend/tests/ledger_invariants_test.go` (DB-free reference model = executable spec),
`backend/tests/settlement_split_test.go`, `backend/tests/transfer_fees_example_test.go`,
`frontend-web/tests/unit/finance/money-invariants.spec.ts`.

## 1. The invariants (the oracle)

| # | Invariant | Meaning |
|---|---|---|
| I1 | **Integer kobo only** | Amounts are positive `int64` minor units. No floats, no string math, no naira decimals. |
| I2 | **Balanced double-entry** | Every journal's debits == credits to the kobo. No single-legged posting. |
| I3 | **Balance = projection of ledger** | A wallet balance is computed from entries, never a directly-updated column. |
| I4 | **No overdraw** (where disallowed) | A debit that would take balance < 0 is rejected; balance untouched. |
| I5 | **Idempotent replay** | Re-posting with the same `Idempotency-Key` returns the same result and does **not** add entries (count stays 2, not 4). |
| I6 | **Concurrent same-key → exactly one** | N concurrent posts with one key → exactly one success, others no-op. |
| I7 | **Reversal restores + appends** | A reversal posts compensating entries restoring the prior balance; it never mutates/deletes history. |
| I8 | **Reversal idempotent** | Reversing an already-reversed journal does not double-refund. |
| I9 | **Settlement conservation** | For any split, `platform + rider/agent + provider == total` to the kobo; provider/National body absorbs the rounding remainder; no negative leg. |
| I10 | **Mandatory Idempotency-Key** | Money-mutating requests require an `Idempotency-Key` (≥8 chars per openapi); absent key → rejected. |
| I11 | **Audit emitted** | Every money mutation emits an audit event (see `feature-flags-and-audit.md`). |
| I12 | **Tier limits fail-closed** | A debit over the caller's tier limit is rejected; a tier/KYC lookup error blocks (503), never allows. (see `kyc-and-tiers.md`) |

## 2. Manual test cases (run per money module, substituting its endpoint)

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| MONEY-INV-001 | Kobo integer round-trip | P0 | — | Post a credit then read balance | `100000` (₦1,000) | Balance exactly `100000`; no float drift |
| MONEY-INV-002 | Float/decimal amount rejected | P0 | — | Submit `amount=1000.5` or `"1000"` string | invalid | 400 validation error; nothing posted |
| MONEY-INV-003 | Balanced journal | P0 | — | Perform any transfer | — | Sum of debit legs == sum of credit legs |
| MONEY-INV-004 | Balance equals projection | P0 | seeded wallet | Post several entries; recompute from entries | — | Reported balance == sum(entries); no cached-column divergence |
| MONEY-INV-005 | Overdraw rejected | P0 | wallet balance `100000` | Debit `150000` | over-balance | Rejected; balance stays `100000` |
| MONEY-INV-006 | Idempotent replay (no double-post) | P0 | — | POST money mutation twice with **same** Idempotency-Key | same key | 2nd returns same result; entry count unchanged; no double-charge |
| MONEY-INV-007 | Concurrent same-key → one success | P0 | — | Fire N concurrent posts, one key | same key, N=10 | Exactly 1 succeeds; balance moved once |
| MONEY-INV-008 | Missing Idempotency-Key rejected | P0 | — | POST money mutation with no key (or <8 chars) | no key | Rejected (400) |
| MONEY-INV-009 | Reversal restores balance | P0 | a completed debit | Post reversal | — | Balance == pre-debit; compensating entries appended; original entries intact |
| MONEY-INV-010 | Reversal idempotent | P0 | already-reversed journal | Reverse again (same key) | — | No second refund; balance unchanged |
| MONEY-INV-011 | Settlement split conservation | P0 | a settleable transaction | Compute split | %/amount split | legs sum to total; provider absorbs remainder; no negative leg |
| MONEY-INV-012 | Audit event on mutation | P1 | — | Perform a mutation; inspect audit sink | — | Exactly one audit event with actor, amount, idempotency ref |
| MONEY-INV-013 | Kobo-exact comparison (no naira tolerance) | P0 | — | Compare amounts across the flow | e.g. `99999` vs `100000` | Treated as mismatch (no ±₦1 tolerance) — tracks gap G8 |

## 3. Security & abuse cases

- **Amount tampering:** client-supplied fee/price must be re-derived server-side; a request
  claiming a cheaper fee must not be honored (trading backend already re-prices; assert per
  vertical).
- **Negative / zero amount:** rejected with 400.
- **Replay across idempotency scope:** the same key on a *different* logical operation must not
  silently return a stale success.

## 4. Automated specs to add

- Per-money-module `live_db_integration_test.go` exercising I2–I7 against real Postgres
  (constraints + advisory locks), using the reference model in `ledger_invariants_test.go` as
  the oracle. (gap G5)
- Concurrent-same-key integration test firing N goroutines at the unique constraint (I6). (gap G7)
- Tighten `voting/free-vote.spec.ts` to kobo-exact (I13 / gap G8).

## 5. Coverage target & exit criteria

`internal/finance/...`, `internal/crypto`, `internal/orchestration` ≥ 85% on pure-logic money
funcs. Exit: I1–I12 proven on ledger + every Tier-0 money module's own operations; no S1 open.
