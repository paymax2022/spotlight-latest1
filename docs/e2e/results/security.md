# SECURITY/AUTHZ audit — production E2E probe results

Date: 2026-10-03. Stack exercised live: Go api :8080 (`spotlight-latest1-api-1`,
`APP_ENV=development`, `ADMIN_API_KEY` **set**, `TRUSTED_PROXY_CIDRS=none`,
`CORS_ALLOW_ORIGINS` = localhost list), web :3000 (BFF), admin :3001, GoTrue via
Kong :54321, Postgres `supabase_db_spotlight` :54322.

Method: read-only code inspection + live probes. Two disposable verified users
(`sec-a-*`, `sec-b-*` via `provisionVerifiedUser`-equivalent flow) as attacker
accounts, plus the `qa-claude-test`/`admin` fixtures read-only. Fixture-only DB
writes: wallet funding journal for user A, temporary `kyc_tier` bump on
disposable user A (restored), `platform_users.status` toggles on disposable A
(restored). All fabricated ledger balances were reversed after probing; the
test payout row and facility row were deleted.

Prior waves already covered (not re-treaded): anon→401 on admin+money routes,
non-admin→403 two-gate adminGroup, BOLA on registration/restaurant/groups/
listings, tier limits, suspended→401 at login, RBAC grant/revoke, XFF spoofing.

## Verdicts

| # | Probe | Verdict |
|---|-------|---------|
| 1 | BOLA sweep (~35 probes, 12 surfaces) | **SAFE** — every cross-user read/write refused (403/404); one minor disclosure (F9) |
| 2 | JWT handling | **SAFE** — tampered→401, alg=none→401, exp enforced server-side; suspended/deleted→403 live-verified |
| 3 | Mass-assignment | **FINDING — P0** (F1: self-serve `role:'admin'` → BFF super_admin) + P3 (F10 complete-profile) |
| 4 | Admin surface (Go + BFF + key) | **FINDING — P1** (F3: ungated BFF admin routes incl. real RBAC write path) + P3 (F7 key compare) |
| 5 | Injection | **Mostly SAFE** — raw SQL not injectable; one unsanitized PostgREST `.or()` interpolation (F8, bounded) |
| 6 | Rate limiting | **FINDING — P2** (F6: no limiter on money mutations; auth limiter env-set to 1000/min locally) |
| 7 | Headers/CORS | CORS **SAFE** (strict allowlist); headers **FINDING — P2** (F5: no security headers anywhere) |
| 8 | Error leakage | **FINDING — P2** (F4: raw Postgres/SQLSTATE + Go internals echoed to clients, systemic) |
| 9 | Session | **FINDING — P2** (F2: logout is cosmetic end-to-end; access token + refresh token survive) |
| 10 | Secrets sweep | **SAFE** — only the public anon key (allowlisted in .gitleaks.toml/trivy) |
| — | **NEW: money-path** | **FINDING — P0** (F0: `POST /api/v1/wallet/fund` mints wallet balance with no payment) |

---

## F0 — P0: `POST /api/v1/wallet/fund` credits any authenticated user's wallet with no payment

`backend/internal/handlers/wallet_connect_handler.go:92-146` calls
`walletSvc.Credit` directly — the same `DR provider_clearing → CR user_wallet`
journal the Paystack webhook posts after a confirmed charge — requiring only a
Bearer token and an `Idempotency-Key`. No PSP reference, no webhook proof, no
feature flag, no tier gate on the credit leg, no amount cap. Mounted at
`internal/app/connect_routes.go:222` under `walletGroup` with only
`authMiddleware` + `requireUserID`; `registerConnectWalletRoutes` runs whenever
the DB pool exists (router.go:537-541, not flag-gated).

Live proof (disposable tier-0 user B, balance 0):

```
POST /api/v1/wallet/fund   -H 'Idempotency-Key: k' -d '{"amountKobo":100}'
→ 201 {"newBalanceKobo":100,"status":"completed"}
GET  /api/finance/wallet/balance → {"balance_kobo":100}
POST /api/v1/wallet/fund   -d '{"amountKobo":10000000}'
→ 201 {"newBalanceKobo":10000100}            # ₦100,001 minted in 2 calls
```

Full spend chain (disposable user A bumped to kyc_tier 2, restored after):
mint ₦500 → `POST /api/finance/transfers/paymax` ₦250 to B →
`{"status":"successful"}` → `POST /api/v1/wallet/payouts/request` ₦1,000 →
`{"status":"pending"}` accepted into the disbursement queue. Minted funds are
fully fungible: transfers, payouts, votes, gifts.

Notes: `docs/full_audit.md:1332` documents the endpoint as the e2e funding rail
("the real authed funding route") because the Paystack fake can't intercept —
it shipped as a stub with no production gate. `walletSvc.Debit` enforces tiers
fail-closed, so a tier-0 account can mint but not (yet) send — but any user who
completes the self-serve tier-1 BVN check can. Payout eligibility
(`payouts_connect_handler.go:204-244`) counts minted balance toward its
minimum. Every mint writes a `fund_wallet` audit row at `warning` severity —
the trail exists, nothing stops it.

## F1 — P0: self-serve BFF super_admin — `PUT /api/me/profile {"role":"admin"}` persists to `user_profiles.role`

Chain: `frontend-web/app/api/me/profile/route.ts` passes the raw body to
`updateUserProfile` → `frontend-web/src/server/user/profile.ts:241` writes
`role: patch.role || 'USER'` (also :252 fallback) verbatim into
`user_profiles.role` via the service-role client →
`frontend-web/src/server/admin/auth.ts:63-75` (`assertAdminPermission`) reads
`user_profiles.role` as the role source of truth →
`frontend-web/src/server/admin/rbac.ts:110` aliases `'admin' → 'super_admin'`.

Live proof (disposable user A, `user_roles` = registered-user/verified-user):

```
PUT /api/me/profile {"role":"admin"}            → 200; DB role='admin'
GET /api/admin/audit-logs                        → 200 (real audit events)
GET /api/admin/users-roles                       → 200
GET /api/admin/settings                          → 200
POST /api/admin/registration/applications/<id>/review → 400 "status is required"  (authz passed)
POST /api/admin/voting/settings                  → 400 "contestId is required"   (authz passed)
(restore role='user' → GET /api/admin/audit-logs → 403 Forbidden)
```

~79 BFF routes under `app/api/admin/*` gate on `assertAdminPermission` (+ 63
more via the openmic/stem/utility wrappers that delegate to it) — all write via
`createAdminClient()` (RLS bypass): voting settings, registration review, KYC
queue, vote reversal, contest prizes, finance refunds, users/audit reads.
Other privilege fields in the same PUT (`kyc_tier`, `kyc_status`,
`application_status`, `payment_status`, `is_admin`) are correctly ignored —
`role` is the only writable privilege field, and it shouldn't be writable.

Containment: the escalation does NOT reach the Go backend (its RBAC reads
`public.user_roles`, untouched) or frontend-admin (adminAuth.ts now probes the
backend `menu-counts` gate — F3 from the auth wave is fixed). But every BFF
admin route is exposed, including money-adjacent ones (refunds, vote reversal,
KYC approval queues).

## F2 — P2: logout is cosmetic; tokens survive on both paths

- `POST :8080/api/auth/logout` (`backend/internal/handlers/auth_handler.go:402-408`)
  writes an audit row and returns 200 — no GoTrue sign-out, no session
  revocation. Verified: user B logged out via Go, then `GET
  /api/finance/wallet/balance` → **200**, and its `refresh_token` still minted
  new access tokens via `/auth/v1/token?grant_type=refresh_token`.
- `POST :3000/api/auth/logout` (`frontend-web/app/api/auth/logout/route.ts`)
  does call `admin.auth.admin.signOut(user.id)` — but the access token
  continued to authenticate (verified 200 post-sign-out), and the refresh grant
  succeeded after as well (empirically, sign-out had no effect on live tokens
  in this stack — GoTrue leaves access JWTs valid to `exp`, and whatever
  session row it revoked did not cover this one).
- `FEATURE_SESSION_HARDENING` unset →
  `RequireAuthContextWithSessions`'s `sessions.ValidateAccess` check
  (`auth_context.go:85-91,109-112`) is inert; plain `RequireAuthContext`
  (the middleware on almost every route group) never checks revocation. The
  session-management routes themselves 503 `feature_disabled`.
- What DOES work: `platform_users.status` is re-read per request —
  suspended/locked/deleted → 403 live-verified within seconds. So the only
  real revocation primitive today is an admin suspend, not logout.

Impact: a stolen access token is good for its full 1h TTL and its refresh token
potentially longer, regardless of user logout. P2 (P1-adjacent for a wallet
app; mitigated by the working suspend path).

## F3 — P1: `/api/admin/*` BFF routes missing the admin gate entirely

These call only `requireRequestUser` (any verified session) and then work via
`createAdminClient()` — service-role, RLS-bypassed:

- `frontend-web/app/api/admin/facilities/route.ts` — `GET` lists every estate's
  facilities; `POST` creates rows. **Verified live: user B (role=user) created
  `estate_facilities` row `e741dda1…` in a real estate → 201.** Sibling
  `[id]/route.ts` (GET/PATCH) and `[id]/bookings/route.ts` same pattern
  (PATCH/bookings currently 500 on unrelated bugs; gate absent regardless).
- `frontend-web/app/api/admin/modules/facilities-rbac/route.ts` — `GET` → 200
  dumps every role + its `estate.admin.facilities.*` permission mapping to any
  user (verified, real data).
- `frontend-web/app/api/admin/modules/facilities-rbac/[roleId]/route.ts` —
  `PATCH` deletes+inserts `role_permissions` rows via service-role, i.e. a raw
  RBAC-permission forge endpoint for ANY authenticated user. Currently 500s
  (the handler reads `params.roleId` synchronously — Next 16 params Promise),
  but the gate is absent: the write reached the DB layer and failed on the
  framework bug, not on authz. Latent privesc the moment that bug is fixed.
- `frontend-web/app/api/admin/privileges/route.ts` — `GET` enumerates
  `auth.users` + every user's `user_roles`/`role_permissions`/`user_permissions`.
  Currently 500s on `.from('auth.users')` (schema not exposed via PostgREST) —
  gate absent; leak is one code reorder away.
- `frontend-web/app/api/admin/contests/banner/[fileKey]/route.ts` — deliberately
  public (documented, path-constrained to `contests/banners/`). OK.

Distinct from F1: F3 needs no role write — plain registration is enough.

## F4 — P2: raw database/driver errors echoed to clients (systemic)

`backend/go-common/httperr/httperr.go:68-76` — `Write`/`WriteOK` always send
`err.Error()` verbatim; the mapper fixes the STATUS but never sanitizes the
message. ~20 modules construct mappers (savings, events, estate, crypto,
association, fractionalre, learn, health/*, doctor, business, groups, academy,
social, investai, disputes, transfers, maplerad, kycverify). Live leaks:

```
GET /api/finance/savings/vaults/not-a-uuid
→ 400 {"error":"ERROR: invalid input syntax for type uuid: \"not-a-uuid\" (SQLSTATE 22P02)"}
GET /api/finance/events/bad-uuid/stewards          → same SQLSTATE leak
GET /api/v1/connect/conversations/abc/messages
→ 500 {"error":"connect: load conversation: ERROR: invalid input syntax for type uuid: \"abc\" (SQLSTATE 22P02)"}
GET /api/finance/wallet/transactions?offset=-5
→ 500 {"error":"ERROR: OFFSET must not be negative (SQLSTATE 2201X)"}
POST /api/finance/transfers/paymax {"amount_kobo":"abc"}
→ 400 {"error":"json: cannot unmarshal string into Go struct field WalletTransferRequest.amount_kobo of type int64"}
```

Leaks DB engine, column types, raw SQLSTATE, table internals via wrapped
`fmt.Errorf` chains, plus Go struct field names. Also a correctness smell:
invalid input (bad uuid, negative offset) → 500, not 400. `X-Request-Id` header
IS present on API responses (good). No stack traces observed. (Malformed-JSON
and unknown-recipient paths return clean errors — the leak is specifically the
unmapped-error passthrough.)

## F5 — P2: no security headers on any surface

`:3000` and `:3001` return zero hardening headers — no CSP, no
`X-Frame-Options`/`frame-ancestors` (clickjacking), no `X-Content-Type-Options`,
no `Referrer-Policy`, no `Permissions-Policy`, no HSTS — plus `X-Powered-By:
Next.js` disclosure. Neither `next.config.mjs` defines `headers()`. The Go API
returns only `X-Request-Id` (acceptable for JSON-only, but `nosniff` is free).
Clickjacking a wallet/contest UI is a real risk class; P2.

## F6 — P2/observation: rate-limit posture

- **No limiter on money mutations**: 15 rapid `POST /api/finance/transfers/paymax`
  → all 404, no 429. The whole `transferGroup` (`finance_routes.go:388-402`),
  `/api/v1/wallet/fund`, gifting, savings contribute/withdraw have no throttle —
  only correctness guards (Idempotency-Key, tier limits, balance). A funded
  account can spam micro-transfers/mints unbounded.
- Auth limiter exists (`NewAuthRateLimiter`, router.go:143-150, default
  10/min per `config.go:906`) but this deployment sets
  `AUTH_RATE_LIMIT_PER_MIN=1000`, `AUTH_RESET_RATE_LIMIT_PER_HOUR=1000`,
  `AUTH_SIGNUP_RATE_LIMIT_PER_5MIN=1000` — effectively off locally (15 rapid
  logins → all 400, no 429). Verify prod values.
- Present where it matters: transaction-PIN verify has a fail-closed attempt
  counter + lockout (`transfers/service.go:958-983`); vote-bridge debit,
  maps, doctor-AI, OTP-signup (Postgres limiter), STEM all have limiters.

## F7 — P3: `x-admin-api-key` compared with plain `!=`

`backend/internal/middleware/admin_auth.go:50` —
`c.GetHeader("x-admin-api-key") != expectedKey`. Non-constant-time compare of a
64-char secret; network timing makes exploitation impractical but it's the one
place a `subtle.ConstantTimeCompare` obviously belongs. No throttle on the key
probe either (compounds). The gate itself is otherwise correct: fails closed,
wrong key → 401, unset-key outside development → 503, and
`RequireAdminConsoleRole` still requires a verified admin bearer behind it
(verified: correct key + no bearer → 401 `missing bearer token`; non-admin
bearer → 401/403 on all `/api/v1/admin/*` routes).

Also on the BFF key path: `SPOTLIGHT_ADMIN_API_KEY` with no
`SPOTLIGHT_ADMIN_API_KEY_ROLE` ceiling honors caller-declared
`x-admin-role: super_admin` → 200 on `/api/admin/audit-logs` (verified). The
shared key IS the credential by design (`admin/auth.ts:18-42`), but the ceiling
is unset locally, so the key + any self-declared role = full BFF admin.

## F8 — P3: unsanitized PostgREST `.or()` interpolation

`frontend-web/app/api/v1/contests/[id]/contestants/route.ts:31`:
`query.or(\`stage_name.ilike.%${search}%,category.ilike.%${search}%\`)` — the
`search` query param is interpolated raw into the PostgREST filter DSL.
Confirmed injectable characters reach the query (commas/parens accepted without
error), BUT the outer `.eq('contest_id')` + `.in('status',[approved,active])`
are AND-ed by PostgREST, so the injected or-branches cannot widen the result
set past this contest's approved/active contestants (verified: `,status.eq.
rejected` injections → `[]`). Residual risk is a boolean oracle over
non-selected columns of the same rows and a pattern that will not stay bounded
if reused on a route without strong outer filters. (Backend-side builders are
sanitized — `postgrestLiteral`/`postgrestLikePattern`,
`rbac_supabase_repository.go:360-426`.)

## F9 — P3: `GET /api/finance/events/:id` returns DRAFT/SUBMITTED events to any user

`internal/top5events/service.go:201-215` is an unconditional "public read" —
a non-organizer can fetch `title/venue/description/starts_at/organiser_id` of a
DRAFT event by id (verified: `200` on a DRAFT created by another user), while
the list endpoint correctly restricts non-organizers to LIVE/APPROVED/CLOSED
(`publiclyVisibleStates`, :220). Minor info disclosure; probably unintended
asymmetry rather than a design choice.

## F10 — P3: `POST /api/auth/complete-profile` persists arbitrary `profile_type` + privilege-shaped metadata

`backend/internal/services/auth_service.go:498-509` writes client-controlled
`profile_type` (no enum check — stored `<script>alert(1)</script>` verbatim,
verified) and `metadata` verbatim into `profiles`. Two effects: stored-XSS
payload available wherever `profile_type` is rendered (admin views); and
`metadata.program_id`/`contest_id`/`school_id` feed the admin user-search
filters (`rbac_supabase_repository.go:454-456`), so a user can self-associate
into any admin program/contest/school cohort listing. Also appends a new row
per call (no upsert). `profiles.metadata.role`/`is_admin` written this way are
NOT read for authz — no privesc — but the data-integrity/XSS vectors are real.

## F11 — Observation: per-request GoTrue dependency degrades to 503 bursts

Every `RequireAuthContext` request does a live `GET /auth/v1/user` round trip
(`integrations/supabase_http.go:125-151`); under concurrent load the stack
degrades to `503 authentication service unavailable` waves (observed twice
during probing; fails CLOSED — correct — but availability-fragile).
`AUTH_JWT_LOCAL_VERIFY` (jwt_local.go — alg-allowlisted ES256/HS256 verify,
correctly built) exists to remove the round trip and is off. Enabling it widens
the logout-revocation gap in F2 (documented in its own header comment).

---

## Probe log (summary of what was run)

- **BOLA (user B token vs user-A/3rd-party resources), all refused**:
  savings `GET/POST vaults/:id{/balance,/deposit,/withdraw}` 403;
  `GET/POST circles/:id{,/activate}` 403; `GET/POST targets/:id{,/balance,
  /contribute,/release}` 403; support `GET/POST sessions/:id/messages`,
  `resolve`, `escalate` 404/400; `GET kyc/session/:id` 403;
  `GET/POST restaurant/orders/:orderId/messages` 403 (real 3rd-party order);
  `GET/PUT/POST restaurant/:id/kyb{,/submit}` 403/400; `GET/POST
  connect/conversations/:id/messages` 403; `GET wallet/history/:id` 404;
  `GET mobility|driver/trips/:id/messages` 404; `GET estate/:id/meetings` 403;
  events `POST :id/{submit,golive,close,tiers,promos,stewards,vendors}` +
  `GET :id/{stewards,attendees}` all 403; `GET finance/events/:id` 200 (F9).
- **JWT**: flipped signature byte → 401; `alg:none` → 401; `platform_users
  .status=suspended` → 403; `status=deleted` → 403; restore → 200.
- **Admin**: `/api/v1/admin/{overview,dashboard,users,audit}` non-admin →
  401/403; wrong key → 401; key+no-bearer → 401.
- **Injection**: `'`, `1 OR 1=1`, `';DROP TABLE` in uuid params → 400/403,
  no row leakage (but leaked errors — F4). PostgREST `.or()` smuggle — F8.
- **Rate**: 15× transfer + 15× login → no 429 (F6).
- **CORS**: allowlisted origin → full ACAO+credentials; `evil.example.com`
  preflight → 204 with NO ACAO (browser-blocked). SAFE.
- **Session**: Go logout → token+refresh live; BFF logout → token+refresh live (F2).
- **Secrets**: git grep for `sk_live`, private-key blocks, JWTs → only the
  Supabase anon key (public by design; allowlisted). `.env*` untracked.
- **Misc verified-safe**: KYC webhook signature-required (unsigned → 401);
  kyc checks bound to caller's uid; transfer sender from token ctx; gifting tx
  scoped `sender_id|recipient_id = caller`; referral `ErrSelfClaim`; connect
  profile mass-assign ignored (verified_badge stayed false); tier-1 submit runs
  a real provider check, fails closed without consent; `X-Stem-Role`/
  `X-Admin-Role` headers documented + verified untrusted; frontend-admin
  proxy attaches `ADMIN_API_KEY` only after session validation
  (`ADMIN_MIDDLEWARE_ENFORCE=1` set, default-on `resolveEnforce`).

## Coverage notes — what was NOT probed

- Flag-off modules (404, unreachable): marketplace `/v1/marketplace/*`,
  academy `/api/finance/academy/*` (incl. vaults), learn/investai, doctor
  `/api/v1/doctor/*`, associations, SSE `/api/v1/realtime/stream`.
- Data-absent surfaces: mobility trips, event transport bookings, gift
  transactions (none exist to probe cross-tenant — handlers code-reviewed
  scoped instead).
- Mobile API paths, Paystack/PSP webhook forgery (KYC webhook verified;
  Paystack covered in prior wave), OTP/MFA flows, R2 signed-URL ACLs,
  frontend-admin UI-level authz beyond adminAuth.ts, the 63 wrapper-gated
  BFF admin routes individually (they all share the F1/F3 primitives).
- `env` is `APP_ENV=development`; `RequireAdmin` dev-passthrough when
  `ADMIN_API_KEY` is unset is intentional and did not apply (key set).

## Residual artifacts

Disposable users A/B retain: A's savings vault/circle/target, support session,
KYC session, drafted event, profiles rows, and a 500,000-kobo fixture funding
journal (deliberately left — identical to a legit topup). All minted/
transferred/payout balances were REVERSED via balanced correction entries;
payout request and unauthorized facility row deleted.
