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
endpoint has been breaking in production and getting hand-ported onto `prod` to compensate. The
fork carries **16 commits since the 2026-10-15 merge-base, 11 of them explicit
"port … onto prod" / "promote main to prod" releases** (§4, and the list is in 3.7's footnote).

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
| `origin/prod` head | `6f58f0b0a` → **`bb59c7129`** at 09:36Z re-check — #1104 ported the referral three-namespace fix onto `prod` (backend-only, blobs identical to main) | `git rev-parse origin/prod`, `git fetch` |
| Merge-base main↔prod | `94ad08c05`, **2026-10-15** | `git merge-base` |
| Commit-count diff | meaningless — main's history was gitleaks-rewritten, `prod`'s was not | `docs/reports/` + repo sweep 2026-11-18 |
| Differing paths main↔prod | **2,728** | `git diff --name-only origin/main origin/prod` |
| Backend content delta | **863 files, +124,037 / −8,225** (was 865 / +124,135 / −8,242 before #1104's port) | `git diff --stat … -- backend/` |
| Migration files: main / prod branch | **758 / 644** → 114 main-only | `git ls-tree -r --name-only … -- supabase/migrations` |
| **Migrations applied on the prod DB** | **758 rows, min `20260101000000`, max `20271700000000`** | read-only CI run `44637503244` (`ops-db-push.yml environment=production mode=list`) |
| Drift, either direction | **0 / 0** — prod DB ≡ main's file set, exactly | parsed `supabase migration list --linked` table from that run |
| Prod-only files (exist on `prod`, absent on main) | **22** (was 23; #1104's port made the referral file shared) | `git diff --diff-filter=A --name-only origin/main origin/prod` |
| Prod commits patch-absent on main | **14**, up from 10 because every squash-merged port gets its own patch-id even when the resulting blobs equal main's — this measures *branch ceremony*, not unreconciled code | `git cherry -v origin/main origin/prod` |
| Staging backend | `773fe0285`; delta vs main = **2 referral files, 0 migrations** | `git diff --name-only 773fe0285 origin/main -- backend/ supabase/migrations` |
| **Live backend stamps (09:05Z, re-read 09:36Z)** | dev `a05b8676e` · staging `773fe0285` · prod `d3401f574` — **three planes, three different commits**; `773fe0285` is a strict ancestor of main (it merely predates #1095), so this is drift, not divergence. **And `bb59c7129`, merged to `prod` on 2026-11-20, is served by nothing**: the branch has the fix, the production service does not. That is the fork's failure mode in one line — on `prod`, merge does not mean deploy, and there is no train that can make it so (§6.2) | `curl -s --http1.1 https://backend-{development-502c,staging-new,production-1b33d}.up.railway.app/api/v1/public/build`; hostnames from `scripts/ci/railway-urls.sh` @main |

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

### 3.4 Row-Level Security — **reclassified 2026-11-20: a standing client-read audit, not a cutover gate**

The census, **with units** (re-measured over the 114 migration files that differ between the two
trees; `git diff --diff-filter=M origin/prod origin/main -- supabase/migrations/` returns **empty**,
so all 114 are `--diff-filter=A` pure additions):

| statement class | statements | files containing one |
|---|---|---|
| `ENABLE ROW LEVEL SECURITY` | **124** | 51 |
| `CREATE POLICY` | 116 | 30 |
| `DROP POLICY` | 99 | 23 |

An earlier draft of this section cited only the two policy classes and never said the numbers were
*statements* rather than tables — and it omitted `ENABLE ROW LEVEL SECURITY` altogether, which is the
**largest** class and the one that actually changes behaviour: enabling RLS on a table that has no
policy denies every `anon`/`authenticated` read silently (`200 []`, or `42501` on a write) while
leaving `service_role` completely untouched.

**Why this cannot gate the deploy — three repo-proven facts:**

1. **The database is not moving in this release.** §2 established that the production DB is already
   at main's migration head with drift 0, so all 124 / 116 / 99 statements above are *already live in
   production today*, before any deploy. RLS is a property of the DB, and §4's A/B/C all leave the DB
   where it is.
2. **Nothing this release carries edits a live policy.** Every one of the 114 files is an addition; no
   modified-or-deleted migration exists between the tips. A release that adds only already-applied
   files cannot change the policy set.
3. **The only artifact this release deploys bypasses RLS by design.** `backend/internal/academy/assistant/store.go:13`
   states the repo's own model: *"The backend connects as service_role, which bypasses RLS; the policies
   in 20271300000010 are what protects the same tables from an app-issued key. Both matter, and neither
   replaces the other."* `config.go:1435` makes `SUPABASE_SERVICE_ROLE_KEY` a hard boot requirement.

So deploying the Go backend changes the RLS-governed surface by exactly zero. What RLS does govern is
**app-issued keys**, and none of them ship in this release. Measured exposure of that surface:

- **mobile** is the real client-direct reader: `mobile-app/reactnative/src/lib/supabase.ts:38` builds a
  `createClient(url, anonKey, …)`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` appears in 2 files, and **83** files
  under `app/`+`src/` call `.from(`. Those 83 are subject to the 124 `ENABLE ROW LEVEL SECURITY`
  statements *right now*, in production, independent of this deploy.
- **the web BFF is not** a client-direct reader: `frontend-web/app/api` has **507** `createAdminClient`
  references against **9** `createAnonClient`, and every anon site is an auth route
  (`login`, `otp-verify`, `resend-otp`, `verify-otp`) — admin clients use the service key and bypass RLS
  like the Go backend does.

Review procedure (unchanged, still worth running — but as its own read-only work item, on mobile's
timeline rather than the release's):

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

There is one precedent for asserting the lockdown mechanically —
`backend/internal/transport/pin_tables_postgrest_lockdown_live_db_test.go:158` checks that neither
`PUBLIC` nor the PostgREST roles hold table or column privileges on the PIN tables. Being honest about
its coverage: it is **not** matched by the `TestLiveDB_` filter, so it runs only through the repo-wide
`go test ./…` lanes (`ci.yml:395`, `_reusable-go-verify.yml:102`), it `t.Skip`s without
`TEST_DATABASE_URL`, it covers one table family rather than the 124-enable set, and the file does not
exist on the `prod` branch at all. It is a template for the audit, not evidence that the audit is done.

What this section is **no longer** entitled to claim: it was written up as "the release's only
genuinely unbounded unknown" and as the item that can delay the release. That was wrong — it was the
largest unknown *when the section assumed the release moved the schema*. It does not. The items that
can genuinely delay the cutover are §4 (the A/B/C decision), **G7** (no proven restore capacity), and
**G10** (the boost price list changes revenue silently). RLS is none of them.

### 3.5 Route-vs-client delta — what the release unmounts (work package B, nearly closed)

Diffed every Gin registration in `backend/` on both tips (`prod` 2,801 / `main` 3,149):
**6 exist on prod and not on main**, and no others:

```
POST   /api/webhooks/maplerad/go     GET /transfers/:ref     POST /customer
POST   /virtual-account              POST /bills             GET  /boosts/tiers
```

- Five are the **Maplerad** group — dark in production, proven in 3.6.
- One is a **breaking route rename on a live public endpoint**. At the HTTP-surface level it is the
  only unmounted route, but G6 showed it is not the only behavioral change — the same commit
  replaced the boost **pricing model**, which is the finding that matters (§3.5):

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
  → **Gate G6 is now measured, and it revokes the cheap version of that fix.** The alias
  `base.GET("/boosts/tiers", h.BoostPricing)` was written here assuming the two endpoints are
  interchangeable. They are not, and this correction is the release's second real finding:

  - **Different payload shapes.** prod's `BoostTiers` (`handler.go:578`) returns a JSON
    **array** of `{tier, duration_days, price_kobo, weight}` built from `ListBoostPackages`
    filtered on `is_active` (`service_boost.go:45`); main's `BoostPricing` returns a JSON
    **object** `{daily_rate_kobo, preset_duration_days, min_duration_days, max_duration_days}`
    (`model.go:336`). The legacy client wraps that call in
    `client.ts:153` — `arr = Array.isArray(v) ? v : []` — so aliasing `tiers` to `pricing`
    converts a loud 404 into a **silently empty tier list**. That is a worse outcome, not a fix.
  - **The purchase contract changed as well.** `CreateBoostInput` is `{listing_id, tier, ends_at}`
    on prod (`model.go:477`) and `{listing_id, duration_days, ends_at}` on main (`model.go:525`)
    — **`tier` no longer exists**, and gin's `ShouldBindJSON` ignores unknown keys instead of
    rejecting them. Real compatibility is therefore the read route **plus** re-accepting `tier`
    in the money path.
  - **But there is no silent-mispricing risk — that was the thing worth ruling out.**
    `app/marketplace/boost/[listingId].tsx:89` builds the selection as
    `mode === 'package' ? { tier } : { endsAt }`: exactly one, never both. A tier-only body
    reaching main arrives at `ComputeBoostQuote(0, nil)` → **400 "duration_days or ends_at is
    required"** (`service_boost.go:103`), and the Confirm button is gated on `!!selectedTier`
    (line 74), which a 404 `useBoostTiers` can never satisfy. **The legacy package picker fails
    closed; nobody can be charged a price they were not shown.**
  - **The custom-date path survives the cut untouched.** That same screen's `mode === 'custom'`
    branch sends `?ends_at=` and posts `{endsAt}`; main's `GetBoostQuote` reads `ends_at`
    (`handler.go:609`) and prices duration × the admin daily rate. Legacy builds keep boosting —
    by custom dates — after the release.

  Net: the release breaks the **package picker** for `prod`-lineage builds, breaks it safely, and
  leaves a working boost path. Restoring the picker is a ~20-line additive read endpoint (the
  pieces already exist on main: `repository.go:1139 ListBoostPackages`, and `service_boost.go:598`
  `BoostTier` carries prod's exact JSON tags) **plus** a money-path change to re-accept `tier`.
  The read half on its own only re-enables a screen that 400s on confirm, so it is **not** a safe
  reflexive shim — it belongs with §11 Q3 as an explicit owner decision, not a pre-flight to-do.

- **The measured consequence nobody asked about: this release changes what boosting costs in
  production.** `ComputeBoostQuote` prices **duration × `mkt_boost_daily_rate`**, and
  `mkt_boost_packages` survives on main only as admin-console state — `admin_handler.go:241` is
  its sole reader, and every purchased boost is recorded as `boostRowTier = "daily-rate"`
  (`service_boost.go:142`). Production still charges the package table today. Measured live from
  `GET /boosts/tiers` on the production BFF:

  | legacy package | days | charged today | effective ₦/day | post-release at the seeded ₦100/day |
  |---|---|---|---|---|
  | `start` | 7 | ₦500 | ₦71 | **₦700** (+40%) |
  | `vip` | 14 | ₦2,000 | ₦143 | **₦1,400** (−30%) |
  | `vip_gold` | 30 | ₦5,000 | ₦167 | **₦3,000** (−40%) |
  | `diamond` | 30 | ₦15,000 | ₦500 | **₦3,000** (−80%) |
  | `enterprise` | 60 | ₦50,000 | ₦833 | **₦6,000** (−88%) |

  Those five rows are byte-identical to the seed in `20270168000000_marketplace_boost_pricing_config.sql`,
  so **no admin has ever repriced packages in production** — this is the migration default still
  in force, which is what makes the delta real rather than stale config. A "code-only move" is
  therefore **not revenue-neutral** on the one marketplace money path that is live.
- **The 500 risk this creates is closed by that same migration, and dev's 500 is now explained.**
  `GetBoostDailyRate` (`repository.go:1196`) has **no fallback** — a missing `id='default'` row is
  `wrapInternal` → 500, and it sits on the *purchase* path, not merely the display route. Left
  alone that would have taken out all boost purchases in production. But the migration seeds the
  rate (`INSERT INTO public.mkt_boost_daily_rate (id, daily_rate_kobo) VALUES ('default', 10000)`),
  and §2 proves prod's DB is at main's migration head with drift 0 — so the row exists there. That
  is precisely why development answers `/boosts/pricing` → **500**: dev's DB never got that seed.
  New gate **G10** makes this an explicit sign-off rather than an accident of history.

- **Exposure of those legacy builds cannot be measured from here — an owner question, not a gate
  failure.** `gh secret list` shows no Expo/EAS-named secrets, so CI has never produced a mobile
  release; installed builds are manual and their source tree is unknown. prod's
  `mobile-app/reactnative/eas.json` sends the `production` profile to
  `frontend-web-production-9259` — which answers `/boosts/tiers` → **200** right now, measured —
  and its `staging` / `preview` / `staging-aab` profiles to `frontend-web-staging-ec46`, a host
  **absent from `scripts/ci/railway-urls.sh`**. It is genuinely serving, not a dead hostname: it
  answers `{"error":{"code":"NOT_FOUND","message":"resource not found"}}` — the *app's* envelope —
  whereas an unprovisioned Railway host returns the *edge's*
  `{"status":"error","code":404,"message":"Application not found"}` (confirmed against the stale
  `backend-production-upstream`). Anyone reading "the staging frontend" as one place should
  re-check that fourth host during the cutover §8 probes.
- **Re-measured 2026-11-20 09:05Z**, and one new fact matters for §8: development (`a05b8676e`)
  answers `tiers` → 404 (as expected) but **`pricing` → 500** `INTERNAL_ERROR`, where staging
  returns the payload (`daily_rate_kobo:10000`, presets `[1,3,7,14,30]`). Same code, different
  database — dev's marketplace config row is absent. So **staging is the host that proves the
  post-release shape**; a red `pricing` probe on dev is a data gap, not a contract break, and
  must not be read as a reason to hold the release.

Two method corrections that this scan forced, worth keeping so a re-run doesn't repeat them:
`wallets/:currency` and `wallet/convert` **do** exist on main — an app-package-only grep
claimed otherwise, so scope route greps to all of `backend/`. And group prefixes matter:
`/boosts/tiers` is really `/v1/marketplace/boosts/tiers`, which is why a probe of an
un-prefixed path "404s" harmlessly. Probe with the mounted path and the registered HTTP
method.

### 3.6 Maplerad — the headline worry, closed with live evidence

`prod` still contains the whole provider: 13 of the 22 prod-only files are
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

The other 9 prod-only files (22 total, 13 of them Maplerad per §3.6), to be consciously accepted as
deletions or re-ported:

```
frontend-web/app/{page,about,service}.js                      # replaced by main's .tsx pages
frontend-web/src/components/referral/EarnClient.tsx
frontend-web/src/components/utility/UtilityPaymentClient.tsx
mobile-app/reactnative/app/(doctor)/profile/setup/{bank-account,tax-info}.tsx
mobile-app/reactnative/app/crypto/withdraw/otp.tsx
.github/workflows/development-deploy.yml
```

**The port treadmill, measured at 09:36Z** — `git log --oneline $(git merge-base origin/prod
origin/main)..origin/prod` gives 16 commits, and these 11 are the ones whose subject is a
port/promote rather than a feature in its own right:

```
bb59c7129  fix(referrals): port the three-namespace code uniqueness rule onto prod (#1104)
6f58f0b0a  fix(connect): seed the connect.contests.view permission onto prod (#1077)
d3401f574  fix(social): put the counterparty on GET /requests so the receiver can act (#1071)
2f51561fb  fix(voting): port the admin contest list onto prod (#1068)
d9a2ced41  feat(academy): port the assessment plane (question bank, review, exams) (#1039)
76f1a6103  feat(admin): port the searchable, domain-grouped sidebar menu (#1033)
973b010cc  fix(academy): port the TMFA topic-mastery BFF plane (#1031)
616900caf  fix(academy): port the TMFA topic-mastery console (#1030)
5ab7c9cc0  fix(health): port the telemedicine intake fixes onto prod (#1025)
545b01cec  chore: promote main to prod — post-#830 tail (#832)
41c19ea2b  chore: promote main to prod (KYC automation, VertoFX flag-off…) (#830)
```

The other five are two merges of main (#785, #792), one mobile-pin fix carried with a dependabot
guard (#689), the `readiness` axis feature (#1005) and the launch-rails release (#787).

Two of those eleven (#1077, #1104) landed after the last full sync, and #1104 landed *during the
writing of this plan* — the pace is roughly a port every two days, which is the cost side of
option B written out plainly.

All trace to `44e3fb835`/`7b1dfb5b1` (Oct-01 / May-25) — i.e. main deleted them on purpose
later. None is load-bearing for a backend-only release (the customer site comes from main via
cPanel anyway), but a **merge** would resurrect the branch topology that contains them (§4).

---

## 4. Release-shape decision — needs owner sign-off

| | A. Merge `main` → `prod`, deploy prod | B. Cherry-pick a curated range onto `prod` | C. **Deploy a main-lineage sha directly; freeze `prod`** |
|---|---|---|---|
| Mechanism | `git merge origin/main` into `prod`, PR, then `railway up` from the merge | today's practice: N "port … onto prod" commits | `git worktree add --detach /tmp/x origin/main && railway up backend …` |
| Schema-vs-code | aligned | aligned for the picked subset only | **aligned, immediately** |
| Effort now | medium (resolve 2,728-path history mess) | **high and recurring** — 11 hand-ports since Oct-15, each trimmed by hand, and #1104 landed while this plan was being written | **low** — the tree is already 758/758 with main's schema |
| Ongoing cost | still a fork to feed | forever | ends the fork |
| Loses prod-only work | re-adds deleted files as merge noise | no | no — the 22 files are deliberate main deletions (§3.7); snapshot first |
| Failure mode | the merge itself becomes a release | drift re-opens within weeks | the deleted provider/boost surfaces go dark in one step (both shown inert) |
| **Executable today?** | yes (manual `railway up`) | yes (manual `railway up`) | yes (manual `railway up`) — **and it is the only route that works**, because B's train cannot get past staging's F2 (§6.2) |

**Recommendation: C.** Rationale: the DB is already main's, the frontends are already main's,
staging is already 2 files from main's backend, and the fork's unique value is a disabled
provider plus 10 intentionally-deleted files. A is more ceremony for the same tree; B is the
pattern that created this plan. Concretely:

1. Tag the current fork tip — `git tag prod-fork-final bb59c7129` and push the tag; make
   `prod` read-only (or delete the branch after a soak period, not before). Note the target moved
   twice while this plan was being written (`6f58f0b0a` → `bb59c7129`, #1104, the 11th port since
   the merge-base — see §3.7's list), which is itself the argument for this option: **re-run
   `git rev-parse origin/prod` at sign-off and tag whatever it says.**
2. Deploy from `origin/main` per §6.
3. Adopt the invariant going forward: **`prod` is the environment, not the branch.** One
   release train (already `release.yml` on main), with the production database promoted by the
   scoped lane that already exists.

If the owner rejects C, fall back to A and re-run §3 against the merge commit, because the
22-file deletion set then needs a real review rather than a shrug.

**One side-effect worth putting in front of the owner:** `bb59c7129` (#1104, the referral
three-namespace uniqueness rule) is merged onto `prod` but served by nothing, while `main`
already contains the same fix as `f8890c06e` (#1095). Any option that deploys main lineage to the
production backend therefore makes that port live **and** retires it; any option that waits leaves
the fix written into a branch that cannot reach an environment. Same for `d3401f574` (#1071) — it
is deployed, so it is already paid for, but it is only in the running code because someone
railway-upped it by hand.

---

## 5. Pre-flight gates — all read-only, all must pass before §6

| Gate | Check | Command / method | Pass criterion |
|---|---|---|---|
| **G1** | Deployment currency re-read | `curl -sS --http1.1 …/api/v1/public/build` on all three backends | prod still `d3401f574`; if not, re-baseline §2 before anything else |
| **G2** | Pin the release SHA to a CI-green main sha | `gh run list --workflow=ci.yml --branch main --limit 5`, take the newest `success` head | the sha you deploy has its own green row; **never** deploy "main right now" |
| **G3** | Release train reaches production | verdict line of the `release gate` job **+ the three `deploy Staging (…)` conclusions** | verdict `proceed` **and** all three staging legs `success`. Measured 2026-11-20 09:05Z: verdict **is** `proceed` and dev is 3/3 green, but **all three staging legs fail with F2 in every run since 2026-11-19 14:49Z** (`44547867538`, `44560489834`, `44629671567`, `44637142432`, `44644175704`) → `smoke Staging` is skipped → `deploy Production` is skipped. **This gate is RED right now.** See §6.2. |
| **G4** | ~~RLS review complete~~ → **not a gate: reclassified 2026-11-20 as a standing client-read audit** | §3.4 census + `--diff-filter=M` + `store.go:13` | **Passes by construction, for the reason the original row got backwards.** The 124 `ENABLE ROW LEVEL SECURITY` / 116 `CREATE POLICY` / 99 `DROP POLICY` statements in the 114 main-only migrations are **already live** (prod DB is at main's head, drift 0, §2), all 114 files are pure **additions** (zero modified), and the one artifact this release deploys connects as `service_role`, which the repo documents as bypassing RLS. A backend-only deploy therefore cannot change the RLS-enforced surface. What is still open is **not** a release risk: 83 mobile files read Supabase directly under the anon key and need the §3.4 verdict table on their own timeline. |
| **G5** | Env-var parity, **names only** — **measured 2026-11-20, GREEN** | `railway variables --environment production --service backend …` parsed to the name column **only** | Production has **131** variables. Of the **20 keys main added beyond `prod`'s `.env.example`**, **19 are absent** from production — and that is **safe**: each has a compiled default, verified on `origin/main` — `ESTATE_CODE_RATE_PER_MIN`→10, `ESTATE_GUARD_RATE_PER_MIN`→30, `PARCEL_INSURANCE_MIN_PREMIUM_KOBO`→200000, `FOOD_RIDER_LOCATION_RETENTION_DAYS`→30, `CONSULT_MEDIA_PROVIDER`→"livekit", `WEB_APP_BASE_URL`→`https://www.spotlightng.com` (`config.go:1366`, the exact live customer domain), `R2_INSURANCE_BUCKET`→"" with a documented `R2_BUCKET` fallback. The 13 `FEATURE_*` keys being unset means those features stay **off** in production after the cut, so the release does not silently enable new surfaces — it narrows blast radius. |
| **G6** | Client-exposure census — **measured 2026-11-20, see §3.5** | `git grep` on both tips + live BFF probes + the prod boost screen | **Resolved as to behavior, open as to audience.** The prod-lineage package picker fails **closed** (`arr()` empties an object; a `tier`-only POST 400s; Confirm needs `!!selectedTier`), the custom-date boost path survives unchanged, and there is **no silent-mispricing path**. What remains is the owner's §11 Q3: how many installed `prod`-lineage builds exist. A `tiers → pricing` alias is **not** a valid shim (different payload shape) — see §3.5. |
| **G7** | Rollback capacity proven | existing plan **Task 3**, still open | a dated dump of the prod DB **and a restore drill into a scratch database** — a backup never restored is not a backup |
| **G8** | Module-registry parity — **measured 2026-11-20, GREEN** (and the row here cited a table that does not exist) | `supabase/migrations/20271600000000_mobile_menu_modules.sql` + `backend/internal/modules/` on both tips | **Name correction first: there is no `platform_module_registry`.** The real tables are `public.platform_modules`, `public.platform_module_environments`, `public.platform_module_audit`, read by `backend/internal/modules/service.go`; the string `platform_module_registry` appears only in three `docs/` files and in this plan's own earlier draft. Substantively the gate passes by construction: the tile rows are **migration-seeded**, both tips carry the same `modules` package (`handler.go`/`service.go`/`modulegate/` on `prod` too), and prod's DB is provably at main's head with drift 0 (§2) — the seed was applied to production on the #1058 lane (payload verified 35 = 31+7−3). Note the asymmetry this exposes: `prod`'s **branch** does not contain `20271600000000` (its newest module migration is `20271408000100_module_readiness.sql`) while its **database** has those rows — §2's schema-ahead-of-code skew again, and another reason a `db push` from the `prod` branch would not reproduce production. |
| **G9** | Money-path smoke baseline captured *before* the window — **done 2026-11-20, see §5.2** | backend-host probes with correct methods, all three planes | baseline recorded (health 200 ×3, fx/cards 401 prod+staging, admin/contests 401 ×3, maplerad 404 ×3, boost pair as expected); §8 now compares against a same-day table, and it establishes **staging — not dev — as the canary assertion** |
| **G10** | **Post-release boost price is an approved price list** (new, from §3.5) | read-only DB probe of `mkt_boost_daily_rate` + `mkt_boost_packages` on production, via the `ops-db-push-scoped.yml` pattern | the `id='default'` row exists (else every boost purchase 500s — `GetBoostDailyRate` has no fallback), **and** ₦100/day flat is the price the owner actually wants, given it replaces a ₦500–₦50,000 package ladder (`diamond` −80%, `enterprise` −88%) |

**G5 method warning — the recipe written here originally was unsafe.** It said
`railway variables … | cut -d= -f1`, assuming `KEY=VALUE` lines. Railway 5.71 actually prints a
Unicode box table (`║ NAME │ VALUE ║`), so there are no `=` delimiters to cut on: that pipeline
returns nothing useful **and** any attempt to eyeball the raw output puts secret fragments on
screen, which happened once during this review before the format was understood. Parse the name
column only —
`awk -F'│' 'NF>1 {cell=$1; gsub(/[║ ]/,"",cell); if (cell ~ /^[A-Z][A-Z0-9_]{2,}$/) print cell}'`
— pipe it straight to a file, and delete the raw dump (`rm -f`) once parsed. Do not `cat`, `head`,
or mask-print the unfiltered output.

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

### 5.2 G9 money-path baseline, captured read-only 2026-11-20 ~11:50Z

Probed against the **backend hosts directly** (not through a BFF, so no proxy can soften a
status), with the registered HTTP method each route declares:

| plane | build stamp | `GET /api/v1/public/health` | `POST /api/v1/fx/cards` | `GET /api/connect/admin/contests` | `POST /api/webhooks/maplerad/go` | `GET /v1/marketplace/boosts/tiers` | `GET /v1/marketplace/boosts/pricing` |
|---|---|---|---|---|---|---|---|
| production | `d3401f574` | 200 | 401 | 401 | 404 | **200** | 404 |
| staging | `773fe0285` | 200 | 401 | 401 | 404 | 404 | **200** |
| development | `a05b8676e` | 200 | **404** | 401 | 404 | 404 | **500** |

Four things this settles:

1. **The stamps re-confirm §2 and confirm nothing deployed** during this review — all three still
   report the same commits measured at 09:05Z.
2. **Staging is the exact expected post-cutover answer set** for the boost pair: `tiers` 404,
   `pricing` 200. §8 step 2 should assert that, not the production row.
3. **Development is not a valid canary**, twice over: `/boosts/pricing` → 500 (no
   `mkt_boost_daily_rate` seed row — §3.5/G10) *and* `POST /api/v1/fx/cards` → **404** where the
   other two planes return 401. A 404 on a registered POST means the route is not **mounted**,
   which is flag-gating (`FEATURE_FX_ENABLED` is set in production and absent on dev), not a
   contract difference. So a green dev probe proves nothing about prod, and a red one proves less.
4. **Maplerad is dark on all three planes** (404 with the correct POST method), independently
   re-proving §3.6 — main's deletion removes dead code, not a live provider.

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
   `GET /v1/marketplace/boosts/tiers` → **404, and that is the expected post-release answer**
   (§3.5: no alias is being added, so a 200 here would mean an unintended route came back). The
   legacy app's custom-date boost path is unaffected. Compare against staging `773fe0285`, which
   already answers this exact pattern.
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
| G4 RLS client-read audit (§3.4) | agent, review output signed by owner | **no** — reclassified 2026-11-20: the DB is not moving and the backend is `service_role`, so nothing in this release can alter RLS behaviour. Runs in parallel, off the critical path. |
| G6 client census | **agent — done** (§3.5: fails closed, custom-date path lives) | owner only for **how many** legacy builds exist |
| G7 dump + restore drill | owner-approved credentials; agent drives | **yes** |
| G8 module flags | agent | no, but cheap insurance |
| G10 boost price read-only probe + owner sign-off (§3.5) | agent probes, **owner decides the number** | **yes on business grounds** — it changes revenue silently otherwise |
| §6 cutover | agent, inside an agreed window | — |
| §8 verification + soak | agent, escalation to owner | — |

Critical path is **§4 + G3 + G7 + G10**. G4 came off it on 2026-11-20 (§3.4 reclassification);
everything else is a command or two.

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
   `/v1/marketplace/boosts/tiers` (G6)? The behavior is settled — §3.5 shows the picker fails
   closed and custom-date boosts keep working, so this is now purely an **audience** question:
   how many manual builds are out there, and is a broken *package* picker acceptable for them or
   worth the ~20-line read endpoint **plus** re-accepting `tier` in `CreateBoostInput`? (A read
   alias alone is not the cheap answer — it was claimed here earlier and is wrong; it yields an
   empty list that then 400s on confirm.)
4. Release shape **A / B / C** — recommend C (freeze the `prod` fork, deploy main-lineage).
5. Cutover window and the abort threshold (§9).
6. Do you want the RLS client-read audit (§3.4) run as its own read-only PR, or as an appendix to
   this document? **Note the correction:** this section previously told you RLS was "the only item
   that can delay the release". It is not — see the reclassification. The things that can actually
   delay the cutover are this §4 decision, **G7** (rollback is unproven until a restore drill runs)
   and **G10** (the boost price list changes revenue silently). If you want a single "what is blocking
   me" list, it is those three.
7. **Who chases Railway on F2?** It is now the binding constraint on the whole pipeline, not
   just an annoyance: staging has had zero successful uploads for five consecutive Release runs
   (§6.2), which means the train cannot promote *anything* to production and staging is no
   longer a self-maintaining canary. The narrow ask that can actually be answered is Railway's
   edge-log status code for the destination-request on `backend-staging-new`. If you want me to
   file that with the evidence pack, say so; otherwise the release proceeds on the manual path
   and staging keeps drifting.
8. **Is ₦100/day the boost price you want in production?** This is the one item in the whole
   review that changes revenue, and it arrived as a side-effect of a route rename rather than a
   decision (§3.5). After the cut every boost is `duration × daily_rate`, and the five legacy
   packages stop being charged: `enterprise` 60 days goes ₦50,000 → ₦6,000, `diamond` 30 days
   ₦15,000 → ₦3,000, while `start` 7 days rises ₦500 → ₦700. If the ladder was intentional, the
   fix is a number in the admin pricing console (`PUT /admin/pricing/boosts/daily-rate`) — but it
   has to be set **deliberately**, because the seeded default will otherwise ship silently. This
   is gate **G10**, and with G4 off the critical path it is the only pre-flight that blocks this
   release on business grounds rather than on infrastructure.
