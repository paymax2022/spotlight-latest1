# CONNECT / SOCIAL module cluster — production E2E validation results

Date: 2026-10-03. Stack exercised live: Next dev :3000 (BFF proxies → `GO_BACKEND_URL=http://localhost:8080`), Go api :8080 (HEAD+fixes), GoTrue via Kong :54321, Postgres `supabase_db_spotlight` :54322, Mailpit :54324, fakes :9101. Elasticsearch :9200 **down** — marketplace search ran its Postgres fallback (honest `degraded:true`), not a blocked leg.

Specs: `frontend-web/tests/e2e/social/` — 6 specs / 14 tests, all green on `chromium-desktop` (~3.8s, 5 workers). Every spec provisions its own users via `provisionVerifiedUser` (2–3 per spec); the only shared fixture touched is `admin@spotlight.internal` (read/login + approval gates, never mutated).

Domains in scope: connect, social (cashtag/social-pay), groups, creators, marketplace, promotions, spray, stays, p2pmarket, top5events.

## The headline fact: this cluster is API-only on web

`docs/e2e/inventory-web-screens.csv` contains **zero** connect/social/groups/creators/marketplace/cashtag/spray/p2p pages, and every candidate route 404s live on :3000 (SOC-001). The product surface for the whole cluster is the API plane:

- BFF proxies: `app/api/v1/{connect,social,groups,creators,marketplace,p2p,spray,stays,events}/…` → Go :8080.
- Go direct :8080 for surfaces with no BFF route (`/api/v1/promotions/banners`, admin paths) or with a BFF env gap (groups — see F-S1).

Environment facts verified before testing:
- Backend flags ON: `FEATURE_CONNECT/GROUPS/MARKETPLACE/SOCIAL_PAY/CREATORS/STAYS/EVENTS/ASSOCIATION_ENABLED=true` (backend/.env).
- `FEATURE_P2P_MARKET_ENABLED` **unset** → p2p + spray routes never mounted.
- Frontend flags ON in `.env.local`: `FEATURE_SOCIAL_PAY/CREATORS/EVENTS/STAYS_ENABLED=true`. `FEATURE_GROUPS_ENABLED` **absent** → BFF 503 (F-S1). Connect and marketplace BFF routes are intentionally unflagged (route comments say Go enforces).

## Verdicts

| ID | Journey | Verdict |
|----|---------|---------|
| SOC-001 | surface discovery | **PASS with gaps** — no web UI anywhere in the cluster; 10 API surfaces verified live with honest envelopes and honest `[]` empties; env-blocked legs report true status. |
| SOC-002 | connect hub | **PASS** — onboarding (age-gate + 3 consents) → profile PATCH → profile modes → mutual like → match → conversation → message, all persisted in Postgres; like replay is idempotent (`replayed:true`). |
| SOC-003 | groups | **PASS (Go-direct) / BFF leg blocked F-S1** — create → owner row → invite second user → member rows + `member_count=2` → cross-user visibility correct → non-owner invite 403. Contract gap: no join/leave/member-list ops exist. |
| SOC-004 | marketplace | **PASS** — categories (public, seeded) → create draft → submit → `pending_review` → admin approve → `active` → searchable (degraded) → second user reads detail, `view_count` ticks. |
| SOC-005 | creators/promotions/events/spray | **PARTIAL** — events lifecycle fully green (draft→submit→admin approve→golive→LIVE feed); promotions honest; **creators is dead-ended by F-S2** (admin approve 401s for super-admin); spray+p2p env-blocked (F-S3). |
| SOC-006 | edge probes | **PASS** — anon→401 everywhere (503 on flag-gated groups BFF, flag-before-auth ordering); B→A mutations 403; nonexistent→404; refused domain ops are clean 4xx not 5xx; one deviation F-S4. |

## Findings

- **F-S1 — P2 (env skew): groups BFF is flag-blocked while the module is healthy.**
  `frontend-web/.env.local` lacks `FEATURE_GROUPS_ENABLED`; `app/api/v1/groups/route.ts` returns 503 for every verb — even anonymous callers get 503 before the auth check (ordering observation, still a refusal). Backend `FEATURE_GROUPS_ENABLED=true` and the whole lifecycle works against Go :8080 (`/api/finance/groups`). Web/mobile-via-BFF users simply cannot reach groups today.
  Evidence: `frontend-web/app/api/v1/groups/route.ts:7`, `backend/internal/groups/service.go`.

- **F-S2 — P1 (defect): creators moderation is a dead end — admin approve 401s for EVERYONE.**
  `POST /api/creators/admin/creators/:id/approve` returns 401 `authentication required` even for a super-admin bearer + valid `x-admin-api-key`. The group is built with `adminGroupTop5`, whose `requireUserID()` reads `ginutil.UserID` that nothing populates (no `mapsAuth()`/`RequireAuthContext` on the group). `backend/internal/app/finance_routes.go:614-618` documents this exact gap for `/api/events/admin` ("Same fix already applied … adminGroupTop5's other 13 call sites still have this gap") — creators is one of the 13 unfixed call sites. Consequence verified live: `POST /api/v1/creators/creators/apply` lands `state=PENDING`, nothing can approve it, the public directory can never list a creator. The module is reachable but functionally unfinishable.
  Evidence: `backend/internal/app/finance_routes.go:614`, `backend/internal/creators/handler.go:56`.

- **F-S3 — P2 (env-blocked): p2p marketplace + spray unmounted.**
  `FEATURE_P2P_MARKET_ENABLED` unset in backend/.env (defaults false, config.go:819) → `RegisterP2PMarket` skipped → `/api/finance/p2p/*` and `/api/finance/p2p/spray*` all 404. Separately, **the spray BFF maps to the wrong upstream base**: `app/api/v1/spray/[...path]/route.ts` forwards to `/api/finance/spray/<sub>` but Go mounts member spray under `/api/finance/p2p/spray*` — even with the flag on, BFF spray calls 404. Needs both the flag AND a path fix to work.

- **F-S4 — P3 (deviation): removed marketplace listings stay publicly readable.**
  `DELETE /v1/marketplace/listings/:id` soft-deletes to `status='removed_user'`, but `GET /listings/:id` — a public, unauthenticated route — still returns 200 with the full body (title, price, seller_id) and keeps ticking `view_count`. Search correctly excludes it. If "deleted means gone" is the contract, this leaks; if tombstone reads are intended, a 410 or a `removed` payload would be more honest.

- **F-S5 — P3 (contract gap): groups has no join / leave / member-list operations.**
  Mounted member ops are only `POST /`, `GET /`, `GET /:id`, `POST /:id/invite`, `POST /:id/dues`. Membership is owner-invite only; members cannot join a public group or leave; the only membership read surface is `member_count` on GET + the `group_members` table. `is_public` currently only affects list/discoverability, not self-join.

- **F-S6 — P4 (gap): promotions has no BFF route at all.**
  `GET /api/v1/promotions/banners` exists on Go (requires `?module=`, 400 without) but nothing under `frontend-web/app/api` proxies it — web/mobile same-origin callers can't read banners without hitting Go directly.

- **F-S7 — P4 (note): connect onboarding can never reach `status='complete'`.**
  `connect_onboarding.phone_verified` has NO write path anywhere in the codebase (grep: only the migration default and SELECTs); `status='complete'` requires `phone_verified=true`. Age-gate + consents work; status stays `pending` forever. If phone verification is an intended gate it's unimplemented; if it's vestigial the status is cosmetically wrong.

- **Note (honest degradation):** `GET /v1/marketplace/search` with ES unwired returns `degraded:true` + real Postgres results instead of faking facets — good. `GET /api/v1/promotions/banners` without `module` returns 400 "module parameter required" instead of a cross-module dump — good.

- **Note:** `GET /api/v1/marketplace/categories`, `/search`, `/listings/:id` are intentionally anonymous (tier-0 browse); all mutations are auth-gated 401 at the BFF. Verified both directions.

## Journey details

### SOC-001 — discovery — PASS (with gaps)
8 candidate page routes → all **404** on :3000. API surfaces verified live:
connect `onboarding/status` (real object), `profile` (auto-creates), social `requests|splits|pools` (`{success:true, <list>:[]}`), cashtag `handle` claim 201 → `handle/me` → resolve, creators `creators-directory` (`creators:[]`), events `organiser/mine` + Go feed, marketplace `categories` (12+ seeded NG rows, public), `search` (degraded, `[]`), stays `home` (`{recent_searches:[],deals:[]}`), promotions `banners?module=` (`banners:[]`). Env-blocked legs: groups BFF 503 / Go 200; spray+p2p BFF and Go 404.
Spec: `tests/e2e/social/soc-001-discovery.spec.ts`.

### SOC-002 — connect hub — PASS
`POST /onboarding/age-gate` `{dob:1995-03-20}` → 200 `{allowed:true,age:31}` → `POST /onboarding/consent` ×3 (`terms|privacy|community_guidelines`) → status `{age_verified:true,consents_accepted:true}` (status stays `pending` — F-S7).
`PATCH /profile` → 200 persisted → `PATCH /profile/modes/friendship` `{visible:true,intent_tags:[music]}` → 200.
B `POST /likes {to_profile:<A>}` → 201 `{matched:false}` → A `POST /likes {to_profile:<B>}` → 201 `{matched:true,match_id}` → replay → `{replayed:true}`; `connect_matches` has exactly 1 row.
`GET /matches` on both sides shows the reciprocal `other_user_id` → `POST /matches/:id/conversation` → `{conversation_id,safety_state:'open'}` → `POST /conversations/:id/messages` → **201** `{flagged:false}` → B `GET /conversations/:id/messages` → 200, body intact; `connect_messages` row = 1.
Spec: `tests/e2e/social/soc-002-connect-hub.spec.ts`.

### SOC-003 — groups — PASS (Go-direct)
`POST /api/finance/groups` `{is_public:true}` → 201 (`member_count:0` in response — count is computed before the owner row lands; GET then correctly reports 2). `group_members` rows: owner + invited member. `POST /:id/invite` by owner → 200; by non-owner → **403**. Public group detail readable by non-member; stranger holds no membership row.
Spec: `tests/e2e/social/soc-003-groups.spec.ts`.

### SOC-004 — marketplace — PASS
`GET /categories` (anon) → 200, 12+ active NG categories → `POST /listings` → **201** `status:'draft'` → `POST /:id/submit` → `status:'pending_review'` (pending listings correctly absent from public search) → admin `POST :8080/v1/marketplace/admin/listings/:id/approve` → `status:'active'` (mkt_listings row agrees) → anon `GET /search?q=` → hit in `results`, `degraded:true` → buyer `GET /listings/:id` → `view_count≥1` → seller `GET /my-listings` contains it.
Spec: `tests/e2e/social/soc-004-marketplace.spec.ts`.

### SOC-005 — creators / promotions / events / spray — PARTIAL
Creators: `POST /creators/apply` → `{profile.state:'PENDING'}` → directory honestly excludes it → admin approve → **401 dead end (F-S2)**.
Events: `POST /api/v1/events` → `{state:'DRAFT'}` → `POST /:id/submit` → admin `POST :8080/api/events/admin/:id/approve` → 200 → `POST /:id/golive` → appears in `GET /api/finance/events?state=LIVE`. (Contrast proves the creators 401 is module wiring, not broken admin auth.)
Promotions: `GET /api/v1/promotions/banners` (Go direct) → 400 without `module`, `{banners:[]}` with.
Spray + p2p: 404 on every mount — env-blocked (F-S3).
Spec: `tests/e2e/social/soc-005-creators-events.spec.ts`.

### SOC-006 — edge — PASS
Anon: POST listings/likes/swipe/handle/send/creators-apply → **401**; groups BFF → **503** (flag check precedes auth).
BOLA: B `PUT|DELETE /listings/:id` on A's listing → **403** `FORBIDDEN`; non-owner `POST /groups/:id/invite` → **403**.
Missing: `GET /listings/<random-uuid>` → **404**; `GET /api/finance/groups/<random>` → **404**.
Soft-delete: `DELETE /listings/:id` → 200, `status='removed_user'`; public GET still 200 (F-S4); search excludes.
Domain refusals: self-like → **400**, like to nonexistent profile → **400**, invalid mode PATCH → **400** — no 5xx anywhere.
Spec: `tests/e2e/social/soc-006-edge.spec.ts`.

## Coverage ledger — API paths exercised this run

- BFF (:3000): `POST /api/auth/register`, `POST /api/auth/login`
- Connect: `GET /api/v1/connect/onboarding/status`, `POST /api/v1/connect/onboarding/{age-gate,consent}`, `GET|PATCH /api/v1/connect/profile`, `PATCH /api/v1/connect/profile/modes/{mode}`, `GET /api/v1/connect/discovery/stack`, `POST /api/v1/connect/discovery/swipe`, `POST /api/v1/connect/likes`, `GET /api/v1/connect/matches`, `POST /api/v1/connect/matches/:id/conversation`, `GET|POST /api/v1/connect/conversations/:id/messages`
- Social-pay: `GET /api/v1/social/social/{requests,splits,pools}`, `POST /api/v1/social/social/handle`, `GET /api/v1/social/social/handle/{me,:handle}`, `POST /api/v1/social/social/send` (401 probe)
- Groups: `GET|POST /api/v1/groups` (503), `GET|POST :8080/api/finance/groups`, `GET /api/finance/groups/:id`, `POST /api/finance/groups/:id/invite`
- Marketplace: `GET /api/v1/marketplace/{categories,search}`, `POST|GET|PUT|DELETE /api/v1/marketplace/listings[/:id]`, `POST /api/v1/marketplace/listings/:id/submit`, `GET /api/v1/marketplace/my-listings`, `POST :8080/v1/marketplace/admin/listings/:id/approve`
- Creators: `POST /api/v1/creators/creators/apply`, `GET /api/v1/creators/{creators-directory,my-creator/content}`, `POST :8080/api/creators/admin/creators/:id/approve` (401)
- Events: `POST /api/v1/events`, `GET /api/v1/events/organiser/mine`, `POST /api/v1/events/:id/{submit,golive}`, `GET :8080/api/finance/events[?state=LIVE]`, `POST :8080/api/events/admin/:id/approve`
- Stays: `GET /api/v1/stays/{home,destinations,reservations,saved}`
- Promotions: `GET :8080/api/v1/promotions/banners[?module=marketplace]`
- Spray/P2P (env-blocked): `GET|POST /api/v1/spray/*`, `GET /api/v1/p2p/p2p/listings`, `:8080/api/finance/p2p/*`
- DB asserts: `connect_onboarding`, `connect_profiles`, `connect_matches`, `connect_messages`, `connect_consents`, `group_members`, `mkt_listings`, `creator_profiles`

## Gap list — surfaces that do not exist at all

- **No web UI** for any domain in this cluster (all of /connect /social /groups /creators /marketplace /cashtag /spray /p2p → Next 404). Mobile app (`mobile-app/reactnative`) is presumably the consumer; not verified this run.
- No BFF route for promotions banners; no BFF routes for `/v1/marketplace/admin/*`, `/api/creators/admin/*`, `/api/events/admin/*` (Go direct only — by design).
- Groups module: no join/leave/member-list ops (F-S5).
- Connect: no phone-verification write path (F-S7); `GET /api/v1/connect/health` is behind `requireRequestUser` at the BFF, so it can't serve as a public liveness probe through :3000 (Go direct returns `{module:'connect',status:'ok'}` unauthenticated — fine).

## Blockers / notes for next run

- **BLOCKED:** p2p marketplace + spray (all legs) — needs `FEATURE_P2P_MARKET_ENABLED=true` in backend/.env AND a spray BFF path remap (`/api/finance/spray/*` → `/api/finance/p2p/spray*`).
- **BLOCKED:** groups via the real web BFF — needs `FEATURE_GROUPS_ENABLED=true` in frontend-web/.env.local (Go-direct path is green meanwhile).
- **BLOCKED:** creators PENDING→approved — needs the `adminGroupTop5` auth wiring fix (`mapsAuth()` + `RequireAuthContext`) applied to the remaining call sites, as finance_routes.go itself flags.
- Marketplace search ran degraded Postgres mode (ES down); facets/relevance/geo unverified — needs ES :9200 + indexer.
- Marketplace checkout (offer→escrow→release) untouched — PSP/escrow rail out of scope without a Paystack fake path verified; stays book/prebook unexercised (supplier rail untested, empty supply).
- Cart/checkout not present as a surface: marketplace is offer/escrow-based, not a cart product.
