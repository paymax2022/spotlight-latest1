# Auto-deploy release pipeline — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every push to GitHub `main` release itself to development, staging and production — migrating each environment's database before the code that needs it — with no dispatch, no typed `DEPLOY`, no promotion branch and no human approval anywhere in the path.

**Architecture:** One new workflow, `.github/workflows/release.yml`, owns the whole chain. Its first job (`gates`) refuses to deploy anything until the commit's CI is provably green, then two sibling legs leave it: a development leg that reports but never blocks, and a staging → production leg where nothing reaches production until staging has been probed and is serving the new commit. `ci.yml` loses its three deploy jobs and goes back to being CI-only. Database applies move into `_reusable-db-apply.yml`, called by both `release.yml` and a now dispatch-only `db-migrate.yml`, so there is exactly one apply path per database. All deploy and probe logic lives in `scripts/ci/` as plain scripts rather than bash-in-YAML, so the verdict logic is unit-testable and the hard-won Railway behaviours exist once instead of six times.

**Tech Stack:** GitHub Actions (reusable workflows, matrices, `workflow_call`), Python 3 stdlib (no new dependencies), Bash, `gh` CLI, Railway CLI, Supabase CLI.

**Spec:** `docs/superpowers/specs/2026-11-15-auto-deploy-release-pipeline-design.md` — every decision below cites it. Read the spec before starting; the plan argues from it and does not restate its evidence.

## Global Constraints

Every task's requirements implicitly include this section. These values are all **measured or pinned in the repo today** — do not modernise any of them.

- **Railway CLI pin:** `npm install --global @railway/cli@5.40.1` (matches `ci.yml:548`). Do not bump it as part of this work.
- **Supabase CLI pin:** `supabase/setup-cli@v3` with `version: 2.114.0`. This pin is shared by `db-migrate.yml` (`:152`, `:249`), `ops-db-push.yml` and `maps-ci.yml`. If it must move, move all four together — a chain that went green on one CLI version and applies with another proves nothing.
- **actionlint:** `v1.7.12`. The gate command is exactly `actionlint -no-color -oneline -shellcheck= -pyflakes=` (see `ci.yml:484`). A local binary is installed at `/Users/paymax/go/bin/actionlint`; `go install` does not work on this machine (no route to `proxy.golang.org`), so use the local binary for pre-push checks.
- **Railway project id:** `e7dca861-3667-4d9a-8090-6d2f4d179ec2` (project `spotlight-platform`).
- **One emergency brake, no more:** `vars.RAILWAY_DEPLOY_ENABLED == 'true'` (already `true`). Do not add a second kill switch, a typed confirmation, or a new environment reviewer — removing those is the point of this change.
- **`RAILWAY_HTTP_TIMEOUT: '600'` on every `railway up`.** The CLI's default HTTP timeout is 90s. Measured git-tracked upload payloads: `frontend-web` **110.0 MB / 2064 files**, `backend` **25.6 MB / 2594 files**, `frontend-admin` **7.7 MB / 989 files**. (`du` reports 741 MB for `frontend-web` — that includes an untracked `.next-verify2` artifact. Measure with `git ls-files`, not `du`.)
- **Action pins:** `actions/checkout@v4`, `actions/setup-node@v7` with `node-version: '20'`, `actions/setup-go@v7` with `go-version-file: 'backend/go.mod'`.
- **Hard GitHub Actions constraint (probed, not assumed):** a job that calls a reusable workflow via `uses:` may only carry `name`, `uses`, `with`, `secrets`, `needs`, `if`, `permissions`. **`environment:` is rejected** on such a job by both actionlint and GitHub. The called workflow's own job must declare `environment: ${{ inputs.target }}`.
- **`secrets: inherit` is required on every `uses:` caller.** Reusable workflows do not receive caller secrets automatically. Without it, `secrets.SUPABASE_*` evaluates to empty. The failure mode is safe — the `:?missing` guard fails before any `db push` — but it fails.
- **Skip-propagation:** a skipped `needs:` dependency makes GitHub skip every job downstream of it. So a "don't apply this time" decision must be a *step-level* decision inside a job that still runs, never a job-level `if:`. `!cancelled()` opts out of that implicit gating (ci.yml's own documented idiom at `:492-500`).
- **`notification-worker` appears in NO deploy matrix** (spec Decision H). Production's asynq consumer is Render's `spotlight-notification-worker` (`render.yaml:76-84`). A Railway production worker would put two consumers on one queue with the same `REDIS_URL` and double-deliver push/email/SMS.
- **No application code changes and no schema changes.** This plan touches `.github/`, `scripts/ci/` and `docs/` only.
- **Publish discipline:** feature branch off `origin/main` + PR. **Never push `main`.** **Never pass `--delete-branch`.** Push with `git -c credential.helper='!gh auth git-credential' push`; never run `setup-git`.
- **Worktree discipline:** `/private/tmp/spot-auto-release` holds only the spec and this plan (branch `feat/auto-release-pipeline`, PR #1034). PR A and PR B each get a fresh worktree off `origin/main`. Do not implement Tasks 1-9 in the spec worktree.
- **Line numbers cited in this plan were verified against `origin/main` = `6199a6b57c889755073c09388f4929d7a1108248` on 2026-11-15.** If a file has moved since, re-derive the span from its content — do not edit by the number alone.

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `scripts/ci/release-gates.py` | Pure verdict logic for "is this commit's CI green enough to release". No deploy knowledge. |
| Create | `scripts/ci/test-release-gates.py` | Fixture-driven pins for the verdict logic. Runs in ci.yml's `secret-hygiene` job. |
| Create | `scripts/ci/railway-urls.sh` | The ONE place a Railway service URL is written down. Sourced by the pre-deploy fingerprint step and the post-deploy smoke. |
| Create | `scripts/ci/frontend-fingerprint.sh` | Digest of the served `/_next/static/chunks/` names — the only available proof a frontend deploy replaced bytes. |
| Create | `scripts/ci/railway-deploy.sh` | Upload + poll + redacted crash log. Holds the two hardest-won Railway behaviours once instead of six times. |
| Create | `scripts/ci/railway-smoke.sh` | Read back what the environment is actually serving. |
| Create | `.github/workflows/_reusable-db-apply.yml` | One `supabase db push` path, parameterised by target environment. |
| Create | `.github/workflows/release.yml` | The whole chain: gates → development (non-blocking) and gates → staging → production. |
| Modify | `.github/workflows/ci.yml` | Delete `:486-805` (the three deploy jobs — pristine `6199a6b57` numbering; Task 7 derives the span from content anchors at run time, because Task 3 shifts it +6), strip the deploy inputs, narrow the branch triggers, fix two stale comments, add one test step. |
| Modify | `.github/workflows/db-migrate.yml` | Become dispatch-only; call the reusable apply; reverse its own stale header advice. |
| Delete | `.github/workflows/development-deploy.yml` | Superseded by `release.yml`'s development leg. |
| Modify | `docs/devops/deployment-matrix.md` | Canonical. Rows FIRST, then prose. |
| Modify | `docs/launch/BRANCH-PROTECTION.md`, `docs/devops/DEPLOY-RUNBOOK.md`, `docs/devops/production-migration-ledger.md` | Describe the new chain; remove the dispatch/typed-confirmation/promotion-branch instructions. |
| Modify | `docs/superpowers/specs/…` — no | The spec is already committed and reviewed. Do not edit it during implementation. |

**Why the scripts exist at all.** Today the deploy logic is bash-in-YAML duplicated across `ci.yml:486-805` and `development-deploy.yml`. Three of those four copies hardcode `--path-as-root` for services that must not have it (the defect the spec records at `ci.yml:563`, `ci.yml:790`, `development-deploy.yml:98`). Verdict logic inside YAML cannot be unit-tested, so a wrong gate is only discoverable by a bad release. Extracting it into `scripts/ci/` makes it testable and makes each Railway behaviour exist exactly once.

## PR Sequencing

Two PRs, in this order, both branched off `origin/main`:

- **PR A — `chore/release-phase0-archive-record`.** Tasks 1-2. Archive tags, the do-not-merge record, the Render worker version record, and the `release.yml` row declared **Pending** in the canonical matrix. Safe to merge alone: it changes no workflow behaviour. Must land **before** PR B, because until the promotion branches are tagged and recorded, a stale `origin/prod` commit is a loaded gun pointed at `main` (spec Decision A).
- **PR B — `feat/release-yml-auto-deploy`.** Tasks 3-9. The actual flip. Merging PR B is the moment a `main` push starts deploying production, so it must be merged deliberately and watched.

PR #1034 (this spec + plan) merges first; it is documentation only.

---

# PR A — Phase 0: archive and record

### Task 1: Archive the promotion branch tips

**Files:**
- No repo files. This task creates two annotated tags on `origin` and pushes them.

**Interfaces:**
- Consumes: the live tips of `origin/prod` and `origin/staging`.
- Produces: tags `archive/prod-<YYYY-MM-DD>` and `archive/staging-<YYYY-MM-DD>` on the remote, which Task 2's record names explicitly.

**Why:** spec Decision A. Screening proved nothing on `origin/prod` or `origin/staging` is missing from `main` — four candidates are already on `main` in full and five are cases where `main` has moved *ahead*. But the branches still point at commits whose file trees are older than `main`'s, so the next person who merges one "to catch up" resurrects #808's deleted KYC plane or reverts the academy tuition model. The tags preserve the exact tips so the branches can be reset later without losing anything, and they give Task 2's record a durable name to point at.

Tag pushes are **additive and non-destructive**: no ref that exists today is moved or deleted. The branches themselves are NOT reset in this plan — resetting `origin/prod` and `origin/staging` is a separate, explicitly-authorised follow-up, because it rewrites shared refs.

- [ ] **Step 1: Create a fresh worktree off `origin/main`**

```bash
cd /Users/paymax/Documents/spotlight/main
git fetch -q origin
git worktree add /private/tmp/spot-phase0 -b chore/release-phase0-archive-record origin/main
cd /private/tmp/spot-phase0 && git log --oneline -1
```

Expected: `6199a6b57 docs…` or whatever `origin/main`'s current tip is. If it is not `6199a6b57`, the plan's line numbers may have drifted — re-derive spans from content before editing (Global Constraints, last bullet).

- [ ] **Step 2: Resolve both promotion branch tips LIVE — never trust a pasted SHA**

```bash
cd /private/tmp/spot-phase0
PROD=$(git ls-remote origin refs/heads/prod | cut -f1)
STAGING=$(git ls-remote origin refs/heads/staging | cut -f1)
DEVELOP=$(git ls-remote origin refs/heads/develop | cut -f1)
echo "prod=$PROD"
echo "staging=$STAGING"
echo "develop=$DEVELOP"
```

Expected on 2026-11-15: `prod` = `76f1a6103…`, `staging` = `2a82a62ef…`, `develop` = `da665dcd0…`. (`prod` was `973b010cc…` when this plan was written; PR #1033 merged into it at 19:39:59Z and `973b010cc` is the new tip's direct parent. Tag whatever resolves live — that is the whole point of the assertion.) `develop` is printed for the record but is not tagged — it carries no production content and the spec's screening found nothing on it worth archiving.

- [ ] **Step 3: Assert both tips resolved before tagging anything**

```bash
cd /private/tmp/spot-phase0
PROD=$(git ls-remote origin refs/heads/prod | cut -f1)
STAGING=$(git ls-remote origin refs/heads/staging | cut -f1)
if [ -z "$PROD" ] || [ -z "$STAGING" ]; then
  echo "::a promotion branch is gone — do not tag, investigate first"; exit 1
fi
echo "both tips resolved"
```

Expected: `both tips resolved`. If it exits 1, another session already reset the branch — stop and report, do not tag a guessed SHA.

- [ ] **Step 4: Confirm no `archive/*` tag already exists**

```bash
cd /private/tmp/spot-phase0 && git ls-remote --tags origin 'refs/tags/archive/*'
```

Expected: empty output. If a tag for today already exists, a prior run got this far — reuse it rather than creating a second one, and skip to Step 6.

- [ ] **Step 5: Create the two annotated tags on the resolved SHAs**

The messages embed the archive tag date and the do-not-merge warning so that anyone who finds the tag later, without the matrix open, still learns not to merge it.

```bash
cd /private/tmp/spot-phase0
DAY=$(date -u +%F)
PROD=$(git ls-remote origin refs/heads/prod | cut -f1)
STAGING=$(git ls-remote origin refs/heads/staging | cut -f1)
git tag -a "archive/prod-$DAY" "$PROD" -m "Archive of origin/prod before it was retired as a promotion branch.

The release chain now deploys from main alone (docs/superpowers/specs/2026-11-15-auto-deploy-release-pipeline-design.md).
This tip is preserved so the branch can be reset without losing history.

DO NOT MERGE THIS TAG INTO main. Screening (spec, 'Verified current state') found
no content on it that main lacks; five of its commits would revert main or
resurrect a deliberately deleted plane. See the do-not-merge record in
docs/devops/deployment-matrix.md."
git tag -a "archive/staging-$DAY" "$STAGING" -m "Archive of origin/staging before it was retired as a promotion branch.

The release chain now deploys from main alone (docs/superpowers/specs/2026-11-15-auto-deploy-release-pipeline-design.md).
This tip is preserved so the branch can be reset without losing history.

DO NOT MERGE THIS TAG INTO main. Its backend files are identical to main's, but
contracts/intake.openapi.yaml and contracts/openapi.yaml on it are 601 lines
behind main. Merging reverts the contract. See the do-not-merge record in
docs/devops/deployment-matrix.md."
git tag -l 'archive/*'
```

Expected: both tag names printed. Note the exact names — Task 2 writes them into the record.

- [ ] **Step 6: Push both tags**

```bash
cd /private/tmp/spot-phase0
DAY=$(date -u +%F)
git -c credential.helper='!gh auth git-credential' push origin "archive/prod-$DAY" "archive/staging-$DAY"
```

Expected: two `* [new tag]` lines. Push ONLY these two refs — never `--tags`, never `--all`.

- [ ] **Step 7: Verify the tags landed on the remote and point at the right commits**

```bash
cd /private/tmp/spot-phase0 && git ls-remote --tags origin 'refs/tags/archive/*'
git -C /private/tmp/spot-phase0 rev-parse "archive/prod-$(date -u +%F)^{}" "archive/staging-$(date -u +%F)^{}"
```

Expected: the `ls-remote` output lists both tags, and the two dereferenced SHAs equal the `PROD`/`STAGING` values from Step 2. If they differ, delete nothing — report it; a tag pointing at the wrong commit is still better than a second, competing tag.

---

### Task 2: Record the retired promotion model in the canonical matrix

**Files:**
- Modify: `docs/devops/deployment-matrix.md` (92 lines today)

**Interfaces:**
- Consumes: the two tag names from Task 1, Step 5.
- Produces: a durable, greppable record that (a) names the five commits that must never land on `main`, (b) declares the `release.yml` writer **Pending**, and (c) records the Render worker's version state as UNVERIFIED FROM THE REPO with both branches of its consequence written down.

**Why the matrix goes first:** `docs/devops/deployment-matrix.md` states at its own top "When this matrix and a config file disagree, this file wins", and its reconciliation checklist at `:88-92` requires the row to be **declared FIRST**, one path per service per environment, a probe contract, and migrations before traffic. Declaring the row here in PR A — marked Pending — satisfies checklist item 1 without ever claiming a writer that does not exist yet. Task 8 flips it to live truth in PR B.

- [ ] **Step 1: Read the file end to end before editing**

```bash
cd /private/tmp/spot-phase0 && cat -n docs/devops/deployment-matrix.md
```

Read all 92 lines. The sections this task touches are the service table (`:14-17`, `:20`, `:30`, `:34`), "## Promotion model" (`:37-44`), the `deploy-railway-action` prose (`:80-84`), and "## Reconciliation checklist" (`:86-92`). Editing by line number without reading destroys the anchors.

- [ ] **Step 2: Add the `release.yml` row to the workflow table, marked Pending**

Insert a row into the table that contains the `deploy-railway-action.yml` entry (`:34`). Anchor on that row's own text, not on a line number.

```markdown
| `release.yml` | **Pending — lands in PR B (`feat/release-yml-auto-deploy`)** | Every push to `main`, plus `workflow_dispatch` for rollback | development, staging, production (Railway) | Declared here FIRST per the checklist below. Until PR B merges this writer does not exist and no workflow deploys on a `main` push. |
```

The row is added in PR A and its "Pending" marker is removed in Task 8. Do not describe it as live.

- [ ] **Step 3: Replace the "## Promotion model" section**

The current section (`:37-44`) describes promotion branches and quotes `ci.yml` line numbers `:458`/`:543`/`:683` that are already stale. Replace the whole section with:

```markdown
## Promotion model

**Retired 2026-11-15.** There are no promotion branches in the release path any more.

A push to `main` is the release. `release.yml` waits for that commit's CI to go
green, then deploys development (non-blocking) and staging → production
(sequential, each environment's database migrated before the code that needs it,
nothing reaching production until staging has been probed and is serving the new
commit). There is no `workflow_dispatch`, no typed `DEPLOY` confirmation, no
`develop` / `staging` / `prod` branch to merge into, and no GitHub Environment
reviewer anywhere on the path — the `Production` environment's reviewers were
removed on 2026-11-15 (~16:34Z).

Two controls remain:

- **Brake:** set the repository variable `RAILWAY_DEPLOY_ENABLED` to anything
  other than `true` and the whole chain stops at its first job.
- **Rollback:** `workflow_dispatch` on `release.yml` with `ref=<prior main SHA>`.
  A rollback deliberately **does not apply migrations** — an older
  `supabase/migrations/` tree makes `supabase db push` abort with "remote
  migration versions not found in local migrations directory". Add
  `skip_gates=true` only if the SHA is old enough that its check-runs are past
  retention.

`db-migrate.yml` still exists but is dispatch-only: an operator tool for a
one-off apply, sharing one apply path (`_reusable-db-apply.yml`) with the chain
so there is exactly one way each database gets written.
```

- [ ] **Step 4: Append the do-not-merge record**

Add a new section immediately before "## Reconciliation checklist". Anchor on the checklist heading's preceding line, and re-emit that line.

```markdown
## Promotion branches retired 2026-11-15 — DO NOT MERGE

`origin/prod` and `origin/staging` still point at commits whose file trees are
**older** than `main`'s. Screening every candidate file by file (spec:
`docs/superpowers/specs/2026-11-15-auto-deploy-release-pipeline-design.md`,
"Verified current state") found **no content on either branch that `main`
lacks**. `git cherry` marks eleven commits `+` (re-run 2026-11-15 after Task 1:
seven on `prod`, four on `staging`), but a `+` means the *patch-id* was
not found upstream — it does not mean the content is missing. Six are already on
`main` in content; three are cases where `main` has moved ahead and merging would
revert it; two resurrect deliberately deleted code. That is 6 + 5, matching the
five-row table below and the six-item already-on-main list after it.

The tips are preserved as tags `archive/prod-2026-11-15` (`76f1a6103`) and
`archive/staging-2026-11-15` (`2a82a62ef`) so the branches can be reset without
losing history.

**These five commits must never be merged into `main`:**

| Commit | What merging it does |
|---|---|
| `41c19ea2b` promote main→prod (2026-10-17) | Resurrects the KYC admin-escalation plane that #808 (`2e22dfa7f`) deliberately deleted — 18 of its files no longer exist on `main`. |
| `616900caf` academy console (#1030) | Reverts the academy composite tuition model (`AcademyPricingKey`, `max_students`, `training_schedule`) back to the older flat `capacity`. |
| `973b010cc` academy BFF plane (#1031) | Reverts three feature flags (`referralRewards`, `estateDualControl`, `filmAcademyAssessment`) and downgrades `next` from `^16.4.3` to `^16.4.0`. |
| `2a82a62ef` promote #1014 to staging (2026-11-14) | Reverts 601 lines of `contracts/intake.openapi.yaml` + `contracts/openapi.yaml`. |
| `6948a6c49` gated staging deploy lane (2026-11-04) | Re-creates `staging-frontend-web-deploy.yml`, which `b5bc4480f` deleted under the policy "deploy only to `main`, never staging" — two live writers for one service-environment pair. |

The other six candidates (`548d07c4b`, `dae77e90b`, `5ab7c9cc0`, `75482a43a`,
`95beea87f`, `76f1a6103`) are already on `main` in content; `5ab7c9cc0` is the
commit production was serving when this was first screened.

`76f1a6103` (#1033, merged into `prod` 2026-11-15T19:39:59Z, *after* the original
screening) is the archived `prod` tip and needs its own note, because it is the one
candidate whose **commit graph** and **content** disagree. It is a forward port of
four `frontend-admin` sidebar files taken from `main` commit `8ec1681f5`, which IS
an ancestor of `origin/main`; all four blobs are byte-identical between
`76f1a6103` and `origin/main` (verified with `git rev-parse <sha>:<path>` on both
sides). So merging it would add nothing — but `git merge-base --is-ancestor
76f1a6103 origin/main` says NO, because the port was re-committed on `prod` rather
than cherry-picked with its patch-id intact. Do not read that NO as missing work.

**The residual risk is semantic, not genealogical.** Git screening proves no
*commit* is missing; it cannot prove that where `main` reimplemented something
differently, it covers every edge case the promotion-branch version did. That
risk is retired by the probe contract in the checklist below — staging smoke
before production — not by more archaeology.
```

- [ ] **Step 5: Append the Render worker version record**

Add immediately after the section from Step 4. This record is written as **UNVERIFIED FROM THE REPO** on purpose: there are no Render credentials in the repository's secrets or variables (measured 2026-11-15), so the deployed worker version cannot be read from here, and inventing a value would be worse than declaring the gap.

```markdown
## `notification-worker` version state — UNVERIFIED FROM THE REPO

Production runs the asynq consumer as Render's `spotlight-notification-worker`
(`render.yaml:76-84`, `type: worker`, `startCommand: /app/notification-worker`,
`autoDeploy: true`, built by `Dockerfile:18`). `release.yml` does **not** deploy
it, and no file under `.github/` mentions it at all. There is no Railway
production worker on purpose: two consumers on one queue with the same
`REDIS_URL` would double-deliver every push, email and SMS. The production
Railway `backend` service does not set `RUN_WORKERS_INPROCESS` and
`backend/internal/config/config.go:1234` defaults it to `false`, so the web
service does not drain the queue in-process either.

**The worker's deployed commit is unknown and cannot be determined from this
repository.** No Render credentials exist in repo secrets or variables, so no
workflow or local command here can read it.

To verify by hand: Render dashboard → service `spotlight-notification-worker` →
latest deploy → note the commit SHA, then
`git merge-base --is-ancestor <sha> origin/main && echo ancestor`.

**Both branches of the consequence, written down because only one of them is
safe:**

- If the Render blueprint tracks **`main`**, then a push to `main` already
  redeploys the worker, it stays level with the web service, and no skew is
  possible. Nothing to do.
- If the Render blueprint tracks **`prod`**, the worker froze on 2026-11-14 when
  `prod` last received work — and now that `prod` receives nothing at all, it is
  frozen permanently. Worker and web service share one compiled contract
  (`backend/cmd/notification-worker/main.go:28` registers handlers through
  `notifications.Workers(mux, …)`, the same `backend/internal/notifications`
  package the web service enqueues from, both binaries from one `Dockerfile`),
  so a new web service can enqueue payloads the old worker decodes incorrectly.

Until this is checked, treat a new enqueue-shape change as **requiring a manual
Render deploy of the worker** alongside the release.

Record the finding here, with the date and the SHA, once it is checked.
```

- [ ] **Step 6: Update the workers and Redis rows to say the chain does not deploy Render**

In the service table, the workers row (`:16`) currently reads "Backend workers (asynq) — Production: Render `spotlight-notification-worker`". Append to that row's mechanism cell:

```markdown
Not deployed by `release.yml` — see "notification-worker version state" below.
```

Leave the Redis row (`:20`) alone unless it claims a workflow deploys it. Read it first; if it names `render.yaml` only, it is already correct.

- [ ] **Step 7: Verify the document still reads as one coherent file**

```bash
cd /private/tmp/spot-phase0 && grep -n "^## \|^| \`release.yml\`" docs/devops/deployment-matrix.md
```

Expected: every `##` heading appears exactly once, in order, with `release.yml` present in the table. Then read the whole file once — a table row inserted in the wrong place renders silently as prose.

- [ ] **Step 8: Commit and push PR A**

```bash
cd /private/tmp/spot-phase0
git add docs/devops/deployment-matrix.md
git status --short
git commit -m "$(cat <<'EOF'
docs(devops): record the retired promotion model and the do-not-merge list

origin/prod and origin/staging still point at commits whose trees are older than
main's. Screening all eleven git-cherry candidates file by file found no content on
either branch that main lacks — six are already on main in content, three would
revert main, two resurrect deliberately deleted code. Until that is written down the
next person who merges a promotion branch "to catch up" silently reverts it.

Archive tags archive/prod-2026-11-15 and archive/staging-2026-11-15 preserve the
tips so the branches can be reset without losing history. The release.yml row is
declared here first, marked Pending, per the matrix's own reconciliation
checklist; it goes live in the follow-up PR that adds the workflow.

Also records the notification-worker version gap honestly: no Render credentials
exist in this repo, so the deployed worker commit cannot be read from here, and
both branches of the consequence are written down rather than one being assumed.
EOF
)"
git -c credential.helper='!gh auth git-credential' push -u origin chore/release-phase0-archive-record
```

Expected: `git status --short` shows only `docs/devops/deployment-matrix.md` staged before the commit. If it shows anything else, another session has uncommitted work in this tree — stop, do not commit it.

- [ ] **Step 9: Push and open PR A**

```bash
cd /private/tmp/spot-phase0
git -c credential.helper='!gh auth git-credential' push -u origin chore/release-phase0-archive-record
gh pr create --title "docs(devops): record the retired promotion branches and the do-not-merge list" --body "$(cat <<'EOF'
## Summary
- Archive the `origin/prod` and `origin/staging` tips as `archive/prod-2026-11-15` (`76f1a6103`) / `archive/staging-2026-11-15` (`2a82a62ef`) so the branches can be reset later without losing history.
- Record in the canonical deployment matrix which five promotion-branch commits must **never** be merged into `main`, and what merging each one does. The wider screening covered all eleven `git cherry` candidates: six are already on `main` in content, three would revert it, two resurrect deliberately deleted code.
- Declare the `release.yml` row **Pending** — the matrix's own reconciliation checklist requires the row to exist before the writer does.
- Record the `notification-worker` version state as UNVERIFIED FROM THE REPO, with both branches of its consequence, because no Render credentials exist here.

Phase 0 of `docs/superpowers/specs/2026-11-15-auto-deploy-release-pipeline-design.md` (#1034). Changes no workflow behaviour.

## Test plan
- [ ] `grep -n "^## " docs/devops/deployment-matrix.md` shows every heading once, in order
- [ ] The five do-not-merge SHAs each resolve: `git cat-file -t <sha>` prints `commit`
- [ ] Both archive tags exist on the remote and dereference to the recorded tips
- [ ] No file outside `docs/devops/deployment-matrix.md` changed
EOF
)"
```

The push uses the credential helper because a plain `git push` dies on auth in this
repo. Never pass `--delete-branch` to the merge later — see Global Constraints.

**Do not merge PR A yourself.** Merging needs the user's word.

---

# PR B — the flip

Create the branch and worktree once, before Task 3, and reuse it through Task 9:

```bash
cd /Users/paymax/Documents/spotlight/main
git fetch -q origin
git worktree add /private/tmp/spot-release -b feat/release-yml-auto-deploy origin/main
cd /private/tmp/spot-release && git log --oneline -1
```

PR B branches off `origin/main`, **not** off PR A's branch. It does not need PR A's content to build; it needs PR A *merged* so the record exists before the chain goes live. If PR A has not merged when PR B is ready, say so and wait — do not rebase onto an unmerged branch.

---

### Task 3: `scripts/ci/release-gates.py` — the CI gate, test-first

**Files:**
- Create: `scripts/ci/release-gates.py`
- Create: `scripts/ci/test-release-gates.py`
- Modify: `.github/workflows/ci.yml` — one new step in the `secret-hygiene` job (job starts `:154`, the existing `test-changed-modules.py` step is `:187`)

**Interfaces:**
- Consumes: `.github/required-checks.txt` (nine names, `:23-31`); the `gh` CLI on `PATH`; `GITHUB_REPOSITORY`, `GITHUB_OUTPUT`, `GITHUB_STEP_SUMMARY` from the runner.
- Produces:
  - exit `0` for verdicts `proceed`, `noop_docs_only`, `superseded`; exit `1` for `failed` and `timeout`; exit `2` for a usage error.
  - `GITHUB_OUTPUT` line `verdict=<decision>`.
  - Functions later tasks and the test rely on, with these exact signatures:
    - `required_names(path=REQUIRED_CHECKS) -> list[str]`
    - `latest_by_name(check_runs: list[dict]) -> dict[str, dict]`
    - `latest_run(runs: list[dict], path: str) -> dict | None`
    - `classify(check_runs, runs, required, event, absence_settled) -> Verdict`
    - `pages(blob: str) -> Iterator[dict]`
    - `wait(sha, required, event, budget_s, absence_budget_s, fetch_check_runs, fetch_runs, sleep=time.sleep, clock=time.monotonic, log=print) -> Verdict`
    - `main(argv=None) -> int`
    - `class Verdict(NamedTuple)` with fields `decision: str`, `reason: str`, `unsettled: tuple`

**Why a Python module and not bash-in-YAML (spec Decision C).** This gate is the only thing between a push to `main` and a production deploy, and it works by polling an API. Verdict logic embedded in a `run:` block cannot be unit-tested, so the first time anyone learns it is wrong is during a bad release. The repo already has this exact split — `changed-modules.py` + `test-changed-modules.py` — and the new files follow it.

**The two mechanisms, because they are different (spec Decision C, corrected).** There is no check-run named `integration-verify`; that workflow produces check-runs named for its own jobs. So the gate waits on:
1. every check-run **name** in `.github/required-checks.txt` reaching `completed` + a green conclusion — `GET repos/{o}/{r}/commits/{sha}/check-runs`, and **`--paginate` is mandatory**: `6199a6b57` returns **50** check-runs, so an unpaged read sees a false all-green.
2. the `integration-verify` **workflow run** for that SHA reaching `completed/success` — `GET repos/{o}/{r}/actions/runs?head_sha={sha}`, filtered to `path == ".github/workflows/integration-verify.yml"` and `event == "push"`.

- [ ] **Step 1: Write the failing test file**

Create `scripts/ci/test-release-gates.py`. Every check names the production change that would make it fail — a check that cannot be broken by any plausible edit is not a test.

```python
#!/usr/bin/env python3
"""Pins the verdict logic of release-gates.py. Runs in ci.yml's secret-hygiene job.

release-gates.py is the only thing between a push to main and a production deploy,
and it decides by polling an API — so its verdicts are driven here by fixtures
instead of being discovered during a release. Sub-second, no network.
"""

import contextlib
import importlib.util
import io
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("rg", ROOT / "scripts/ci/release-gates.py")
rg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rg)

failures = []
CI = rg.CI_WORKFLOW
INTEG = rg.INTEG_WORKFLOW
REQ = rg.required_names()


def check(name, got, want):
    if got != want:
        failures.append(f"{name}: got {got!r}, want {want!r}")


def cr(name, conclusion="success", status="completed", id=1):
    return {"name": name, "conclusion": conclusion, "status": status, "id": id}


def run(path, conclusion="success", status="completed", event="push", id=1):
    return {"path": path, "conclusion": conclusion, "status": status,
            "event": event, "id": id}


def green_set():
    """The fixture that means 'everything this commit needs is green'."""
    return ([cr(n, id=i) for i, n in enumerate(REQ, start=1)],
            [run(CI, id=900), run(INTEG, id=901)])


def decide(check_runs, runs, event="push", absence_settled=True):
    return rg.classify(check_runs, runs, REQ, event, absence_settled)


class _Clock:
    """Deterministic time so `wait` can be driven to a timeout without sleeping."""

    def __init__(self, step):
        self.now = 0.0
        self.step = step
        self.sleeps = 0

    def __call__(self):
        self.now += self.step
        return self.now

    def sleep(self, _seconds):
        self.sleeps += 1


def quiet(argv):
    """Run main() with both streams captured AND the runner's output files
    detached — otherwise the test appends a stray `verdict=proceed` line to the
    real GITHUB_OUTPUT of whichever ci.yml job runs it."""
    saved = {k: os.environ.pop(k, None) for k in ("GITHUB_OUTPUT", "GITHUB_STEP_SUMMARY")}
    try:
        with contextlib.redirect_stdout(io.StringIO()), \
                contextlib.redirect_stderr(io.StringIO()):
            return rg.main(argv)
    finally:
        for k, v in saved.items():
            if v is not None:
                os.environ[k] = v


# --- the happy path ----------------------------------------------------------
crs, runs = green_set()
check("all green -> proceed", decide(crs, runs).decision, "proceed")

# --- unsettled states must WAIT, not pass ------------------------------------
# Would break if classify() treated a missing required name as satisfied.
check("missing required name -> waiting",
      decide(crs[:-1], runs).decision, "waiting")
# Would break if classify() read status only, or conclusion only.
check("in_progress -> waiting",
      decide([cr(REQ[0], status="in_progress", conclusion=None)] + crs[1:], runs).decision,
      "waiting")

# --- red must FAIL -----------------------------------------------------------
# Would break if classify() let one red name ride along with eight green ones.
check("one failure -> failed",
      decide([cr(REQ[0], conclusion="failure")] + crs[1:], runs).decision, "failed")
check("integ run failed -> failed",
      decide(crs, [run(CI, id=900), run(INTEG, conclusion="failure", id=901)]).decision,
      "failed")

# --- cancelled means a NEWER commit owns this release ------------------------
# Would break if classify() reported cancelled as failed: that would page a human
# about a release that was correctly superseded.
check("required name cancelled -> superseded",
      decide([cr(REQ[0], conclusion="cancelled")] + crs[1:], runs).decision, "superseded")
check("ci run cancelled -> superseded",
      decide(crs, [run(CI, conclusion="cancelled", id=900), run(INTEG, id=901)]).decision,
      "superseded")
check("integ run cancelled -> superseded",
      decide(crs, [run(CI, id=900), run(INTEG, conclusion="cancelled", id=901)]).decision,
      "superseded")

# --- a non-required lane going red must NOT stop a release -------------------
# `security` (CodeQL/gitleaks/trivy) and ci-optimized.yml both fire on a main push
# and are in .github/required-checks.txt's absence. Would break if classify()
# iterated all check-runs instead of only the required names.
check("non-required red -> proceed",
      decide(crs + [cr("security / codeql", conclusion="failure", id=99)], runs).decision,
      "proceed")

# --- docs-only pushes produce ZERO check-runs, and that is not a failure -----
# ci.yml and integration-verify.yml both carry paths-ignore ['**.md','docs/**'] on
# push to main, so a docs-only commit has nothing to build. Would break if the
# absence of a ci.yml run were read as "still starting".
check("no ci run, absence not settled -> waiting",
      decide([], [], absence_settled=False).decision, "waiting")
check("no ci run, settled, push -> noop_docs_only",
      decide([], [], absence_settled=True).decision, "noop_docs_only")
# THE DANGEROUS ONE. On a dispatch the SHA may be old enough that its runs are past
# retention; reading that as "docs-only" would silently skip the rollback the
# operator asked for. Would break if classify() ignored `event`.
check("no ci run, settled, dispatch -> failed",
      decide([], [], event="workflow_dispatch", absence_settled=True).decision, "failed")

# --- integration-verify is waited on as a RUN, not a check-run name ----------
# No check-run named `integration-verify` exists; the workflow produces check-runs
# named for its own jobs. Would break if the gate looked for that name instead.
check("integ run missing -> waiting and names it",
      INTEG + " run" in decide(crs, [run(CI, id=900)]).unsettled, True)
# A skipped run is satisfied: integration-verify has no paths filter, but a
# workflow_dispatch-only run of it would legitimately report skipped.
check("integ run skipped -> proceed",
      decide(crs, [run(CI, id=900), run(INTEG, conclusion="skipped", id=901)]).decision,
      "proceed")
# A pull_request run of the same path is a DIFFERENT commit's evidence.
check("only a pull_request integ run -> waiting",
      decide(crs, [run(CI, id=900),
                   run(INTEG, event="pull_request", id=901)]).decision, "waiting")

# --- re-runs: the LATEST attempt decides, not the greenest -------------------
# A re-run creates a NEW check-run id. "Any green attempt wins" would let a re-run
# hide the very failure that prompted it.
check("older failure + newer success -> proceed",
      decide([cr(REQ[0], conclusion="failure", id=5)] +
             [cr(REQ[0], conclusion="success", id=50)] + crs[1:], runs).decision,
      "proceed")
check("older success + newer failure -> failed",
      decide([cr(REQ[0], conclusion="success", id=5)] +
             [cr(REQ[0], conclusion="failure", id=50)] + crs[1:], runs).decision,
      "failed")
check("latest_run picks the greatest id",
      rg.latest_run([run(CI, conclusion="failure", id=5),
                     run(CI, conclusion="success", id=50)], CI)["id"], 50)

# --- `skipped` satisfies a required name ------------------------------------
# Module lanes are gated on the router and report skipped when their module did
# not change; GitHub itself treats a skipped required check as satisfied.
check("required name skipped -> proceed",
      decide([cr(REQ[0], conclusion="skipped")] + crs[1:], runs).decision, "proceed")

# --- --paginate CONCATENATES object-valued pages ----------------------------
# gh api --paginate merges into one array only when each page IS an array. Both
# endpoints used here return objects, so the blob arrives as `{...}{...}` and
# json.loads() would raise on the second brace. A commit here returns 50
# check-runs, so this path is exercised on the very first real run.
check("pages walks concatenated objects",
      [p["n"] for p in rg.pages('{"n": 1}\n{"n": 2}')], [1, 2])
check("pages handles one page",
      [p["n"] for p in rg.pages('{"n": 1}')], [1])
check("pages handles a trailing newline",
      [p["n"] for p in rg.pages('{"n": 1}\n')], [1])
check("pages handles empty input",
      list(rg.pages("")), [])

# --- the required-checks file itself -----------------------------------------
# Would break if required_names() kept blank lines or comment lines, which would
# make every gate wait forever on a name that can never report.
check("required_names count", len(REQ), 9)
check("required_names unique", len(set(REQ)), 9)
check("required_names has no empties", "" in REQ, False)
check("required_names includes actionlint",
      "workflows (actionlint)" in REQ, True)

# --- wait() must return at once when green, and time out deterministically ---
crs, runs = green_set()
clock = _Clock(0)
got = rg.wait("a" * 40, REQ, "push", 2400, 300,
              lambda sha: crs, lambda sha: runs,
              sleep=clock.sleep, clock=clock, log=lambda *_: None)
check("wait returns immediately on green", got.decision, "proceed")
check("wait did not sleep on green", clock.sleeps, 0)

clock = _Clock(30)  # each iteration advances 30s; POLL_SECONDS is 30
got = rg.wait("a" * 40, REQ, "push", 120, 30,
              lambda sha: [],                      # nothing has reported yet
              lambda sha: [run(CI, status="in_progress", conclusion=None, id=1)],
              sleep=clock.sleep, clock=clock, log=lambda *_: None)
# Would break if wait() ignored budget_s and polled forever — that is a hung
# release job holding the concurrency slot, which blocks every later main push.
check("wait times out", got.decision, "timeout")
check("wait slept 4 times before a 120s budget", clock.sleeps, 4)
check("timeout names the unsettled integ run", INTEG + " run" in got.unsettled, True)

# --- skip_gates is a ROLLBACK input, never a bypass --------------------------
# A push event cannot carry inputs, so --skip-gates on a push is not a rollback.
# Would break if main() dropped the event check and let any caller assert green.
check("skip-gates on a push is a usage error",
      quiet(["--sha", "a" * 40, "--event", "push", "--skip-gates"]), 2)
check("skip-gates on a dispatch proceeds",
      quiet(["--sha", "a" * 40, "--event", "workflow_dispatch", "--skip-gates"]), 0)
check("missing --repo is a usage error",
      quiet(["--sha", "a" * 40, "--event", "push", "--repo", ""]), 2)

if failures:
    print("FAIL")
    for line in failures:
        print("  " + line)
    sys.exit(1)
print(f"ok — release-gates verdict logic pinned ({len(REQ)} required checks)")
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd /private/tmp/spot-release && python3 scripts/ci/test-release-gates.py
```

Expected: **FAIL** — the import itself raises `FileNotFoundError` because `release-gates.py` does not exist yet. That is the correct red. If it instead prints `ok`, the file already exists and this task is not starting from scratch — stop and read it.

- [ ] **Step 3: Write `scripts/ci/release-gates.py`**

```python
#!/usr/bin/env python3
"""Decide whether a commit's CI is green enough to release.

release.yml calls this instead of embedding the verdict in bash-in-YAML, which
cannot be unit-tested. Same split as changed-modules.py / test-changed-modules.py.

The gate waits on two things by the mechanism that actually reports them
(spec Decision C):
  1. every check-run NAME in .github/required-checks.txt reaches
     completed/success — GET commits/{sha}/check-runs, --paginate MANDATORY
     (one commit here returns 50 check-runs; an unpaged read is a false green).
  2. the integration-verify WORKFLOW RUN for that SHA reaches
     completed/success — GET actions/runs?head_sha={sha}, filtered to that
     path and event == "push". It has no single check-run name to wait on.

Verdicts, all real on this repo:
  proceed         every required name green + integration-verify green
  noop_docs_only  a push produced no ci.yml run: both lanes carry
                  paths-ignore ['**.md','docs/**'], so a docs-only commit has
                  nothing to build
  superseded      a required check reported cancelled: both lanes use
                  cancel-in-progress on a per-ref group, so a newer main
                  commit owns this release
  failed          something reported failure/timed_out/action_required
  timeout         the budget ran out with gates still unsettled
  waiting         internal: keep polling

`noop_docs_only` is valid ONLY for a push. On a workflow_dispatch rollback the
SHA may be old enough that its runs are past retention, and reading that as
"docs-only" would silently skip the rollback the operator asked for — so a
dispatch with no CI run fails loudly unless skip_gates was passed. A push
event can never set skip_gates.

Usage:
  release-gates.py --sha <sha> --event push --repo <owner/repo>
  release-gates.py --sha <sha> --event workflow_dispatch --skip-gates
"""

import argparse
import json
import os
import pathlib
import subprocess
import sys
import time
from typing import NamedTuple

ROOT = pathlib.Path(__file__).resolve().parents[2]
CI_WORKFLOW = ".github/workflows/ci.yml"
INTEG_WORKFLOW = ".github/workflows/integration-verify.yml"
REQUIRED_CHECKS = str(ROOT / ".github/required-checks.txt")

# `skipped` satisfies: module lanes are gated on the router and report skipped
# when their module did not change, and GitHub itself treats a skipped
# required check as satisfied.
GREEN = frozenset({"success", "skipped", "neutral"})
BAD = frozenset({"failure", "timed_out", "action_required", "startup_failure"})
POLL_SECONDS = 30


class Verdict(NamedTuple):
    decision: str
    reason: str
    unsettled: tuple


def required_names(path=REQUIRED_CHECKS):
    names = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#"):
                names.append(line)
    return names


def latest_by_name(check_runs):
    latest = {}
    for row in check_runs:
        name = row.get("name")
        if not name:
            continue
        prev = latest.get(name)
        # A re-run creates a NEW check-run id, so the greatest id is the latest
        # attempt. "Any green attempt wins" would let a re-run hide the failure
        # that prompted it.
        if prev is None or int(row.get("id") or 0) > int(prev.get("id") or 0):
            latest[name] = row
    return latest


def latest_run(runs, path):
    match = [r for r in runs if r.get("path") == path and r.get("event") == "push"]
    if not match:
        return None
    return max(match, key=lambda r: int(r.get("id") or 0))


def classify(check_runs, runs, required, event, absence_settled):
    """Pure verdict logic. No I/O, no clock — the test drives it with fixtures."""
    latest = latest_by_name(check_runs)
    ci_run = latest_run(runs, CI_WORKFLOW)

    if ci_run is None:
        if not absence_settled:
            return Verdict("waiting", f"no {CI_WORKFLOW} run for this SHA yet", ())
        if event == "push":
            return Verdict("noop_docs_only",
                           f"no {CI_WORKFLOW} run for this SHA. {CI_WORKFLOW} and "
                           f"{INTEG_WORKFLOW} both carry paths-ignore "
                           "['**.md','docs/**'] on push to main, so a docs-only "
                           "commit produces zero check-runs: nothing to build, "
                           "nothing to deploy.", ())
        return Verdict("failed",
                       f"no {CI_WORKFLOW} run for this SHA, and this is a "
                       "workflow_dispatch. The commit may be old enough that its "
                       "runs are past retention. Re-dispatch with skip_gates=true "
                       "to assert CI was green when this SHA was main.", ())

    if ci_run.get("conclusion") == "cancelled":
        return Verdict("superseded",
                       f"the {CI_WORKFLOW} run was cancelled by a newer main commit", ())

    cancelled = sorted(n for n in required
                       if latest.get(n, {}).get("conclusion") == "cancelled")
    if cancelled:
        return Verdict("superseded",
                       "cancelled by a newer main commit: " + ", ".join(cancelled), ())

    bad, unsettled = [], []
    for name in required:
        row = latest.get(name)
        if row is None or row.get("status") != "completed":
            unsettled.append(name)
        elif row.get("conclusion") in BAD:
            bad.append(f"{name} ({row.get('conclusion')})")
        elif row.get("conclusion") not in GREEN:
            unsettled.append(f"{name} ({row.get('conclusion')})")

    integ = latest_run(runs, INTEG_WORKFLOW)
    if integ is None or integ.get("status") != "completed":
        unsettled.append(f"{INTEG_WORKFLOW} run")
    elif integ.get("conclusion") == "cancelled":
        return Verdict("superseded",
                       f"{INTEG_WORKFLOW} was cancelled by a newer main commit", ())
    elif integ.get("conclusion") in BAD:
        bad.append(f"{INTEG_WORKFLOW} ({integ.get('conclusion')})")
    elif integ.get("conclusion") not in GREEN:
        unsettled.append(f"{INTEG_WORKFLOW} ({integ.get('conclusion')})")

    if bad:
        return Verdict("failed", "red: " + ", ".join(bad), tuple(unsettled))
    if unsettled:
        return Verdict("waiting", f"{len(unsettled)} gate(s) unsettled", tuple(unsettled))
    return Verdict("proceed",
                   f"{len(required)} required checks green + {INTEG_WORKFLOW} green", ())


def pages(blob):
    """`gh api --paginate` CONCATENATES object-valued pages ({...}{...}); it only
    merges into one array when each page is itself an array. Both endpoints used
    here return objects, so the concatenation must be walked, not json.load'd.
    """
    decoder = json.JSONDecoder()
    idx, end = 0, len(blob)
    while idx < end:
        while idx < end and blob[idx].isspace():
            idx += 1
        if idx >= end:
            break
        obj, idx = decoder.raw_decode(blob, idx)
        yield obj


def gh(url):
    proc = subprocess.run(["gh", "api", "--paginate", url],
                          capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"gh api {url} failed ({proc.returncode}): "
                           f"{proc.stderr.strip()[:400]}")
    return proc.stdout


def make_fetchers(repo):
    def fetch_check_runs(sha):
        rows = []
        for page in pages(gh(f"repos/{repo}/commits/{sha}/check-runs")):
            rows.extend(page.get("check_runs") or [])
        return rows

    def fetch_runs(sha):
        rows = []
        for page in pages(gh(f"repos/{repo}/actions/runs?head_sha={sha}&per_page=100")):
            rows.extend(page.get("workflow_runs") or [])
        return rows

    return fetch_check_runs, fetch_runs


def wait(sha, required, event, budget_s, absence_budget_s,
         fetch_check_runs, fetch_runs,
         sleep=time.sleep, clock=time.monotonic, log=print):
    start = clock()
    absence_deadline = start + absence_budget_s
    while True:
        # ONE clock read per iteration, feeding both absence_settled and elapsed.
        # Reading the clock twice (once in the classify call, once for elapsed)
        # makes the pair inconsistent, and under the test's deterministic _Clock --
        # which advances a fixed step per CALL -- it doubles simulated time per
        # iteration, so a 120s budget with a 30s step sleeps once instead of the
        # four times the test pins. With a real monotonic clock the two reads are
        # microseconds apart and nothing changes; with the test clock it breaks.
        now = clock()
        verdict = classify(fetch_check_runs(sha), fetch_runs(sha), required, event,
                           absence_settled=now >= absence_deadline)
        if verdict.decision != "waiting":
            return verdict
        elapsed = int(now - start)
        # Strictly greater, not >=: with >= the loop times out on the iteration
        # where elapsed first EQUALS the budget, having slept one time fewer than
        # the test pins. Overshoot is bounded by one POLL_SECONDS (30s) on a
        # 75-minute budget (amended 2026-11-16 from 40 — see the Task 9 entry in
        # "Deliberate corrections made during review").
        if elapsed > budget_s:
            return Verdict("timeout",
                           f"CI did not settle within {budget_s // 60} minutes "
                           f"({verdict.reason})",
                           verdict.unsettled)
        log(f"  +{elapsed}s — {verdict.reason}"
            + (f": {', '.join(verdict.unsettled)}" if verdict.unsettled else ""))
        sleep(POLL_SECONDS)


def summary(verdict, sha):
    lines = [f"### Release gate: **{verdict.decision}**", "",
             f"- commit: `{sha}`", f"- reason: {verdict.reason}"]
    if verdict.unsettled:
        lines.append("- unsettled: " + ", ".join(f"`{u}`" for u in verdict.unsettled))
    return "\n".join(lines) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--sha", required=True)
    ap.add_argument("--event", required=True, choices=["push", "workflow_dispatch"])
    ap.add_argument("--skip-gates", action="store_true",
                    help="rollback only: assert CI was green when this SHA was main")
    ap.add_argument("--budget-minutes", type=int, default=75)
    ap.add_argument("--absence-budget-minutes", type=int, default=5)
    ap.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", ""))
    args = ap.parse_args(argv)

    # A push event cannot carry inputs, so skip_gates on a push is not a
    # rollback — it is a bypass, and the point of this change is that the
    # normal path has none.
    if args.skip_gates and args.event != "workflow_dispatch":
        print("::error::--skip-gates is a rollback input; a push event can never set it",
              file=sys.stderr)
        return 2

    if args.skip_gates:
        verdict = Verdict("proceed",
                          "operator asserted CI was green when this SHA was main", ())
    else:
        if not args.repo:
            print("::error::--repo or GITHUB_REPOSITORY is required", file=sys.stderr)
            return 2
        fetch_check_runs, fetch_runs = make_fetchers(args.repo)
        verdict = wait(args.sha, required_names(), args.event,
                       args.budget_minutes * 60, args.absence_budget_minutes * 60,
                       fetch_check_runs, fetch_runs)

    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write(f"verdict={verdict.decision}\n")
    text = summary(verdict, args.sha)
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(text)
    print(text)

    # `superseded` and `noop_docs_only` exit 0: a newer commit owns the release,
    # or there was nothing to build. Neither is a failure and neither deploys —
    # every downstream job tests `verdict == 'proceed'`.
    return 0 if verdict.decision in ("proceed", "noop_docs_only", "superseded") else 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd /private/tmp/spot-release && python3 scripts/ci/test-release-gates.py
```

Expected: `ok — release-gates verdict logic pinned (9 required checks)`.

If `required_names count` fails with something other than 9, `.github/required-checks.txt` has changed since this plan was written. Read the file, count the non-comment non-blank lines, and update **both** the test's expected count and this plan — do not loosen the test to match.

- [ ] **Step 5: Drive the real script against a real commit**

This is the one check that proves the `--paginate` walk and the two endpoints agree with the live API. `6199a6b57` is `origin/main`'s tip as of 2026-11-15 and has 50 check-runs.

```bash
cd /private/tmp/spot-release
SHA=$(git ls-remote origin refs/heads/main | cut -f1)
echo "probing $SHA"
gh api --paginate "repos/paymax2022/spotlight-latest1/commits/$SHA/check-runs" \
  | python3 -c "
import sys, json
blob = sys.stdin.read()
d = json.JSONDecoder(); i = 0; rows = []
while i < len(blob):
    while i < len(blob) and blob[i].isspace(): i += 1
    if i >= len(blob): break
    o, i = d.raw_decode(blob, i); rows.extend(o.get('check_runs') or [])
print('check-runs:', len(rows))
print('distinct names:', len({r['name'] for r in rows}))
"
```

Expected: `check-runs:` a number in the tens (`6199a6b57` returned **50**; a newer `origin/main` tip returns however many lanes that commit triggered — 43 was observed for `e92e1058d`), and `distinct names:` at least 9. The point is that the number is larger than one page, which is what proves the pagination walk. Then let the script itself render the verdict with a **zero budget** so it cannot hang:

```bash
cd /private/tmp/spot-release
SHA=$(git ls-remote origin refs/heads/main | cut -f1)
python3 scripts/ci/release-gates.py --sha "$SHA" --event push \
  --repo paymax2022/spotlight-latest1 --budget-minutes 0; echo "exit=$?"
```

Expected: a `### Release gate: **…**` block naming the commit and a reason, and `exit=0` or `exit=1` depending on the live state. **Any verdict other than `proceed` is fine here** — the point is that the script reached a verdict rather than crashing. If it raises a `RuntimeError` about `gh api`, the repo is private and `GH_TOKEN` is needed:

```bash
cd /private/tmp/spot-release
GH_TOKEN=$(gh auth token) python3 scripts/ci/release-gates.py --sha "$SHA" --event push \
  --repo paymax2022/spotlight-latest1 --budget-minutes 0; echo "exit=$?"
```

- [ ] **Step 6: Wire the test into ci.yml's hygiene job**

The `secret-hygiene` job starts at `ci.yml:154` and already runs `python3 scripts/ci/test-changed-modules.py` at `:187`. Add one step immediately after it, anchored on that step's own text:

```yaml
      # The release gate is the only thing between a push to main and a
      # production deploy, and it decides by polling an API — so its verdict
      # logic is extracted where fixtures can drive it. Sub-second, no network,
      # so it shares this runner rather than getting a lane of its own.
      - name: Test the release gate
        run: python3 scripts/ci/test-release-gates.py
```

Do **not** add a new job and do **not** touch `.github/required-checks.txt` — the hygiene job's existing required-check name `hygiene (client secrets + live-DB test gate + migration versions)` already covers the new step.

- [ ] **Step 7: Verify the existing ci.yml test still passes**

`scripts/ci/test-changed-modules.py` asserts that every required check's caller name appears as a `name:` in ci.yml and that ci.yml calls ≤20 unique reusables. Adding a step breaks neither, but prove it:

```bash
cd /private/tmp/spot-release && python3 scripts/ci/test-changed-modules.py
```

Expected: `ok — …`. A failure here means the step was added in a way that disturbed the job structure.

- [ ] **Step 8: Lint and commit**

```bash
cd /private/tmp/spot-release
python3 -m py_compile scripts/ci/release-gates.py scripts/ci/test-release-gates.py && echo "compiles"
/Users/paymax/go/bin/actionlint -no-color -oneline -shellcheck= -pyflakes= .github/workflows/ci.yml
git add scripts/ci/release-gates.py scripts/ci/test-release-gates.py .github/workflows/ci.yml
git status --short
git commit -m "$(cat <<'EOF'
ci: extract the release gate's verdict logic into a tested module

release.yml has to decide whether a commit's CI is green before it is allowed to
deploy production, and that decision works by polling two different GitHub
endpoints — the required check-run names, and the integration-verify workflow run
(which has no check-run of that name to wait on). Verdict logic embedded in a
run: block cannot be unit-tested, so the first time anyone would learn it is
wrong is during a bad release.

Follows the split the repo already uses for changed-modules.py: pure classify()
driven by fixtures, with the I/O and the clock injected so wait() can be driven
to a deterministic timeout.

Three verdicts are worth calling out because each one is a real state on this
repo and each one is easy to get wrong:
- noop_docs_only: both CI lanes carry paths-ignore ['**.md','docs/**'], so a
  docs-only main push produces zero check-runs. That is not a 75-minute timeout.
- superseded: both lanes use cancel-in-progress on a per-ref group, so a newer
  main commit cancels this one. Not a failure, and it must not deploy.
- a dispatch with no CI run at all fails loudly rather than reading as
  docs-only, because a rollback SHA may be past retention and silently skipping
  the rollback the operator asked for is worse than paging them.

--paginate is mandatory, not an optimisation: 6199a6b57 returns 50 check-runs,
and gh concatenates object-valued pages, so an unpaged read is a false all-green.
EOF
)"
```

Expected: `compiles`, no actionlint output, and `git status --short` listing exactly the three files before the commit.

---

### Task 4: `_reusable-db-apply.yml` and rewiring `db-migrate.yml`

**Files:**
- Create: `.github/workflows/_reusable-db-apply.yml`
- Modify: `.github/workflows/db-migrate.yml` (286 lines today)

**Interfaces:**
- Consumes: repository secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_STAGING_PROJECT_ID`, `SUPABASE_STAGING_DB_PASSWORD`; environment secret `SUPABASE_DB_PASSWORD` on `production` only; repository variables `DB_MIGRATE_ENABLED`, `DB_MIGRATE_STAGING_ENABLED`.
- Produces: a `workflow_call` entry point that Tasks 5-6 call as `uses: ./.github/workflows/_reusable-db-apply.yml` with inputs `target` (required, `staging`|`production`), `dry_run` (bool, default `false`), `include_all` (bool, default `false`), `skip_apply` (bool, default `false`), `skip_reason` (string, default `'not requested'`).

**Why one apply path (spec Decision D).** `db-migrate.yml`'s staging apply fires only on a push to the `staging` branch (`:40`). Once releases come from `main` alone and the promotion branches stop receiving work, the staging schema would silently drift behind the code being deployed to it. Extracting the apply means `release.yml` and the operator dispatch share exactly one code path per database, so a chain that went green on staging proves something about production.

**Secret scoping, measured 2026-11-15 with `gh secret list --env <name>`.** All Railway and Supabase secrets are **repository** secrets EXCEPT `SUPABASE_DB_PASSWORD`, which also exists as the *only* environment secret, on `production`/`Production`. `staging` and `development` hold none. That single fact decides the shape: the caller job cannot read the production password to pass it down, so the environment must be declared on the *called* job — which also preserves today's precedence exactly, because GitHub resolves an environment secret over a repository secret of the same name. This move therefore cannot silently change which password production applies with.

- [ ] **Step 1: Re-read `db-migrate.yml` and confirm the spans**

```bash
cd /private/tmp/spot-release && grep -n "^on:\|^  push:\|^  workflow_dispatch:\|^  branches:\|^jobs:\|^  guard:\|^  apply:\|^  apply-staging:\|environment:\|version: 2.114.0\|Refuse to run against a production project\|required reviewers" .github/workflows/db-migrate.yml
```

Expected on `origin/main` = `6199a6b57`: `on:` `:38`, `branches: [main, staging]` `:40`, the header's reviewer recommendation `:18`, `guard:` `:70`, `apply:` `:74`, `environment: production` `:83`, `version: 2.114.0` `:152`, `apply-staging:` `:178`, `environment: staging` `:187`, `version: 2.114.0` `:249`, "Refuse to run against a production project" `:258`. If any of these has moved, work from the content, not the number.

- [ ] **Step 2: Write `.github/workflows/_reusable-db-apply.yml`**

```yaml
name: _reusable-db-apply

# ONE apply path per database, called by release.yml (per environment, before the
# code that needs it) and by db-migrate.yml (operator dispatch only). Extracted
# because db-migrate.yml's staging apply fires only on a push to the `staging`
# branch — once releases come from `main` alone and the promotion branches stop
# receiving work, the staging schema would silently drift behind the code being
# deployed to it.
#
# WHY THE JOB DECLARES `environment:` AND THE CALLER DOES NOT. A job calling a
# reusable workflow with `uses:` may only carry name/uses/with/secrets/needs/if/
# permissions — actionlint v1.7.12 rejects `environment:` on it, and so does
# GitHub. Production's SUPABASE_DB_PASSWORD is an ENVIRONMENT secret (the only one
# that exists; staging and development hold none), so the caller cannot read it to
# pass it down. Declaring the environment here also preserves today's precedence
# exactly: GitHub resolves an environment secret over a repository secret of the
# same name, so this move cannot change which password production applies with.
#
# The additive-only guard is NOT called from here, on purpose. release.yml's
# `gates` already waits on `migrations (additive-only guard) / guard` as a
# required check, and db-migrate.yml keeps its own sibling `guard` job. Nesting
# _reusable-migration-guard.yml inside this workflow would run the guard twice per
# release and add a nesting level for no new information.

on:
  workflow_call:
    inputs:
      target:
        description: 'Which database to apply to: staging | production'
        required: true
        type: string
      dry_run:
        description: 'List pending migrations only — do not apply'
        required: false
        type: boolean
        default: false
      include_all:
        description: 'Pass --include-all so migrations older than the last applied one are applied too'
        required: false
        type: boolean
        default: false
      skip_apply:
        description: 'Do not apply; report why and succeed (a stale ref, or a rollback to a pre-tip SHA)'
        required: false
        type: boolean
        default: false
      skip_reason:
        description: 'Shown in the notice when skip_apply is true'
        required: false
        type: string
        default: 'not requested'

permissions:
  contents: read

jobs:
  apply:
    name: supabase db push (${{ inputs.target }})
    runs-on: ubuntu-latest
    environment: ${{ inputs.target }}
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_PROJECT_ID: ${{ inputs.target == 'production' && secrets.SUPABASE_PROJECT_ID || secrets.SUPABASE_STAGING_PROJECT_ID }}
      SUPABASE_DB_PASSWORD: ${{ inputs.target == 'production' && secrets.SUPABASE_DB_PASSWORD || secrets.SUPABASE_STAGING_DB_PASSWORD }}
      TARGET: ${{ inputs.target }}
      PROD_PROJECT_ID: ${{ secrets.SUPABASE_PROJECT_ID }}
      STAGING_PROJECT_ID: ${{ secrets.SUPABASE_STAGING_PROJECT_ID }}
    steps:
      - uses: actions/checkout@v4

      # Runs FIRST and unconditionally. The secret ternaries above can only ever
      # pick between two known branches once this has passed, so a typo'd or
      # interpolated-empty target is caught before any credential is resolved.
      - name: Refuse an unknown target
        run: |
          case "$TARGET" in
            staging|production) echo "target: $TARGET" ;;
            *) echo "::error::target must be staging or production, got '$TARGET'"; exit 1 ;;
          esac

      # DECIDES, rather than gating the job on `if:`. A SKIPPED `needs:`
      # dependency makes GitHub skip every job downstream of it, so an
      # `if:`-skipped migrate job would cancel the deploy that follows it — a
      # rollback would deploy nothing at all. The job always runs; this step
      # chooses whether the later steps do anything.
      - name: Decide whether to apply
        id: gate
        env:
          SKIP_APPLY: ${{ inputs.skip_apply }}
          SKIP_REASON: ${{ inputs.skip_reason }}
          DRY_RUN: ${{ inputs.dry_run }}
          PROD_ENABLED: ${{ vars.DB_MIGRATE_ENABLED }}
          STAGING_ENABLED: ${{ vars.DB_MIGRATE_STAGING_ENABLED }}
        run: |
          set -euo pipefail
          if [ "$TARGET" = production ]; then enabled="$PROD_ENABLED"; else enabled="$STAGING_ENABLED"; fi
          if [ "$SKIP_APPLY" = true ]; then
            echo "apply=false" >> "$GITHUB_OUTPUT"
            echo "::notice::$TARGET apply skipped — $SKIP_REASON"
            exit 0
          fi
          if [ "$enabled" != true ]; then
            echo "apply=false" >> "$GITHUB_OUTPUT"
            echo "::notice::$TARGET apply skipped — its enablement variable is not 'true'. Nothing was written."
            exit 0
          fi
          echo "apply=true" >> "$GITHUB_OUTPUT"
          echo "$TARGET apply is enabled; dry_run=$DRY_RUN."

      # Fails BEFORE any db push. This is the safe failure mode of a missing
      # `secrets: inherit` on a caller: the credentials resolve empty and the
      # chain stops here rather than pushing with no password.
      - name: Check required secrets are present
        if: steps.gate.outputs.apply == 'true'
        run: |
          : "${SUPABASE_ACCESS_TOKEN:?missing SUPABASE_ACCESS_TOKEN}"
          : "${SUPABASE_PROJECT_ID:?missing the $TARGET project ref}"
          : "${SUPABASE_DB_PASSWORD:?missing the $TARGET database password}"

      # The ternaries above fall through on an EMPTY string, so a missing
      # production ref would silently resolve to the STAGING ref. Both directions
      # are checked; the production-direction check is carried over from
      # db-migrate.yml:258 unchanged, and the staging direction is new because
      # this workflow is the first thing that can point staging at production.
      - name: Refuse to run production against the staging project
        if: steps.gate.outputs.apply == 'true' && inputs.target == 'production'
        run: |
          if [ -n "$STAGING_PROJECT_ID" ] && [ "$SUPABASE_PROJECT_ID" = "$STAGING_PROJECT_ID" ]; then
            echo "::error::the production project ref resolved to the STAGING ref — refusing to push."
            exit 1
          fi
          echo "Production project ref is distinct from staging."

      - name: Refuse to run staging against the production project
        if: steps.gate.outputs.apply == 'true' && inputs.target == 'staging'
        run: |
          if [ -n "$PROD_PROJECT_ID" ] && [ "$SUPABASE_PROJECT_ID" = "$PROD_PROJECT_ID" ]; then
            echo "::error::the staging project ref equals the production project ref — refusing to push."
            exit 1
          fi
          echo "Staging project ref is distinct from production."

      # PINNED, and deliberately the SAME pin as db-migrate.yml (:152, :249),
      # ops-db-push.yml and maps-ci.yml: if two of those could disagree about how
      # a migration applies, a chain that went green on staging would prove
      # nothing about production. Bump all four together.
      - uses: supabase/setup-cli@v3
        if: steps.gate.outputs.apply == 'true'
        with:
          version: 2.114.0

      - name: Link project
        if: steps.gate.outputs.apply == 'true'
        run: supabase link --project-ref "$SUPABASE_PROJECT_ID"

      # Informational, and `|| true` on purpose: a fresh project with no applied
      # migrations makes this exit non-zero, and that is not a reason to stop.
      - name: Show pending migrations (informational)
        if: steps.gate.outputs.apply == 'true'
        run: supabase migration list --linked || true

      - name: Apply migrations (db push)
        if: steps.gate.outputs.apply == 'true' && inputs.dry_run == false
        run: supabase db push --linked ${{ inputs.include_all && '--include-all' || '' }}

      - name: Nothing applied
        if: steps.gate.outputs.apply == 'true' && inputs.dry_run == true
        run: echo "Dry-run only — listed pending migrations, nothing applied."
```

- [ ] **Step 3: Lint the new workflow before touching `db-migrate.yml`**

```bash
cd /private/tmp/spot-release
/Users/paymax/go/bin/actionlint -no-color -oneline -shellcheck= -pyflakes= .github/workflows/_reusable-db-apply.yml
```

Expected: no output. If actionlint reports `environment:` on a `uses:` caller, the constraint in Global Constraints has been misread — the declaration belongs on the *called* job, which is where it is here.

- [ ] **Step 4: Make `db-migrate.yml` dispatch-only**

Delete the `push:` trigger from `on:` (`:38-40`), leaving only `workflow_dispatch` with its existing `target` / `dry_run` / `include_all` inputs. Read the current `on:` block first and preserve the input definitions verbatim — `release.yml` and this workflow must agree on what `include_all` means.

The result is:

```yaml
on:
  workflow_dispatch:
    inputs:
      target:
        description: 'Which database to apply to'
        required: true
        type: choice
        options: [staging, production]
      dry_run:
        description: 'List pending migrations without applying'
        required: false
        type: boolean
        default: false
      include_all:
        description: 'Apply migrations older than the last applied one too'
        required: false
        type: boolean
        default: false
```

If the live file's input block differs from this in any way, **keep the live file's version** and change only the trigger. The inputs are already correct; the trigger is what is being removed.

- [ ] **Step 5: Rewrite the `db-migrate.yml` header**

Two things in the header become false the moment the push trigger goes:

- `:18` recommends "(Recommended) Configure the `production` environment with required reviewers". Those reviewers were **removed on 2026-11-15** and re-adding them would re-introduce the approval this change exists to remove. Delete the recommendation and replace it with a warning.
- The header explains the push triggers, which no longer exist.

Replace the header's trigger explanation and the reviewer recommendation with:

```yaml
# OPERATOR TOOL ONLY. This workflow no longer fires on a push: release.yml owns
# every automatic apply, one per environment, in the right order relative to the
# code that needs it. What is left here is the manual path — a one-off apply, a
# dry run to see what is pending, or an --include-all repair.
#
# Both routes go through _reusable-db-apply.yml, so there is exactly one way each
# database gets written and one pin (supabase CLI 2.114.0) that writes it.
#
# DO NOT re-add required reviewers to the `production` environment. An earlier
# version of this header recommended it. The reviewers were removed on
# 2026-11-15 as the whole point of the auto-release change
# (docs/superpowers/specs/2026-11-15-auto-deploy-release-pipeline-design.md), and
# a reviewer on `production` would silently re-gate every automatic production
# apply — including from release.yml, because a reusable-workflow job that
# declares `environment:` inherits that environment's protection rules.
```

- [ ] **Step 6: Keep `guard:` — it is a `uses:` caller, not a step container**

The `guard:` job (`:70`) stays byte-identical. It is a two-line caller of `_reusable-migration-guard.yml`, so it holds no steps and has no stale-ref branch to simplify — the "push → skip quietly" branch Step 7 replaces lives inside the two `apply` jobs' "Refuse a stale or unapproved ref" **step**. Do not go looking for it in `guard:`.

Get the required-check attribution right before touching either file. `.github/required-checks.txt:27` lists `migrations (additive-only guard) / guard`, and that name is emitted by **ci.yml's `migration-guard` job** (`ci.yml:126-128`: `name: migrations (additive-only guard)` calling `_reusable-migration-guard.yml`, whose inner job id is `guard`). db-migrate.yml's own `guard:` is `name: additive-only guard`, so it emits `additive-only guard / guard` — a *different*, unrequired check. Keeping it is still correct: with the push trigger gone, this dispatch path is the file's only path, and the additive-only gate should not be the thing that gets dropped from it.

Also verified live, and worth carrying into Task 7: `main`'s branch protection requires five contexts — `backend`, `frontend-admin`, `frontend-web`, `migrations`, `secrets-scan` — and all five are emitted by **ci-optimized.yml**'s inline jobs, not by ci.yml and not by db-migrate.yml. Neither task touches ci-optimized.yml, so neither can orphan a required check. `required-checks.txt` is the longer set `release-gates.py` waits on; the protection set is shorter and differently named. Both resolve against real check-runs on a main push.

- [ ] **Step 7: Extract the stale-ref check into a `fresh:` job with an output**

`db-migrate.yml`'s existing stale-ref guard ("Refuse a stale or unapproved ref") must become an *input to* `skip_apply` rather than a hard failure, because the reusable workflow decides, not the caller. Add a job that emits one output:

```yaml
  fresh:
    name: refuse a stale ref
    runs-on: ubuntu-latest
    outputs:
      stale: ${{ steps.check.outputs.stale }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Is this dispatch still the newest?
        id: check
        env:
          REF_NAME: ${{ github.ref_name }}
          REF_TYPE: ${{ github.ref_type }}
          DRY_RUN: ${{ inputs.dry_run }}
          RUN_SHA: ${{ github.sha }}
        run: |
          set -euo pipefail
          echo "stale=false" >> "$GITHUB_OUTPUT"
          if [ "$REF_TYPE" != "branch" ]; then
            echo "::error::Run ref '$REF_NAME' is a $REF_TYPE, not a branch - dispatch from a branch tip."
            exit 1
          fi
          if [ "$DRY_RUN" != "true" ]; then
            case "$REF_NAME" in
              main|prod) ;;
              *) echo "::error::Applying migrations is only allowed from main or prod (got '$REF_NAME'). Use dry_run for other refs."; exit 1 ;;
            esac
          fi
          TIP=$(git ls-remote origin "refs/heads/$REF_NAME" | cut -f1)
          if [ -z "$TIP" ]; then
            echo "::error::Could not read the tip of origin/$REF_NAME."
            exit 1
          fi
          if [ "$RUN_SHA" = "$TIP" ]; then
            echo "Ref is current: $REF_NAME @ $RUN_SHA"
          else
            echo "stale=true" >> "$GITHUB_OUTPUT"
            echo "::notice::this dispatch is not $REF_NAME's tip ($TIP) — a newer push superseded it. Nothing will be applied."
          fi
```

Two things this literal gets right that a simpler version gets wrong. **Compare against the dispatching ref, never a hardcoded `refs/heads/main`.** The step immediately below allows an apply to be dispatched from `main` *or* `prod`; a hardcoded `main` comparison marks every `prod` dispatch stale, and because staleness now feeds `skip_apply`, that failure is a green no-op — the operator sees a passing run and no migration was applied. **Read `github.*` through `env:`, not by interpolating `${{ }}` into the script body.** `github.sha` is a hex constant so it is not exploitable here, but the habit is what actionlint's expression-injection check exists to catch, and the next person to copy this step may interpolate something that is not a SHA.

`echo "stale=false"` is written FIRST, unconditionally, because an early `exit 1` leaves the output unset and `${{ needs.fresh.outputs.stale == 'true' }}` then reads `'' == 'true'` → false → `skip_apply: false`. That is the safe direction (the hard failure already stopped the job), but writing the default first keeps the value defined on every path.

Preserve whatever additional checks the live stale-ref step performs — read it before replacing anything, and carry its assertions across rather than dropping them. The live step asserts three things beyond staleness: the ref is a branch, an apply comes only from `main`/`prod`, and the tip is readable. All three are in the literal above as hard failures; only staleness became an output.

- [ ] **Step 8: Replace `apply:` and `apply-staging:` with `uses:` callers**

Delete the two job bodies (`:74-176` and `:178-286`) and replace them with:

```yaml
  apply:
    name: supabase db push (production)
    needs: [guard, fresh]
    if: inputs.target == 'production'
    uses: ./.github/workflows/_reusable-db-apply.yml
    permissions:
      contents: read
    # REQUIRED. A reusable workflow does not receive the caller's secrets
    # automatically; without this every secrets.SUPABASE_* below resolves empty.
    # The failure mode is safe — the :?missing guard fires before any db push —
    # but it fails, and it fails looking like a credentials problem.
    secrets: inherit
    with:
      target: production
      dry_run: ${{ inputs.dry_run }}
      include_all: false
      skip_apply: ${{ needs.fresh.outputs.stale == 'true' }}
      skip_reason: 'superseded by a newer push'

  apply-staging:
    name: supabase db push (staging)
    needs: [guard, fresh]
    if: inputs.target == 'staging'
    uses: ./.github/workflows/_reusable-db-apply.yml
    permissions:
      contents: read
    secrets: inherit
    with:
      target: staging
      dry_run: ${{ inputs.dry_run }}
      include_all: ${{ inputs.include_all }}
      skip_apply: ${{ needs.fresh.outputs.stale == 'true' }}
      skip_reason: 'superseded by a newer push'
```

Note the deliberate asymmetry: `include_all` is passed through for **staging only**. Production keeps `include_all: false`, matching today's behaviour — an unattended `--include-all` against production is how an old, superseded migration gets applied out of order.

- [ ] **Step 9: Lint both files and confirm the required-check name still resolves**

```bash
cd /private/tmp/spot-release
/Users/paymax/go/bin/actionlint -no-color -oneline -shellcheck= -pyflakes= \
  .github/workflows/db-migrate.yml .github/workflows/_reusable-db-apply.yml
python3 scripts/ci/test-changed-modules.py
grep -n "supabase db push" .github/required-checks.txt .github/workflows/db-migrate.yml .github/workflows/_reusable-db-apply.yml
```

Expected: no actionlint output; `test-changed-modules.py` prints `ok`; and the grep shows the job *display* name `supabase db push (production)` / `(staging)` now coming from `_reusable-db-apply.yml`'s `name:` interpolation. **The required-check name for the guard is `migrations (additive-only guard) / guard`** — confirm `guard` still exists as a job name in `db-migrate.yml`:

```bash
cd /private/tmp/spot-release && grep -n "^  guard:" .github/workflows/db-migrate.yml
```

Expected: one hit. If the guard job was renamed or removed, `ci.yml`'s required check breaks and every PR blocks.

- [ ] **Step 10: Commit**

```bash
cd /private/tmp/spot-release
git add .github/workflows/_reusable-db-apply.yml .github/workflows/db-migrate.yml
git status --short
git commit -m "$(cat <<'EOF'
ci: one apply path per database, shared by the chain and the operator dispatch

db-migrate.yml's staging apply fires only on a push to the `staging` branch. Once
releases come from main alone and the promotion branches stop receiving work, the
staging schema drifts behind the code being deployed to it — silently, because
nothing compares the two.

Extracting the apply into _reusable-db-apply.yml means release.yml and the
dispatch route run the same steps with the same supabase CLI pin, so a chain that
went green on staging is evidence about production.

The job declares `environment: ${{ inputs.target }}` because a `uses:` caller may
not declare one at all. That also keeps production's SUPABASE_DB_PASSWORD
resolving the way it does today: it is the repo's only environment secret, so
only a job that names the environment can read it, and GitHub's
environment-over-repository precedence is unchanged by the move.

The apply/no-apply decision is a STEP inside a job that always runs, never a
job-level `if:`. A skipped `needs:` dependency makes GitHub skip every job
downstream of it, so an if-skipped migrate would cancel the deploy after it —
which is exactly what a rollback must not do.

db-migrate.yml is dispatch-only now, and its header's recommendation to add
production reviewers is replaced with a warning not to: a reviewer on that
environment would re-gate every automatic production apply, including release.yml's.
EOF
)"
```

Expected: `git status --short` shows exactly the two files.

---

### Task 5: The four Railway scripts, plus `release.yml`'s head, gate and development leg

**Files:**
- Create: `scripts/ci/railway-urls.sh`
- Create: `scripts/ci/frontend-fingerprint.sh`
- Create: `scripts/ci/railway-deploy.sh`
- Create: `scripts/ci/railway-smoke.sh`
- Create: `.github/workflows/release.yml` (this task writes the head, `gates`, `deploy-development`, `smoke-development`; Task 6 appends the staging and production legs)

**Interfaces:**
- Consumes: `scripts/ci/release-gates.py` from Task 3; secrets `RAILWAY_TOKEN_DEVELOPMENT`, `RAILWAY_TOKEN_STAGING`, `RAILWAY_TOKEN_PRODUCTION`; variable `RAILWAY_DEPLOY_ENABLED`.
- Produces:
  - `railway_url <environment> <service>` → an `https://` URL, or empty when the pair is unknown.
  - `frontend-fingerprint.sh <url>` → a 16-char digest, or the literal `no-chunks` / `unreachable`. Exit 0 always.
  - `railway-deploy.sh`, env-driven: required `SERVICE`, `RAILWAY_ENV`, `SHA`, `RAILWAY_TOKEN`, `RAILWAY_PROJECT`; optional `UPLOAD_PATH` (default `''`), `ROOT_FLAG` (default `''`), `BUILD_DIR` (default `''`), `ATTEMPTS` (default `40`). Exit 0 on `SUCCESS`, 1 on `FAILED|CRASHED|REMOVED` or timeout.
  - `railway-smoke.sh`, env-driven: required `SERVICE`, `RAILWAY_ENV`, `SHA`; optional `REQUIRE_READYZ` (default `true`), `EXPECT_FINGERPRINT` (default `''`), `TOUCHED` (default `true`), `SUMMARY` (default `$GITHUB_STEP_SUMMARY` or `/dev/null`).
  - `release.yml` job `gates` outputs, which Task 6 consumes by these exact names: `verdict`, `sha`, `at_main_tip`, and six fingerprints `fp_development_frontend_web`, `fp_development_frontend_admin`, `fp_staging_frontend_web`, `fp_staging_frontend_admin`, `fp_production_frontend_web`, `fp_production_frontend_admin`.

**Why the fingerprint exists at all.** A frontend build echoes no commit anywhere: `frontend-web/next.config` has no `generateBuildId`, and the App Router HTML carries no `buildId` and no `_buildManifest.js` reference (measured against both live production URLs). So a green `railway up` cannot distinguish "the new build is being served" from "the old bytes are still there". The digest of served `/_next/static/chunks/` filenames is the only available signal. This is not theoretical — the cPanel lane shipped a stale build for exactly this reason (`Next 16 .next/server/route-cache` survives `rm:false`).

- [ ] **Step 1: Write `scripts/ci/railway-urls.sh`**

```bash
#!/usr/bin/env bash
# The ONE place a Railway service URL is written down. Sourced by release.yml's
# gate (pre-deploy fingerprints) and by railway-smoke.sh (post-deploy probes), so
# the two can never disagree about which host they are talking about.
#
# Measured 2026-11-15 against project spotlight-platform
# (e7dca861-3667-4d9a-8090-6d2f4d179ec2). Every service in every environment
# reports `source: null`, so a branch push cannot deploy any of them — these hosts
# are written only by `railway up`. ci.yml's header comment claims otherwise; it
# is wrong and Task 7 corrects it.
#
# Usage: railway_url <environment> <service>   -> https URL, or empty
#
# development/frontend-web is included even though its deployment FAILED on
# 2026-11-13: a probe that cannot reach a red host is exactly the evidence that
# says it is still red.

railway_url() {
  case "$1/$2" in
    development/backend)        echo "https://backend-development-502c.up.railway.app" ;;
    development/frontend-admin) echo "https://frontend-admin-development-5a67.up.railway.app" ;;
    development/frontend-web)   echo "https://frontend-web-development.up.railway.app" ;;
    staging/backend)            echo "https://backend-staging-new.up.railway.app" ;;
    staging/frontend-admin)     echo "https://frontend-admin-staging-new.up.railway.app" ;;
    staging/frontend-web)       echo "https://frontend-web-staging-new.up.railway.app" ;;
    production/backend)         echo "https://backend-production-1b33d.up.railway.app" ;;
    production/frontend-admin)  echo "https://frontend-admin-production-5b0c.up.railway.app" ;;
    production/frontend-web)    echo "https://frontend-web-production-9259.up.railway.app" ;;
    *) echo "" ;;
  esac
}
```

Note what is deliberately absent: **`notification-worker` has no URL** (it exposes none — the spec's inventory records `—`) and it gets no entry, because it appears in no deploy matrix (spec Decision H). `staging-Old`'s retired `frontend-admin-…-ade6` host is also absent; that environment is dead and unfixable.

- [ ] **Step 2: Write `scripts/ci/frontend-fingerprint.sh`**

```bash
#!/usr/bin/env bash
# A stable digest of the /_next/static/chunks/ filenames a served HTML page
# references. Two builds of different code produce different chunk names; the
# same build produces the same digest.
#
# This is the ONLY available signal that a frontend deploy actually replaced the
# bytes, because a frontend build echoes no commit anywhere: there is no
# generateBuildId in frontend-web/next.config, and the App Router HTML carries no
# buildId and no _buildManifest.js reference (measured against both live
# production URLs).
#
# Usage: frontend-fingerprint.sh <url>
# Prints the digest, "no-chunks", or "unreachable". NEVER fails: a probe that
# cannot reach a host is a warning, not a release-stopping error. development's
# frontend-web is red today (FAILED 2026-11-13) and must not halt a release.

set -uo pipefail

url="${1:?usage: frontend-fingerprint.sh <url>}"

# -m 30 caps the whole request; -L follows Railway's edge redirect; `|| true`
# keeps a network failure from aborting the caller under `set -e`.
html="$(curl -s -m 30 -L "$url" || true)"
if [ -z "$html" ]; then
  echo unreachable
  exit 0
fi

chunks="$(printf '%s' "$html" | grep -oE '/_next/static/chunks/[A-Za-z0-9._/-]+' | sort -u || true)"
if [ -z "$chunks" ]; then
  echo no-chunks
  exit 0
fi

# sha256sum over the SORTED UNIQUE list, so a reordered <script> block in the
# HTML does not read as a new build. Truncated to 16 chars: this is a change
# detector, not a security hash.
printf '%s\n' "$chunks" | sha256sum | cut -c1-16
```

- [ ] **Step 3: Verify the fingerprint against the three live production/staging hosts**

This is the proof the regex matches what those hosts actually serve, before anything depends on it.

```bash
cd /private/tmp/spot-release
chmod +x scripts/ci/frontend-fingerprint.sh scripts/ci/railway-urls.sh
. scripts/ci/railway-urls.sh
for pair in "production frontend-web" "production frontend-admin" "staging frontend-web" "development frontend-web"; do
  set -- $pair
  path="/"; [ "$2" = frontend-admin ] && path="/admin/login"
  printf '%-22s %s\n' "$1/$2" "$(bash scripts/ci/frontend-fingerprint.sh "$(railway_url "$1" "$2")$path")"
done
```

Expected: a 16-char hex digest for `production/frontend-web`, `production/frontend-admin` and `staging/frontend-web`. `development/frontend-web` may print `unreachable` — that is its known-red state, and it is the reason the development leg does not gate production. If a *production* host prints `no-chunks`, the regex does not match that build's markup: dump one page and fix the pattern before continuing, because every smoke check depends on it.

Run it twice and confirm the digest is **stable** for the same host — an unstable digest would make every smoke check warn spuriously:

```bash
cd /private/tmp/spot-release
. scripts/ci/railway-urls.sh
bash scripts/ci/frontend-fingerprint.sh "$(railway_url production frontend-web)/"
bash scripts/ci/frontend-fingerprint.sh "$(railway_url production frontend-web)/"
```

Expected: two identical values.

- [ ] **Step 4: Write `scripts/ci/railway-deploy.sh`**

This is the extraction of the deploy step from `ci.yml:563`, `ci.yml:659`, `ci.yml:790` and `development-deploy.yml:98` — four copies, three of which are wrong. The header carries every hard-won behaviour so they exist once.

```bash
#!/usr/bin/env bash
# Upload one service to one Railway environment, wait for the deployment to
# settle, and dump a REDACTED crash log when it does not.
#
# Extracted from ci.yml's three deploy jobs and development-deploy.yml, where it
# existed four times and three of the four were wrong. Two behaviours in here were
# each discovered the hard way; they are documented at the point of use so nobody
# "fixes" them back.
#
# Required env:
#   SERVICE          Railway service name (backend | frontend-web | frontend-admin)
#   RAILWAY_ENV      Railway environment (development | staging | production)
#   SHA              the commit being deployed; used as the deployment --message so
#                    the poll below can find THIS deployment among the last ten
#   RAILWAY_TOKEN    per-environment token
#   RAILWAY_PROJECT  e7dca861-3667-4d9a-8090-6d2f4d179ec2
# Optional env:
#   UPLOAD_PATH      positional path for `railway up` ('' = none)
#   ROOT_FLAG        '--path-as-root' or ''
#   BUILD_DIR        when set, $SHA is written to $BUILD_DIR/BUILD_COMMIT first
#   ATTEMPTS         poll attempts, 15s apart (default 40 = 10 minutes)
#   RAILWAY_HTTP_TIMEOUT  set by the caller; the CLI default of 90s truncates the
#                    110 MB frontend-web upload
#
# THE UPLOAD RULE (read before changing UPLOAD_PATH or ROOT_FLAG):
#   backend            -> UPLOAD_PATH=backend        ROOT_FLAG=--path-as-root
#                         Railway builds backend/Dockerfile from the directory
#                         `railway up` uploads, so the upload root must BE backend/.
#   frontend-web       -> UPLOAD_PATH=''             ROOT_FLAG=''
#   frontend-admin     -> UPLOAD_PATH=''             ROOT_FLAG=''
#                         Both frontends carry a Railway `rootDirectory` of their
#                         own folder, so they must be uploaded from the REPO ROOT
#                         with NO positional path at all:
#                           - `railway up .` dies client-side with "prefix not
#                             found" during indexing (a CLI bug with an explicit
#                             `.` when rootDirectory is set);
#                           - `frontend-web --path-as-root` makes Railway look for
#                             `frontend-*/` inside an archive that already IS that
#                             folder.
#                         Only ci.yml's staging matrix ever got this right
#                         (ci.yml:622-637). ci.yml:563, ci.yml:790 and
#                         development-deploy.yml:98 all hardcoded --path-as-root
#                         for every service, which is why development's
#                         frontend-web deployment failed on 2026-11-13.

set -euo pipefail

: "${SERVICE:?required: SERVICE}"
: "${RAILWAY_ENV:?required: RAILWAY_ENV}"
: "${SHA:?required: SHA}"
: "${RAILWAY_TOKEN:?required: RAILWAY_TOKEN}"
: "${RAILWAY_PROJECT:?required: RAILWAY_PROJECT}"
UPLOAD_PATH="${UPLOAD_PATH:-}"
ROOT_FLAG="${ROOT_FLAG:-}"
BUILD_DIR="${BUILD_DIR:-}"
ATTEMPTS="${ATTEMPTS:-40}"

# Never printed, never logged. Referenced only so a missing token fails here with
# a clear name rather than deep inside the CLI.
[ -n "$RAILWAY_TOKEN" ] || { echo "::error::RAILWAY_TOKEN is empty for $RAILWAY_ENV/$SERVICE"; exit 1; }

redact() {
  # Application logs can contain anything, and a raw dump into a job log is how a
  # secret escapes. Both shapes below are real on this repo (a Supabase/JWT bearer
  # and a Paystack key pair).
  sed -E 's#eyJ[A-Za-z0-9._-]{20,}#<jwt-redacted>#g; s#(sk_|pk_)[A-Za-z0-9_-]{10,}#<key-redacted>#g'
}

echo "=== deploying $SERVICE to $RAILWAY_ENV ($SHA) ==="

# Railway builds backend/Dockerfile itself from the uploaded directory, so a
# --build-arg cannot reach it. Writing the SHA into the build context is the way
# in: the Dockerfile reads BUILD_COMMIT and bakes it into the binary via -ldflags,
# and GET /api/v1/public/build then reports it. Without this a deployed server
# cannot say what it is running — /public/health returns the same bytes on every
# build, so it can never distinguish "deployed" from "did not deploy". That is the
# signal railway-smoke.sh reads back.
if [ -n "$BUILD_DIR" ]; then
  printf '%s' "$SHA" > "$BUILD_DIR/BUILD_COMMIT"
  echo "stamped $BUILD_DIR/BUILD_COMMIT"
fi

# $UPLOAD_PATH and $ROOT_FLAG are UNQUOTED ON PURPOSE: an empty value must vanish
# from the argument list, not arrive as an empty-string argument (which the CLI
# reads as a path of ""). See THE UPLOAD RULE above.
# shellcheck disable=SC2086
railway up $UPLOAD_PATH $ROOT_FLAG --no-gitignore \
  --service "$SERVICE" \
  --environment "$RAILWAY_ENV" \
  --project "$RAILWAY_PROJECT" \
  --detach \
  --message "$SHA"

for attempt in $(seq 1 "$ATTEMPTS"); do
  # --limit 10 because the deployment may not be first in the list yet, and
  # `first // {}` so an absent row reads as an empty object rather than null.
  row="$(railway deployment list --service "$SERVICE" --environment "$RAILWAY_ENV" \
          --project "$RAILWAY_PROJECT" --limit 10 --json \
        | jq -c --arg m "$SHA" '[.[] | select(.meta.cliMessage == $m)] | first // {}')"
  status="$(printf '%s' "$row" | jq -r '.status // empty')"
  case "$status" in
    SUCCESS)
      echo "=== $SERVICE/$RAILWAY_ENV deployed $SHA ==="
      exit 0
      ;;
    FAILED|CRASHED|REMOVED)
      echo "::error::$SERVICE/$RAILWAY_ENV deployment ended with $status"
      # This deployment never became the one serving traffic, so
      # `railway logs --deployment` (which targets the CURRENT/active deployment)
      # reports the OLD, still-running deployment's logs — silently pointing at the
      # wrong process.
      #
      # `railway logs --help`: DEPLOYMENT_ID is a bare POSITIONAL argument, not a
      # value for --deployment (which is a BOOLEAN flag selecting deploy-logs over
      # build-logs). `--deployment "$id"` silently failed with "No service linked"
      # because $id was consumed as if it were --deployment's value, leaving
      # --service/--environment/--project all unset. `--latest` ("show logs from
      # the latest deployment, even if it failed or is still building") is simpler
      # and more robust than passing the id at all. DO NOT "fix" this back to the
      # positional form.
      #
      # stderr is KEPT (redacted below, never discarded): a CLI usage error looks
      # identical to "zero log lines exist" otherwise, and those are very different
      # problems to chase.
      railway logs --deployment --latest --service "$SERVICE" \
        --environment "$RAILWAY_ENV" --project "$RAILWAY_PROJECT" \
        --lines 300 > dep.log 2>&1 || true
      echo "  fetched $(wc -l < dep.log) log lines for this deployment"
      SIG='panic:|fatal error|nil pointer|runtime error|goroutine [0-9]+ \[|listen tcp|bind: address already in use|Validate\(\)|refusing to start|exit status|SIGSEGV|SIGABRT'
      if grep -qaiE "$SIG" dep.log; then
        echo "  --- crash signatures (redacted) ---"
        grep -aiE "$SIG" dep.log | tail -60 | redact
      else
        # No known crash signature — most likely a startup HANG that never reached
        # "listening" before Railway's healthcheck timed it out, which prints no
        # panic at all. Show whatever DID print so a stuck init step is visible
        # instead of a bare "no match".
        echo "  no crash signature matched — last lines emitted before the deployment ended:"
        tail -40 dep.log | redact
      fi
      exit 1
      ;;
    *)
      echo "  waiting for $SERVICE/$RAILWAY_ENV (attempt $attempt/$ATTEMPTS; status: ${status:-not-found})"
      sleep 15
      ;;
  esac
done

echo "::error::timed out waiting for the $SERVICE/$RAILWAY_ENV deployment after $((ATTEMPTS * 15))s"
exit 1
```

- [ ] **Step 5: Write `scripts/ci/railway-smoke.sh`**

```bash
#!/usr/bin/env bash
# Read back what an environment is ACTUALLY serving. A green `railway up` proves a
# deployment reached SUCCESS; it does not prove the bytes changed, and for a
# frontend there is no commit echo to read at all.
#
# Required env:
#   SERVICE       backend | frontend-web | frontend-admin
#   RAILWAY_ENV   development | staging | production
#   SHA           the commit that should now be served
# Optional env:
#   REQUIRE_READYZ       'true' (default) makes a non-200 /readyz a FAILURE.
#                        Set 'false' for development: its backend /readyz answers
#                        503 today because its DB pool is unreachable — a
#                        pre-existing condition, unrelated to any release, and a
#                        hard requirement there would halt every release.
#   EXPECT_FINGERPRINT   the pre-deploy frontend digest. Compared, never required.
#   TOUCHED              'true' (default) — this commit changed the service's files,
#                        so an unchanged digest is worth a warning. 'false' means
#                        the digest is expected to be identical and no warning is
#                        emitted.
#   SUMMARY        defaults to $GITHUB_STEP_SUMMARY, else /dev/null

set -uo pipefail

: "${SERVICE:?required: SERVICE}"
: "${RAILWAY_ENV:?required: RAILWAY_ENV}"
: "${SHA:?required: SHA}"
REQUIRE_READYZ="${REQUIRE_READYZ:-true}"
EXPECT_FINGERPRINT="${EXPECT_FINGERPRINT:-}"
TOUCHED="${TOUCHED:-true}"
SUMMARY="${SUMMARY:-${GITHUB_STEP_SUMMARY:-/dev/null}}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Sourced, not copied: the URL table exists in exactly one file so the pre-deploy
# fingerprint and this post-deploy probe cannot disagree about the host.
. "$HERE/railway-urls.sh"

BASE="$(railway_url "$RAILWAY_ENV" "$SERVICE")"
if [ -z "$BASE" ]; then
  echo "::error::no URL recorded for $RAILWAY_ENV/$SERVICE in railway-urls.sh"
  exit 1
fi

note() { printf '%s\n' "$*" >> "$SUMMARY"; }

fail() {
  echo "::error::$*"
  note "- **$SERVICE / $RAILWAY_ENV** — FAILED: $*"
  exit 1
}

code() { curl -s -o /dev/null -w '%{http_code}' -m 30 -L "$1" || echo 000; }

note "### smoke: $SERVICE / $RAILWAY_ENV"
note "- host: $BASE"

case "$SERVICE" in
  backend)
    # POLL, do not read once: the deployment reports SUCCESS before the process has
    # necessarily finished booting (cold start measured at ~25s locally).
    served=""
    for attempt in $(seq 1 20); do
      body="$(curl -s -m 30 "$BASE/api/v1/public/build" || true)"
      served="$(printf '%s' "$body" | jq -r '.commit // empty' 2>/dev/null || true)"
      if [ "$served" = "$SHA" ]; then break; fi
      echo "  attempt $attempt/20 — serving ${served:-<nothing>}, want $SHA"
      sleep 15
    done
    # The build endpoint reports `source: "ldflags"` and the stamped BUILD_COMMIT.
    # If it echoes an older SHA the new image is not the one serving traffic, which
    # is the exact failure a green deployment can hide.
    [ "$served" = "$SHA" ] || fail "serving ${served:-<nothing>} after 5 minutes, expected $SHA"
    started="$(printf '%s' "$body" | jq -r '.started_at // empty' 2>/dev/null || true)"
    uptime="$(printf '%s' "$body" | jq -r '.uptime_seconds // empty' 2>/dev/null || true)"
    note "- served commit: \`$served\`"
    note "- process started: ${started:-unknown} (uptime ${uptime:-unknown}s)"
    echo "backend is serving $SHA (started ${started:-unknown})"

    [ "$(code "$BASE/healthz")" = 200 ] || fail "/healthz did not answer 200"
    note "- /healthz: 200"

    ready="$(code "$BASE/readyz")"
    if [ "$ready" = 200 ]; then
      note "- /readyz: 200"
    elif [ "$REQUIRE_READYZ" = true ]; then
      fail "/readyz answered $ready"
    else
      # Recorded, not failed. development's DB pool is unreachable today.
      echo "::warning::$RAILWAY_ENV backend /readyz answered $ready (not required in $RAILWAY_ENV)"
      note "- /readyz: $ready — warning only, not required in $RAILWAY_ENV"
    fi
    ;;

  frontend-web|frontend-admin)
    path="/"
    [ "$SERVICE" = frontend-admin ] && path="/admin/login"
    got="$(code "$BASE$path")"
    [ "$got" = 200 ] || fail "$path answered $got"
    note "- $path: 200"

    # A frontend echoes no commit, so the digest is the only available evidence.
    now="$(bash "$HERE/frontend-fingerprint.sh" "$BASE$path")"
    note "- chunk fingerprint: \`$now\`${EXPECT_FINGERPRINT:+ (was \`$EXPECT_FINGERPRINT\`)}"

    if [ -n "$EXPECT_FINGERPRINT" ] && [ "$now" = "$EXPECT_FINGERPRINT" ] && [ "$TOUCHED" = true ]; then
      # A WARNING, never a failure: an unchanged digest can also mean the commit
      # touched only server-side code, or that the CDN is still warm. But it must
      # be loud, because for production frontend-web it is the difference between
      # "released" and "still serving October's bytes" — and a mobile store build
      # bakes EXPO_PUBLIC_API_BASE_URL at submission time (eas.json:65), so it
      # cannot be re-pointed without a new submission.
      echo "::warning::$RAILWAY_ENV/$SERVICE still serves the SAME chunks as before this deploy (fingerprint $now). This commit touched $SERVICE's files, so the bytes should have changed."
      note "- **WARNING: the served chunks did not change** even though this commit touched \`$SERVICE\`."
    fi
    ;;

  *)
    fail "unknown service '$SERVICE' — railway-smoke.sh handles backend, frontend-web, frontend-admin"
    ;;
esac

note "- result: PASS"
echo "=== smoke PASS: $SERVICE/$RAILWAY_ENV ==="
```

- [ ] **Step 6: Syntax-check all four scripts and prove the URL table is complete**

```bash
cd /private/tmp/spot-release
chmod +x scripts/ci/railway-urls.sh scripts/ci/frontend-fingerprint.sh \
         scripts/ci/railway-deploy.sh scripts/ci/railway-smoke.sh
for f in scripts/ci/railway-urls.sh scripts/ci/frontend-fingerprint.sh \
         scripts/ci/railway-deploy.sh scripts/ci/railway-smoke.sh; do
  bash -n "$f" && echo "ok  $f"
done
. scripts/ci/railway-urls.sh
for env in development staging production; do
  for svc in backend frontend-web frontend-admin; do
    u="$(railway_url "$env" "$svc")"
    [ -n "$u" ] && echo "ok  $env/$svc -> $u" || echo "MISSING $env/$svc"
  done
done
echo "unknown pair -> '$(railway_url production notification-worker)'"
```

Expected: four `ok` lines, nine `ok  <env>/<svc>` lines, no `MISSING`, and the last line prints an **empty** value — `notification-worker` has no entry by design (spec Decision H), and an empty result is what makes `railway-smoke.sh` fail loudly rather than probe a guessed host.

Also prove the smoke script refuses an unknown pair instead of curling an empty base:

```bash
cd /private/tmp/spot-release
SERVICE=notification-worker RAILWAY_ENV=production SHA=x SUMMARY=/dev/null \
  bash scripts/ci/railway-smoke.sh; echo "exit=$?"
```

Expected: `::error::no URL recorded for production/notification-worker …` and `exit=1`.

- [ ] **Step 7: Write `release.yml`'s head, `gates`, and the development leg**

```yaml
name: Release (main → development, staging, production)

# One push to main releases itself: development, staging and production, with no
# dispatch, no typed DEPLOY, no promotion branch and no human approval. That is the
# whole point of this file — see
# docs/superpowers/specs/2026-11-15-auto-deploy-release-pipeline-design.md.
#
# Removing the approval also removes the human who used to catch a mistake, so
# three things replace them:
#   1. `gates` will not deploy anything until this commit's CI is provably green
#      (scripts/ci/release-gates.py), and A TIMEOUT IS A FAILURE, not a pass.
#   2. Nothing reaches production until staging has been probed and is serving this
#      commit.
#   3. Every stage reads back what the environment is ACTUALLY serving — a green job
#      is not evidence on its own.
# One emergency brake: vars.RAILWAY_DEPLOY_ENABLED. One rollback: dispatch with
# ref=<prior SHA> (plus skip_gates if its check-runs are past retention). A rollback
# deliberately does NOT apply migrations — see the migrate jobs below.
#
# THE DEVELOPMENT LEG DOES NOT GATE PRODUCTION (Decision F). Development's
# frontend-web deployment FAILED on 2026-11-13 and its backend /readyz answers 503
# because its DB pool is unreachable. Both are pre-existing and neither is caused by
# any given commit, so requiring green development would halt every release on them.
# Development failures are reported loudly and DO fail this workflow's overall
# conclusion — but the staging→production leg runs concurrently and completes on its
# own merits. READ THE RUN PAGE, NOT JUST ITS COLOUR.
#
# notification-worker appears in no matrix below, on purpose (Decision H).
# Production's asynq consumer is Render's spotlight-notification-worker
# (render.yaml:76-84) and this chain does not deploy to Render. Adding a Railway
# production worker would put TWO consumers on one queue with the same REDIS_URL and
# double-deliver every push, email and SMS. The production Railway backend does not
# set RUN_WORKERS_INPROCESS and backend/internal/config/config.go:1234 defaults it to
# false, so the web service does not drain the queue in-process either.

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      ref:
        description: 'Commit SHA or branch to release (rollback to a prior main commit)'
        required: false
        default: 'main'
        type: string
      skip_gates:
        description: 'Rollback only — assert CI was green when this SHA was main'
        required: false
        default: 'false'
        type: boolean

permissions:
  contents: read

# NOT cancel-in-progress. ci.yml's group is `ci-<workflow>-<ref>` with
# cancel-in-progress: true, which can kill a deploy mid-upload; a release that the
# next push can cancel leaves a service half-updated. Runs queue instead.
concurrency:
  group: release-main
  cancel-in-progress: false

env:
  RAILWAY_PROJECT: e7dca861-3667-4d9a-8090-6d2f4d179ec2
  # The CLI's default HTTP timeout is 90s. The git-tracked frontend-web payload is
  # 110.0 MB across 2064 files (backend 25.6 MB / 2594, frontend-admin 7.7 MB /
  # 989), which does not upload in 90s.
  RAILWAY_HTTP_TIMEOUT: '600'

jobs:
  gates:
    name: release gate (CI green for this commit)
    if: vars.RAILWAY_DEPLOY_ENABLED == 'true'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      checks: read
      actions: read
    outputs:
      verdict: ${{ steps.gate.outputs.verdict }}
      sha: ${{ steps.resolve.outputs.sha }}
      at_main_tip: ${{ steps.resolve.outputs.at_main_tip }}
      fp_development_frontend_web: ${{ steps.fingerprint.outputs.development_frontend_web }}
      fp_development_frontend_admin: ${{ steps.fingerprint.outputs.development_frontend_admin }}
      fp_staging_frontend_web: ${{ steps.fingerprint.outputs.staging_frontend_web }}
      fp_staging_frontend_admin: ${{ steps.fingerprint.outputs.staging_frontend_admin }}
      fp_production_frontend_web: ${{ steps.fingerprint.outputs.production_frontend_web }}
      fp_production_frontend_admin: ${{ steps.fingerprint.outputs.production_frontend_admin }}
    steps:
      - uses: actions/checkout@v4

      - name: Resolve the commit being released
        id: resolve
        run: |
          set -euo pipefail
          REQUESTED="${{ github.event_name == 'workflow_dispatch' && inputs.ref || github.sha }}"
          case "$REQUESTED" in
            ''|main) SHA=$(git ls-remote origin refs/heads/main | cut -f1) ;;
            *)
              if printf '%s' "$REQUESTED" | grep -Eq '^[0-9a-f]{40}$'; then
                SHA="$REQUESTED"
              else
                SHA=$(git ls-remote origin "refs/heads/$REQUESTED" | cut -f1)
              fi
              ;;
          esac
          if [ -z "$SHA" ]; then
            echo "::error::could not resolve '$REQUESTED' to a commit on origin"
            exit 1
          fi
          TIP=$(git ls-remote origin refs/heads/main | cut -f1)
          if [ "$SHA" = "$TIP" ]; then AT_TIP=true; else AT_TIP=false; fi
          echo "releasing $SHA (main tip: $TIP; at tip: $AT_TIP)"
          echo "sha=$SHA" >> "$GITHUB_OUTPUT"
          echo "at_main_tip=$AT_TIP" >> "$GITHUB_OUTPUT"

      - name: Wait for CI
        id: gate
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          python3 scripts/ci/release-gates.py \
            --sha "${{ steps.resolve.outputs.sha }}" \
            --event "${{ github.event_name }}" \
            ${{ github.event_name == 'workflow_dispatch' && inputs.skip_gates == true && '--skip-gates' || '' }} \
            --repo "${{ github.repository }}" \
            --budget-minutes 75

      # Captured HERE, before any deploy job runs, for two reasons:
      #   - a matrix job's outputs are unreliable (they come from whichever leg
      #     finished last), and the smoke jobs run after the bytes are replaced;
      #   - the comparison is only meaningful against the PRE-deploy state.
      - name: Fingerprint the served frontends (pre-deploy)
        id: fingerprint
        if: steps.gate.outputs.verdict == 'proceed'
        run: |
          set -uo pipefail
          . scripts/ci/railway-urls.sh
          fp() { bash scripts/ci/frontend-fingerprint.sh "$1"; }
          {
            echo "development_frontend_web=$(fp "$(railway_url development frontend-web)/")"
            echo "development_frontend_admin=$(fp "$(railway_url development frontend-admin)/admin/login")"
            echo "staging_frontend_web=$(fp "$(railway_url staging frontend-web)/")"
            echo "staging_frontend_admin=$(fp "$(railway_url staging frontend-admin)/admin/login")"
            echo "production_frontend_web=$(fp "$(railway_url production frontend-web)/")"
            echo "production_frontend_admin=$(fp "$(railway_url production frontend-admin)/admin/login")"
          } >> "$GITHUB_OUTPUT"

  deploy-development:
    name: deploy Development (${{ matrix.service }})
    needs: gates
    if: needs.gates.outputs.verdict == 'proceed'
    runs-on: ubuntu-latest
    environment: development
    strategy:
      # One service being red must not stop the other two being deployed — and
      # development/frontend-web IS red today.
      fail-fast: false
      matrix:
        include:
          # backend uploads its own directory as the root so Railway builds
          # backend/Dockerfile, and BUILD_DIR makes the SHA reachable by that
          # Dockerfile (it bakes BUILD_COMMIT via -ldflags).
          - service: backend
            upload_path: backend
            root_flag: --path-as-root
            build_dir: backend
          # The frontends carry a Railway rootDirectory, so they upload from the
          # repo root with NO positional path and NO --path-as-root. See THE UPLOAD
          # RULE in scripts/ci/railway-deploy.sh.
          - service: frontend-web
            upload_path: ''
            root_flag: ''
            build_dir: ''
          - service: frontend-admin
            upload_path: ''
            root_flag: ''
            build_dir: ''
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ needs.gates.outputs.sha }}
      - uses: actions/setup-node@v7
        with:
          node-version: '20'
      - name: Install Railway CLI
        run: npm install --global @railway/cli@5.40.1
      - name: Deploy ${{ matrix.service }}
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN_DEVELOPMENT }}
          SERVICE: ${{ matrix.service }}
          RAILWAY_ENV: development
          SHA: ${{ needs.gates.outputs.sha }}
          UPLOAD_PATH: ${{ matrix.upload_path }}
          ROOT_FLAG: ${{ matrix.root_flag }}
          BUILD_DIR: ${{ matrix.build_dir }}
        run: bash scripts/ci/railway-deploy.sh

  smoke-development:
    name: smoke Development
    needs: [gates, deploy-development]
    # !cancelled() deliberately opts out of skip-propagation: with a plain `needs:`,
    # a failed matrix leg would skip this job entirely and the services that DID
    # deploy would go unprobed. The verdict test then re-imposes the part we want.
    if: ${{ !cancelled() && needs.gates.outputs.verdict == 'proceed' }}
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        include:
          - service: backend
            require_readyz: 'false'   # 503 today: its DB pool is unreachable
            fingerprint: ''           # unused — the backend branch reads /api/v1/public/build
          - service: frontend-web
            require_readyz: 'true'
            fingerprint: ${{ needs.gates.outputs.fp_development_frontend_web }}
          - service: frontend-admin
            require_readyz: 'true'
            fingerprint: ${{ needs.gates.outputs.fp_development_frontend_admin }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ needs.gates.outputs.sha }}
      - name: Did this commit touch ${{ matrix.service }}?
        id: touched
        run: |
          set -euo pipefail
          case "${{ matrix.service }}" in
            backend) dir=backend ;;
            frontend-web) dir=frontend-web ;;
            frontend-admin) dir=frontend-admin ;;
          esac
          # A fingerprint is only EXPECTED to change when the service's own files
          # changed. Otherwise every unrelated commit warns spuriously and the
          # warning stops meaning anything.
          #
          # `rev-parse --verify <sha>~1` first: on a root commit the `~1` revision
          # does not exist and `git diff` would abort under set -e. An unresolvable
          # parent reads as touched, which is the safe direction — it only decides
          # whether to warn.
          if git rev-parse -q --verify "${{ needs.gates.outputs.sha }}~1" >/dev/null \
             && git diff --quiet "${{ needs.gates.outputs.sha }}~1" "${{ needs.gates.outputs.sha }}" -- "$dir"; then
            echo "touched=false" >> "$GITHUB_OUTPUT"
          else
            echo "touched=true" >> "$GITHUB_OUTPUT"
          fi
      - name: Probe ${{ matrix.service }}
        env:
          SERVICE: ${{ matrix.service }}
          RAILWAY_ENV: development
          SHA: ${{ needs.gates.outputs.sha }}
          REQUIRE_READYZ: ${{ matrix.require_readyz }}
          EXPECT_FINGERPRINT: ${{ matrix.fingerprint }}
          TOUCHED: ${{ steps.touched.outputs.touched }}
        run: bash scripts/ci/railway-smoke.sh
```

- [ ] **Step 8: Lint what exists so far**

Task 6 appends the remaining legs, so `release.yml` is incomplete at this point — but everything written so far must be valid on its own.

```bash
cd /private/tmp/spot-release
for f in scripts/ci/railway-urls.sh scripts/ci/frontend-fingerprint.sh \
         scripts/ci/railway-deploy.sh scripts/ci/railway-smoke.sh; do
  bash -n "$f" && echo "ok  $f"
done
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml')); print('yaml parses')"
/Users/paymax/go/bin/actionlint -no-color -oneline -shellcheck= -pyflakes= .github/workflows/release.yml
```

Expected: four `ok  scripts/…` lines, `yaml parses`, and no actionlint output.

The loop is not stylistic. `bash -n f1 f2 f3 f4` checks **only `f1`** — bash takes
the first non-option argument as the script and the rest become positional
parameters — so the multi-file form prints success even when three of the four are
broken. Steps 6 and Task 9 use the same loop for the same reason.

If `yaml` is not installed locally, skip that one line — actionlint parses the YAML itself and will report a syntax error.

- [ ] **Step 9: Commit (do not push yet — Task 6 completes the file)**

```bash
cd /private/tmp/spot-release
git add scripts/ci/railway-urls.sh scripts/ci/frontend-fingerprint.sh \
        scripts/ci/railway-deploy.sh scripts/ci/railway-smoke.sh \
        .github/workflows/release.yml
git status --short
git commit -m "$(cat <<'EOF'
ci: extract the Railway deploy and smoke behaviour into tested scripts

The deploy step existed four times — ci.yml:563, ci.yml:659, ci.yml:790 and
development-deploy.yml:98 — and three of the four hardcoded --path-as-root for
every service. A frontend with a Railway rootDirectory must be uploaded from the
repo root with no positional path and no --path-as-root; `railway up .` dies
"prefix not found", and `frontend-web --path-as-root` makes Railway look for
frontend-*/ inside an archive that already IS that folder. Only the staging matrix
had it right, which is why development's frontend-web has been red since
2026-11-13.

Two more behaviours now exist once instead of being rediscovered per lane: the
redacted crash-log dump (`--deployment` is a BOOLEAN flag and the id is a bare
positional — `--deployment "$id"` silently failed with "No service linked"), and
the BUILD_COMMIT stamp that makes /api/v1/public/build able to say what a server
is running.

frontend-fingerprint.sh exists because a frontend build echoes no commit anywhere
— no generateBuildId, no buildId or _buildManifest.js in the App Router HTML — so
a green `railway up` cannot distinguish "new build served" from "old bytes still
there". The digest of served /_next/static/chunks/ names is the only signal, and
it is a warning rather than a failure because an unchanged digest can also mean
the commit touched only server-side code.

railway-urls.sh is the single source of host names so the pre-deploy fingerprint
and the post-deploy probe cannot disagree about which host they mean.
notification-worker gets no entry, and an unknown pair returns empty so a probe
fails loudly instead of curling a guessed host.
EOF
)"
```

---

### Task 6: `release.yml`'s staging and production legs

**Files:**
- Modify: `.github/workflows/release.yml` — append six jobs after `smoke-development`

**Interfaces:**
- Consumes: `gates`'s outputs (`verdict`, `sha`, `at_main_tip`, the six `fp_*` fingerprints); `_reusable-db-apply.yml` from Task 4; `railway-deploy.sh` and `railway-smoke.sh` from Task 5.
- Produces: the job names `migrate-staging`, `deploy-staging`, `smoke-staging`, `migrate-production`, `deploy-production`, `smoke-production`. Nothing downstream depends on these names — they are the end of the chain — but Task 9's grep sweep looks for them.

**The ordering is the contract** (spec Goal, and the canonical matrix's checklist item 4 "migrations BEFORE traffic"):

```
gates ─┬─ deploy-development ── smoke-development          (reports, never blocks)
       └─ migrate-staging ── deploy-staging ── smoke-staging
                                                └─ migrate-production ── deploy-production ── smoke-production
```

Nothing reaches production until staging has been **probed** and is **serving the new commit**. That probe is what retires the spec's residual risk: git screening proved no *commit* is missing from `main`, but it cannot prove that where `main` reimplemented something differently it covers every edge case the promotion-branch version did.

**Every job in this leg uses a plain `needs:`** — no `!cancelled()`. A failure here must cascade-skip everything downstream, because that is the mechanism that keeps a broken staging release from reaching production. The development leg opts out of skip-propagation precisely because it must not have that power.

**`gates` belongs in EVERY job's `needs:` list, not only where it orders the chain.** The diagram above draws the ordering edges, and it is easy to read as the whole spec. It is not. Every one of these jobs reads `needs.gates.outputs.verdict` in its `if:` (and several read `sha` / `at_main_tip` / `fp_*`), and GitHub resolves `needs.X` **only for jobs in your own `needs:` list** — a `needs:` of just `migrate-staging` gives you `{migrate-staging: {outputs: {}, result: string}}`, with no `gates` key in it at all. The ordering ancestors of `gates` do not put it in scope transitively.

On a runner that reference evaluates to empty, so `needs.gates.outputs.verdict == 'proceed'` is false on a fully green run and the staging and production legs **never execute** — the release reports success having deployed nothing past development. actionlint catches it, and catches it loudly:

```
property "gates" is not defined in object type {migrate-staging: {outputs: {}; result: string}} [expression]
```

That is why `deploy-staging` needs `[gates, migrate-staging]` rather than `[migrate-staging]`, and likewise `migrate-production` and `deploy-production`. The extra edge costs nothing — `gates` is already a transitive ancestor, so it cannot change the order or the skip behaviour — and it is the only spelling that both lints and works. Step 5 checks this mechanically; do not rely on having remembered all three.

- [ ] **Step 1: Append the staging migrate + deploy + smoke jobs**

```yaml
  migrate-staging:
    name: migrate staging database
    needs: gates
    if: needs.gates.outputs.verdict == 'proceed'
    uses: ./.github/workflows/_reusable-db-apply.yml
    permissions:
      contents: read
    # REQUIRED — a reusable workflow receives no caller secrets without it.
    secrets: inherit
    with:
      target: staging
      dry_run: false
      include_all: false
      # A ROLLBACK DOES NOT MIGRATE. `supabase db push --linked` against a remote
      # that already holds newer versions aborts with "remote migration versions
      # not found in local migrations directory" — the exact failure db-migrate.yml's
      # stale-ref guard exists to prevent. So the apply no-ops when the target SHA
      # is not main's tip, and the code is still rolled back.
      #
      # The no-op is an INPUT to a step inside a job that always runs, never a
      # job-level `if:`. A skipped `needs:` dependency makes GitHub skip every job
      # downstream of it — an if-skipped migrate would cancel the deploy after it,
      # and a rollback would deploy nothing at all.
      skip_apply: ${{ needs.gates.outputs.at_main_tip != 'true' }}
      skip_reason: 'not main tip — an older supabase/migrations tree makes db push abort with remote-versions-not-found'

  deploy-staging:
    name: deploy Staging (${{ matrix.service }})
    needs: [gates, migrate-staging]
    if: needs.gates.outputs.verdict == 'proceed'
    runs-on: ubuntu-latest
    environment: staging
    strategy:
      # Unlike development, fail-fast is acceptable here — but it is still set false
      # so one red service produces a complete picture instead of two cancelled
      # legs and a guess about which one actually broke.
      fail-fast: false
      matrix:
        include:
          - service: backend
            upload_path: backend
            root_flag: --path-as-root
            build_dir: backend
          # Frontends: NO positional path, NO --path-as-root. This is the shape
          # ci.yml's staging matrix already had right (ci.yml:622-637); the
          # development and production matrices hardcoded the flag instead.
          - service: frontend-web
            upload_path: ''
            root_flag: ''
            build_dir: ''
          - service: frontend-admin
            upload_path: ''
            root_flag: ''
            build_dir: ''
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ needs.gates.outputs.sha }}
      - uses: actions/setup-node@v7
        with:
          node-version: '20'
      - name: Install Railway CLI
        run: npm install --global @railway/cli@5.40.1
      - name: Deploy ${{ matrix.service }}
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN_STAGING }}
          SERVICE: ${{ matrix.service }}
          RAILWAY_ENV: staging
          SHA: ${{ needs.gates.outputs.sha }}
          UPLOAD_PATH: ${{ matrix.upload_path }}
          ROOT_FLAG: ${{ matrix.root_flag }}
          BUILD_DIR: ${{ matrix.build_dir }}
        run: bash scripts/ci/railway-deploy.sh

  smoke-staging:
    name: smoke Staging
    needs: [gates, deploy-staging]
    if: needs.gates.outputs.verdict == 'proceed'
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        include:
          - service: backend
            require_readyz: 'true'
            fingerprint: ''
          - service: frontend-web
            require_readyz: 'true'
            fingerprint: ${{ needs.gates.outputs.fp_staging_frontend_web }}
          - service: frontend-admin
            require_readyz: 'true'
            fingerprint: ${{ needs.gates.outputs.fp_staging_frontend_admin }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ needs.gates.outputs.sha }}
      - name: Did this commit touch ${{ matrix.service }}?
        id: touched
        run: |
          set -euo pipefail
          case "${{ matrix.service }}" in
            backend) dir=backend ;;
            frontend-web) dir=frontend-web ;;
            frontend-admin) dir=frontend-admin ;;
          esac
          if git rev-parse -q --verify "${{ needs.gates.outputs.sha }}~1" >/dev/null \
             && git diff --quiet "${{ needs.gates.outputs.sha }}~1" "${{ needs.gates.outputs.sha }}" -- "$dir"; then
            echo "touched=false" >> "$GITHUB_OUTPUT"
          else
            echo "touched=true" >> "$GITHUB_OUTPUT"
          fi
      # THIS JOB IS THE GATE ON PRODUCTION. `smoke-production`'s ancestors include
      # it, so a staging probe that fails — wrong commit served, /readyz red, or a
      # frontend that answers anything but 200 — cascade-skips the entire production
      # leg. Do not weaken it to a warning.
      - name: Probe ${{ matrix.service }}
        env:
          SERVICE: ${{ matrix.service }}
          RAILWAY_ENV: staging
          SHA: ${{ needs.gates.outputs.sha }}
          REQUIRE_READYZ: ${{ matrix.require_readyz }}
          EXPECT_FINGERPRINT: ${{ matrix.fingerprint }}
          TOUCHED: ${{ steps.touched.outputs.touched }}
        run: bash scripts/ci/railway-smoke.sh
```

- [ ] **Step 2: Append the production migrate + deploy + smoke jobs**

```yaml
  migrate-production:
    name: migrate production database
    # `smoke-staging`, not `deploy-staging`: the probe is what proves staging is
    # serving this commit, and that proof is the precondition for touching
    # production. A plain `needs:` means a red staging probe cascade-skips this job
    # and everything after it.
    needs: [gates, smoke-staging]
    if: needs.gates.outputs.verdict == 'proceed'
    uses: ./.github/workflows/_reusable-db-apply.yml
    permissions:
      contents: read
    secrets: inherit
    with:
      target: production
      dry_run: false
      # NEVER true for production. An unattended --include-all is how an old,
      # superseded migration gets applied out of order. db-migrate.yml keeps the
      # input for an operator who has decided to use it deliberately.
      include_all: false
      skip_apply: ${{ needs.gates.outputs.at_main_tip != 'true' }}
      skip_reason: 'not main tip — an older supabase/migrations tree makes db push abort with remote-versions-not-found'

  deploy-production:
    name: deploy Production (${{ matrix.service }})
    needs: [gates, migrate-production]
    if: needs.gates.outputs.verdict == 'proceed'
    runs-on: ubuntu-latest
    environment: production
    strategy:
      fail-fast: false
      matrix:
        include:
          - service: backend
            upload_path: backend
            root_flag: --path-as-root
            build_dir: backend
          # production/frontend-web on Railway is NOT an orphan and NOT the same
          # thing as www.spotlightng.com. The cPanel lane (sync-frontend-web.yml →
          # paymax2022/spotlight-latest) serves the customer domain; this service is
          # the BFF that mobile-app/reactnative/eas.json:65 bakes into the shipped
          # build's EXPO_PUBLIC_API_BASE_URL (and production-apk inherits it at :72),
          # and that frontend-admin's production WEB_API_BASE_URL also points at.
          # Nothing in the release chain updated it before this file.
          - service: frontend-web
            upload_path: ''
            root_flag: ''
            build_dir: ''
          - service: frontend-admin
            upload_path: ''
            root_flag: ''
            build_dir: ''
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ needs.gates.outputs.sha }}
      - uses: actions/setup-node@v7
        with:
          node-version: '20'
      - name: Install Railway CLI
        run: npm install --global @railway/cli@5.40.1
      - name: Deploy ${{ matrix.service }}
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN_PRODUCTION }}
          SERVICE: ${{ matrix.service }}
          RAILWAY_ENV: production
          SHA: ${{ needs.gates.outputs.sha }}
          UPLOAD_PATH: ${{ matrix.upload_path }}
          ROOT_FLAG: ${{ matrix.root_flag }}
          BUILD_DIR: ${{ matrix.build_dir }}
        run: bash scripts/ci/railway-deploy.sh

  smoke-production:
    name: smoke Production
    needs: [gates, deploy-production]
    if: needs.gates.outputs.verdict == 'proceed'
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        include:
          - service: backend
            require_readyz: 'true'
            fingerprint: ''
          - service: frontend-web
            require_readyz: 'true'
            fingerprint: ${{ needs.gates.outputs.fp_production_frontend_web }}
          - service: frontend-admin
            require_readyz: 'true'
            fingerprint: ${{ needs.gates.outputs.fp_production_frontend_admin }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ needs.gates.outputs.sha }}
      - name: Did this commit touch ${{ matrix.service }}?
        id: touched
        run: |
          set -euo pipefail
          case "${{ matrix.service }}" in
            backend) dir=backend ;;
            frontend-web) dir=frontend-web ;;
            frontend-admin) dir=frontend-admin ;;
          esac
          if git rev-parse -q --verify "${{ needs.gates.outputs.sha }}~1" >/dev/null \
             && git diff --quiet "${{ needs.gates.outputs.sha }}~1" "${{ needs.gates.outputs.sha }}" -- "$dir"; then
            echo "touched=false" >> "$GITHUB_OUTPUT"
          else
            echo "touched=true" >> "$GITHUB_OUTPUT"
          fi
      - name: Probe ${{ matrix.service }}
        env:
          SERVICE: ${{ matrix.service }}
          RAILWAY_ENV: production
          SHA: ${{ needs.gates.outputs.sha }}
          REQUIRE_READYZ: ${{ matrix.require_readyz }}
          EXPECT_FINGERPRINT: ${{ matrix.fingerprint }}
          TOUCHED: ${{ steps.touched.outputs.touched }}
        run: bash scripts/ci/railway-smoke.sh
```

- [ ] **Step 3: Lint the complete workflow**

```bash
cd /private/tmp/spot-release
/Users/paymax/go/bin/actionlint -no-color -oneline -shellcheck= -pyflakes= .github/workflows/release.yml && echo "actionlint clean"
```

Expected: `actionlint clean`. Two failures are worth expecting and both mean a real mistake:
- `"environment" is not allowed in a job that calls a reusable workflow` → an `environment:` key landed on a `uses:` caller. Remove it; the called job declares it.
- `workflow "…/_reusable-db-apply.yml" …` not found → Task 4's file is missing or misnamed.

- [ ] **Step 4: Verify the dependency graph is the contract, mechanically**

A `needs:` typo silently reorders the chain — e.g. `deploy-production` needing `deploy-staging` instead of `smoke-staging` would let an unprobed staging release straight through to production. Check the edges:

```bash
cd /private/tmp/spot-release
python3 - <<'PY'
import yaml, sys
d = yaml.safe_load(open('.github/workflows/release.yml'))
jobs = d['jobs']
want = {
    'gates': [],
    'deploy-development': ['gates'],
    'smoke-development': ['gates', 'deploy-development'],
    'migrate-staging': ['gates'],
    'deploy-staging': ['gates', 'migrate-staging'],
    'smoke-staging': ['gates', 'deploy-staging'],
    'migrate-production': ['gates', 'smoke-staging'],
    'deploy-production': ['gates', 'migrate-production'],
    'smoke-production': ['gates', 'deploy-production'],
}
bad = []
if set(jobs) != set(want):
    bad.append(f"job set differs: extra={set(jobs)-set(want)} missing={set(want)-set(jobs)}")
for name, needs in want.items():
    got = jobs.get(name, {}).get('needs', [])
    got = [got] if isinstance(got, str) else list(got)
    if sorted(got) != sorted(needs):
        bad.append(f"{name}: needs {sorted(got)}, want {sorted(needs)}")
    if 'uses' in jobs.get(name, {}) and 'environment' in jobs[name]:
        bad.append(f"{name}: a uses: caller may NOT declare environment:")
    if 'uses' in jobs.get(name, {}) and jobs[name].get('secrets') != 'inherit':
        bad.append(f"{name}: a uses: caller MUST carry `secrets: inherit`")
# No job may depend on a development job: that leg must not gate production.
for name, needs in want.items():
    if name.startswith(('migrate-', 'deploy-staging', 'smoke-staging', 'deploy-production', 'smoke-production')):
        for n in needs:
            if 'development' in n:
                bad.append(f"{name} depends on {n} — the development leg must never gate production")
if bad:
    print("FAIL"); [print("  " + b) for b in bad]; sys.exit(1)
print(f"ok — {len(jobs)} jobs, dependency graph matches the contract")
PY
```

Expected: `ok — 9 jobs, dependency graph matches the contract`.

If `yaml` is not installed locally, run the same check in CI instead — but do not skip it. This is the one assertion that proves production sits behind a staging probe.

- [ ] **Step 5: Verify the migration ordering is provable from the graph**

Checklist item 4 is "migrations BEFORE traffic". Confirm no deploy job can start before its environment's migrate job — and, in the same pass, that every job reading `needs.gates.outputs.*` actually declares `gates`:

```bash
cd /private/tmp/spot-release
python3 - <<'PY'
import yaml, sys
jobs = yaml.safe_load(open('.github/workflows/release.yml'))['jobs']

def needs(name):
    v = jobs[name].get('needs', [])
    return [v] if isinstance(v, str) else list(v)

bad = []
for a, b in [('deploy-staging', 'migrate-staging'),
             ('migrate-production', 'smoke-staging'),
             ('deploy-production', 'migrate-production')]:
    if b not in needs(a):
        bad.append(f"{a} does not need {b} — migration ordering is not provable")
for name, body in jobs.items():
    if 'needs.gates.outputs' in yaml.dump(body) and 'gates' not in needs(name):
        bad.append(f"{name} reads needs.gates but does not declare needs: gates")
if bad:
    print("FAIL"); [print("  " + b) for b in bad]; sys.exit(1)
print(f"ok — {len(jobs)} jobs: ordering provable, every needs.gates reader declares gates")
PY
```

Expected: `ok — 9 jobs: ordering provable, every needs.gates reader declares gates`.

Do not "simplify" this back to a `grep -n "needs: migrate-staging" …`. It was one, and it silently matched **zero** lines the moment the lists became flow style — a grep that finds nothing here reads as "edge dropped", which is the opposite of the failure it is supposed to detect. Parse the YAML.

- [ ] **Step 6: Commit**

```bash
cd /private/tmp/spot-release
git add .github/workflows/release.yml
git status --short
git commit -m "$(cat <<'EOF'
ci: add the staging -> production legs to release.yml

Nothing reaches production until staging has been probed AND is serving the new
commit: migrate-production needs smoke-staging, not deploy-staging. With plain
`needs:` on every job in this leg, a red staging probe cascade-skips the whole
production half — which is the mechanism that replaces the human who used to read
the staging URL before typing DEPLOY.

The development leg opts OUT of that cascade with !cancelled(), because
development/frontend-web has been red since 2026-11-13 and its backend /readyz
answers 503 on an unreachable DB pool. Both are pre-existing; gating production on
them would halt every release on a failure no commit caused. Development failures
still fail the workflow's overall conclusion — read the run page, not its colour.

A rollback deliberately does not apply migrations: db push against a remote holding
newer versions aborts with "remote migration versions not found in local
migrations directory". The no-op is an input to a step inside a job that always
runs, never a job-level `if:` — a skipped needs dependency makes GitHub skip every
job downstream, so an if-skipped migrate would cancel the rollback's own deploy.

production/frontend-web is in the matrix on purpose. It is not the cPanel instance
that serves www.spotlightng.com; it is the BFF that eas.json:65 bakes into the
shipped mobile build's EXPO_PUBLIC_API_BASE_URL and that frontend-admin's
production WEB_API_BASE_URL points at, and nothing updated it before this file.
EOF
)"
```

---

### Task 7: Strip the deploy jobs out of `ci.yml` and retire `development-deploy.yml`

**Files:**
- Modify: `.github/workflows/ci.yml` (805 lines on `6199a6b57`, **811** by the time this task runs because Task 3 added 6 → **491** after the delete)
- Delete: `.github/workflows/development-deploy.yml` (137 lines)

**Interfaces:**
- Consumes: nothing new. `release.yml` (Tasks 5-6) must already exist in the same commit — this task removes the only other writers, and the canonical matrix forbids two live writers for one service-environment pair (checklist item 2, `deployment-matrix.md:89`).
- Produces: a `ci.yml` whose required-check names are unchanged, so `.github/required-checks.txt` needs no edit and no PR blocks.

**Order matters.** Tasks 5 and 6 must be committed before this one. Deleting the deploy jobs first would leave a window where nothing deploys at all — harmless on a feature branch, but if the two were split across PRs it would be a real outage of the release path.

**EVERY `ci.yml` LINE NUMBER IN THIS TASK IS A `6199a6b57` NUMBER, AND THE FILE HAS ALREADY MOVED.** Task 3 inserted **6 lines** into the `secret-hygiene` job (4 comment lines + `- name: Test the release gate` + `run:`) immediately after `test-changed-modules.py` at `:187`. So by the time this task runs, the file is **811 lines, not 805**, and every citation below `:187` is **+6**: the deploy comment starts at `:492`, `deploy-development:` is at `:495`, `deploy-staging:` at `:586`, `deploy-production:` at `:727`. Citations *above* `:187` are unchanged (`:23-24`, `:27-29`, `:43-49`, `:57-70`, `:152-153`).

Do not run any `sed` in this task from a number in this document. Steps 1-3 below compute the span from content anchors and assert on it; Steps 4-7 say "read the block, then edit" and are anchored on text, so their stale numbers are signposts only. If a grep returns a different number than the one printed here, the grep wins.

- [ ] **Step 1: Compute the delete span from content, not from a line number**

```bash
cd /private/tmp/spot-release
grep -n "^  deploy-development:\|^  deploy-staging:\|^  deploy-production:\|^  workflow-lint:\|^  changes:" .github/workflows/ci.yml
wc -l .github/workflows/ci.yml
```

Expected: `workflow-lint:` `:467`, `deploy-development:` **`:495`**, `deploy-staging:` **`:586`**, `deploy-production:` **`:727`**, file length **811**. On a pristine `6199a6b57` checkout the same greps return `:489` / `:580` / `:721` and 805 — if you see *those*, Task 3's step never landed, so stop and check `git log` before deleting anything.

Then derive the first line of the block mechanically. The block starts at the **comment** above `deploy-development:`, not at the job keyword:

```bash
cd /private/tmp/spot-release
DD=$(grep -n "^  deploy-development:" .github/workflows/ci.yml | cut -d: -f1)
START=$(awk -v dd="$DD" 'NR<dd { line[NR]=$0 } NR==dd { s=dd-1; while (s>=1 && line[s] ~ /^[[:space:]]*#/) s--; print s+1 }' .github/workflows/ci.yml)
echo "deploy-development at $DD; delete from $START to EOF ($(wc -l < .github/workflows/ci.yml))"
sed -n "$((START-3)),$((DD+1))p" .github/workflows/ci.yml
```

Expected: `START` is 3 lines above `DD` (`:492` given `:495`), and the printed window shows the tail of the `workflow-lint` job (`run: actionlint …`), a blank line, then a **comment** explaining that Railway deployment is deliberately manual, then `deploy-development:`. The comment belongs to the deploy block and must be deleted with it — leaving it behind would be a stale claim that deployment is manual, sitting in a file that no longer deploys.

**Why this `awk` looks the way it does — a defect in the first version of this step.** The original one-liner tracked two independent variables, `last` (last comment line seen before `dd`) and `last_blank` (last blank line seen before `dd`), and printed whichever was larger. That is the wrong question. It answers "where is the last comment before the job?", not "where does this comment block *start*?", so on the real file it returned **`:494`**, the *last* line of the 3-line comment, and `sed "${START},\$d"` would have deleted the comment's final line while leaving its first two lines — `# Railway deployment is deliberately manual. The repository variable remains` and its continuation — stranded at the new EOF of `ci.yml`, immediately after the `workflow-lint` job's last line. A file that ends by asserting deployment is manual, right after its final job, is worse than no comment at all: it is a lie that reads like documentation. The version above walks *backwards* from `dd` across the run of contiguous comment lines and prints the first one, which is the span's real start. Measured against the `6199a6b57` blob (`DD=495`): `START=492`, 320 lines deleted, 491 left, and the first deleted line is the comment's first line. Negative control — the same `awk` on a file with no comment above the job — returns `START == dd`, i.e. it deletes from the job keyword and invents nothing.

- [ ] **Step 2: Confirm the line above the block must SURVIVE**

```bash
cd /private/tmp/spot-release
sed -n "$((START-2)),$((START))p" .github/workflows/ci.yml
```

Expected: the `workflow-lint` job's `run: actionlint -no-color -oneline -shellcheck= -pyflakes=` line, then a blank line, then the first comment line of the block. If the `run:` line is *inside* the span you are about to delete, `START` is wrong — do not proceed.

- [ ] **Step 3: Delete from `START` to EOF**

```bash
cd /private/tmp/spot-release
cp .github/workflows/ci.yml /tmp/ci.yml.bak
sed -i '' "${START},\$d" .github/workflows/ci.yml
wc -l .github/workflows/ci.yml
tail -5 .github/workflows/ci.yml
```

Expected: **491 lines** (811 − 320; the pristine-file equivalent is 485 = 805 − 320), and the tail is the `workflow-lint` job's `run: actionlint -no-color -oneline -shellcheck= -pyflakes=` line. If the tail shows anything else, the span was wrong — restore and re-derive:

```bash
cd /private/tmp/spot-release && cp /tmp/ci.yml.bak .github/workflows/ci.yml
```

`sed -i ''` is the BSD/macOS form. On a Linux runner or worktree it is `sed -i`. Confirm which applies before running. `START` must be exported or re-derived in the same shell invocation as the `sed` — a fresh Bash tool call starts a new shell and `$START` will be empty, which turns `${START},$d` into `,$d` and deletes the whole file. If you are in a new shell, re-run Step 1's `awk` first and check `echo "$START"` is non-empty before the `sed`.

- [ ] **Step 4: Verify nothing else in the file referenced the deleted jobs**

The `secret-hygiene` job's comment at `:152-153` says the deploy jobs reference it in `needs:`. That is now false:

```bash
cd /private/tmp/spot-release
grep -n "secret-hygiene\|prod-flag-parity\|migration-guard\|workflow-lint" .github/workflows/ci.yml
```

Expected: each name appears as its own job definition, plus the stale comment. Read `:150-156` and rewrite the comment so it no longer claims a consumer that is gone:

```yaml
  # Both of these are REQUIRED CHECKS (.github/required-checks.txt), so a PR cannot
  # merge while they are red. release.yml additionally waits on them before it will
  # deploy anything — the required-check names are the contract between CI and the
  # release chain, so renaming either job renames a required check and blocks every
  # PR until required-checks.txt is updated in the same commit.
```

- [ ] **Step 5: Remove the two dispatch inputs**

`ci.yml` no longer deploys, so `deploy_environment` and `confirm_deploy` (`:57-70`) are dead inputs. Read the block, then leave a bare `workflow_dispatch:` — some lanes may still be dispatched by hand for a re-run, and removing the trigger entirely would take that away:

```yaml
  # Kept as a bare trigger: dispatching ci.yml re-runs the CI lanes by hand. It no
  # longer takes inputs — deployment moved to release.yml, which is where the
  # dispatch-with-a-ref rollback input lives now.
  workflow_dispatch:
```

- [ ] **Step 6: Narrow the branch triggers**

`ci.yml`'s push trigger is `branches: [develop, staging, prod, main]` (`:43-44`) and its `pull_request` trigger names the same promotion branches (`:48-49`). Once releases come from `main` alone and the promotion branches stop receiving work, those three entries only ever fire on a stale merge — burning minutes to test a tree nobody deploys.

```bash
cd /private/tmp/spot-release && sed -n '38,52p' .github/workflows/ci.yml
```

Then change both to `[main]`, preserving `paths-ignore` exactly as it is (`:45-47` — `['**.md', 'docs/**']`, which is what makes `noop_docs_only` a real verdict in `release-gates.py`):

```yaml
on:
  push:
    branches: [main]
    # A docs-only push produces ZERO check-runs, and release-gates.py treats that
    # as the verdict `noop_docs_only` rather than a timeout. Removing this filter
    # would make that verdict unreachable — keep the two in step.
    paths-ignore:
      - '**.md'
      - 'docs/**'
  pull_request:
    branches: [main]
```

- [ ] **Step 7: Correct the stale header claim**

`ci.yml:27-29` asserts a mechanism that does not exist:

> "Railway performs native GitHub deployments from these branches after its per-environment branch mapping is configured: develop -> Development, staging -> Staging, prod -> Production."

No such mapping is configured — every service in every environment reports `source: null` (measured 2026-11-15), so a branch push cannot deploy anything and `railway up` is the only route. `:23-24` also says "Railway deployment is deliberately manual", which stops being true the moment PR B merges. Read `:20-32` and replace both claims:

```yaml
  # CI ONLY. This workflow deploys nothing. Deployment lives in release.yml, which
  # fires on every push to main and drives development, staging and production from
  # that one commit.
  #
  # An earlier header here claimed Railway performs native GitHub deployments from
  # develop/staging/prod once "its per-environment branch mapping is configured". It
  # never was: every service in every environment reports `source: null`, so a
  # branch push cannot deploy anything and `railway up` is the only route. That
  # sentence sent at least one reader looking for a mapping that does not exist.
  #
  # What this file owns is the evidence release.yml waits on: the required checks in
  # .github/required-checks.txt. release-gates.py polls those names before it will
  # let anything deploy, so a rename here is a rename of a required check.
```

- [ ] **Step 8: Delete `development-deploy.yml`**

It deploys `backend` and `frontend-admin` from `main` to Development under a dispatch, which `release.yml`'s development leg now does on every push. Keeping both would be two live writers for one service-environment pair — checklist item 2 (`deployment-matrix.md:89`).

```bash
cd /private/tmp/spot-release
grep -n "environment: development\|railway up" .github/workflows/development-deploy.yml
git rm .github/workflows/development-deploy.yml
```

Expected before the `git rm`: `environment: development` at `:52` and `railway up "$SERVICE" --path-as-root --no-gitignore` at `:98` — the third hardcoded `--path-as-root` the spec records. Confirm the file is gone and staged:

```bash
cd /private/tmp/spot-release && git status --short
```

Expected: `D  .github/workflows/development-deploy.yml`.

- [ ] **Step 9: Prove the required checks all still resolve**

This is the assertion that keeps every PR in the repo from blocking. `scripts/ci/test-changed-modules.py` already checks that every required check's caller name (the text before `" / "`) appears as a `name:` in ci.yml, and that ci.yml calls ≤20 unique reusables.

```bash
cd /private/tmp/spot-release
python3 scripts/ci/test-changed-modules.py
for n in "backend (go build + vet)" "frontend-admin (type-check)" "frontend-web (regression + money + contract + tsc + lint)" "hygiene (client secrets + live-DB test gate + migration versions)" "mobile (whole-app tsc)" "openapi (validate all contracts)" "which modules changed" "workflows (actionlint)"; do
  printf '%-70s ' "$n"
  grep -qF "name: $n" .github/workflows/ci.yml && echo present || echo "MISSING"
done
```

Expected: `ok — …` from the test, and `present` for all eight. (`migrations (additive-only guard)` comes from `db-migrate.yml`, not ci.yml — Task 4 Step 9 already proved it survives.) Any `MISSING` means Step 3's span was wrong: restore from `/tmp/ci.yml.bak` and re-derive it from the job names rather than the line numbers.

- [ ] **Step 10: Lint the whole workflow directory**

```bash
cd /private/tmp/spot-release
/Users/paymax/go/bin/actionlint -no-color -oneline -shellcheck= -pyflakes= && echo "all workflows clean"
```

Expected: `all workflows clean`. Running it with no path argument lints every file under `.github/workflows/`, which is what the CI gate does (`ci.yml:484`) — so this is the same command the gate will run.

- [ ] **Step 11: Commit**

```bash
cd /private/tmp/spot-release
git add .github/workflows/ci.yml
git status --short
git commit -m "$(cat <<'EOF'
ci: return ci.yml to CI only and retire development-deploy.yml

The three deploy jobs (deploy-development, deploy-staging, deploy-production) move to
release.yml, which fires on
every push to main instead of requiring a dispatch, a typed DEPLOY and a promotion
branch that is not main. Keeping both would be two live writers for one
service-environment pair, which the deployment matrix's own checklist forbids.

development-deploy.yml goes for the same reason: it deployed backend and
frontend-admin from main to Development under a dispatch, which the release chain
now does unattended. It also carried the third hardcoded --path-as-root — the flag
that makes Railway look for frontend-*/ inside an archive that already IS that
folder.

Two stale claims are corrected while the file is open, because both send the next
reader looking for a mechanism that does not exist: the header's "Railway performs
native GitHub deployments from these branches" (every service reports source: null,
so a branch push deploys nothing), and the secret-hygiene comment's "the deploy jobs
below reference it in needs:" (they no longer exist).

The push and pull_request triggers narrow to [main]. develop/staging/prod stop
receiving work once releases come from main alone, so those entries only ever fired
on a stale merge. paths-ignore is preserved verbatim — it is what makes
release-gates.py's noop_docs_only verdict reachable.

No required-check name changes, so .github/required-checks.txt is untouched and no
open PR blocks. test-changed-modules.py proves it.
EOF
)"
```

---

### Task 8: Bring the docs in line — matrix first, then the runbooks

**Files:**
- Modify: `docs/devops/deployment-matrix.md` (canonical — goes first)
- Modify: `docs/launch/BRANCH-PROTECTION.md`
- Modify: `docs/devops/DEPLOY-RUNBOOK.md`
- Modify: `docs/devops/production-migration-ledger.md`

**Interfaces:**
- Consumes: PR A's matrix sections (the do-not-merge record, the Render worker record, the `release.yml` row marked **Pending**). If PR A has not merged, these edits have no base — stop and say so rather than re-deriving them here.
- Produces: docs that describe what the merged code actually does. Nothing reads them at runtime; they are what the next operator follows.

**SCOPE, as executed.** Steps 7's three runbooks and the `CLAUDE_CODE_DEVELOPMENT_HANDOFF.md` recipe shipped ahead of PR A, in PR B itself (`f9e612085`), because those files describe a procedure Task 7 deletes and PR A does not touch them — leaving them meant publishing a doc that tells an operator to type `DEPLOY` into an input that no longer exists. What is left for this task is `deployment-matrix.md` alone: Steps 1-6 plus Step 8's re-verification. The matrix is the one file whose edits need PR A's base, so the split is exactly along the dependency.

**Why the matrix goes first.** `docs/devops/deployment-matrix.md` states at its own top: *"When this matrix and a config file disagree, this file wins."* Its reconciliation checklist (`:86-92`) requires four things of any change like this: declare the row first, one path per service per environment (never two live writers), a canary/probe contract (`/healthz` + `/readyz`), and migrations before traffic. PR A declared the row; this task flips it from **Pending** to live truth and fills in the probe contract.

- [ ] **Step 1: Read the matrix as PR A left it**

```bash
cd /private/tmp/spot-release && cat -n docs/devops/deployment-matrix.md
```

Read it whole. Confirm PR A's three additions are present (`grep -n "DO NOT MERGE\|UNVERIFIED FROM THE REPO\|release.yml" docs/devops/deployment-matrix.md`). If they are not, PR A has not merged into this branch's base — stop.

- [ ] **Step 2: Flip the `release.yml` row from Pending to live**

Replace the row PR A added, keeping it in the same table position:

```markdown
| `release.yml` | `on: push: branches: [main]` (plus `workflow_dispatch` for rollback) | development, staging, production — Railway, via `railway up` | `backend`, `frontend-web`, `frontend-admin` in each; migrations applied per environment before that environment's deploy | The ONLY automatic writer of any Railway environment. One brake: `vars.RAILWAY_DEPLOY_ENABLED`. No reviewer, no typed confirmation, no promotion branch. |
```

- [ ] **Step 3: Add the dedicated `frontend-web` (Railway production) row**

Required by checklist item 2 (`:89`), which forbids two live writers for one service-environment pair. The doc's existing `frontend-web` row (`:14`) describes the **cPanel** instance that serves browsers at `www.spotlightng.com`; the Railway production instance is a *different host with a different writer and different consumers*. Without its own row the matrix implies they are one thing, and the next reader either deletes one as redundant or wires the wrong host.

Insert immediately after the existing `frontend-web` row:

```markdown
| `frontend-web` (Railway **production** BFF) | `release.yml`, on every push to `main` | production | `frontend-web-production-9259.up.railway.app` | **A different host from the cPanel row above, and not interchangeable with it.** `www.spotlightng.com` is served by the cPanel lane (`sync-frontend-web.yml` → `paymax2022/spotlight-latest` → that repo's ungated cPanel workflow); `deploy-cpanel.yml` in *this* repo is inert (0 successes in 843 runs, `vars.CPANEL_DEPLOY_ENABLED` unset). This Railway instance is the BFF that `mobile-app/reactnative/eas.json:65` bakes into the shipped build's `EXPO_PUBLIC_API_BASE_URL` (and `production-apk` inherits at `:72`), and that `frontend-admin`'s production `WEB_API_BASE_URL` points at. Before `release.yml` nothing in the repo updated it — its 2026-11-15 deployment was a hand-run `railway up`. Because a store build bakes the base URL at submission time, a stale host here cannot be re-pointed without a new submission. |
```

- [ ] **Step 4: Update the `backend` and workers rows**

The `backend` row (`:15`) currently names the manual dispatch mechanism. Replace its mechanism cell with:

```markdown
`release.yml` on every push to `main` (Railway `railway up`, per environment). Migrations are applied to that environment first — `migrate-staging` before `deploy-staging`, `migrate-production` before `deploy-production`. `/api/v1/public/build` reports the served commit, stamped via `backend/BUILD_COMMIT` + `-ldflags`.
```

The workers row (`:16`) must say the chain does not deploy Render. Append to its mechanism cell:

```markdown
**Not deployed by `release.yml`** — no matrix in it names `notification-worker`, on purpose. Production's consumer is Render's `spotlight-notification-worker`; a Railway production worker would put two consumers on one queue with the same `REDIS_URL` and double-deliver every push, email and SMS. See "`notification-worker` version state" below for the open question about which branch its Render blueprint tracks.
```

- [ ] **Step 5: Record the probe contract**

Checklist item 3 (`:90`) requires a canary/probe contract. Add a section before "## Reconciliation checklist":

```markdown
## Probe contract

A green deploy job is not evidence. Every stage reads back what the environment is
actually serving (`scripts/ci/railway-smoke.sh`):

| Service | Probe | Passes when |
|---|---|---|
| `backend` | `GET /api/v1/public/build`, polled 20×15s | `.commit` equals the released SHA. Also records `started_at` and `uptime_seconds`, so "a build exists" cannot pass for "the process restarted". |
| `backend` | `GET /healthz` | 200. |
| `backend` | `GET /readyz` | 200 in staging and production. In **development** it is recorded as a warning, not a failure — development's DB pool is unreachable today (503), a pre-existing condition no commit caused. |
| `frontend-web` | `GET /` | 200, plus a chunk-fingerprint comparison. |
| `frontend-admin` | `GET /admin/login` | 200, plus a chunk-fingerprint comparison. |

The **chunk fingerprint** (`scripts/ci/frontend-fingerprint.sh`) is a digest of the
served `/_next/static/chunks/` filenames. It exists because a frontend build echoes
no commit anywhere — there is no `generateBuildId` in `frontend-web/next.config`,
and the App Router HTML carries no `buildId` and no `_buildManifest.js` reference —
so nothing else can distinguish "the new build is being served" from "the old bytes
are still there". An unchanged fingerprint when the commit touched that service is
a **warning**, never a failure: it can also mean the change was server-side only,
or that an edge cache is still warm. It is loud because the cPanel lane once shipped
a stale build for exactly this reason (Next 16's `.next/server/route-cache`
survives `rm:false`).

Host names live in exactly one file, `scripts/ci/railway-urls.sh`, sourced by both
the pre-deploy fingerprint step and the post-deploy probe, so the two can never
disagree about which host they mean. An unknown environment/service pair returns
empty and the probe fails loudly rather than curling a guessed host.
```

- [ ] **Step 6: Correct the `deploy-railway-action` prose and the checklist's own line citations**

`:80-84` describes the `deploy-railway-action.yml` reusable workflow, and `:40-41` quotes `ci.yml` line numbers `:458`/`:543`/`:683` that were already stale before this change and are now meaningless — those jobs are deleted. Read both, then:

- In the promotion-model prose (Task 2 of PR A replaced the section; check whether any `ci.yml:NNN` citation survived) remove every `ci.yml` line citation and point at `release.yml` by job name instead. Line numbers drift; job names do not.
- In `:80-84`, if the prose says the `deploy-railway-action` reusable is the deploy path, correct it: `release.yml` calls `scripts/ci/railway-deploy.sh`, not that reusable workflow. Read `.github/workflows/deploy-railway-action.yml`'s actual consumers first (`grep -rn "deploy-railway-action" .github/`) and describe what is true now.
- **Fix the two contradictory claims about Railway git sources, with the measurement.** The matrix has said, in different rows, that the staging services "carry a Railway git source on `main`, so their current builds report `meta.branch: main`" and that staging frontend-web is deployed by "Railway native git deploy from the `staging` branch". Both cannot be true, and neither is stated as a measurement. Measured 2026-11-16 with `railway service list --project e7dca861-3667-4d9a-8090-6d2f4d179ec2 --environment <env> --json`: **development** and **production** report `source.repo: null` for every service; **staging**'s `backend`, `frontend-web` and `frontend-admin` all report `source.repo: paymax2022/spotlight-latest1`. They do not fire on `main` — `main` moved at 2026-11-15 21:49 +01:00 and the newest staging deployments that day were 10:55 (frontend-web) and 10:39 (frontend-admin), hours earlier. Write exactly that, and write the consequence: `release.yml`'s `railway up` is the intended writer, and **un-freezing `develop` / `staging` / `prod` would make the staging connector a second live writer of the staging environment** — the one scenario the matrix's checklist item 2 exists to prevent. Do not describe the connector as inert because it has been quiet; it is quiet because the branches are frozen.

- [ ] **Step 7: Update the three runbooks**

Each of these tells an operator to do something that no longer exists. Read each fully before editing — the edits below are the *kinds* of change required, and the live text decides the exact wording.

```bash
cd /private/tmp/spot-release
grep -n "workflow_dispatch\|DEPLOY\|develop\b\|staging branch\|prod branch\|promotion\|reviewer\|approve" \
  docs/launch/BRANCH-PROTECTION.md docs/devops/DEPLOY-RUNBOOK.md docs/devops/production-migration-ledger.md
```

- **`docs/launch/BRANCH-PROTECTION.md`** — the `Production` environment's required reviewers (`spec-ng`, `TheBraveByte`) were removed on 2026-11-15 (~16:34Z). Record that, and record the rollback: a re-PUT to `repos/paymax2022/spotlight-latest1/environments/Production` with `{"wait_timer":0,"prevent_self_review":false,"can_admins_bypass":true,"reviewers":[{"type":"User","id":18039055},{"type":"User","id":59900242}]}`. Add the warning that a reviewer on `production` re-gates `release.yml` too, because a reusable-workflow job that declares `environment:` inherits that environment's protection rules. Also record that `development`, `staging` and `production` all report `reviewers: []`, `wait_timer: null`, `prevent_self_review: null`, `can_admins_bypass: true` (measured 2026-11-15), and that `staging-Old` 404s as an environment — it survives only as a Railway environment name.
- **`docs/devops/DEPLOY-RUNBOOK.md`** — replace the dispatch/typed-`DEPLOY`/promotion-branch procedure with: push to `main`. Keep the emergency sections, retargeted: the brake is `vars.RAILWAY_DEPLOY_ENABLED`; the rollback is `workflow_dispatch` on `release.yml` with `ref=<prior SHA>` and, if that SHA's check-runs are past retention, `skip_gates=true`; a rollback does **not** apply migrations. Keep the Railway CLI facts that are still true and were previously only in workflow comments: `RAILWAY_HTTP_TIMEOUT` must be set (90s default truncates the 110 MB `frontend-web` upload), and the upload rule for a service with a Railway `rootDirectory`.
- **`docs/devops/production-migration-ledger.md`** — the ledger's entries were produced by `db-migrate.yml` firing on a push to `main`. From PR B onward they are produced by `release.yml`'s `migrate-production` job via `_reusable-db-apply.yml`. Say so, and note that `db-migrate.yml` remains as an operator dispatch sharing the same apply path and the same CLI pin (2.114.0).

- [ ] **Step 8: Verify no doc still instructs the retired procedure**

```bash
cd /private/tmp/spot-release
grep -rniE "type +DEPLOY|confirm_deploy|deploy_environment|merge (main )?to (the )?(prod|staging|develop) branch|promotion branch" docs/ | grep -v "deployment-matrix.md"
```

Expected: no hits, or only hits inside prose that is explicitly describing the *retired* model (the matrix's own "Promotion model — Retired 2026-11-15" section is allowed to name it). Any other hit is a live instruction to do something that no longer works — fix it.

- [ ] **Step 9: Commit**

```bash
cd /private/tmp/spot-release
git add docs/devops/deployment-matrix.md docs/launch/BRANCH-PROTECTION.md \
        docs/devops/DEPLOY-RUNBOOK.md docs/devops/production-migration-ledger.md
git status --short
git commit -m "$(cat <<'EOF'
docs(devops): make the matrix and runbooks describe the release chain

The matrix is canonical ("when this matrix and a config file disagree, this file
wins"), so it goes first: the release.yml row flips from Pending to live, the probe
contract is written down, and the backend/workers rows say what actually writes
them now.

frontend-web gets a SECOND production row, because there are two different
production frontends and the matrix only described one. www.spotlightng.com is the
cPanel lane; frontend-web-production-9259 is the Railway BFF that eas.json:65 bakes
into the shipped mobile build's EXPO_PUBLIC_API_BASE_URL and that frontend-admin's
production WEB_API_BASE_URL points at. Before release.yml nothing in the repo
updated the second one. The checklist forbids two live writers for one
service-environment pair, and these are two services, so each needs its own row —
otherwise the next reader deletes one as redundant or wires the wrong host.

The ci.yml line citations are replaced with job names. Line numbers drift; the
citations at :40-41 were already stale before this change and now point at deleted
jobs.

The runbooks lose the dispatch/typed-DEPLOY/promotion-branch procedure and gain the
two controls that replace it: the RAILWAY_DEPLOY_ENABLED brake and the
dispatch-with-a-ref rollback. BRANCH-PROTECTION.md records that the Production
reviewers were removed, how to put them back, and why putting them back would
re-gate release.yml as well — a reusable-workflow job that declares `environment:`
inherits that environment's protection rules.
EOF
)"
```

---

### Task 9: Consistency sweep, local gates, push, and the post-merge proof

**Files:**
- No new files. This task proves the eight before it are mutually consistent, then publishes them.

**Interfaces:**
- Consumes: every artifact from Tasks 3-8.
- Produces: PR B, and — after merge — the evidence that a `main` push actually deployed all three environments.

**The rule for this whole task: a green run is not the proof.** Read each environment's served commit back from its own `/api/v1/public/build`, and for production `frontend-web` confirm the served chunk hashes actually changed. The point of the change is that nobody inspects a release any more, so the first one must be inspected deliberately.

- [ ] **Step 1: Run every local gate**

```bash
cd /private/tmp/spot-release
echo "=== actionlint (same command the CI gate runs) ==="
/Users/paymax/go/bin/actionlint -no-color -oneline -shellcheck= -pyflakes= && echo "clean"
echo "=== existing module-router test ==="
python3 scripts/ci/test-changed-modules.py
echo "=== new release-gate test ==="
python3 scripts/ci/test-release-gates.py
echo "=== every shell script parses ==="
for f in scripts/ci/railway-urls.sh scripts/ci/frontend-fingerprint.sh \
         scripts/ci/railway-deploy.sh scripts/ci/railway-smoke.sh; do
  bash -n "$f" && echo "ok  $f"
done
echo "=== every new python file compiles ==="
python3 -m py_compile scripts/ci/release-gates.py scripts/ci/test-release-gates.py && echo "compiles"
```

Expected: `clean`, two `ok — …` lines from the tests, four `ok  scripts/…` lines, and `compiles`. **All five must pass.** A red gate here is a red gate in CI, and CI red means `release-gates.py` returns `failed` and nothing deploys — so the chain cannot even prove itself.

- [ ] **Step 2: Sweep for stale references to everything this change removed**

```bash
cd /private/tmp/spot-release
echo "=== references to deleted jobs, files and inputs ==="
grep -rn "deploy-development\|deploy-staging\|deploy-production\|development-deploy\|confirm_deploy\|deploy_environment" \
  .github/ docs/ scripts/ || echo "  none"
echo "=== files that claim a branch push deploys ==="
grep -rniE "native github deployment|branch mapping|railway (deploys|will deploy) from" .github/ docs/ || echo "  none"
echo "=== the deleted workflow must be gone ==="
ls .github/workflows/development-deploy.yml 2>&1 | tail -1
echo "=== two writers for one service-environment pair? ==="
grep -rln "railway up" .github/workflows/
```

Expected:
- The first grep returns **nothing** but the matrix's retired-model prose if it names them. Any hit in `.github/` is a live reference to a job that no longer exists.
- The second grep returns nothing — `ci.yml`'s "native GitHub deployments" claim was corrected in Task 7 Step 7.
- `ls` reports `No such file or directory`.
- The last grep lists **only** files that legitimately run `railway up`. Read each one it names. `release.yml` (via `railway-deploy.sh`) is expected; `ci.yml` must NOT appear; `development-deploy.yml` must NOT appear. If `deploy-railway-action.yml` or another workflow appears, read it and determine whether it is a second live writer — checklist item 2 forbids that.

- [ ] **Step 3: Confirm exactly one writer per environment, mechanically**

```bash
cd /private/tmp/spot-release
echo "=== which workflows declare a Railway environment? ==="
grep -rn "environment: \(development\|staging\|production\)\$\|environment: \${{ inputs.target }}" .github/workflows/
echo "=== which workflows can fire on a push to main? ==="
python3 - <<'PY'
import glob, yaml
for path in sorted(glob.glob('.github/workflows/*.yml')):
    try:
        d = yaml.safe_load(open(path))
    except Exception as e:
        print(f"{path}: UNPARSEABLE ({e})"); continue
    on = d.get(True, d.get('on', {}))   # YAML parses a bare `on:` as True
    push = on.get('push') if isinstance(on, dict) else None
    if not push:
        continue
    branches = push.get('branches') or []
    if 'main' in branches:
        deploys = 'railway up' in open(path).read() or 'railway-deploy.sh' in open(path).read()
        print(f"{path}: push->main, branches={branches}, deploys={deploys}")
PY
```

Expected: exactly one workflow reports `deploys=True` on a push to `main` — `release.yml`. If two do, the matrix's checklist item 2 is violated and the second writer must go before this merges.

- [ ] **Step 4: Re-verify the live facts the plan depends on, one last time**

These were all measured on 2026-11-15. They are cheap to re-check and expensive to be wrong about, because each one is a value hardcoded into a workflow.

```bash
cd /private/tmp/spot-release
echo "=== no environment has reviewers (a reviewer would silently re-gate the chain) ==="
for e in development staging production Production; do
  printf '%-12s ' "$e"
  gh api "repos/paymax2022/spotlight-latest1/environments/$e" --jq '{reviewers: [.protection_rules[]? | select(.type=="required_reviewers")] | length}' 2>&1 | tail -1
done
echo "=== the brake is on ==="
gh api repos/paymax2022/spotlight-latest1/actions/variables/RAILWAY_DEPLOY_ENABLED --jq .value
echo "=== every Railway service still has source: null (so no branch push can deploy) ==="
echo "=== and the three per-environment tokens exist ==="
for s in RAILWAY_TOKEN_DEVELOPMENT RAILWAY_TOKEN_STAGING RAILWAY_TOKEN_PRODUCTION; do
  printf '%-30s ' "$s"
  gh secret list --repo paymax2022/spotlight-latest1 | grep -q "^$s" && echo present || echo "MISSING"
done
```

Expected: `reviewers: 0` for every environment (or a 404 for `staging-Old`, which does not exist as an environment); `true` for the brake; `present` for all three tokens. **A `MISSING` token stops the merge** — `railway-deploy.sh` fails closed on it, so the environment would never deploy and the chain would go red on every push.

If any environment reports `reviewers: 1`, **stop and report it**. A required reviewer on `production` re-gates `release.yml` itself, because a reusable-workflow job that declares `environment:` inherits that environment's protection rules — the chain would park silently on every release and look like a hang.

- [ ] **Step 5: Push and open PR B**

```bash
cd /private/tmp/spot-release
git log --oneline origin/main..HEAD
git status --short
git -c credential.helper='!gh auth git-credential' push -u origin feat/release-yml-auto-deploy
```

Expected: six commits (Tasks 3-8), a clean status, and a `* [new branch]` line. **Never `--delete-branch`, never push `main`.**

```bash
cd /private/tmp/spot-release
gh pr create --title "ci: every push to main releases itself (development, staging, production)" --body "$(cat <<'EOF'
## Summary

Removes every manual step from the release path. A push to `main` now deploys development, staging and production — migrating each environment's database before the code that needs it, and never writing production until staging has been probed and is serving the new commit.

Implements `docs/superpowers/specs/2026-11-15-auto-deploy-release-pipeline-design.md` (#1034), Phase 1. Phase 0 (archive tags + do-not-merge record) is in the preceding PR.

**What replaces the human who used to type `DEPLOY`:**
- `gates` refuses to deploy until this commit's CI is provably green. It waits on the nine required-check **names** *and* on the `integration-verify` **workflow run** — that workflow produces no check-run of its own name, so waiting on a name would hang for 75 minutes. `--paginate` is mandatory: `6199a6b57` returns 50 check-runs and an unpaged read is a false all-green.
- A **timeout is a failure**, not a pass.
- Every stage reads back what the environment is actually serving (`/api/v1/public/build` for the backend, a `/_next/static/chunks/` fingerprint for the frontends — a frontend build echoes no commit anywhere, so nothing else can prove the bytes changed).

**Three things worth reading before approving:**
1. **The development leg does not gate production.** `development/frontend-web` has been red since 2026-11-13 and its backend `/readyz` answers 503 on an unreachable DB pool. Both are pre-existing; requiring green development would halt every release on a failure no commit caused. Development failures still fail the workflow's overall conclusion — read the run page, not its colour.
2. **A rollback deliberately does not apply migrations.** `supabase db push` against a remote holding newer versions aborts with "remote migration versions not found in local migrations directory". The no-op is a step inside a job that always runs, never a job-level `if:` — a skipped `needs:` dependency makes GitHub skip every job downstream, so an if-skipped migrate would cancel the rollback's own deploy.
3. **`notification-worker` is in no matrix, on purpose.** Production's asynq consumer is Render's `spotlight-notification-worker`; a Railway production worker would double-deliver every push, email and SMS. Its deployed commit is **unknown and unverifiable from this repo** (no Render credentials exist here) — recorded with both branches of the consequence in the deployment matrix.

**Also in here:** `ci.yml` returns to CI-only (three deploy jobs deleted, two stale header claims corrected — one asserted a Railway branch mapping that has never existed, since every service reports `source: null`), `db-migrate.yml` becomes dispatch-only and shares one apply path with the chain, and `development-deploy.yml` is retired.

No required-check name changes, so `.github/required-checks.txt` is untouched and no open PR blocks.

## Test plan
- [ ] `actionlint -no-color -oneline -shellcheck= -pyflakes=` clean across all workflows
- [ ] `python3 scripts/ci/test-release-gates.py` — verdict logic pinned by fixtures
- [ ] `python3 scripts/ci/test-changed-modules.py` — every required check still resolves
- [ ] The dependency-graph assertion passes: 9 jobs, `migrate-production` needs `smoke-staging`, no production job depends on a development job
- [ ] Exactly one workflow deploys on a push to `main`
- [ ] No environment has required reviewers; all three Railway tokens present
- [ ] **After merge:** dispatch `db-migrate.yml` with `target=staging, dry_run=true` — proves caller → reusable → `environment:` → `secrets: inherit` → `supabase link` end to end while writing nothing
- [ ] **After merge:** watch the first `main` push and read each environment's served commit back from `/api/v1/public/build`
- [ ] **After merge:** confirm production `frontend-web`'s chunk hashes actually changed, and that the mobile login path still works
EOF
)"
```

**Do not merge PR B yourself.** Merging it is the moment a `main` push starts deploying production; that needs the user's explicit word.

- [ ] **Step 6: After merge — prove the reusable apply resolves credentials, writing nothing**

This is the one dry run that exercises the whole `secrets: inherit` + `environment: ${{ inputs.target }}` path end to end without touching a database. Do it before trusting the chain.

```bash
cd /Users/paymax/Documents/spotlight/main
gh workflow run db-migrate.yml --ref main -f target=staging -f dry_run=true -f include_all=false
sleep 10
gh run list --workflow db-migrate.yml --limit 1
```

Then watch it and read the result:

```bash
RUN=$(gh run list --workflow db-migrate.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN" --exit-status; echo "exit=$?"
gh run view "$RUN" --log | grep -iE "target:|dry.run|Nothing applied|migration list|missing SUPABASE" | head -30
```

Expected: a green run, `target: staging`, and `Dry-run only — listed pending migrations, nothing applied.`

**If it fails with `missing SUPABASE_ACCESS_TOKEN` or `missing the staging project ref`**, `secrets: inherit` did not propagate — check the caller job has it, and check that the *called* job (not the caller) declares `environment:`. This failure is safe: the `:?missing` guard fires before any `db push`, so nothing was written. Fix and re-dispatch; do not work around it by passing secrets explicitly.

**If it fails with "the staging project ref equals the production project ref"**, the ternary fell through on an empty string. That guard exists precisely for this; investigate rather than removing it.

- [ ] **Step 7: After merge — watch the first real release end to end**

```bash
cd /Users/paymax/Documents/spotlight/main
gh run list --workflow release.yml --limit 3
RUN=$(gh run list --workflow release.yml --event push --limit 1 --json databaseId --jq '.[0].databaseId')
gh run view "$RUN"
```

Read the **gate verdict** first — it is written to the `gates` job's step summary as `### Release gate: **proceed**`. A verdict of `noop_docs_only` means the commit was docs-only and correctly deployed nothing. A verdict of `timeout` means the chain refused to deploy and someone must look at why CI never settled.

Then read the served commit back from each environment. **Do not report success on a green run alone:**

```bash
for pair in "development backend-development-502c" "staging backend-staging-new" "production backend-production-1b33d"; do
  set -- $pair
  printf '%-12s ' "$1"
  curl -s -m 30 "https://$2.up.railway.app/api/v1/public/build" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('commit','<none>'), d.get('started_at',''), d.get('source',''))" 2>/dev/null \
    || echo "UNREACHABLE"
done
```

Expected: all three print the **same** SHA, equal to `origin/main`'s tip, with a `started_at` newer than the run's start and `source: ldflags`. A backend still printing an older SHA means the deploy did not replace the process — read that service's job log for the crash dump `railway-deploy.sh` produces.

- [ ] **Step 8: After merge — confirm production `frontend-web` actually changed**

This is the host the shipped mobile build points at (`eas.json:65`), and it had no automatic writer before this PR. Its 2026-11-15 deployment was a hand-run `railway up`.

```bash
cd /private/tmp/spot-release
. scripts/ci/railway-urls.sh
bash scripts/ci/frontend-fingerprint.sh "$(railway_url production frontend-web)/"
bash scripts/ci/frontend-fingerprint.sh "$(railway_url production frontend-admin)/admin/login"
```

Expected: digests that differ from the pre-deploy values recorded in the `gates` job's `fp_production_*` outputs, and a `smoke-production` log with no "served chunks did not change" warning. Then confirm the mobile path still works — hit the production BFF the way the app does, and confirm a login round-trip succeeds against `frontend-web-production-9259`.

- [ ] **Step 9: After merge — check the Render worker question and close the record**

Task 2 wrote the `notification-worker` version state as UNVERIFIED FROM THE REPO with both branches of its consequence. Close it:

Render dashboard → service `spotlight-notification-worker` → latest deploy → note the commit SHA. Then:

```bash
cd /Users/paymax/Documents/spotlight/main
git fetch -q origin
SHA=<the SHA from the Render dashboard>
git merge-base --is-ancestor "$SHA" origin/main && echo "ancestor of main" || echo "NOT on main"
git log --oneline -1 "$SHA"
```

Record the finding — date, SHA, and which branch the blueprint tracks — in the section Task 2 created. If the blueprint tracks `prod`, the worker is now frozen permanently and **any change to the enqueue shape requires a manual Render deploy alongside the release**; that must be written into `DEPLOY-RUNBOOK.md`, not left in the matrix alone.

This step needs the user's own Render dashboard access. Do not attempt to read it from the repo or guess a value — the record is explicitly marked unverified so that nobody mistakes a guess for a measurement.

- [ ] **Step 10: Clean up the worktrees**

Only after PR B has merged and Steps 6-9 are done.

```bash
cd /Users/paymax/Documents/spotlight/main
git worktree list
```

Confirm nothing in either worktree is uncommitted before removing one:

```bash
git -C /private/tmp/spot-release status --short
git -C /private/tmp/spot-phase0 status --short
```

Both must be empty. Then, and only then:

```bash
cd /Users/paymax/Documents/spotlight/main
git worktree remove /private/tmp/spot-release
git worktree remove /private/tmp/spot-phase0
```

**Do not remove `/private/tmp/spot-auto-release`** — it holds the spec and this plan on `feat/auto-release-pipeline` (PR #1034), which is a separate, still-open PR. And do not delete any local branch: the branches are the only copy of the work until GitHub has them, and `--delete-branch` is never used on this repo.

---

## Self-Review

Performed after writing the plan, against the spec, per the writing-plans skill.

**1. Spec coverage.** Each spec section maps to a task:

| Spec | Task |
|---|---|
| Decision A — retire the divergence, don't port it | Task 1 (tags), Task 2 (do-not-merge record) |
| Decision B — one new workflow owns the chain | Tasks 5-6 (`release.yml`), Task 7 (`ci.yml` stripped) |
| Decision C — the chain waits for CI rather than racing it | Task 3 (`release-gates.py`) |
| Decision D — one apply path per database | Task 4 (`_reusable-db-apply.yml` + `db-migrate.yml`) |
| Decision E — production `frontend-web` is in the matrix | Task 6 (matrix entry), Task 8 Step 3 (dedicated row) |
| Decision F — the development leg does not gate production | Task 5 (`!cancelled()` + `require_readyz: 'false'`), Task 6 Step 4 (graph assertion) |
| Decision G — probe contract, migrations before traffic | Task 5 (`railway-smoke.sh`), Task 6 (ordering), Task 8 Step 5 |
| Decision H — `notification-worker` on Render, not Railway | Task 2 Step 5 (record), Task 5 Step 1 (no URL entry), Task 6 (no matrix entry), Task 9 Step 9 |
| Phase 0 items 1-4 | Tasks 1-2 |
| Phase 1 items — `release.yml`, `_reusable-db-apply.yml`, `ci.yml` strip, `db-migrate.yml` dispatch-only, `development-deploy.yml` retired, two stale headers corrected | Tasks 4-7 |
| Docs — matrix first, then runbooks | Task 8 |
| Verification — dry-run apply, watch the first push, read the served commit, check production `frontend-web` chunks | Task 9 Steps 6-9 |

No spec requirement is left without a task.

**2. Placeholder scan.** No `TBD`, `TODO`, "implement later", "similar to Task N", or "add appropriate error handling" anywhere. Every code step carries the literal file content. One `<the SHA from the Render dashboard>` remains in Task 9 Step 9 and is intentional: that value cannot be known from this repo, and inventing one would be worse than naming the gap — the step says so explicitly.

**3. Type and name consistency.** Checked across tasks:
- `railway_url <environment> <service>` — defined Task 5 Step 1, sourced Task 5 Step 2's script and Task 5 Step 7's `gates` job, and Task 9 Step 8.
- `Verdict(decision, reason, unsettled)` — defined Task 3 Step 3, constructed by `classify` and `wait`, consumed by `summary` and `main`, and read by the test as `.decision` / `.unsettled`.
- `railway-deploy.sh` env names (`SERVICE`, `RAILWAY_ENV`, `SHA`, `RAILWAY_TOKEN`, `RAILWAY_PROJECT`, `UPLOAD_PATH`, `ROOT_FLAG`, `BUILD_DIR`) — identical in the script's header, its `:?` guards, and all three deploy jobs' `env:` blocks.
- `railway-smoke.sh` env names (`SERVICE`, `RAILWAY_ENV`, `SHA`, `REQUIRE_READYZ`, `EXPECT_FINGERPRINT`, `TOUCHED`, `SUMMARY`) — identical in the script and all three smoke jobs.
- `gates` outputs — `verdict`, `sha`, `at_main_tip`, and `fp_<env>_<service>` for six pairs; every consumer in Tasks 5-6 uses those exact names.
- `_reusable-db-apply.yml` inputs — `target`, `dry_run`, `include_all`, `skip_apply`, `skip_reason`; identical in the `workflow_call` block, the two `db-migrate.yml` callers and the two `release.yml` callers.
- The job names `migrate-staging`, `deploy-staging`, `smoke-staging`, `migrate-production`, `deploy-production`, `smoke-production` are consistent between Task 6's YAML, its Step 4 graph assertion, and Step 5's grep.

**4. Deliberate corrections made during review.** Each was fixed in the literal step text rather than noted beside it, because an executor copies the block, not the prose.

1. Task 5's `smoke-development` matrix originally gave the `backend` entry a populated `fingerprint` that the backend branch of `railway-smoke.sh` never reads, and its `touched` step used `git diff A~1 A` unguarded, which aborts on a root commit.
2. Task 5 Step 8 originally ran `bash -n f1 f2 f3 f4`, which syntax-checks **only `f1`** — bash takes the first non-option argument as the script and the rest become positional parameters — so its "scripts parse" was not evidence. Rewritten to the `for f in …; do bash -n "$f"; done` loop that Steps 6 and Task 9 already used.
3. Tasks 3 and 7 both edit `.github/workflows/ci.yml` in the same branch, and Task 7's steps cited pristine `6199a6b57` line numbers. Task 3 inserts 6 lines at `:188`, so Task 7's literal `sed -i '' '486,$d'` would have started at old-`:480` — inside the `workflow-lint` job — and truncated a required check. Task 7 Steps 1-3 now derive the span from content anchors (`grep` for `^  deploy-development:`, then `awk` back to the comment above it), assert the expected post-Task-3 numbers (811 lines, `:495`/`:586`/`:727`, 491 after the delete), and warn that `$START` must be live in the same shell as the `sed`.
4. Task 3's literal `wait()` failed Task 3's literal test. The loop read `clock()` twice per iteration — once inside the `classify` call for `absence_settled`, once for `elapsed` — and the test's `_Clock(step)` advances a fixed step per *call*, so simulated time ran at double speed and a 120s budget with a 30s step slept once where the test pins four sleeps. Caught by the Task 3 implementer at the red-green gate, verified by hand here, and fixed in the plan text: one `now = clock()` per iteration feeding both uses, and `elapsed > budget_s` rather than `>=` (with `>=` the loop exits on the iteration where elapsed first equals the budget, one sleep short). Signature, verdict set, log format and reason strings are unchanged; with a real monotonic clock the two reads were microseconds apart, so production behaviour is materially identical and the overshoot is bounded by one `POLL_SECONDS` on a 75-minute budget.
5. Task 3 Step 5's live probe expected "≥ 50 check-runs", which is a property of the specific commit `6199a6b57`, not of the script. `origin/main` moved to `e92e1058d` mid-task and returned 43. Reworded to say the point is that the count exceeds one page, which is what proves the pagination walk.
6. **The 40-minute gate budget is shorter than the CI it waits for, so this was a bug, not a tuning.** Found at Task 9 Step 2 by measuring the thing the number is supposed to bound. The gate waits on the `integration-verify` **run** for the released SHA, so the right population is that workflow's green main pushes: 309 runs with `event=push`, `branch=main`, `conclusion=success`, measured on `run_started_at`→`updated_at` — p50 24.1, p90 40.6, p99 43.4, worst **46.1** minutes, and **31 of 309 (1 in 10) past 40**. A `timeout` verdict exits 1 and every deploy job is gated on `needs.gates.outputs.verdict == 'proceed'`, so on those pushes the release would have deployed nothing while the red `gates` check read like CI's own fault. Raised to **75 minutes** wherever the number is executable (`--budget-minutes 75` in Task 6's `release.yml` literal, `default=75` in Task 3's `main()`, and the prose that quotes it). Keeping 40 and making `timeout` non-fatal is worse: it would deploy on an unsettled verdict.
7. **Two measurement traps in that finding, both of which produced a wrong number before they were caught.** (a) *Conditioning*: over all 901 completed push runs of `integration-verify` — failures and cancels included, and those settle fast — the median is 8.7 min, which makes 40 look safe. A budget sizes the wait for a run that goes green, so it must be conditioned on `conclusion=success`; the first citation in this repo's own workflow comment mixed the two populations and said "29 of 309", which is neither figure (31 of 309 for green, 32 of 901 for the whole mix). (b) *Span definition*: `run_started_at`→`updated_at` is execution; `created_at`→`updated_at` includes queue, and on that span the worst of the 309 is **85.5** min. So 75 is an empirical bound, not a guarantee — deliberately so, because a fail-closed timeout on the ~1-in-300 tail is the safe direction (nothing ships, operator re-dispatches) and a budget tuned to cover every observed minute would let a hung CI hold the `release-main` concurrency slot for over an hour. Any future re-sizing must state which span it measured.
