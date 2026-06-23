# CI gates — what runs on every PR

> Source of truth: `.github/workflows/`. This doc maps CLAUDE.md's required
> commands to the workflow jobs that enforce them. `ci.yml` is the repo-wide
> always-on gate; the per-module `*-ci.yml` files are scoped fast lanes that
> stay as-is.

## The always-on gate: `ci.yml`

`ci.yml` runs on every push and PR and calls five reusable workflows so jobs are
DRY and individually re-runnable:

| Job | Reusable workflow | Enforces (CLAUDE.md command) |
|---|---|---|
| frontend-web | `_reusable-frontend-web.yml` | `test:regression` (golden-path), `test:money`, `contract:check`, `tsc --noEmit`, `npm run lint` |
| frontend-admin | `_reusable-node-typecheck.yml` | `cd frontend-admin && npm run type-check` |
| backend | `_reusable-go-verify.yml` | `go build ./...` + `go vet ./...` (Go 1.25) |
| openapi | `_reusable-openapi-validate.yml` | YAML validity + Redocly structural lint of every `contracts/*.yaml` |
| migration-guard | `_reusable-migration-guard.yml` | additive-only: rejects DROP / RENAME / type-narrowing in changed `supabase/migrations/*.sql` |

A merge to `main` should be blocked unless all five jobs are green. Configure
these as **required status checks** on the protected branch (branch-protection is
a GitHub setting, not committed config — set it in repo settings).

## Known mismatch to fix (one-line)

CLAUDE.md says `npm run test:regression`, but `frontend-web/package.json` has no
`test:regression` script. The golden-path specs live in
`frontend-web/tests/unit/golden-path/`. The reusable workflow runs that folder
directly when the script is absent, so the gate is real today. To make it a
one-word command, add to `frontend-web/package.json` scripts:

```json
"test:regression": "vitest run tests/unit/golden-path"
```

(Application-package change — owned by the frontend team, left to them so DevOps
stays in CI/infra/docs only.)

## Build-once / promote (DevOps skill)

Current deploy (`deploy-cpanel.yml`) rebuilds frontend-web on push to `main`.
For true "build once, promote many", a future change should build a single
artifact in `ci.yml`, publish it, and have deploy consume that exact artifact
across staging→prod. Tracked as a follow-up (no staging env exists yet — risk
INF-2). Not done here to avoid changing the live deploy path without a staging
target.

## What CI deliberately does NOT do

- No `supabase db push` to cloud (migrations are applied by a human DBA — see
  `docs/runbooks/go-live.md`).
- No flipping `FEATURE_*` to `true`.
- No production deploy from `ci.yml` (deploy is a separate, `main`-only workflow).
- No secrets consumed by the verification jobs.
