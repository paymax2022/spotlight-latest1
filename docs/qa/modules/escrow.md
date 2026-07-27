# Module: Escrow

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes &nbsp;·&nbsp; **Feature flag:** none of its own — a service library used inside flag-gated modules (creators, p2pmarket, health lab/pharmacy/vet, top5 P3, etc.); dispute arbitration guarded by host RBAC (`creators.dispute.arbitrate` / `p2p.dispute.arbitrate`)
**Code:** `backend/internal/escrow/` (`model.go`, `service.go`, `dispute.go`, `invariants_test.go`)
**Slug:** `ESCROW` (uppercase, used in Case IDs)

## 1. Overview & scope

Escrow is the **funds-hold with dispute/arbitration** primitive: `Hold` debits a payer into the shared `AccountEscrow` standing account; `Release` credits the payee; `Refund` credits the original payer; a party may `RaiseDispute` (HELD→DISPUTED) and `AddEvidence`, and a neutral arbiter resolves via `Arbitrate` (RELEASE or REFUND) under a **separation-of-duties** guard (arbiter must not be payer or payee). It is a Go library (no HTTP surface) constructed `escrow.NewService(pool, ledgerSvc, audit)` (audit may be nil). The FSM is enforced by a `canTransition` table (fail-closed on unknown states). Money invariants inherit from `../cross-cutting/money-invariants.md`; object-level authz (party-only dispute) and arbiter separation are the escrow-specific authz surface.

## 2. Services / endpoints in scope

| Operation | Method + path (or service func) | Auth / permission | Money-path? |
|---|---|---|---|
| Hold funds | `Hold(ctx, payerID, ref, moduleType, idemKey, amountKobo) (*Hold, error)` | library | yes |
| Release to payee | `Release(ctx, escrowID, payeeID) error` | library | yes |
| Refund payer | `Refund(ctx, escrowID) error` | library | yes |
| Get hold | `Get(ctx, escrowID) (*Hold, error)` | library (caller/RLS authz) | no |
| Raise dispute | `RaiseDispute(ctx, escrowID, raisedBy, evidence) (*Dispute, error)` | party-only (payer/payee) | no |
| Add evidence | `AddEvidence(ctx, escrowID, submittedBy, body) error` | party-only | no |
| Arbitrate | `Arbitrate(ctx, escrowID, decision, arbiterID) error` | host RBAC + separation-of-duties | yes (RELEASE/REFUND) |
| Get dispute | `GetDispute(ctx, escrowID) (*Dispute, error)` | library | no |

Statuses (`State`): `HELD`, `RELEASED`, `REFUNDED`, `DISPUTED`. Decision: `RELEASE`, `REFUND`. Ledger keys per leg: hold `idemKey+":hold"`, release `…:release`, refund `…:refund`.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Legal FSM transitions | fsm | `internal/escrow/invariants_test.go` (`TestEscrowFSM_LegalTransitions`) | AUTOMATED |
| Illegal transitions rejected | fsm | `invariants_test.go` (`TestEscrowFSM_IllegalRejected`, `TestEscrowFSM_TerminalStatesReject`, `TestEscrowFSM_UnknownStateRejects`) | AUTOMATED |
| Amount conservation (release+refund==held) | inv | `invariants_test.go` (`TestEscrowAmountConservation`, test-local model) | AUTOMATED (pure-logic mirror) |
| Reject non-positive Hold amount | unit | `invariants_test.go` (`TestHoldRejectsNonPositiveAmount`, nil pool) | AUTOMATED |
| Idempotency suffixes distinct | inv | `invariants_test.go` (`TestEscrowIdempotencySuffixes`) | AUTOMATED |
| Party-only dispute / arbiter separation | authz | — (guards in code, no test) | TODO |
| Real DB Hold/Release/Refund + FOR UPDATE | int | — (all pure-logic; no `TEST_DATABASE_URL`) | TODO |
| Release then ledger-credit atomicity gap | int | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `ESCROW-INV-001` | Hold debits payer to escrow | P0 | funded payer | `Hold` | `amountKobo=100000` | Payer debited `100000` → `AccountEscrow`; row `HELD`; balance is ledger projection |
| `ESCROW-INV-002` | Release credits payee exactly | P0 | HELD `100000` | `Release(payeeID)` | — | Payee credited `100000` from escrow; row `RELEASED`; escrow nets 0 for this ref |
| `ESCROW-INV-003` | Refund credits payer exactly | P0 | HELD `100000` | `Refund` | — | Payer credited `100000`; row `REFUNDED` |
| `ESCROW-INV-004` | Non-positive Hold rejected | P0 | — | `Hold` `0`, `-1` | `0`,`-1` | Rejected before DB/ledger; nothing posted |
| `ESCROW-INV-005` | Hold replay no double-debit | P0 | held | `Hold` again same `idemKey` | same key | Returns existing hold via `getByIdem`; single debit |
| `ESCROW-INV-006` | Release terminal replay is no-op | P1 | RELEASED | `Release` again | — | `from==to` → returns nil, no second credit (service-layer idempotent) |
| `ESCROW-AUTHZ-001` | Only a party may dispute | P0 | HELD, payer=A payee=B | `RaiseDispute` as C (stranger) | C id | `ErrDisputeNotParty` |
| `ESCROW-AUTHZ-002` | Only a party may add evidence | P1 | OPEN dispute | `AddEvidence` as stranger | — | `ErrDisputeNotParty` |
| `ESCROW-AUTHZ-003` | Arbiter separation of duties | P0 | DISPUTED, payer=A payee=B | `Arbitrate(RELEASE, arbiter=A)` and `(…, arbiter=B)` | A / B | `ErrArbiterConflict` in both cases |
| `ESCROW-AUTHZ-004` | Neutral arbiter allowed | P0 | DISPUTED | `Arbitrate(RELEASE, arbiter=C)` | C neutral | Success; escrow released to payee |
| `ESCROW-FSM-001` | Dispute from HELD | P1 | HELD | `RaiseDispute(payer)` | — | Row `DISPUTED`; dispute row `OPEN`; no money moves |
| `ESCROW-FSM-002` | Arbitrate REFUND from DISPUTED | P0 | DISPUTED | `Arbitrate(REFUND, C)` | — | Payer credited full; row `REFUNDED`; dispute `RESOLVED` |
| `ESCROW-FSM-003` | Release-after-Refund rejected | P0 | REFUNDED | `Release(payee)` | — | `illegal transition REFUNDED -> RELEASED` |
| `ESCROW-FSM-004` | Dispute on terminal rejected | P1 | RELEASED | `RaiseDispute` | — | Rejected (`cannot dispute hold in state RELEASED`) |
| `ESCROW-FSM-005` | Evidence requires open dispute | P2 | HELD (no dispute) | `AddEvidence` | — | `no open dispute for hold` |
| `ESCROW-SEC-001` | Arbitrate requires DISPUTED | P0 | HELD | `Arbitrate(RELEASE, C)` | — | `hold not in DISPUTED state (HELD)` |
| `ESCROW-SEC-002` | Invalid decision rejected | P1 | DISPUTED | `Arbitrate("MAYBE", C)` | bad decision | `invalid decision "MAYBE"` |
| `ESCROW-SEC-003` | Host-module flag off | P1 | host module flag off | Invoke escrow via host route | — | Route not mounted (escrow inherits host flag) — FLAG-SEC-001 |

## 5. State-machine transitions

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| (none) | `Hold` | `HELD` | payer debited → escrow account | `ESCROW-INV-001` |
| `HELD` | `Release(payee)` | `RELEASED` | credit escrow→payee; `resolved_at` | `ESCROW-INV-002` |
| `HELD` | `Refund` | `REFUNDED` | credit escrow→payer | `ESCROW-INV-003` |
| `HELD` | `RaiseDispute` | `DISPUTED` | dispute row OPEN; no money | `ESCROW-FSM-001` |
| `DISPUTED` | `Arbitrate(RELEASE)` | `RELEASED` | credit escrow→payee; dispute RESOLVED | `ESCROW-AUTHZ-004` |
| `DISPUTED` | `Arbitrate(REFUND)` | `REFUNDED` | credit escrow→payer; dispute RESOLVED | `ESCROW-FSM-002` |
| `RELEASED` / `REFUNDED` | any (cross-terminal) | — | rejected `illegal transition` | `ESCROW-FSM-003` |
| `RELEASED` | `Release` (same) | `RELEASED` | service no-op (`from==to` returns nil) | `ESCROW-INV-006` |
| `DISPUTED` | `RaiseDispute` | — | rejected (`DISPUTED→DISPUTED` not in table) | — |
| `State("BOGUS")` | any | — | rejected (fail-closed unknown state) | — |

Terminal states: `RELEASED`, `REFUNDED`. **Finding:** the two layers disagree subtly — the raw `canTransition` table has no self-loop, but `resolve` short-circuits `from==to` to a no-op; test both (`ESCROW-INV-006`). **Atomicity finding:** `resolve` commits the status flip in a tx, then posts the ledger credit **separately** — a crash between them leaves a RELEASED/REFUNDED row with no credit posted; needs a failure-injection integration test.

## 6. Security & abuse cases

- **Party-only dispute (`ESCROW-AUTHZ-001/002`):** `raisedBy`/`submittedBy` must equal payer or payee, else `ErrDisputeNotParty`.
- **Separation of duties (`ESCROW-AUTHZ-003`):** arbiter must not be payer or payee — prevents a party self-arbitrating a payout.
- **Host RBAC on Arbitrate:** the hosting module gates arbitration (`creators.dispute.arbitrate` / `p2p.dispute.arbitrate`) — see `../cross-cutting/rbac-and-permissions.md`.
- **Conservation / no-float:** release+refund==held, no partial release (`ESCROW-INV-002/003`); `../cross-cutting/money-invariants.md` I1/I2.
- **Idempotent Hold/terminal replay:** `ESCROW-INV-005/006`.

## 7. Automated specs to add

- `internal/escrow/service_authz_test.go` — table-driven party/arbiter guards (`ESCROW-AUTHZ-001..004`, `ESCROW-SEC-001/002`) using a fake ledger; pure-logic, no DB.
- `internal/escrow/live_db_integration_test.go` — skip-gated on `TEST_DATABASE_URL`: real Hold debit fail-closed + atomic row creation; double-Release no-op; Release-after-Refund DB-level rejection; escrow account nets to zero per ref; Hold replay via `getByIdem`; **the commit-then-credit atomicity gap** (crash after status flip). (gap G5 — the module's own doc block enumerates these)
- Concurrency test: two `Arbitrate` calls on one DISPUTED hold → exactly one terminal outcome (`FOR UPDATE`).

## 8. Coverage target & exit criteria

Tier-0: **≥ 85%** pure-logic (FSM + amount conservation already covered). Exit: party-only + separation-of-duties proven; Hold/Release/Refund + arbitration proven on real Postgres including the commit-then-credit atomicity behavior; no conservation or authz S1 open.
