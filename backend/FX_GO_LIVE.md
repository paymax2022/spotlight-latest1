# FX Orchestration — Go-Live Runbook

End-to-end steps to verify, deploy, and switch the FX orchestration layer from
mock to live. The two steps that could not run in the authoring sandbox (no Go
toolchain, no network) are automated here.

## 1. Compile & test (was environment-blocked → now CI)
CI runs this automatically (`.github/workflows/fx-ci.yml`). Locally, with Go 1.25+:
```bash
cd backend
make build      # go build ./...
make vet        # go vet ./...
make test-fx    # go test ./internal/orchestration/... -v   (no DB/network needed)
make test       # full module test suite
```
The FX suite covers: minor-unit math, spread guards, router selection/failover,
quote consume/expiry, idempotent replay, insufficient balance, rate-expired,
**reconciliation breaks**, and **webhook status mapping**.

## 2. Live provider validation (was environment-blocked → now a command)
With network access and the sandbox credentials in `backend/.env`:
```bash
cd backend
make fxsmoke    # calls Maplerad + Eversend live; exits non-zero on failure
```
This bypasses the deterministic fallback and hits the real provider APIs, so it
fails loudly on auth/shape/network problems. Fix any shape mismatches in
`internal/provider/{maplerad,eversend}` before enabling live traffic.

## 3. Database
```bash
supabase db push   # applies 20260621000000_fx_orchestration.sql (additive-only)
```

## 4. Configure env (secrets are gitignored in backend/.env)
```
FEATURE_FX_ORCHESTRATION_ENABLED=true
DATABASE_URL=postgres://…
REDIS_URL=redis://…                      # enables the Redis-backed quote book
MAPLERAD_SECRET_KEY=…  MAPLERAD_PUBLIC_KEY=…  MAPLERAD_WEBHOOK_SECRET=…
EVERSEND_CLIENT_ID=…  EVERSEND_CLIENT_SECRET=…  EVERSEND_WEBHOOK_SECRET=…
PAYMAX_WEBHOOK_OUT_URL=…  PAYMAX_WEBHOOK_SECRET=…   # outbound signed events
```
Run: `make run` (sources `.env`).

## 5. Wire provider webhooks
In each provider dashboard set the callback to:
```
POST https://<host>/api/v1/fx/webhooks/maplerad
POST https://<host>/api/v1/fx/webhooks/eversend
```
Inbound events are signature-verified then normalized into the unified ledger
(`HandleProviderEvent`), and a normalized Paymax event is re-emitted to
`PAYMAX_WEBHOOK_OUT_URL`.

## 6. Flip the clients off mock
- Mobile: `EXPO_PUBLIC_FX_USE_MOCK=false` and point `EXPO_PUBLIC_API_BASE_URL` at the gateway fronting the Go service (paths are namespaced `/api/v1/fx`).
- Admin: `NEXT_PUBLIC_FX_ADMIN_USE_MOCK=false` once the admin control-plane endpoints are exposed.

## 7. Operations
- **Treasury:** `StartTreasuryMonitor` auto-rebalances buckets at/below low-water and emits `balance.low`. Tune the interval in `finance_routes.go`.
- **Reconciliation:** call `Service.RunDailyReconciliation(ctx, settlementSource, day)` from a scheduled job (cron/asynq) once a per-provider `SettlementSource` is implemented; breaks surface via the `recon.completed` event and the admin Reconciliation page.

## Rollback
Set `FEATURE_FX_ORCHESTRATION_ENABLED=false` (routes unregister; legacy
`/api/finance/fx` is unaffected). Migration is additive — no down-migration needed.
