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

Create two environments used by `deploy.yml` / `deploy-web.yml`:

- **staging** — no gate; holds staging secrets (`RAILS_MODE=sandbox`, sandbox provider keys, staging DB URL, GCP WIF vars).
- **production** — **required reviewers** (human gate); holds live secrets. Restrict to the `main` branch.

Store per-env values as Environment secrets/variables — never in the repo, image, or logs.

## Activation variables (deploys are OFF until set)

Deploy workflows **skip** (grey, not red) until you opt in with a repository/Environment
**variable**. This keeps checks green before the cloud accounts are wired:

| Workflow | Activate with variable | Plus secrets |
|---|---|---|
| `deploy.yml` (Cloud Run) | `GCP_PROJECT_ID` (+ `GCP_REGION`, `GCP_ARTIFACT_REGISTRY`) | `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT` |
| `deploy-web.yml` (Vercel) | `VERCEL_DEPLOY_ENABLED=true` | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_WEB`, `VERCEL_PROJECT_ID_ADMIN` |
| `mobile-eas.yml` (EAS) | `EAS_ENABLED=true` | `EXPO_TOKEN` |

`security.yml` scans run **advisory** (report, don't block) during launch — flip the
`continue-on-error` flags to blocking once the dependency/secret backlog is clean.
