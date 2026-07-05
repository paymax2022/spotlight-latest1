# Environment & Go-Live (implemented, repo-reconciled)

This is the working version of the uploaded spec, reconciled to the **actual repo
tooling** and wired to the files that now exist. It makes the end-to-end build +
deploy loop runnable from Claude Code (Claude Desktop), not the web sandbox.

## Reconciliation with the real repo (what differs from the generic spec)

| Spec assumed | This repo actually uses | Where |
|---|---|---|
| Go 1.22 | **Go 1.25**, module `spotlight/backend` at `backend/` | `backend/go.mod`, `backend/Dockerfile` (golang:1.25-alpine, builds `./cmd/server`) |
| pnpm + `tsc` | **npm** workspaces (`package-lock.json`), `npm run type-check` | `frontend-web/`, `frontend-admin/` |
| `db/migrations` + golang-migrate up/down | **`supabase/migrations/*.sql`** (additive-only, forward-only) applied via psql | `Makefile migrate-up`, iron rule "additive-only" |
| single `ci.yml` | existing **reusable workflows** + repo-wide `ci.yml` gate | `.github/workflows/_reusable-*.yml`, `ci.yml` |

Because migrations are **additive-only** (no DROP/rename/narrowing — enforced by
`_reusable-migration-guard.yml`), the spec's "down 1 then up" reversibility check is
replaced by a **clean-apply + idempotent re-apply** check (`make migrate-reset`):
drop schema → apply all → apply all again (every migration is `IF NOT EXISTS` /
`ON CONFLICT DO NOTHING`). Rollback at runtime is image-level (redeploy prior SHA),
never a destructive down-migration.

## What now exists

- **Dev container** (`.devcontainer/`): `devcontainer.json` (claude-code + Go 1.25 +
  Node 20 + gh + docker-in-docker), `docker-compose.yml` (app + Postgres 16 + Redis 7
  + `fakes` on :9100), `Dockerfile` (psql + supabase CLI + make).
- **Makefile** (root): `bootstrap, build, test, tsc, migrate-up, migrate-reset,
  fakes, security-scan, docker-build, ci` — the local mirror of CI.
- **FAKE rails** (`tools/fakes/`): deterministic FakeBNPL/Payout/Disburse/Billing on
  :9100, HMAC-signed idempotent async webhooks (same shapes as the provider
  sandboxes). `RAILS_MODE` (fake|sandbox|live) selects the adapter; only base URL +
  creds + webhook secret change between envs.
- **Backend rail seam**: `internal/config` `RailsMode` + per-rail `*_BASE_URL/_API_KEY/
  _WEBHOOK_SECRET`; HTTP adapters (`app/academy_rails_external.go`) implement
  `commerce.BNPLRail`, `edupay.DisburseRail`, `schools.BillingRail`, `tutor.PayoutRail`;
  signature-verified, idempotent inbound webhooks (`app/academy_webhooks.go`,
  `/internal/webhooks/academy/*`). Wallet collect/charge + live RTC already run on the
  real ledger/RTC rails (`app/academy_rails.go`).
- **CI**: `ci.yml` (CLAUDE.md gates via reusable workflows) + new
  `integration-verify.yml` (Postgres service → migrate → `go build` → `go test -race`
  with `RAILS_MODE=fake` → full `tsc` → idempotent re-apply → scan → build-once image).
- **Deploy**: `deploy.yml` — build-once image (SHA) → staging (rails=sandbox) → smoke
  → **human-gated** prod (rails=live, blue/green) → rollback = redeploy prior SHA.
- **Config**: `.env.dev.example` (fakes only), `.mcp.json` (GitHub + Postgres MCP).

## How Claude Code drives it (the loop the web sandbox couldn't do)

1. One-time: install Claude Code, "Reopen in Container", `cp .env.dev.example .env.dev`.
2. Inner loop (in-container): edit → `make build` / `make test` / `make tsc` /
   `make migrate-up` against local Postgres + fakes → iterate to green.
3. PR + CI via GitHub MCP: open PR; `ci.yml` + `integration-verify.yml` run; fix to green.
4. Staging (gated): `deploy.yml` ships the SHA image with `RAILS_MODE=sandbox`; smoke
   against provider sandboxes.
5. Prod (human-gated): approve → blue/green → health checks → rollback ready.

## Guardrails

Secrets via env/secret-manager + GitHub Environments (OIDC), never chat/repo/image/
logs; prod always human-gated; every money op idempotent + ledger-backed (NL-8/9);
webhooks signature-verified in every mode; every state change audited.

See `GO-LIVE-CHECKLIST.md` for the item-by-item status + secrets matrix.
