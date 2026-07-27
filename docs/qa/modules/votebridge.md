# Module: Vote Bridge

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes &nbsp;·&nbsp; **Feature flag:** `FEATURE_VOTE_BRIDGE_ENABLED` (AND `FEATURE_WALLET_ENABLED`)
**Code:** `backend/internal/votebridge/` (`handler.go`, `model.go`, `model_test.go`); route wiring `backend/internal/app/finance_routes.go` (§"Vote bridge routes", ~L1888-1894); debit logic `backend/internal/finance/wallet/service.go` (`VoteDebit` → `Debit` → `ledger.Debit`).
**Slug:** `VOTEBRIDGE` (uppercase, used in Case IDs)

## 1. Overview & scope

The vote bridge is the single seam between the fintech wallet and the **protected legacy
Spotlight contest/voting platform**. It exposes exactly one endpoint,
`POST /api/finance/vote-bridge/debit`, which the Next.js bridge calls to debit the
authenticated user's wallet for paid votes *before* it credits votes via the legacy vote
service. The bridge never touches protected contest files; it only moves money. Because it is
the only wallet-debit path for contests, **exactly-once debit** (idempotency + replay safety)
is the P0 concern. `VoteDebit` debits the user wallet and credits the platform **commission**
standing account (`ledger.AccountCommission`), posting a balanced double-entry journal keyed by
the client-supplied `idempotency_key`. Tier limits are enforced fail-closed inside
`wallet.Debit` via `tiers.EnforceWalletDebitLimit`. Identity comes only from the resolved
token (`user_id` on the Gin context, guarded by `requireUserID()`), never from the body.

All cross-cutting invariants apply and are **not** repeated here: money
(`../cross-cutting/money-invariants.md`), auth (`../cross-cutting/authentication.md`), tier
gating (`../cross-cutting/kyc-and-tiers.md`), flags/audit
(`../cross-cutting/feature-flags-and-audit.md`). Note this module has **no separate KYC gate** —
only the tier-limit gate applies; assert that explicitly rather than assuming a KYC block.

## 2. Services / endpoints in scope

| Operation | Method + path (or service func) | Auth / permission | Money-path? |
|---|---|---|---|
| Debit wallet for votes | `POST /api/finance/vote-bridge/debit` | `requireUserID()` (token identity; global auth middleware upstream) | yes |
| Debit posting | `wallet.VoteDebit(ctx, userID, ref, idemKey, amountKobo)` | internal | yes |
| Balance read (response echo) | `wallet.GetBalance(ctx, userID)` | internal | no |

Request body (`DebitForVotesRequest`): `contest_id` (required), `contestant_id` (required),
`vote_count` (required, `min=1`), `cost_kobo` (required int64, `min=1`), `idempotency_key`
(required). Ledger reference is server-built: `"vote:" + contest_id + ":" + contestant_id`.
Response (`DebitForVotesResponse`): `ok`, `balance_kobo`, `idempotency_key`.

Behavioral notes to assert:
- On `VoteDebit` error the handler returns **402 Payment Required** with `{"error": ...}`.
- On success but a failing balance read, it still returns **200** with `balance_kobo` omitted
  (zero) — the debit already committed; the balance is best-effort.
- `vote_count` is **not** used in the money math — `cost_kobo` alone is debited atomically; the
  caller is responsible for `cost_kobo == pricePerVote × vote_count`. Server does **not**
  re-price (see VOTEBRIDGE-SEC-004).

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Request/response field contract | unit | `internal/votebridge/model_test.go` (`TestDebitForVotesRequestFields`, `TestDebitForVotesResponseFields`, `TestCostKoboMustCoverAllVotes`) | AUTOMATED |
| Balanced double-entry / kobo-only / projection | inv | `backend/tests/ledger_invariants_test.go` (shared oracle) | AUTOMATED (shared) |
| Idempotent replay (no double debit) | inv | `finance/ledger` reversal/TOCTOU tests (shared) | PARTIAL |
| Concurrent same-key → one success | inv | ledger TOCTOU tests (shared); no votebridge-specific test | PARTIAL |
| Tier-limit gate fail-closed | inv | `finance/tiers/service_test.go` (shared) | PARTIAL |
| Handler status codes (402 on debit error, 200 shape) | con/int | — | TODO |
| Token identity vs spoofed body `user_id` | authz/sec | — | TODO |
| Flag-off route not mounted | sec | — | TODO |
| Audit event emission | int | `../cross-cutting/feature-flags-and-audit.md` AUDIT-INT-001 (shared) | PARTIAL |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `VOTEBRIDGE-INT-001` | Happy-path debit | P0 | `qa-user-a` wallet `500000`, both flags on | `POST` debit | `{contest_id:"c1",contestant_id:"k1",vote_count:5,cost_kobo:10000,idempotency_key:"vd-001"}` | 200 `{ok:true,balance_kobo:490000,idempotency_key:"vd-001"}`; wallet debited exactly `10000`; commission account credited `10000` |
| `VOTEBRIDGE-INT-002` | Ledger reference encodes intent | P1 | as above | Debit then read ledger entry | same | Entry reference == `vote:c1:k1` |
| `VOTEBRIDGE-INT-003` | Balance-read failure still 200 | P2 | force `GetBalance` to error after commit | Debit | valid | 200 `{ok:true,idempotency_key:...}`, `balance_kobo` omitted/0; debit still committed |
| `VOTEBRIDGE-CON-001` | Missing `contest_id` | P1 | flags on | Debit without `contest_id` | `contestant_id,cost_kobo,idem` only | 400; nothing posted |
| `VOTEBRIDGE-CON-002` | Missing `contestant_id` | P1 | flags on | Debit without `contestant_id` | — | 400; nothing posted |
| `VOTEBRIDGE-CON-003` | Missing `idempotency_key` | P0 | flags on | Debit without `idempotency_key` | — | 400; nothing posted (see MONEY-INV I10) |
| `VOTEBRIDGE-CON-004` | `cost_kobo` = 0 rejected | P0 | flags on | Debit `cost_kobo:0` | `cost_kobo:0` | 400 (`min=1`); nothing posted |
| `VOTEBRIDGE-CON-005` | `cost_kobo` negative rejected | P0 | flags on | Debit `cost_kobo:-100` | `-100` | 400; nothing posted |
| `VOTEBRIDGE-CON-006` | `vote_count` = 0 rejected | P1 | flags on | Debit `vote_count:0` | `vote_count:0` | 400 (`min=1`) |
| `VOTEBRIDGE-CON-007` | Float / string `cost_kobo` rejected | P0 | flags on | Debit `cost_kobo:100.5` then `"100"` | — | 400 (see MONEY-INV-002); nothing posted |
| `VOTEBRIDGE-INT-004` | Insufficient balance → 402 | P0 | wallet `5000` | Debit `cost_kobo:10000` | over balance | 402 `{error:...}`; balance stays `5000` (MONEY-INV I4) |
| `VOTEBRIDGE-INV-001` | Idempotent replay | P0 | wallet `500000` | `POST` twice same `idempotency_key:"vd-r1"`, same body | `cost_kobo:10000` | 2nd returns same result; wallet moved once (`490000`); ledger entry count unchanged (see MONEY-INV-006) |
| `VOTEBRIDGE-INV-002` | Concurrent same-key → one debit | P0 | wallet `500000` | Fire N=10 concurrent debits, one key | `cost_kobo:10000` | Exactly one commits; balance `490000`; others no-op (MONEY-INV-007) |
| `VOTEBRIDGE-INV-003` | Distinct keys post separately | P1 | wallet `500000` | Two debits, keys `k1`,`k2` | `cost_kobo:10000` each | Both post; balance `480000` |
| `VOTEBRIDGE-INV-004` | Tier-limit gate rejects over-limit debit | P0 | `qa-user-a` Tier 1, per-tx limit L | Debit `cost_kobo=L+1` | over tier limit | 402; balance untouched (MONEY-INV I12; TIERS-UNIT-003) |
| `VOTEBRIDGE-INV-005` | Tier lookup error fails closed | P0 | force tier lookup error | Debit | valid | Blocked (not 200); nothing posted (TIERS-SEC-001) |
| `VOTEBRIDGE-INV-006` | Debit at exact tier limit allowed | P1 | Tier 1 limit L | Debit `cost_kobo=L` | boundary | 200; posted once (TIERS-UNIT-002) |
| `VOTEBRIDGE-AUTHZ-001` | Unauthenticated rejected | P0 | no token | `POST` debit | valid body | 401 `authentication required`; nothing posted |
| `VOTEBRIDGE-AUTHZ-002` | Suspended account blocked | P0 | `qa-suspended`, valid token | `POST` debit | valid | 403 `account restricted` (AUTH-SEC-001); nothing posted |
| `VOTEBRIDGE-SEC-001` | Spoofed body `user_id` ignored | P0 | `qa-user-a` token | `POST` debit with extra `user_id:"qa-user-b"` in body | body includes victim id | Debit hits `qa-user-a` only; `qa-user-b` wallet untouched (identity from token) |
| `VOTEBRIDGE-SEC-002` | Audit event emitted | P0 | flags on | Debit | valid | Exactly one audit event: actor `qa-user-a`, amount kobo, idem ref (AUDIT-INT-001) |
| `VOTEBRIDGE-SEC-003` | Flag off → route not mounted | P0 | `FEATURE_VOTE_BRIDGE_ENABLED=false` | `POST` debit | valid | 404 (route not registered); never 500 (FLAG-SEC-001) |
| `VOTEBRIDGE-SEC-004` | Wallet flag off → route not mounted | P0 | `FEATURE_WALLET_ENABLED=false` (bridge on) | `POST` debit | valid | 404 (both flags required to mount) |
| `VOTEBRIDGE-SEC-005` | No server-side re-price / amount tamper | P1 | flags on | Debit with `vote_count:5,cost_kobo:1` (mismatch) | inconsistent | Server debits only `cost_kobo` (1); does not recompute from `vote_count`. Documents that pricing correctness is the caller's responsibility — flag as a design risk in report |

## 5. State-machine transitions

Not applicable — the vote bridge is a stateless single-shot debit. Lifecycle/idempotency
behavior is covered by the ledger invariants (VOTEBRIDGE-INV-001/002) rather than an FSM.

## 6. Security & abuse cases

- **Missing / weak Idempotency-Key** — binding requires `idempotency_key`; absent → 400
  (VOTEBRIDGE-CON-003). Note openapi's ≥8-char rule for money mutations
  (`../cross-cutting/money-invariants.md` I10) is **not** enforced by the struct binding here
  (`binding:"required"` only) — flag this gap; add a length check spec (§7).
- **Replay / double-debit** — VOTEBRIDGE-INV-001/002 (exactly-once is the module's raison
  d'être).
- **Amount tampering / re-pricing** — VOTEBRIDGE-SEC-005; server trusts `cost_kobo` verbatim.
- **Identity spoofing** — VOTEBRIDGE-SEC-001; `user_id` from token only.
- **Tier/limit bypass & fail-closed** — VOTEBRIDGE-INV-004/005 (see `kyc-and-tiers.md`).
- **Fail-closed on flag off** — VOTEBRIDGE-SEC-003/004.
- **Brownfield boundary** — the bridge must never write to legacy contest/vote tables; it only
  posts to the ledger. Test setup must **never modify protected contest paths**; exercise the
  vote-credit side only through the legacy service's own observable API. See `README.md`
  §Brownfield safety.

## 7. Automated specs to add

- `internal/votebridge/handler_test.go` — httptest table: happy path (200 shape), 402 on debit
  error, 400 on each missing/invalid field, spoofed-body-`user_id` ignored. Use a fake
  `wallet.Service` seam (gin `httptest.NewRecorder`). Follows table-driven Go convention.
- `backend/tests/votebridge_idempotency_test.go` — DB-backed replay + N-concurrent-same-key
  against a real ledger (gated on `TEST_DATABASE_URL`), asserting entry count and balance.
  Mirrors `ledger_invariants_test.go`.
- `internal/votebridge/idemkey_length_test.go` — assert (after adding) `idempotency_key` ≥ 8
  chars is enforced, aligning binding with openapi I10.

## 8. Coverage target & exit criteria

Tier-0 module: ≥ 85% on `handler.go` + `VoteDebit` pure-logic. **Exit criteria (all must be
green before release):** VOTEBRIDGE-INT-001, VOTEBRIDGE-INT-004, VOTEBRIDGE-INV-001,
VOTEBRIDGE-INV-002, VOTEBRIDGE-INV-004, VOTEBRIDGE-INV-005, VOTEBRIDGE-AUTHZ-001,
VOTEBRIDGE-SEC-001, VOTEBRIDGE-SEC-002, VOTEBRIDGE-SEC-003. Any red among these is a
**do-not-ship** blocker.
