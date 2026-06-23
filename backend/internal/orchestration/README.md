# FX Orchestration Layer (`internal/orchestration`)

Production-grade, provider-agnostic FX orchestration implementing the Paymax
normalized API on top of a smart order router, spread engine, treasury and a
unified multi-currency ledger. Additive module — the existing `internal/finance/fx`
(legacy single-provider wallet FX) is left untouched.

## Design invariants (enforced in code)
- **Money** is always `{amount: integer minor units, currency: ISO-4217}` — `Money` in `money.go`. No floats stored.
- **Every mutation carries an `Idempotency-Key`** — enforced in handlers + a unique index on `idempotency_key`; replays return the original result.
- **Provider-agnostic caller** — `Provider` interface (`provider.go`); the router decides. Adapters: `adapters/eversend.go`, `adapters/maplerad.go`.
- **Quote → (lock) → execute** against a `quote_id` — `QuoteBook` (`quotebook.go`); executing an expired quote returns `rate_expired`.
- **One ledger is the source of truth** — balanced, append-only entries in `orch_ledger_entries`; balances are projections.

## Files
| File | Responsibility |
| --- | --- |
| `money.go` | Money primitive + minor-unit math (rate apply/inverse, bps) |
| `errors.go` | Normalized error envelope (spec §5.1) + HTTP mapping |
| `domain.go` | Quote/Conversion/Transfer/Collection models + request bodies |
| `rates.go` | Indicative mid-rate table + corridor helpers |
| `spread.go` | Spread engine: bps per corridor×tier with min/max guards (§9) |
| `router.go` | Smart order router: weighted scoring + ranking (§6) |
| `treasury.go` | Float buckets, exposure limits, liquidity confidence (§7) |
| `quotebook.go` | Quote lifecycle store with lock TTL (§5.8) |
| `provider.go` | `Provider` adapter interface (§10) |
| `adapters/` | Eversend + Maplerad deterministic adapters (no creds needed in dev) |
| `service.go` | Orchestrator: quote aggregation, routing, execution, failover, ledger |
| `store.go` | `Store` persistence interface + in-memory implementation |
| `repository.go` | Postgres (pgx) `Store` — transactional, row-locked, idempotent |
| `handler.go` | Gin handlers for the `/api/v1/fx` normalized API |
| `orchestration_test.go` | Pure-logic + end-to-end unit tests (no DB required) |

## Endpoints (mounted at `/api/v1/fx`, behind auth)
`POST /quotes` · `POST /quotes/:id/lock` · `POST /conversions` · `POST /transfers` ·
`POST /collections/virtual-accounts` · `GET /rates` · `GET /balances` ·
`GET /transactions` · `GET /transactions/:id`

See `contracts/openapi.yaml` (tag **FX Orchestration**) for the full contract.

## Enabling
1. Apply the migration `supabase/migrations/20260621000000_fx_orchestration.sql`.
2. Set env: `FEATURE_FX_ORCHESTRATION_ENABLED=true` (plus `DATABASE_URL`).
3. Optional: `MAPLERAD_PROD=true` for live adapters.

Routes register in `internal/app/finance_routes.go` only when the flag and DB are present.

## Build & test
```bash
cd backend
go build ./...
go test ./internal/orchestration/...   # pure-logic + e2e tests, no DB needed
go vet ./internal/orchestration/...
```

The test suite (`orchestration_test.go`) covers: minor-unit rate math, spread
resolution + guards, router selection/no-viable, quote consume/expiry, and an
end-to-end conversion (happy path, **idempotent replay**, **insufficient balance**,
**rate expired**, **provider failover to the alternative**, missing idempotency key).

## Live providers, webhooks, treasury & Redis
- **Live adapters:** `adapters/maplerad_live.go` (wraps the shared maplerad client) and `adapters/eversend_live.go` (wraps `internal/provider/eversend`, token auth, major⇄minor unit conversion). Selected in `finance_routes.go` when credentials are set; otherwise the deterministic adapters keep corridors routable. Both verify HMAC-SHA256 webhooks and fall back to deterministic pricing on any remote error.
- **Credentials:** read from env only (`MAPLERAD_SECRET_KEY/PUBLIC_KEY`, `EVERSEND_CLIENT_ID/CLIENT_SECRET`, `*_WEBHOOK_SECRET`). Local values live in `backend/.env` (gitignored); see `backend/.env.example`.
- **Redis quote book:** `redis_quotebook.go` (`RedisQuoteBook`) — JSON at `fx:quote:<id>`, TTL = lock window, SETNX consumed-marker for single execution across instances. Used automatically when `REDIS_URL` resolves.
- **Webhooks:** outbound signed events via `WebhookEmitter` (`Paymax-Signature: t=…,v1=…`, set `PAYMAX_WEBHOOK_OUT_URL`/`PAYMAX_WEBHOOK_SECRET`); inbound at `POST /api/v1/fx/webhooks/:provider` (provider-signed, no auth).
- **Treasury automation:** `StartTreasuryMonitor` background loop auto-rebalances buckets at/below low-water and emits `balance.low`.

## Status / caveats
- The two provider adapters are **deterministic** (rates from the indicative table,
  no external HTTP) so the layer is fully runnable in dev/CI without credentials.
  In production each adapter method maps onto the provider's real REST API; the
  public method set (and therefore the orchestrator) is unchanged.
- Quote lifecycle uses an in-memory `QuoteBook`; for multi-instance deployments
  back it with Redis (TTL = lock window) — the interface is unchanged.
- This package was authored in an environment without a Go toolchain, so it was
  verified by static review (brace/interface/identifier checks) rather than
  `go build`. Run the build/test commands above in CI before deploy.
