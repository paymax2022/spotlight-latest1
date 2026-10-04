# Infrastructure inventory (machine-built, 2026-02 scan)

Sources: `scripts/e2e/scan-gin-routes.mjs` output (`inventory-backend-routes.csv`),
`backend/cmd/*`, `backend/internal/platform/queue`, `docker-compose.yml`,
`backend/internal/config/config.go` env vars, `.github/workflows/deploy.yml`,
`render.yaml`, `infra/terraform/`.

## (a) Workers, queue consumers, schedulers

### Binaries under `backend/cmd/`

| Binary | Type | Wired? | Notes |
|---|---|---|---|
| `cmd/server` | Main Gin API | ✅ | `app.NewRouter(cfg)` (`cmd/server/main.go:41`). Optionally launches in-process workers when `RUN_WORKERS_INPROCESS` is set — currently only the **marketplace ES indexer**, skipped entirely if `ELASTICSEARCH_URL` is empty (`internal/app/router.go:676-695`). |
| `cmd/notification-worker` | asynq consumer | ✅ (but only 3 task types) | `queue.NewServer(cfg.RedisURL, 10)` + `asynq.NewServeMux()` + `notifications.Workers(mux, …)` (`cmd/notification-worker/main.go:19-45`). Handlers registered for **notification:push / notification:email / notification:sms** only (`internal/notifications/service.go:158-160`). |
| `cmd/marketplace-cron` | ticker-loop jobs | ✅ standalone process | listing auto-expire + boost completion every 5m; needs `DATABASE_URL` (`cmd/marketplace-cron/main.go`). Nothing else in the repo runs these jobs. |
| `cmd/marketplace-indexer` | outbox drain → Elasticsearch | ⚠️ dual-path | `search.RunIndexerLoop` on `mkt_listings_outbox` (`cmd/marketplace-indexer/main.go`). Same loop can run **inside the API** via `RUN_WORKERS_INPROCESS` (router.go:695) — so it works either as a dedicated process or embedded; if neither is deployed/enabled, the outbox accumulates. |
| `cmd/transport-scheduler` | ticker-loop jobs | ✅ standalone, flag-gated | dispatch-due / reminders / expire-stale every 60s; exits immediately unless `FEATURE_TRANSPORT_SCHEDULING_ENABLED` (`cmd/transport-scheduler/main.go`). |
| `cmd/fxsmoke` | one-shot CLI | n/a | FX provider connectivity check (`make fxsmoke`), not a server. |
| `cmd/voting-test-server` | standalone Gin | dev-only | mounts only `/api/v1/connect/*` voting routes + health (`cmd/voting-test-server/main.go`). Not part of production serving path. |

### Orphaned / dead queue wiring

- **9 of 12 asynq task-type constants are dead code.** Declared in
  `internal/platform/queue/queue.go:12-23`, never referenced anywhere else
  (no `Enqueue`, no `HandleFunc`) outside that file:
  `wallet:credit:notify`, `wallet:debit:notify`, `referral:outbox:process`,
  `bank:transfer:initiate`, `bank:transfer:webhook`, `kyc:provisioned`,
  `va:provision`, `reconciliation:run`, `outbox:es:sync`.
  Only the three `notification:*` types are produced
  (`internal/notifications/service.go:74-83`) and consumed (`:158-160`).
- **`internal/scheduler` durable job poller is orphaned.** `scheduler.NewService(pool)`
  is constructed and jobs are registered (`vaultSvc.RegisterAutoSave()`,
  `ajoSvc.RegisterCycleRunner()` in `internal/app/top5_routes.go:55,297`;
  `internal/app/health_vet_routes.go:67`, `internal/app/health_routes.go:54,304,392`;
  `internal/maps/routes.go:313` → `RegisterContributionJob`), but
  `Service.RunDue` (`internal/scheduler/service.go:152`) has **zero callers**
  in non-test code — no binary and no goroutine polls it, so registered
  durable jobs never execute.

### In-process background tickers started by the API (inside `registerFinanceRoutes` / friends)

| Ticker | Call site | Interval |
|---|---|---|
| `orchestration.StartReconScheduler` | `internal/app/finance_routes.go:839` | 24h |
| `maplerad.StartReconcile` | `internal/app/finance_routes.go:989` | 24h |
| `restaurant.StartStuckSettlementReconciler` | `internal/app/finance_routes.go:1898` | ticker |
| `restaurant.StartScheduledOrderSweeper` | `internal/app/finance_routes.go:1911` | ~1m |
| `restaurantRT.Start` (WS tracker) | `internal/app/finance_routes.go:1624` | — |
| `tripTracker.Start` (transport WS) | `internal/app/finance_routes.go:2129` | — |
| `transport.StartStuckSettlementReconciler` | `internal/app/finance_routes.go:2443` | ~5m |
| `top5events.StartPendingOrderReconciler` | `internal/app/top5_routes.go:214` | ~5m |
| `invest.StartSettlementWorker` | `internal/app/finance_routes.go:3182` | 1m, Redlock-guarded |
| `fractionalre.StartAutoInvestRunner` | `internal/app/finance_routes.go:3274` | 1h |
| misc tickers | `internal/app/referral_routes.go:245`, `internal/utilitybills/service.go:1978`, `internal/connect/voting/service.go:666`, `internal/health/symptomsearch/service.go:761`, `internal/orchestration/quotes.go:183`, `internal/invest/reconciliation.go:195` + `:1214` | various |

## (b) Webhook endpoints (inbound)

Go backend (from `inventory-backend-routes.csv`):

| Method | Path | File |
|---|---|---|
| POST | `/api/webhooks/paystack/go` | `internal/app/finance_routes.go:933` |
| POST | `/api/webhooks/monnify/go` | `internal/app/finance_routes.go:940` |
| POST | `/api/webhooks/maplerad/go` | `internal/app/finance_routes.go:986` |
| POST | `/api/kyc/webhooks/:provider` | `internal/app/finance_routes.go:1066` |
| POST | `/api/v1/fx/webhooks/:provider` | `internal/app/finance_routes.go:928` |
| POST | `/api/v1/invest/webhooks/broker` | `internal/invest/handler.go` |
| POST | `/internal/webhooks/academy/{bnpl,payout,disburse,billing}` | `internal/app/academy_webhooks.go:364-367` |
| POST | `/internal/webhooks/{mycover,octamile}` | `internal/insurance/webhooks/service.go` |
| POST | `/internal/webhooks/stays-supplier` | `internal/stays/supplierwebhooks/service.go` |
| POST | `/internal/webhooks/triage/whatsapp` | `internal/health/triage/governance/handler.go` |

Outbound-webhook management surface: `GET/POST/PATCH/DELETE /api/v1/fx/webhooks`
(`internal/app/finance_routes.go:903-928`, `og := r.Group("/api/v1/fx")`).

BFF webhook handlers: `POST /api/webhooks/paystack`
(`frontend-web/app/api/webhooks/paystack/route.ts` — HMAC-SHA512 verified, the
documented live handler), `POST /api/kyc/webhooks/[provider]`
(`frontend-web/app/api/kyc/webhooks/[provider]/route.ts`).

## (c) External integrations (env vars in `backend/internal/config/config.go` + docker-compose)

- **Payments / banking rails:** Paystack (`PAYSTACK_*`), Monnify (`MONNIFY_*`),
  Maplerad (`MAPLERAD_*`, VA + FX + custody), Eversend (`EVERSEND_*`, FX),
  academy rails (`BNPL_*`, `DISBURSE_*`, `BILLING_*`, `PAYOUT_*`),
  Quidax (`QUIDAX_*`, crypto), invest broker + market data (`INVEST_*`).
- **KYC / identity:** Dojah, SmileID, YouVerify (`*_API_KEY/SECRET/WEBHOOK_SECRET`),
  `KYC_PII_ENC_KEY`, `KYC_ROUTE_*` routing envs.
- **Comms:** Resend (`RESEND_*`), Brevo (`BREVO_*`, email OTP), Termii (SMS),
  Expo push (`EXPO_PUSH_TOKEN`), WhatsApp triage (`TRIAGE_WHATSAPP_SECRET`).
- **Insurance providers:** MyCover, Octamile (under `internal/provider/` and
  `internal/insurance/webhooks`).
- **Other providers:** VTPass (utility bills), Infermedica (symptom search),
  `CAC_VAS_*` (business registry), VideoSDK (telemedicine), Anthropic (AI care),
  RAILS_MODE-gated fake rails for tests.
- **Infra deps:** Postgres via `DATABASE_URL` (pgx pool, fail-closed in
  staging/prod — `router.go:450-461`), Supabase REST/Auth
  (`SUPABASE_URL`, service key, JWT), Redis (`REDIS_URL` — asynq, idempotency,
  realtime fanout, Redlock), Elasticsearch (`ELASTICSEARCH_URL`/`ES_URL` —
  marketplace search read model; docker-compose `elasticsearch` service),
  Cloudflare R2 (`R2_*`, bucket `R2_BUCKET`), Sentry + OTel/Cloud Trace
  (`observability.Init` in `cmd/server/main.go:39`).

## (d) WebSocket / SSE endpoints

**SSE:** `GET /api/v1/realtime/stream` — shared per-user SSE hub
(`internal/app/marketplace_routes.go:264`, hub in
`internal/platform/realtime/realtime.go`, Redis-or-in-process fanout).
BFF vote streams: `GET /api/votes/stream`, `GET /api/v2/votes/stream`,
`GET /api/open-mic/votes/stream` (frontend-web).

**WebSocket (Gin upgrades, shared `internal/platform/ws` hub):**
`GET /api/finance/associations/ws` (group chat, `internal/association/routes.go`),
`GET /api/finance/mobility/ws` (transport trip tracking,
`internal/app/finance_routes.go` + `internal/transport/handler.go:39`),
`GET /api/finance/restaurant/ws` and `GET /api/finance/restaurant/orders/:orderId/ws`
(live order tracking; the order WS is mounted on a separate public group —
`finance_routes.go:1738` comment — with an HMAC ticket, `internal/restaurant/ws_tracking.go`),
`GET /api/v1/doctor/ws` (telemedicine). BFF proxy: `GET /api/v1/restaurant/ws`.

## (e) Health / probe endpoints — VERDICT

**`/healthz` and `/readyz` DO exist and ARE registered** — the prior audit claim
was wrong/outdated:

```go
// internal/app/router.go:467-469 (inside NewRouter, after shared pool setup)
health.WithPool(sharedPool)
r.GET("/healthz", health.PublicHealth)   // liveness — static 200
r.GET("/readyz", health.Ready)           // readiness — pings shared pgx pool
```

`NewRouter` is what `cmd/server` serves (`cmd/server/main.go:41`), so
`deploy.yml`'s `curl /healthz && curl /readyz` smoke step and the Cloud Run /
Render probes (`render.yaml:15 healthCheckPath: /readyz`,
`infra/terraform/cloud-run.tf:36-37`) all hit real routes.

Other health endpoints actually registered:
`GET /api/v1/public/health` + `GET /api/v1/public/build` (router.go:126-129,
used by `docker-compose.yml` healthcheck), `GET /api/v1/auth/health` (133),
`GET /api/v1/users/health` (166), `GET /api/v1/mobile/health` (419),
`GET /api/v1/webhooks/health` (422), `GET /api/v1/connect/health`
(`internal/app/connect_routes.go:96`).
