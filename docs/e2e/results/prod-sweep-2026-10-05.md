# Production E2E sweep — 2026-10-05

13-agent API sweep against `https://frontend-web-production-9259.up.railway.app`
with fresh account `ayaaakinleye@gmail.com` (`00367732-a1f0-4bb0-b711-235facd82685`,
tier-0, zero wallet). Full per-agent tables: `/tmp/e2e-prod/agent-*.md`.

## P0 — infrastructure (owner action required)

| # | Finding | Root cause | Evidence | Required action |
|---|---------|-----------|----------|-----------------|
| 1 | Go backend cannot reach Postgres | `DATABASE_URL`/pgx credential on the Railway backend rejected by the Supabase pooler | `GET /api/v1/transfers/pin/status` → 500 `SASL auth: password authentication failed for user "postgres" (28P01)`. Same failure surfaces as `failed to load wallet` / `failed to load tier status` / `failed to load kyc status` / `Failed to create transaction` / push-token 500 on every pgx-backed route | Fix the backend service `DATABASE_URL` (pooler host + password) in Railway |
| 2 | Registration down for ALL new signups | OTP-email leg of register needs the dead pgx pool → fails closed | `POST /api/auth/register` → 400 generic for fresh emails (yusufakinleye144, mailinator probe); succeeded at 00:19 UTC, broken after | Fixed by #1 |
| 3 | Prod backend is a stale build | deploy never ran — `deploy Production` jobs cancelled in run 37236653733, skipped in the merge run | `/public/health` reports commit `e1ce69eb` (2026-09-08, ~600 commits behind main); phone-verify routes, registration `/step` adapter, `/api/finance/*` BFF catch-all, `/api/v2/votes/stream` all absent | Promote main→prod, dispatch `CI — CLAUDE.md gates` with `deploy_environment=production, confirm_deploy=DEPLOY`, approve environment gate |
| 4 | Feature flags off in prod | env vars unset on Railway services | uniform 503s: wallet, KYC, disputes, connect, social/groups/events/creators/p2p/spray, restaurant, transport, stays, FX, crowdfunding, referrals, utility, realtor, association, AI-care support, telemedicine/pharmacy/vet/lab | Flip per-module `FEATURE_*` envs when product is ready (SEC-052 connect wallet-fund must stay OFF) |
| 5 | Mailgun not configured | env missing on frontend-web | `POST /api/contact`, `POST /api/sponsor-meetings` → 502 | Set `MAILGUN_*` envs |
| 6 | Academy apply 500s | `academy_interest_areas` table missing on prod DB (migrations exist in repo: `20261218000000`, `20261219000000`) | `GET /api/academy/application` → 500 fresh user; `POST /api/academy/apply` → 500 on any non-empty `areas_of_interest` | `supabase db push` to prod project `nmseefdlliejmdbxiytej` |

## Code fixes in this PR

| Finding | Root cause | Fix |
|---------|-----------|-----|
| `PIN` endpoints reachable with `walletTransfers` flag off — `pin/status` was the only transfers route reaching the DB flag-off, and on the old build it leaked the raw pgx error (DB host/user/IP/SQLSTATE) | `PinStatus`/`SetPin`/`VerifyPin` never called `unavailable()` — every sibling does | `backend/internal/finance/transfers/handler.go`: added `h.walletEnabled` gate to all three |
| `GET /api/contestants/:id/share` minted share links for nonexistent contestants (unauthenticated, wrote DB rows) | `maybeSingle()` + null fallback strings — no existence/contest-match check | 404 when contestant missing or `contest_id` ≠ `contestId` |
| `POST /api/contestants/:id/share` recorded events against bogus `shareLinkId`s (insert errors swallowed) | no existence check, insert error ignored | `share.service.ts`: verify link exists → `ApiError 404`; propagate insert error |
| `POST /api/registration/uploads` → 500 on non-multipart body | `request.formData()` throws uncaught | 415 `Expected multipart/form-data` |
| `POST /api/stem/school-join-requests` → 500 on bogus schoolId | FK violation (23503) unmapped | `persistence.ts`: 23503 → `ApiError('School not found', 400)` |

## Verified NOT bugs (agent reports triaged)

- Raw-error leak (`P1`): already fixed in HEAD — `go-common/httperr.Sanitize` scrubs
  SQLSTATE/pgx/panic signatures and collapses 5xx to generic. Only leaks on the
  stale prod build. Closed by redeploy (#3).
- "Blanket 401 on /api/v1/*" (agent-11): agent's own bad token — re-verified 200s
  on estate/contests with a fresh login.
- "Supabase-validated routes reject Go JWT" (agent-12): same bad-token artifact —
  `/api/academy/*` 500 is the missing-table bug (#6), not auth.
- `POST /api/v1/crowdfunding/creator/campaigns` → 405: intentional — create lives
  at `POST /api/v1/crowdfunding/campaigns`; creator/campaigns is list-only.
- `GET /api/v1/telemedicine/appointments` → 405: collection is POST-only (book);
  list is `/mine`.
- `PATCH /api/me/profile` → 405: PUT is the contract.
- Flag-check-before-auth 503s revealing flag state: deliberate fail-closed order.
- Crowdfunding/referrals/utility 503s: flag-off by product decision (#4).

## Still open / residual

- Burst throttling surfaced as 401 (not 429) on the stale build — re-verify after
  redeploy; HEAD's shared-Redis limiters return proper 429s.
- `GET /api/v1/me/capabilities` 404 and `PATCH /api/registration/applications/:id/step`
  404 — both exist in HEAD; closed by redeploy.
- Live contests exist (`9165275e…` Best Emerging Actor 2025, `3743fa89…` Nollywood
  Rising Star, `0cba2169…` Spotlight Talent Search S2) but have **zero contestants**
  and no voting config — end-to-end vote cast needs a seeded contest.
- yusufakinleye144@gmail.com provider account: registration blocked by #2 until
  DB credential is fixed; verify-email click needed after.
- Provider surfaces unreachable: restaurant/doctor/vendor/host/driver/creator
  onboarding all gated by flags or missing routes — no provider type can onboard
  in prod today.
