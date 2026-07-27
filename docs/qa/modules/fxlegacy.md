# Module: FX (Legacy single-provider wallet FX)

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes &nbsp;·&nbsp; **Feature flag:** `FEATURE_FX_ENABLED` (and requires a configured Maplerad client)
**Code:** `backend/internal/finance/fx/` (`handler.go`, `service.go`, `model.go`, `model_test.go`); mounted in `backend/internal/app/finance_routes.go`
**Slug:** `FXLEGACY` (uppercase, used in Case IDs)

## 1. Overview & scope

Legacy FX gives a user **multi-currency wallets** and a quote→convert flow against a **single provider (Maplerad)**. `GetQuote` fetches a provider rate, stores it, and reserves it in Redis with a 5-minute TTL; `Convert` executes a valid, unexpired quote. The money design: the NGN source leg is a user-wallet `Debit` (balanced double-entry via the ledger), the target-currency leg is a balanced `PostJournal` (DR settlement → CR fx_spread_income), and `currency_wallets` is updated only as a **mirror** of the target-leg ledger post inside the same tx that inserts the conversion row (guarded by `UNIQUE(idempotency_key)`). Provider failure post-debit posts a reversal (fail-closed). This is the older path; the provider-agnostic engine is in `fxorch.md`. Cross-cutting: `../cross-cutting/money-invariants.md`, `../cross-cutting/webhooks-and-providers.md`.

## 2. Services / endpoints in scope

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Get quote | `POST /api/finance/fx/quote` | token | no (quote reserve) |
| Convert | `POST /api/finance/fx/convert` | token | yes |
| History | `GET /api/finance/fx/history?limit&offset` | token (owner) | no |
| Currency wallet | `GET /api/finance/fx/wallets/:currency` | token (owner) | no |

`QuoteRequest`: `source_currency` (required), `target_currency` (required), `amount_kobo` (required, `min=100`). `ConvertRequest`: `quote_id` (required), `idempotency_key` (required). `quoteTTL = 5m`. Total debit = `SourceAmountKobo + FeeKobo`.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Amounts are minor-unit integers | unit | `internal/finance/fx/model_test.go` (`TestAmountsAreMinorUnits`, `TestCurrencyWalletMinorUnits`) | AUTOMATED |
| Quote min amount (100 kobo) | unit | `model_test.go` (`TestQuoteRequestMinAmount`) | AUTOMATED |
| Conversion status values | unit | `model_test.go` (`TestConversionStatusValues`) | AUTOMATED |
| Total debit includes fee | inv | `model_test.go` (`TestFXConvert_TotalDebitIncludesFee`) | AUTOMATED |
| Convert requires idempotency key | inv | `model_test.go` (`TestConvertRequest_RequiresIdempotencyKey`) | AUTOMATED |
| Target credit is minor-unit integer | inv | `model_test.go` (`TestFXConvert_CurrencyWalletCreditIsMinorUnitInteger`) | AUTOMATED |
| Reversal on provider failure restores debit | inv | `model_test.go` (`TestFXConvert_ReversalOnProviderFailureRestoresSourceDebit`) | AUTOMATED |
| Quote expiry enforced (real time/DB) | int | — | TODO |
| Convert idempotency + concurrent race (real DB) | int | — | TODO |
| Quote ownership (IDOR) | authz | — (guard in `getQuote` WHERE user_id) | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `FXLEGACY-INT-001` | Quote → convert happy path | P0 | flag on, provider configured, funded | `POST /quote` then `POST /convert` | `amount_kobo=1_000_000` | Quote stored + Redis-reserved; convert debits `amount+fee`, credits target wallet minor units; status `completed` |
| `FXLEGACY-INV-001` | Total debit includes fee | P0 | quote fee `2_500` | `POST /convert` | — | Source wallet debited `SourceAmountKobo + 2_500` (single balanced debit) |
| `FXLEGACY-INV-002` | Convert idempotent replay | P0 | one conversion done | `POST /convert` same `idempotency_key` | same key | Returns existing conversion; no second debit/credit — MONEY-INV-006 |
| `FXLEGACY-INV-003` | Concurrent identical convert → one | P0 | valid quote | Fire N concurrent `POST /convert`, one key | same key | Exactly one wins the `ON CONFLICT` insert; target wallet credited once (no double-credit) — MONEY-INV-007 |
| `FXLEGACY-INV-004` | Target wallet mirrors ledger post | P0 | convert done | Inspect `currency_wallets` vs ledger | — | `currency_wallets` moved only as mirror of the target-leg journal inside the conversion tx; never a bare UPDATE |
| `FXLEGACY-INV-005` | Provider failure reverses debit | P0 | provider `ConvertFX` errors after debit | `POST /convert` | — | Reversal credit restores source; user net-zero; no conversion row; nothing credited |
| `FXLEGACY-INV-006` | Missing idempotency key | P0 | valid quote | `POST /convert` no key | "" | 400 (binding `required`) — MONEY-INV-008 |
| `FXLEGACY-CON-001` | Quote below 100 kobo | P1 | — | `POST /quote` `amount_kobo=50` | <100 | 400 (binding `min=100`) |
| `FXLEGACY-INT-002` | Expired quote rejected | P0 | quote older than 5m | `POST /convert` | expired | Error `quote … has expired`; nothing posted |
| `FXLEGACY-AUTHZ-001` | Convert another user's quote (IDOR) | P0 | A owns quote Q | B `POST /convert` `quote_id=Q` | Q id | Denied (`getQuote WHERE id AND user_id`); B cannot convert A's quote — RBAC-AUTHZ-007 |
| `FXLEGACY-AUTHZ-002` | History/wallet owner-scoped | P1 | A and B have history | B `GET /history`, `GET /wallets/USD` | B token | Only B's data |
| `FXLEGACY-AUTHZ-003` | Identity from token | P0 | A token | any FX call | — | user_id from context; no spoofable body field (401 if empty) |
| `FXLEGACY-SEC-001` | Flag off / provider absent → routes not mounted | P0 | `FEATURE_FX_ENABLED` off (or no Maplerad client) | `POST /quote` | — | 404 (block gated on flag AND `fxHandler != nil`) — FLAG-SEC-001 |
| `FXLEGACY-SEC-002` | Commission recorded once on success | P1 | recorder wired | one successful convert | — | `RecordExact("Finance","Currency Exchange", … feeKobo)` once; replays don't double-count |
| `FXLEGACY-SEC-003` | Convert audit | P1 | — | one convert | — | One audit event — AUDIT-INT-001 |

## 5. State-machine transitions

Minimal — `FXConversion.Status` is `pending | completed | failed`. In the current path a conversion is written directly `completed` on success (or no row on failure after a reversal), so there is no multi-step FSM to exercise beyond the happy/failed branches (`FXLEGACY-INT-001`, `FXLEGACY-INV-005`).

## 6. Security & abuse cases

- **Idempotency + concurrency (`FXLEGACY-INV-002/003`):** whole conversion keyed on `req.IdempotencyKey`; legs suffixed `:debit`/`:credit`; the row insert is `ON CONFLICT (idempotency_key) DO NOTHING RETURNING` so two concurrent converts can't both credit the target wallet.
- **Balance-as-projection (`FXLEGACY-INV-004`):** `currency_wallets` is a mirror of the ledger post, committed in the same tx as the conversion row — never a standalone balance write.
- **Fail-closed on provider error (`FXLEGACY-INV-005`):** reversal restores the source debit; user left net-zero.
- **Quote IDOR (`FXLEGACY-AUTHZ-001`):** quotes are fetched `WHERE id AND user_id`.
- **Rate integrity:** the executed rate/target amount come from the provider `ConvertFX` response, not the client — a client cannot tamper the rate. Quote TTL (5m) bounds stale-rate execution (`FXLEGACY-INT-002`).
- **No-float on persisted values:** amounts are `int64` minor units (the `Rate float64` is a display/derivation field, never the stored money value).

## 7. Automated specs to add

- `internal/finance/fx/live_db_integration_test.go` — skip-gated on `TEST_DATABASE_URL`, mock Maplerad client at the network edge: quote store + expiry, convert idempotency, concurrent-same-key single-credit, `currency_wallets` mirror-in-tx, provider-failure reversal, quote IDOR. (gap G5/G7)
- `internal/finance/fx/handler_test.go` — httptest: 401 on missing user_id, quote `min=100`, convert `idempotency_key` required.

## 8. Coverage target & exit criteria

Tier-0: **≥ 85%** pure-logic (model + convert invariants already covered). Exit: convert idempotency + concurrency proven on real Postgres; target-wallet mirror-in-tx proven; expired-quote + provider-failure reversal proven; quote IDOR proven; flag/provider-absent returns 404; commission recorded exactly once. A double-credit, drifted mirror, or missing reversal is an S1 blocker.
