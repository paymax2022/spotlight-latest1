# Main → production backend release — plan + schema-vs-code review

**Status: PLANNING ONLY. Nothing here has been merged, deployed, dispatched or committed.**
Measured **2026-11-19 23:25–23:45Z**, re-checked **2026-11-20 08:48Z**, from read-only inspection of
`origin/main`, `origin/prod`, the live Railway services and one read-only CI run.

Companion document: `docs/superpowers/plans/2026-11-12-staging-to-production-migration.md`
(16 tasks, 5 done / 67 open). This plan re-baselines it with 2026-11-20 measurements and
narrows scope to the **backend** plane, because that is the only production service still
running `prod`-branch code (§1) and because §10 shows five of its tasks are now moot.

---

## 1. What this release actually is

Three things run in "production", and only one of them is behind:

| Surface | Served from | Lineage today |
|---|---|---|
| `www.spotlightng.com` (customer site) | cPanel, via `sync-frontend-web.yml` on every `frontend-web/**` push to **main** | **main** |
| `frontend-admin` production (Railway) | manual `railway up` uploads from **main** (measured restore `cb02a3ca`) | **main** |
| `frontend-web` production Railway instance = the **mobile BFF** (`frontend-web-production-9259`) | `release.yml` on main | **main** |
| **`backend` production (Go API)** `backend-production-1b33d.up.railway.app` | `d3401f574`, a `prod`-branch commit, started 2026-11-18T16:40:40Z | **prod** |
| **production database** (Supabase prod project) | migration head `20271700000000` | **main** |

So the "main-to-prod backend release" is a **single-service code move**, and its real purpose
is to close the last lineage split in the system: the API is the only component that does not
know it is supposed to be running main. Every main-era frontend feature that calls a new
endpoint has been breaking in production and getting hand-ported onto `prod` to compensate
(15 such commits; §4).

```bash
# reproduce the headline rows
curl -sS --http1.1 https://backend-production-1b33d.up.railway.app/api/v1/public/build
curl -sS --http1.1 https://backend-staging-new.up.railway.app/api/v1/public/build
git rev-parse origin/main origin/prod
```

---

## 2. Measured baseline (2026-11-19 23:25–23:45Z, re-checked 2026-11-20 08:48Z and 09:05Z)

| Fact | Value | How it was measured |
|---|---|---|
| `origin/main` head | `f8890c06e` → **`36c8e666b`** at re-check | `git rev-parse origin/main` |
| — what landed in between | `a05b8676e` (#1096, frontend-admin only) + `36c8e666b` (#1101, docs) | `git log --oneline f8890c06e..36c8e666b` |
| — did either touch the backend or the schema? | **no** — `backend/` delta 0 files, `supabase/migrations` delta 0 files, so every number below still holds at the tip | `git diff --name-only f8890c06e origin/main -- backend/ supabase/migrations` |
| `origin/prod` head | `6f58f0b0a` (unchanged) | same |
| Merge-base main↔prod | `94ad08c05`, **2026-10-15** | `git merge-base` |
| Commit-count diff | meaningless — main's history was gitleaks-rewritten, `prod`'s was not | `docs/reports/` + repo sweep 2026-11-18 |
| Differing paths main↔prod | **2,728** | `git diff --name-only origin/main origin/prod` |
| Backend content delta | **865 files, +124,135 / −8,242** | `git diff --stat … -- backend/` |
| Migration files: main / prod branch | **758 / 644** → 114 main-only | `git ls-tree -r --name-only … -- supabase/migrations` |
| **Migrations applied on the prod DB** | **758 rows, min `20260101000000`, max `20271700000000`** | read-only CI run `44637503244` (`ops-db-push.yml environment=production mode=list`) |
| Drift, either direction | **0 / 0** — prod DB ≡ main's file set, exactly | parsed `supabase migration list --linked` table from that run |
| Prod-only files (exist on `prod`, absent on main) | **23** | `git diff --diff-filter=A --name-only origin/main origin/prod` |
| Prod commits patch-absent on main | 10 (`git cherry`), of which 9 are ports *of* main features whose adapted form differs | `git cherry -v origin/main origin/prod` |
| Staging backend | `773fe0285`; delta vs main = **2 referral files, 0 migrations** | `git diff --name-only 773fe0285 origin/main -- backend/ supabase/migrations` |
| **Live backend stamps (09:05Z)** | dev `a05b8676e` · staging `773fe0285` · prod `d3401f574` — **three planes, three different commits**; `773fe0285` is a strict ancestor of main (it merely predates #1095), so this is drift, not divergence | `curl -s --http1.1 https://backend-{development-502c,staging-new,production-1b33d}.up.railway.app/api/v1/public/build`; hostnames from `scripts/ci/railway-urls.sh` @main |

**The single most consequential number: 758 = 758.** The production database is *already* at
main's migration head. There is no pending schema work, no replay, no `db push` in this
release. The skew runs **schema-ahead-of-code**, which inverts the usual release risk (§3).

---

## 3. Schema-vs-code review

### 3.1 Which direction the risk runs

Normally you fear "code expects a column the DB doesn't have yet". Here it is the opposite:
the prod DB has 114 migrations' worth of objects that prod's **deployed** code has never seen.
Two questions follow, and they have different answers:

1. **Do those 114 migrations already endanger the code running right now?** — measured below.
2. **Does deploying main's code leave any schema object it needs un-created?** — no: main's
   code and main's migrations are the same tree, and the DB equals main's migration set.

### 3.2 DDL risk classes across the 114 main-only migrations

Scanned comment-stripped, per file (`git show origin/main:supabase/migrations/<f>`):

| Class | Count | Verdict for prod's *current* code |
|---|---|---|
| `DROP COLUMN` | **0** | nothing removed |
| `ALTER COLUMN … TYPE` narrowing | **0** | no cast breakage |
| `ADD COLUMN … NOT NULL` without `DEFAULT` | **0** | old inserts cannot fail |
| `ADD CONSTRAINT` statements | **41** | see 3.3 |
| — of which: dropped then re-added in the same file (widening) | 14 | superset ⇒ old values still legal |
| — of which: inside a `pg_constraint` guard / `DO … FOR c IN SELECT conname FROM pg_constraint` swap | 24 | idempotent by construction |
| — of which: **unguarded by any visible drop** | **3** | hand-reviewed, 3.3 |
| `DROP POLICY` / `CREATE POLICY` | **99 / 116** | **open — the only material risk class, 3.4** |

Note on method: the "unguarded = 3" figure already accounts for `EXCEPTION WHEN
duplicate_object` and `IF NOT EXISTS (SELECT 1 FROM pg_constraint …)` blocks; a naive
line-regex pass over-reports this set (it called 27 net-new before the DO-blocks were
recognised). Any re-run of this scan must keep that awareness or it will manufacture work.

### 3.3 The three unguarded constraint adds — reviewed

| Constraint | File | Verdict |
|---|---|---|
| `restaurants_service_fee_round_mode_chk` (`IN ('none','nearest_naira','up_naira','down_naira')`) | `20271065000050_food_polish_w7.sql` | Column is `TEXT NOT NULL DEFAULT 'none'` and `'none'` is in the allowed set ⇒ **safe**; guarded anyway by `EXCEPTION WHEN duplicate_object` |
| `restaurants_service_fee_bounds_chk` | same file | Every term is `IS NULL OR …` over two nullable `BIGINT` columns ⇒ all-NULL rows satisfy it ⇒ **safe** |
| `crypto_webhook_events_provider_event_id_key` `UNIQUE (provider, event_id)` | `20271300000003_crypto_webhook_unique_constraint.sql` | The `event_id` column is created by this same migration; prod's current code does not populate it, and Postgres treats NULLs as distinct ⇒ cannot collide. The constraint **applied successfully**, which itself proves no pre-existing duplicate rows. Residual: it becomes load-bearing the moment main's code lands — that is main's *intent* (webhook replay protection), and it is one more reason the two planes should stop sharing a database schema with divergent expectations |

**Finding worth stating plainly: on the DDL axis, prod's database is not currently hostile to
prod's deployed code.** The 114 migrations are additive or widening.

### 3.4 Row-Level Security — the class that is NOT yet reviewed (work package A)

99 `DROP POLICY` and 116 `CREATE POLICY` statements live in those 114 migrations and are
**already applied to production**. RLS is the one risk class that fails *quietly*: a tightened
policy turns a list endpoint into `200 []` and a write into `42501`, with no deploy required
and no error in CI, because green live-DB CI cannot see the production policy set
(lesson recorded when #1058 landed).

Review procedure (all read-only, produces a table, no code change):

1. Enumerate protected tables and their policies from the prod DB:
   `psql … -c "select tablename, policyname, permissive, cmd, roles, qual, with_check from pg_policies where schemaname='public' order by 1,2;"`
   (`pg_policies` exposes definitions; run inside `BEGIN READ ONLY … ROLLBACK`, the pattern
   PR #1088 proved works on the session pooler — `PGOPTIONS` does **not** on that path.)
2. Reduce to tables the **prod-deployed** code actually queries (`git grep` the table name
   under `backend/internal/` at `d3401f574`). Policy churn on tables main invented
   (`estate_*`, `event_card_intents`, `academy_exams`, …) is not a prod-code concern.
3. For each survivor, exercise the endpoint as a **non-admin role** on production and compare
   the row count against the same call as super-admin. `401` proves the route exists; `200 []`
   against a table with rows is the RLS signature.
4. Record per policy: `table | policy | added-by-migration | endpoints affected | verdict`.

This is the release's only genuinely unbounded unknown. Budget it as a work package, not a
checkbox.

### 3.5 Route-vs-client delta — what the release unmounts (work package B, nearly closed)

Diffed every Gin registration in `backend/` on both tips (`prod` 2,801 / `main` 3,149):
**6 exist on prod and not on main**, and no others:

```
POST   /api/webhooks/maplerad/go     GET /transfers/:ref     POST /customer
POST   /virtual-account              POST /bills             GET  /boosts/tiers
```

- Five are the **Maplerad** group — dark in production, proven in 3.6.
- One is a **breaking route rename on a live public endpoint**, and it is the release's only
  measured functional regression:

  | `GET /v1/marketplace/boosts/…` | production `d3401f574` | staging `773fe0285` (main-lineage) |
  |---|---|---|
  | `tiers` | **200** | 404 |
  | `pricing` | 404 | **200** |

  Main kept the boost money path (`marketplace/service_boost.go`, and
  `admin_handler.go:182` calls boosts "the one LIVE marketplace money path") but renamed the
  discovery route `tiers` → `pricing`. So this is not a deleted feature, it is a contract
  change, and staging already shows the post-release shape.
  `git grep boosts/tiers origin/main -- mobile-app/ frontend-web/` → **0 hits**, so no
  main-lineage client is orphaned. The exposure is exactly: **builds distributed from
  `prod` lineage** that call `sell.api.ts:184 mktGet('/boosts/tiers')`, plus any third-party
  or cached consumer.
  → Gate **G6** decides whether this needs a shim, and it is cheap either way: add
  `base.GET("/boosts/tiers", h.BoostPricing)` as an alias on main *before* the cut, or accept
  the 404 for legacy builds. Both are one-line-or-zero-line options; neither is a reason to
  keep the fork.

Two method corrections that this scan forced, worth keeping so a re-run doesn't repeat them:
`wallets/:currency` and `wallet/convert` **do** exist on main — an app-package-only grep
claimed otherwise, so scope route greps to all of `backend/`. And group prefixes matter:
`/boosts/tiers` is really `/v1/marketplace/boosts/tiers`, which is why a probe of an
un-prefixed path "404s" harmlessly. Probe with the mounted path and the registered HTTP
method.

### 3.6 Maplerad — the headline worry, closed with live evidence

`prod` still contains the whole provider: 13 of the 23 prod-only files are
`backend/internal/{finance,provider,orchestration}/…**/maplerad*` plus two `backend/tests/fx/`
suites. Main deleted it deliberately in `254229cf4` (#884, 2026-10-23, *"remove Maplerad (fixes
tuition payment_not_confirmed)… Paystack is now the sole payment/VA provider"*), and
`git merge-base --is-ancestor 254229cf4 origin/prod` → **false**. Read naively, deploying main
would delete a live money-path provider.

It cannot, because it is switched off:

- The mount is guarded: `if cfg.FeatureMapleradEnabled && pool != nil { … r.POST("/api/webhooks/maplerad/go", …) }`
  (`prod:backend/internal/app/finance_routes.go:961`), and
  `FeatureMapleradEnabled: getEnvBool("FEATURE_MAPLERAD_ENABLED", false)` (`config.go:891`).
- Live probe on the deployed build: `curl -X POST …/api/webhooks/maplerad/go` → **404**
  (a control probe `POST /api/v1/fx/cards` → **401**, i.e. mounted-but-authenticated, so the
  404 is a real absence and not a GET/POST artifact).

**Verdict: `FEATURE_MAPLERAD_ENABLED` is not set on production; the Maplerad removal is a
no-op operationally.** Keep one confirmation for the owner (§11 Q1): read the *name list* of
production variables — never their values — so no secret is ever printed.

### 3.7 The prod-only residue that is not Maplerad

The other 10 prod-only files, to be consciously accepted as deletions or re-ported:

```
frontend-web/app/{page,about,service}.js                      # replaced by main's .tsx pages
frontend-web/src/components/referral/EarnClient.tsx
frontend-web/src/components/utility/UtilityPaymentClient.tsx
mobile-app/reactnative/app/(doctor)/profile/setup/{bank-account,tax-info}.tsx
mobile-app/reactnative/app/crypto/withdraw/otp.tsx
.github/workflows/development-deploy.yml
```

All trace to `44e3fb835`/`7b1dfb5b1` (Oct-01 / May-25) — i.e. main deleted them on purpose
later. None is load-bearing for a backend-only release (the customer site comes from main via
cPanel anyway), but a **merge** would resurrect the branch topology that contains them (§4).

---

## 4. Release-shape decision — needs owner sign-off

| | A. Merge `main` → `prod`, deploy prod | B. Cherry-pick a curated range onto `prod` | C. **Deploy a main-lineage sha directly; freeze `prod`** |
|---|---|---|---|
| Mechanism | `git merge origin/main` into `prod`, PR, then `railway up` from the merge | today's practice: N "port … onto prod" commits | `git worktree add --detach /tmp/x origin/main && railway up backend …` |
| Schema-vs-code | aligned | aligned for the picked subset only | **aligned, immediately** |
| Effort now | medium (resolve 2,728-path history mess) | **high and recurring** — 15 ports already, each hand-trimmed | **low** — the tree is already 758/758 with main's schema |
| Ongoing cost | still a fork to feed | forever | ends the fork |
| Loses prod-only work | re-adds deleted files as merge noise | no | no — the 23 files are deliberate main deletions (§3.7); snapshot first |
| Failure mode | the merge itself becomes a release | drift re-opens within weeks | the deleted provider/boost surfaces go dark in one step (both shown inert) |
| **Executable today?** | yes (manual `railway up`) | yes (manual `railway up`) | yes (manual `railway up`) — **and it is the only route that works**, because B's train cannot get past staging's F2 (§6.2) |

**Recommendation: C.** Rationale: the DB is already main's, the frontends are already main's,
staging is already 2 files from main's backend, and the fork's unique value is a disabled
provider plus 10 intentionally-deleted files. A is more ceremony for the same tree; B is the
pattern that created this plan. Concretely:

1. Tag the current fork tip — `git tag prod-fork-final 6f58f0b0a` and push the tag; make
   `prod` read-only (or delete the branch after a soak period, not before).
2. Deploy from `origin/main` per §6.
3. Adopt the invariant going forward: **`prod` is the environment, not the branch.** One
   release train (already `release.yml` on main), with the production database promoted by the
   scoped lane that already exists.

If the owner rejects C, fall back to A and re-run §3 against the merge commit, because the
23-file deletion set then needs a real review rather than a shrug.

---

## 5. Pre-flight gates — all read-only, all must pass before §6

| Gate | Check | Command / method | Pass criterion |
|---|---|---|---|
| **G1** | Deployment currency re-read | `curl -sS --http1.1 …/api/v1/public/build` on all three backends | prod still `d3401f574`; if not, re-baseline §2 before anything else |
| **G2** | Pin the release SHA to a CI-green main sha | `gh run list --workflow=ci.yml --branch main --limit 5`, take the newest `success` head | the sha you deploy has its own green row; **never** deploy "main right now" |
| **G3** | Release train reaches production | verdict line of the `release gate` job **+ the three `deploy Staging (…)` conclusions** | verdict `proceed` **and** all three staging legs `success`. Measured 2026-11-20 09:05Z: verdict **is** `proceed` and dev is 3/3 green, but **all three staging legs fail with F2 in every run since 2026-11-19 14:49Z** (`44547867538`, `44560489834`, `44629671567`, `44637142432`, `44644175704`) → `smoke Staging` is skipped → `deploy Production` is skipped. **This gate is RED right now.** See §6.2. |
| **G4** | RLS review complete | work package 3.4 | every policy on a prod-written table has a verdict row |
| **G5** | Env-var parity, **names only** | Railway dashboard / `railway variables … \| cut -d= -f1` | every key in main's `backend/.env.example` that main newly added is either set or has a safe default; print **no values** |
| **G6** | Client-exposure census | build metadata + `/v1/marketplace/boosts/*` | either no installed build calls `/boosts/tiers`, or main carries a one-line `tiers → BoostPricing` alias before the cut (§3.5) |
| **G7** | Rollback capacity proven | existing plan **Task 3**, still open | a dated dump of the prod DB **and a restore drill into a scratch database** — a backup never restored is not a backup |
| **G8** | Module-flag registry parity | `platform_module_registry` rows vs main's mount list | production serves no `readiness <> 'ready'` module as live; staging's two missing flags (`PHARMACY_SYMPTOM_SEARCH`, `HEALTH_TRIAGE`) show this class of gap is real |
| **G9** | Money-path smoke baseline captured *before* the window | `GET /api/v1/public/health`, plus the ledger's existing unauth route table | so §8 compares against a same-day baseline, not a month-old one |

### 5.1 A release-train defect found during re-check, which this release must survive

At 08:32Z today `36c8e666b` produced a Release run that concluded **`success`** while its
verdict line read **`### Release gate: noop_docs_only`** and every deploy leg was skipped.
That is correct behaviour for a docs commit — but the commit underneath it is not deployed
anywhere:

| sha | content | Release run | gate verdict | dev | staging | production |
|---|---|---|---|---|---|---|
| `f8890c06e` | #1095 — `fix(referrals): make admin code edits unique across all namespaces` (**backend**: `finance/referrals/service.go` + its live-DB test) | `44637142432` 11-19 23:22Z **failure** | ran | deployed | **failed** | skipped |
| `a05b8676e` | #1096 — the frontend-admin half of the same feature (2 files, `ReferralActivityPanel`) | `44644175704` 11-20 00:14Z **failure** | ran | 3/3 deployed | **3/3 failed** | 3/3 `skipped` |
| `36c8e666b` | #1101 — docs only | `44703323495` 11-20 08:32Z **success** | `noop_docs_only` | skipped | skipped | skipped |

So the referral-code-edit feature is **live on development and nowhere else** — the backend half
(#1095) and the UI half (#1096) each had their staging legs fail, production was skipped both
times, and the train will never revisit either sha. Staging's stamp proves it mechanically:
`backend-staging-new` still serves `773fe0285` — an *older* main-lineage commit (`773fe0285` is an
ancestor of `origin/main`, and `f8890c06e` is not an ancestor of `773fe0285`) — and its `backend/`
delta against main is *exactly* #1095's two files, i.e. staging predates #1095 and nothing else has
landed since.

Four consequences for this plan:

1. **Never read the lane as healthy from a `success` Release row.** G3 exists for exactly this;
   the 08:32Z run is the worked example.
2. **This release will land on top of whatever is stranded**, so the pre-cutover stamp read in
   G1 is the only honest baseline — re-derive it at execution time rather than quoting §2.
3. **The obvious recovery is the wrong one here.** `gh workflow run release.yml -f
   ref=<main tip>` is the documented rollback path, but release.yml deploys
   development→staging→**production** in one run, so dispatching it at any main-lineage ref
   would execute the very prod backend release §4 has not been signed off on.
4. **It does not self-heal, and that is the more important finding.** The usual way out of a
   stranding is "merge the next code change and let the train deploy the tip" — but with F2
   killing all three staging legs (§6.2), *the next code merge strands exactly the same way*:
   gate `proceed`, dev green, staging red, prod skipped. Measured on the two most recent code
   commits (`f8890c06e`, `a05b8676e`), so development is at `a05b8676e` while staging sits at
   `773fe0285` and production at `d3401f574` — three planes, three different commits, and the
   gap only widens with every merge. Consequence for this release: **do not wait for the train
   to tidy staging.** Refresh staging deliberately at the §5 G2 pin (`serviceInstanceDeploy`
   with `commitSha`, or `railway up` from a clean worktree) so it can serve as the canary for
   *this* release, and treat the F2 repair as its own open item, not a precondition we can
   hand to chance.

---

## 6. Cutover runbook (execute only after §4 and all of §5)

```bash
# 1. clean tree at the pinned sha — never from a dirty checkout, never from a worktree
#    whose node_modules are symlinked outside the workspace
git fetch origin && git worktree add --detach /tmp/prod-cut <G2_SHA> && cd /tmp/prod-cut

# 2. build + vet the exact tree being shipped (backend/ has its own go.mod)
cd backend && go build ./... && go vet ./... && cd ..

# 3. upload the backend service ONLY — see 6.1 for why
railway up backend --path-as-root --no-gitignore --service backend \
  --environment production --project e7dca861-3667-4d9a-8090-6d2f4d179ec2 \
  --detach --message <G2_SHA>

# 4. watch it, then §8
railway deployments --service backend --environment production
```

### 6.1 Do not use the `deploy-production` dispatch

`gh workflow run deploy-production.yml -f deploy_environment=production -f confirm_deploy=DEPLOY`
is the wrong tool here for two *measured* reasons:

- its `deploy Production (frontend-admin)` leg replaces the manually-uploaded main-lineage
  console with the prod-branch UI, **163 files behind** — it regressed the console on
  2026-11-18;
- its `deploy Production (frontend-web)` leg **fails at the Railway build** and has since
  Nov-16, because prod-branch `frontend-web` does not build.

A backend-only manual upload touches exactly one service.

### 6.2 F2 (Railway upload) is not a blocker for *this* runbook — but it blocks option B

`railway up` against **staging** dies with `Failed to fetch: error decoding response body` ×9 —
a Railway-side refusal on the request that *obtains the upload destination*, unrelated to
archive size (it lands ~0.7 s after `stamped backend/BUILD_COMMIT`, with `Indexing` /
`Uploading` / `bytes:` all zero, which is why `--verbose` can never surface a status).

**Measured 2026-11-20 09:05Z, this is not intermittent any more — it is total on staging.**
Every Release run since 2026-11-19 14:49Z has `deploy Staging (backend)`,
`(frontend-admin)` and `(frontend-web)` all failing with 9 decode errors each
(`44547867538`, `44560489834`, `44629671567`, `44637142432`, `44644175704`), while
`deploy Development (…)` is 3/3 green and the gate verdict is `proceed`. It is not billing
(`Your trial has expired` appears nowhere) and not the code (dev builds the same commit fine).

What that means for the decision in §4:

- **Option B is not executable today.** `release.yml` puts `smoke Staging` between staging and
  production, so with staging red the train cannot reach prod at any sha — merging more code
  will not fix it (see §5.1 item 4).
- **Options A and C are unaffected**, because this runbook does not use the train: it uploads
  the backend straight to the **production** environment with `railway up`, which is exactly
  the lane F2 does not touch (prod uploads have succeeded repeatedly, including the current
  `d3401f574`). The 08:32Z `noop_docs_only` run confirms dev legs and uploads are healthy
  generally — only staging's destination request is refused.
- **Refreshing staging for the canary needs the manual path**, not a merge:
  `railway api … serviceInstanceDeploy(serviceId, environmentId, commitSha:"<full sha>")`
  (**flat** args — `input:` is rejected), which is how staging got `773fe0285` on 2026-11-19
  at 15:48Z despite that sha's own train run failing. Never fire a manual refresh while a CI
  leg for the same environment is in flight — it ruins the F2 datum and can race the upload.
- The F2 repair itself is tracked separately (the `docs/devops/railway-upload-fault-report.md`
  ask, narrowed to Railway's edge logs for the destination-request). It is an **open item that
  this release works around, not one it waits for.**

---

## 7. Rollback

- **Code:** redeploy the previous known-good sha the same way — `railway up` from a clean
  worktree at `d3401f574`, or `serviceInstanceDeploy` of the prior deployment id. Target ≤5
  min. Keep `/tmp/prod-cut` until the soak ends.
- **Schema: do not plan a schema rollback.** The prod DB is *already* at `20271700000000`
  (§2); a code rollback returns to code that runs against that schema today, which is the
  state the DDL review in §3.3 found safe. Restoring the G7 dump would destroy production data
  for no benefit; a dump restore is only for a data-integrity incident, decided in the moment.
- **Decision to make before the window:** the maximum acceptable error rate and who calls it.

---

## 8. Post-deploy verification (read-only, in order)

1. `GET /api/v1/public/build` → commit == G2 sha, `started_at` inside the window. A green
   deploy row is not evidence; the stamp is.
2. Route table probe with **correct methods and mounted paths** (`-X POST` where the route is a
   POST; a GET on a POST route 404s and proves nothing): expect `POST /api/v1/fx/cards` → 401,
   `GET /api/connect/admin/contests` → 401, `POST /api/webhooks/maplerad/go` → 404 (dark
   before and after), `GET /v1/marketplace/boosts/pricing` → **200**, and
   `GET /v1/marketplace/boosts/tiers` → 404 **unless** the G6 alias was added, in which case it
   must also be 200. Compare against staging `773fe0285`, which already answers this exact
   pattern.
3. RBAC probe already in the scoped lane (`scripts/db/probe-rbac-grants.sh`, exit 0/1/2/3):
   `connect.contests.view` GRANTED for super-admin / system-admin / contest-manager.
4. Money paths, no test payments beyond what the owner allows: wallet balance read, KYC tier
   ladder read (`tier_limit_events`), one utility-bill quote, one restaurant menu read.
5. Error-rate and latency delta against the G9 baseline for the soak window.
6. `git worktree remove /tmp/prod-cut` only after 5 is clean.

---

## 9. Sequencing

| Step | Who | Blocking? |
|---|---|---|
| §4 decision (A / B / C) | **owner** | blocks everything |
| G2 pin + G5 + G9 | agent | no |
| G3 staging refresh at the G2 pin (manual — the train cannot do it, §6.2) | agent | **yes**, it is the canary |
| G4 RLS work package | agent, review output signed by owner | **yes** |
| G6 client census | owner (store metadata) | yes if mobile is exposed |
| G7 dump + restore drill | owner-approved credentials; agent drives | **yes** |
| G8 module flags | agent | no, but cheap insurance |
| §6 cutover | agent, inside an agreed window | — |
| §8 verification + soak | agent, escalation to owner | — |

Critical path is **G4 + G7**. Everything else is a command or two.

---

## 10. Effect on the 2026-11-12 plan

| Old task | New status | Why |
|---|---|---|
| Task 1 pin release SHA + evidence ledger | **superseded** by G1/G2 here | ledger numbers from 2026-11-12 are stale; re-read |
| Task 2 authoritative pending-migration list | **resolves to "none"** | prod DB 758/758, head `20271700000000`, drift 0/0 (run `44637503244`) |
| Tasks 4–6 replay / staging-to-0-pending / prod backlog in batches | **moot** | staging reported `Remote database is up to date`; both databases already match main's set — the batches were applied by the scoped lane |
| Task 3 dump + restore proof | **still open — now G7** | unchanged, and still the hard prerequisite |
| Tasks 7–10 config parity | **partly open — G5/G8** | the staging two-flag gap is the proof this class bites |
| Task 11 bring prod Go API to release SHA | **this document** | §4–§6 |
| Tasks 12–13 frontend config/env gaps | **mostly moot** | production frontends already run main lineage |
| Task 14 acceptance matrix, Task 15 mobile plane | **still open — §8 + G6** | mobile is the only real cross-plane risk left |
| Task 16 docs correction | open | `docs/devops/deployment-matrix.md`'s "last written 2026-10-17" claim is already disproven; after §4-C, rewrite the matrix to say `prod` is an environment |

Net: the schema half of the old plan finished on its own; what remains is code, config and
rollback capacity.

---

## 11. Questions for the owner (nothing here was assumed away)

1. **`FEATURE_MAPLERAD_ENABLED`** — confirm it is unset/false by reading the production
   variable **names** only. §3.6 infers "off" from a live 404; your dashboard can make it a
   fact in ten seconds.
2. Are there **Maplerad rows still in flight** (`virtual_accounts`, bills/transfers with
   provider `maplerad`, `status` not terminal)? A read-only count is enough; the schema is
   retained on main, so a non-zero answer is a data-migration question, not a code one.
3. Are there **installed mobile/web builds from `prod` lineage** still calling
   `/v1/marketplace/boosts/tiers` (G6)? If you don't want to census them, the cheap answer is a
   one-line alias on main before the cut.
4. Release shape **A / B / C** — recommend C (freeze the `prod` fork, deploy main-lineage).
5. Cutover window and the abort threshold (§9).
6. Do you want the RLS work package (G4) run as its own read-only PR, or as an appendix to
   this document? It is the only item that can delay the release.
7. **Who chases Railway on F2?** It is now the binding constraint on the whole pipeline, not
   just an annoyance: staging has had zero successful uploads for five consecutive Release runs
   (§6.2), which means the train cannot promote *anything* to production and staging is no
   longer a self-maintaining canary. The narrow ask that can actually be answered is Railway's
   edge-log status code for the destination-request on `backend-staging-new`. If you want me to
   file that with the evidence pack, say so; otherwise the release proceeds on the manual path
   and staging keeps drifting.
