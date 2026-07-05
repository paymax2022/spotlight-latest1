# Paymax Invest · Crypto — Backend (Go)

A self-contained Go service implementing the crypto endpoints the mobile app
calls. It follows the architecture in `../docs/crypto`: a **provider-adapter**
spine (Market Data · Liquidity · Custody) with **mock adapters first**, a
**double-entry ledger**, an **order state machine**, **idempotency** on every
money mutation, and **server-side pre-trade checks** (the server re-prices every
order — it never trusts client-sent prices or fees).

Stdlib only — no external modules, so it builds and runs offline.

## Run

```bash
cd backend
go run ./cmd/server          # listens on :8080 (override with PORT=xxxx)
# health check:
curl localhost:8080/healthz
```

Requires **Go 1.22+** (uses the method-aware `net/http.ServeMux`).

## Verify

```bash
make check        # go vet + go test ./... + go build   (or run individually)
go test ./...     # unit tests: fee/quote math, ledger, pre-trade checks,
                  # portfolio aggregation, idempotency replay (per docs/crypto/acceptance.md)
```

After it's running, `./smoke.sh` exercises the live HTTP surface end-to-end.

## Docker

Multi-stage build → a static binary on a **distroless nonroot** image (no shell,
minimal CVE surface). Build once, promote the same SHA-tagged image across envs.

```bash
docker build -t paymax/crypto-service:dev .
docker run --rm -p 8080:8080 paymax/crypto-service:dev
# or:
docker compose up --build
```

Readiness/liveness is an HTTP probe on `GET /healthz` (the image has no shell, so
there's intentionally no Docker `HEALTHCHECK` — use a k8s/orchestrator probe).

## CI

`.github/workflows/crypto-backend.yml` gates every change to `backend/`:

1. `go vet` → `go test ./...` → `go build` → `govulncheck`
2. build the SHA-tagged image, then **Trivy** scan (fails on HIGH/CRITICAL)

A separate workflow typechecks the mobile crypto module. Merges should be blocked
on a green pipeline. This is the automated gate that replaces "compile it on my
machine".

## Point the mobile app at it

In the app's `.env`:

```
EXPO_PUBLIC_CRYPTO_USE_MOCK=false
EXPO_PUBLIC_API_BASE_URL=http://localhost:8080
```

Then restart Expo. Only the crypto module goes live — every other module keeps
its own `USE_MOCK` flag (all default to mock), so nothing else changes. On a
device/simulator, replace `localhost` with your machine's LAN IP.

## Layout

```
backend/
  cmd/server/main.go        bootstrap
  internal/
    domain/                 data contract (mirrors the mobile TS types 1:1)
    engine/                 pricing/fee math (ported from cryptoFormatters) + ids + chart
    store/                  in-memory state: assets, holdings, txns, quotes,
                            watchlist, alerts, addresses, double-entry ledger,
                            idempotency cache, execution (buy/sell/swap)
    adapter/                provider-adapter interfaces + mock implementations
    api/                    HTTP router, CORS/recover middleware, handlers
```

Replace the in-memory `store` with Postgres/Redis and the `adapter` mocks with
real providers (Fireblocks/Bitt/Alpaca…) behind the same interfaces — no handler
or client change required.

## Persistence (the storage seam)

The HTTP layer and adapters depend on `store.Repository` (see
`internal/store/repository.go`), **not** a concrete store. Two implementations
ship: the in-memory mock (`internal/store`) and **Postgres** (`internal/pgstore`,
pgx/v5). `cmd/server/main.go` picks by env:

```go
if DATABASE_URL set  → pgstore.New(ctx, dsn)   // real persistence
else                 → store.New()             // in-memory mock
```

The schema lives in `migrations/` (golang-migrate format): `000001_init` (expand-
only) + `000002_seed` (demo data). Money is `BIGINT` minor units; the ledger is
double-entry; buy/sell/swap run in **one DB transaction** (wallet + position +
ledger + history); idempotency keys and server quotes have their own tables.

```bash
# external deps now (pgx) — commit go.sum:
go mod tidy

# run with Postgres (manual):
export DATABASE_URL="postgres://paymax:paymax@localhost:5432/paymax?sslmode=disable"
migrate -path migrations -database "$DATABASE_URL" up   # 000001 + 000002
go run ./cmd/server

# or the whole stack (postgres + migrate + service) in one command:
docker compose up --build
```

Follow **expand/contract** for future changes: add columns/tables (expand),
deploy code that writes both shapes, backfill, switch reads, then drop the old
shape in a later contract migration — never a destructive change in the same
release as the code that needs it.

## Endpoints (base `/api/v1`)

| Method | Path | Returns |
|---|---|---|
| GET | `/invest/eligibility` | Eligibility |
| GET | `/crypto/assets` · `/crypto/assets/{symbol}` | Asset(s) |
| GET | `/crypto/assets/{symbol}/chart?range=` | CandlePoint[] |
| POST | `/crypto/quote` | Quote or SwapQuote (by `side`) |
| POST | `/crypto/buy` · `/crypto/sell` | Order (Idempotency-Key) |
| POST | `/crypto/swap` | SwapResult (Idempotency-Key) |
| GET | `/crypto/deposit-address?symbol=&network=` | DepositAddress |
| GET | `/portfolio` · `/portfolio/positions` | Portfolio · Position[] |
| GET | `/crypto/transactions?side=` · `/crypto/transactions/{id}` | TxSummary[] · TxDetail |
| GET/POST/DELETE | `/watchlists` · `/watchlists/default/assets[/{id}]` | Asset[] / 204 |
| GET/POST/DELETE | `/alerts[/{id}]` | PriceAlert[] / PriceAlert / 204 |
| GET/POST/DELETE | `/crypto/addresses[/{id}]` · `/crypto/addresses/screen` | Address[] / Address / AddressScreening |
| GET | `/crypto/withdrawals/eligibility` | WithdrawalEligibility |
| POST | `/crypto/withdrawals/quote` | WithdrawalQuote |
| POST | `/crypto/withdraw` | WithdrawalResult — `WithdrawalPendingReview` (manual-review MVP) |

## Notes / guarantees

- **Money** is integer minor units everywhere (kobo for fiat, base units for
  crypto); the JSON shapes match the mobile types exactly.
- **Idempotency**: replaying a buy/sell/swap/withdraw with the same
  `Idempotency-Key` returns the original result without re-executing.
- **Ledger**: every buy/sell/swap writes a double-entry `LedgerEntry`; balances
  are never derived from a provider alone.
- **Withdrawals** terminate in `WithdrawalPendingReview` (compliance gate), per
  the MVP rule that crypto withdrawals are manual-review only.
- **Auth**: the `Authorization` bearer is verified as a Supabase **HS256 JWT**
  (`internal/auth`, stdlib-only — algorithm pinned, signature + `exp` + `sub`
  checked). Set `SUPABASE_JWT_SECRET` to enforce it; leave it unset for DEV mode,
  where requests pass through as a single `demo-user` so the mock runs locally.
  The verified user id is on the request context via `auth.UserID(ctx)` — ready
  for per-user data scoping once the Postgres `Repository` lands (the in-memory
  store is single-user today). For RS256/JWKS projects, swap `Verify` for a
  JWKS-fetching variant behind the same middleware.

```bash
# enforce auth (server-side env, not an EXPO_ var):
export SUPABASE_JWT_SECRET="<your supabase project JWT secret>"
```
