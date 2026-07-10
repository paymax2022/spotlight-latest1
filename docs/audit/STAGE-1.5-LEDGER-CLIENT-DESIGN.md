# Stage 1.5 — `LedgerClient`: Trading Module Posts Through the Money-Core Ledger

**Status:** Design only (no code). Implements decision **D1** from
`docs/audit/PHASE-2-CONSOLIDATION-DESIGN.md`: *money-core `finance/ledger` is the
single source of truth; the trading module stops being its own bank.*

**Blast radius:** the trading module's money path (`store.ExecuteBuy/Sell/Swap`,
`RecordWithdrawal`, balance reads). This is the highest-risk consolidation step, so
it ships behind a flag, shadow-runs first, and cuts over per-environment.

---

## 1. Problem

Today the trading module (`paymax/crypto-backend`) keeps its **own** balances:
- `pgstore.Store` reads/writes a `wallet_balances` table; `store.PgRepository`
  derives cash from a **single-row** `LedgerEntry` table — two divergent stores.
- Neither is the money-core double-entry ledger (`backend/internal/finance/ledger`),
  which is the authoritative, immutable, TOCTOU-safe, idempotent balance system.

Result: a user's cash can exist in two places that never reconcile. Quidax/Alpaca
features cannot be built on a second, weaker ledger.

## 2. Target

The trading module owns **read models only** (positions, orders, quotes). Every
**cash movement** posts a balanced double-entry pair to the money-core ledger via a
`LedgerClient` port. Investable balance is **read** from the money core, never stored.

```
stocks/crypto execution ──▶ LedgerClient (port) ──▶ money-core finance/ledger
     (read models)              mock | http            (authoritative balances)
```

## 3. The port (trading-module side)

New package `internal/ledger` in `paymax/crypto-backend`:

```go
// LedgerClient posts balanced money legs to the authoritative ledger and reads
// derived balances. The trading module depends only on this interface.
type LedgerClient interface {
    // PostJournal posts ONE balanced double-entry pair, idempotently. Amount is in
    // minor units (kobo). Returns ErrInsufficientFunds when a balance-checked debit
    // would overdraw. A replayed idempotencyKey is a no-op success.
    PostJournal(ctx context.Context, j Journal) error

    // Balance returns the derived balance (minor units) of an account for a user.
    Balance(ctx context.Context, userID, account string) (int64, error)
}

type Journal struct {
    UserID         string
    DebitAccount   string // e.g. "user_wallet"
    CreditAccount  string // e.g. "settlement"
    AmountKobo     int64  // > 0
    Reference      string // human purpose, e.g. "stock_buy:PMX-ST-…"
    IdempotencyKey string // required
    BalanceChecked bool   // true → fail closed on overdraw (buys/withdrawals)
}
```

Two implementations:
- **`mockLedger`** — wraps today's in-module behavior (single-row ledger / balances),
  so offline/dev builds keep working with zero external dependency. Default.
- **`httpLedger`** — calls the money-core internal API (§4). Selected by
  `LEDGER_BACKEND=http` (+ `LEDGER_BASE_URL`, `LEDGER_SERVICE_TOKEN`).

## 4. Money-core side (additive)

A new **internal, service-authenticated** route in `spotlight/backend` — not exposed
to end users:

```
POST /internal/finance/ledger/journal   (Authorization: Bearer <service token>)
  body { userId, debitAccount, creditAccount, amountKobo, reference, idempotencyKey, balanceChecked }
  200  { posted: true }
  409  { error: "insufficient_funds" }        // balance-checked overdraw
  200  { posted: true, replay: true }          // idempotent replay
GET  /internal/finance/ledger/balance?userId=&account=
  200  { balanceKobo }
```

Implementation maps 1:1 onto the **existing** ledger service — no new ledger logic:
- `balanceChecked=true` → `ledger.DebitWithBalanceCheck` (advisory-lock + in-tx
  re-projection, the TOCTOU-safe primitive).
- else → `ledger.PostJournal(JournalEntry{...})`.
- Balance → `ledger.GetBalance`.
- Idempotency, per-leg key suffixing, immutability, reversal-only correction: all
  already enforced by the money core. The trading module inherits them for free.

Auth: a dedicated service token (short-lived, rotate via secrets manager). Never a
user JWT. Rate-limited and network-restricted to the trading service.

## 5. Account mapping (trading → money-core `AccountType`)

| Trading operation | Debit | Credit | BalanceChecked |
|---|---|---|---|
| Fund wallet (fiat on-ramp webhook) | `provider_clearing` | `user_wallet` | no |
| Stock/crypto **buy** (cash leg) | `user_wallet` | `settlement` | **yes** |
| Stock/crypto **sell** (cash leg) | `settlement` | `user_wallet` | no |
| Crypto **swap** spread | `user_wallet` | `paymax_revenue` | yes (net) |
| Crypto **withdrawal** hold | `user_wallet` | `settlement` | **yes** |
| Withdrawal **reversal** (AML reject/fail) | reversal pair | | — |

Holdings/positions (crypto units, share counts) remain **read-model projections** in
the trading module (and, canonically, in `backend/internal/crypto` for crypto per
decision D2) — the ledger owns **cash**, not unit counts. The unit legs are recorded
in the module's own tables and reconciled against custody (existing `recon`/`onchain`).

## 6. Rollout — shadow, then cut over

1. **Introduce the port** behind `mockLedger` (default). No behavior change. Refactor
   `ExecuteBuy/Sell/Swap`/`RecordWithdrawal` to call `LedgerClient.PostJournal`
   instead of writing `LedgerEntry` directly. Full test parity.
2. **Build `httpLedger`** + the money-core internal endpoint. Unit + contract tests.
3. **Shadow mode** (`LEDGER_BACKEND=shadow`): post to `mockLedger` (authoritative for
   now) AND `httpLedger`, compare results, log divergences. Run in staging until zero
   drift over a representative window.
4. **Cut over** (`LEDGER_BACKEND=http`) per environment; `mockLedger` becomes the
   offline-dev default only. Retire `wallet_balances` / the single-row ledger once
   the module reads balances exclusively from the money core.
5. **Reconciliation job**: periodic diff of trading read-model expectations vs
   money-core balances (extends the existing `recon` package) → alert on drift.

## 7. Invariants preserved

- Integer minor units; balanced double-entry; derived balances; idempotent replays;
  reversal-only corrections; TOCTOU-safe debits — all inherited from the money core.
- Compliance gates unchanged: eligibility + feature-flag kill-switch run **before**
  any `PostJournal`; crypto withdrawal AML gate stays authoritative (custody called
  only after approval).
- No end-user API shape changes; the internal ledger API is service-only.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Money path regression | shadow mode + full test parity + staged cutover + reconciliation alerts |
| Cross-service latency on hot path | co-locate services; `httpLedger` uses the circuit breaker + tight timeout; balance reads cached briefly |
| Double-posting on retry | idempotency key per operation leg (money core enforces `UNIQUE`) |
| Service-token compromise | short-lived rotated token, network-restricted, never a user JWT |
| Divergent account taxonomy | mapping table (§5) is the single source; add money-core `AccountType`s additively if needed |

---

*Design only — no code changed. Implementation begins after the Stage 2 code is
verified green and this design is approved.*
