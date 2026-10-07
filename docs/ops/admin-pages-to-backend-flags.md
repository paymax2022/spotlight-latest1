# Admin console pages -> Go backend routes -> feature flags

Generated from a read-only audit of `frontend-admin/src/components/layouts/AdminSidebar.tsx` (426 sidebar entries), `frontend-admin/src/services/*.ts`, `backend/internal/app/*_routes.go` and `backend/internal/config/config.go`. Audit date 2026-10-07.

## How a page reaches the backend

- Browser -> `/api/admin-proxy/<path>` (Next route in frontend-admin) -> `ADMIN_API_BASE_URL/<path>` (the Go backend root, no `/api/v1` suffix). The proxy attaches `x-admin-api-key` (`ADMIN_API_KEY`) and the session bearer. Backend `ADMIN_API_KEY` must equal the console value or `RequireAdmin` groups (`/api/v1/admin/*`, `/api/finance/admin/transport/*`) 401/503.
- Some pages instead go `/api/web-proxy/*` -> **frontend-web** (Next), which is not Go and has no Go flag (class `NEXT` below).
- A bare Gin `404 page not found` means the route was never registered: the gate flag is off (or the page has no Go route at all). It is NOT the module gate.
- **FEATURE_MODULE_GATE_ENFORCE** (default false; observe-only logs `WOULD refuse`). When true it returns **503** `{"error":"This feature is not available yet.","module":"<key>"}` only for non-admin paths under the finance group that appear in `modulegate` route map (wallet, transfers, savings, fx, restaurant, telemedicine, stays, insurance, crowdfunding, events, groups, estate, transport, referrals, kyc, va, disputes, ratings, loyalty, realtor, creators, associations, social, pharmacy) when the module is not published for the env in `platform_module_environments`. **Any path containing `/admin` is never gated** and unmapped paths are allowed, so admin pages are unaffected; a few pages call member routes (e.g. finance/disputes list, restaurant `/api/finance/restaurant/*`) and can be hit.
- Module registry (`platform_modules.env_flag`) is evaluated as `os.Getenv(flag)=="true"` (strict), while route mounting uses `getEnvBool` which also accepts `1` and `yes`. Setting `FEATURE_X=1` mounts routes but registry reports `env_flag_enabled=false`. Use the literal `true`. Seeded env_flag drift (kyc, association, utilityPayments, beneficiaries, votesBridge, fintechAdmin) was corrected by migration `20270320000000_fix_module_env_flag_drift.sql`; verify it is applied.
- Next side: the admin services read only `NEXT_PUBLIC_*_USE_MOCK` (build-time inlined; rebuild required). They never read `FEATURE_*`. Unset => mock in dev builds, live in production builds. Names are listed at the end.
- Always required to mount ANY finance/DB module: `DATABASE_URL` and a working pgx pool (`registerFinanceRoutes` skips everything otherwise). When APP_ENV is `staging`/`production`/`prod` a missing/unreachable DB is `log.Fatalf`; with `development` the backend boots with all DB-backed routes silently absent.
- Per-page granularity: the module prefix and gate were verified in Go for every row; the individual leaf route behind each page was verified only where the route column names it explicitly. Rows say `unverified` where not traced.

Class legend: GATED = needs the flag(s) in the Gate column; UNGATED = always registered; NEXT = served by frontend-web; NOBACKEND = no Go route exists, no flag helps; UNVERIFIED = not traced.

## Counts

- Sidebar pages: **426** (incl. 8 `/extranet/*`).
- Flag-gated Go routes: **356**
- Ungated Go routes (always on): **35**
- Served by frontend-web (no Go flag): **16**
- No Go backend exists (flag cannot fix): **16** (14 FX console pages + 2 Groups pages)
- Unverified: **3**

## Pages by sidebar section (gated, NEXT, NOBACKEND, UNVERIFIED)

### Contests

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/competitions/list` | GET /api/v1/connect/contests*, /api/connect/admin/contests/:id/... (evict/save/extend-grace/finalize/admin-vote) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Eviction/stage routes ALSO need FEATURE_CONTEST_STAGE_EVICTION_ENABLED. Leaf routes not individually verified. |
| `/admin/competitions/participants` | GET /api/v1/connect/contests*, /api/connect/admin/contests/:id/... (evict/save/extend-grace/finalize/admin-vote) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Eviction/stage routes ALSO need FEATURE_CONTEST_STAGE_EVICTION_ENABLED. Leaf routes not individually verified. |
| `/admin/competitions/results` | GET /api/v1/connect/contests*, /api/connect/admin/contests/:id/... (evict/save/extend-grace/finalize/admin-vote) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Eviction/stage routes ALSO need FEATURE_CONTEST_STAGE_EVICTION_ENABLED. Leaf routes not individually verified. |
| `/admin/competitions/settings` | GET /api/v1/connect/contests*, /api/connect/admin/contests/:id/... (evict/save/extend-grace/finalize/admin-vote) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Eviction/stage routes ALSO need FEATURE_CONTEST_STAGE_EVICTION_ENABLED. Leaf routes not individually verified. |
| `/admin/contests` | /api/admin/contests* (web-proxy) | (frontend-web, not Go) | - | - | [NEXT] Served by frontend-web via /api/web-proxy; no Go flag. Go also has /api/v1/admin/registrations (RBAC contestant.view), unused by this page. |
| `/admin/judges-scores` | /api/admin/judges-scores (web-proxy) | (frontend-web, not Go) | - | - | [NEXT] Served by frontend-web via /api/web-proxy; no Go flag. Go also has /api/v1/admin/registrations (RBAC contestant.view), unused by this page. |
| `/admin/open-mic` | /api/admin/open-mic/* (web-proxy) | (frontend-web, not Go) | - | - | [NEXT] Served by frontend-web via /api/web-proxy; no Go flag. Go also has /api/v1/admin/registrations (RBAC contestant.view), unused by this page. |
| `/admin/registration` | /api/admin/registration/applications (web-proxy) | (frontend-web, not Go) | - | - | [NEXT] Served by frontend-web via /api/web-proxy; no Go flag. Go also has /api/v1/admin/registrations (RBAC contestant.view), unused by this page. |
| `/admin/stages-evictions` | /api/admin/... via web-proxy | (frontend-web, not Go) | - | - | [NEXT] Served by frontend-web via /api/web-proxy; no Go flag. Go also has /api/v1/admin/registrations (RBAC contestant.view), unused by this page. |
| `/admin/sme-pitch` | /api/admin/sme-pitch (web-proxy) | (frontend-web, not Go) | - | - | [NEXT] Served by frontend-web via /api/web-proxy; no Go flag. Go also has /api/v1/admin/registrations (RBAC contestant.view), unused by this page. |

### Voting

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/voting/packages` | /api/admin/voting/* (web-proxy) | (frontend-web, not Go) | - | - | [NEXT] Served by frontend-web via /api/web-proxy. |
| `/admin/voting/templates` | /api/admin/voting/* (web-proxy) | (frontend-web, not Go) | - | - | [NEXT] Served by frontend-web via /api/web-proxy. |
| `/admin/voting/visibility` | /api/admin/voting/* (web-proxy) | (frontend-web, not Go) | - | - | [NEXT] Served by frontend-web via /api/web-proxy. |
| `/admin/voting/prizes` | /api/admin/voting/* (web-proxy) | (frontend-web, not Go) | - | - | [NEXT] Served by frontend-web via /api/web-proxy. |
| `/admin/voting/results` | /api/admin/voting/* (web-proxy) | (frontend-web, not Go) | - | - | [NEXT] Served by frontend-web via /api/web-proxy. |
| `/admin/voting/audit-log` | /api/admin/voting/* (web-proxy) | (frontend-web, not Go) | - | - | [NEXT] Served by frontend-web via /api/web-proxy. |

### Support

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/admins/new` | unverified (likely Next /api/admin/signup) | - | - | - | [UNVERIFIED] Not traced. |

### Finance

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/finance` | unverified (index page) | - | - | - | [UNVERIFIED] Not traced. |
| `/admin/payments-finance` | /api/admin/payments-finance/* (web-proxy) | (frontend-web, not Go) | - | - | [NEXT] |
| `/admin/payments-finance/adjustments` | /api/admin/payments-finance/* (web-proxy) | (frontend-web, not Go) | - | - | [NEXT] |
| `/admin/finance/kyc-verify` | GET /api/finance/admin/kyc/review-queue, /cases/:id, /routing-rules, /events; POST cases/:id/approve\|reject | FEATURE_KYC_VERIFY_ENABLED | false | APP_ENV=production\|prod: ABORTS unless a provider is set (DOJAH_SECRET_KEY, or SMILEID_PARTNER_ID+SMILEID_API_KEY, or YOUVERIFY_TOKEN) AND KYC_PII_ENC_KEY = base64 of exactly 32 bytes. Other APP_ENV: warning only (boots with empty registry / nil cipher). | [GATED] Registered only if flag && pool != nil. RBAC finance.admin.kyc. |
| `/admin/finance/wallets` | GET /api/finance/admin/wallets/:user_id/balance\|transactions | FEATURE_WALLET_ENABLED | false | PAYSTACK_SECRET_KEY (must start sk_). Prod abort if missing/placeholder; non-prod warning. (Same for FEATURE_BANK_TRANSFERS_ENABLED, which also needs MONNIFY_SECRET_KEY.) | [GATED] RBAC finance.admin.transfers. |
| `/admin/finance/disputes` | GET /api/finance/disputes; POST /api/finance/admin/disputes/:id/resolve | FEATURE_DISPUTES_ENABLED | false | None | [GATED] Member list route sits behind module gate key "disputes" (503 if enforce + unpublished). |
| `/admin/merchant-onboarding` | /api/admin/onboarding/* | FEATURE_ONBOARDING_ENABLED | false | None | [GATED] onboarding.Register returns without mounting when flag off. |
| `/admin/featured-placement` | /api/placement/admin/review-queue, /campaigns/:id[/action] | FEATURE_PLACEMENT_ENABLED | false | None | [GATED] |
| `/admin/nutrition` | /api/nutrition/admin/* | FEATURE_NUTRITION_ENABLED | false | None | [GATED] Anthropic key optional (mock fallback). |
| `/admin/nutrition/consults` | /api/nutrition/admin/* | FEATURE_NUTRITION_ENABLED | false | None | [GATED] Anthropic key optional (mock fallback). |
| `/admin/nutrition/payouts` | /api/nutrition/admin/* | FEATURE_NUTRITION_ENABLED | false | None | [GATED] Anthropic key optional (mock fallback). |

### Commission

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/commission` | GET/POST /api/finance/commission/config\|earnings\|report (RBAC finance.commission.read\|manage) | FEATURE_COMMISSION_ENABLED | false | None. | [GATED] RegisterCommission returns immediately when flag off. Also unlocks commission recording in ~10 other modules (Connect, Stays, Health, Crowdfunding, Estate...). |
| `/admin/commission/profit` | GET/POST /api/finance/commission/config\|earnings\|report (RBAC finance.commission.read\|manage) | FEATURE_COMMISSION_ENABLED | false | None. | [GATED] RegisterCommission returns immediately when flag off. Also unlocks commission recording in ~10 other modules (Connect, Stays, Health, Crowdfunding, Estate...). |

### Crowdfunding

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/crowdfunding` | /api/crowdfunding/admin/* | FEATURE_CROWDFUNDING_ENABLED | false | None | [GATED] |
| `/admin/crowdfunding/campaigns` | /api/crowdfunding/admin/* | FEATURE_CROWDFUNDING_ENABLED | false | None | [GATED] |
| `/admin/crowdfunding/review` | /api/crowdfunding/admin/* | FEATURE_CROWDFUNDING_ENABLED | false | None | [GATED] |
| `/admin/crowdfunding/users` | /api/crowdfunding/admin/* | FEATURE_CROWDFUNDING_ENABLED | false | None | [GATED] |
| `/admin/crowdfunding/kyc` | /api/crowdfunding/admin/* | FEATURE_CROWDFUNDING_ENABLED | false | None | [GATED] |
| `/admin/crowdfunding/finance` | /api/crowdfunding/admin/* | FEATURE_CROWDFUNDING_ENABLED | false | None | [GATED] |
| `/admin/crowdfunding/withdrawals` | /api/crowdfunding/admin/* | FEATURE_CROWDFUNDING_ENABLED | false | None | [GATED] |
| `/admin/crowdfunding/fraud` | /api/crowdfunding/admin/* | FEATURE_CROWDFUNDING_ENABLED | false | None | [GATED] |
| `/admin/crowdfunding/support` | /api/crowdfunding/admin/* | FEATURE_CROWDFUNDING_ENABLED | false | None | [GATED] |
| `/admin/crowdfunding/compliance` | /api/crowdfunding/admin/* | FEATURE_CROWDFUNDING_ENABLED | false | None | [GATED] |
| `/admin/crowdfunding/featured` | /api/crowdfunding/admin/* | FEATURE_CROWDFUNDING_ENABLED | false | None | [GATED] |
| `/admin/crowdfunding/config` | /api/crowdfunding/admin/* | FEATURE_CROWDFUNDING_ENABLED | false | None | [GATED] |

### Connect

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/connect/dashboard` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/users` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/identity` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/underage` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/moderation` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/media-review` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/cases` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/finance` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/gifting` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/aml` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/payouts` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/voting` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/rbac` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/gamification` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/catalog` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/comms` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/analytics` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/geo` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/support` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/config` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/audit` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |

### Connect · Network

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/connect/jobs` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/bounties` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/content` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/company-claims` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/assessments` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/mentorship` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |
| `/admin/connect/loyalty-audit` | /api/connect/admin/* (config, cases, audit, aml, gifts, payouts, identity, underage, moderation, media-review, voting, rbac, gamification, catalog, comms, analytics, geo, support, networking) | FEATURE_CONNECT_ENABLED | false | None | [GATED] Whole module skipped when off. Also needs DATABASE_URL + pool. FEATURE_COMMISSION_ENABLED / FEATURE_CONNECT_WALLET_FUND_ENABLED (default off, deliberately: unmounted POST /wallet/fund) toggle sub-routes. Leaf routes per page not individually verified; /admin/connect/{jobs,bounties,content,company-claims,assessments,mentorship,loyalty-audit} go via /api/connect/admin/networking. |

### Referral

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/referral/dashboard` | /api/referral/admin/* (attribution, house, campaigns, rewards, finance, risk, compliance, users, gamification, analytics, ambassadors, merchants, config) | FEATURE_REFERRALS_ENABLED | false | None | [GATED] Also requires pool != nil. Page-to-leaf mapping not individually verified. |
| `/admin/referral/attribution` | /api/referral/admin/* (attribution, house, campaigns, rewards, finance, risk, compliance, users, gamification, analytics, ambassadors, merchants, config) | FEATURE_REFERRALS_ENABLED | false | None | [GATED] Also requires pool != nil. Page-to-leaf mapping not individually verified. |
| `/admin/referral/house` | /api/referral/admin/* (attribution, house, campaigns, rewards, finance, risk, compliance, users, gamification, analytics, ambassadors, merchants, config) | FEATURE_REFERRALS_ENABLED | false | None | [GATED] Also requires pool != nil. Page-to-leaf mapping not individually verified. |
| `/admin/referral/attribution/reassignments` | /api/referral/admin/* (attribution, house, campaigns, rewards, finance, risk, compliance, users, gamification, analytics, ambassadors, merchants, config) | FEATURE_REFERRALS_ENABLED | false | None | [GATED] Also requires pool != nil. Page-to-leaf mapping not individually verified. |
| `/admin/referral/campaigns` | /api/referral/admin/* (attribution, house, campaigns, rewards, finance, risk, compliance, users, gamification, analytics, ambassadors, merchants, config) | FEATURE_REFERRALS_ENABLED | false | None | [GATED] Also requires pool != nil. Page-to-leaf mapping not individually verified. |
| `/admin/referral/rewards` | /api/referral/admin/* (attribution, house, campaigns, rewards, finance, risk, compliance, users, gamification, analytics, ambassadors, merchants, config) | FEATURE_REFERRALS_ENABLED | false | None | [GATED] Also requires pool != nil. Page-to-leaf mapping not individually verified. |
| `/admin/referral/vote-rewards` | /api/admin/referrals/vote-rewards (web-proxy) | (frontend-web, not Go) | - | - | [NEXT] |
| `/admin/referral/finance` | /api/referral/admin/* (attribution, house, campaigns, rewards, finance, risk, compliance, users, gamification, analytics, ambassadors, merchants, config) | FEATURE_REFERRALS_ENABLED | false | None | [GATED] Also requires pool != nil. Page-to-leaf mapping not individually verified. |
| `/admin/referral/risk` | /api/referral/admin/* (attribution, house, campaigns, rewards, finance, risk, compliance, users, gamification, analytics, ambassadors, merchants, config) | FEATURE_REFERRALS_ENABLED | false | None | [GATED] Also requires pool != nil. Page-to-leaf mapping not individually verified. |
| `/admin/referral/compliance` | /api/referral/admin/* (attribution, house, campaigns, rewards, finance, risk, compliance, users, gamification, analytics, ambassadors, merchants, config) | FEATURE_REFERRALS_ENABLED | false | None | [GATED] Also requires pool != nil. Page-to-leaf mapping not individually verified. |
| `/admin/referral/users` | /api/referral/admin/* (attribution, house, campaigns, rewards, finance, risk, compliance, users, gamification, analytics, ambassadors, merchants, config) | FEATURE_REFERRALS_ENABLED | false | None | [GATED] Also requires pool != nil. Page-to-leaf mapping not individually verified. |
| `/admin/referral/gamification` | /api/referral/admin/* (attribution, house, campaigns, rewards, finance, risk, compliance, users, gamification, analytics, ambassadors, merchants, config) | FEATURE_REFERRALS_ENABLED | false | None | [GATED] Also requires pool != nil. Page-to-leaf mapping not individually verified. |
| `/admin/referral/analytics` | /api/referral/admin/* (attribution, house, campaigns, rewards, finance, risk, compliance, users, gamification, analytics, ambassadors, merchants, config) | FEATURE_REFERRALS_ENABLED | false | None | [GATED] Also requires pool != nil. Page-to-leaf mapping not individually verified. |
| `/admin/referral/ambassadors` | /api/referral/admin/* (attribution, house, campaigns, rewards, finance, risk, compliance, users, gamification, analytics, ambassadors, merchants, config) | FEATURE_REFERRALS_ENABLED | false | None | [GATED] Also requires pool != nil. Page-to-leaf mapping not individually verified. |
| `/admin/referral/merchants` | /api/referral/admin/* (attribution, house, campaigns, rewards, finance, risk, compliance, users, gamification, analytics, ambassadors, merchants, config) | FEATURE_REFERRALS_ENABLED | false | None | [GATED] Also requires pool != nil. Page-to-leaf mapping not individually verified. |
| `/admin/referral/config` | /api/referral/admin/* (attribution, house, campaigns, rewards, finance, risk, compliance, users, gamification, analytics, ambassadors, merchants, config) | FEATURE_REFERRALS_ENABLED | false | None | [GATED] Also requires pool != nil. Page-to-leaf mapping not individually verified. |

### Referral Rewards

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/referral-rewards/config` | Frontend calls /api/v1/admin/referrals/* but Go mounts /v1/admin/referrals/* (no /api prefix) | FEATURE_REFERRAL_REWARDS_ENABLED | false | REFERRAL_REWARDS_INTERNAL_SECRET empty => /internal hooks fail closed (no crash). | [GATED] PATH MISMATCH (not just a flag): enabling the flag registers /v1/admin/referrals, the console requests /api/v1/admin/referrals -> still 404 unless a proxy/rewrite maps it. REFERRAL_REWARDS_INTERNAL_SECRET empty => /internal hooks fail closed (no crash). module-status page unverified. |
| `/admin/referral-rewards/analytics` | Frontend calls /api/v1/admin/referrals/* but Go mounts /v1/admin/referrals/* (no /api prefix) | FEATURE_REFERRAL_REWARDS_ENABLED | false | REFERRAL_REWARDS_INTERNAL_SECRET empty => /internal hooks fail closed (no crash). | [GATED] PATH MISMATCH (not just a flag): enabling the flag registers /v1/admin/referrals, the console requests /api/v1/admin/referrals -> still 404 unless a proxy/rewrite maps it. REFERRAL_REWARDS_INTERNAL_SECRET empty => /internal hooks fail closed (no crash). module-status page unverified. |
| `/admin/referral-rewards/fraud` | Frontend calls /api/v1/admin/referrals/* but Go mounts /v1/admin/referrals/* (no /api prefix) | FEATURE_REFERRAL_REWARDS_ENABLED | false | REFERRAL_REWARDS_INTERNAL_SECRET empty => /internal hooks fail closed (no crash). | [GATED] PATH MISMATCH (not just a flag): enabling the flag registers /v1/admin/referrals, the console requests /api/v1/admin/referrals -> still 404 unless a proxy/rewrite maps it. REFERRAL_REWARDS_INTERNAL_SECRET empty => /internal hooks fail closed (no crash). module-status page unverified. |
| `/admin/referral-rewards/ledger` | Frontend calls /api/v1/admin/referrals/* but Go mounts /v1/admin/referrals/* (no /api prefix) | FEATURE_REFERRAL_REWARDS_ENABLED | false | REFERRAL_REWARDS_INTERNAL_SECRET empty => /internal hooks fail closed (no crash). | [GATED] PATH MISMATCH (not just a flag): enabling the flag registers /v1/admin/referrals, the console requests /api/v1/admin/referrals -> still 404 unless a proxy/rewrite maps it. REFERRAL_REWARDS_INTERNAL_SECRET empty => /internal hooks fail closed (no crash). module-status page unverified. |
| `/admin/referral-rewards/case` | Frontend calls /api/v1/admin/referrals/* but Go mounts /v1/admin/referrals/* (no /api prefix) | FEATURE_REFERRAL_REWARDS_ENABLED | false | REFERRAL_REWARDS_INTERNAL_SECRET empty => /internal hooks fail closed (no crash). | [GATED] PATH MISMATCH (not just a flag): enabling the flag registers /v1/admin/referrals, the console requests /api/v1/admin/referrals -> still 404 unless a proxy/rewrite maps it. REFERRAL_REWARDS_INTERNAL_SECRET empty => /internal hooks fail closed (no crash). module-status page unverified. |
| `/admin/referral-rewards/milestones` | Frontend calls /api/v1/admin/referrals/* but Go mounts /v1/admin/referrals/* (no /api prefix) | FEATURE_REFERRAL_REWARDS_ENABLED | false | REFERRAL_REWARDS_INTERNAL_SECRET empty => /internal hooks fail closed (no crash). | [GATED] PATH MISMATCH (not just a flag): enabling the flag registers /v1/admin/referrals, the console requests /api/v1/admin/referrals -> still 404 unless a proxy/rewrite maps it. REFERRAL_REWARDS_INTERNAL_SECRET empty => /internal hooks fail closed (no crash). module-status page unverified. |
| `/admin/referral-rewards/module-status` | Frontend calls /api/v1/admin/referrals/* but Go mounts /v1/admin/referrals/* (no /api prefix) | FEATURE_REFERRAL_REWARDS_ENABLED | false | REFERRAL_REWARDS_INTERNAL_SECRET empty => /internal hooks fail closed (no crash). | [GATED] PATH MISMATCH (not just a flag): enabling the flag registers /v1/admin/referrals, the console requests /api/v1/admin/referrals -> still 404 unless a proxy/rewrite maps it. REFERRAL_REWARDS_INTERNAL_SECRET empty => /internal hooks fail closed (no crash). module-status page unverified. |

### Insurance

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/insurance/dashboard` | /api/insurance/admin/* | FEATURE_INSURANCE_ENABLED | false | None | [GATED] Requires pool; webhooks at /internal/webhooks/{mycover,octamile}. R2 presigner creds optional (upload 503 if unset). |
| `/admin/insurance/catalog` | /api/insurance/admin/* | FEATURE_INSURANCE_ENABLED | false | None | [GATED] Requires pool; webhooks at /internal/webhooks/{mycover,octamile}. R2 presigner creds optional (upload 503 if unset). |
| `/admin/insurance/routing` | /api/insurance/admin/* | FEATURE_INSURANCE_ENABLED | false | None | [GATED] Requires pool; webhooks at /internal/webhooks/{mycover,octamile}. R2 presigner creds optional (upload 503 if unset). |
| `/admin/insurance/schema` | /api/insurance/admin/* | FEATURE_INSURANCE_ENABLED | false | None | [GATED] Requires pool; webhooks at /internal/webhooks/{mycover,octamile}. R2 presigner creds optional (upload 503 if unset). |
| `/admin/insurance/policies` | /api/insurance/admin/* | FEATURE_INSURANCE_ENABLED | false | None | [GATED] Requires pool; webhooks at /internal/webhooks/{mycover,octamile}. R2 presigner creds optional (upload 503 if unset). |
| `/admin/insurance/claims` | /api/insurance/admin/* | FEATURE_INSURANCE_ENABLED | false | None | [GATED] Requires pool; webhooks at /internal/webhooks/{mycover,octamile}. R2 presigner creds optional (upload 503 if unset). |
| `/admin/insurance/premiums` | /api/insurance/admin/* | FEATURE_INSURANCE_ENABLED | false | None | [GATED] Requires pool; webhooks at /internal/webhooks/{mycover,octamile}. R2 presigner creds optional (upload 503 if unset). |
| `/admin/insurance/commission` | /api/insurance/admin/* | FEATURE_INSURANCE_ENABLED | false | None | [GATED] Requires pool; webhooks at /internal/webhooks/{mycover,octamile}. R2 presigner creds optional (upload 503 if unset). |
| `/admin/insurance/reconciliation` | /api/insurance/admin/* | FEATURE_INSURANCE_ENABLED | false | None | [GATED] Requires pool; webhooks at /internal/webhooks/{mycover,octamile}. R2 presigner creds optional (upload 503 if unset). |
| `/admin/insurance/refunds` | /api/insurance/admin/* | FEATURE_INSURANCE_ENABLED | false | None | [GATED] Requires pool; webhooks at /internal/webhooks/{mycover,octamile}. R2 presigner creds optional (upload 503 if unset). |
| `/admin/insurance/providers` | /api/insurance/admin/* | FEATURE_INSURANCE_ENABLED | false | None | [GATED] Requires pool; webhooks at /internal/webhooks/{mycover,octamile}. R2 presigner creds optional (upload 503 if unset). |
| `/admin/insurance/providers/events` | /api/insurance/admin/* | FEATURE_INSURANCE_ENABLED | false | None | [GATED] Requires pool; webhooks at /internal/webhooks/{mycover,octamile}. R2 presigner creds optional (upload 503 if unset). |
| `/admin/insurance/providers/webhooks` | /api/insurance/admin/* | FEATURE_INSURANCE_ENABLED | false | None | [GATED] Requires pool; webhooks at /internal/webhooks/{mycover,octamile}. R2 presigner creds optional (upload 503 if unset). |
| `/admin/insurance/consent-audit` | /api/insurance/admin/* | FEATURE_INSURANCE_ENABLED | false | None | [GATED] Requires pool; webhooks at /internal/webhooks/{mycover,octamile}. R2 presigner creds optional (upload 503 if unset). |
| `/admin/insurance/sweeps` | /api/insurance/admin/* | FEATURE_INSURANCE_ENABLED | false | None | [GATED] Requires pool; webhooks at /internal/webhooks/{mycover,octamile}. R2 presigner creds optional (upload 503 if unset). |
| `/admin/insurance/reports` | /api/insurance/admin/* | FEATURE_INSURANCE_ENABLED | false | None | [GATED] Requires pool; webhooks at /internal/webhooks/{mycover,octamile}. R2 presigner creds optional (upload 503 if unset). |

### Stays

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/stays/dashboard` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/suppliers` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/mapping` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/moderation` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/content-qa` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/coverage` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/reservations` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/manual-actions` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/refunds` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/overbooking` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/reconciliation` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/payouts` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/markup-rules` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/fx` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/commission` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/breaks` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/loyalty` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/promotions` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/reviews` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/cms` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/merchandising` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/fraud` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/reliability` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/agents` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/kyc` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/rbac` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/audit` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/config` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/stays/templates` | /api/stays/admin/* | FEATURE_STAYS_ENABLED | false | None | [GATED] Requires pool. |

### Savings

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/savings/dashboard` | /api/savings/admin/* | FEATURE_SAVINGS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/savings/vaults` | /api/savings/admin/* | FEATURE_SAVINGS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/savings/float-recon` | /api/savings/admin/* | FEATURE_SAVINGS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/savings/ajo` | /api/savings/admin/* | FEATURE_SAVINGS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/savings/defaults` | /api/savings/admin/* | FEATURE_SAVINGS_ENABLED | false | None | [GATED] Requires pool. |

### Social Pay

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/social/dashboard` | /api/social/admin/* | FEATURE_SOCIAL_PAY_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/social/limits` | /api/social/admin/* | FEATURE_SOCIAL_PAY_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/social/reversals` | /api/social/admin/* | FEATURE_SOCIAL_PAY_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/social/disputes` | /api/social/admin/* | FEATURE_SOCIAL_PAY_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/social/cashtags` | /api/social/admin/* | FEATURE_SOCIAL_PAY_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/p2pmarket/dashboard` | /api/p2p/admin/*, /api/finance/p2p/* | FEATURE_P2P_MARKET_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/p2pmarket/listings` | /api/p2p/admin/*, /api/finance/p2p/* | FEATURE_P2P_MARKET_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/p2pmarket/orders` | /api/p2p/admin/*, /api/finance/p2p/* | FEATURE_P2P_MARKET_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/p2pmarket/disputes` | /api/p2p/admin/*, /api/finance/p2p/* | FEATURE_P2P_MARKET_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/spray/dashboard` | /api/p2p/admin/dashboard, /events, /spray/leaderboard | FEATURE_P2P_MARKET_ENABLED | false | None | [GATED] Leaf routes unverified. |
| `/admin/spray/events` | /api/p2p/admin/dashboard, /events, /spray/leaderboard | FEATURE_P2P_MARKET_ENABLED | false | None | [GATED] Leaf routes unverified. |
| `/admin/spray/payouts` | /api/p2p/admin/dashboard, /events, /spray/leaderboard | FEATURE_P2P_MARKET_ENABLED | false | None | [GATED] Leaf routes unverified. |

### Events

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/events/dashboard` | /api/events/admin/* | FEATURE_EVENTS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/events/approval` | /api/events/admin/* | FEATURE_EVENTS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/events/events` | /api/events/admin/* | FEATURE_EVENTS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/events/tickets` | /api/events/admin/* | FEATURE_EVENTS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/events/cashless` | /api/events/admin/* | FEATURE_EVENTS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/events/vendors` | /api/events/admin/* | FEATURE_EVENTS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/events/settlement` | /api/events/admin/* | FEATURE_EVENTS_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/events/fraud` | /api/events/admin/* | FEATURE_EVENTS_ENABLED | false | None | [GATED] Requires pool. |

### Loyalty

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/loyalty/dashboard` | /api/loyalty/admin/* | FEATURE_LOYALTY_ENABLED | false | None | [GATED] |
| `/admin/loyalty/earn-rules` | /api/loyalty/admin/* | FEATURE_LOYALTY_ENABLED | false | None | [GATED] |
| `/admin/loyalty/tiers` | /api/loyalty/admin/* | FEATURE_LOYALTY_ENABLED | false | None | [GATED] |
| `/admin/loyalty/catalog` | /api/loyalty/admin/* | FEATURE_LOYALTY_ENABLED | false | None | [GATED] |
| `/admin/loyalty/redemptions` | /api/loyalty/admin/* | FEATURE_LOYALTY_ENABLED | false | None | [GATED] |
| `/admin/loyalty/liability` | /api/loyalty/admin/* | FEATURE_LOYALTY_ENABLED | false | None | [GATED] |
| `/admin/points/dashboard` | /api/loyalty/admin/* | FEATURE_LOYALTY_ENABLED | false | None | [GATED] Leaf routes unverified. |
| `/admin/points/ledger` | /api/loyalty/admin/* | FEATURE_LOYALTY_ENABLED | false | None | [GATED] Leaf routes unverified. |
| `/admin/points/balances` | /api/loyalty/admin/* | FEATURE_LOYALTY_ENABLED | false | None | [GATED] Leaf routes unverified. |

### Health

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/health/pharmacy/dashboard` | /api/health/pharmacy/admin/* | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_PHARMACY_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/health/pharmacy/pcn-audit` | /api/health/pharmacy/admin/* | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_PHARMACY_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/health/pharmacy/catalog` | /api/health/pharmacy/admin/* | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_PHARMACY_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/health/pharmacy/rx-audit` | /api/health/pharmacy/admin/* | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_PHARMACY_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/health/pharmacy/orders` | /api/health/pharmacy/admin/* | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_PHARMACY_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/health/pharmacy/recall` | /api/health/pharmacy/admin/* | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_PHARMACY_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/health/pharmacy/payouts` | /api/health/pharmacy/admin/* | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_PHARMACY_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/health/pharmacy/reporting` | /api/health/pharmacy/admin/* | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_PHARMACY_ENABLED | false | None | [GATED] Requires pool. |
| `/admin/health/pharmacy-reviews` | unverified | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_PHARMACY_ENABLED (probable) | false | - | [UNVERIFIED] Not traced. |
| `/admin/health/symptom-mappings` | /api/health/pharmacy/admin/* (symptom search) | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_PHARMACY_ENABLED + FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED | false | None | [GATED] |
| `/admin/health/lab/dashboard` | /api/health/lab/admin/* | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_LAB_ENABLED | false | None | [GATED] |
| `/admin/health/lab/mlscn-audit` | /api/health/lab/admin/* | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_LAB_ENABLED | false | None | [GATED] |
| `/admin/health/lab/catalog` | /api/health/lab/admin/* | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_LAB_ENABLED | false | None | [GATED] |
| `/admin/health/lab/custody` | /api/health/lab/admin/* | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_LAB_ENABLED | false | None | [GATED] |
| `/admin/health/lab/results-audit` | /api/health/lab/admin/* | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_LAB_ENABLED | false | None | [GATED] |
| `/admin/health/lab/escalation` | /api/health/lab/admin/* | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_LAB_ENABLED | false | None | [GATED] |
| `/admin/health/lab/phlebotomists` | /api/health/lab/admin/* | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_LAB_ENABLED | false | None | [GATED] |
| `/admin/health/lab/payouts` | /api/health/lab/admin/* | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_LAB_ENABLED | false | None | [GATED] |
| `/admin/health/lab/reporting` | /api/health/lab/admin/* | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_LAB_ENABLED | false | None | [GATED] |
| `/admin/health/vet/dashboard` | /api/health/vet/admin/* (+ /verification) | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_VET_ENABLED | false | None | [GATED] |
| `/admin/health/vet/vcn-audit` | /api/health/vet/admin/* (+ /verification) | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_VET_ENABLED | false | None | [GATED] |
| `/admin/health/vet/verification` | /api/health/vet/admin/* (+ /verification) | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_VET_ENABLED | false | None | [GATED] |
| `/admin/health/vet/services` | /api/health/vet/admin/* (+ /verification) | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_VET_ENABLED | false | None | [GATED] |
| `/admin/health/vet/appointments` | /api/health/vet/admin/* (+ /verification) | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_VET_ENABLED | false | None | [GATED] |
| `/admin/health/vet/eprescription-audit` | /api/health/vet/admin/* (+ /verification) | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_VET_ENABLED | false | None | [GATED] |
| `/admin/health/vet/payouts` | /api/health/vet/admin/* (+ /verification) | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_VET_ENABLED | false | None | [GATED] |
| `/admin/health/vet/moderation` | /api/health/vet/admin/* (+ /verification) | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_VET_ENABLED | false | None | [GATED] |
| `/admin/health/vet/reporting` | /api/health/vet/admin/* (+ /verification) | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_VET_ENABLED | false | None | [GATED] |
| `/admin/health/doctor/verification` | /api/health/doctor/admin/verification/* (health.doctor.review) | FEATURE_DOCTOR_ENABLED | false | None | [GATED] Mounted inside the doctor block. |
| `/admin/intake` | /api/health/admin/intake/* (health.admin.intake) | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_INTAKE_ENABLED | false | None | [GATED] |
| `/admin/health/triage` | /api/health/triage/admin/* | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_TRIAGE_ENABLED | false | None | [GATED] WhatsApp channel has its own FEATURE_HEALTH_TRIAGE_WHATSAPP_ENABLED (not needed for admin). |
| `/admin/health/triage/escalations` | /api/health/triage/admin/* | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_TRIAGE_ENABLED | false | None | [GATED] WhatsApp channel has its own FEATURE_HEALTH_TRIAGE_WHATSAPP_ENABLED (not needed for admin). |
| `/admin/health/triage/content` | /api/health/triage/admin/* | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_TRIAGE_ENABLED | false | None | [GATED] WhatsApp channel has its own FEATURE_HEALTH_TRIAGE_WHATSAPP_ENABLED (not needed for admin). |
| `/admin/health/triage/red-flag-rules` | /api/health/triage/admin/* | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_TRIAGE_ENABLED | false | None | [GATED] WhatsApp channel has its own FEATURE_HEALTH_TRIAGE_WHATSAPP_ENABLED (not needed for admin). |
| `/admin/health/triage/validation` | /api/health/triage/admin/* | FEATURE_HEALTH_ENABLED + FEATURE_HEALTH_TRIAGE_ENABLED | false | None | [GATED] WhatsApp channel has its own FEATURE_HEALTH_TRIAGE_WHATSAPP_ENABLED (not needed for admin). |
| `/admin/telemedicine/dashboard` | /api/v1/telemedicine/admin/* (telemedicine.admin.view\|manage) | FEATURE_TELEMEDICINE_ENABLED | false | None | [GATED] FEATURE_TELEMEDICINE_PLATFORM_FEE_ENABLED only changes pricing. |
| `/admin/telemedicine/consultations` | /api/v1/telemedicine/admin/* (telemedicine.admin.view\|manage) | FEATURE_TELEMEDICINE_ENABLED | false | None | [GATED] FEATURE_TELEMEDICINE_PLATFORM_FEE_ENABLED only changes pricing. |
| `/admin/telemedicine/clinicians` | /api/v1/telemedicine/admin/* (telemedicine.admin.view\|manage) | FEATURE_TELEMEDICINE_ENABLED | false | None | [GATED] FEATURE_TELEMEDICINE_PLATFORM_FEE_ENABLED only changes pricing. |

### Creators

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/creators/dashboard` | /api/creators/admin/* | FEATURE_CREATORS_ENABLED | false | None | [GATED] |
| `/admin/creators/verification` | /api/creators/admin/* | FEATURE_CREATORS_ENABLED | false | None | [GATED] |
| `/admin/creators/moderation` | /api/creators/admin/* | FEATURE_CREATORS_ENABLED | false | None | [GATED] |
| `/admin/creators/billing` | /api/creators/admin/* | FEATURE_CREATORS_ENABLED | false | None | [GATED] |
| `/admin/creators/payouts` | /api/creators/admin/* | FEATURE_CREATORS_ENABLED | false | None | [GATED] |
| `/admin/creators/fees` | /api/creators/admin/* | FEATURE_CREATORS_ENABLED | false | None | [GATED] |
| `/admin/creators/fraud` | /api/creators/admin/* | FEATURE_CREATORS_ENABLED | false | None | [GATED] |

### Social Escrow

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/social-escrow/dashboard` | /api/p2p/admin/escrow/dashboard, /disputes, /escrow/fraud | FEATURE_P2P_MARKET_ENABLED | false | None | [GATED] Leaf routes unverified (served by p2p admin group). |
| `/admin/social-escrow/disputes` | /api/p2p/admin/escrow/dashboard, /disputes, /escrow/fraud | FEATURE_P2P_MARKET_ENABLED | false | None | [GATED] Leaf routes unverified (served by p2p admin group). |
| `/admin/social-escrow/fraud` | /api/p2p/admin/escrow/dashboard, /disputes, /escrow/fraud | FEATURE_P2P_MARKET_ENABLED | false | None | [GATED] Leaf routes unverified (served by p2p admin group). |

### Paymax Black

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/loyalty-black/dashboard` | /api/loyalty/admin/black/* | FEATURE_LOYALTY_ENABLED | false | None | [GATED] |
| `/admin/loyalty-black/perks` | /api/loyalty/admin/black/* | FEATURE_LOYALTY_ENABLED | false | None | [GATED] |
| `/admin/loyalty-black/partners` | /api/loyalty/admin/black/* | FEATURE_LOYALTY_ENABLED | false | None | [GATED] |
| `/admin/loyalty-black/settlement` | /api/loyalty/admin/black/* | FEATURE_LOYALTY_ENABLED | false | None | [GATED] |

### FX Orchestration

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/fx` | /api/finance/admin/fx/{overview,transactions,routing,providers,treasury,spread,recon,customers,compliance,webhooks,analytics,...} | n/a - no Go admin routes | - | - | [NOBACKEND] Only GET/PUT/GET-audit /api/finance/admin/fx/markup exist (registered whenever pool exists; no flag). The 14-page FX console has NO backend: no flag makes these work. Next mock flag NEXT_PUBLIC_FX_ADMIN_USE_MOCK. |
| `/admin/fx/transactions` | /api/finance/admin/fx/{overview,transactions,routing,providers,treasury,spread,recon,customers,compliance,webhooks,analytics,...} | n/a - no Go admin routes | - | - | [NOBACKEND] Only GET/PUT/GET-audit /api/finance/admin/fx/markup exist (registered whenever pool exists; no flag). The 14-page FX console has NO backend: no flag makes these work. Next mock flag NEXT_PUBLIC_FX_ADMIN_USE_MOCK. |
| `/admin/fx/routing` | /api/finance/admin/fx/{overview,transactions,routing,providers,treasury,spread,recon,customers,compliance,webhooks,analytics,...} | n/a - no Go admin routes | - | - | [NOBACKEND] Only GET/PUT/GET-audit /api/finance/admin/fx/markup exist (registered whenever pool exists; no flag). The 14-page FX console has NO backend: no flag makes these work. Next mock flag NEXT_PUBLIC_FX_ADMIN_USE_MOCK. |
| `/admin/fx/providers` | /api/finance/admin/fx/{overview,transactions,routing,providers,treasury,spread,recon,customers,compliance,webhooks,analytics,...} | n/a - no Go admin routes | - | - | [NOBACKEND] Only GET/PUT/GET-audit /api/finance/admin/fx/markup exist (registered whenever pool exists; no flag). The 14-page FX console has NO backend: no flag makes these work. Next mock flag NEXT_PUBLIC_FX_ADMIN_USE_MOCK. |
| `/admin/fx/treasury` | /api/finance/admin/fx/{overview,transactions,routing,providers,treasury,spread,recon,customers,compliance,webhooks,analytics,...} | n/a - no Go admin routes | - | - | [NOBACKEND] Only GET/PUT/GET-audit /api/finance/admin/fx/markup exist (registered whenever pool exists; no flag). The 14-page FX console has NO backend: no flag makes these work. Next mock flag NEXT_PUBLIC_FX_ADMIN_USE_MOCK. |
| `/admin/fx/spread` | /api/finance/admin/fx/{overview,transactions,routing,providers,treasury,spread,recon,customers,compliance,webhooks,analytics,...} | n/a - no Go admin routes | - | - | [NOBACKEND] Only GET/PUT/GET-audit /api/finance/admin/fx/markup exist (registered whenever pool exists; no flag). The 14-page FX console has NO backend: no flag makes these work. Next mock flag NEXT_PUBLIC_FX_ADMIN_USE_MOCK. |
| `/admin/fx/reconciliation` | /api/finance/admin/fx/{overview,transactions,routing,providers,treasury,spread,recon,customers,compliance,webhooks,analytics,...} | n/a - no Go admin routes | - | - | [NOBACKEND] Only GET/PUT/GET-audit /api/finance/admin/fx/markup exist (registered whenever pool exists; no flag). The 14-page FX console has NO backend: no flag makes these work. Next mock flag NEXT_PUBLIC_FX_ADMIN_USE_MOCK. |
| `/admin/fx/customers` | /api/finance/admin/fx/{overview,transactions,routing,providers,treasury,spread,recon,customers,compliance,webhooks,analytics,...} | n/a - no Go admin routes | - | - | [NOBACKEND] Only GET/PUT/GET-audit /api/finance/admin/fx/markup exist (registered whenever pool exists; no flag). The 14-page FX console has NO backend: no flag makes these work. Next mock flag NEXT_PUBLIC_FX_ADMIN_USE_MOCK. |
| `/admin/fx/compliance` | /api/finance/admin/fx/{overview,transactions,routing,providers,treasury,spread,recon,customers,compliance,webhooks,analytics,...} | n/a - no Go admin routes | - | - | [NOBACKEND] Only GET/PUT/GET-audit /api/finance/admin/fx/markup exist (registered whenever pool exists; no flag). The 14-page FX console has NO backend: no flag makes these work. Next mock flag NEXT_PUBLIC_FX_ADMIN_USE_MOCK. |
| `/admin/fx/webhooks` | /api/finance/admin/fx/{overview,transactions,routing,providers,treasury,spread,recon,customers,compliance,webhooks,analytics,...} | n/a - no Go admin routes | - | - | [NOBACKEND] Only GET/PUT/GET-audit /api/finance/admin/fx/markup exist (registered whenever pool exists; no flag). The 14-page FX console has NO backend: no flag makes these work. Next mock flag NEXT_PUBLIC_FX_ADMIN_USE_MOCK. |
| `/admin/fx/analytics` | /api/finance/admin/fx/{overview,transactions,routing,providers,treasury,spread,recon,customers,compliance,webhooks,analytics,...} | n/a - no Go admin routes | - | - | [NOBACKEND] Only GET/PUT/GET-audit /api/finance/admin/fx/markup exist (registered whenever pool exists; no flag). The 14-page FX console has NO backend: no flag makes these work. Next mock flag NEXT_PUBLIC_FX_ADMIN_USE_MOCK. |
| `/admin/fx/collections` | /api/finance/admin/fx/{overview,transactions,routing,providers,treasury,spread,recon,customers,compliance,webhooks,analytics,...} | n/a - no Go admin routes | - | - | [NOBACKEND] Only GET/PUT/GET-audit /api/finance/admin/fx/markup exist (registered whenever pool exists; no flag). The 14-page FX console has NO backend: no flag makes these work. Next mock flag NEXT_PUBLIC_FX_ADMIN_USE_MOCK. |
| `/admin/fx/cards` | /api/finance/admin/fx/{overview,transactions,routing,providers,treasury,spread,recon,customers,compliance,webhooks,analytics,...} | n/a - no Go admin routes | - | - | [NOBACKEND] Only GET/PUT/GET-audit /api/finance/admin/fx/markup exist (registered whenever pool exists; no flag). The 14-page FX console has NO backend: no flag makes these work. Next mock flag NEXT_PUBLIC_FX_ADMIN_USE_MOCK. |
| `/admin/fx/settings` | /api/finance/admin/fx/{overview,transactions,routing,providers,treasury,spread,recon,customers,compliance,webhooks,analytics,...} | n/a - no Go admin routes | - | - | [NOBACKEND] Only GET/PUT/GET-audit /api/finance/admin/fx/markup exist (registered whenever pool exists; no flag). The 14-page FX console has NO backend: no flag makes these work. Next mock flag NEXT_PUBLIC_FX_ADMIN_USE_MOCK. |

### Invest (Stocks)

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/invest` | /api/v1/admin/invest/* (invest.manage) | FEATURE_INVEST_ENABLED | false | None to boot; Redis used by workers (Redlock) - connection failure is non-fatal. Keep FEATURE_INVEST_PIN_DEV_BYPASS off. | [GATED] Starts settlement + price-alert workers (Redlock/Redis). Broker/market creds optional (mock fallback). FEATURE_INVEST_PIN_DEV_BYPASS must stay off outside dev. |
| `/admin/invest/assets` | /api/v1/admin/invest/* (invest.manage) | FEATURE_INVEST_ENABLED | false | None to boot; Redis used by workers (Redlock) - connection failure is non-fatal. Keep FEATURE_INVEST_PIN_DEV_BYPASS off. | [GATED] Starts settlement + price-alert workers (Redlock/Redis). Broker/market creds optional (mock fallback). FEATURE_INVEST_PIN_DEV_BYPASS must stay off outside dev. |
| `/admin/invest/orders` | /api/v1/admin/invest/* (invest.manage) | FEATURE_INVEST_ENABLED | false | None to boot; Redis used by workers (Redlock) - connection failure is non-fatal. Keep FEATURE_INVEST_PIN_DEV_BYPASS off. | [GATED] Starts settlement + price-alert workers (Redlock/Redis). Broker/market creds optional (mock fallback). FEATURE_INVEST_PIN_DEV_BYPASS must stay off outside dev. |
| `/admin/invest/settlement` | /api/v1/admin/invest/* (invest.manage) | FEATURE_INVEST_ENABLED | false | None to boot; Redis used by workers (Redlock) - connection failure is non-fatal. Keep FEATURE_INVEST_PIN_DEV_BYPASS off. | [GATED] Starts settlement + price-alert workers (Redlock/Redis). Broker/market creds optional (mock fallback). FEATURE_INVEST_PIN_DEV_BYPASS must stay off outside dev. |
| `/admin/invest/reconciliation` | /api/v1/admin/invest/* (invest.manage) | FEATURE_INVEST_ENABLED | false | None to boot; Redis used by workers (Redlock) - connection failure is non-fatal. Keep FEATURE_INVEST_PIN_DEV_BYPASS off. | [GATED] Starts settlement + price-alert workers (Redlock/Redis). Broker/market creds optional (mock fallback). FEATURE_INVEST_PIN_DEV_BYPASS must stay off outside dev. |
| `/admin/invest/corporate-actions` | /api/v1/admin/invest/* (invest.manage) | FEATURE_INVEST_ENABLED | false | None to boot; Redis used by workers (Redlock) - connection failure is non-fatal. Keep FEATURE_INVEST_PIN_DEV_BYPASS off. | [GATED] Starts settlement + price-alert workers (Redlock/Redis). Broker/market creds optional (mock fallback). FEATURE_INVEST_PIN_DEV_BYPASS must stay off outside dev. |
| `/admin/invest/providers` | /api/v1/admin/invest/* (invest.manage) | FEATURE_INVEST_ENABLED | false | None to boot; Redis used by workers (Redlock) - connection failure is non-fatal. Keep FEATURE_INVEST_PIN_DEV_BYPASS off. | [GATED] Starts settlement + price-alert workers (Redlock/Redis). Broker/market creds optional (mock fallback). FEATURE_INVEST_PIN_DEV_BYPASS must stay off outside dev. |
| `/admin/invest/fees` | /api/v1/admin/invest/* (invest.manage) | FEATURE_INVEST_ENABLED | false | None to boot; Redis used by workers (Redlock) - connection failure is non-fatal. Keep FEATURE_INVEST_PIN_DEV_BYPASS off. | [GATED] Starts settlement + price-alert workers (Redlock/Redis). Broker/market creds optional (mock fallback). FEATURE_INVEST_PIN_DEV_BYPASS must stay off outside dev. |
| `/admin/invest/audit` | /api/v1/admin/invest/* (invest.manage) | FEATURE_INVEST_ENABLED | false | None to boot; Redis used by workers (Redlock) - connection failure is non-fatal. Keep FEATURE_INVEST_PIN_DEV_BYPASS off. | [GATED] Starts settlement + price-alert workers (Redlock/Redis). Broker/market creds optional (mock fallback). FEATURE_INVEST_PIN_DEV_BYPASS must stay off outside dev. |

### Crypto

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/crypto` | /api/v1/admin/crypto/* (crypto.admin) | FEATURE_CRYPTO_ENABLED | false | CRYPTO_PROVIDER (default "mock"); Quidax TEST/LIVE keys optional. | [GATED] Quidax creds optional (falls back to mock). |
| `/admin/crypto/orders` | /api/v1/admin/crypto/* (crypto.admin) | FEATURE_CRYPTO_ENABLED | false | CRYPTO_PROVIDER (default "mock"); Quidax TEST/LIVE keys optional. | [GATED] Quidax creds optional (falls back to mock). |
| `/admin/crypto/assets` | /api/v1/admin/crypto/* (crypto.admin) | FEATURE_CRYPTO_ENABLED | false | CRYPTO_PROVIDER (default "mock"); Quidax TEST/LIVE keys optional. | [GATED] Quidax creds optional (falls back to mock). |
| `/admin/crypto/withdrawals` | /api/v1/admin/crypto/* (crypto.admin) | FEATURE_CRYPTO_ENABLED | false | CRYPTO_PROVIDER (default "mock"); Quidax TEST/LIVE keys optional. | [GATED] Quidax creds optional (falls back to mock). |
| `/admin/crypto/swaps` | /api/v1/admin/crypto/* (crypto.admin) | FEATURE_CRYPTO_ENABLED | false | CRYPTO_PROVIDER (default "mock"); Quidax TEST/LIVE keys optional. | [GATED] Quidax creds optional (falls back to mock). |
| `/admin/crypto/addresses` | /api/v1/admin/crypto/* (crypto.admin) | FEATURE_CRYPTO_ENABLED | false | CRYPTO_PROVIDER (default "mock"); Quidax TEST/LIVE keys optional. | [GATED] Quidax creds optional (falls back to mock). |
| `/admin/crypto/reconciliation` | /api/v1/admin/crypto/* (crypto.admin) | FEATURE_CRYPTO_ENABLED | false | CRYPTO_PROVIDER (default "mock"); Quidax TEST/LIVE keys optional. | [GATED] Quidax creds optional (falls back to mock). |

### Property Management

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/estate` | /api/finance/estate-admin/* (estate.admin.*), /api/finance/estate/:id/* | FEATURE_ESTATE_ENABLED | false | None | [GATED] Nothing validated at boot. FEATURE_ESTATE_DUES_PAYSTACK_CHECKOUT_ENABLED only affects dues checkout. |
| `/admin/estate/residents` | /api/finance/estate-admin/* (estate.admin.*), /api/finance/estate/:id/* | FEATURE_ESTATE_ENABLED | false | None | [GATED] Nothing validated at boot. FEATURE_ESTATE_DUES_PAYSTACK_CHECKOUT_ENABLED only affects dues checkout. |
| `/admin/estate/properties` | /api/finance/estate-admin/* (estate.admin.*), /api/finance/estate/:id/* | FEATURE_ESTATE_ENABLED | false | None | [GATED] Nothing validated at boot. FEATURE_ESTATE_DUES_PAYSTACK_CHECKOUT_ENABLED only affects dues checkout. |
| `/admin/estate/dues` | /api/finance/estate-admin/* (estate.admin.*), /api/finance/estate/:id/* | FEATURE_ESTATE_ENABLED | false | None | [GATED] Nothing validated at boot. FEATURE_ESTATE_DUES_PAYSTACK_CHECKOUT_ENABLED only affects dues checkout. |
| `/admin/estate/gates` | /api/finance/estate-admin/* (estate.admin.*), /api/finance/estate/:id/* | FEATURE_ESTATE_ENABLED | false | None | [GATED] Nothing validated at boot. FEATURE_ESTATE_DUES_PAYSTACK_CHECKOUT_ENABLED only affects dues checkout. |
| `/admin/estate/vendors` | /api/finance/estate-admin/* (estate.admin.*), /api/finance/estate/:id/* | FEATURE_ESTATE_ENABLED | false | None | [GATED] Nothing validated at boot. FEATURE_ESTATE_DUES_PAYSTACK_CHECKOUT_ENABLED only affects dues checkout. |
| `/admin/estate/security` | /api/finance/estate-admin/* (estate.admin.*), /api/finance/estate/:id/* | FEATURE_ESTATE_ENABLED | false | None | [GATED] Nothing validated at boot. FEATURE_ESTATE_DUES_PAYSTACK_CHECKOUT_ENABLED only affects dues checkout. |
| `/admin/estate/visitor-logs` | /api/finance/estate-admin/* (estate.admin.*), /api/finance/estate/:id/* | FEATURE_ESTATE_ENABLED | false | None | [GATED] Nothing validated at boot. FEATURE_ESTATE_DUES_PAYSTACK_CHECKOUT_ENABLED only affects dues checkout. |
| `/admin/estate/dues-reconciliation` | /api/finance/estate-admin/* (estate.admin.*), /api/finance/estate/:id/* | FEATURE_ESTATE_ENABLED | false | None | [GATED] Nothing validated at boot. FEATURE_ESTATE_DUES_PAYSTACK_CHECKOUT_ENABLED only affects dues checkout. |
| `/admin/estate/ops` | /api/finance/estate-admin/* (estate.admin.*), /api/finance/estate/:id/* | FEATURE_ESTATE_ENABLED | false | None | [GATED] Nothing validated at boot. FEATURE_ESTATE_DUES_PAYSTACK_CHECKOUT_ENABLED only affects dues checkout. |
| `/admin/estate/content` | /api/finance/estate-admin/* (estate.admin.*), /api/finance/estate/:id/* | FEATURE_ESTATE_ENABLED | false | None | [GATED] Nothing validated at boot. FEATURE_ESTATE_DUES_PAYSTACK_CHECKOUT_ENABLED only affects dues checkout. |
| `/admin/estate/elections` | /api/finance/estate-admin/* (estate.admin.*), /api/finance/estate/:id/* | FEATURE_ESTATE_ENABLED | false | None | [GATED] Nothing validated at boot. FEATURE_ESTATE_DUES_PAYSTACK_CHECKOUT_ENABLED only affects dues checkout. |
| `/admin/vendors` | /api/finance/estate/:id/vendors, /vendor/jobs | FEATURE_ESTATE_ENABLED | false | None | [GATED] |
| `/admin/vendors/onboarding` | /api/finance/estate/:id/vendors, /vendor/jobs | FEATURE_ESTATE_ENABLED | false | None | [GATED] |
| `/admin/vendors/payouts` | /api/finance/estate/:id/vendors, /vendor/jobs | FEATURE_ESTATE_ENABLED | false | None | [GATED] |
| `/admin/property` | /api/finance/property/context, /rent-passport/lookup/:userId | FEATURE_PROPERTY_SUITE_ENABLED | false | None | [GATED] |
| `/admin/realtor` | /api/realtor/admin/{overview,listings/pending,verifications,payments,escrow} | FEATURE_REALTOR_ENABLED | false | None | [GATED] realtor.Register no-ops when flag off. |
| `/admin/realtor/moderation` | /api/realtor/admin/{overview,listings/pending,verifications,payments,escrow} | FEATURE_REALTOR_ENABLED | false | None | [GATED] realtor.Register no-ops when flag off. |
| `/admin/realtor/verification` | /api/realtor/admin/{overview,listings/pending,verifications,payments,escrow} | FEATURE_REALTOR_ENABLED | false | None | [GATED] realtor.Register no-ops when flag off. |
| `/admin/realtor/payments` | /api/realtor/admin/{overview,listings/pending,verifications,payments,escrow} | FEATURE_REALTOR_ENABLED | false | None | [GATED] realtor.Register no-ops when flag off. |

### Mobility

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/mobility` | /api/finance/admin/transport/{dashboard,drivers,vehicles,trips,dispatch,pricing,safety,reports,commission,audit} | FEATURE_TRANSPORT_ENABLED | false | APP_ENV=production\|prod: log.Fatalf unless MapService wired (FEATURE_MAPS_ENABLED=true + working MAPS_PROVIDER config). Non-prod: warning, uses MockMaps (fabricated fares). | [GATED] Also gated by RequireAdmin(ADMIN_API_KEY) + RBAC mobility.*; Fatal at boot in prod if no MapService (see prerequisites). |
| `/admin/mobility/drivers` | /api/finance/admin/transport/{dashboard,drivers,vehicles,trips,dispatch,pricing,safety,reports,commission,audit} | FEATURE_TRANSPORT_ENABLED | false | APP_ENV=production\|prod: log.Fatalf unless MapService wired (FEATURE_MAPS_ENABLED=true + working MAPS_PROVIDER config). Non-prod: warning, uses MockMaps (fabricated fares). | [GATED] Also gated by RequireAdmin(ADMIN_API_KEY) + RBAC mobility.*; Fatal at boot in prod if no MapService (see prerequisites). |
| `/admin/mobility/vehicles` | /api/finance/admin/transport/{dashboard,drivers,vehicles,trips,dispatch,pricing,safety,reports,commission,audit} | FEATURE_TRANSPORT_ENABLED | false | APP_ENV=production\|prod: log.Fatalf unless MapService wired (FEATURE_MAPS_ENABLED=true + working MAPS_PROVIDER config). Non-prod: warning, uses MockMaps (fabricated fares). | [GATED] Also gated by RequireAdmin(ADMIN_API_KEY) + RBAC mobility.*; Fatal at boot in prod if no MapService (see prerequisites). |
| `/admin/mobility/dispatch` | /api/finance/admin/transport/{dashboard,drivers,vehicles,trips,dispatch,pricing,safety,reports,commission,audit} | FEATURE_TRANSPORT_ENABLED | false | APP_ENV=production\|prod: log.Fatalf unless MapService wired (FEATURE_MAPS_ENABLED=true + working MAPS_PROVIDER config). Non-prod: warning, uses MockMaps (fabricated fares). | [GATED] Also gated by RequireAdmin(ADMIN_API_KEY) + RBAC mobility.*; Fatal at boot in prod if no MapService (see prerequisites). |
| `/admin/mobility/pricing` | /api/finance/admin/transport/{dashboard,drivers,vehicles,trips,dispatch,pricing,safety,reports,commission,audit} | FEATURE_TRANSPORT_ENABLED | false | APP_ENV=production\|prod: log.Fatalf unless MapService wired (FEATURE_MAPS_ENABLED=true + working MAPS_PROVIDER config). Non-prod: warning, uses MockMaps (fabricated fares). | [GATED] Also gated by RequireAdmin(ADMIN_API_KEY) + RBAC mobility.*; Fatal at boot in prod if no MapService (see prerequisites). |
| `/admin/mobility/safety` | /api/finance/admin/transport/{dashboard,drivers,vehicles,trips,dispatch,pricing,safety,reports,commission,audit} | FEATURE_TRANSPORT_ENABLED | false | APP_ENV=production\|prod: log.Fatalf unless MapService wired (FEATURE_MAPS_ENABLED=true + working MAPS_PROVIDER config). Non-prod: warning, uses MockMaps (fabricated fares). | [GATED] Also gated by RequireAdmin(ADMIN_API_KEY) + RBAC mobility.*; Fatal at boot in prod if no MapService (see prerequisites). |
| `/admin/mobility/reports` | /api/finance/admin/transport/{dashboard,drivers,vehicles,trips,dispatch,pricing,safety,reports,commission,audit} | FEATURE_TRANSPORT_ENABLED | false | APP_ENV=production\|prod: log.Fatalf unless MapService wired (FEATURE_MAPS_ENABLED=true + working MAPS_PROVIDER config). Non-prod: warning, uses MockMaps (fabricated fares). | [GATED] Also gated by RequireAdmin(ADMIN_API_KEY) + RBAC mobility.*; Fatal at boot in prod if no MapService (see prerequisites). |
| `/admin/mobility/parcels` | /api/finance/admin/transport/parcels/* | FEATURE_TRANSPORT_ENABLED + FEATURE_TRANSPORT_MODES_ENABLED | false | APP_ENV=production\|prod: log.Fatalf unless MapService wired (FEATURE_MAPS_ENABLED=true + working MAPS_PROVIDER config). Non-prod: warning, uses MockMaps (fabricated fares). | [GATED] Admin routes are inside the modes block. |
| `/admin/mobility/bus` | /api/finance/admin/transport/bus/* | FEATURE_TRANSPORT_ENABLED + FEATURE_TRANSPORT_MODES_ENABLED | false | APP_ENV=production\|prod: log.Fatalf unless MapService wired (FEATURE_MAPS_ENABLED=true + working MAPS_PROVIDER config). Non-prod: warning, uses MockMaps (fabricated fares). | [GATED] Admin routes are inside the modes block. |
| `/admin/mobility/towing` | /api/finance/admin/transport/towing/* | FEATURE_TRANSPORT_ENABLED + FEATURE_TRANSPORT_MODES_ENABLED | false | APP_ENV=production\|prod: log.Fatalf unless MapService wired (FEATURE_MAPS_ENABLED=true + working MAPS_PROVIDER config). Non-prod: warning, uses MockMaps (fabricated fares). | [GATED] Admin routes are inside the modes block. |
| `/admin/mobility/movers` | /api/finance/admin/transport/movers/* | FEATURE_TRANSPORT_ENABLED + FEATURE_TRANSPORT_MODES_ENABLED | false | APP_ENV=production\|prod: log.Fatalf unless MapService wired (FEATURE_MAPS_ENABLED=true + working MAPS_PROVIDER config). Non-prod: warning, uses MockMaps (fabricated fares). | [GATED] Admin routes are inside the modes block. |
| `/admin/mobility/car-hire` | /api/finance/admin/transport/car-hire/* | FEATURE_TRANSPORT_ENABLED + FEATURE_TRANSPORT_MODES_ENABLED | false | APP_ENV=production\|prod: log.Fatalf unless MapService wired (FEATURE_MAPS_ENABLED=true + working MAPS_PROVIDER config). Non-prod: warning, uses MockMaps (fabricated fares). | [GATED] Admin routes are inside the modes block. |
| `/admin/mobility/business` | /api/finance/admin/transport/business/* | FEATURE_TRANSPORT_ENABLED + FEATURE_TRANSPORT_MODES_ENABLED | false | APP_ENV=production\|prod: log.Fatalf unless MapService wired (FEATURE_MAPS_ENABLED=true + working MAPS_PROVIDER config). Non-prod: warning, uses MockMaps (fabricated fares). | [GATED] Admin routes are inside the modes block. |
| `/admin/mobility/events` | /api/finance/admin/transport/events/* | FEATURE_TRANSPORT_ENABLED + FEATURE_TRANSPORT_MODES_ENABLED | false | APP_ENV=production\|prod: log.Fatalf unless MapService wired (FEATURE_MAPS_ENABLED=true + working MAPS_PROVIDER config). Non-prod: warning, uses MockMaps (fabricated fares). | [GATED] Admin routes are inside the modes block. |
| `/admin/mobility/scheduled` | /api/finance/admin/transport/scheduled* | FEATURE_TRANSPORT_ENABLED + FEATURE_TRANSPORT_SCHEDULING_ENABLED | false | APP_ENV=production\|prod: log.Fatalf unless MapService wired (FEATURE_MAPS_ENABLED=true + working MAPS_PROVIDER config). Non-prod: warning, uses MockMaps (fabricated fares). | [GATED] Also needs the cmd/transport-scheduler worker for materialisation (not for the admin list). |

### Restaurant

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/restaurant` | /api/restaurant/admin/* (+ /delivery-config); some reads via /api/finance/restaurant/* | FEATURE_RESTAURANT_ENABLED | false | None | [GATED] FEATURE_RESTAURANT_WITHDRAWALS_ENABLED gates the withdrawal money move only; FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED gates card checkout. |
| `/admin/restaurant/delivery-fee` | /api/restaurant/admin/* (+ /delivery-config); some reads via /api/finance/restaurant/* | FEATURE_RESTAURANT_ENABLED | false | None | [GATED] FEATURE_RESTAURANT_WITHDRAWALS_ENABLED gates the withdrawal money move only; FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED gates card checkout. |
| `/admin/restaurant/dispatch` | /api/restaurant/admin/* (+ /delivery-config); some reads via /api/finance/restaurant/* | FEATURE_RESTAURANT_ENABLED | false | None | [GATED] FEATURE_RESTAURANT_WITHDRAWALS_ENABLED gates the withdrawal money move only; FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED gates card checkout. |
| `/admin/restaurant/onboarding` | /api/restaurant/admin/* (+ /delivery-config); some reads via /api/finance/restaurant/* | FEATURE_RESTAURANT_ENABLED | false | None | [GATED] FEATURE_RESTAURANT_WITHDRAWALS_ENABLED gates the withdrawal money move only; FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED gates card checkout. |
| `/admin/restaurant/payouts` | /api/restaurant/admin/* (+ /delivery-config); some reads via /api/finance/restaurant/* | FEATURE_RESTAURANT_ENABLED | false | None | [GATED] FEATURE_RESTAURANT_WITHDRAWALS_ENABLED gates the withdrawal money move only; FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED gates card checkout. |
| `/admin/restaurant/withdrawals` | /api/restaurant/admin/* (+ /delivery-config); some reads via /api/finance/restaurant/* | FEATURE_RESTAURANT_ENABLED | false | None | [GATED] FEATURE_RESTAURANT_WITHDRAWALS_ENABLED gates the withdrawal money move only; FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED gates card checkout. |
| `/admin/restaurant/disputes` | /api/restaurant/admin/* (+ /delivery-config); some reads via /api/finance/restaurant/* | FEATURE_RESTAURANT_ENABLED | false | None | [GATED] FEATURE_RESTAURANT_WITHDRAWALS_ENABLED gates the withdrawal money move only; FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED gates card checkout. |

### Platform

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/maps` | /api/maps/admin/{dashboard,events,providers,contributions} | FEATURE_MAPS_ENABLED + FEATURE_MAPS_V2_ENABLED | false | MAPS_GOOGLE_KEY: prod abort if missing; else warning (address lookup falls back to mock). MAPS_PROVIDER default "mock". | [GATED] Registered only if MapService builds without error. MAPS_GOOGLE_KEY missing => warning (fatal in prod). |
| `/admin/maps/contributions` | /api/maps/admin/{dashboard,events,providers,contributions} | FEATURE_MAPS_ENABLED + FEATURE_MAPS_V2_ENABLED | false | MAPS_GOOGLE_KEY: prod abort if missing; else warning (address lookup falls back to mock). MAPS_PROVIDER default "mock". | [GATED] Registered only if MapService builds without error. MAPS_GOOGLE_KEY missing => warning (fatal in prod). |

### Fractional RE

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/fractionalre` | /api/finance/fractionalre/admin/* | FEATURE_FRACTIONAL_RE_ENABLED | false | None | [GATED] fractionalre.Register no-ops when off. Auto-invest runner only starts when on. |
| `/admin/fractionalre/assets` | /api/finance/fractionalre/admin/* | FEATURE_FRACTIONAL_RE_ENABLED | false | None | [GATED] fractionalre.Register no-ops when off. Auto-invest runner only starts when on. |
| `/admin/fractionalre/rounds` | /api/finance/fractionalre/admin/* | FEATURE_FRACTIONAL_RE_ENABLED | false | None | [GATED] fractionalre.Register no-ops when off. Auto-invest runner only starts when on. |
| `/admin/fractionalre/cap-table` | /api/finance/fractionalre/admin/* | FEATURE_FRACTIONAL_RE_ENABLED | false | None | [GATED] fractionalre.Register no-ops when off. Auto-invest runner only starts when on. |
| `/admin/fractionalre/investors` | /api/finance/fractionalre/admin/* | FEATURE_FRACTIONAL_RE_ENABLED | false | None | [GATED] fractionalre.Register no-ops when off. Auto-invest runner only starts when on. |
| `/admin/fractionalre/compliance` | /api/finance/fractionalre/admin/* | FEATURE_FRACTIONAL_RE_ENABLED | false | None | [GATED] fractionalre.Register no-ops when off. Auto-invest runner only starts when on. |
| `/admin/fractionalre/distributions` | /api/finance/fractionalre/admin/* | FEATURE_FRACTIONAL_RE_ENABLED | false | None | [GATED] fractionalre.Register no-ops when off. Auto-invest runner only starts when on. |
| `/admin/fractionalre/market` | /api/finance/fractionalre/admin/* | FEATURE_FRACTIONAL_RE_ENABLED | false | None | [GATED] fractionalre.Register no-ops when off. Auto-invest runner only starts when on. |
| `/admin/fractionalre/sponsors` | /api/finance/fractionalre/admin/* | FEATURE_FRACTIONAL_RE_ENABLED | false | None | [GATED] fractionalre.Register no-ops when off. Auto-invest runner only starts when on. |
| `/admin/fractionalre/finance` | /api/finance/fractionalre/admin/* | FEATURE_FRACTIONAL_RE_ENABLED | false | None | [GATED] fractionalre.Register no-ops when off. Auto-invest runner only starts when on. |
| `/admin/fractionalre/documents` | /api/finance/fractionalre/admin/* | FEATURE_FRACTIONAL_RE_ENABLED | false | None | [GATED] fractionalre.Register no-ops when off. Auto-invest runner only starts when on. |
| `/admin/fractionalre/audit` | /api/finance/fractionalre/admin/* | FEATURE_FRACTIONAL_RE_ENABLED | false | None | [GATED] fractionalre.Register no-ops when off. Auto-invest runner only starts when on. |

### Academy

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/academy` | /api/academy/admin/dashboard | FEATURE_ACADEMY_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] |
| `/admin/academy/curriculum` | /api/academy/admin/curriculum* (identity/curriculum/commerce on /api root) | FEATURE_ACADEMY_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] |
| `/admin/academy/content` | /api/academy/admin/content/* | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_SPINE_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] |
| `/admin/academy/content-production` | /api/academy/admin/content/productions | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_SPINE_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] |
| `/admin/academy/bundles` | /api/academy/admin/offline-bundles | FEATURE_ACADEMY_ENABLED (sub-flag unverified) | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] Which Academy sub-package owns this route was not traced. |
| `/admin/academy/question-bank` | /api/academy/admin/question-bank/* | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_EXAM_ENABLED (probable) | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] Assessment package; sub-flag mapping unverified. |
| `/admin/academy/exams` | /api/academy/admin/exam/* | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_EXAM_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] |
| `/admin/academy/gamification` | /api/academy/admin/gamification* (identity/curriculum/commerce on /api root) | FEATURE_ACADEMY_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] |
| `/admin/academy/rewards` | /api/academy/admin/rewards* (identity/curriculum/commerce on /api root) | FEATURE_ACADEMY_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] |
| `/admin/academy/notifications` | /api/academy/admin/notifications | FEATURE_ACADEMY_ENABLED (sub-flag unverified) | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] Which Academy sub-package owns this route was not traced. |
| `/admin/academy/commerce` | /api/academy/admin/commerce* (identity/curriculum/commerce on /api root) | FEATURE_ACADEMY_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] |
| `/admin/academy/edupay` | /api/academy/admin/edupay/* | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_EDUPAY_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] |
| `/admin/academy/sponsors` | /api/academy/admin/sponsors | FEATURE_ACADEMY_ENABLED (sub-flag unverified) | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] Which Academy sub-package owns this route was not traced. |
| `/admin/academy/credentials` | /api/academy/admin/credentials/* | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_CREDENTIALS_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] |
| `/admin/academy/live` | /api/academy/admin/live/* | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_LIVE_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] |
| `/admin/academy/moderation` | /api/academy/admin/moderation | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_LIVE_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] |
| `/admin/academy/schools` | /api/academy/admin/schools/* | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_SCHOOLS_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] |
| `/admin/academy/tutors` | /api/academy/admin/tutors/* | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_TUTOR_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] |
| `/admin/academy/analytics` | /api/academy/admin/analytics | FEATURE_ACADEMY_ENABLED (sub-flag unverified) | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] Which Academy sub-package owns this route was not traced. |
| `/admin/academy/film` | /api/admin/academy/* (web-proxy) | (frontend-web, not Go) | - | - | [NEXT] Film Academy console lives in frontend-web. |
| `/admin/academy/fees/setup-wizard` | /api/academy/admin/fees/*, /export/compliance | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_FEES_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] Runtime override table academy_feature_flags can change effective sub-flags. |
| `/admin/academy/fees/onboarding` | /api/academy/admin/fees/*, /export/compliance | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_FEES_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] Runtime override table academy_feature_flags can change effective sub-flags. |
| `/admin/academy/fees/collections` | /api/academy/admin/fees/*, /export/compliance | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_FEES_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] Runtime override table academy_feature_flags can change effective sub-flags. |
| `/admin/academy/fees/hardship` | /api/academy/admin/fees/*, /export/compliance | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_FEES_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] Runtime override table academy_feature_flags can change effective sub-flags. |
| `/admin/academy/fees/promotion` | /api/academy/admin/fees/*, /export/compliance | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_FEES_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] Runtime override table academy_feature_flags can change effective sub-flags. |
| `/admin/academy/fees/competition` | /api/academy/admin/fees/*, /export/compliance | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_FEES_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] Runtime override table academy_feature_flags can change effective sub-flags. |
| `/admin/academy/fees/gov-export` | /api/academy/admin/fees/*, /export/compliance | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_FEES_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] Runtime override table academy_feature_flags can change effective sub-flags. |
| `/admin/academy/fees/roles` | /api/academy/admin/fees/*, /export/compliance | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_FEES_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] Runtime override table academy_feature_flags can change effective sub-flags. |
| `/admin/learn` | /api/v1/learn/admin/* | FEATURE_LEARN_ENABLED | false | None | [GATED] Needs shared pool. |
| `/admin/spotlight` | /api/v1/spotlight/admin/* | FEATURE_SPOTLIGHTWEALTH_ENABLED | false | None | [GATED] Needs shared pool. |

### Community

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/groups/dashboard` | /api/finance/groups/admin/dashboard etc. | FEATURE_GROUPS_ENABLED (member routes only) | false | - | [NOBACKEND] Go groups block registers ONLY member routes (create/list/get/invite/dues). No admin routes exist; page 404s even with the flag. Next mock flag NEXT_PUBLIC_GROUPS_ADMIN_USE_MOCK. |
| `/admin/groups/groups` | /api/finance/groups/admin/dashboard etc. | FEATURE_GROUPS_ENABLED (member routes only) | false | - | [NOBACKEND] Go groups block registers ONLY member routes (create/list/get/invite/dues). No admin routes exist; page 404s even with the flag. Next mock flag NEXT_PUBLIC_GROUPS_ADMIN_USE_MOCK. |
| `/admin/association/dashboard` | /api/finance/associations/admin/*, /offline/* | FEATURE_ASSOCIATIONS_ENABLED | false | ASSOC_CARD_SIGNING_SECRET: log.Fatalf at route registration whenever APP_ENV != "development" (includes staging and "dev"/"test" spellings!). Dev with it unset = warning (public dev key). | [GATED] FATAL at boot unless ASSOC_CARD_SIGNING_SECRET set when APP_ENV != "development". Registry env_flag was seeded as FEATURE_ASSOCIATION_ENABLED (singular) until migration 20270320000000. |
| `/admin/association/organisations` | /api/finance/associations/admin/*, /offline/* | FEATURE_ASSOCIATIONS_ENABLED | false | ASSOC_CARD_SIGNING_SECRET: log.Fatalf at route registration whenever APP_ENV != "development" (includes staging and "dev"/"test" spellings!). Dev with it unset = warning (public dev key). | [GATED] FATAL at boot unless ASSOC_CARD_SIGNING_SECRET set when APP_ENV != "development". Registry env_flag was seeded as FEATURE_ASSOCIATION_ENABLED (singular) until migration 20270320000000. |
| `/admin/association/approvals` | /api/finance/associations/admin/*, /offline/* | FEATURE_ASSOCIATIONS_ENABLED | false | ASSOC_CARD_SIGNING_SECRET: log.Fatalf at route registration whenever APP_ENV != "development" (includes staging and "dev"/"test" spellings!). Dev with it unset = warning (public dev key). | [GATED] FATAL at boot unless ASSOC_CARD_SIGNING_SECRET set when APP_ENV != "development". Registry env_flag was seeded as FEATURE_ASSOCIATION_ENABLED (singular) until migration 20270320000000. |
| `/admin/association/dues` | /api/finance/associations/admin/*, /offline/* | FEATURE_ASSOCIATIONS_ENABLED | false | ASSOC_CARD_SIGNING_SECRET: log.Fatalf at route registration whenever APP_ENV != "development" (includes staging and "dev"/"test" spellings!). Dev with it unset = warning (public dev key). | [GATED] FATAL at boot unless ASSOC_CARD_SIGNING_SECRET set when APP_ENV != "development". Registry env_flag was seeded as FEATURE_ASSOCIATION_ENABLED (singular) until migration 20270320000000. |
| `/admin/association/members` | /api/finance/associations/admin/*, /offline/* | FEATURE_ASSOCIATIONS_ENABLED | false | ASSOC_CARD_SIGNING_SECRET: log.Fatalf at route registration whenever APP_ENV != "development" (includes staging and "dev"/"test" spellings!). Dev with it unset = warning (public dev key). | [GATED] FATAL at boot unless ASSOC_CARD_SIGNING_SECRET set when APP_ENV != "development". Registry env_flag was seeded as FEATURE_ASSOCIATION_ENABLED (singular) until migration 20270320000000. |
| `/admin/association/elections` | /api/finance/associations/admin/*, /offline/* | FEATURE_ASSOCIATIONS_ENABLED | false | ASSOC_CARD_SIGNING_SECRET: log.Fatalf at route registration whenever APP_ENV != "development" (includes staging and "dev"/"test" spellings!). Dev with it unset = warning (public dev key). | [GATED] FATAL at boot unless ASSOC_CARD_SIGNING_SECRET set when APP_ENV != "development". Registry env_flag was seeded as FEATURE_ASSOCIATION_ENABLED (singular) until migration 20270320000000. |
| `/admin/association/content/announcements` | /api/finance/associations/admin/*, /offline/* | FEATURE_ASSOCIATIONS_ENABLED | false | ASSOC_CARD_SIGNING_SECRET: log.Fatalf at route registration whenever APP_ENV != "development" (includes staging and "dev"/"test" spellings!). Dev with it unset = warning (public dev key). | [GATED] FATAL at boot unless ASSOC_CARD_SIGNING_SECRET set when APP_ENV != "development". Registry env_flag was seeded as FEATURE_ASSOCIATION_ENABLED (singular) until migration 20270320000000. |
| `/admin/association/content/meetings` | /api/finance/associations/admin/*, /offline/* | FEATURE_ASSOCIATIONS_ENABLED | false | ASSOC_CARD_SIGNING_SECRET: log.Fatalf at route registration whenever APP_ENV != "development" (includes staging and "dev"/"test" spellings!). Dev with it unset = warning (public dev key). | [GATED] FATAL at boot unless ASSOC_CARD_SIGNING_SECRET set when APP_ENV != "development". Registry env_flag was seeded as FEATURE_ASSOCIATION_ENABLED (singular) until migration 20270320000000. |
| `/admin/association/content/documents` | /api/finance/associations/admin/*, /offline/* | FEATURE_ASSOCIATIONS_ENABLED | false | ASSOC_CARD_SIGNING_SECRET: log.Fatalf at route registration whenever APP_ENV != "development" (includes staging and "dev"/"test" spellings!). Dev with it unset = warning (public dev key). | [GATED] FATAL at boot unless ASSOC_CARD_SIGNING_SECRET set when APP_ENV != "development". Registry env_flag was seeded as FEATURE_ASSOCIATION_ENABLED (singular) until migration 20270320000000. |
| `/admin/association/content/events` | /api/finance/associations/admin/*, /offline/* | FEATURE_ASSOCIATIONS_ENABLED | false | ASSOC_CARD_SIGNING_SECRET: log.Fatalf at route registration whenever APP_ENV != "development" (includes staging and "dev"/"test" spellings!). Dev with it unset = warning (public dev key). | [GATED] FATAL at boot unless ASSOC_CARD_SIGNING_SECRET set when APP_ENV != "development". Registry env_flag was seeded as FEATURE_ASSOCIATION_ENABLED (singular) until migration 20270320000000. |
| `/admin/association/content/tasks` | /api/finance/associations/admin/*, /offline/* | FEATURE_ASSOCIATIONS_ENABLED | false | ASSOC_CARD_SIGNING_SECRET: log.Fatalf at route registration whenever APP_ENV != "development" (includes staging and "dev"/"test" spellings!). Dev with it unset = warning (public dev key). | [GATED] FATAL at boot unless ASSOC_CARD_SIGNING_SECRET set when APP_ENV != "development". Registry env_flag was seeded as FEATURE_ASSOCIATION_ENABLED (singular) until migration 20270320000000. |
| `/admin/association/import` | /api/finance/associations/admin/*, /offline/* | FEATURE_ASSOCIATIONS_ENABLED | false | ASSOC_CARD_SIGNING_SECRET: log.Fatalf at route registration whenever APP_ENV != "development" (includes staging and "dev"/"test" spellings!). Dev with it unset = warning (public dev key). | [GATED] FATAL at boot unless ASSOC_CARD_SIGNING_SECRET set when APP_ENV != "development". Registry env_flag was seeded as FEATURE_ASSOCIATION_ENABLED (singular) until migration 20270320000000. |
| `/admin/association/audit` | /api/finance/associations/admin/*, /offline/* | FEATURE_ASSOCIATIONS_ENABLED | false | ASSOC_CARD_SIGNING_SECRET: log.Fatalf at route registration whenever APP_ENV != "development" (includes staging and "dev"/"test" spellings!). Dev with it unset = warning (public dev key). | [GATED] FATAL at boot unless ASSOC_CARD_SIGNING_SECRET set when APP_ENV != "development". Registry env_flag was seeded as FEATURE_ASSOCIATION_ENABLED (singular) until migration 20270320000000. |

### Stays Extranet

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/extranet/reservations` | /api/stays/extranet/* | FEATURE_STAYS_ENABLED | false | None | [GATED] RBAC stays.hotelier.*; object-scoped. |
| `/extranet/calendar` | /api/stays/extranet/* | FEATURE_STAYS_ENABLED | false | None | [GATED] RBAC stays.hotelier.*; object-scoped. |
| `/extranet/profile` | /api/stays/extranet/* | FEATURE_STAYS_ENABLED | false | None | [GATED] RBAC stays.hotelier.*; object-scoped. |
| `/extranet/promotions` | /api/stays/extranet/* | FEATURE_STAYS_ENABLED | false | None | [GATED] RBAC stays.hotelier.*; object-scoped. |
| `/extranet/payouts` | /api/stays/extranet/* | FEATURE_STAYS_ENABLED | false | None | [GATED] RBAC stays.hotelier.*; object-scoped. |
| `/extranet/analytics/performance` | /api/stays/extranet/* | FEATURE_STAYS_ENABLED | false | None | [GATED] RBAC stays.hotelier.*; object-scoped. |
| `/extranet/staff` | /api/stays/extranet/* | FEATURE_STAYS_ENABLED | false | None | [GATED] RBAC stays.hotelier.*; object-scoped. |
| `/extranet/onboarding/go-live` | /api/stays/extranet/* | FEATURE_STAYS_ENABLED | false | None | [GATED] RBAC stays.hotelier.*; object-scoped. |

### Marketplace

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/marketplace` | /v1/marketplace/admin/* (no /api prefix) + /v1/marketplace/listings/:id | FEATURE_MARKETPLACE_ENABLED | false | None | [GATED] Marketplace flags/boosts/audit-log leaf routes unverified. |
| `/admin/marketplace/moderation` | /v1/marketplace/admin/* (no /api prefix) + /v1/marketplace/listings/:id | FEATURE_MARKETPLACE_ENABLED | false | None | [GATED] Marketplace flags/boosts/audit-log leaf routes unverified. |
| `/admin/marketplace/flags` | /v1/marketplace/admin/* (no /api prefix) + /v1/marketplace/listings/:id | FEATURE_MARKETPLACE_ENABLED | false | None | [GATED] Marketplace flags/boosts/audit-log leaf routes unverified. |
| `/admin/marketplace/boosts` | /v1/marketplace/admin/* (no /api prefix) + /v1/marketplace/listings/:id | FEATURE_MARKETPLACE_ENABLED | false | None | [GATED] Marketplace flags/boosts/audit-log leaf routes unverified. |
| `/admin/marketplace/audit-log` | /v1/marketplace/admin/* (no /api prefix) + /v1/marketplace/listings/:id | FEATURE_MARKETPLACE_ENABLED | false | None | [GATED] Marketplace flags/boosts/audit-log leaf routes unverified. |

### Arena

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/arena/config` | /api/arena/admin/*, /api/arena/* | FEATURE_ARENA_ENABLED | false | APP_ENV=production\|prod: ABORTS unless >=1 of ARENA_SIGNING_SEED_THEORY\|PRACTICAL\|FIRSTAID is base64 of 32 bytes (ARENA_AWARD_SIGNING_SEED optional, same format). Other APP_ENV: warning only. | [GATED] See prerequisites: ARENA_SIGNING_SEED_*. |
| `/admin/arena/questions` | /api/arena/admin/*, /api/arena/* | FEATURE_ARENA_ENABLED | false | APP_ENV=production\|prod: ABORTS unless >=1 of ARENA_SIGNING_SEED_THEORY\|PRACTICAL\|FIRSTAID is base64 of 32 bytes (ARENA_AWARD_SIGNING_SEED optional, same format). Other APP_ENV: warning only. | [GATED] See prerequisites: ARENA_SIGNING_SEED_*. |
| `/admin/arena/screening` | /api/arena/admin/*, /api/arena/* | FEATURE_ARENA_ENABLED | false | APP_ENV=production\|prod: ABORTS unless >=1 of ARENA_SIGNING_SEED_THEORY\|PRACTICAL\|FIRSTAID is base64 of 32 bytes (ARENA_AWARD_SIGNING_SEED optional, same format). Other APP_ENV: warning only. | [GATED] See prerequisites: ARENA_SIGNING_SEED_*. |
| `/admin/arena/proctor` | /api/arena/admin/*, /api/arena/* | FEATURE_ARENA_ENABLED | false | APP_ENV=production\|prod: ABORTS unless >=1 of ARENA_SIGNING_SEED_THEORY\|PRACTICAL\|FIRSTAID is base64 of 32 bytes (ARENA_AWARD_SIGNING_SEED optional, same format). Other APP_ENV: warning only. | [GATED] See prerequisites: ARENA_SIGNING_SEED_*. |
| `/admin/arena/judge` | /api/arena/admin/*, /api/arena/* | FEATURE_ARENA_ENABLED | false | APP_ENV=production\|prod: ABORTS unless >=1 of ARENA_SIGNING_SEED_THEORY\|PRACTICAL\|FIRSTAID is base64 of 32 bytes (ARENA_AWARD_SIGNING_SEED optional, same format). Other APP_ENV: warning only. | [GATED] See prerequisites: ARENA_SIGNING_SEED_*. |
| `/admin/arena/lifecycle` | /api/arena/admin/*, /api/arena/* | FEATURE_ARENA_ENABLED | false | APP_ENV=production\|prod: ABORTS unless >=1 of ARENA_SIGNING_SEED_THEORY\|PRACTICAL\|FIRSTAID is base64 of 32 bytes (ARENA_AWARD_SIGNING_SEED optional, same format). Other APP_ENV: warning only. | [GATED] See prerequisites: ARENA_SIGNING_SEED_*. |
| `/admin/arena/merit` | /api/arena/admin/*, /api/arena/* | FEATURE_ARENA_ENABLED | false | APP_ENV=production\|prod: ABORTS unless >=1 of ARENA_SIGNING_SEED_THEORY\|PRACTICAL\|FIRSTAID is base64 of 32 bytes (ARENA_AWARD_SIGNING_SEED optional, same format). Other APP_ENV: warning only. | [GATED] See prerequisites: ARENA_SIGNING_SEED_*. |
| `/admin/arena/pot` | /api/arena/admin/*, /api/arena/* | FEATURE_ARENA_ENABLED | false | APP_ENV=production\|prod: ABORTS unless >=1 of ARENA_SIGNING_SEED_THEORY\|PRACTICAL\|FIRSTAID is base64 of 32 bytes (ARENA_AWARD_SIGNING_SEED optional, same format). Other APP_ENV: warning only. | [GATED] See prerequisites: ARENA_SIGNING_SEED_*. |
| `/admin/arena/sponsors` | /api/arena/admin/*, /api/arena/* | FEATURE_ARENA_ENABLED | false | APP_ENV=production\|prod: ABORTS unless >=1 of ARENA_SIGNING_SEED_THEORY\|PRACTICAL\|FIRSTAID is base64 of 32 bytes (ARENA_AWARD_SIGNING_SEED optional, same format). Other APP_ENV: warning only. | [GATED] See prerequisites: ARENA_SIGNING_SEED_*. |
| `/admin/arena/credentials` | /api/arena/admin/*, /api/arena/* | FEATURE_ARENA_ENABLED | false | APP_ENV=production\|prod: ABORTS unless >=1 of ARENA_SIGNING_SEED_THEORY\|PRACTICAL\|FIRSTAID is base64 of 32 bytes (ARENA_AWARD_SIGNING_SEED optional, same format). Other APP_ENV: warning only. | [GATED] See prerequisites: ARENA_SIGNING_SEED_*. |

### Business Registry

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/business` | /api/business/admin/* | FEATURE_BUSINESS_REGISTRY_ENABLED | false | CAC_VAS_BASE_URL + CAC_VAS_API_KEY + CAC_VAS_CONSUMER_SECRET optional (sandbox otherwise). | [GATED] CAC creds optional (sandbox fallback). |

### Platform · EdTech

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin/platform/edtech` | /api/academy/admin/platform/* | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_FEES_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] Also needs seeded platform_edtech_admin capability. |
| `/admin/platform/edtech/verification` | /api/academy/admin/platform/* | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_FEES_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] Also needs seeded platform_edtech_admin capability. |
| `/admin/platform/edtech/collections` | /api/academy/admin/platform/* | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_FEES_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] Also needs seeded platform_edtech_admin capability. |
| `/admin/platform/edtech/fraud` | /api/academy/admin/platform/* | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_FEES_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] Also needs seeded platform_edtech_admin capability. |
| `/admin/platform/edtech/gov-sync` | /api/academy/admin/platform/* | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_FEES_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] Also needs seeded platform_edtech_admin capability. |
| `/admin/platform/edtech/competitions` | /api/academy/admin/platform/* | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_FEES_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] Also needs seeded platform_edtech_admin capability. |
| `/admin/platform/edtech/trust-scores` | /api/academy/admin/platform/* | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_FEES_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] Also needs seeded platform_edtech_admin capability. |
| `/admin/platform/edtech/scholarships` | /api/academy/admin/platform/* | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_FEES_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] Also needs seeded platform_edtech_admin capability. |
| `/admin/platform/edtech/support` | /api/academy/admin/platform/* | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_FEES_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] Also needs seeded platform_edtech_admin capability. |
| `/admin/platform/edtech/flags` | /api/academy/admin/platform/* | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_FEES_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] Also needs seeded platform_edtech_admin capability. |
| `/admin/platform/edtech/audit-log` | /api/academy/admin/platform/* | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_FEES_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] Also needs seeded platform_edtech_admin capability. |
| `/admin/platform/edtech/compliance` | /api/academy/admin/platform/* | FEATURE_ACADEMY_ENABLED + FEATURE_ACADEMY_FEES_ENABLED | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. | [GATED] Also needs seeded platform_edtech_admin capability. |

## Ungated (always on)

Registered regardless of any `FEATURE_*` flag (still need DB pool for the `sharedPool != nil` block, `ADMIN_API_KEY`, and the stated RBAC/role). If one of these 404s, the cause is the pool, the proxy base URL, or route drift, not a flag.

| Admin page | Backend route(s) | Gate flag | Default | Startup prerequisites when enabled | Notes |
|---|---|---|---|---|---|
| `/admin` | GET /api/v1/admin/menu-counts, /api/v1/admin/overview | - | - | None | Needs x-admin-api-key (ADMIN_API_KEY) + admin console role. |
| `/admin/analytics` | GET /api/v1/admin/analytics/summary | - | - | None |  |
| `/admin/finance/transactions` | GET /api/finance/admin/transactions[/:id] (finance.admin.transactions.view) | - | - | None | Registered whenever the DB pool exists. |
| `/admin/competitions` | GET /api/v1/admin/competitions/overview, /open-mic | - | - | None | Overview + open-mic only. |
| `/admin/chatbot` | GET /api/v1/admin/chatbot/sessions[/:id] | - | - | None |  |
| `/admin/leads` | GET/PATCH /api/v1/admin/leads[/:id] | - | - | None |  |
| `/admin/handoffs` | GET/PATCH /api/v1/admin/handoffs[/:id] | - | - | None |  |
| `/admin/users` | GET /api/admin/users[/:id\|/export] | - | - | None | RBAC users.view. |
| `/admin/roles` | GET/POST/PATCH /api/admin/roles | - | - | None | RBAC roles.* |
| `/admin/rbac-settings` | GET /api/admin/roles\|permissions | - | - | None | RBAC. |
| `/admin/permissions-matrix` | GET /api/admin/permissions/matrix | - | - | None |  |
| `/admin/permissions` | GET /api/admin/permissions | - | - | None |  |
| `/admin/audit-logs` | GET /api/admin/audit-logs[/export] | - | - | None |  |
| `/admin/login-activity` | GET /api/admin/login-activity | - | - | None |  |
| `/admin/security-events` | GET /api/admin/security-events | - | - | None |  |
| `/admin/reality-tv/dashboard` | GET /api/v1/admin/reality-tv/dashboard | - | - | None |  |
| `/admin/stem/overview` | GET/POST /api/v1/admin/stem*, /stem-* (stemRead/stemManage) | - | - | None | Needs verified identity + STEM role (RequireStemRoles), no env flag. |
| `/admin/stem/contests` | GET/POST /api/v1/admin/stem*, /stem-* (stemRead/stemManage) | - | - | None | Needs verified identity + STEM role (RequireStemRoles), no env flag. |
| `/admin/stem/leaderboard` | GET/POST /api/v1/admin/stem*, /stem-* (stemRead/stemManage) | - | - | None | Needs verified identity + STEM role (RequireStemRoles), no env flag. |
| `/admin/stem/voting` | GET/POST /api/v1/admin/stem*, /stem-* (stemRead/stemManage) | - | - | None | Needs verified identity + STEM role (RequireStemRoles), no env flag. |
| `/admin/stem/bootcamp` | GET/POST /api/v1/admin/stem*, /stem-* (stemRead/stemManage) | - | - | None | Needs verified identity + STEM role (RequireStemRoles), no env flag. |
| `/admin/stem/reports` | GET/POST /api/v1/admin/stem*, /stem-* (stemRead/stemManage) | - | - | None | Needs verified identity + STEM role (RequireStemRoles), no env flag. |
| `/admin/stem/sponsors-awards` | GET/POST /api/v1/admin/stem*, /stem-* (stemRead/stemManage) | - | - | None | Needs verified identity + STEM role (RequireStemRoles), no env flag. |
| `/admin/stem/submissions` | GET/POST /api/v1/admin/stem*, /stem-* (stemRead/stemManage) | - | - | None | Needs verified identity + STEM role (RequireStemRoles), no env flag. |
| `/admin/stem/judging` | GET/POST /api/v1/admin/stem*, /stem-* (stemRead/stemManage) | - | - | None | Needs verified identity + STEM role (RequireStemRoles), no env flag. |
| `/admin/stem/rubrics` | GET/POST /api/v1/admin/stem*, /stem-* (stemRead/stemManage) | - | - | None | Needs verified identity + STEM role (RequireStemRoles), no env flag. |
| `/admin/schools` | GET /api/v1/admin/schools | - | - | None | STEM role gated, no env flag. |
| `/admin/school-profiles` | GET /api/v1/admin/school-profiles | - | - | None | STEM role gated, no env flag. |
| `/admin/school-teams` | GET /api/v1/admin/school-teams | - | - | None | STEM role gated, no env flag. |
| `/admin/emerging-innovators` | GET /api/v1/admin/emerging-innovators | - | - | None | STEM role gated, no env flag. |
| `/admin/emerging-teams` | GET /api/v1/admin/emerging-teams | - | - | None | STEM role gated, no env flag. |
| `/admin/emerging-projects` | GET /api/v1/admin/emerging-projects | - | - | None | STEM role gated, no env flag. |
| `/admin/finance/transfers` | GET /api/finance/admin/transfers[/:id\|/provider-health]; POST retry\|reverse | - | - | None | Routes always mounted; the underlying transfer families are gated per request by FEATURE_WALLET_TRANSFERS_ENABLED / FEATURE_BANK_TRANSFERS_ENABLED (handler 503), so list works even when off. |
| `/admin/modules` | GET /api/v1/admin/modules[/:key/history\|grants] (platform.modules.read) | - | - | None | Registry env_flag kill switch (os.Getenv=="true") and FEATURE_MODULE_GATE_ENFORCE do not gate this page. |
| `/admin/modules/grants` | GET /api/v1/admin/modules[/:key/history\|grants] (platform.modules.read) | - | - | None | Registry env_flag kill switch (os.Getenv=="true") and FEATURE_MODULE_GATE_ENFORCE do not gate this page. |

## Flag reference (defaults and startup prerequisites)

All flags are read in `backend/internal/config/config.go` via `getEnvBool("<NAME>", false)` (accepts `true|1|yes` / `false|0|no`, anything else = default). Every flag below defaults to **false**. (`FEATURE_TIER_LIMITS_ENABLED` is the only default-true flag and is not an admin-page gate.) `Config.Validate()` only returns an error (abort) when `APP_ENV` is `production` or `prod`; elsewhere it logs warnings. The route-registration `log.Fatalf` cases are listed separately.

| Flag | Pages unlocked | Default | Startup prerequisites / crash risk |
|---|---|---|---|
| `FEATURE_KYC_VERIFY_ENABLED` | Finance > KYC Verify | false | APP_ENV=production\|prod: ABORTS unless a provider is set (DOJAH_SECRET_KEY, or SMILEID_PARTNER_ID+SMILEID_API_KEY, or YOUVERIFY_TOKEN) AND KYC_PII_ENC_KEY = base64 of exactly 32 bytes. Other APP_ENV: warning only (boots with empty registry / nil cipher). |
| `FEATURE_WALLET_ENABLED` | Wallets | false | PAYSTACK_SECRET_KEY (must start sk_). Prod abort if missing/placeholder; non-prod warning. (Same for FEATURE_BANK_TRANSFERS_ENABLED, which also needs MONNIFY_SECRET_KEY.) |
| `FEATURE_DISPUTES_ENABLED` | Disputes | false | None |
| `FEATURE_ONBOARDING_ENABLED` | Merchant onboarding | false | None |
| `FEATURE_PLACEMENT_ENABLED` | Featured placement | false | None |
| `FEATURE_NUTRITION_ENABLED` | Nutrition | false | None |
| `FEATURE_COMMISSION_ENABLED` | Commission | false | None. |
| `FEATURE_CROWDFUNDING_ENABLED` | Crowdfunding | false | None |
| `FEATURE_CONNECT_ENABLED` | Connect | false | None |
| `FEATURE_CONTEST_STAGE_EVICTION_ENABLED` | Competitions eviction ops | false | None |
| `FEATURE_REFERRALS_ENABLED` | Referral | false | None |
| `FEATURE_REFERRAL_REWARDS_ENABLED` | Referral Rewards (path mismatch) | false | REFERRAL_REWARDS_INTERNAL_SECRET empty => /internal hooks fail closed (no crash). |
| `FEATURE_INSURANCE_ENABLED` | Insurance | false | None |
| `FEATURE_STAYS_ENABLED` | Stays + Extranet | false | None |
| `FEATURE_SAVINGS_ENABLED` | Savings | false | None |
| `FEATURE_SOCIAL_PAY_ENABLED` | Social Pay | false | None |
| `FEATURE_P2P_MARKET_ENABLED` | P2P market, Spray, Social Escrow | false | None |
| `FEATURE_EVENTS_ENABLED` | Events | false | None |
| `FEATURE_LOYALTY_ENABLED` | Loyalty, Points, Paymax Black | false | None |
| `FEATURE_CREATORS_ENABLED` | Creators | false | None |
| `FEATURE_HEALTH_ENABLED` | Health parent (all health verticals + intake + triage) | false | None |
| `FEATURE_HEALTH_PHARMACY_ENABLED` | Pharmacy | false | None |
| `FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED` | Symptom mappings | false | None |
| `FEATURE_HEALTH_LAB_ENABLED` | Lab | false | None |
| `FEATURE_HEALTH_VET_ENABLED` | Vet | false | None |
| `FEATURE_HEALTH_INTAKE_ENABLED` | Intake | false | None |
| `FEATURE_HEALTH_TRIAGE_ENABLED` | Triage | false | None |
| `FEATURE_DOCTOR_ENABLED` | Doctor verification | false | None |
| `FEATURE_TELEMEDICINE_ENABLED` | Telemedicine | false | None |
| `FEATURE_INVEST_ENABLED` | Invest | false | None to boot; Redis used by workers (Redlock) - connection failure is non-fatal. Keep FEATURE_INVEST_PIN_DEV_BYPASS off. |
| `FEATURE_CRYPTO_ENABLED` | Crypto | false | CRYPTO_PROVIDER (default "mock"); Quidax TEST/LIVE keys optional. |
| `FEATURE_ESTATE_ENABLED` | Estate + Vendors | false | None |
| `FEATURE_PROPERTY_SUITE_ENABLED` | Property | false | None |
| `FEATURE_REALTOR_ENABLED` | Realtor | false | None |
| `FEATURE_TRANSPORT_ENABLED` | Mobility core | false | APP_ENV=production\|prod: log.Fatalf unless MapService wired (FEATURE_MAPS_ENABLED=true + working MAPS_PROVIDER config). Non-prod: warning, uses MockMaps (fabricated fares). |
| `FEATURE_TRANSPORT_MODES_ENABLED` | Mobility modes | false | None |
| `FEATURE_TRANSPORT_SCHEDULING_ENABLED` | Mobility scheduled | false | None |
| `FEATURE_RESTAURANT_ENABLED` | Restaurant | false | None |
| `FEATURE_MAPS_ENABLED` | Maps (needs V2 too) | false | MAPS_GOOGLE_KEY: prod abort if missing; else warning (address lookup falls back to mock). MAPS_PROVIDER default "mock". |
| `FEATURE_MAPS_V2_ENABLED` | Maps admin | false | None |
| `FEATURE_FRACTIONAL_RE_ENABLED` | Fractional RE | false | None |
| `FEATURE_ACADEMY_ENABLED` | Academy parent | false | None to boot. RAILS_MODE (default "fake") selects rail adapters; live modes need rail creds. Runtime store academy_feature_flags can override sub-flags. |
| `FEATURE_ACADEMY_SPINE_ENABLED` | Academy content | false | None |
| `FEATURE_ACADEMY_EXAM_ENABLED` | Academy exams | false | None |
| `FEATURE_ACADEMY_EDUPAY_ENABLED` | Academy EduPay | false | None |
| `FEATURE_ACADEMY_CREDENTIALS_ENABLED` | Academy credentials | false | None |
| `FEATURE_ACADEMY_LIVE_ENABLED` | Academy live/moderation | false | None |
| `FEATURE_ACADEMY_SCHOOLS_ENABLED` | Academy schools | false | None |
| `FEATURE_ACADEMY_TUTOR_ENABLED` | Academy tutors | false | None |
| `FEATURE_ACADEMY_FEES_ENABLED` | Academy fees + Platform EdTech | false | None |
| `FEATURE_LEARN_ENABLED` | Learn | false | None |
| `FEATURE_SPOTLIGHTWEALTH_ENABLED` | Spotlight wealth | false | None |
| `FEATURE_ASSOCIATIONS_ENABLED` | Association | false | ASSOC_CARD_SIGNING_SECRET: log.Fatalf at route registration whenever APP_ENV != "development" (includes staging and "dev"/"test" spellings!). Dev with it unset = warning (public dev key). |
| `FEATURE_MARKETPLACE_ENABLED` | Marketplace | false | None |
| `FEATURE_ARENA_ENABLED` | Arena | false | APP_ENV=production\|prod: ABORTS unless >=1 of ARENA_SIGNING_SEED_THEORY\|PRACTICAL\|FIRSTAID is base64 of 32 bytes (ARENA_AWARD_SIGNING_SEED optional, same format). Other APP_ENV: warning only. |
| `FEATURE_BUSINESS_REGISTRY_ENABLED` | Business registry | false | CAC_VAS_BASE_URL + CAC_VAS_API_KEY + CAC_VAS_CONSUMER_SECRET optional (sandbox otherwise). |

### Crash-on-missing-prerequisite summary

- `FEATURE_ASSOCIATIONS_ENABLED`: `log.Fatalf` (finance_routes.go ~L1080) without `ASSOC_CARD_SIGNING_SECRET` whenever `APP_ENV != "development"`. This is the highest risk because it also fires on staging/dev-named tiers.
- `FEATURE_KYC_VERIFY_ENABLED`: abort only when `APP_ENV` is `production`/`prod` (config.go validate). On the development backend a missing provider/key merely warns, but KYC then has no providers and the PII cipher fails closed.
- `FEATURE_ARENA_ENABLED`: abort in production without a valid `ARENA_SIGNING_SEED_*`.
- `FEATURE_TRANSPORT_ENABLED` (also FEATURE_TRANSPORT_MODES/SCHEDULING): `log.Fatalf` in production without a MapService (enable `FEATURE_MAPS_ENABLED` + real `MAPS_PROVIDER`).
- `FEATURE_WALLET_ENABLED` / `FEATURE_BANK_TRANSFERS_ENABLED`: production abort without `PAYSTACK_SECRET_KEY` (`sk_` prefix) and, for bank transfers, `MONNIFY_SECRET_KEY`.
- `FEATURE_MAPS_ENABLED`: production abort without `MAPS_GOOGLE_KEY`.
- Independent of flags: staging/production abort if `DATABASE_URL` missing or the pool cannot connect; `AUTH_JWT_LOCAL_VERIFY=true` needs `SUPABASE_URL` or `SUPABASE_JWT_SECRET`; any non-placeholder `PAYSTACK_SECRET_KEY` not starting `sk_` aborts in prod.

## Safe order to enable

Tier A - no prerequisites beyond DATABASE_URL (nothing validated at boot, no Fatalf):

1. `FEATURE_COMMISSION_ENABLED` (commission page; also activates earning rows elsewhere - enable first or accept missing history)
2. `FEATURE_DISPUTES_ENABLED`, `FEATURE_ONBOARDING_ENABLED`, `FEATURE_PLACEMENT_ENABLED`, `FEATURE_NUTRITION_ENABLED`
3. `FEATURE_CROWDFUNDING_ENABLED`, `FEATURE_EVENTS_ENABLED`, `FEATURE_SAVINGS_ENABLED`, `FEATURE_SOCIAL_PAY_ENABLED`, `FEATURE_P2P_MARKET_ENABLED`, `FEATURE_LOYALTY_ENABLED`, `FEATURE_CREATORS_ENABLED`, `FEATURE_INSURANCE_ENABLED`, `FEATURE_STAYS_ENABLED`, `FEATURE_REFERRALS_ENABLED`
4. `FEATURE_ESTATE_ENABLED`, `FEATURE_PROPERTY_SUITE_ENABLED`, `FEATURE_REALTOR_ENABLED`, `FEATURE_FRACTIONAL_RE_ENABLED`, `FEATURE_RESTAURANT_ENABLED`, `FEATURE_TELEMEDICINE_ENABLED`, `FEATURE_DOCTOR_ENABLED`, `FEATURE_INVEST_ENABLED`, `FEATURE_CRYPTO_ENABLED` (mock providers), `FEATURE_BUSINESS_REGISTRY_ENABLED`, `FEATURE_LEARN_ENABLED`, `FEATURE_SPOTLIGHTWEALTH_ENABLED`, `FEATURE_MARKETPLACE_ENABLED`
5. Health: `FEATURE_HEALTH_ENABLED` first, then `_PHARMACY`, `_LAB`, `_VET`, `_INTAKE`, `_TRIAGE`, then `FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED`
6. Academy: `FEATURE_ACADEMY_ENABLED` first, then `_SPINE`, `_EXAM`, `_EDUPAY`, `_CREDENTIALS`, `_LIVE`, `_SCHOOLS`, `_TUTOR`, `_FEES`
7. Connect: `FEATURE_CONNECT_ENABLED` (+ `FEATURE_CONTEST_STAGE_EVICTION_ENABLED` for eviction ops). Keep `FEATURE_CONNECT_WALLET_FUND_ENABLED` OFF (mints money, see config comment E2E-SEC-052).
8. `FEATURE_WALLET_ENABLED` only if `PAYSTACK_SECRET_KEY` (sk_) is already set (dev warns, prod aborts); `FEATURE_REFERRAL_REWARDS_ENABLED` only after the path mismatch is fixed.

Tier B - need a secret/config first (verify the var is set BEFORE flipping):

9. `FEATURE_MAPS_ENABLED` + `FEATURE_MAPS_V2_ENABLED` (set `MAPS_GOOGLE_KEY` / provider) -> then `FEATURE_TRANSPORT_ENABLED`, `_TRANSPORT_MODES_ENABLED`, `_TRANSPORT_SCHEDULING_ENABLED`
10. `FEATURE_ARENA_ENABLED` (generate `ARENA_SIGNING_SEED_*`: `openssl rand -base64 32`)
11. `FEATURE_KYC_VERIFY_ENABLED` (provider creds + `KYC_PII_ENC_KEY`: `openssl rand -base64 32`)
12. `FEATURE_ASSOCIATIONS_ENABLED` last: needs `ASSOC_CARD_SIGNING_SECRET` set first on any tier that is not literally `APP_ENV=development`, otherwise the process dies on boot.

## Defects found (not flag problems)

- **Referral Rewards**: Go mounts `/v1/admin/referrals` (router group `r.Group("/v1/admin/referrals")`, referral_routes.go L200) but `referralRewardsAdminService.ts` calls `/api/v1/admin/referrals`. No rewrite exists, so the 7 `/admin/referral-rewards/*` pages 404 even with the flag on. Same for member `/v1/referrals` vs `/api/...` callers.
- **FX console**: only `/api/finance/admin/fx/markup` exists. `/overview`, `/transactions`, `/routing`, `/providers`, `/treasury`, `/spread`, `/recon`, `/customers`, `/compliance`, `/webhooks`, `/analytics` etc. are not registered; `FEATURE_FX_ORCHESTRATION_ENABLED` only adds member `/api/v1/fx/*` routes.
- **Groups console**: `/api/finance/groups/admin/dashboard` is not registered; `FEATURE_GROUPS_ENABLED` mounts only member routes.
- Pages not in the sidebar but present in `app/admin`: `trading` (needs `FEATURE_TRADING_ENABLED`, `/api/v1/admin/trading`; `FEATURE_AI_TRADING_ENABLED` for ladder routes).

## Go env name vs Next env name

| Concern | Go reads | Next admin reads |
|---|---|---|
| Module on/off | `FEATURE_<MODULE>_ENABLED` (runtime) | none; `NEXT_PUBLIC_<X>_USE_MOCK` (build-time) toggles fixtures vs live |
| Admin key | `ADMIN_API_KEY` | `ADMIN_API_KEY` (server-side proxy only; same value) |
| Backend URL | n/a | `ADMIN_API_BASE_URL` (default http://localhost:8080) |
| Registry kill switch | `platform_modules.env_flag` -> `os.Getenv(...)=="true"` | n/a |
| Connect flag | `FEATURE_CONNECT_ENABLED` (+ `envPresent` check: when UNSET the legacy wallet/KYC mounts stay on, when set false they unmount) | `NEXT_PUBLIC_CONNECT_USE_MOCK`, `NEXT_PUBLIC_CONNECT_ADMIN_USE_MOCK` |
| Name differences to watch | `FEATURE_ASSOCIATIONS_ENABLED` (plural) vs docs/registry seed `FEATURE_ASSOCIATION_ENABLED`; `FEATURE_KYC_VERIFY_ENABLED` vs seed `FEATURE_KYC_ENABLED`; `FEATURE_UTILITY_BILLS_ENABLED` vs seed `FEATURE_UTILITY_PAYMENTS_ENABLED`; `FEATURE_AICARE_ENABLED` | - |

Next-side mock flags by service (module): ACADEMY, ARENA_ADMIN, ASSOCIATION_ADMIN, BUSINESS, COMMISSION, CONNECT, CONNECT_ADMIN, CREATORS, CF, CRYPTO_ADMIN, DELIVERY_FEE_ADMIN, SOCIAL (escrow+social), ESTATE_ADMIN, EVENTS, FEATURED_PLACEMENT_ADMIN, FRACTIONALRE_ADMIN, FX_ADMIN, GROUPS_ADMIN, HEALTH (all health services), INTAKE_ADMIN, INVEST_ADMIN, KYC_ADMIN, LOYALTY (incl. black), MAPS, MARKETPLACE_ADMIN, MOBILITY_ADMIN, MOBILITY_MODES, NUTRITION_ADMIN, ONBOARDING_ADMIN, P2PMARKET_ADMIN, EDTECH_PLATFORM, POINTS_ADMIN, PROPERTY_ADMIN, REALTOR_ADMIN, REFERRAL, REFERRAL_REWARDS, RESTAURANT_ADMIN, SAVINGS, SCHEDULED_ADMIN, SPRAY_ADMIN, STAYS (incl. extranet), TELEMEDICINE_ADMIN, TRADING_ADMIN, TRANSFERS_ADMIN, VENDORS_ADMIN - each as `NEXT_PUBLIC_<NAME>_USE_MOCK`. Set to `false` explicitly in a dev build, or the page renders fixtures and the 404 is never seen.
