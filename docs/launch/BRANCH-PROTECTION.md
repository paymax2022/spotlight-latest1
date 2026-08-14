# Branch protection & repo hardening for `main`

Apply this once per repo. Requires repo admin. Branch protection cannot be set from
a normal Actions run — an admin runs the `gh` script below (or configures it in
**Settings → Branches / Rules**).

## Required settings for `main`

- Require a pull request before merging; **≥ 1 approval**.
- **Require review from Code Owners** (activates `.github/CODEOWNERS`).
- Dismiss stale approvals on new commits.
- **Require status checks to pass** (and be up to date) before merging:
  - `frontend-web (regression + money + contract + tsc + lint)`
  - `frontend-admin (type-check)`
  - `backend (go build + vet)`
  - `openapi (validate all contracts)`
  - `migrations (additive-only guard)`
  - `secrets (no client-exposed secrets)`
  - `CodeQL (go)`, `CodeQL (javascript-typescript)`
  - `govulncheck (Go)`, `gitleaks (secret scan)`, `trivy (filesystem — deps + IaC misconfig)`
- Require **linear history**; require **conversation resolution**.
- Block **force pushes** and **deletions**.
- Include administrators (no bypass).
- Recommended: require **signed commits**.

Also enable, at the repo/org level (Settings → Code security):
- **Secret scanning** + **push protection**.
- **Dependabot alerts** + security updates (config in `.github/dependabot.yml`).
- **CodeQL default/advanced** (this repo uses advanced via `security.yml`).

## Apply via `gh` (admin)

```bash
# Requires: gh auth login (as an admin of the repo)
OWNER=paymax2022          # TODO(you): confirm canonical org
REPO=spotlight-latest     # TODO(you): confirm canonical repo

gh api -X PUT "repos/$OWNER/$REPO/branches/main/protection" \
  -H "Accept: application/vnd.github+json" \
  -f "required_pull_request_reviews[required_approving_review_count]=1" \
  -F "required_pull_request_reviews[require_code_owner_reviews]=true" \
  -F "required_pull_request_reviews[dismiss_stale_reviews]=true" \
  -F "required_status_checks[strict]=true" \
  -f "required_status_checks[contexts][]=frontend-web (regression + money + contract + tsc + lint)" \
  -f "required_status_checks[contexts][]=frontend-admin (type-check)" \
  -f "required_status_checks[contexts][]=backend (go build + vet)" \
  -f "required_status_checks[contexts][]=openapi (validate all contracts)" \
  -f "required_status_checks[contexts][]=migrations (additive-only guard)" \
  -f "required_status_checks[contexts][]=secrets (no client-exposed secrets)" \
  -F "enforce_admins=true" \
  -F "required_linear_history=true" \
  -F "allow_force_pushes=false" \
  -F "allow_deletions=false" \
  -F "required_conversation_resolution=true" \
  -F "restrictions=null"
```

> The exact check names must match the job `name:` values GitHub reports. After the
> first `security.yml` run, add the CodeQL/govulncheck/gitleaks/trivy contexts too
> (their names appear in the PR checks list once they've run at least once).

## GitHub Environments (for deploy)

Create two environments used by `deploy.yml` and the Railway deploy jobs in `ci.yml`:

- **staging** — no gate; holds staging secrets (`RAILS_MODE=sandbox`, sandbox provider keys, staging DB URL, GCP WIF vars).
- **production** — **required reviewers** (human gate); holds live secrets. Restrict to the `main` branch.

Store per-env values as Environment secrets/variables — never in the repo, image, or logs.

## Activation variables (deploys are OFF until set)

Deploy workflows **skip** (grey, not red) until you opt in with a repository/Environment
**variable**. This keeps checks green before the cloud accounts are wired:

| Workflow | Activate with variable | Plus secrets |
|---|---|---|
| `deploy.yml` (Cloud Run) | `GCP_PROJECT_ID` (+ `GCP_REGION`, `GCP_ARTIFACT_REGISTRY`) | `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT` |
| `ci.yml` (Railway, per environment) | `RAILWAY_DEPLOY_ENABLED=true` — plus a manual `workflow_dispatch` naming the environment and typing `DEPLOY` to confirm, from the matching promotion branch | `RAILWAY_TOKEN_DEVELOPMENT`, `RAILWAY_TOKEN_STAGING`, `RAILWAY_TOKEN_PRODUCTION` |
| `deploy-cpanel.yml` (Namecheap cPanel) | `CPANEL_DEPLOY_ENABLED=true` | see the workflow header |
| `mobile-eas.yml` (EAS) | `EAS_ENABLED=true` | `EXPO_TOKEN` |

> **Retired 2026-08-13:** `deploy-web.yml` (Vercel) was deleted — see
> [ADR-027](../adr/ADR-027-deploy-target-cloud-run.md). It had never produced a successful run:
> a `matrix` expression in its workflow-level `concurrency.group` is not a valid context there,
> so every push created a jobless startup-failure run (198 of them) regardless of its
> `workflow_dispatch`-only trigger. The `VERCEL_*` secrets and `VERCEL_DEPLOY_ENABLED` are no
> longer read by any workflow. Recoverable from git history if Vercel is ever revived.

`security.yml` scans run **advisory** (report, don't block) during launch — flip the
`continue-on-error` flags to blocking once the dependency/secret backlog is clean.

## One pipeline per push

`ci.yml` is the only workflow a push or PR starts. The 14 per-module lanes
(`doctor-ci.yml`, `top5-ci.yml`, …) have no `push:`/`pull_request:` trigger of their
own — they are `workflow_call` reusables, invoked by `ci.yml` only when the change
touches them, so their jobs report inside that single run.

Routing lives in **one** place: `.github/module-filters.json`, read by
`scripts/ci/changed-modules.py`. Previously each lane repeated its path list under
both triggers — two hand-synced copies per lane, with nothing detecting drift.

Two properties worth keeping when editing this:

- **Fail-open.** If the changed-file set cannot be established (shallow clone,
  force-push, new branch, `workflow_dispatch`), *every* lane is selected. A gate
  that silently skips itself is worse than one that runs too much.
- **Fail-closed on bad config.** A malformed filter file aborts the run rather than
  routing to nothing. Brace patterns are rejected outright — GitHub does not expand
  them, so `{a,b}/**` silently matches nothing (see PR #115).

`scripts/ci/test-changed-modules.py` runs in the hygiene job and pins the glob
semantics, the fail-open path, that every filter set has a caller job, and that
`ci.yml` stays within GitHub's limit of **20 unique reusable workflows per caller**
(it currently uses 19 — one slot left, so a 15th lane needs a rethink, not a
one-line addition).

> Adding a module lane means: add its paths to `module-filters.json`, add a
> `changes` output, and add a gated `uses:` job in `ci.yml`. The test fails if you
> do only some of those.

## Keeping workflows startup-clean

`ci.yml` runs an **actionlint** job (`workflows (actionlint)`) over `.github/workflows/**`.
It exists because a workflow-level validation error — an invalid context in `concurrency`,
`permissions`, or `on` — produces a run with **zero jobs**, **no check-run and no annotation**.
Nothing in the PR UI explains the red X, so the failure can persist unnoticed. Statically
linting the files is the only pre-merge signal for that class.
