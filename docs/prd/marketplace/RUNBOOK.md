# Paymax Marketplace — Operations Runbook

Owner: DevOps (Agent G). Scope: deploy, operate, and roll back the Paymax
Marketplace (Jiji-style classifieds + escrow checkout over the finance ledger).

The marketplace is **feature-flagged OFF by default**. No flag → the routes, the
public webhooks, and the escrow/dispute/boost state machines never register. Money
moves exclusively through the existing double-entry finance ledger
(`backend/internal/finance/ledger`); the marketplace never stores a balance.

---

## 1. Required environment

| Variable | Consumed by | Purpose | Default |
|---|---|---|---|
| `FEATURE_MARKETPLACE_ENABLED` | API server (`internal/config`), indexer, cron | Master gate. `true` registers `/v1/marketplace` routes + webhooks + FSMs. | `false` |
| `ELASTICSEARCH_URL` | API server (`internal/config` → `search.NewClient`) | Search read-model cluster for `GET /v1/marketplace/search`. **Empty → search returns `501 SEARCH_NOT_WIRED` (graceful); the rest of the marketplace still works.** | `""` |
| `ES_URL` | `cmd/marketplace-indexer` | **Same cluster**, different var name (the indexer binary reads `ES_URL`, the API reads `ELASTICSEARCH_URL`). Set both to the same value. | `http://localhost:9200` |
| `PAYMAX_WEBHOOK_SECRET` | API server (`h.WithWebhookSecret`) | HMAC secret verifying the two public webhooks: `POST /v1/marketplace/webhooks/logistics/delivery-confirmed` and `.../payments/funding-confirmed`. Must match the secret configured at the logistics + payments providers. | `""` |
| `DATABASE_URL` | API, indexer, cron | Postgres (Supabase) with **pgcrypto + postgis** extensions. | — |
| `REDIS_URL` | API | Idempotency cache + Redlock (money paths degrade to the DB-side `UNIQUE` backstop when unset — never double-charges). | — |
| `MARKETPLACE_INDEXER_INTERVAL_MS` | indexer | Outbox poll interval (ms). | `2000` |

`.env.example` (`backend/.env.example`) carries dev placeholders for all of the
above. In staging/prod inject these from the secrets manager — never commit real
secrets. Rotate `PAYMAX_WEBHOOK_SECRET` on the standard cadence.

---

## 2. Migration apply order (additive-only)

Two marketplace migrations, applied in filename order (they are already correctly
prefixed so `supabase db push` / `make migrate-up` orders them):

1. `supabase/migrations/20260905000000_marketplace_v1.sql` — schema: enums, tables
   (`mkt_listings`, `mkt_orders`, `mkt_disputes`, `mkt_boosts`, `mkt_offers`,
   `mkt_reviews`, `mkt_flags`, `mkt_listings_outbox`, `mkt_admin_audit_log`, …),
   indexes. Requires the `pgcrypto` and `postgis` extensions (the migration
   `CREATE EXTENSION IF NOT EXISTS` guards both).
2. `supabase/migrations/20260905000001_marketplace_rbac_perms.sql` — seeds the
   authoritative `marketplace.admin.*` RBAC permissions + the
   `marketplace-fraud-ops` role, and grants to super-admin / system-admin.

Apply:

```bash
supabase db push            # linked remote project (prod promotion)
# or, locally:
make migrate-up             # psql-applies every supabase/migrations/*.sql in order
```

Both migrations are **idempotent and additive** (`CREATE … IF NOT EXISTS`,
`DO $$ … EXCEPTION WHEN duplicate_object`, `INSERT … ON CONFLICT DO NOTHING`) —
safe to re-run. `make migrate-reset` verifies clean-apply + idempotency.

> **RBAC slug authority:** the seeded slugs — `marketplace.admin.moderation`,
> `.approve`, `.reject`, `.dispute.review`, `.dispute.decide`, `.dispute.approve`,
> `.flags.action`, `.audit.read`, `.orders.aging` — are the single source of truth.
> The Gin admin routes (`internal/app/marketplace_routes.go`), the admin console,
> and `openapi.yaml` all use them verbatim. A mismatch fails admin auth closed.

---

## 3. Elasticsearch template bootstrap

The composable index template lives in
`backend/internal/marketplace/search/es-mapping.json` (index pattern
`mkt_listings_ng_v*`, function_score ranking, edge-ngram + NG synonym analyzers).

The indexer **bootstraps the template on startup** (best-effort
`client.EnsureTemplate`): a fresh/empty ES cluster without the template still
accepts default-dynamic-mapped docs, and an unreachable ES is logged and retried,
never fatal. To bootstrap explicitly, start the indexer once against the target
cluster; it PUTs `_index_template/mkt_listings_template` before draining the outbox.

ES version: **8.x** (compose pins `docker.elastic.co/.../elasticsearch:8.13.4`).
The search client is dependency-free `net/http` and targets composable templates
(`_index_template`, ES ≥ 7.8) + `function_score` — both native to 8.x.

---

## 4. Running the workers

Two long-running processes deployed independently of the API (own scale/restart):

**Indexer** — drains `mkt_listings_outbox` → Elasticsearch (upsert/delete):

```bash
make marketplace-indexer-run
# or docker: docker compose --profile marketplace up -d marketplace-indexer
```

**Cron** — three ticker jobs:
- `listing-auto-expire` (every 5m): `active → expired` when `expires_at < now()`,
  emits an outbox `delete`.
- `order-auto-release` (every 1m): detects `inspection_window` orders past their
  `inspection_deadline` with no open dispute. **The ledger-posting release itself
  runs via `marketplace.Service.AutoReleaseDue` (single guarded, idempotent money
  path)** — the cron binary currently *detects and logs* due orders; wire the
  service call for full auto-release (see the note in `cmd/marketplace-cron/main.go`).
- `escrow-reconciliation` (every 1h): the invariant check below.

```bash
make marketplace-cron-run
# or docker: docker compose --profile marketplace up -d marketplace-cron
```

Bring up ES + both workers together (compose `marketplace` profile):

```bash
make marketplace-up      # docker compose --profile marketplace up -d elasticsearch marketplace-indexer marketplace-cron
make marketplace-down    # stop them
```

The `marketplace-indexer` / `marketplace-cron` compose services are gated behind
the `marketplace` profile so they never start unless explicitly requested — a
compose-level mirror of `FEATURE_MARKETPLACE_ENABLED`.

---

## 5. Hourly reconciliation invariant + drift

Every hour the cron asserts the §2.2 escrow invariant:

```
SUM(escrow ledger balance)  ==  SUM(amount_kobo of orders in an open-escrow status)
```

where open-escrow statuses are
`funded, seller_accepted, in_delivery, delivered, inspection_window, disputed`.
Escrow balance is **derived from the ledger** (`ledger_accounts.type='escrow'`),
never a stored column (house doctrine: balances are projections of the ledger).

**Drift = the two sums differ.** It means money is either stranded in escrow with
no matching open order, or an open order has no matching escrow hold — i.e. a
terminal state that failed to post its balanced ledger entry, a double-post, or a
manual DB edit. The job **logs drift loudly (`ESCROW RECONCILIATION DRIFT`) and
never self-heals** — a mismatch is a page-a-human signal, not a bug to auto-fix.

**On drift:** alert on the `ESCROW RECONCILIATION DRIFT` log line. Investigate by
reconciling the offending order(s) against `ledger_entries` for
`mkt:order:<id>:fund|release|refund` references. Do not mutate balances; corrections
are reversing ledger entries only.

---

## 6. Feature-flag rollout

Additive and reversible — the flag is the whole lever:

1. **Migrations first** (both are additive/idempotent; applying them with the flag
   OFF changes no live behavior — the tables simply exist unused).
2. **Seed ES + start the indexer/cron** (`marketplace` compose profile) so the
   search index is warm before traffic.
3. **Set `ELASTICSEARCH_URL`** (and `ES_URL` for the indexer). With it empty,
   search degrades to `501` gracefully; set it once ES is healthy.
4. **Flip `FEATURE_MARKETPLACE_ENABLED=true`** and redeploy the API. The single
   flag-gated call in `internal/app/router.go` registers the routes/webhooks/FSMs.
5. Roll out progressively (staging → prod; canary a subset of instances). Watch:
   error rate on `/v1/marketplace/*`, escrow-reconciliation drift, indexer lag
   (unprocessed `mkt_listings_outbox` rows), webhook HMAC-rejection rate.

---

## 7. Rollback

**Fast path — flag off.** Set `FEATURE_MARKETPLACE_ENABLED=false` and redeploy.
The routes, webhooks, and state machines stop registering immediately; no data is
touched. Stop the workers: `make marketplace-down`.

**Migrations are additive-only — do NOT down-migrate.** There is no down migration
and none should be written (house rule: no DROP / rename / type-narrowing). Rolling
the flag off fully disables the feature; the unused `mkt_*` tables sit dormant with
zero effect on other modules and can stay in place across the rollback. Any escrow
funds already in flight remain correctly held in the ledger and are resolved by the
normal FSM once the flag is re-enabled.

---

## 8. Quick reference — Makefile targets

| Target | Does |
|---|---|
| `make marketplace-build` | Build the marketplace API/search packages + indexer + cron binaries. |
| `make marketplace-indexer-run` | Run the ES indexer against `DATABASE_URL` + `ES_URL`. |
| `make marketplace-cron-run` | Run the cron (auto-expire / auto-release detect / reconciliation). |
| `make marketplace-test` | Focused marketplace Go tests (`internal/marketplace/...` + `tests/marketplace/...`). |
| `make marketplace-loadtest` | Run the k6 scripts in `tools/loadtest/marketplace/`. |
| `make marketplace-up` / `-down` | Start/stop ES + workers via the `marketplace` compose profile. |
