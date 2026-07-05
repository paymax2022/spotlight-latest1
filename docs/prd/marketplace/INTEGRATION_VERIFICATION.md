# Marketplace Swarm — Integration Verification (Agent G)

Final integration pass across the 7-agent build on `feat/marketplace-swarm`. This
records each defect fixed (file:line), the exact build/vet evidence, the infra
added, and a prioritized punch-list for humans before production.

Verified with Go 1.25.0 (portable install at `/tmp/go125`), `GOFLAGS="-mod=mod
-buildvcs=false"` (the `-buildvcs=false` is only to skip VCS stamping in the
sandbox — not a code concern).

---

## Part 1 — Integration defects fixed

### D1. Permission-slug mismatch (broke ALL admin auth) — FIXED
`backend/internal/app/marketplace_routes.go:130-146`. The admin routes guarded on
non-existent slugs (`marketplace.admin.moderate`, `.disputes`, `.disputes.approve`,
`.audit`). None of these are seeded, so `RequirePermission` fails closed on every
admin route. Rewired every `guard(...)` to the **authoritative slugs seeded by
`supabase/migrations/20260905000001_marketplace_rbac_perms.sql`** — which also
match the admin console and `openapi.yaml` verbatim:

| Route | Now guards on |
|---|---|
| `GET /admin/moderation/queue` | `marketplace.admin.moderation` |
| `POST /admin/listings/:id/approve` | `marketplace.admin.approve` |
| `POST /admin/listings/:id/reject` | `marketplace.admin.reject` |
| `GET /admin/disputes/queue`, `GET /admin/disputes/:id` | `marketplace.admin.dispute.review` |
| `POST /admin/disputes/:id/decide` | `marketplace.admin.dispute.decide` |
| `POST /admin/disputes/:id/approve` | `marketplace.admin.dispute.approve` |
| `GET /admin/flags`, `POST /admin/flags/:id/action` | `marketplace.admin.flags.action` |
| `GET /admin/audit-log` | `marketplace.admin.audit.read` |
| `GET /admin/orders/aging` | `marketplace.admin.orders.aging` |
| `POST /admin/boosts/:id/reject` | `marketplace.admin.reject` |

Confirmed no stale slug remains: `grep -rn 'marketplace.admin.(moderate|disputes|audit)\b' backend`
returns only the *correct* `.audit.read` line (regex boundary match), no `.moderate`/`.disputes`.

### D2. Search wiring (GET /search was 501 forever) — FIXED
Agent A exposed a type-erased seam `Searcher.Search(ctx any) (any, error)` +
`svc.SetSearcher(...)`; Agent B provides `search.NewClient(esURL)` with the concrete
`Search(ctx, search.SearchRequest) (search.SearchResults, error)`. Wired them:

- `backend/internal/config/config.go` — added `ElasticsearchURL` field (reads
  `ELASTICSEARCH_URL`, default empty).
- `backend/internal/app/marketplace_routes.go` — added a `searchAdapter` (the one
  place that imports both `marketplace` and `search`, so no import cycle) that
  decodes the handler's `map[string]any` query into a typed `search.SearchRequest`
  and returns results back through the `any` seam. In `RegisterMarketplace`, when
  `cfg.ElasticsearchURL != ""` we `svc.SetSearcher(searchAdapter{search.NewClient(...)})`;
  when empty we log and leave it nil so `GET /search` returns `501 SEARCH_NOT_WIRED`
  gracefully (no panic).

### D3. Boost cascade on listing rejection (§8) — FIXED (was missing)
`RejectListing` (`backend/internal/marketplace/service_listing.go`) transitioned
the listing to `removed_policy` but did **not** touch its boosts. Added the cascade
right after the status flip (`service_listing.go:257-273`): it looks up every
`purchased|active` boost on the listing via the new repo method
`Repository.ActiveBoostsForListing` (`repository.go`, added after `InsertBoost`) and
calls the existing `RejectBoost` path for each — which already does
`rejected_with_reason → auto_refunded` with the seller wallet refund + its own audit
entry. Best-effort per boost with loud logging so one refund hiccup can't strand the
listing un-rejected. (`RejectBoost`/`service_boost.go` already correctly implemented
the reject→auto-refund money legs; only the *trigger from listing rejection* was
absent.)

### D4. CreateOrder race (§8 TOCTOU) — FIXED (was a read-then-write)
`CreateOrder` did `GetListing` → check `status==active` → `InsertOrder`: two buyers
racing a single-quantity listing could both pass the check. Added
`Repository.InsertOrderAtomic` (`backend/internal/marketplace/repository.go`, before
`GetOrder`) which runs in a transaction:
`SELECT status FROM mkt_listings WHERE id=$1 FOR UPDATE` (serializes concurrent
creates on the same listing) → re-verify `status='active'` **under the lock** →
reject if any non-terminal order already references the listing (single-quantity) →
insert the order → commit. The race-loser gets `ErrListingNotActiveRace` →
`422 LISTING_NOT_ACTIVE`. `CreateOrder` now calls `InsertOrderAtomic`
(`service_order.go`) and maps the new error; the idempotency-replay path
(`ErrConflict` on the `idempotency_key` UNIQUE) is preserved. New sentinel
`ErrListingNotActiveRace` in `errors.go`.

**No other code changes** were needed to compile; all fixes are surgical.

---

## Part 2 — Infra added

- **`docker-compose.yml`** — appended, without disturbing `api`/`redis`:
  - `elasticsearch` (single-node `docker.elastic.co/.../elasticsearch:8.13.4`,
    security off for dev, health-checked on cluster status). ES 8.x matches the
    search client's composable `_index_template` + `function_score` usage.
  - `marketplace-indexer` and `marketplace-cron`, both built from the same
    `./backend` image and gated behind the compose `profiles: ["marketplace"]`
    (a compose mirror of `FEATURE_MARKETPLACE_ENABLED`). Added `es_data` volume.
- **`backend/Dockerfile`** — extended (additively) to also build
  `marketplace-indexer` and `marketplace-cron` binaries alongside `server`
  ("build once, deploy many"; compose selects which to run via `command`). Added
  `curl` to the runtime image for healthchecks.
- **`backend/.env.example`** — appended a marketplace block:
  `FEATURE_MARKETPLACE_ENABLED`, `ELASTICSEARCH_URL`, `ES_URL` (documented as the
  two different var names pointing at the same cluster), `PAYMAX_WEBHOOK_SECRET`,
  `MARKETPLACE_INDEXER_INTERVAL_MS`.
- **`Makefile`** — added targets `marketplace-build`, `marketplace-indexer-run`,
  `marketplace-cron-run`, `marketplace-test`, `marketplace-loadtest`,
  `marketplace-up`/`-down`, in the existing house style; updated `.PHONY`.
- **`docs/prd/marketplace/RUNBOOK.md`** — new: required env, migration apply order,
  ES template bootstrap, running the workers, the hourly reconciliation invariant +
  what drift means, feature-flag rollout, and rollback (flag off; migrations are
  additive so no down-migration).

---

## Part 3 — Verification evidence (real command output status)

All commands: `cd backend`, Go 1.25.0, `GOFLAGS="-mod=mod -buildvcs=false"`.

| Check | Command | Result |
|---|---|---|
| **Marketplace core builds** | `go build ./internal/marketplace/` | **exit 0** |
| **Search builds** | `go build ./internal/marketplace/search/` | **exit 0** |
| **App (routes+adapter) builds** | `go build ./internal/app/` | **exit 0** |
| **Worker binaries build** | `go build ./cmd/...` | **exit 0** |
| **Combined target build** | `go build ./internal/marketplace/... ./internal/marketplace/search/... ./internal/app/... ./cmd/...` | **exit 0** |
| **Vet (marketplace + tests)** | `go vet ./internal/marketplace/... ./tests/marketplace/...` | **exit 0, no findings** |
| **Vet (app)** | `go vet ./internal/app/...` | **exit 0, no findings** |
| **QA tests compile** | `go build ./tests/marketplace/...` | **exit 0** |
| **QA tests run (no-infra subset)** | `go test ./tests/marketplace/... -run 'HMAC\|FSM\|Taxonomy\|Contract'` | **ok — PASS (0.014s)** |
| **Migrations SQL sanity** | balanced `BEGIN;`/`COMMIT;` (1/1 each); zero real `DROP`/`RENAME` (the one grep hit is the "NO DROP" header comment); 15 `CREATE TABLE IF NOT EXISTS`; enums guarded via `DO $$ … duplicate_object`; RBAC via `ON CONFLICT DO NOTHING` | **additive + idempotent** |
| **docker-compose validity** | parsed — services `[api, redis, elasticsearch, marketplace-indexer, marketplace-cron]`, volumes `[redis_data, es_data]` | **OK** |
| **frontend-admin tsc** | `npx tsc --noEmit \| grep -i marketplace` | **no marketplace TS errors** (best-effort; node_modules present) |

**Bottom line: the marketplace Go packages compile — YES.** Core, search, app
(with the new search adapter + corrected slugs), both worker binaries, and the QA
test package all build clean; vet is clean; the no-infra QA tests pass.

---

## Punch-list before production (prioritized)

1. **[P1] Apply the two migrations to a live Postgres with `postgis` + `pgcrypto`.**
   `20260905000000_marketplace_v1.sql` needs both extensions (it `CREATE EXTENSION
   IF NOT EXISTS`es them, but the role must be allowed to). Not applied here — no
   live DB in the sandbox. Run `make migrate-reset` against a prod-like DB to
   confirm clean-apply + idempotency, then `supabase db push`.
2. **[P1] Wire the actual auto-release ledger posting in `cmd/marketplace-cron`.**
   The `order-auto-release` job currently **detects and logs** due orders but does
   not call `marketplace.Service.AutoReleaseDue` (Agent B left it intentionally
   unwired to avoid a build-order dependency). Escrow funds past the inspection
   deadline will NOT auto-release until this is connected. The service method
   exists and is guarded/idempotent; wiring is a few lines (documented in the file
   and RUNBOOK §4). **This is a money-path gap — do before enabling the flag in prod.**
3. **[P1] Integration tests need live ES + Redis + Postgres.** Only the no-infra
   QA subset (HMAC/FSM/taxonomy/contract) was executed. The DB-backed and
   search-backed cases were **compiled but not run** here. Run
   `make marketplace-test` against a stack with Postgres+ES+Redis.
4. **[P2] Provision Elasticsearch with the index template + NG synonyms file.**
   `es-mapping.json` references `analysis/ng_synonyms.txt` (synonyms_path). Ensure
   that file is deployed into the ES config dir, or template PUT will fail on that
   analyzer. Warm the index (start the indexer) before flipping the flag so search
   isn't empty on launch.
5. **[P2] Set the two ES URL vars consistently.** `ELASTICSEARCH_URL` (API) and
   `ES_URL` (indexer) are separate names for the same cluster — a mismatch means
   the API searches one cluster while the indexer writes another. Called out in the
   RUNBOOK; verify in each environment's secrets.
6. **[P2] Set `PAYMAX_WEBHOOK_SECRET`** to match the logistics + payments providers
   before enabling webhooks; rotate via the secrets manager (dev default is a fake).
7. **[P3] Editor backup artifacts present** in
   `backend/internal/marketplace/*.go.<digits>` (e.g. `errors.go.1690748106293426705`).
   These have a `.go.` infix (not a `.go` suffix) so the Go toolchain ignores them
   and they do **not** affect the build — but they're clutter and should be removed
   from the branch before merge.
8. **[P3] ES memory/limits for prod.** The compose ES is a 512m single node with
   security disabled — dev only. Production needs a managed/HA cluster with TLS +
   auth and the disk-watermark defaults restored.
