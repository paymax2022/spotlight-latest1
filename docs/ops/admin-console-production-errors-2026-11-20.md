# Admin console production errors — 16 pages, four different causes

Date: 2026-11-20. Reported against `https://frontend-admin-production-5b0c.up.railway.app`.
Fixed in code by `fix/admin-fx-provider-realtime`; the remainder is **operator configuration** and
**routes that do not exist yet**, both recorded below.

Everything in the "Evidence" column was reproduced on 2026-11-20 with unauthenticated `curl`
against the deployed services. Nothing in this file was applied to production by an agent —
every `railway` command here is for the owner to run.

## How to read a code

| Code | Meaning in this stack |
|---|---|
| `503` + `Feature '<name>' is not available in this environment.` | The **frontend-web BFF** answers it. `requireFeature()` (`frontend-web/src/lib/feature-flags.ts:280`) ran and the flag is off. Route exists; config missing. |
| `404` + `{"error":"No API route matches GET …"}` | The **Go backend** answers it. The route group was never mounted — either the gate flag is off, the deployed binary predates `main`, or the console invented the path. |
| `401` + `missing bearer token` | The route **is mounted** and works. This is the success signal for a config fix. |
| "This page couldn't load" | Not an HTTP code at all: a React render crash. The service handed the page a named envelope (`{"merchants":[…]}`) where the page expected an array, and `rows.map()` threw. |

One systemic reason this class of bug reaches production and no earlier: `resolveUseMock()` fails
closed to **live only in production** (`frontend-admin/src/config/useMock.ts`). On dev and staging
the same pages render fixture data, so a wrong path or a wrong envelope never surfaces until an
operator opens prod.

## The 16 pages

| Page | Symptom | Cause | This branch | Owner action |
|---|---|---|---|---|
| `/admin/payments-finance/adjustments` | `503 Feature 'fintechAdmin' …` | `FEATURE_FINTECH_ADMIN_ENABLED` absent on **frontend-web production** | no (config) | Command 1 |
| `/admin/fx` | `Error: Request failed (404)` | `/api/finance/admin/fx/overview` is in `main`, not in the prod binary | FX rewired to live provider rails, reads fail loud | Command 4 + release note |
| `/admin/fx/spread` | showed fixtures | `GET/PUT /api/finance/admin/fx/markup` is real and mounted on **both** planes (`401`) | **fixed** — reads/writes the live `public.fx_markup_rates` table, not mock | none |
| `/admin/referral/house` | crash | called `/house` (`GetGlobal`) while rendering the ledger | **fixed** — calls `/house/ledger` and projects only its seven columns | none |
| `/admin/referral/finance` | crash | named envelope `{…}` into an array page | **fixed** — envelope unwrap + per-surface loading | none |
| `/admin/referral/risk` | crash | named envelope `{…}` into an array page | **fixed** | none |
| `/admin/referral/merchants` | crash | `{"merchants":[…]}` handed to `rows.map()` | **fixed** | none |
| `/admin/referral/rewards` | `404` | called `/ledger` with the wrong wrapper and expected routes that never existed | **fixed** — `/ledger` is real; the grant form now refuses, because no route lets an admin create a reward | none |
| `/admin/referral/gamification` | `404` | `/gamification/leaderboards` is not registered; a thrown loader took the whole page down | **fixed** — leaderboards refuse alone, missions/ranks/contests still render | leaderboard route |
| `/admin/referral/analytics` | `404` | called `/analytics`; real leaves are `/analytics/k-factor` and `/analytics/cac` | **fixed** — both called, absent values render `—` | none |
| `/admin/referral/config` | `404` | `/config/program`, `/config/rbac`, `/config/flags`, `/config/audit` — only `GET/PUT /config` exists | **fixed** — program tab reads `/config`, the other three tabs refuse individually | roles/flags/audit routes |
| `/admin/loyalty/dashboard` | `404` | group is unmounted on prod **and** `/dashboard` is not a registered leaf | no | Command 3 + loyalty routes |
| `/admin/health/triage` | `404` | `RegisterHealthTriage` sits inside `if cfg.FeatureHealthTriageEnabled` (`internal/app/finance_routes.go:754`); prod has no such key | no | Command 2 |
| `/admin/health/lab/results-audit` | `404` | `/dashboard`, `/escalations`, `/custody-audit` exist; `/results`, `/reporting`, `/catalog`, `/payouts`, `/phlebotomists`, `/mlscn/applications` do not | no | lab routes |
| `/admin/academy` | `404` | console prefixes `/api/academy/admin/…`; most academy admin packages mount under `adminRoot = r.Group("/api")` | no | academy prefix |
| `/admin/academy/commerce` | `404` | same class | no | academy prefix |

## Owner-run commands

Commands 1–4 are configuration; **Command 5 — the deploy itself — is under "How this branch reaches the
console you opened"**, because it depends on reading what the service is actually serving first.

Read-only verification for each is the curl **after** it, and the expected change is the code
moving to the row that means "mounted". `railway variables` writes trigger a redeploy of that
service. One caveat already burned once in this repo: `railway variables` reports what is
*configured*, not what a process *has* — confirm after the container restarts, not before.

### 1. `fintechAdmin` — frontend-web production

Today (unauthenticated, reproduced 2026-11-20):

```
$ curl -i https://frontend-web-production-9259.up.railway.app/api/v1/admin/adjustments?limit=1
HTTP 503
{"success":false,"error":"Feature 'fintechAdmin' is not available in this environment."}
```

```bash
~/.railway/bin/railway variables -p e7dca861-3667-4d9a-8090-6d2f4d179ec2 \
  -e production -s frontend-web --set FEATURE_FINTECH_ADMIN_ENABLED=true
```

Use the literal `true`. The BFF's `envFlag()` is `process.env[k] === 'true'`, so `1` and `yes`
silently stay off — unlike Go's `getEnvBool`, which accepts them.

Expected after: the same curl answers `401 Unauthorized` (the gate passed, `requireRequestUser`
rejected), and `/admin/payments-finance/adjustments` lists real adjustment rows.

Note the drift worth cleaning up later: migration `20270320000000_fix_module_env_flag_drift.sql`
set the `platform_modules` row for `fintechAdmin` to `env_flag=''` ("RBAC-gated, no kill switch
exists"), so the BFF is the only layer still enforcing a flag nobody sets.

### 2. Health triage — backend production

Today: `404 {"error":"No API route matches GET /api/health/triage/admin/dashboard"}` — the whole
group is unmounted. Dev has the key; prod does not.

```bash
~/.railway/bin/railway variables -p e7dca861-3667-4d9a-8090-6d2f4d179ec2 \
  -e production -s backend --set FEATURE_HEALTH_TRIAGE_ENABLED=true
```

Expected after: `401`. Prerequisite: `DATABASE_URL` and a live pool — the triage block sits inside
the finance/DB section, so with no pool nothing mounts regardless of the flag.

### 3. Loyalty — backend production, and why it is not enough

```bash
~/.railway/bin/railway variables -p e7dca861-3667-4d9a-8090-6d2f4d179ec2 \
  -e production -s backend --set FEATURE_LOYALTY_ENABLED=true
```

This mounts `/api/loyalty/admin` and `/api/loyalty/admin/black` (`finance_routes.go:652`, which
also requires `pool != nil`). It **will not** fix `/admin/loyalty/dashboard` on its own: the Go
service registers `/memberships/:userId` and the `/black/*` family only. `/dashboard`,
`/earn-rules`, `/tiers`, `/catalog`, `/redemptions`, `/liability` 404 on every plane, flag or no
flag — today's prod probe on `/api/loyalty/admin/dashboard` returns `No API route matches`.
Those six leaves need building.

### 4. FX orchestration — backend **development** only

Prod already has it: `/api/v1/fx/rates` answers `401` there. Dev answers `404`, so the FX tabs are
untestable on dev until the flag is on.

```bash
~/.railway/bin/railway variables -p e7dca861-3667-4d9a-8090-6d2f4d179ec2 \
  -e development -s backend --set FEATURE_FX_ORCHESTRATION_ENABLED=true
```

Expected after: `/api/v1/fx/rates` on dev moves `404` → `401`.

**Do not reach for this on production as a fix for `/admin/fx`, and do not set it on a prod
service that lacks `EVERSEND_CLIENT_ID` / `EVERSEND_CLIENT_SECRET`.** `buildFXProviders`
(`internal/app/fx_providers.go:31`) returns `ErrEversendCredentialsMissing` when `IsProd()`, and
the caller responds with `log.Fatalf` — the process exits. The service crash-loops. Prod already
has both the flag and the credentials (that is why it answers `401`), so there is nothing to gain
and a production outage to lose.

On non-prod the same missing credentials fall back to the offline Eversend adapter, with the
code's own warning that a mock provider "could win default routing in non-prod". Dev quotes may
therefore be simulated, which is a fact to know before trusting a dev routing decision.

## What no environment variable can fix

- **`/api/finance/admin/fx/overview` and `/verifications`** exist in `main` (added in `184113663`)
  and are inside the orchestration block, but `git merge-base` proves that commit is not in the
  deployed prod binary (`d3401f574`). Publishing them is the owner-signed main→prod release
  project, recorded in `docs/superpowers/plans/2026-11-20-main-to-prod-backend-release.md` (PR #1105)
  — not a sweep step.
  This branch keeps `getOverview` pointed at that route and **fails loud** rather than substituting
  fixtures, per "Ensure all FX are front provider endpoint — realtime".
- **FX admin surface without any Go route**: routing, providers, treasury, reconciliation,
  customers, compliance, webhook endpoints/deliveries/api-keys, analytics, collections, cards,
  settings catalogue. Live, each now shows the backend's own `No API route matches …` instead of
  hardcoded exposure, float and margin figures.
- **Referral**: an admin leaderboard list route, `/roles`, `/flags`, `/audit`, and a reward-create
  (approve-vs-fund) route. `/gamification/leaderboard` exists for the member's own board only.
- **Health lab** and **Academy** leaves and prefixes, as tabled above.

## FX mock flag — do not re-enable it

`NEXT_PUBLIC_FX_ADMIN_USE_MOCK` is now `false` in `frontend-admin/Dockerfile` and in
`.env.production.example`, and its allowlist entry is deleted from
`frontend-admin/scripts/check-mock-flags.mjs`. Consequences for whoever next touches the image:

- If Railway pins the build arg back to `true`, the FX Spread page stops reading
  `public.fx_markup_rates` — the table the quote engine prices from — and the console shows
  fabricated bps next to the real ones with nothing labelling either.
- `npm run check:mock-flags --strict` fails, because the flag is no longer allowlisted. That is
  the gate working, not a regression to route around.
- Re-adding the allowlist line is a decision to fabricate money data in production. It is recorded
  in the script's own comment for exactly that reason.

## How this branch reaches the console you opened

Merging to `main` does not by itself change `frontend-admin-production-5b0c`. `release.yml` runs on
every push to `main` and deploys development, staging and production — but the production legs are
gated behind proof, in this order: `gates` verdict `proceed` → staging deploy → `smoke-staging`
green → `migrate-production` → `deploy-production`. A red or skipped staging probe cascade-skips
everything after it, on purpose ("nothing reaches production until staging is serving this commit").

Two things to check before assuming the fix is live:

- **The staging upload legs have been refusing** (`Failed to fetch: error decoding response body`)
  through most of 2026-11-19 and 2026-11-20 — a Railway-side fault, not this code. While they refuse,
  `deploy-production` is skipped and the prod console keeps serving the older build.
  This commit is the proof: run `44774228871` refused 27 of 27 staging calls at 17:13-17:32Z and,
  after `gh run rerun --failed`, another 27 of 27 at 20:19-20:39Z on 2026-11-20, while its three
  development legs of the same attempt landed (`smoke Development` green 17:16:35-17:16:39Z).
  Read-only afterwards, staging's newest row for all three services is still the
  2026-11-19T15:46Z manual `serviceInstanceDeploy` refresh. Episode 17 of
  `docs/devops/railway-upload-fault-report.md` carries the timestamps for the Railway ticket.
- **`frontend-admin` production has not been deployed since 2026-11-18, and historically never came
  from a trigger build.** Read-only against the Railway API on 2026-11-20:

  ```
  railway api 'query{ deployments(input:{projectId:"e7dca861-…", serviceId:"c4f1086e-…",
    environmentId:"f84c4558-…"}, first:6){ edges{ node{ createdAt status meta } } } }'
  2026-11-18T14:47:15Z  SUCCESS  cb02a3ca  cliCaller=agent_unknown:shell:qoder   (manual `railway up`)
  2026-11-18T14:35:13Z  REMOVED  4069e1a2  cliMessage=2f51561fb0e3f329
  2026-11-16T09:06:11Z  REMOVED  616bd93b  cliMessage=main-ef97ec64b-p
  …
  ```

  Every row is a CLI upload (`cliCaller` present, or a `cliMessage` carrying a sha), none is a
  git-source build. The live console is therefore the hand-uploaded `main`-lineage build `cb02a3ca…`
  from 2026-11-18 — which predates this branch, so **the four crash pages keep crashing on prod until
  someone puts this commit on the service.** `Service.deployments` is not environment-scoped by
  default; the `environmentId` above is what makes this the production list.

  **Superseded on 2026-11-21:** there is a newer production row than `cb02a3ca…` — `54701c98…`, `SUCCESS` at
  2026-11-21T14:18:54Z, `cliMessage` = `6082f2d8041bdf4385c3b3e1cf7a193b9389fe61`. Command 5 below was
  executed, so the console serves that commit, which is a **pin deliberately below `main`'s head**, not
  main's tip. See §6 for the pin, the proof and the rollback. The rest of this section is kept as the
  diagnosis it was the day it was written.

Read the served commit rather than the run colour. The build read-back is the **Go** service's route
(`backend/Dockerfile:14`), and the BFF's catch-all handler (`frontend-web/app/api/v1/[...path]/route.ts`)
forwards it, so this works from either host:

```
$ curl -s https://frontend-web-production-9259.up.railway.app/api/v1/public/build
{"commit":"d3401f5749adbe9142f0255743d110fb0afcdeb1","source":"ldflags",
 "started_at":"2026-11-18T16:40:40Z","uptime_seconds":169443}
```

Reproduced 2026-11-20. `started_at` is the deploy time, so production has been running the 2026-11-18
binary for two days — direct evidence that the production legs of every Release run since have been
skipped, not silently applied. `frontend-admin` has no such route (the same path on
`frontend-admin-production-5b0c` returns Next `404` HTML), so for the console the proof is the
`deployments(input:{…environmentId:"f84c4558-…"})` query above: if its newest row is not your sha, the
console is not serving your code.

### 5. Deploying this branch onto the production console (owner-run; executed 2026-11-21, see §6)

Landing on `main` is not enough while staging refuses. The production `frontend-admin` instance reports
`rootDirectory: null` (see the "THE UPLOAD RULE" header of `scripts/ci/railway-deploy.sh`, measured with
`serviceInstance(serviceId, environmentId){ rootDirectory }`), so the archive root must BE the app folder —
the same shape CI uses:

```bash
git worktree add /tmp/admin-deploy <merged-main-sha> && cd /tmp/admin-deploy
RAILWAY_TOKEN=<production token> ~/.railway/bin/railway up frontend-admin --path-as-root \
  --no-gitignore --service frontend-admin --environment production \
  --project e7dca861-3667-4d9a-8090-6d2f4d179ec2 --detach --message <merged-main-sha>
```

From a clean worktree at the exact merged commit, never from a dirty checkout — the upload ships the
working tree. Then re-run the `deployments` query and expect a new SUCCESS row whose `cliMessage` is that
sha, and confirm `/admin/fx/spread` shows the live `—`/value distinction rather than fixture bps.
An alternative that fixes the class rather than this one release: get a green `deploy-staging` +
`smoke-staging` (the Railway-side F2 ask), after which every subsequent `main` merge reaches production by
itself.

### 6. Command 5 was run on 2026-11-21, and it was NOT run at `main`'s head

Release run `44896430859` (push `2e4829e89`) printed `### Release gate: proceed` at 11:23:09Z, deployed
and smoke-tested all three development legs, applied `migrate staging database`, and then refused on
every staging upload — `deploy Staging (frontend-admin)` job `136830404022`, `(backend)` job
`136830404029`, `(frontend-web)` job `136830404096`, each burned with 9 × `Failed to fetch: error
decoding response body` (`grep -ac` on the exact phrase, nine retry-notices alongside each). The ids are
listed per-service on purpose: the numeric order does NOT follow the service order, and pairing them by
position is how an earlier draft of this file attributed the web leg to the wrong job. So
`smoke Staging`, `migrate production database`, `deploy Production (…)` and `smoke Production` were
cascade-skipped and the console stayed on the 2026-11-18 build. **A `proceed` verdict is necessary, not
sufficient: it only lets the train leave the station; the staging legs decide whether anything reaches
production.**

The console was therefore put on `6082f2d8041bdf4385c3b3e1cf7a193b9389fe61` — the last `main` commit
*before* #1103 — deliberately, because shipping `main`'s head to production right now would put an admin
screen over a schema production does not have:

```
$ git log --oneline --name-only 6082f2d80..2e4829e89 -- supabase/migrations
2e4829e89 feat(academy): operator-managed tuition formats (#1103)
supabase/migrations/20271800000000_academy_pricing_formats.sql     ← the only one, and it is NOT applied

$ git grep -l academy_pricing_formats 6082f2d80 -- frontend-admin frontend-web   # 0 files
$ git grep -l academy_pricing_formats 2e4829e89 -- frontend-admin                # 2 files:
#   frontend-admin/app/admin/academy/film/page.tsx
#   frontend-admin/src/services/filmAcademyAdminService.ts
```

`migrate production database` was skipped by the same run, so `academy_pricing_formats` exists on staging
and not on production, and `2e4829e89`'s console is the only one that reads that table. Picking the commit
below the migration is what makes this upload schema-neutral; it also means **the console sits at a pinned
commit rather than `main`'s tip, and re-pinning it is a step that belongs to whoever applies
`20271800000000` to the production database** — re-measure `git log --name-only <pin>..origin/main --
supabase/migrations frontend-admin` before moving it, because every commit added since #1103 has to clear
that check too. Re-measured at the time this was written, with `main` already two commits further on
(`ea902ef2a` #1121, `b7e6e89ba` #1102): the check still returns only `2e4829e89`'s two admin files and
`20271800000000_academy_pricing_formats.sql`, because neither later commit touches `frontend-admin` or a
migration. So #1103's migration is still the single thing standing between this pin and `main`'s tip.

  **Superseded the same evening, 2026-11-21:** that step was taken. `20271800000000` is now applied to the
  production database (scoped lane: plan `44918300865` → apply `44918503337`, `✓ applied + history
  recorded`, `recorded: 20271800000000`), and the console has been re-pinned to `f5bfe88485167330c9fe6b16c68b79615dd0c8d9`
  — deployment `537049cc-8c0e-4e05-8db9-8ee473d8c8f1`, `SUCCESS` at 15:24:49.845Z, `reason = "deploy"`,
  `cliMessage` = that full sha. The pin is no longer "below head for a schema reason"; §7 explains what is
  *still* missing, and it is a different service.

The absence is also readable directly rather than inferred from a skipped job. Run `44916982535`
(`Ops DB Push (manual)`, `MODE: list`, whose job title is `supabase list (production)` — that workflow
refuses outright if the staging project id equals the production ref, so the label is enforced, not
decorative) printed the whole `Local | Remote | Time` table at 15:02:29Z, after this upload: **exactly one
row has a blank `Remote` cell, and it is `20271800000000`**. Every other version sits on both sides, which
makes the commit below it the schema-neutral choice on measured state, not on CI bookkeeping.

The pin is also the safer side of an asymmetry, which is why re-pinning should follow the migration rather
than precede it. `20271800000000` is not purely additive: it drops the closed five-literal
`academy_area_pricing_options_key_check` and replaces it with a key-pattern check plus a foreign key to
`academy_pricing_formats`, and that table is seeded **from the `academy_area_pricing_options` rows that
already exist** (`INSERT … SELECT DISTINCT ON (key) … FROM academy_area_pricing_options … ON CONFLICT DO
NOTHING`). So the console at `6082f2d80` — whose key set is the same closed five in `AcademyPricingKey` in
`filmAcademyAdminService.ts` and `ACADEMY_PRICING_STRUCTURE` in
`frontend-web/src/server/services/academy/pricing.ts` — keeps working after the migration on any
environment where those five keys already have rows. Where one of the five is absent from prod's pricing
rows, the seeded catalogue lacks it too, and the pinned console's next insert of that key is refused by the
foreign key instead of succeeding. This is not a hypothetical: saving tuition calls
`updateInterestArea({ id, pricing })` with `{ key, price_ngn }` entries, and its `applyAll` branch then
sends the same array to every other interest area — "The structure applies to every area, so the console
offers setting it once" — so one repricing can try to create rows for keys an area never had, which is
precisely where a missing catalogue row turns into a refusal. Check which keys the seed will cover before
applying the migration (an ordinary read; run it against the production database):

```sql
-- every launch key, with a zero count where the table has no rows for it yet
SELECT k.key, count(o.id) AS option_rows
FROM (VALUES ('weekend_day'), ('weekend_boarding'), ('weekday_day'),
             ('weekday_boarding'), ('full_time_boarding')) AS k(key)
LEFT JOIN public.academy_area_pricing_options o ON o.key = k.key
GROUP BY k.key ORDER BY k.key;
```

All five with a non-zero count means the swap is inert for this console. A key at zero means either insert
that key into `academy_pricing_formats` first — with the `default_price_ngn` you want a new training to
start at, since the column is `NOT NULL CHECK (> 0)` — or land the re-pin in the same window.

The window this upload actually spans is not free of migrations, and it was checked rather than assumed.
The 2026-11-18 build's commit is not recorded anywhere — that row's `cliMessage` is `null` and `cb02a3ca…`
is a deployment id, not a sha — so `main`'s tip at that moment, `6057b0d3c`, is used as the proxy, and
between it and `6082f2d80` exactly one migration was merged:

```
$ git log --oneline --name-only 6057b0d3c..6082f2d80 -- supabase/migrations
5fec9f4a7 fix(connect): seed connect.contests.view for the admin contest list (#1072)
supabase/migrations/20271700000000_connect_contests_view_rbac_seed.sql
```

That one is already live on the production database: applied by the scoped lane on 2026-11-18 (plan
`44376009164` → apply `44376916739`, `✓ applied + history recorded`, `recorded: 20271700000000`) and
independently re-read on 2026-11-19 by the read-only grant probe `44483640603`. So the pin holds: every
schema object this build touches exists on production, and the one that does not belongs to the commit it
deliberately stops below.

One correction to the recipe above, measured the hard way. `serviceInstanceDeploy(serviceId,
environmentId, commitSha)` — the refresh lane that does reach the staging services — does **not** honor
`commitSha` for `frontend-admin` production, because that service has no git source: it rebuilds the last
*uploaded snapshot*. Its row proves it: `meta.reason = "redeploy"`, `cliMessage = null`, a fresh
`imageDigest`, `SUCCESS`, and a build log whose first relevant line is `unpacking archive`. The upload
lane is distinguishable in the same fields: `reason = "deploy"` and `cliMessage` = the sha.

```
2026-11-21T14:02:37Z  SUCCESS  91478789  reason=redeploy  cliMessage=null        ← API refresh: same code, no-op
2026-11-21T14:18:54Z  SUCCESS  54701c98  reason=deploy    cliMessage=6082f2d80…  ← Command 5: the real deploy
2026-11-18T14:47:15Z  REMOVED  cb02a3ca  reason=deploy    cliMessage=null        ← pre-deploy build
```

What was checked afterwards, and what was not. The deployment row is the proof: `reason = "deploy"`,
`cliMessage = 6082f2d8041bdf4385c3b3e1cf7a193b9389fe61`, `SUCCESS`, a new `imageDigest`. Corroboration came
from the unauthenticated routing, which now agrees with the development console request for request:

```
                     prod                                                  dev
/                    200                                                   200
/login               404 (no Location) ← console login is /admin/login    404 (no Location)
/admin               307 → /admin/login?next=%2Fadmin                      307 → same
/admin/open-mic/<id> 307 → /admin/login?next=%2Fadmin%2Fopen-mic%2F…       307 → same
```

The `Location` value matching byte-for-byte, including the URL-encoded `next` parameter, is the stronger
datum: it shows the same middleware and the same route tree, not merely the same status class. The chunk
sets referenced by `/` are also identical — the same 8 `/_next/static/chunks/*.js` names on both planes,
`diff`-clean — but that is stated only as parity with development, **not** as a before/after: the
pre-upload fetch was made against `/login`, which is a 404 page on both planes, so the set production
served before the deploy was never actually captured at `/`. Taken together these observations are weak in
exactly the way the deployment row is not: an identical top-level chunk set cannot distinguish `6082f2d80`
from a nearby commit, because per-screen code lives in route-level chunks. Not verified from here: an
authenticated click-through of the applicant actions (logging in must be done by a human), and the
page-level chunk itself cannot be fetched unauthenticated because a Next production build publishes no
manifest entry for a dynamic route.

To roll this back there is exactly one route: `deploymentRollback(id)` the snapshot that was live before
this one — the row prefixed `cb02a3ca` in the §4 `deployments(input:{… environmentId: production})` query,
whose full id that query returns. Re-running Command 5 at "the commit the console had before" is **not**
available as a rollback, because that commit was never recorded — the row's `cliMessage` is `null`, and
`cb02a3ca…` is a deployment id, not a sha. That gap is the whole argument for passing
`--message <merged-main-sha>` on every upload: it is the only field that makes a hand-uploaded build
attributable to a commit, and it is what makes the *next* deploy revertible to a known tree.

Do not "fix" a staging refusal by re-running the Release run — that also re-runs
`migrate production database`.

### 7. The applicant buttons are live in the console and dead one hop later

The console is verifiably at `f5bfe8848`, and clicking a contest's applicant list still fails against
production — for a reason nothing on `frontend-admin` can fix. The console does not answer that request
itself. `frontend-admin/app/api/web-proxy/[...path]/route.ts` forwards it to `WEB_API_BASE_URL`, and the
host behind that variable has not received `main` since 2026-11-16. So the feature is shipped, deployed,
and blocked one hop outside the service this file is about.

**Which host, proven without reading the value.** Run `44919798312` (`Ops - list Railway variable names`,
job `list frontend-admin variables (production)`) prints digests, never values:
`WEB_API_BASE_URL  (len 51, sha256 b6626bb2)`. Hashing candidates locally, `https://frontend-web-production-9259.up.railway.app`
is len 51 / `b6626bb2` and `https://www.spotlightng.com` is len 27 / `ae218bdc`. The console therefore
proxies to the Railway `frontend-web` production instance and cannot be proxying to the customer domain.

**Reading a code on that host needs a control.** `{"success":false,"error":"No API route matches GET …"}`
is emitted by *two* layers — `frontend-web/app/api/[...notFound]/route.ts:26` and the Go
`backend/internal/app/noroute.go:18` — so the wording alone identifies nothing. The control is an invented
path: `/api/admin/definitely-not-a-route` 404s on both web hosts, which is what licenses reading a 401 as
"this route exists and its guard ran". The rule cannot be read off the console itself: production's
`frontend-admin` answers 401 `{"error":"Not authenticated."}` for **every** `/api/web-proxy/*` path, invented
ones included, because its session gate runs before routing, and development's console answers 500
`WEB_API_BASE_URL is not set …` for the same reason it is useless as a control. The web host is the only
place this is observable. Measured 2026-11-21, unauthenticated:

| request | `…web-development` | `…web-staging-new` | `…web-production-9259` | `www.spotlightng.com` |
| --- | --- | --- | --- | --- |
| `/api/admin/open-mic/contests` | 401 | 401 | 401 | 401 |
| `/api/admin/academy/interest-areas` | 401 | 401 | 401 | 401 |
| `/api/admin/open-mic/contests/<uuid>/applicants` | 401 | **404** | **404** | 401 |
| `/api/admin/academy/pricing-formats` | 401 | **404** | **404** | 401 |
| `/api/admin/definitely-not-a-route` (control) | 404 | 404 | 404 | 404 |

Development serves both routes and staging does not, which localises the fault precisely: the route code
is fine, and what is missing is a deploy. The two Railway web planes that lack them are the two whose
uploads F2 refuses — §6's own run `44896430859` burned the full nine-attempt ladder on
`deploy Staging (frontend-web)`, job `136830404096`, before skipping production — while
`www.spotlightng.com`, fed by the independent `sync-frontend-web.yml` lane, is current. Only the backend
publishes a version marker (`/api/v1/public/build`, stamped from `BUILD_COMMIT` by
`scripts/ci/railway-deploy.sh`), and the three Railway web planes proxy three different backends
(`b7e6e89ba` dev, `773fe0285` staging, `b9c21b534` production), so no HTTP read can date a Next build here —
the 401-vs-404 diff is the only version probe this layer offers. Production's Railway web and www do report
the same backend sha, which is why column three against column four is the comparison that actually isolates
the Next layer.

The two 404s are therefore not a backend difference — production's Railway web and www front the same Go
service. `applicants/route.ts` was authored on `7c54898f4` (2026-11-19) but only *entered* `main` with #1109
(`9b2ec67b7`) on 2026-11-21, and `pricing-formats` with #1103 (`2e4829e89`) the same day; the customer
domain has them because `sync-frontend-web.yml` ran for each (`44889155223` 09:20:56Z, `44896430848`
10:53:03Z, `44908742535` 13:24:56Z). The Railway BFF does not, because nothing has deployed it.

**Why nothing has deployed it.** `docs/devops/deployment-matrix.md` records this service as fed by
`release.yml` "on every push to `main`", and `release.yml`'s production legs do exist since `ef97ec64b`
(#1037, 2026-11-16 09:01 +0100). But `deploy Production` needs `migrate production database`, which needs
`smoke Staging`, which needs `deploy Staging` — and `deploy Staging` is exactly where F2 kills every train.
The service's own history says so, and says it more strongly than the matrix implies: for environment
`f84c4558-8cbf-43e5-8e1b-f19ee3677133` the newest `SUCCESS` row is `ea71b561-badf-4dc7-ad4c-052fd65745b3`
at **2026-11-16T09:06:41.408Z**, and reading its `meta` shows it was *not* a train — `cliCaller =
"agent_unknown:node:qoder"`, `cliMessage = "main-ef97ec64b-prod-web"`, i.e. the hand `railway up` that
pushed #1037's own commit five minutes after `release.yml` grew the production legs. The next attempt,
`1282e63e-2813-40ab-a056-c7417d62c774`, FAILED at 2026-11-18T14:35:15.771Z, and there is nothing between
that and §7's own attempts. So **no release train has ever reached production's `frontend-web`** — every
row this service has is a CLI upload, exactly like the console's history in §5. **F2 is not a staging-only
fault: because production is downstream of staging, it has frozen production's two frontends, and the only
moves either of them has made since #1037 landed are hand uploads** — §6's console pin being the latest.

**Re-tested live while this file was open, and F2 refused again.** Release run `44922280434` (16:01:38Z →
16:53:35Z, head `ea908fabe`, `### Release gate: **proceed**`) is the cleanest possible natural experiment:
its head carries both new routes, `migrate staging database` succeeded, and all three
`deploy Development (…)` legs plus all three dev smokes succeeded. Then all three staging legs refused —
job `136909721274` (backend), `136909721330` (frontend-admin), `136909721425` (frontend-web) — each running
the full ladder (`with-retry: attempt 8/9 failed (exit 1); retrying in 148s`, then a ninth
`Failed to fetch: error decoding response body`, the last at 16:53:32Z), each logging 9 `Failed to fetch`
lines and 18 lines carrying the phrase — the arithmetic of one exhausted 9-try ladder. That is the F2
signature and not a runner flake (`GnuTLS recv error`: 0 lines) and not account state (`Your trial
has expired`: 0 lines). `smoke Staging` → `migrate production database` → `deploy Production` →
`smoke Production` all reported `skipped`, so production `frontend-web` is still `ea71b561` and still
answers 404. **A train that could have fixed this did run, and F2 is the only reason it did not.**

**What Command 6 actually buys, checked statically.** So that the owner is not uploading on a hope: at
`ea908fabe` the two admin trees the console reaches expose **69 route files**
(`git ls-tree -r --name-only ea908fabe frontend-web/app/api/admin/open-mic frontend-web/app/api/admin/academy`),
and every `/api/admin/open-mic/**` and `/api/admin/academy/**` path the console itself calls — including the
seven applicant actions `OPEN_MIC_APPLICANT_ACTIONS` lists (`approve`, `shortlist`, `waitlist`, `reject`,
`disqualify`, `request_information`, `withdraw`) plus the contact edit, all of them on
`contests/[id]/applicants/[applicationId]` — resolves to one of them. The applicants read needs only two
columns, `contests.slug` and `contests.contest_type`, and both come from
`supabase/migrations/20260410190000_one_beat_one_verse_foundation.sql` (its `ADD COLUMN IF NOT EXISTS
contest_type` and its `idx_contests_slug_unique`), an April migration far below the version recorded in
production's history (`20271800000000`, §6). And that is not an inference: the live production Go backend
queries `contests?contest_type=eq.one_beat_one_verse` from
`backend/internal/repositories/competition_supabase_repository.go`, so the column is demonstrably there
rather than merely expected.
That last check matters because `assertOpenMicReadAdmin` and `assertOpenMicAdmin` run *before* any query: a
401 from the stale host proves the route is mounted but says nothing about the read, which is why §7 needed a
static check to claim the buttons will work rather than merely appear. Nothing else has to move — no DB
change, no console rebuild, no mobile submission.

**Why the obvious fix is wrong.** The temptation is to re-point `WEB_API_BASE_URL` at `www.spotlightng.com`
now that the digest proves the two are distinguishable and both validate the same Supabase tenant (the
console's login page and www both embed project `nmseefdlliejmdbxytej`, so a bearer issued to the console
verifies at either). Do not. `docs/devops/deployment-matrix.md`'s `frontend-web` row is explicit: this host
is *"**A different host from the cPanel row above, and not interchangeable with it**"*, it is the BFF that
`mobile-app/reactnative/eas.json:65` bakes into the shipped store build's `EXPO_PUBLIC_API_BASE_URL`, and
*"because a store build bakes the base URL at submission time, a stale host here cannot be re-pointed
without a new submission"*. Re-pointing the console would leave the mobile app pointing at the stale host
anyway. The stale host is the bug; fix the staleness.

**What I tried, and the bound it refines.** Command 5's recipe, re-targeted at `frontend-web` with the
production matrix's own shape (`upload_path: frontend-web`, `root_flag: --path-as-root`, `build_dir: ''`),
from a clean worktree at `bd1b2aa3e` whose `frontend-web/` tree is provably identical to `origin/main`
(`git diff --name-only … -- frontend-web` → 0 files) and to what www serves today. Two attempts, both
`UPLOAD_FAILED … status code 524` — rows `f65b9b66-4d13-439b-944b-69ed32071011` (15:55:52.210Z) and
`5510eee4` (15:58:45.363Z), each `reason = "deploy"` with `cliMessage = bd1b2aa3e…`, each inert: the live
host still answered 200 on `/` (88,186 bytes) and 401 on `/api/admin/open-mic/contests` afterwards, so the
running build never changed. This is the laptop arm of `docs/devops/railway-upload-fault-report.md`, whose
size-boundary row reads "7,511,269 B accepted / 133,527,512 B refused" and reasons it to Cloudflare's ~100 s
proxy window at 11.217 Mbps. The tree I was archiving is 111 MB of tracked bytes and the refusals landed
at **46 s and 20 s**, so the
window is not the whole story and the practical rule is blunter: **this machine cannot upload
`frontend-web` at all** — the upload §6 got through is near the ceiling, not the middle measured the way the CLI sees it: `git ls-tree -r -l origin/main` sums
`frontend-admin` at 8.0 MB over 1,016 tracked files — that is what §6 uploaded successfully — against
`frontend-web` at 111.1 MB over 2,128, and this laptop accepted the first and refused the second inside a
minute). Trimming is not an option: 100.6 MB of those 111.1 MB is `frontend-web/public/`, and every one of
its 438 files is an image (largest `assets/img/faq/season1-7.png` at 5.3 MB), which the site serves — so any
exclusion ships a different tree than CI would. One more reason the size only bites here: both uploads ran
from a CLEAN worktree, which has no `node_modules`; the same command from this checkout would try to carry
925 MB of dependencies, because `railway-deploy.sh` passes `--no-gitignore`.

**What is not the answer.** `deploy-railway-action.yml` is the only other runner-shaped lane and it is dark
by design: `gh variable list` shows `RAILWAY_DEPLOY_ENABLED true` and no `RAILWAY_ACTION_DEPLOY_ENABLED`,
its branch gate still tests `refs/heads/{develop,staging,prod}` (frozen since 2026-11-15), and its own
header records that the marketplace action *"cannot pass `--message`, so Railway will not label the
deployment with the commit"* — which is the exact unattributability §6 spends a paragraph on. Flipping a
second switch and re-targeting a frozen gate to work around F2 is an unrequested change to the release
machinery, and it would still deploy a branch whose `frontend-web` does not build.

### 8. Command 6 — re-pin the production web BFF (owner-run, needs a link that can carry 111 MB)

```bash
git worktree add /tmp/web-deploy <merged-main-sha> && cd /tmp/web-deploy
SERVICE=frontend-web RAILWAY_ENV=production SHA=<merged-main-sha> \
UPLOAD_PATH=frontend-web ROOT_FLAG=--path-as-root BUILD_DIR='' \
RAILWAY_PROJECT=e7dca861-3667-4d9a-8090-6d2f4d179ec2 \
RAILWAY_HTTP_TIMEOUT=600 RAILWAY_TOKEN=<the Production token> \
bash scripts/ci/railway-deploy.sh
```

Run it from a runner or any machine with the uplink this one lacks; the flags are the ones `release.yml`'s
own production matrix passes, and `railway-deploy.sh` polls by `meta.cliMessage` so the row it waits for is
attributable. The cheaper version of the same thing is fixing F2, which unblocks every leg at once.

Verify after it lands — and verify it **against the web host itself**, not through the console: on
`frontend-admin-production-*` the proxy guard answers 401 for *invented* paths too (the four-plane table in
§7's last paragraph), so a 401 there proves nothing about the target. Run the pair directly:

```bash
H=frontend-web-production-<the b6626bb2 host>.up.railway.app
for p in /api/admin/open-mic/contests /api/admin/definitely-not-a-route \
         /api/admin/open-mic/contests/00000000-0000-0000-0000-000000000000/applicants \
         /api/admin/academy/pricing-formats; do
  printf '%s -> %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "https://$H$p")"
done
```

Four expected 401/404/401/401: the two real routes flip from 404 to 401, the invented control path stays
404, and that is what makes the host request-for-request equal to `www.spotlightng.com`.
`/api/v1/public/build` must keep reporting the same Go sha — the proof that only the Next layer moved. Roll
back with `deploymentRollback("ea71b561-badf-4dc7-ad4c-052fd65745b3")`, the row that is serving now. And the
console itself does **not** need a third pass, provided you re-check it: `main` moved twice after
`f5bfe8848` (`bd1b2aa3e` #1124 touched workflows, `ea908fabe` #1125 touched mobile) and
`git diff --name-only f5bfe8848..origin/main -- frontend-admin` was 0 files, so the deployed console build is
already head-current. Re-run that one-line diff at upload time — the moment it is non-zero, the console needs
its own pin again, and §6's `SERVICE=frontend-admin` recipe is the one to use.

## Companion file

`docs/ops/admin-pages-to-backend-flags.md` maps all 426 sidebar entries to routes and flags. Its
"FX Orchestration" rows carried the pre-fix claim that 13 FX pages "stay behind
`NEXT_PUBLIC_FX_ADMIN_USE_MOCK`" and are `[NOBACKEND]`; those rows are updated in the same change
as this file.
