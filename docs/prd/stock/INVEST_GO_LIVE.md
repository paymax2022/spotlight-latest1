# Paymax Invest — Backend Implementation & Go-Live Notes

Status: **Phase-2 backend foundation implemented** (mock-provider, feature-flagged off).
Framework: **Gin** (matches the existing backend and the root `CLAUDE.md` iron rule
"Gin — NOT Chi"; the original request said chi but the codebase is 100% Gin, so the
module was built on Gin for consistency and safety).

## What shipped

### Database (`supabase/migrations/20260621010000_invest_module.sql`)
Additive-only migration (no DROP / no renames / no type narrowing). Tables:
investor profiles, investment accounts, suitability profiles, versioned agreements +
acceptances, stock assets (seeded NGX sample universe), **invest_ledger_accounts /
invest_ledger_entries** (double-entry investment wallet, logically separate from the
main Paymax wallet), orders + order events, positions, portfolio snapshots, watchlists +
items, price alerts, dividends, corporate actions, public offers + applications, rights
issues + applications, and an admin audit log. All money columns are `bigint` kobo.

Apply with: `supabase db push` (or `supabase migration up`).

### Go module (`backend/internal/invest/`)
Mirrors the existing finance-module shape: `model.go`, `provider.go`, `repository.go`,
`ledger.go`, `service.go`, `handler.go`, `routes.go`, plus `invest_test.go`.

- **Provider-adapter spine**: `BrokerAdapter`, `MarketDataAdapter`, `PublicOfferAdapter`
  interfaces with deterministic **mock** implementations. Real adapters slot in behind
  the same contracts later — no business-logic change required.
- **Order state machine** (`CanTransition`): fail-closed; only legal transitions allowed.
- **Server-side pre-trade checks** before every order: profile active, trading enabled,
  KYC tier ≥ asset requirement, agreements accepted, suitability complete, asset
  enabled, market open (market orders), min/max order amount, PIN confirmation.
- **Double-entry ledger** for the investment wallet: deposit/withdraw, cash lock/unlock,
  buy settlement (locked→broker+fee, residual→cash), sell proceeds→pending settlement,
  settlement release→cash, dividend credit. Balances are projections (SUM), never a
  mutated column. The locked amount is conserved exactly (clamped against float rounding).
- **Idempotency**: orders carry a unique `idempotency_key`; ledger entries are unique per
  key; repeat calls return the existing order/receipt.
- **Failed-order safety**: failed buy releases locked cash; failed sell releases locked
  shares. Settlement is first-class (`ProcessDueSettlements` advances T+N orders — wire to
  the existing cron/asynq queue).
- **Funding**: deposits debit the main Paymax wallet (`ledger.Service`) and credit the
  invest wallet — double-entry on both sides.

### Wiring
- Feature flag `FEATURE_INVEST_ENABLED` added to `config.go` and `.env.example`.
- `invest.Register(...)` mounted in `internal/app/finance_routes.go` (passing the main
  wallet `ledgerSvc`). Routes live under `/api/v1/invest/*` and `/api/v1/stocks/*`,
  reusing `middleware.RequireAuthContext` for auth.

### Contract
- `contracts/invest.openapi.yaml` documents every endpoint (merge into the master
  `contracts/openapi.yaml` `paths:` block during integration — spec-first rule).

## Verify locally
The build could not be compiled in the authoring sandbox (no Go toolchain; Go's download
hosts were network-blocked). Run in your environment:

```bash
cd backend
go build ./...                 # compile everything
go vet ./...                   # static analysis
go test ./internal/invest/...  # unit tests (state machine, fees, scoring, mocks)
```

Then, with a database:

```bash
supabase db push
FEATURE_INVEST_ENABLED=true DATABASE_URL=... go run ./cmd/server
```

Smoke test (Bearer token from Supabase auth):

```bash
curl -H "Authorization: Bearer $JWT" localhost:8080/api/v1/stocks
curl -H "Authorization: Bearer $JWT" -X POST localhost:8080/api/v1/invest/start
# fund, then buy:
curl -H "Authorization: Bearer $JWT" -H "Idempotency-Key: dep-1" -X POST \
  localhost:8080/api/v1/invest/wallet/deposit -d '{"amount_kobo":50000000}'
curl -H "Authorization: Bearer $JWT" -H "Idempotency-Key: buy-1" -X POST \
  localhost:8080/api/v1/stocks/orders/buy -d '{"symbol":"DANGCEM","amount_kobo":2000000,"pin":"1234"}'
```

## Iron-rule compliance map
1. No trade without KYC + suitability + terms → `preTradeChecks`.
2. No asset trades unless admin-enabled → `buy_enabled`/`sell_enabled` + `status`.
3. Server-side pre-check mandatory → `preTradeChecks` (client calc never trusted).
4. Idempotency key per order → unique index + `FindOrderByIdem`.
5. Double-entry for every wallet change → `InvestLedger` + main `ledger.Service`.
6. Failed order never traps funds → unlock cash / unlock shares on failure.
7. No direct balance edits → balances are SUM projections; admin audit table present.
8. Audit + maker-checker friendly → `invest_admin_audit_log`.
9. Provider reference + reconcilable → `provider_reference` on orders + ledger entries.
10. Fees visible before confirmation → receipt returns fees/total/settlement note.
11. Market-data status labelled → `Quote.data_status` ("delayed").
12. Feature-flagged → `FEATURE_INVEST_ENABLED`.
13. Nothing hard-coded client-side → assets/fees/limits/market hours come from backend.
14. No provider secrets to frontend; verify webhooks → adapters server-side only.

## Mobile (React Native / Expo Router) — implemented
`mobile-app/reactnative/src/features/invest/` (types, mock-flagged API client hitting
`/api/v1/invest` + `/api/v1/stocks`, React Query hooks) and `app/invest/` screens:
home, discover, stock detail (with SVG sparkline), buy, sell, portfolio, wallet, orders,
onboarding (agreements + suitability gate). Entry point added to the super-app grid
(`src/constants/modules.ts`). Flip live with `EXPO_PUBLIC_INVEST_USE_MOCK=false`.
Verified: `tsc --noEmit` passes clean.

## Admin (Next.js `frontend-admin`) — implemented
Backend control plane (`internal/invest/admin.go`) under `/api/v1/admin/invest/*`,
RBAC-gated on the **`invest.manage`** permission (grant it to Product / Trading-Ops /
Super-Admin roles via the RBAC UI). Endpoints: `overview`, `assets` (list/create/PATCH
toggle), `orders` (+ `orders/failed`), `settlement/pending`, `settlement/run`, `fees`
(GET/PUT), `audit`. Every mutation writes to `invest_admin_audit_log`. Fees are now read
from `invest_fee_config` (migration `20260621020000_invest_admin.sql`) with a code default
fallback. Admin UI: `app/admin/invest/{,assets,orders,settlement,fees,audit}` + sidebar
nav. Mock-flagged (`NEXT_PUBLIC_INVEST_ADMIN_USE_MOCK=false` for live). Verified:
admin `tsc --noEmit` passes clean.

## Background settlement worker — implemented
`internal/invest/worker.go` — `StartSettlementWorker(ctx, svc, interval)` runs a ticker
that calls `ProcessDueSettlements` every minute (buy → shares credited, sell → cash
released) once T+N elapses. Wired in `finance_routes.go` behind the feature flag. Safe to
double-run: settlement-release ledger entries carry unique idempotency keys. The admin
"Run due settlements" button still triggers it manually on demand.

## Reconciliation — implemented
`internal/invest/reconciliation.go` + admin page `app/admin/invest/reconciliation`.
Surfaces: global **double-entry integrity** check (signed sum of all entries must be 0),
broker-clearing net, fee income, aggregate user cash / locked cash / settlement suspense /
external-funding net, and two exception lists — **stuck settlements** (PendingSettlement
past due) and **trapped funds** (terminal orders still holding a lock, an invariant
violation). Endpoint: `GET /api/v1/admin/invest/reconciliation`. Verified: admin
`tsc --noEmit` passes clean.

## Price-alert worker — implemented
`internal/invest/alerts.go` — `StartAlertWorker(ctx, svc, interval)` evaluates active
alerts every 2 minutes against current quotes (one quote fetch per distinct symbol),
marks any that fire (idempotent: only `active` rows transition), and delivers via a
pluggable `Notifier`. Conditions: `above`/`below` (price in kobo) and `pct_gain`/`pct_loss`
(threshold in hundredths-of-a-percent vs the day's change). Default `LogNotifier` logs;
inject push/in-app delivery via `Deps.Notifier`. Unit-tested (`alertHit`).

## Production hardening — implemented
- **Real transaction PIN** (`internal/invest/security.go`, migration
  `20260621030000_invest_pins.sql`): salted SHA-256 hash, failed-attempt **lockout**
  (5 tries → 15 min), `GET/POST /api/v1/invest/security/pin`, DB-backed verifier wired
  by default (`FEATURE_INVEST_PIN_DEV_BYPASS=true` keeps the format-only verifier for
  local/mock dev). Mobile set-PIN screen (`app/invest/security/pin.tsx`) + buy/sell
  redirect on the `pin_not_set` error code.
- **Real provider adapters** (`internal/invest/provider_http.go`): `HTTPMarketData` +
  `HTTPBroker` implement the same interfaces as the mocks against a documented JSON
  contract (prices in naira → converted to kobo at the boundary). Selected automatically
  when `INVEST_MARKETDATA_BASE_URL` / `INVEST_BROKER_BASE_URL` are set, else mock. Both
  expose a `Healthy()` check.
- **Broker webhook** (`internal/invest/webhook.go`): HMAC-SHA256-verified
  `POST /api/v1/invest/webhooks/broker` handling `order.filled` / `order.settled` /
  `order.rejected` — drives the state machine + ledger, idempotently (mounted only when
  the broker exposes a webhook secret).
- **Redlock-guarded workers**: settlement + alert workers acquire a single-node Redis
  lock per tick (`internal/invest/worker.go`), safe to run on every instance.
- **Real alert delivery**: `finance_routes.go` builds a `notifications.Service`-backed
  `Notifier` (asynq) and injects it; falls back to `LogNotifier` without Redis.
- **Corporate-action / dividend ingestion + provider health**
  (`internal/invest/admin_content.go`): admin endpoints to upsert dividends and corporate
  actions (audited, source-traceable) and a provider-health view, with admin pages
  (`app/admin/invest/corporate-actions`, `app/admin/invest/providers`).
- **RBAC**: migration `20260621040000_invest_rbac.sql` seeds the `invest.manage`
  permission and grants it to `super-admin`.

## Migrations (apply in order with `supabase db push`)
`20260621010000_invest_module.sql`, `20260621020000_invest_admin.sql`,
`20260621030000_invest_pins.sql`, `20260621040000_invest_rbac.sql`.

## Genuinely external / future work
- Real biometric confirmation on device (PIN is enforced server-side today).
- Map a specific NGX broker/market-data API onto the `provider_http.go` JSON contract
  (or run a thin shim) and validate in the partner sandbox.
- True multi-node Redlock across multiple Redis nodes (current helper is single-node).
- Corporate-action *automated* provider sync jobs (manual/admin ingestion exists).
- Assign `invest.manage` to Trading-Ops / Finance / Product roles beyond super-admin.
