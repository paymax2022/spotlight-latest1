# Claude Code: Development and Railway Handoff

This guide is for application-code work in this repository. Follow it before
changing code or releasing a build.

## Branch ownership

As of 2026-11-15 there is one release branch: `main`. A push to `main` runs CI
and, once that commit's checks are provably green, `release.yml` deploys it to
development, staging and production in that order.

- Do not force-push or reset `main`. Every accepted push there is a production
  release, so a rewritten history re-releases a tree someone else chose.
- Do not push to `main` a commit whose change you have not had reviewed through a
  PR, unless the work was explicitly asked to go in unreviewed.
- `develop`, `staging` and `prod` are no longer part of the release path. The
  `staging` and `prod` tips are preserved as tags `archive/staging-2026-11-15`
  and `archive/prod-2026-11-15`; see `docs/devops/deployment-matrix.md` for why
  they must not be merged.

Do not deploy from feature branches. Feature work goes to `main` through a PR.

## Current Development deployment

The Development Railway environment has these deployed services:

| Service | Repository directory | Runtime port | Public endpoint |
| --- | --- | ---: | --- |
| Go backend | `backend` | `8080` | `https://backend-development-502c.up.railway.app` |
| Frontend web | `frontend-web` | `8080` | `https://frontend-web-development.up.railway.app` |
| Frontend admin | `frontend-admin` | `8080` | `https://frontend-admin-development-5a67.up.railway.app` |
| Redis | Railway service | private only | No public domain |

The frontend web and admin containers must listen on Railway's injected
`PORT`. In Development this is `8080`. Their Public Networking target port is
also `8080`. Do not change it back to `3000` or `3001`.

The frontend-web Docker build intentionally uses a 3 GB Node heap for the Next
build. Its runtime heap is capped at 768 MB and the Railway service allocation
is 1 GB. Do not lower these settings without testing a production build and
runtime health check.

## Required environment-variable discipline

- Never commit `.env` files, tokens, API keys, database URLs containing
  passwords, or Supabase service-role keys.
- Use Railway service variables and GitHub repository/environment secrets for
  secret values.
- `NEXT_PUBLIC_*` variables are browser-visible and must never contain secrets.
- The frontend web service requires the Supabase public URL and anon key at
  build time as well as runtime. The service-role key is server-only.
- Do not use localhost URLs in deployed Railway variables.

## Development workflow

1. Start from an up-to-date `develop` branch.
2. Make focused application-code changes. Do not modify Railway configuration,
   GitHub deployment secrets, deployment tokens, or CI workflow files unless
   that work is explicitly requested.
3. Run the smallest relevant local checks before pushing. Typical commands:

   ```bash
   cd frontend-web && npm run type-check
   cd frontend-web && npm run lint
   cd frontend-web && npm run test:money
   cd backend && go build ./... && go vet ./...
   ```

   Do not run live-database tests against `DATABASE_URL`. Such tests must use
   an explicitly safe `TEST_DATABASE_URL` only.
4. Commit only the intended files and push to `develop`.
5. Review the single GitHub Actions run created by the push. A push runs CI
   checks only; it does not deploy.

## Hard release gates

The workflow is **CI — CLAUDE.md gates** in GitHub Actions.

A release is blocked unless these checks pass:

- frontend-web regression, money invariants, contract check, TypeScript, and
  lint;
- frontend-admin TypeScript check;
- Go backend build and `go vet`;
- OpenAPI YAML validation;
- additive-only migration guard;
- secret-hygiene and live-database-test safety guard;
- GitHub Actions workflow validation.

Module-specific CI lanes run only when their matching paths change. This is
intentional cost control; do not create duplicate CI workflows for the same
checks.

## Railway release procedure

There is nothing to run. Push the commit to `main` and `release.yml` does the
rest: it waits for that commit's CI, deploys development, migrates and deploys
staging, probes staging, then migrates and deploys production.

Two controls exist, and they are the only ones:

- **Brake.** Set the repository variable `RAILWAY_DEPLOY_ENABLED` to anything
  other than `true` and the chain stops at its first job. Use it before you
  revert a bad commit, not after.
- **Rollback.** Run `release.yml` by hand with `ref=<prior main SHA>`. A rollback
  deliberately does **not** apply migrations — an older `supabase/migrations/`
  tree makes `supabase db push` abort. Add `skip_gates=true` only if that SHA is
  old enough that its check-runs are past retention.

`RAILWAY_DEPLOY_ENABLED` and the per-environment Railway token secrets are read
from repository-level secrets and variables; a missing token makes the deploy job
fail closed rather than deploy nothing quietly.

Do not run `railway up` manually from a local machine for a normal release. The
one exception is a service this repo's chain does not cover, and that has to be
decided deliberately — see `docs/devops/deployment-matrix.md`.

Verify a release by reading what each environment is actually serving, not by
looking at a green tick:

```bash
curl -s https://backend-production-1b33d.up.railway.app/api/v1/public/build
```

`.commit` must equal the SHA you released. A green run with an old commit means
the deploy did not replace the process.

## Current frontend-web compatibility note

The homepage must not use `react-scroll-trigger`. It calls the removed
`ReactDOM.findDOMNode` API and causes a fatal browser hydration error in the
deployed runtime. `components/elements/CounterUp.js` uses native
`IntersectionObserver` instead; preserve that approach.

If a browser reports `Application error: a client-side exception has occurred`,
capture the first red Console error and stack trace. Railway container logs
cannot show browser-only JavaScript exceptions.

## After a release

- Confirm the frontend web homepage loads without a browser console exception.
- Confirm the admin login page opens.
- Confirm backend health returns HTTP 200.
- Check Railway deployment logs only for the affected service.
- Report any application-code exception to the client with the exact stack
  trace; do not alter deployment infrastructure to mask an application bug.
