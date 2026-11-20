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
  project, recorded in `docs/devops/main-to-prod-backend-release-plan.md` — not a sweep step.
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

## Companion file

`docs/ops/admin-pages-to-backend-flags.md` maps all 426 sidebar entries to routes and flags. Its
"FX Orchestration" rows carried the pre-fix claim that 13 FX pages "stay behind
`NEXT_PUBLIC_FX_ADMIN_USE_MOCK`" and are `[NOBACKEND]`; those rows are updated in the same change
as this file.
