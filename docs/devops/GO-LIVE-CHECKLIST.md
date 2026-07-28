# GO-LIVE Checklist (tracker)

Status legend: ✅ done in repo · 🟡 scaffolded, needs in-container build/test · ⬜ ops/infra (env-dependent).

## Rails with no backing service (now scaffolded behind RAILS_MODE)

- 🟡 **BNPL** — `commerce.BNPLRail` HTTP adapter + FakeBNPL + signed webhook + idempotent
  dedupe. Acceptance: checkout creates a BNPL plan, webhook marks approved, one ledger
  entry; replay = no double-apply. *Remaining:* BNPL principal ledger leg + sandbox creds.
- 🟡 **Payout** — `tutor.PayoutRail` + FakePayout + async settle webhook → state PAID +
  ledger reconcile. *Remaining:* payout-row state flip by ref + sandbox creds.
- 🟡 **Disburse** — `edupay.DisburseRail` + FakeDisburse; escrow→target via `ledger.PostJournal`,
  idempotent on retry. *Remaining:* sandbox creds.
- 🟡 **Billing/recurring** — `schools.BillingRail` + FakeBilling; charge → `paid` (guarded),
  idempotent. *Remaining:* scheduler-driven recurring run + sandbox creds.

All four: signature-verified webhooks in every mode; `Idempotency-Key` on every op;
ledger is source of truth. Adapters selected by `RAILS_MODE`; FAKEs in `tools/fakes`.

## CI verification (run in-container / CI — needs the toolchain)

- 🟡 `go build ./...` — `make build` / `integration-verify.yml`.
- 🟡 `go test ./... -race` (Postgres + fakes) — `make test`.
- 🟡 Full `tsc --noEmit` (both frontends) — `make tsc`.
- 🟡 Migrations clean-apply + idempotent re-apply on real Postgres — `make migrate-reset`.

(🟡 because they were authored under structural review in the sandbox where no Go/Node/
psql toolchain exists; they are designed to pass and run green in the dev container/CI.)

## Production readiness

- ⬜ Secrets in vault; CI uses OIDC; none in repo/image/logs. (`.mcp.json`/`.env.dev` are fakes-only.)
- ⬜ Staging deploy of the SHA image runs migrations + smoke green (`deploy.yml` staging job — fill TODOs with your cloud).
- ⬜ Prod deploy gated (GitHub Environment `production` approval) + rollback rehearsed (redeploy prior SHA).
- ⬜ Observability: structured logs + metrics (latency/error/saturation) + one symptom alert/service + deploy dashboard.
- ⬜ Backups configured + restore tested.
- ⬜ Deploys + infra changes audited.

## Secrets matrix (where each lives)

| Variable | Dev | CI | Staging | Prod | Stored in |
|---|---|---|---|---|---|
| DATABASE_URL | compose pg | service pg | managed pg | managed pg | env / secret mgr |
| RAILS_MODE | fake | fake | sandbox | live | config |
| BNPL_* / PAYOUT_* / DISBURSE_* / BILLING_* | fake | fake | provider sandbox | live | secret mgr |
| *_WEBHOOK_SECRET | dev-fake-secret | dev-fake-secret | sandbox | live | secret mgr |
| AGORA_* (RTC) | blank (stub) | blank | sandbox | live | secret mgr |
| registry / deploy creds | — | OIDC | OIDC | OIDC | cloud IAM |

Never place sandbox/live secrets in the web sandbox or chat. `.env.dev` (fakes only)
is local; everything else is injected from the secret manager at deploy time.

## First Claude Code tasks (in-container)

1. Reopen in container; `cp .env.dev.example .env.dev`; `make ci` → green.
2. Finish the 🟡 ledger legs for BNPL/payout against the fakes; `make test` green.
3. Land `integration-verify.yml` green; gate merges.
4. Fill `deploy.yml` TODOs for your cloud + add sandbox creds to the `staging` env; walk this list to ✅/⬜ closure.
