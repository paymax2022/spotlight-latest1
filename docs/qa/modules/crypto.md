# Module: Crypto

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes &nbsp;·&nbsp; **Feature flag:** `FEATURE_CRYPTO_ENABLED` (default off)
**Code:** `backend/internal/crypto/` — `routes.go`, `handler.go`, `handler_ext.go`, `admin_handler.go`, `service.go`, `service_ext.go`, `admin_service.go`, `model.go`, `model_ext.go`, `admin_model.go`, `onchain.go`, `provider.go`, `withdrawal_provider.go`, `repository.go`, `repository_ext.go`, `audit.go`, `invariants_test.go`. Mounted at `backend/internal/app/finance_routes.go:2541`.
**Slug:** `CRYPTO`

## 1. Overview & scope

Crypto is a Tier-0 money-path module: catalogue/quotes, buy/sell with kobo cash sizing, asset-to-asset swap with a spread, deposit-address allow-list + address screening, a withdrawal flow that parks value in a `pending_review` state for admin adjudication, portfolio holdings, admin decisions, and a custody reconciliation webhook. Member routes require `RequireAuthContext` + a per-route RBAC permission (`crypto.view` / `crypto.trade`); admin routes require `crypto.admin`. Money maths are integer-only (kobo NGN; asset minor units) via `unitsForCash`/`cashForUnits` with `big.Int` overflow guards that fail closed to 0. **Important facts for testing:** there is **no tier gate and no KYC gate** enforced anywhere in this module (withdrawal eligibility returns `eligible`/`ManualReviewOnly` hardcoded); address "screening" is only a length≥8 check; the default price and withdrawal providers are mocks that always succeed; `confirm` and both `quote` endpoints do **not** require an Idempotency-Key. Applies: `../cross-cutting/money-invariants.md`, `authentication.md`, `rbac-and-permissions.md`, `webhooks-and-providers.md`, `feature-flags-and-audit.md`. (KYC/tiers cross-cutting is referenced only to assert the *gap*.)

## 2. Services / endpoints in scope

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| List assets / markets | `GET /api/v1/crypto/assets`, `/markets` | `crypto.view` | no |
| Asset quote / chart | `GET /api/v1/crypto/assets/:id/quote`, `/chart` | `crypto.view` | no |
| Get transaction | `GET /api/v1/crypto/transactions/:id` | `crypto.view` + owner check in svc | no |
| Buy | `POST /api/v1/crypto/orders/buy` | `crypto.trade` + Idempotency-Key | yes |
| Sell | `POST /api/v1/crypto/orders/sell` | `crypto.trade` + Idempotency-Key | yes |
| List orders | `GET /api/v1/crypto/orders` | `crypto.view` | no |
| Portfolio / holdings | `GET /api/v1/crypto/portfolio`, `/portfolio/holdings` | `crypto.view` | no |
| Swap quote (estimate) | `POST /api/v1/crypto/swap/quote` | `crypto.trade` | no (no money moved) |
| Swap | `POST /api/v1/crypto/swap` | `crypto.trade` + Idempotency-Key | yes |
| Swap orders | `GET /api/v1/crypto/swap/orders` | `crypto.view` | no |
| List / add / delete address | `GET/POST /addresses`, `DELETE /addresses/:id` | view (list) / trade (mutate) | no |
| Screen address | `POST /api/v1/crypto/addresses/screen` | `crypto.view` | no |
| Deposit address | `GET /api/v1/crypto/deposit-address` | `crypto.view` | no |
| Withdrawal eligibility | `GET /api/v1/crypto/withdrawals/eligibility` | `crypto.view` | no |
| Withdrawal quote | `POST /api/v1/crypto/withdrawals/quote` | `crypto.view` | no (preview) |
| Create withdrawal | `POST /api/v1/crypto/withdrawals` | `crypto.trade` + Idempotency-Key | yes |
| List / get withdrawal | `GET /api/v1/crypto/withdrawals`, `/:id` | `crypto.view` + owner | no |
| Confirm withdrawal | `POST /api/v1/crypto/withdrawals/:id/confirm` | `crypto.trade` (NO idem key) | yes (state) |
| Custody webhook | `POST /api/v1/crypto/internal/onchain-balance` | shared-secret only, no RBAC | reconciliation |
| Admin: orders/assets/swaps/addresses/recon | `GET/POST /api/v1/admin/crypto/…` | `crypto.admin` | mixed |
| Admin: withdrawal decision | `POST /api/v1/admin/crypto/withdrawals/:id/decision` | `crypto.admin`, note mandatory | yes |
| Admin: address decision | `POST /api/v1/admin/crypto/addresses/:id/decision` | `crypto.admin`, note mandatory | no |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Buy sizing truncates, never over-credits | inv | `internal/crypto/invariants_test.go` `TestUnitsForCash_ExactAndTruncating` | AUTOMATED |
| Fail-closed on bad price/scale | inv | `invariants_test.go` `TestUnitsForCash_FailClosedOnBadInputs`, `TestCashForUnits_FailClosedOnBadScale` | AUTOMATED |
| int64 overflow guard → 0 | inv | `invariants_test.go` `TestUnitsForCash_OverflowGuard`, `TestCashForUnits_OverflowGuard` | AUTOMATED |
| Sell/valuation truncates | inv | `invariants_test.go` `TestCashForUnits_ExactAndTruncating` | AUTOMATED |
| Round-trip never inflates | inv | `invariants_test.go` `TestUnitsCashRoundTrip` | AUTOMATED |
| Swap spread conserves (`net+spread==cash`) | inv | `invariants_test.go` `TestSwapSpread_Conserves`, `TestDefaultSwapSpreadBps_Sane` | AUTOMATED |
| Network fee floored at 1 minor unit | inv | `invariants_test.go` `TestNetworkFeeUnits` | AUTOMATED |
| Withdrawal FSM legal edges | fsm | `invariants_test.go` `TestWithdrawalFSM_LegalTransitions` | AUTOMATED |
| Withdrawal FSM illegal/terminal/unknown rejected | fsm | `invariants_test.go` `TestWithdrawalFSM_IllegalSkipsRejected`, `_TerminalStatesReject`, `_UnknownStateRejects` | AUTOMATED |
| Buy/sell no-double-debit on replay | inv/int | — (DB path, listed as gap in test doc footer) | TODO |
| Holding == SUM(fills); oversell rejected | inv/int | — | TODO |
| Withdraw parks units + charges fee + AML stop | int | — | TODO |
| Reject-returns-parked-units | int | — | TODO |
| RBAC on every route; IDOR on `:id` reads | authz | — | TODO |
| Custody webhook signature enforced | sec | — | TODO |
| Flag-off route not mounted | sec | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `CRYPTO-INT-001` | Buy credits correct minor units | P0 | `crypto.trade` user, active asset, wallet funded | `POST /orders/buy` with Idempotency-Key | `{asset_id, cash_kobo: 100000}` | Wallet debited `100000`; holding credited `unitsForCash(100000, price, scale)`; escrow leg balanced; audit row written |
| `CRYPTO-INT-002` | Sell reverses to cash | P0 | user holds units | `POST /orders/sell` with idem key | `{asset_id, units: N}` | Holding reduced N; wallet credited `cashForUnits(N)`; kobo-exact |
| `CRYPTO-INT-003` | Swap posts 3 balanced legs w/ spread | P0 | user holds from-asset | `POST /swap` with idem key | `{from_asset_id, to_asset_id, from_units}` | 3 ledger legs; `net + spread == cash`; spread → revenue; no negative leg |
| `CRYPTO-INT-004` | Swap quote moves no money | P1 | `crypto.trade` user | `POST /swap/quote` | valid pair | Returns estimate only; no ledger entries, no holding change |
| `CRYPTO-INT-005` | Withdrawal parks units + charges fee, stops at pending_review | P0 | user holds asset, owns address | `POST /withdrawals` with idem key | `{asset_id, address_id, units, fee_kobo:15000}` | Row `requested`→`pending_review`; `feeKobo` debited wallet→revenue; units parked; **no provider dispatch** |
| `CRYPTO-INT-006` | Withdrawal quote is preview only | P1 | user | `POST /withdrawals/quote` | `{asset_id, units}` | Returns fee/net preview; no state, no money moved; no idem key required |
| `CRYPTO-VAL-001` | Buy with non-positive cash rejected | P0 | trade user | `POST /orders/buy` | `cash_kobo: 0` / negative | 400 `ErrBadRequest`/`ErrAmountTooSmall`; nothing posted |
| `CRYPTO-VAL-002` | Float/string amount rejected | P0 | trade user | Buy with `cash_kobo:"1000"` or `1000.5` | non-integer | 400; see `../cross-cutting/money-invariants.md` MONEY-INV-002 |
| `CRYPTO-VAL-003` | Buy on inactive asset rejected | P1 | asset `is_active=false` | `POST /orders/buy` | inactive asset_id | Rejected `ErrAssetUnavailable`/not-found. NOTE: verify Sell path — `service.go` Sell does **not** guard `IsActive` (possible gap) |
| `CRYPTO-VAL-004` | Withdraw below dust floor rejected | P1 | small holding | `POST /withdrawals` | `units <= networkFee` | `ErrWithdrawTooSmall`; no state change |
| `CRYPTO-VAL-005` | Withdraw to non-owned address rejected | P0 | address belongs to other user | `POST /withdrawals` | foreign `address_id` | `ErrAddressNotFound`; allow-list enforced |
| `CRYPTO-VAL-006` | Withdraw with asset/address mismatch rejected | P1 | address for asset A | withdraw asset B to that address | mismatched | `ErrAddressNotFound` (`addr.AssetID != asset.ID`) |
| `CRYPTO-VAL-007` | Oversell rejected fail-closed | P0 | holding `< units` | `POST /orders/sell` | `units > HoldingUnits` | Rejected; holding unchanged; DB `CHECK(units>=0)` backstop |
| `CRYPTO-AUTHZ-001` | view-only user cannot trade | P0 | user with `crypto.view` only | `POST /orders/buy` | — | 403; no order created |
| `CRYPTO-AUTHZ-002` | unauthenticated rejected | P0 | no token | any `/api/v1/crypto/*` | — | 401 |
| `CRYPTO-AUTHZ-003` | IDOR: read another user's transaction | P0 | tx owned by user B | `GET /transactions/:id` as user A | B's tx id | 404/403; object-level owner check in service |
| `CRYPTO-AUTHZ-004` | IDOR: read another user's withdrawal | P0 | withdrawal owned by B | `GET /withdrawals/:id` as A | B's id | Not returned (owner-scoped query) |
| `CRYPTO-AUTHZ-005` | Non-admin cannot hit admin routes | P0 | trade user (no `crypto.admin`) | `GET /api/v1/admin/crypto/withdrawals` | — | 403 |
| `CRYPTO-INV-001` | Idempotent buy replay (no double-debit) | P0 | — | POST buy twice, **same** Idempotency-Key | same key | 2nd returns same order; wallet debited once (MONEY-INV-006) |
| `CRYPTO-INV-002` | Concurrent same-key buy → one success | P0 | — | Fire N=10 concurrent buys, one key | one key | Exactly 1 posts; balance moves once (MONEY-INV-007) |
| `CRYPTO-INV-003` | Missing Idempotency-Key on buy/sell/swap/withdraw | P0 | trade user | POST each with no key | — | 400 (`requireIdem`). See MONEY-INV-008 |
| `CRYPTO-INV-004` | Admin reject returns parked units | P0 | withdrawal `pending_review` | admin decision `reject`, note set | — | State `pending_review`→`failed`; parked `units` credited back to holding in same tx; audit |
| `CRYPTO-SEC-001` | Flag off → routes not mounted | P0 | `FEATURE_CRYPTO_ENABLED=false` | call any `/api/v1/crypto/*` | — | Not mounted / 404; never 500. See `../cross-cutting/feature-flags-and-audit.md` FLAG-SEC-001 |
| `CRYPTO-SEC-002` | Custody webhook requires shared secret | P0 | `CRYPTO_CUSTODY_WEBHOOK_SECRET` set | `POST /internal/onchain-balance` w/ wrong or missing secret header | forged | Rejected (constant-time compare); balance unchanged. Secret unset → 503 fail-closed |
| `CRYPTO-SEC-003` | Client-supplied `fee_kobo` cannot be gamed | P1 | trade user | Withdraw with `fee_kobo:0` or tiny | tampered | Assert server re-derives/validates fee against `networkFeeUnits` floor; document actual behavior (currently `fee_kobo` is client-supplied — flag if unvalidated) |
| `CRYPTO-SEC-004` | Admin decision requires mandatory note | P1 | admin | decision with empty `note` | — | Rejected; no state change (`admin_handler.go`) |
| `CRYPTO-SEC-005` | No KYC/tier gate on withdrawal (documented gap) | P1 | kyc0 user | `GET /withdrawals/eligibility` then withdraw | — | Eligibility returns `eligible`/`ManualReviewOnly` hardcoded — assert whether this is intended; cross-ref `../cross-cutting/kyc-and-tiers.md` KYC-SEC-001 as an expected-behavior gap |

## 5. State-machine transitions

Withdrawal FSM — `model_ext.go:114-121` (`allowedWithdrawalTransitions` / `canTransitionWithdrawal`); enforced at DB via `TransitionWithdrawal` `WHERE status=<from>` (`repository_ext.go:332-382`), `RowsAffected==0` → `ErrInvalidTransition`.

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| requested | fee charged, submit | pending_review | member path stops here; units parked, fee debited | `CRYPTO-FSM-001` |
| requested | fee-charge fails | failed | parked units returned | `CRYPTO-FSM-002` |
| pending_review | admin approve | approved | then auto `broadcastApprovedWithdrawal` | `CRYPTO-FSM-003` |
| approved | broadcast ok | broadcast | provider accepted (mock always accepts) | `CRYPTO-FSM-004` |
| approved | provider reject | failed | parked units returned | `CRYPTO-FSM-005` |
| broadcast | confirm | confirmed | terminal (via `ConfirmWithdrawal`) | `CRYPTO-FSM-006` |
| pending_review | admin reject | failed | parked units returned | `CRYPTO-FSM-007` |
| confirmed / failed | any | — | terminal; re-entry rejected (idempotent) | `CRYPTO-FSM-008` |
| requested | skip to approved/broadcast/confirmed | (rejected) | illegal skip blocked by DB WHERE clause | `CRYPTO-FSM-009` |

Illegal transitions (AML-skip, backward, terminal re-entry, unknown state) must be rejected — covered pure-logic by `invariants_test.go`; add DB-level assertions (§7).

## 6. Security & abuse cases

- Authz/IDOR: `CRYPTO-AUTHZ-001..005`. Reference `../cross-cutting/rbac-and-permissions.md`.
- Idempotency/replay: `CRYPTO-INV-001..003`; reference `../cross-cutting/money-invariants.md`.
- Webhook signature: `CRYPTO-SEC-002`; reference `../cross-cutting/webhooks-and-providers.md`.
- Amount/fee tampering: `CRYPTO-SEC-003` (`fee_kobo` client-supplied), plus MONEY-INV-013 kobo-exact.
- Screening is a length≥8 no-op (`ScreenAddress`/`AddAddress`) — assert an obviously-bad address is NOT truly screened; flag as an AML gap, do not treat "clear" as real clearance.
- Fail-closed: custody webhook 503 when secret unset (`CRYPTO-SEC-002`); overflow guards return 0 rather than a wrong amount.
- Audit: money mutations write `crypto_audit_log` and **audit failure is fatal** for buy/sell/swap/withdraw — see `../cross-cutting/feature-flags-and-audit.md` AUDIT-INT-001/004; `CRYPTO-SEC-004` for mandatory admin note.

## 7. Automated specs to add

- `internal/crypto/service_int_test.go` (live-DB, gated on `TEST_DATABASE_URL`) — buy/sell/swap/withdraw against a real ledger: no-double-debit on same-key replay, `holding == SUM(fills)`, swap 3-leg conservation, oversell rejection, withdraw parking + fee debit + AML stop, reject-returns-units. Table-driven Go per `TEST_STRATEGY.md`.
- `internal/crypto/withdrawal_fsm_db_test.go` — DB-level illegal-transition rejection (WHERE-clause guard) and terminal-state idempotency.
- `internal/crypto/handler_authz_test.go` — HTTP-level RBAC (`crypto.view`/`trade`/`admin`) and IDOR on `/transactions/:id`, `/withdrawals/:id`.
- `internal/crypto/onchain_webhook_test.go` — shared-secret enforcement (missing/forged/valid), 503 when secret unset.
- Flag-off route-mount assertion (`CRYPTO-SEC-001`).

## 8. Coverage target & exit criteria

Tier-0 floor ≥ 85% on pure-logic (`invariants_test.go` already high). **Exit criteria (release-blocking):** `CRYPTO-INT-001..003`, `CRYPTO-INV-001..004`, `CRYPTO-AUTHZ-001..005`, `CRYPTO-FSM-001..009`, `CRYPTO-SEC-001/002` all green. Every money mutation must post balanced ledger legs, require an Idempotency-Key, and write an audit row (audit failure aborts the mutation). Confirm the KYC/tier gap (`CRYPTO-SEC-005`) is an accepted product decision before go-live.
