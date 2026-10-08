# AUTH module — production E2E validation results

Date: 2026-10-03. Stack exercised live: Next dev :3000 (`GO_BACKEND_URL=http://localhost:8080`),
Go backend :8080 (`wt-audit-api-1`, `APP_ENV=development`), GoTrue via Kong :54321,
Postgres :54322 (`supabase_db_spotlight`), Inbucket (Mailpit API) :54324.

Specs: `frontend-web/tests/e2e/auth/` (all run on `chromium-desktop`).

Environment facts verified before testing:
- `FEATURE_OTP_EMAIL_ENABLED` unset → server-issued OTP OFF. Register/forgot-password
  "code" paths fall back to Supabase (GoTrue mails via Inbucket). `GOTRUE_MAILER_AUTOCONFIRM=false`
  → email verification required. `GOTRUE_JWT_EXP=3600`, refresh rotation ON.
- `ADMIN_API_KEY` unset + `APP_ENV=development` → `RequireAdmin` dev-passthrough; real gating
  is `RequireAdminConsoleRole`/`RequirePermission` (verified below).
- `qa-claude-test@spotlight.internal` roles in `public.user_roles`: `registered-user`,
  `verified-user` — **not** an admin on the enforced store. But `user_profiles.role='admin'`
  (see AUTH-005 finding F3).
- frontend-admin `.env.local` has `ADMIN_API_BASE_URL=http://localhost:8095` — a dead port.

## Verdicts

| ID | Journey | Verdict |
|----|---------|---------|
| AUTH-002 | register → verify → login | **PASS with finding F1** (all steps work; post-verify lands on /login, not signed-in dashboard) |
| AUTH-003 | forgot/reset password | **PASS with finding F2** (link path works end-to-end; the UI's code path can never be completed in this env) |
| AUTH-004 | session behavior | **PASS** |
| AUTH-005 | RBAC surface | **FAIL** — backend RBAC correct (401/403), but admin console admits a backend-non-admin account (F3); admin-proxy upstream dead (F4) |
| AUD-BE-005 re-verify | change-password | **PASS — prior P0 confirmed FIXED** |
| AUD-BE-009 re-verify | lockout self-destruct | **PASS — prior P0 confirmed FIXED** |
| Audit trail | login activity / audit events | **FAIL** — `login_activity` rows carry no identity (F5, P1) |

---

## AUTH-002 — register-verify-login — PASS (with F1)

Spec: `tests/e2e/auth/auth-002-register.spec.ts` (green).

Steps observed:
1. `/login` → "Create Account" tab → POST `/api/auth/register` → **200**
   (`needsVerification:true`, no session — correct, autoconfirm is off).
2. Redirect → `/verify-email?email=…&next=/user-dashboard` ✓.
3. Mailpit: `Your Spotlight verification code` email arrives in ~2s with a real 6-digit code ✓.
4. Enter code → POST `/api/auth/verify-otp` → **200**, `signedIn:true`, tokens in body.
5. **F1**: verify page does `router.replace('/user-dashboard')` but never adopts the
   returned session → middleware `getUser()` finds no cookie → lands on
   `http://localhost:3000/login?next=%2Fuser-dashboard` instead of the dashboard.
   Evidence: `app/verify-email/page.tsx:103-106` branches on `body.signedIn` but ignores
   `body.tokens`; `app/api/auth/_supabase.ts` uses `persistSession:false` so the BFF
   `verifyOtp` writes no cookies either. Recorded traffic:
   `register 200 → verify-otp 200 → login 200 → /auth/v1/user 200`.
6. Manual sign-in with the new credentials → `/user-dashboard`, "welcome back" ✓.

## AUTH-003 — forgot/reset password — PASS (with F2)

Spec: `tests/e2e/auth/auth-003-forgot-reset.spec.ts` (green). Ran on a spec-provisioned
user (`e2e-reset-*@paymax.test`) — fixture accounts untouched.

Steps observed:
1. POST `/api/auth/forgot-password` → **200** generic ("if an account exists…") ✓.
2. Recovery email `Reset your password` arrives with a GoTrue link:
   `…/auth/v1/verify?token=…&type=recovery&redirect_to=http://127.0.0.1:3000` — **no code** (`hasCode=false`).
3. Following the link lands on `http://127.0.0.1:3000/auth/reset-password` with the
   recovery session live — the reset form renders (PASSWORD_RECOVERY handled) ✓.
4. Set new password → "Password updated" → redirect to /login.
5. Old password → POST login **401**; new password → **200** ✓.
6. **F2**: the `/forgot-password` UI presents a 6-digit-code step as the primary flow,
   but with `FEATURE_OTP_EMAIL_ENABLED` off no code is ever sent. Entering any code →
   POST `/api/auth/reset-password` → **503** `{"error":"Code-based reset is unavailable.
   Please use the link in the reset email."}` (Go: `feature_disabled/otp_email`). The page
   does show that error and points to the link — recoverable, but the dominant UI step
   is a dead end in every environment where the flag is off (i.e. all of them today).

## AUTH-004 — session behavior — PASS

Spec: `tests/e2e/auth/auth-004-session.spec.ts` (green).

- Login → `page.reload()` → still authenticated on `/user-dashboard` ✓.
- `context.clearCookies()` → GET `/user-dashboard` → 307 to `/login?next=%2Fuser-dashboard` ✓.
- Refresh rotation: simulated the natural 1h expiry by setting `expires_at` in the
  `sb-127-auth-token` cookie session to the past while keeping the real `refresh_token`.
  GET `/user-dashboard` → **stayed authenticated** (landed on dashboard, no bounce).
  The refresh call itself runs inside Next middleware (server-side), so
  `/auth/v1/token?grant_type=refresh_token` is not observable via `page.on('response')` —
  rotation is proven by the outcome.

## AUTH-005 — RBAC surface — FAIL (F3, F4)

Spec: `tests/e2e/auth/auth-005-rbac.spec.ts` (green — assertions document reality).

Backend API probes on :8080 (fixture = registered-user + verified-user only):

| Probe | anon | fixture Bearer |
|-------|------|----------------|
| GET `/api/v1/admin/menu-counts` | 401 | 403 |
| GET `/api/v1/admin/leads` | 401 | 403 |
| GET `/api/v1/admin/dashboard` | 401 | 403 |
| GET `/api/admin/users` | 401 | 403 |
| GET `/api/admin/login-activity` | 401 | 403 |

→ Backend RBAC is correct even with the dev-mode `RequireAdmin` passthrough —
`RequireAdminConsoleRole`/`RequirePermission` still gate. ✓

Web surfaces:

- `/admin` on :3000: anonymous → 307 `/admin/login?next=/admin` (a route that **404s** —
  `PUBLIC_EXCEPTIONS` whitelists a page this app doesn't ship); authenticated → **404**
  (middleware checks authentication only; no `/admin` pages exist in frontend-web).
  Minor dead config — P3.
- Admin console :3001 as **fresh standard user** (`e2e-rbac-*`, `user_profiles.role='user'`):
  "Access denied. Admin privileges required." → stays on `/admin/login` ✓.
- **F3**: admin console :3001 as `qa-claude-test@spotlight.internal` → **admitted to the
  full `/admin` console** (sidebar, dashboard shell). Cause: `signInAdmin`
  (`frontend-admin/src/features/auth/adminAuth.ts:13-49`) gates on `user_profiles.role`,
  which is `'admin'` for this account, while every backend admin route enforces
  `public.user_roles` (where the account has no admin role). The two role stores
  disagree and the web gate trusts the wrong one. Containment verified: every proxied
  API call would still 403 at Go (when the proxy can reach it — see F4), so this is
  console-shell access without data access. P1–P2 depending on whether any future
  admin route trusts the frontend's claim. (It is also possible the fixture's
  `user_profiles.role='admin'` was seeded deliberately — even so, the gate checks a
  store the enforcement layer ignores.)
- **F4**: `frontend-admin` proxy upstream is dead in this env — `.env.local`
  `ADMIN_API_BASE_URL=http://localhost:8095`. `GET /api/admin-proxy/…` → 401 without
  session, **504** `{"error":"The admin API could not be reached."}` with a session.
  Same stale-8095 pattern playwright.config.mjs already had to override for
  frontend-web's `GO_BACKEND_URL`. Env/config issue, P2 — the console is non-functional
  locally regardless of role.

## AUD-BE-005 re-verify — change-password — PASS (fixed)

Spec: `tests/e2e/auth/auth-006-change-password-lockout.spec.ts` (green). No
change-password UI exists in frontend-web — the Go endpoint was driven directly
(missing UI recorded as a note, not a bug: web has no surface for it).

On a spec-provisioned user, Bearer = its real access token:
- POST `/api/auth/change-password` wrong `currentPassword` → **400** (verifies first).
- Correct `currentPassword` + new → **200** `{"success":true,"message":"Password changed"}`.
- Login with OLD password → **401**; login with NEW → **200**. ✓

Prior P0 (success-without-changing) is **not** reproducible — the fix
(`auth_service.go:434` verify→AdminSetPassword→revoke) works end-to-end.

## AUD-BE-009 re-verify — lockout self-destruct — PASS (fixed)

Same spec (green). Own provisioned user only; restored afterwards.

- 5× POST `/api/auth/login` wrong password → all **401**; `platform_users` →
  `status='locked'`, `failed_login_attempts=5`, `locked_until ≈ +30min` ✓.
- Correct password while lock is live → **401** (refused before GoTrue) ✓.
- `locked_until` set to past (simulated elapsed lock) → correct password → **200** and
  `status` reset to `'active'`, `locked_until` cleared ✓ — the self-destruct latch is gone.
- Cleanup: `status='active', failed_login_attempts=0, locked_until=null` re-applied in
  `finally` regardless.

## Session/audit trail — FAIL (F5)

Spec: `tests/e2e/auth/auth-007-audit-trail.spec.ts` (fails on the attribution step — that
failure is the evidence).

- `public.login_activity` rows ARE written for both failed (`invalid_credentials`) and
  successful logins — the write path works.
- **F5 — P1**: every row is anonymous: `user_id NULL`, `email ''`. Querying
  `login_activity` by the account's email returns **zero rows** — login activity cannot
  be attributed to any account. Root cause: `AuthHandler.Login`
  (`backend/internal/handlers/auth_handler.go:288,296,300`) calls
  `h.audit.LogLogin("", in.Email, …)` — `in.Email` is empty whenever callers send
  `identifier` (the web BFF and mobile always do), and the resolved `__user_id`/`__email`
  hints are never passed to `LogLogin`. Per-account brute-force forensics, the admin
  console's login-activity screen, and any suspicious-login signal keyed by email are
  all broken by this.
- `public.audit_logs` is healthy: `register.success` and `password.change` rows carry
  real actor/target user IDs and the email in `new_values`. ✓

## Findings summary

| # | Severity | Finding |
|---|----------|---------|
| F1 | P2 | `/verify-email` discards the session the verifier returns (`signedIn:true`) and routes to `next` unauthenticated → user bounces to `/login`. `app/verify-email/page.tsx:103-106` ignores `body.tokens`. |
| F2 | P2 | `/forgot-password` code step is unsatisfiable whenever `FEATURE_OTP_EMAIL_ENABLED` is off (always, today): emails carry only a link; any code → 503. |
| F3 | P1/P2 | Admin-console web gate trusts `user_profiles.role` while all backend admin routes enforce `user_roles` — an account the backend 403s everywhere got the full console UI. `frontend-admin/src/features/auth/adminAuth.ts:13-49`. |
| F4 | P2 env | `frontend-admin/.env.local` `ADMIN_API_BASE_URL=http://localhost:8095` (dead port) → every proxied admin call 504s. Console is non-functional locally. |
| F5 | P1 | `login_activity` writes anonymous rows (`user_id`/`email` empty) for every login — auth forensics unattributable. `auth_handler.go` passes `in.Email` (empty for `identifier` logins) and never passes the resolved user id/email. |
| — | P3 | `/admin` protected pattern + `/admin/login` exception exist in `frontend-web/src/middleware.ts` but the app ships no such pages (redirect target 404s). |

## Prior findings re-verified

- **AUD-BE-005** (P0, change-password false success): **RESOLVED — confirmed fixed end-to-end**.
- **AUD-BE-009** (P0, permanent lockout after expired auto-lock): **RESOLVED — confirmed fixed end-to-end**.

## Evidence artifacts

- Failure screenshots/videos: `frontend-web/test-results/auth-auth-003-*` (pre-fix run),
  `auth-auth-005-*` (admin-console admission), `auth-auth-007-*` (audit attribution).
- All spec traffic recorded via `page.on('response')` + `waitForResponse`; statuses cited above.
- Fixture accounts (`admin@`, `qa-claude-test@`) were only READ (role/status lookups);
  every mutation-targeted user was provisioned by the specs under `e2e-*@paymax.test`.
