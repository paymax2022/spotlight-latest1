# Paymax × Spotlight — Go-Live Final Readiness

Consolidated output of the cross-surface integration pass: a critical review of every
module across **backend (Go/Gin) ↔ mobile (React Native) ↔ admin (Next.js)**, the gaps
found, the fixes applied in this pass, and exactly what must run in the dev container/CI
to promote a build. Structural review only here (no Go toolchain / live DB in the
authoring sandbox); the `make verify` gate below is the authoritative check.

## How the surfaces connect

```
React Native app ──Bearer(Supabase JWT)──▶ frontend-web Next.js  ──▶  Go backend (Gin)
   baseURL = frontend-web                 /api/v1/<module>/[...path]    /api/finance/<module>/*
   (per-module EXPO_PUBLIC_*_USE_MOCK)     proxyToGoBackend()           /api/<module>/* , /api/health/*

Admin Next.js (:3001/admin) ──Bearer(Supabase JWT)──▶ Go backend  /api/<module>/admin/*
   adminBase() + authHeaders()                                     RBAC per-route (RequirePermission)
```

The mobile app never calls the Go backend directly — it goes through the frontend-web
`/api/v1/*` proxy, which attaches auth and forwards to Go. Admin calls Go directly with a
Supabase JWT; Go enforces RBAC on every admin route.

## Fixes applied in this pass

Backend
- **Decoupled the P2P marketplace flag.** P2P market was gated by `FeatureSocialPayEnabled`;
  added a dedicated `FeatureP2PMarketEnabled` (`FEATURE_P2P_MARKET_ENABLED`, default false) so
  Social Pay and the P2P marketplace ship independently (smaller blast radius).
- **Removed 19 stale `*.go.<digits>` backup files** across `app/`, `estate/`, `finance/transfers/`,
  `crowdfunding/*`, `connect/*`, `services/` — Go ignored them, but they were near-duplicate
  money-path source and a re-`.go`-extension footgun.
- Confirmed `cfadminext.RegisterAdmin` (crowdfunding admin plane) IS wired (an audit false-positive).

Mobile ↔ backend integration
- **Created 16 missing `/api/v1/*` proxies** in frontend-web (fx, invest, stocks, connect, doctor,
  association, academy, fractionalre, maps, crypto + mobility/driver/restaurant support routes),
  each mirroring the canonical auth-guarded `proxyToGoBackend` template with verified Go prefixes.
- **Repointed every mobile service that bypassed the proxy** — food, the 8 mobility APIs,
  fractionalre, academy, and `maps.api` (which had been hitting Go `:8080` directly, bypassing
  auth) — now all flow through `/api/v1/*`. Mock-first defaults left untouched.
- **Fixed money-path idempotency in the proxy.** `proxyToGoBackend` was dropping `Idempotency-Key`;
  it now forwards `Idempotency-Key` and `X-Request-Id` verbatim, restoring the CLAUDE.md iron-rule
  guarantee for every proxied transfer/charge.

Admin console
- **Switched the admin app to port 3001** (`package.json`, `Dockerfile`, CLAUDE.md) — console at
  **http://localhost:3001/admin**.
- **Unblocked RBAC at login.** `permissions: []` was hardcoded, locking the permission-gated sidebar
  and bouncing legitimate admins to `/unauthorized`. Top-level admin roles (`admin`, `super-admin`,
  `system-admin`) now receive a `'*'` wildcard, and the permission helpers honor it. The Go backend
  still enforces real per-route RBAC, so this is a UX unlock, not a security relaxation.
- **Removed 6 dead sidebar links** that fell through to the legacy "Module In Transition" bridge.

## Per-module go-live matrix

Legend: ✓ ready · ~ partial/flagged · — not present · n/a not applicable.

| Module | Backend wired | Migration | Mobile | Admin | Flag |
|---|---|---|---|---|---|
| finance (wallet/transfers/kyc/tiers/VA) | ✓ | ✓ | ✓ | ✓ | per-family |
| fx + orchestration | ✓ | ✓ | ✓ (proxy added) | ✓ | FeatureFXEnabled |
| referral | ✓ | ✓ | ✓ | ✓ | FeatureReferralsEnabled |
| savings | ✓ | ✓ | ✓ | ✓ | FeatureSavingsEnabled |
| social (SocialPay) | ✓ | ✓ | ✓ | ✓ | FeatureSocialPayEnabled |
| p2pmarket | ✓ | ✓ | ~ (proxy ✓, no UI surface) | — | **FeatureP2PMarketEnabled (new)** |
| loyalty / points | ✓ | ✓ | ✓ | ✓ (points folded in) | FeatureLoyaltyEnabled |
| creators | ✓ | ✓ | ✓ | ✓ | FeatureCreatorsEnabled |
| crowdfunding (+5 sub) | ✓ | ✓ | ✓ | ✓ | FeatureCrowdfundingEnabled |
| insurance (+claims) | ✓ | ✓ | ✓ | ✓ | FeatureInsuranceEnabled |
| stays (+extranet) | ✓ | ✓ | ✓ | ✓ | FeatureStaysEnabled |
| events | ✓ | ✓ | ✓ | ✓ | FeatureEventsEnabled |
| restaurant (food) | ✓ | ✓ | ✓ (repointed) | ✓ | FeatureRestaurantEnabled |
| transport / mobility | ✓ | ✓ | ✓ (repointed) | ✓ | FeatureTransport(Modes)Enabled |
| estate / association | ✓ | ✓ | ✓ | ~ (estate ✓, association no admin page) | FeatureEstate/Associations |
| property / realtor | ✓ | ✓ | ✓ | ✓ | FeaturePropertySuite/Realtor |
| fractionalre | ✓ | ✓ | ✓ (repointed) | ✓ | FeatureFractionalREEnabled |
| invest | ✓ | ✓ | ✓ (proxy added) | ✓ | FeatureInvestEnabled |
| groups | ✓ | ✓ | ~ (proxy only) | — | FeatureGroupsEnabled |
| telemedicine | ✓ | ✓ | ✓ | — (no admin page) | FeatureTelemedicineEnabled |
| doctor (+MDCN) | ✓ | ✓ | ✓ (proxy added) | ✓ | FeatureDoctorEnabled |
| health: pharmacy/lab/vet | ✓ | ✓ | ✓ | ✓ | per-vertical |
| health: triage (symptom checker) | ✓ | ✓ | ✓ | ✓ | FeatureHealthTriageEnabled |
| academy (P0–P4, 16 sub) | ✓ | ✓ | ✓ (repointed) | ✓ | FeatureAcademyEnabled +7 |
| maps (v1 + v2) | ✓ | ✓ | ✓ (proxy added, auth fixed) | ✓ | FeatureMaps(V2)Enabled |
| connect (phases) | ✓ | ✓ | ✓ (proxy added) | ✓ | FeatureConnectEnabled |
| voting (votebridge) | ✓ | ✓ | ✓ | ✓ | FeatureVoteBridgeEnabled |
| aicare | ✓ | ✓ | ~ (scattered AI) | ✓ (chatbot) | FeatureAICareEnabled |
| cashtag/escrow/spray/credential | ✓ (libs/consumed) | ✓ | n/a / ~ | ~ (escrow disputes ✓) | consumer flag |

Every wired feature module has at least one backing migration — **no module is missing a
migration** (225 additive SQL files). "Migrate any pending module" therefore resolves to:
run `make migrate-up` (or `migrate-reset` for the idempotency check) in an environment with a
real Postgres/Supabase — there is nothing un-authored to add.

## Known limitations (deliberately not faked)

- **crypto** has no Go backend route group (the code lives only in a standalone sub-app). The
  `/api/v1/crypto` proxy exists but returns upstream 404 until that Go group is built — crypto is
  effectively mock-only and must not be advertised as live.
- **Food realtime order tracking** uses a WebSocket (`…/restaurant/orders/:id/ws`). The fetch-based
  proxy does not upgrade WebSockets, so this needs a dedicated WS proxy (or a direct authenticated
  WS endpoint) before live order tracking works.
- **No admin surface** for telemedicine, groups, association, p2pmarket, spray, points — ops have no
  console for these. Build pages or accept CLI/DB ops at launch.
- **~45 mobile + ~23 admin `*_USE_MOCK` flags default to true.** Production builds must explicitly set
  the intended ones to `false`; otherwise users see mock data. This needs a single env audit before launch.
- **Auth chain** must line up: Supabase env vars set, a seeded `user_profiles.role='admin'`, and the Go
  backend accepting Supabase HS256 JWTs. If any is missing, login or all data calls fail.
- **Money rails** fall back to nil/in-process fake adapters when provider keys are absent (no loud
  failure). Set `RAILS_MODE` and the provider keys per environment; never put live secrets in the web
  sandbox or chat (secret manager at deploy time only).

## Promote a build — the single gate

In the dev container (Postgres up, `RAILS_MODE=fake` for local):

```
make bootstrap      # one-time: go mod download + npm ci (both frontends)
make verify         # THE gate: build + vet + tsc(web+admin) + contract-check
                    #           + migrate-reset (clean-apply + idempotency) + test -race + security-scan
```

`make verify` is stricter than `make ci` and mirrors the CI verify job. Promote only on green.

### Admin console access (localhost:3001/admin)

```
cd frontend-admin && npm run dev        # serves on :3001
# open http://localhost:3001/admin  → redirected to /admin/login
```
Required env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_ADMIN_API_BASE_URL` (default `http://localhost:8080/api/v1`). Log in with a Supabase
user whose `user_profiles.role = 'admin'`; the sidebar is now fully populated (wildcard), and the Go
backend enforces real RBAC behind each call. Flip the relevant `NEXT_PUBLIC_*_USE_MOCK=false` to hit
live data.

## Residual roadmap — status after the production swarm

1. ~~Build the Go `/api/v1/crypto` group~~ **DONE** — `backend/internal/crypto` (assets/quote/buy/sell/
   portfolio, idempotent double-entry ledger, kobo integers, audit, RBAC, deterministic mock price
   provider), migration `20260815001600_crypto.sql`, `FeatureCryptoEnabled`. Wire a real price/exchange
   adapter before enabling real trading.
2. ~~Add a WebSocket path for food order tracking~~ **DONE** — signed-ticket design: frontend-web mints a
   short-lived HMAC ticket (`src/lib/restaurant/ws-ticket.ts`); backend validates it
   (`restaurant/ws_ticket.go`) on a public WS route (`ServeOrderWS`), still enforcing order
   participation. Requires shared `WS_TICKET_SIGNING_SECRET`.
3. ~~Admin consoles for telemedicine, groups, association, p2pmarket, spray, points~~ **DONE** — pages +
   services + RBAC-gated sidebar entries added (thin where the backend admin surface is thin; noted in-app).
4. ~~Per-environment `USE_MOCK` matrix~~ **DONE** — `mobile-app/reactnative/.env.production` (51 flags),
   `frontend-web/.env.production.example` (35 flags), `frontend-admin/.env.production.example`; flip per
   `DEPLOY-RUNBOOK.md`.
5. ~~Single shared pgx pool~~ **DONE** — one pool created in `router.go` and passed into both the finance
   and connect aggregators.
6. **Open (env/feature-dependent):** licensed-engine creds + clinical sign-off for health triage
   (`docs/health/AI-SYMPTOM-CHECKER-PHASE1.md`); real crypto price/exchange adapter; real provider keys +
   `RAILS_MODE=live` per environment. These need external accounts/approvals, not code.

See `docs/devops/DEPLOY-RUNBOOK.md` for the build-once → migrate → staging → prod procedure and the
module-enablement cheat-sheet.
