# Runbook — Referral gate parity (Earn hub / BFF proxy flags)

> Audience: on-call / release engineer. **Production currently offers the Earn
> hub and cannot load it.** Both referral proxies answer 503 on
> `www.spotlightng.com` while production's own module registry publishes
> `referrals`. Nothing here is a code fix — the code is fixed; this is the env
> step that has to follow it.
>
> ⚠️ **Read this first: this runbook is one instance of a general class, not a
> referral-only problem.** The 503 whose body ends in "not available" is the
> frontend-web BFF's app-level refusal for *any* module flag the web runtime
> environment does not carry — `GET /api/v1/wallet/balance` → `Wallet feature is
> not available.` and `GET /api/v1/events` → `Events are not available.` answer
> identically on the same host (both re-probed 2026-11-14; ledger §8.5 measured
> restaurant/wallet/events together, and §7.3 counted **221 source lines** pairing
> a `503` with the string "not available" — a code-surface count, not an incident
> tally). So if you landed here from a non-referral 503, the *diagnosis shape*
> below applies and the referral-specific routes/line numbers do not: substitute
> the module's own `FEATURE_*` name and its own accessor in
> `frontend-web/src/lib/feature-flags.ts`.
>
> ✅ **The fix that exists now** is a committed source of truth plus a parity
> guard, not a hand-edited host: `frontend-web/config/production-module-flags.env`
> (45 directives — 36 `=true`, 9 `=false`) and `make flag-parity`
> (`scripts/ci/check-prod-flag-parity.sh`, wired as the `prod-flag-parity` job in
> `ci.yml`). **Verify both before you claim anything** — see "Verify before
> claiming" below; a green `make flag-parity` proves the *file* is right, and says
> nothing about what the running host has.

## Measured state (2026-11-11, read-only probes; prod + staging columns re-measured 2026-11-14)

| Surface | Production | Staging | Local dev |
|---|---|---|---|
| `GET /api/v1/referrals/me/dashboard` (engine proxy) | `503 This service is not available.` *(re-confirmed 2026-11-14)* | `401 Unauthorized` *(re-confirmed 2026-11-14)* | `401 Unauthorized` *(2026-11-11, not re-measured)* |
| `GET /api/v1/referral/my-rewards` (§7A proxy) | `503 Referrals are not available.` *(re-confirmed 2026-11-14)* | `401 Unauthorized` *(re-confirmed 2026-11-14)* | `401 Unauthorized` *(2026-11-11, not re-measured)* |
| `GET /api/v1/modules/visibility` | `200`, `environment=production`, 31 modules, **includes `referrals`** *(re-confirmed 2026-11-14 — same 31 names, same values)* | `200`, `environment=staging` | `200`, `environment=development`, includes `referrals` |
| `GET /api/v1/wallet/balance` — **not** a referral route | `503 Wallet feature is not available.` *(re-confirmed 2026-11-14)* | not probed | not probed |
| `GET /api/v1/events` — **not** a referral route | `503 Events are not available.` *(re-confirmed 2026-11-14)* | not probed | not probed |

The two non-referral rows are here for one reason: they are the evidence that the
503 class is a *web-runtime-env* problem, not a referrals problem. Stated at the
level each source actually supports — `frontend-web/config/production-module-flags.env`
**declares** all three on (`FEATURE_EVENTS_ENABLED=true` `:44`,
`FEATURE_RESTAURANT_ENABLED=true` `:60`, `FEATURE_WALLET_ENABLED=true` `:70`),
and both referral names too (`:58-59`); prod's **backend** env was measured
carrying `FEATURE_WALLET_ENABLED=true` (ledger §10.6) and
`FeatureRestaurantEnabled` true, proven by the 401 controls at §10.1 read against
§10.2 — while `FEATURE_EVENTS_ENABLED` on the prod **backend** was never read in
this plan, so do not cite it there. Prod **www** still refuses all of them
(ledger §10.5, §8.5; re-probed 2026-11-14, four 503s), and that is the whole
point: a name declared `=true` in a committed file is not a name the running host
carries until the flag-file install lane runs (Task 8 Steps 4-5, still open —
ledger §16.2 item 6). Same split this runbook describes for referrals, on three
more modules.

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
asserts "frontend-web already sets its own FEATURE_REFERRALS_ENABLED=true".
**The half that is still wrong** is the word *already*: compose sets the
**backend** container's env (`FEATURE_REFERRALS_ENABLED: "true"` at
`docker-compose.yml:18`) and nothing in the web plane, and `featureFlags` reads
`process.env` of the Next.js process — so a compose-level flag has never reached
the BFF gate. **The half that is now out of date** is "no committed frontend-web
env file sets it": `frontend-web/config/production-module-flags.env` carries
`FEATURE_REFERRALS_ENABLED=true` at `:58` and
`FEATURE_REFERRAL_REWARDS_ENABLED=true` at `:59` (Task 7 committed it). That file
is a **build/deploy-time source of truth**, consumed by the cPanel lane and
checked by `make flag-parity`; it is not read by a running Passenger process on
its own. That is exactly why production still answers 503 today: the lane edit
that installs the file into the host's runtime env is committed but **not
deployed** — and note where it lives: branch `ops/prod-module-flags` at
`5355d932581e…` is in the **destination** repo `paymax2022/spotlight-latest`,
*not* in `spotlight-latest1`, so it will not resolve from this checkout. It is
local-only there and was never pushed; the only copy is the `/private/tmp/t8-lane`
worktree (ledger §8, §16).
The original assumption — one env var serving three planes — is what let the hub
503 quietly in local dev and in production; staging was the only place that
carried the var, and it would have become the third victim once the corrected
gate shipped without the workflow update described below.

## Procedure (HUMAN steps — same shape as `feature-flag-disable.md`)

1. **Sequence matters.** If the corrected build has not shipped yet, setting
   `FEATURE_REFERRALS_ENABLED=true` alone lights the hub up today (the old code
   gated the engine proxy on it). Once the corrected build ships, the engine
   proxy reads `FEATURE_REFERRAL_REWARDS_ENABLED` instead — so the hub goes dark
   again unless that var is set too. **Set both** and the order stops mattering.

2. **Frontend-web (cPanel/Passenger). Use the committed file, not the console.**
   The supported route is `frontend-web/config/production-module-flags.env`,
   which already carries both names (`:58`, `:59`); the lane deploy writes it into
   the host's runtime env, so the fix is to land that deploy (Task 8 / Task 12),
   not to type into cPanel. Both guards then keep it honest: `make flag-parity`
   structurally (the file vs. every `envFlag` name in the code), and the lane's
   own validator at deploy time. Hand-editing the Node app's environment (cPanel
   "Node.js App" env vars, or the app's server-side `.env`) still works, but it is
   the one shape **neither guard can see** — ledger §9.7 names "a host edited by
   hand outside the lane" as exactly that hole — so if you must do it, record it
   in this file's step 6 and open a follow-up to move the value into the file.
   Never commit a filled-in `.env`, and never flip a template to `true` as a fix;
   templates stay OFF:

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

## Verify before claiming (both halves, or the claim is unsupported)

A "production's referral flags are fixed now" sentence needs **two** independent
reads, because the file and the host drift apart and nothing between them is a
deploy:

```bash
# 1 — the committed source of truth, structurally
make flag-parity
#    expected: "prod-flag-parity ✓ — 45 flags declared (36 on, 9 off)", exit 0
#    the same check CI runs is the `prod-flag-parity` job in .github/workflows/ci.yml;
#    the suite behind it is `bash scripts/ci/test-prod-flag-parity.sh` (prints PASS)

# 2 — what production actually answers, per surface, unauthenticated
for p in /api/v1/referrals/me/dashboard /api/v1/referral/my-rewards \
         /api/v1/wallet/balance /api/v1/events; do
  printf '%s ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' "https://www.spotlightng.com$p"
done
#    expected after a completed fix: 401 on all four (gate passed, auth refused).
#    still 503 on any of them => the flag block has not reached the runtime env.
```

Measured on 2026-11-14, with both commands run as written above: `make flag-parity`
passes (45/36/9, exit 0) **and** all four prod probes still return **503**. That
is the honest current state of this runbook's own subject: the file is correct,
the guard is green, the deploy that installs the file has not happened. Half of
this pair being green is not a fix — do not write "resolved" on the strength of
step 1 alone, and do not conclude "the flag file is wrong" from step 2 alone.

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
