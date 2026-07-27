# Module: Settlement

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes &nbsp;·&nbsp; **Feature flag:** none of its own — a service library used inside flag-gated modules (transport, stays, top5events, health, crowdfunding, etc.)
**Code:** `backend/internal/finance/settlement/` (`model.go`, `service.go`, `model_test.go`, `split_invariant_test.go`); DB-free oracle `backend/tests/settlement_split_test.go`
**Slug:** `SETTLEMENT` (uppercase, used in Case IDs)

## 1. Overview & scope

Settlement is the **escrow-then-split** money primitive: a payer's funds are held (`Escrow`), then released as a conserving split across platform / provider / optional rider legs (`Settle`), or fully returned (`Refund`). It is a Go library (no HTTP surface of its own) constructed as `settlement.NewService(pool, ledgerSvc)` inside each marketplace vertical. The load-bearing invariant is **conservation**: for any split percentages and any total, `platform + rider + provider == total` to the kobo, with the **provider leg absorbing the rounding remainder** and no negative leg. This is the concrete realization of `../cross-cutting/money-invariants.md` I9 (MONEY-INV-011). All legs + the status flip commit in one pgx tx under `SELECT … FOR UPDATE`.

## 2. Services / endpoints in scope

| Operation | Method + path (or service func) | Auth / permission | Money-path? |
|---|---|---|---|
| Hold funds | `Escrow(ctx, payerID, ref, idemKey, moduleType, totalKobo) (*Settlement, error)` | library (caller enforces authz) | yes |
| Split & release | `Settle(ctx, settlementID, Split) error` | library | yes |
| Full refund | `Refund(ctx, settlementID, reason string) error` | library | yes |
| Split validation | `Split.Validate() error` | library (pure) | n/a |

`Split` fields: `ProviderID`, `ProviderPct`, `PlatformPct`, `RiderID *string`, `RiderPct`. Computation in `Settle`: `platformKobo = int64(total*PlatformPct)`, `riderKobo = int64(total*RiderPct)` (only when `RiderID != nil`), `providerKobo = total − platformKobo − riderKobo`. Accounts: `Escrow` debits payer → `AccountEscrow`; `Settle` posts each non-zero leg from escrow to provider/commission/rider; `Refund` credits payer from escrow.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Status constants + lifecycle order | unit | `internal/finance/settlement/model_test.go` (`TestStatusConstants`, `TestLifecycleOrder`) | AUTOMATED |
| `Split.Validate` (sum=1.0±ε, no negative, orphan rider) | unit | `model_test.go` (`TestSplitValidateMethod`, 9 cases) | AUTOMATED |
| Split legs sum to total exactly (conservation) | inv | `split_invariant_test.go` (`TestSettleSplitsSumToEscrowedExactly`), `tests/settlement_split_test.go` | AUTOMATED (pure-logic mirror) |
| Provider absorbs rounding remainder | inv | `tests/settlement_split_test.go` (`TestSettlementSplit_ProviderAbsorbsRounding`) | AUTOMATED |
| Zero legs skipped (no `amount>0` CHECK violation) | inv | `split_invariant_test.go` (`TestSettleZeroLegsAreSkipped`) | AUTOMATED |
| Per-leg idempotency keys distinct | inv | `split_invariant_test.go` (`TestSettleIdempotencyKeysAreDistinct`) | AUTOMATED |
| Escrow single debit / single row | inv | `split_invariant_test.go` (`TestEscrowSingleDebitSingleRow`, `fakeStore`) | AUTOMATED (in-memory) |
| Settle idempotent on retry | inv | `split_invariant_test.go` (`TestSettleIdempotentOnRetry`) | AUTOMATED (in-memory) |
| Refund full + idempotent | inv | `split_invariant_test.go` (`TestRefundFullAndIdempotent`) | AUTOMATED (in-memory) |
| State machine transitions | fsm | `split_invariant_test.go` (`TestStateMachineTransitions`), `model_test.go` | AUTOMATED (in-memory) |
| Real Postgres FOR UPDATE + ON CONFLICT | int | — (no `TEST_DATABASE_URL` path) | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `SETTLEMENT-INV-001` | Escrow holds full amount | P0 | funded payer | `Escrow` | `totalKobo=100000` | Payer debited `100000` → escrow; row `status=escrowed`; one debit, one row |
| `SETTLEMENT-INV-002` | Split conserves total (even) | P0 | escrowed `100000` | `Settle` platform 20% provider 80% | `.20/.80` | platform `20000` + provider `80000` == `100000` |
| `SETTLEMENT-INV-003` | Provider absorbs remainder (odd total) | P0 | escrowed `10007` | `Settle` platform 33% provider 67% | `10007`, `.33/.67` | legs sum to `10007` exactly; provider leg carries the odd kobo; no negative leg |
| `SETTLEMENT-INV-004` | Three-way with rider conserves | P0 | escrowed `99991`, RiderID set | `Settle` platform/provider/rider | prime total | platform+rider+provider == `99991`; provider absorbs remainder |
| `SETTLEMENT-INV-005` | Rider leg absent when RiderID nil | P1 | escrowed, RiderID nil | `Settle` | — | No rider leg posted; `riderKobo=0` |
| `SETTLEMENT-INV-006` | Zero-value leg skipped | P1 | escrowed, platform 100% provider 0% | `Settle` | `.0` provider | Provider leg skipped (no `amount_kobo>0` violation); platform gets all |
| `SETTLEMENT-INV-007` | 1-kobo all-provider | P1 | escrowed `1` | `Settle` provider 100% | `1` | Provider `1`; conserved |
| `SETTLEMENT-INV-008` | Settle idempotent on retry | P0 | already settled | `Settle` again (same id) | — | No second credit (per-leg keys + `ON CONFLICT`); balances unchanged |
| `SETTLEMENT-INV-009` | Escrow replay no double-debit | P0 | escrow posted | `Escrow` again same `idemKey` | same key | Returns existing row; single debit total |
| `SETTLEMENT-INV-010` | Refund returns full amount, idempotent | P0 | escrowed | `Refund` then `Refund` again | — | Payer credited `total` once; status `refunded`; 2nd is no-op |
| `SETTLEMENT-UNIT-001` | Split must sum to 1.0 | P0 | — | `Validate` sum `0.99`, `1.01` | off-by | Error `split must sum to 1.0, got %.6f` |
| `SETTLEMENT-UNIT-002` | Negative pct rejected | P0 | — | `Validate` platform `-0.1` | negative | Error |
| `SETTLEMENT-UNIT-003` | Orphan rider share rejected | P1 | — | `Validate` RiderPct>0, RiderID nil (or RiderID set but sum short) | orphan | Error (sum excludes rider when RiderID nil) |
| `SETTLEMENT-FSM-001` | Settle only from escrowed | P0 | status `settled` | `Settle` again | — | Rejected `cannot settle — current status is settled` |
| `SETTLEMENT-FSM-002` | Refund only from escrowed/disputed | P0 | status `settled` | `Refund` | — | Rejected `cannot refund — current status is settled` |
| `SETTLEMENT-SEC-001` | Split validated before any post | P0 | escrowed | `Settle` invalid split | sum≠1 | Rejected before any ledger leg; no partial post |
| `SETTLEMENT-SEC-002` | Flag-off host module | P1 | hosting module flag off | Invoke settlement via that module's route | — | Route not mounted (settlement inherits host flag) — FLAG-SEC-001 |

## 5. State-machine transitions

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| (none) | `Escrow` | `escrowed` | payer debited → `AccountEscrow`; row inserted | `SETTLEMENT-INV-001` |
| `escrowed` | `Settle(split)` | `settled` | balanced legs escrow→provider/commission/rider; `settled_at`, `provider_kobo`, `fee_kobo` set | `SETTLEMENT-INV-002` |
| `escrowed` | `Refund` | `refunded` | payer credited full `total` from escrow | `SETTLEMENT-INV-010` |
| `disputed` | `Refund` | `refunded` | payer credited full `total` | `SETTLEMENT-FSM-002` (allowed branch) |
| `settled` | `Settle`/`Refund` | — | rejected (terminal) | `SETTLEMENT-FSM-001/002` |
| `refunded` | any | — | rejected (terminal) | `SETTLEMENT-FSM-002` |

`releasing` and `disputed` statuses exist; `Settle` requires exactly `escrowed`. Re-entering a terminal state is rejected (not silently idempotent) except via the idempotency-key replay path (`SETTLEMENT-INV-008/010`). **Finding:** `Refund` reads the row **without** `FOR UPDATE` (unlike `Settle`) and does not persist `reason` — worth a concurrency test (`SETTLEMENT-INV-010` under two concurrent refunds).

## 6. Security & abuse cases

- **Conservation is the S1 invariant:** any split that leaks or invents kobo is a blocker — `SETTLEMENT-INV-002..007`, MONEY-INV-011.
- **Split re-derived, not client-trusted:** `Settle` computes leg amounts from `total × pct` server-side; validate the caller cannot pass pre-split kobo amounts.
- **No negative / zero leg posts:** `if xKobo > 0` guard (`SETTLEMENT-INV-006`).
- **Idempotency across Escrow/Settle/Refund:** per-leg suffixed keys + `settlements.idempotency_key` UNIQUE (`SETTLEMENT-INV-008/009/010`).
- **Refund concurrency (finding):** no `FOR UPDATE` on refund read — test two concurrent `Refund` calls do not double-credit.

## 7. Automated specs to add

- `internal/finance/settlement/live_db_integration_test.go` — skip-gated on `TEST_DATABASE_URL`; real `Escrow`→`Settle`→`Refund` proving `FOR UPDATE` serialization, `ON CONFLICT` dedup, and the `amount_kobo>0` CHECK vs zero-leg skip. Oracle: `tests/settlement_split_test.go`. (gap G5)
- Concurrency test: N goroutines calling `Settle` and `Refund` on one settlement id → exactly one terminal outcome, conserved (targets the missing `FOR UPDATE` on `Refund`).
- Property test extending `split_invariant_test.go` with randomized totals/pcts asserting conservation + provider-remainder for thousands of cases.

## 8. Coverage target & exit criteria

Tier-0: **≥ 85%** pure-logic (split math already well covered). Exit: conservation + provider-remainder + no-negative-leg proven on **real Postgres**; state machine (escrowed→settled/refunded, terminal rejection) proven at the DB seam; Escrow/Settle/Refund idempotency proven with real unique constraints; Refund concurrency safe. Any conservation failure is an S1 blocker.
