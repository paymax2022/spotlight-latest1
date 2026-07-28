# Provider Abstraction

**Purpose:** how the platform stays provider-agnostic. Business logic never imports a
vendor SDK; every external capability sits behind an interface, and each vendor is a
thin adapter. This is the seam through which Quidax (crypto/rails) and Alpaca
(brokerage) — and future venues — plug in without touching domain code.

**Golden rule:** *no package under `internal/{store,engine,stocks,api}` (business
logic) may import a concrete provider client.* It depends only on the interfaces
below. Adapters are the only code that knows a vendor exists.

---

## 1. Seams that exist today (`paymax/crypto-backend`)

### 1.1 Crypto: market data / liquidity / custody — `internal/adapter/adapter.go`

Three capability-scoped interfaces; one client can satisfy all three.

| Interface | Methods | Concern |
|---|---|---|
| `MarketData` | `Assets()`, `Asset(key)`, `Chart(symbol, range)` | catalogue + prices |
| `Liquidity`  | `Quote(...)`, `SwapQuote(...)` | executable buy/sell/swap quotes |
| `Custody`    | `DepositAddress(...)`, `WithdrawalQuote(...)`, `ScreenAddress(...)` | on-chain custody + AML screen |

Implementations:
- **Mock** (`adapter.MockMarketData/MockLiquidity/MockCustody`) — compute locally from the `engine`; the default when `PROVIDER` is unset.
- **HTTP** (`internal/httpadapter/Client`) — one `*Client` satisfies all three, calling a generic REST contract. Selected when `PROVIDER=http` (`PROVIDER_BASE_URL`, `PROVIDER_API_KEY`).

**Resilience (Stage 2a):** every `httpadapter` call passes through a
`circuitbreaker.Breaker` at the single `do()` choke point. It trips only on
transport errors / 5xx (a provider-down signal), never on 4xx, and fails fast with
`ErrOpen` when open. `Client.CircuitState()` exposes `closed|open|half-open`.
`ScreenAddress` fails **safe** (returns `flagged`) if the provider is unreachable.

### 1.2 Equities: execution venue — `internal/stocks/broker.go` (Stage 2c)

The brokerage execution seam (previously fills were computed inline, so no real
venue could be plugged in):

```go
type Broker interface { Place(BrokerRequest) BrokerResult }
```

- `MockBroker` reproduces the historical instant-fill behavior (market → `Filled`
  with T+2/T+3 settlement; limit → `Submitted`).
- `Service` holds a `broker` (default `MockBroker{}`) and exposes
  `WithBroker(b Broker)` for injection. `PlaceOrder` delegates only the *resulting
  order state* to the broker — all pre-trade checks, pricing, idempotency and
  persistence stay in `Service`.

### 1.3 Kill-switches (Stage 2b)

Orthogonal to providers but part of operational safety: every money path consults
`admin.Service.FlagEnabled(key)` (`requireFlag`) before executing, so an operator
can halt `crypto_withdrawals`, `invest_stocks`, etc. live (→ `503 feature_disabled`).

### 1.4 Money core (`spotlight/backend`) — the reference pattern

The main module already does ports-and-adapters well; the trading module mirrors it:
- `internal/provider/interfaces.go` — `PaymentProvider`, `DisbursementProvider`, `VirtualAccountProvider`.
- `internal/provider/ports.go` — `IdentityProvider`, `WalletProvider`, `BillsProvider`.
- KYC ports — `IdNumberPort`, `FacialPort`, `LivenessPort`, `DocumentPort`, `AmlPort`.
- Adapters: `paystack`, `monnify`, `maplerad`, `eversend`, Dojah/Smile/Youverify.
- Failover registries: `provider/disbursement/registry.go`, `kycverify/gateway.go`.

---

## 2. Target port set (design — `docs/audit/PHASE-2-CONSOLIDATION-DESIGN.md`)

As real venues are added, the seams converge on four provider concerns. Existing
interfaces map onto them; missing ones are added the same way.

| Port | Covers | Status |
|---|---|---|
| `MarketDataProvider` | quotes, candles, streaming, corporate actions, news | `adapter.MarketData` exists; extend for streaming |
| `BrokerageProvider` | equities order lifecycle (submit → id → webhook fills) | `stocks.Broker` exists (Stage 2c) |
| `CustodyProvider` | crypto deposit addr, withdrawal broadcast, screening | `adapter.Custody` exists; needs real vendor |
| `FiatProvider` | on/off-ramp funding, payouts | money-core `PaymentProvider`/`DisbursementProvider` |

Business logic must never `import` a Quidax or Alpaca SDK — only these ports.

---

## 3. How to add a vendor

### 3.1 Alpaca (equities brokerage)

1. New package `internal/broker/alpaca` implementing `stocks.Broker`:
   - `Place(req) BrokerResult` → call Alpaca's orders API, return
     `Status: "AcceptedByProvider"`, `Provider: "alpaca"`, provider order id in
     history. Do **not** synthesize a fill — Alpaca fills asynchronously.
2. Add an Alpaca **webhook** handler that receives fill/partial/cancel events and
   advances the stored order's status (reuse the crypto webhook hygiene in
   `internal/webhook`: HMAC verify + timestamp/replay window + idempotent dedup).
3. Wire it: `stocks.NewService().WithBroker(alpaca.New(cfg))` in `api.NewServer`
   (behind a `PROVIDER`/flag switch), also feeding `MarketDataProvider` from Alpaca
   for live quotes/candles.
4. No change to `PlaceOrder`, pre-trade checks, or persistence.

### 3.2 Quidax (crypto market data / liquidity / custody)

1. Either point `httpadapter` at a Quidax-shaped gateway, **or** add
   `internal/adapter/quidax` implementing `MarketData` + `Liquidity` + `Custody`
   (translate Quidax's API/webhook semantics into the shared domain types).
2. Wrap its calls in a `circuitbreaker.Breaker` (as `httpadapter` does) and, for
   withdrawals, keep the money-core **AML gate** authoritative — the custody
   provider is only called *after* compliance approval.
3. Wire via `PROVIDER=quidax` in `api.NewServer`.

### 3.3 Future venues

Fireblocks/BitGo (custody), Binance/Kraken/Coinbase (liquidity), IBKR/DriveWealth
(brokerage) each become one adapter implementing the relevant interface — zero
business-logic change. Multi-vendor selection/failover reuses the money-core
registry pattern (`provider/disbursement/registry.go`).

---

## 4. Rules for adapter authors

- Implement the interface exactly; translate vendor types → shared `domain` types at
  the boundary. Never leak a vendor struct past the adapter.
- Wrap outbound calls in a circuit breaker; set sane timeouts; return typed,
  domain-level errors (or `(zero, false)`) — never a raw vendor error.
- Fail **safe** for compliance concerns (screening/AML unreachable ⇒ flag, don't clear).
- Money movement stays idempotent and, for the trading module, will post through the
  money-core ledger via the forthcoming `LedgerClient` port (Stage 1.5) — adapters
  never touch balances directly.
- Every adapter ships with tests (happy path, provider-down → breaker, webhook parse,
  idempotent replay) and does not weaken existing invariants.

---

*Reflects seams as of Stage 2c. Update as `LedgerClient`, streaming market data, and
the first real Alpaca/Quidax adapters land.*
