# Runbook — Referral gate parity (Earn hub / BFF proxy flags)

> Audience: on-call / release engineer. **Production currently offers the Earn
> hub and cannot load it.** Both referral proxies answer 503 on
> `www.spotlightng.com` while production's own module registry publishes
> `referrals`. Nothing here is a code fix — the code is fixed; this is the env
> step that has to follow it.

## Measured state (2026-11-11, read-only probes)

| Surface | Production | Staging | Local dev |
|---|---|---|---|
| `GET /api/v1/referrals/me/dashboard` (engine proxy) | `503 This service is not available.` | `401 Unauthorized` | `401 Unauthorized` |
| `GET /api/v1/referral/my-rewards` (§7A proxy) | `503 Referrals are not available.` | `401 Unauthorized` | `401 Unauthorized` |
| `GET /api/v1/modules/visibility` | `200`, `environment=production`, 31 modules, **includes `referrals`** | `200`, `environment=staging` | `200`, `environment=development`, includes `referrals` |

A 503 here is the BFF's own app-level refusal (`errorResponse(..., 503)`), not an
upstream failure — the client renders it as "Couldn't load / Check your
connection", which sends everyone debugging the network layer. So production has
neither referral flag in the frontend-web runtime environment, while its backend
publishes the module.

## Which gate is which (do not conflate them)

Go mounts the two referral planes **independently**, both reachable from the
root engine:

- `FEATURE_REFERRALS_ENABLED` → `cfg.FeatureReferralsEnabled` → the §7A system at
  `/api/finance/referral/*` (`backend/internal/app/finance_routes.go:438`).
  BFF mirror: `featureFlags.referrals()`, used by
  `frontend-web/app/api/v1/referral/[...path]/route.ts`, plus the two local
  Next-side handlers `referrals/me` and `referrals/outbox`, which read the §7A
  tables (`finance_referral_codes`, `referral_events`).
- `FEATURE_REFERRAL_REWARDS_ENABLED` → `cfg.FeatureReferralRewardsEnabled` → the
  Direct Referral Rewards engine at `/v1/referrals/*`
  (`finance_routes.go:468`). BFF mirror: `featureFlags.referralRewards()`, used
  by `frontend-web/app/api/v1/referrals/[...path]/route.ts`. This is what the
  Earn hub's dashboard/earnings/referrals calls go through.

The visibility registry has one row only — `platform_modules` key `referrals`,
`env_flag = FEATURE_REFERRALS_ENABLED` (read from the local DB; the staging and
production registries are seeded from the same migrations) — so the registry
tells you nothing about whether the engine is mounted. A "module visible but API
503" split is therefore possible in either direction, and this is that split.

One stale comment to distrust while reading this: `docker-compose.yml:14-17`
asserts "frontend-web already sets its own FEATURE_REFERRALS_ENABLED=true". It
does not — no committed frontend-web env file sets it, and the local
`.env.local` did not either until 2026-11-11. That assumption is what let the
hub 503 quietly in local dev and in production; staging was the only place that
carried the var, and it would have become the third victim once the corrected
gate shipped without the workflow update described below.

## Procedure (HUMAN steps — same shape as `feature-flag-disable.md`)

1. **Sequence matters.** If the corrected build has not shipped yet, setting
   `FEATURE_REFERRALS_ENABLED=true` alone lights the hub up today (the old code
   gated the engine proxy on it). Once the corrected build ships, the engine
   proxy reads `FEATURE_REFERRAL_REWARDS_ENABLED` instead — so the hub goes dark
   again unless that var is set too. **Set both** and the order stops mattering.

2. **Frontend-web (cPanel/Passenger).** Add to the Node app's environment (cPanel
   "Node.js App" env vars, or the app's server-side `.env` — never commit a
   filled-in `.env`, and never flip a template to `true` as a fix; templates stay
   OFF):

   ```
   FEATURE_REFERRALS_ENABLED=true
   FEATURE_REFERRAL_REWARDS_ENABLED=true
   ```

3. **Restart Passenger** so the process re-reads them: `touch tmp/restart.txt`
   under the app dir (the same mechanism the deploy uses). `featureFlags` reads
   `process.env` per request, so no rebuild is needed — only a process restart.

4. **Backend host.** Confirm `FEATURE_REFERRAL_REWARDS_ENABLED=true` there too.
   Expected values after this step: `backend/.env` carries both flags (lines 118
   and 64), and the compose `api` service gets the rewards one through
   `env_file: backend/.env` — `docker-compose.yml` itself only names
   `FEATURE_REFERRALS_ENABLED`. Staging sets both on both services via
   `staging-module-flags.yml`.

5. **Verify** — each answer tells you which layer is still refusing:

   | Probe | Expected | If instead |
   |---|---|---|
   | `GET /api/v1/referrals/me/dashboard` (no token) | `401` | `503` → frontend-web env var did not take (re-check step 2/3) |
   | same, with a valid bearer | `200` + `{"code":…,"current_tier":…}` | `404` → the proxy is open but Go's engine is unmounted → step 4 |
   | `GET /api/v1/referral/my-rewards` (no token) | `401` | `503` → §7A flag did not take |
   | Earn hub in the app | renders balance/tier/milestone | still "Couldn't load" → read which of the four calls failed |

6. **Record** in the incident channel: which flags, when, who, why.

## Rollback

Set the added vars back to their previous values (or delete them), `touch
tmp/restart.txt`, re-probe. The hub returns to the current dark state; no data is
involved — these two flags gate HTTP surfaces only.

## Staging

`staging-module-flags.yml` job `set-frontend-web-flags` now sets both vars and
verifies both read back. Before that edit it set only
`FEATURE_REFERRALS_ENABLED`, so shipping the corrected gate without it would
have moved the production 503 onto staging. Re-running that workflow (manual
dispatch, staging environment, requires the `SET` confirmation input) applies it.
