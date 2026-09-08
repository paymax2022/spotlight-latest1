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

## Resolved: `test:regression` now exists

`frontend-web/package.json` defines:

```json
"test:regression": "vitest run tests/unit/golden-path"
```

so CLAUDE.md's `npm run test:regression` is a real command (run it from
`frontend-web` — there is no root `package.json`). The reusable workflow's
fallback to invoking `tests/unit/golden-path` directly is retained on purpose, so
the gate still holds on branches predating the script.

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
