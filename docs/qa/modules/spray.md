# Module: Spray

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes &nbsp;·&nbsp; **Feature flag:** `FEATURE_P2P_MARKET_ENABLED` (Spray is wired inside `RegisterP2PMarket`; it has no flag of its own)
**Code:** `backend/internal/spray/` — `handler.go`, `service.go`, `model.go`, `invariants_test.go`. Mounted in `backend/internal/app/top5_p3_routes.go` (`RegisterP2PMarket`): member routes at `/api/finance/p2p/spray*`, admin at `/api/p2p/admin/spray*` guarded by `spray.read`.
**Slug:** `SPRAY` (uppercase, used in Case IDs)

## 1. Overview & scope

Spray is the shared "spray money" engine: an instant **wallet→wallet transfer** with a returnable presentation animation and a per-context leaderboard, reused by social lives and creator/event lives. A spray is `wallet.Debit(from)` → `ledger.Credit(to)` routed through the finance settlement standing account (NL-8), idempotent on one base key with per-leg suffixes (`:debit` / `:credit`), tier-limited fail-closed inside `wallet.Debit`, and bounded by **AML velocity limits** (NL-10): single-spray cap, rolling-24h amount cap, rolling-24h count cap, and a dust floor (anti-structuring). The **sender is always the authenticated caller** (`user_id` from context) — a client can never spray from another user. Testing priorities: conservation (debited == credited), idempotent replay (no double-debit), AML fail-closed, self-spray rejection, and the money invariants in `../cross-cutting/money-invariants.md`. Also applies: `../cross-cutting/authentication.md`, `../cross-cutting/kyc-and-tiers.md` (tier limits inside `wallet.Debit`), `../cross-cutting/feature-flags-and-audit.md`.

## 2. Services / endpoints in scope

| Operation | Method + path (or service func) | Auth / permission | Money-path? |
|---|---|---|---|
| Send a spray | `POST /api/finance/p2p/spray` `{to_user_id, context_ref, amount_kobo}` + `Idempotency-Key` | member (sender = token `user_id`) | **yes** |
| Context leaderboard (member) | `GET /api/finance/p2p/spray/leaderboard/:contextRef` | member | no (read) |
| Context leaderboard (admin/AML) | `GET /api/p2p/admin/spray/leaderboard/:contextRef` | `RequirePermission("spray.read")` | no (read) |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| `describeAnimation` tier boundaries exact + monotone + deterministic (no money authority) | unit | `internal/spray/invariants_test.go` (`TestDescribeAnimation_*`) | AUTOMATED |
| `AMLConfig.withDefaults` conservative fallbacks; non-positive overrides replaced; explicit config preserved | unit | `internal/spray/invariants_test.go` (`TestAMLDefaults_*`) | AUTOMATED |
| Conservation + per-leg key discipline (`:debit`/`:credit` distinct, same amount) | inv | `internal/spray/invariants_test.go` (`TestSprayConservationAndIdempotencySuffixes`) | PARTIAL (pure; no DB) |
| Spray end-to-end money move (debit+credit net-zero on clearing) | inv/int | — (DOC note in `invariants_test.go`) | TODO |
| Idempotent replay via `getByIdem` (no re-debit) | inv/int | — | TODO |
| AML velocity rolling-24h SUM/COUNT + fail-closed on query error | int/sec | — | TODO |
| Self-spray + dust + over-single-limit rejection | int | — | TODO |
| Flag-off (p2p-market disabled) route inaccessible | sec | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `SPRAY-INT-001` | Spray happy path | P0 | A funded, B exists | `POST /spray {to:B, context_ref, amount_kobo}` + key | `amount_kobo=50000` (₦500), key `k1` | 200 `{success, spray}`; B credited `50000`; A debited `50000`; leaderboard for context shows A |
| `SPRAY-INT-002` | Animation descriptor returned kobo-tiered | P2 | A funded | spray `100000` then `500000` | `100000`, `500000` | `100000`→`rain`; `500000`→`confetti` (per `describeAnimation` boundaries) — presentation only, no money authority |
| `SPRAY-INT-003` | Leaderboard aggregates by context | P1 | 2 sprays by A, 1 by C in same context | `GET /spray/leaderboard/:contextRef` | — | 200; rows ordered `total_kobo DESC`; A total == SUM of A's sprays; rank assigned 1..n |
| `SPRAY-INV-001` | Conservation (debit == credit) | P0 | A funded | spray, then read A + B + clearing | `amount_kobo=25000` | A −`25000`, B +`25000`, clearing nets `0`; balanced double-entry (see MONEY-INV-003) |
| `SPRAY-INV-002` | Idempotent replay — no double-debit | P0 | one completed spray key `k1` | `POST /spray` again with `k1` | same `k1`, same body | 2nd returns the existing spray; A debited once only; single `spray_transfers` row (MONEY-INV-006) |
| `SPRAY-INV-003` | Concurrent same-key → one | P0 | A funded | fire 10 concurrent `POST /spray` with one key | N=10, key `k1` | Exactly one debit; balance moves once (MONEY-INV-007) |
| `SPRAY-SEC-001` | Missing Idempotency-Key rejected | P0 | A funded | `POST /spray` with no header | no key | 400 "Idempotency-Key header required"; nothing posted (MONEY-INV-008) |
| `SPRAY-SEC-002` | Self-spray rejected | P0 | A funded | `POST /spray {to: A}` | `from==to` | 400 "cannot spray yourself"; no money moved |
| `SPRAY-SEC-003` | Dust below minimum rejected | P1 | A funded | spray `amount_kobo=50` | `50 < MinSingleKobo=100` | 400 "amount below minimum"; anti-structuring |
| `SPRAY-SEC-004` | Over single-spray limit rejected | P0 | A funded | spray `amount_kobo=50000001` | `> MaxSingleKobo=50000000` (₦500k) | 403 `ErrAMLSingleLimit`; no money moved |
| `SPRAY-SEC-005` | Rolling-24h amount cap fail-closed | P0 | A near daily cap | spray that would breach `MaxDailyKobo` | cumulative > ₦2,000,000 | 403 `ErrAMLDailyLimit` |
| `SPRAY-SEC-006` | Rolling-24h count cap | P1 | A at 500 sprays/24h | one more spray | count `501 > 500` | 403 `ErrAMLDailyCount` |
| `SPRAY-SEC-007` | AML query error fails closed | P0 | AML SUM/COUNT query errors | attempt spray | dependency error | Blocked (not allowed); "aml check unavailable" (MONEY-INV-012 fail-closed) |
| `SPRAY-INV-004` | Tier limit fail-closed (via `wallet.Debit`) | P0 | A over daily tier limit | spray exceeding tier limit | tier-limited | Rejected inside `wallet.Debit`; no negative balance (NL-1). See `../cross-cutting/kyc-and-tiers.md` |
| `SPRAY-SEC-008` | Insufficient funds rejected | P0 | A balance `10000`, spray `20000` | `POST /spray` | `20000 > 10000` | Rejected (no advance, NL-1); balance unchanged |
| `SPRAY-AUTHZ-001` | Sender is always the caller | P0 | A session | `POST /spray` (no way to set `from`) | — | Debit is against token `user_id`; a body `from` field would be ignored |
| `SPRAY-AUTHZ-002` | Admin leaderboard requires `spray.read` | P1 | caller without perm | `GET /api/p2p/admin/spray/leaderboard/:ref` | no grant | 403 forbidden (see `../cross-cutting/rbac-and-permissions.md`) |
| `SPRAY-SEC-009` | Flag-off inaccessible | P0 | `FEATURE_P2P_MARKET_ENABLED=off` | call `/spray` | — | Route not mounted / 404 — never 500 (FLAG-SEC-001) |

## 5. State-machine transitions (only if the module has an FSM)

No state machine in this module. A spray is a single atomic 1:1 transfer; the `spray_transfers` row is an idempotent audit projection with no lifecycle states.

## 6. Security & abuse cases

- **Amount tampering:** amount is `amount_kobo` (integer); caps enforced server-side (`SPRAY-SEC-004..006`). No client-supplied fee.
- **Idempotency:** mandatory header (`SPRAY-SEC-001`); per-leg suffix keys keep debit/credit from dedup-colliding.
- **Structuring:** dust floor (`SPRAY-SEC-003`) + rolling-24h caps (`SPRAY-SEC-005/006`) fail closed, including on AML query error (`SPRAY-SEC-007`).
- **Self-transfer:** rejected (`SPRAY-SEC-002`).
- **Audit:** every send logs `spray.send` via nil-safe `Auditor` (AUDIT-INT-001).
- Inherit all of `../cross-cutting/money-invariants.md` (I1–I12) substituting `POST /spray`.

## 7. Automated specs to add

- `internal/spray/spray_live_db_test.go` — live-DB (gated on `TEST_DATABASE_URL`): end-to-end money move with clearing-account net-zero (conservation), idempotent replay no re-debit, self-spray rejection, leaderboard `total == SUM(spray_transfers)`. Fulfils the DOC block in `invariants_test.go`. TODO.
- `internal/spray/aml_velocity_test.go` — rolling-24h SUM/COUNT caps and fail-closed on query error (`SPRAY-SEC-005/006/007`), table-driven with a stub pool. TODO.
- Concurrent-same-key goroutine test asserting exactly one debit (`SPRAY-INV-003`). TODO.

## 8. Coverage target & exit criteria

Tier-0 pure-logic floor ≥ 85% (animation + AML-defaults already covered). Exit criteria: `SPRAY-INV-001/002/003` (conservation, replay, concurrency), `SPRAY-SEC-001/002/004/007` (idempotency-key, self-spray, single cap, fail-closed AML), and `SPRAY-INV-004` (tier fail-closed) all green; flag-off `SPRAY-SEC-009` verified; no S1 open.
