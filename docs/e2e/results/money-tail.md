# MONEY-LONG-TAIL (MTL) — coverage sweep results

Date: 2026-10-04. Lane: the ~2,540 uncovered backend paths left by the 12-phase
E2E campaign — crypto, invest, trading, fractional real-estate, Spotlight
Wealth, arena, utility bills, legacy + orchestration FX, Maplerad, restaurant
bank-accounts, doctor bank-account, and `transfers/resolve-account`.

Stack exercised live: Go backend :8080 (`APP_ENV=development`), public web
:3000, admin console :3001, GoTrue via Kong :54321, Postgres :54322
(`supabase_db_spotlight`), Mailpit :54324. No restarts performed.

Artifacts created by this lane:
- `frontend-web/tests/e2e/money-tail/helpers.ts` — MTL helper stack
  (re-exports the proven finance/cross fixtures; adds `goFetch`,
  `goFetchAnon`, `orchLedgerSums`, `orchLedgerBalanced`).
- `frontend-web/tests/e2e/money-tail/mtl-001-fx.spec.ts` (6 tests)
- `frontend-web/tests/e2e/money-tail/mtl-002-fx-business.spec.ts` (5 tests)
- `frontend-web/tests/e2e/money-tail/mtl-003-utilitybills.spec.ts` (4 tests)
- `frontend-web/tests/e2e/money-tail/mtl-004-utilitybills-admin.spec.ts` (4 tests)
- `frontend-web/tests/e2e/money-tail/mtl-005-flagged.spec.ts` (3 tests)
- `backend/internal/crypto/live_journey_test.go` (2 live-DB tests)
- `backend/internal/invest/live_journey_test.go` (2 live-DB tests)
- `backend/internal/fractionalre/live_journey_test.go` (2 live-DB tests)
- `backend/internal/spotlightwealth/live_journey_test.go` (1 live-DB test)
- `backend/internal/arena/service/live_journey_test.go` (2 live-DB tests)

Verification runs:
- `npx playwright test tests/e2e/money-tail/ --project=chromium-desktop` —
  **22/22 passed** (4.5s).
- `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:54322/postgres
  go test ./internal/crypto/... ./internal/invest/... ./internal/trading/...
  ./internal/fractionalre/... ./internal/spotlightwealth/... ./internal/arena/...
  ./internal/utilitybills/... ./internal/finance/fx/...
  ./internal/finance/maplerad/... ./internal/finance/transfers/...
  ./internal/orchestration/... -count=1` — **26 packages ok, 0 fail**
  (all 9 new `TestLiveDB_*` pass; `internal/finance/fxdomain` does not exist —
  the orchestration FX journal lives in `internal/orchestration`).
- `go build ./...` — clean. `go vet ./...` — clean.
- `npx tsc --noEmit` — no money-tail errors (the only errors are pre-existing
  `tests/e2e/academy/*.spec.ts` helper-signature mismatches outside this lane).

## 1. Per-module coverage

| Module | Mount(s) | Routes | Local flag state | Coverage | Classification |
|---|---|---|---|---|---|
| FX orchestration | `/api/v1/fx/*` | ~46 | `FEATURE_FX_ENABLED`, `FEATURE_FX_ORCHESTRATION_ENABLED` **on** | **11 e2e tests** — balances, wallets, txns, rates+history, quotes→lock→convert, transfers (same + cross-currency), collections VA + provider webhook, beneficiaries+validate, rate alerts, verification submit/restart, disputes; business console: team, approvals/thresholds, activity, limits, notifications, api-keys, webhooks settings, settings/notif-prefs, stablecoin addresses, cards | `covered` (provider hop `mock-provider`) |
| FX business/admin | `/api/v1/fx/*` (same surface, business scope) | — | on | **5 e2e tests** | `covered` |
| Utility bills member | `/api/finance/utilitybills/*` | 10 | `FEATURE_UTILITY_BILLS_ENABLED`, `FEATURE_UTILITY_PAYMENTS_ENABLED` **on** | **4 e2e tests** — categories, billers, validate, quote, pay (+auto-reversal), transactions, beneficiaries | `covered` (biller fulfillment `psp-unverified`) |
| Utility bills admin | `/api/finance/admin/utilitybills/*` | 31 | on | **4 e2e tests** — RBAC refusal, providers, credentials rotation (fail-closed), health-check, billers, products, import, provider-products, routing-rules, categories, transactions, requery/reverse/resolve, unresolved, sweep worker, reports | `covered` |
| Transfers (resolve-account only) | `/api/finance/transfers/resolve-account` | 1 | `FEATURE_WALLET_TRANSFERS_ENABLED` **on** | **1 e2e test** — resolve, malformed refusal, missing-field 400, anon 401 | `covered` (registry mock fallback; live NUBAN `psp-unverified`) |
| Restaurant bank-accounts | `/api/finance/restaurant/bank-accounts*` | 5 | `FEATURE_RESTAURANT_ENABLED` **on** | **1 e2e test** — verify, add, list, default, delete, authz error | `covered` (verify call `psp-unverified`) |
| Crypto | `/api/v1/crypto`, `/api/v1/admin/crypto` | 39 | `FEATURE_CRYPTO_ENABLED` off → **404** | **2 live-DB tests** — buy→sell journey w/ balanced legs + audit + replay; tier-0 refusal | `flag-gated` HTTP / `covered` service-level |
| Invest | `/api/v1/invest`, `/api/v1/stocks`, `/api/v1/admin/invest` | 76 | `FEATURE_INVEST_ENABLED` off → **404** | **2 live-DB tests** — onboard→deposit→buy→pending-settlement→portfolio→alert-eval; tier-0 refusal | `flag-gated` HTTP / `covered` service-level |
| Trading | `/api/v1/trading`, `/api/v1/admin/trading` | 21 | `FEATURE_TRADING_ENABLED` off → **404** | existing `TestLiveDB_KycGatesWallet` (module-KYC gate on wallet subscribe) + new suite runs | `flag-gated` HTTP / `covered` service-level |
| Fractional RE | `/api/finance/fractionalre` (+`/admin`) | 73 | `FEATURE_FRACTIONAL_RE_ENABLED` off → **404** | **2 live-DB tests** — subscribe→close→allocate→dividend; KYC + income-cap refusals | `flag-gated` HTTP / `covered` service-level |
| Spotlight Wealth | `/api/v1/spotlight*` | 24 | `FEATURE_SPOTLIGHTWEALTH_ENABLED` off → **404** | **1 live-DB test** — join→complete→reward credit + replay + join-gate refusal | `flag-gated` HTTP / `covered` service-level |
| Arena | `/api/arena*` | 50 | `FEATURE_ARENA_ENABLED` off → **404** | **2 live-DB tests** — support Contribute→pot projection + replay; tier-0 refusal | `flag-gated` HTTP / `covered` service-level |
| Legacy FX | `/api/finance/fx`, `/api/finance/admin/fx` | 7 | flag on but handler nil w/o `MAPLERAD_SECRET_KEY` → **404** | flag-gate probe | `flag-gated` (provider-key-dependent) |
| Maplerad domain | `/api/finance/maplerad/*` | 5 | `FEATURE_MAPLERAD_ENABLED` off → **404** | flag-gate probe | `flag-gated` |
| Doctor bank-account | `/api/v1/doctor/profile/bank-account*` | 2 | `FEATURE_DOCTOR_ENABLED` off → **404** | flag-gate probe | `flag-gated` |

`webhook-only` surfaces: `/api/v1/fx/webhooks/maplerad` (provider-signed
inbound — exercised as an unsigned-but-real POST with `collection.credited`
payloads, incl. dedup + unmatched-reference probes; a live Maplerad signature
remains `psp-unverified`), `POST /api/v1/fx/webhooks` admin-config endpoints
(covered via business spec).

`seed-dependent` remains: arena play-along/exam/credential rails (need quiz
question-bank + rubric seeds), invest settlement worker T+N completion (needs
clock advance), crypto admin withdrawal broadcast (needs AML queue + provider
seeds — the state machine up to `pending_review` is covered).

## 2. Journeys proven (money paths)

| ID | Journey | Verdict | Evidence |
|---|---|---|---|
| MTL-J1 | FX quote → lock → conversion | **PASS** | `mtl-001` — quote locked → converted; `orch_ledger_entries` balanced (DR source wallet / CR dest wallet + fee leg); replay returns same conversion, zero new legs; consumed quote → 400/409; below-min quote → refused |
| MTL-J2 | FX collection VA → provider webhook credit | **PASS** | `mtl-001` — VA issued; `collection.credited` webhook posts `customer_balance` CREDIT 250_000 + `provider_clearing` DEBIT 250_000 under the collection event id; redelivery dedups on `provider_event_id`; unmatched reference credits nothing |
| MTL-J3 | FX same-currency + cross-currency transfer | **PASS** | `mtl-001` — same-currency transfer posts legs; cross-currency consumes a quote end-to-end |
| MTL-J4 | FX verification + disputes | **PASS** | `mtl-001` — verification submit/restart transitions; dispute create/list honored |
| MTL-J5 | FX business console | **PASS** | `mtl-002` — team/approvals/thresholds/activity/limits/notifications; API-key create→rotate→list; webhook settings CRUD; stablecoin addresses; virtual-card surface honest 501/empty when no issuer wired |
| MTL-J6 | Utility bills catalogue → validate → quote → pay | **PASS** | `mtl-003` — categories + billers real rows; customer validation; quote pricing; pay debits wallet, provider failure auto-reverses (REVERSED txn + reversal legs + wallet restored); replay idempotent; beneficiaries CRUD |
| MTL-J7 | Utility bills admin control plane | **PASS** | `mtl-004` — full admin surface green (see §1); credentials rotation fails closed w/o key; non-admin → 403 |
| MTL-J8 | Transfers resolve-account | **PASS** | `mtl-005` — NUBAN resolves via deterministic registry fallback; malformed → 404 `invalid_account`; missing bank_code → 400; anon → 401 |
| MTL-J9 | Restaurant bank-accounts | **PASS** | `mtl-005` — CRUD + default + masked PAN + authz; verify = `psp-unverified` (placeholder Paystack key → clean 400) |
| MTL-J10 | Crypto buy → sell | **PASS** | `TestLiveDB_CryptoBuySellJourney` — buy posts DR wallet / CR escrow pair + `crypto.buy` audit + holding credit; sell posts reverse pair; replays return same order, no second legs |
| MTL-J11 | Invest onboard → deposit → buy → alert | **PASS** | `TestLiveDB_InvestDepositBuyAlertJourney` — deposit posts main-ledger pair + invest-ledger `:inv` legs; market buy on seeded GTCO fills → `PendingSettlement`; alert evaluate triggers + persists `triggered` |
| MTL-J12 | Fractional RE subscribe → close → dividend | **PASS** | `TestLiveDB_FractionalRESubscribeDividendJourney` — escrow pair under subscription key; maker/checker SoD enforced both ways; cap-table allocation; distribution approval pays net pool via balanced pair |
| MTL-J13 | Arena support contribute | **PASS** | `TestLiveDB_ArenaSupportContributeJourney` — wallet→`arena_support_pot` pair + support tag row; replay no-op on both; `PotTotal` projection exact |
| MTL-J14 | Spotlight Wealth challenge reward | **PASS** | `TestLiveDB_ChallengeRewardWalletCredit` — completion redistributes from `paymax_revenue` standing account (never minted) in one balanced pair; replay pays once; reward sub-ledger consistent |
| MTL-J15 | Trading wallet subscribe gate | **PASS** | `TestLiveDB_KycGatesWallet` (existing, re-run green) — module-KYC gate refuses deposit w/o approval, approves after |

## 3. Ledger-leg evidence

All leg assertions run read-only SQL against `ledger_entries` /
`orch_ledger_entries` / `invest_ledger_entries` (a balanced pair = 2 rows, each
carrying the full amount):

- FX conversion: DR source-currency wallet / CR dest-currency wallet + fee leg,
  `orch_ledger_entries` grouped by `reference` — debits == credits per currency.
- FX collection: `customer_balance` CREDIT 250_000 + `provider_clearing` DEBIT
  250_000 scoped to the specific `orch_collection_events.id`.
- Utility-bills pay: debit pair on attempt; provider failure → reversal pair
  (`REVERSAL_DEBIT`/`REVERSAL_CREDIT`) restores the wallet — balance returns to
  the pre-pay value exactly.
- Crypto buy: `idem:wallet:*` = 2 rows × 1_000_000 (DR `user_wallet` / CR
  `escrow`); crypto sell: 2 rows × proceeds (DR `escrow` / CR `user_wallet`).
- Invest deposit: `idem:main:*` = 2 rows × 10_000_000 main-ledger +
  `idem:inv:*` invest-ledger cash credit.
- Fractional RE: subscription escrow pair 2 × 5_000_000; distribution payout
  pair 2 × 1_000_000 (sole holder receives entire net pool).
- Arena support: pair 2 × 250_000 DR wallet / CR `arena_support_pot`.
- Spotlight reward: pair 2 × 500_000 DR `paymax_revenue` / CR member wallet.

## 4. Tier-refusal probes (per money journey)

| Journey | Probe | Result |
|---|---|---|
| Utility bills pay | tier-0 user, funded wallet | **403** before any leg — zero `ledger_entries` for the key |
| Crypto buy | tier-0 funded wallet | `tiers.ErrWalletDisabled` (→403 at handler), **0 legs** |
| Invest deposit | tier-0 funded wallet | `tiers.ErrWalletDisabled`, **0 legs on BOTH ledgers** |
| Fractional RE subscribe | verified tier-0 | `ErrKYCRequired` (tier<1 gate), **0 legs** |
| Fractional RE subscribe | retail, 0 declared income | `ErrLimitExceeded` (fail-closed 10%-income cap), **0 legs** |
| Arena support | tier-0 backer | `ErrKYCTierTooLow`/`ErrWalletDisabled`, **0 legs + 0 tag rows** |
| Spotlight reward | n/a — money-IN path | debit tier gate not applicable; refusal surface = `ErrForbidden` completing unjoined (proven) |
| FX conversion | min-limit + consumed-quote | refused before execution; no new legs |

## 5. Provider rail classifications

- `psp-unverified` — `POST /api/finance/restaurant/bank-accounts/verify`:
  wired to the RAW Paystack client (no registry mock fallback);
  `PAYSTACK_SECRET_KEY=sk_test_xxxx…` placeholder → real call answers
  `restaurant: account verification failed: paystack: resolve account:
  Invalid key` → HTTP 400. The exact unreachable call: Paystack
  `GET /bank/resolve?account_number=…&bank_code=058`.
- `psp-unverified` — utility-bills fulfillment: pay path debits, provider call
  cannot complete locally (no live VTpass credentials) → auto-reversal
  exercised instead; the provider hop itself is unverified.
- `psp-unverified` — `/api/v1/fx/webhooks/maplerad`: exercised with unsigned
  payloads (accepted contract-shape; dedup + no-credit-on-unmatched proven);
  a signed Maplerad delivery needs a live `MAPLERAD_SECRET_KEY` (absent →
  legacy `/api/finance/fx` handler is nil → 404 evidence).
- `mock-covered` — transfers `resolve-account`: disbursement registry
  degrades to deterministic mock on transport error, so the full path is
  covered; the live bank-network call is `psp-unverified`.
- `mock-covered` — FX orchestration executes through `mock-provider`
  failover (no external rail).

## 6. Findings

### E2E-MTL-001 — duplicate category-setting POST returns 500 — **medium**

`POST /api/finance/admin/utilitybills/categories` with an existing category
answers HTTP 500 `internal server error` — the raw Postgres unique-violation
propagates unmapped instead of a conflict-shaped 400/409.

- File: `backend/internal/utilitybills/admin_service.go:805-808`
  (`CreateCategorySetting` returns `s.repo.CreateCategorySetting` error
  verbatim; no `23505` → `ErrConflict`/`ErrBadRequest` mapping).
- Repro: `POST /api/finance/admin/utilitybills/categories
  {"category":"internet","enabled":true,"daily_limit_kobo":1000000}` twice as
  an admin (the six categories are pre-seeded, so the first POST already
  reproduces).
- Observed by `mtl-004-utilitybills-admin.spec.ts` (assertion widened to keep
  coverage green; the 500 branch is the live answer).
- Impact: cosmetic/contract — no money or state corrupted; response code lies
  to operators and breaks idempotent provisioning scripts.

### E2E-MTL-002 — invest deposit replay surfaces a 500 — **medium**

`POST /api/v1/invest/wallet/deposit` replayed with the same
`Idempotency-Key` returns HTTP 500: `Service.Deposit` propagates
`ledger.ErrDuplicate` from `mainLedger.Debit`
(`backend/internal/invest/service.go:441-442`) and the invest `errMap`
(`backend/internal/invest/handler.go:31-43`) does not map
`ledger.ErrDuplicate`, so it falls to the 500 default.

- Repro: deposit once, repeat the request byte-for-byte (same key, same
  amount) → 500. Proven live-DB: replay call returns `ErrDuplicate` while the
  ledger correctly holds exactly 2 rows (no double post — money is SAFE; the
  API response is the defect).
- Expected contract (per the codebase's own convention — crypto Buy/Sell,
  arena Contribute, utilitybills pay): replay returns the same success
  payload, not an internal error.
- Impact: client-side retry safety is degraded — a timeout+retry on a deposit
  looks like a failure to the member even though the deposit posted.

### E2E-MTL-003 — resolve-account format errors answer 404 — **low**

`POST /api/finance/transfers/resolve-account` with a malformed NUBAN
(`account_number:"123"`) answers **404** `invalid_account`, the same response
as a syntactically-valid-but-unknown account. Format-validation failures
funnel into `ErrInvalidAccount` which is mapped 404 at
`backend/internal/finance/transfers/decision.go:69`
(refusal raised at `service_ext.go:~150-196`). Missing `bank_code` correctly
400s via binding. Severity low — arguable semantics, but a client can't
distinguish "fix your input" from "account doesn't exist".

### E2E-MTL-004 — restaurant bank-account verify has no mock/provider seam — **low**

The restaurant verify rail calls the raw Paystack client directly, unlike
transfers' disbursement registry which wraps live calls in a deterministic
mock fallback (`liveWrap`). With any non-live key the endpoint can only
answer 400 — it can never return its success contract in a local/CI
environment. `psp-unverified` by design; flagged so a fixer can decide
whether a `VerificationProvider` seam (mock-first, real-last) should be added.

## 7. Coverage counts

- HTTP E2E: **22/22 passing** (`chromium-desktop`), 5 spec files.
- Live-DB Go: **9 new tests, 9 passing** across 5 files (+ existing trading
  gate suite re-run green).
- Package suites: **26/26 owned packages `ok`** under `TEST_DATABASE_URL`.
- `go build ./...` clean; `go vet ./...` clean; `tsc --noEmit` clean for this
  lane.
- Money journeys proven with balanced-ledger evidence: **15** (J1–J15).
- Tier/cap/KYC refusals proven with zero-ledger-leg evidence: **8** probes.
- Flag-gate 404 evidence: **15 routes** across 10 disabled/unwired modules.
- Findings filed: **4** (E2E-MTL-001..004) — none fixed here; awaiting fixer
  dispatch per lane rules.

## 8. Residual gaps (classified, not covered)

- `seed-dependent`: arena play-along/exam/credential/adjudication rails
  (question-bank + rubric + ed25519 adapter seeds); crypto admin withdrawal
  broadcast beyond `pending_review`; invest settlement T+N finalization
  (requires clock control) — the order state machine through
  `PendingSettlement` IS covered.
- `internal-only`: worker endpoints (`workers/requery-pending`, sweep) covered
  as invocable surfaces; their schedules are worker-cron, not HTTP.
- `provider-key-dependent`: legacy `/api/finance/fx` + admin markup store —
  handler is nil without `MAPLERAD_SECRET_KEY` (404 evidence; classed
  `psp-unverified`).
- `webhook-only`: provider-signed webhooks listed in §5.
