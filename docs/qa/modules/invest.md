# Module: Invest (Stock Brokerage)

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes &nbsp;·&nbsp; **Feature flag:** `FEATURE_INVEST_ENABLED` (default off)
**Code:** `backend/internal/invest/` — `routes.go`, `handler.go`, `service.go`, `model.go`, `security.go`, `ledger.go`, `provider.go`, `provider_http.go`, `reconciliation.go`, `webhook.go`, `worker.go`, `alerts.go`, `admin.go`, `admin_content.go`, `repository.go`, `invest_test.go`. Mounted at `backend/internal/app/finance_routes.go:2528-2529`.
**Slug:** `INVEST`

## 1. Overview & scope

Invest is a Tier-0 stock-brokerage money-path module: stock discovery/quotes, buy/sell orders with a 17-state order FSM, cash/share ledger, watchlists, price alerts, public offers/IPO + rights issues, agreements & suitability onboarding, a PIN-verification security layer, an admin control plane (assets, fees, settlement, reconciliation, dividends, corporate actions, provider health, audit), and an HMAC-signed broker webhook. All user routes require `RequireAuthContext`; admin routes require `invest.manage`. Money is integer kobo; share `Quantity` is `float64`. **Critical flag for testing:** `FEATURE_INVEST_PIN_DEV_BYPASS` — when **true** the DB PIN verifier is not installed and the service keeps `MockPINVerifier{}` (accepts any 4–6 digit PIN, no lockout). This MUST be off in staging/prod. Order placement enforces a strict pre-trade gate (`preTradeChecks`) covering profile status, trading-enabled, KYC tier, accepted agreements, suitability, asset availability, and market-open — then PIN. Applies: `../cross-cutting/money-invariants.md`, `authentication.md`, `rbac-and-permissions.md`, `kyc-and-tiers.md`, `webhooks-and-providers.md`, `feature-flags-and-audit.md`.

## 2. Services / endpoints in scope

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| List / search stocks | `GET /api/v1/stocks`, `/search`, `/market-status` | auth | no |
| Stock detail / chart / news / dividends / corp-actions | `GET /api/v1/stocks/:symbol[/…]` | auth | no |
| Buy order | `POST /api/v1/stocks/orders/buy` | auth + Idempotency-Key + PIN | yes |
| Sell order | `POST /api/v1/stocks/orders/sell` | auth + Idempotency-Key + PIN | yes |
| List / get / cancel orders | `GET /orders`, `/orders/:id`, `POST /orders/:id/cancel` | auth + owner | mixed |
| Portfolio / positions / performance | `GET /api/v1/invest/portfolio[/positions|/performance]` | auth | no |
| Wallet / deposit / withdraw / txns | `GET/POST /api/v1/invest/wallet[/…]` | auth | yes (deposit/withdraw) |
| Watchlists CRUD | `GET/POST/PATCH/DELETE /api/v1/invest/watchlists[/…]` | auth + owner | no |
| Alerts CRUD | `GET/POST/PATCH/DELETE /api/v1/invest/alerts[/…]` | auth + owner | no |
| Public offers / apply | `GET /public-offers[/…]`, `POST /:id/apply` | auth + Idempotency-Key (apply) | yes (apply) |
| Rights issues / accept | `GET /rights-issues[/…]`, `POST /:id/accept` | auth + Idempotency-Key | yes |
| Agreements / accept | `GET /invest/agreements`, `POST /accept` | auth | no |
| Eligibility / start / activate / profile | `GET /eligibility`, `POST /start`, `/activate`, `GET /profile` | auth | no |
| Suitability questions/submit/result | `GET/POST /invest/suitability/*` | auth | no |
| PIN status / set | `GET/POST /invest/security/pin` | auth | no |
| Admin: overview/assets/orders/failed | `GET/POST/PATCH /api/v1/admin/invest/*` | `invest.manage` | mixed |
| Admin: settlement pending / run | `GET /settlement/pending`, `POST /settlement/run` | `invest.manage` | yes |
| Admin: fees get/set | `GET /fees`, `PUT /fees` | `invest.manage` | no (config) |
| Admin: reconciliation / provider health / audit | `GET /reconciliation`, `/providers/health`, `/audit` | `invest.manage` | no |
| Broker webhook | `POST /api/v1/invest/webhooks/broker` | HMAC `X-Broker-Signature`, no auth | yes |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Order FSM happy buy path legal | fsm | `internal/invest/invest_test.go` `TestOrderStateMachine_HappyBuyPath` | AUTOMATED |
| Order FSM illegal transitions rejected | fsm | `invest_test.go` `TestOrderStateMachine_IllegalTransitions` | AUTOMATED |
| Fail→ReversalPending release path | fsm | `invest_test.go` `TestOrderStateMachine_FailReleasesPath` | AUTOMATED |
| Terminal states | fsm | `invest_test.go` `TestIsTerminal` | AUTOMATED |
| Fee = notional·bps/10000 floored | inv | `invest_test.go` `TestFeeFor`, `TestFeeFor_NeverFloat` | AUTOMATED |
| Suitability score→category; restricted=education-only | unit | `invest_test.go` `TestScoreToCategory`, `TestCategoryEligibility_RestrictedIsEducationOnly` | AUTOMATED |
| Mock PIN format rules | unit | `invest_test.go` `TestMockPINVerifier` | AUTOMATED |
| Market data deterministic / force status | unit | `invest_test.go` `TestMockMarketData_*` | AUTOMATED |
| Mock broker market fill / limit rest | unit | `invest_test.go` `TestMockBroker_MarketBuyFills`, `_LimitBuyRestsWhenNotMarketable` | AUTOMATED |
| Alert threshold logic | unit | `invest_test.go` `TestAlertHit`, `_LossCondition` | AUTOMATED |
| DB PIN verifier: salt+lockout after 5 | sec | — (`security.go` `DBPINVerifier`, untested) | TODO |
| preTradeChecks gates (KYC/agreements/suitability/market) | int | — | TODO |
| Idempotent order replay (no double-execute) | inv/int | — | TODO |
| Ledger cash/share balance across order | inv/int | — | TODO |
| Broker webhook signature + idempotent outcomes | sec/int | — | TODO |
| RBAC on admin; IDOR on orders/:id | authz | — | TODO |
| Flag-off route not mounted; PIN dev-bypass off | sec | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `INVEST-INT-001` | Market buy fills and settles | P0 | eligible user (KYC≥2, agreements+suitability done, PIN set), market open, active asset | `POST /stocks/orders/buy` w/ idem key + PIN | `{symbol, amount_kobo:5000000, pin}` | Order PendingReview→…→Filled→PendingSettlement; cash locked then debited; position credited; fee = `notional·150/10000` floored to `min_fee_kobo` |
| `INVEST-INT-002` | Sell releases cash | P0 | user holds shares | `POST /stocks/orders/sell` w/ idem + PIN | `{symbol, quantity, pin}` | Shares locked/reduced; cash credited net of fee; kobo-exact |
| `INVEST-INT-003` | Limit buy rests when not marketable | P1 | market open, limit below market | buy with `limit_price_kobo` below quote | — | Order Accepted, not Filled; cash locked |
| `INVEST-INT-004` | Settlement run advances due orders | P1 | order in PendingSettlement, due | `POST /admin/invest/settlement/run` | — | Buy credits shares; sell releases cash; status→Settled; audited |
| `INVEST-INT-005` | Failed order releases locked funds (no trapped funds) | P0 | order that fails at broker | trigger fail path | — | Order→Failed→ReversalPending→Reversed; `locked_cash_kobo`/`locked_quantity` returns to 0. Reconciliation `TrappedFunds` empty |
| `INVEST-VAL-001` | Buy without PIN rejected | P0 | eligible user | buy with empty `pin` | — | 400 (binding required) / 403 PIN error; no order |
| `INVEST-VAL-002` | Buy without idempotency key rejected | P0 | eligible user | buy, no `Idempotency-Key`/`X-Idempotency-Key` header | — | `ErrInvalidOrder` "idempotency key required" |
| `INVEST-VAL-003` | Float/string amount rejected | P0 | user | buy `amount_kobo:"5000"` or `5000.5` | — | 400. See MONEY-INV-002 |
| `INVEST-VAL-004` | Sell more shares than owned | P0 | position `< quantity` | sell `quantity > owned-locked` | — | `ErrInsufficientShares` → 422; no lock |
| `INVEST-VAL-005` | Market order when market closed | P1 | market `closed`, market order | buy market | — | `ErrMarketClosed` → 409 |
| `INVEST-VAL-006` | Trade on inactive/disabled asset | P1 | asset `status!=active` or Buy disabled | buy | — | `ErrAssetUnavailable` → 403 |
| `INVEST-AUTHZ-001` | Unauthenticated rejected | P0 | no token | any `/api/v1/invest/*` or `/stocks/*` | — | 401 |
| `INVEST-AUTHZ-002` | Non-admin cannot hit admin plane | P0 | user w/o `invest.manage` | `GET /admin/invest/overview` | — | 403 (fail-closed RBAC) |
| `INVEST-AUTHZ-003` | IDOR: read another user's order | P0 | order owned by B | `GET /stocks/orders/:id` as A | B's id | Not returned / 404; owner-scoped |
| `INVEST-AUTHZ-004` | IDOR: modify another user's watchlist/alert | P0 | watchlist owned by B | `PATCH /invest/watchlists/:id` as A | B's id | 403/404; no mutation |
| `INVEST-INV-001` | Idempotent order replay | P0 | — | POST buy twice, same idem key | same key | 2nd returns existing receipt via `FindOrderByIdem`; executed once (MONEY-INV-006) |
| `INVEST-INV-002` | Concurrent same-key buy → one order | P0 | — | N=10 concurrent buys, one key | one key | Exactly 1 executes (MONEY-INV-007) |
| `INVEST-INV-003` | Fee integer math, no float drift | P0 | — | buy large notional | `500_000_000_00·150/10000` | Exact integer fee; MONEY-INV-013 |
| `INVEST-SEC-001` | Flag off → routes not mounted | P0 | `FEATURE_INVEST_ENABLED=false` | call any invest endpoint | — | Not mounted / 404. FLAG-SEC-001 |
| `INVEST-SEC-002` | PIN dev-bypass MUST be off | P0 | staging/prod config | inspect `FEATURE_INVEST_PIN_DEV_BYPASS`; attempt buy with bogus PIN | wrong PIN | Bypass off → `DBPINVerifier` installed; wrong PIN rejected, lockout after 5 in 15 min. FLAG-SEC-003 |
| `INVEST-SEC-003` | Broker webhook signature enforced | P0 | broker with `WebhookSecret()` | `POST /webhooks/broker` w/ forged/absent `X-Broker-Signature` | forged | 401; no order state change. See `../cross-cutting/webhooks-and-providers.md` |
| `INVEST-SEC-004` | Broker webhook idempotent outcomes | P1 | order already Filled | replay fill webhook | — | `errAlreadyHandled` → 200 "ignored"; no double-fill |
| `INVEST-SEC-005` | KYC tier gate on trading | P0 | KYC tier < required | buy | kyc1 | `ErrKYCInsufficient` → 403; `can_trade=false` (needs tier≥2). See `../cross-cutting/kyc-and-tiers.md` KYC-SEC-001 |
| `INVEST-SEC-006` | Trade blocked without agreements/suitability | P0 | agreements unaccepted or no suitability | buy | — | `ErrTermsRequired` / `ErrSuitabilityRequired` → 403 |
| `INVEST-SEC-007` | Fee config bounds enforced | P2 | admin | `PUT /admin/invest/fees` `commission_bps:2000` | out of range | Rejected (range 0–1000; `min_fee_kobo≥0`) |

## 5. State-machine transitions

Order FSM — `model.go:87-114` (`orderTransitions`, `CanTransition`), enforced by `Service.transition` (`service.go:978-985`). Orders inserted at `PendingReview`. Terminal: Settled, Cancelled, Rejected, Reversed.

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| PendingReview | accept | AwaitingConfirmation | — | `INVEST-FSM-001` |
| AwaitingConfirmation | lock cash | CashLocked | wallet cash locked | `INVEST-FSM-002` |
| CashLocked | submit to broker | Submitted | order sent | `INVEST-FSM-003` |
| Submitted | broker accept | Accepted | — | `INVEST-FSM-004` |
| Accepted | fill | Filled | position credited | `INVEST-FSM-005` |
| Filled | settle window | PendingSettlement | — | `INVEST-FSM-006` |
| PendingSettlement | settle | Settled | shares/cash finalized (terminal) | `INVEST-FSM-007` |
| CashLocked | broker/system fail | Failed | → ReversalPending → Reversed; funds released | `INVEST-FSM-008` |
| ComplianceHold | resolve/reject | AwaitingConfirmation / Rejected | — | `INVEST-FSM-009` |
| Settled / Cancelled / Rejected / Reversed | any | (rejected) | terminal; illegal transition blocked | `INVEST-FSM-010` |
| Draft/Settled | → Filled (skip) | (rejected) | illegal; `TestOrderStateMachine_IllegalTransitions` | `INVEST-FSM-011` |

## 6. Security & abuse cases

- PIN dev-bypass off (`INVEST-SEC-002`), DB PIN lockout after `maxPINFailures=5` in `pinLockWindow=15m` (`security.go`). Reference `../cross-cutting/feature-flags-and-audit.md` FLAG-SEC-003.
- Idempotency/replay/concurrency: `INVEST-INV-001..002`; `../cross-cutting/money-invariants.md`.
- Webhook forgery + replay: `INVEST-SEC-003/004`; `../cross-cutting/webhooks-and-providers.md`.
- Authz/IDOR: `INVEST-AUTHZ-001..004`; `../cross-cutting/rbac-and-permissions.md`.
- KYC/tier gate: `INVEST-SEC-005`; `../cross-cutting/kyc-and-tiers.md`.
- Amount/qty tampering: server resolves notional from `amount_kobo`/`quantity`·price; assert min/max order bounds; MONEY-INV-013 kobo-exact.
- Fail-closed: reconciliation `TrappedFunds` (terminal orders still holding locked cash/shares) is an invariant violation — treat any non-empty list as a defect (`INVEST-INT-005`).

## 7. Automated specs to add

- `internal/invest/security_test.go` — `DBPINVerifier.Verify`: salted SHA-256 match, constant-time compare, lockout after 5 failures within 15 min, `ErrPINNotSet`/`ErrPINLocked`.
- `internal/invest/pretrade_test.go` — `preTradeChecks` matrix: suspended/restricted, trading-disabled, KYC tier, unaccepted agreements, missing suitability, inactive asset, market closed for market orders.
- `internal/invest/order_int_test.go` (live-DB) — full buy/sell through ledger: cash/share conservation, idempotent replay, concurrent same-key, failed-order fund release (no trapped funds), settlement run.
- `internal/invest/webhook_test.go` — HMAC signature (valid/forged/absent), idempotent fill/settle/reject outcomes returning 200 "ignored".
- `internal/invest/handler_authz_test.go` — admin RBAC (`invest.manage`) + IDOR on `/orders/:id`, watchlists, alerts.

## 8. Coverage target & exit criteria

Tier-0 floor ≥ 85% pure-logic (FSM/fee/suitability already covered). **Exit criteria (release-blocking):** `INVEST-INT-001..002/005`, `INVEST-INV-001..003`, `INVEST-SEC-001..003/005/006`, `INVEST-AUTHZ-001..004`, `INVEST-FSM-*` green. `FEATURE_INVEST_PIN_DEV_BYPASS` verified off in staging/prod. No trapped funds in reconciliation. Every order requires Idempotency-Key + PIN, posts balanced ledger legs, and passes pre-trade gates.
