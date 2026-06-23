# Runbook — Production go-live (HUMAN-executed, gated)

> Audience: release manager + DBA + finance-ops approver. This is the exact,
> ordered, human checklist for taking a money-path change to production. **Every
> step here is performed by a human with explicit approval.** No agent and no CI
> job executes `supabase db push` to cloud, flips a `FEATURE_*` flag to `true`,
> or installs live secrets. This document is the procedure, not the trigger.

## Hard preconditions (do not start until ALL are true)

- [ ] `ci.yml` is green on the exact commit being released (regression, money,
      contract, tsc, lint, go build+vet, OpenAPI, migration-guard).
- [ ] For money-path changes: `ledger-auditor` review recorded; for auth/PII:
      `security-reviewer` review recorded (CLAUDE.md workflow rule).
- [ ] The three Decision Gates in `docs/audit/08-risk-register.md` (DG-1
      regulatory licensing, DG-2 user identity, DG-3 dual vote storage) are
      RESOLVED. **These are blockers; money modules do not go live until closed.**
- [ ] Reconciliation + ledger-invariant jobs exist and pass in staging
      (jobs audit, `docs/audit/04-background-jobs.md`). Reconciliation is a PRD
      launch blocker.
- [ ] Rollback owner identified; `incident-rollback.md` reviewed by on-call.
- [ ] Staging ran the same artifact with the flag ON and passed smoke + a money
      e2e (deposit → ledger entry → balance projection → withdraw).

## Step 1 — Freeze & announce
1. Announce the maintenance window. cPanel restart causes a brief blip (INF-1).
2. Confirm no other deploy is in flight (`concurrency` in deploy-cpanel.yml).

## Step 2 — Secrets matrix (verify present & scoped, do NOT print values)
Confirm each required secret exists in the target environment and is scoped to
least privilege. See `docs/ops/ENV_MATRIX.md` and
`docs/ops/SECRETS_MANAGEMENT.md` for the authoritative list and scoping notes.
Minimum money-path set that MUST be present and correct:

- [ ] `SUPABASE_SERVICE_ROLE_KEY` (CRITICAL — full DB bypass; least-privilege review)
- [ ] `PAYSTACK_SECRET_KEY` (CRITICAL — webhook HMAC + provider calls; LIVE key)
- [ ] `DATABASE_URL` (pgx pool, session-pooler URL)
- [ ] `REDIS_URL` (idempotency cache / Redlock / asynq)
- [ ] `SPOTLIGHT_ADMIN_API_KEY` (HIGH) / backend `ADMIN_API_KEY` set to a strong value
- [ ] R2: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (CRITICAL), `R2_ACCOUNT_ID`
- [ ] Provider keys only for modules being enabled (Maplerad/Eversend/Anthropic/etc.)
- [ ] Confirm `.env.local` / `.env` are NOT committed (INF-3) and CI logs never
      printed a secret.

## Step 3 — Database migrations (DBA, manual)
> `supabase db push` to cloud is performed HERE, by a human DBA, never by CI.

1. [ ] `supabase link --project-ref <PROD_REF>` (one-time per machine; verify you
       are linked to **prod**, not staging — confirm the project ref out loud).
2. [ ] `supabase migration list` — confirm pending set matches the release and is
       additive-only (the CI guard already enforced this at PR time).
3. [ ] Take/confirm a fresh DB backup / restore point exists BEFORE applying.
       An untested backup is not a backup — confirm restore was tested in staging.
4. [ ] `supabase db push` — apply pending migrations to prod.
5. [ ] Spot-check the new tables/columns exist and old reads still work (additive
       means the current live build keeps working against the new schema).

> There is no migration rollback. A mistake is fixed forward with a new additive
> migration (see `incident-rollback.md` §5).

## Step 4 — Deploy the code artifact
1. [ ] Merge/confirm the release commit on `main`. Push to `main` triggers
       `deploy-cpanel.yml` (build frontend-web → SCP → write Passenger
       `.htaccess` → `touch tmp/restart.txt`).
2. [ ] Backend (Go): deploy the new image/binary on the backend host (manual —
       no backend CD yet, INF-5). Use the image built from the released commit.
3. [ ] Confirm both processes restarted and are serving the new build.

## Step 5 — Smoke (read-only first, flags still OFF)
- [ ] Public health route responds (`/api/v1/public/health`).
- [ ] Login + an authenticated read works.
- [ ] Existing voting golden path works (regression behavior unchanged).
- [ ] Admin dashboard loads and RBAC sidebar reflects permissions.

## Step 6 — Enable the flag (gated, one module at a time)
> This is the only point a `FEATURE_*` flag goes to `true`, and only with the
> finance-ops/approver sign-off recorded.

1. [ ] Approver signs off in the release channel for the specific flag.
2. [ ] Set the single flag (e.g. `FEATURE_WALLET_ENABLED=true`) in the prod
       environment for the surface that needs it (backend env and/or frontend-web
       env). Do NOT bulk-enable.
3. [ ] Restart the affected process (Go restart / `touch tmp/restart.txt`).
4. [ ] Run the money e2e smoke against prod with a **small real value**:
       deposit → assert balanced ledger entries posted → assert wallet balance =
       ledger projection → withdraw → assert reversing/again-balanced.
5. [ ] Confirm idempotency: replay the same `Idempotency-Key`, assert no double
       post.
6. [ ] Watch the Grafana money-path dashboard + alerts for one baseline window.

## Step 7 — Hold & confirm
- [ ] Alerts quiet for 30 min. Ledger invariant job reports balanced.
- [ ] Reconciliation job scheduled and its first run matches provider.
- [ ] If anything is off: `feature-flag-disable.md` → investigate. Do not "push
      through".

## Step 8 — Close out
- [ ] Announce go-live complete; record the commit, migrations applied, flags
      enabled, and who approved each.
- [ ] File any follow-ups (e.g. backend CD, staging env, secrets-manager
      migration — see risk register INF-2/INF-5/VA-3).

## Rollback from any step
Go straight to `incident-rollback.md`. The fastest, safest mitigation is almost
always to disable the flag you just enabled (`feature-flag-disable.md`), then
redeploy the last green commit if the change was not flag-gated.
