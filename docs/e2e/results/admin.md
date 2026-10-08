# ADMIN module — production E2E validation results

Date: 2026-10-03. Stack exercised live: frontend-admin dev :3001 (Next 16.3.8,
`ADMIN_API_BASE_URL=http://localhost:8080` via process env — see O1),
`ADMIN_MIDDLEWARE_ENFORCE=1`, `ADMIN_API_KEY` set server-side; public web :3000;
Go backend :8080 (`spotlight-latest1-api-1`, `APP_ENV=development`); GoTrue via
Kong :54321; Postgres :54322 (`supabase_db_spotlight`); Inbucket (Mailpit API) :54324.

Specs: `frontend-web/tests/e2e/admin/` (new — first e2e harness for this app;
all run on `chromium-desktop`). Helpers in `tests/e2e/admin/helpers.ts`.

Environment facts verified before testing:
- `admin@spotlight.internal` holds `super-admin` in `public.user_roles` (+ registered/verified).
- `public.roles` = 47 rows, `public.permissions` = 347, `public.platform_users` = 368.
- `sb-admin-token` HttpOnly cookie is the console session; middleware verifies it
  server-side (HS256 secret / JWKS path) and `/api/admin-proxy/*` re-checks it
  before attaching `x-admin-api-key` + the bearer upstream.
- `FEATURE_SESSION_HARDENING_ENABLED` unset → `EvaluateLogin` and the
  `force-logout`/`force-password-reset` admin endpoints are disabled; nothing in
  this env can write `public.security_events` (0 rows).

## Verdicts

| ID | Journey | Verdict |
|----|---------|---------|
| ADMIN-001 | console login + dashboard | **PASS** — UI login → console; dashboard "Contestants" count (6) == `menu-counts.contestants`; all proxy traffic 200 |
| ADMIN-002 | user management | **PASS** — list real users, provisioned user found via Search, Suspend → DB `status=suspended` → login 401; Unsuspend → `active` → login 200 |
| ADMIN-003 | roles/permissions + assignment | **PASS** — Roles (47) & Permissions (347) reconcile with DB; `judge` grant → `user_roles` row + probe 403→200; removal → row gone + probe 403 |
| ADMIN-004 | audit/activity views | **PASS** — Login Activity shows this run's rows with the real email; Audit Logs shows `user.suspend`/`user.unsuspend` actor→target; Security Events renders honest empty state (no writer enabled — see O3) |
| ADMIN-005 | module surfaces sweep | **PASS** — 34/34 pages render, no error boundaries, no failed proxied API call (admin-proxy AND web-proxy watched) |
| ADMIN-006 | scoped-access check | **UNVERIFIED** — scoped role definitions exist (`contest-manager`, `state-coordinator`, role_type `program`; `user_roles.scope_type/scope_id` schema present) but **0 non-global assignments seeded** (486 rows, all `global`) |
| Edge | proxy auth / session bounce | **PASS** — no cookie → 401; forged cookie → 401; cookie-clear → bounce to `/admin/login?next=…` (see O2: cookie re-minted) |

---

## ADMIN-001 — console login + dashboard — PASS

Spec: `tests/e2e/admin/admin-001-login-dashboard.spec.ts` (green).

Steps observed:
1. `GET /admin/login` → form (username `input`, `input[type=password]`, "Sign in").
2. `signInAdmin()` → GoTrue `signInWithPassword` → mirrors token into `sb-admin-token`
   via `POST /api/admin/session` → admission probe
   `GET /api/admin-proxy/api/v1/admin/menu-counts` → **200** → `router.push('/admin')`.
3. Shell renders: sidebar + operator email `admin@spotlight.internal` + "Log out" + "Dashboard" link.
4. Dashboard: "Operations" heading, "Needs attention" section, module cards.
5. Reconciliation: API `menu-counts.contestants = 6`; the dashboard's Contestants
   card renders `6`. Other counters: auditions 0, academy 0, reality_tv 0,
   sme_pitch 0, stem 0, bootcamp 0, open_mic 0.
6. Captured proxy traffic (all 200, no 5xx, no 4xx):
   `api/v1/admin/menu-counts` ×5 (login probe + dashboard + guard re-syncs),
   `api/v1/admin/stem/my-role`, `api/v1/admin/overview` ×2.

## ADMIN-002 — user management — PASS

Spec: `tests/e2e/admin/admin-002-user-management.spec.ts` (green).

- Victim: `e2e-admin-suspend-…@paymax.test` (`9b07e5aa-…`), provisioned this run.
- Users list: `Total: 367` (DB `platform_users` = 368 — off-by-one is parallel-run
  drift: sibling specs provision users concurrently; both counters moved during
  the run). Rows carry real emails.
- Search filter (email) → row found → click → "Selected User" panel.
- **Suspend** → toast "User suspend succeeded." → `platform_users.status='suspended'`
  → `POST /api/auth/login` for that user → **401** `{"error":"invalid credentials"}`
  (the platform_users status gate refuses before GoTrue).
- **Unsuspend** → toast → `status='active'` → login **200** with session tokens.
- API path used by the page: `GET/PATCH /api/admin/users*` through the proxy.

## ADMIN-003 — roles, permissions, role assignment — PASS

Spec: `tests/e2e/admin/admin-003-rbac.spec.ts` (green).

- `/admin/roles`: "Role Management"; pagination `of 47` matches `public.roles`
  (47) and `GET /api/admin/roles` (47); filter finds `judge`.
- `/admin/permissions`: `of 347` matches `public.permissions` (347) and the API.
- Grant flow (admin API): `POST /api/admin/users/:id/roles {roleId: <judge>}` →
  200 → `user_roles` row (is_active) created.
- Effective-permission probe: `GET /api/v1/admin/registrations`
  (`RequirePermission("contestant.view")`, which `judge` grants):
  **403** before grant → **200** after grant → **403** after
  `DELETE /api/admin/users/:id/roles/:roleId`. `user_roles` row removed.
- No system roles or the admin fixture were touched.

## ADMIN-004 — audit & activity views — PASS

Spec: `tests/e2e/admin/admin-004-audit.spec.ts` (green).

- Generated this run: success login (200) + failed login (401) for a provisioned
  user; admin suspend + unsuspend via `PATCH /api/admin/users/:id/{suspend,unsuspend}`.
- DB: `login_activity` rows for the victim = 2, carrying `email` (attributed —
  the post-fix behavior, not anonymous); `audit_logs` gained
  `user.suspend` + `user.unsuspend` with `target_user_id` = victim.
- UI Login Activity: Email filter → row(s) render **with the victim's email in
  the Email column**.
- UI Audit Logs: Action filter `user.suspend` → row renders with action +
  `actor → target` cell containing the victim's user id.
- Security Events: page renders "Security Events" + honest empty state
  ("No security events to display"). `security_events` = 0 rows — expected:
  `FEATURE_SESSION_HARDENING_ENABLED` is unset, so `EvaluateLogin` and the
  admin force-logout/force-reset endpoints (the only writers) are disabled.
  **No attributed security-event rows can be produced in this env** — the page
  is verified renderable; its populated state is not (flag-gated data source).

## ADMIN-005 — module surfaces sweep — PASS (34/34)

Spec: `tests/e2e/admin/admin-005-module-sweep.spec.ts` (green, 4 tests).
Per page: navigated after a real UI login; asserted no error-boundary/overlay
text, no stuck "Loading…", substantive body content; watched BOTH
`/api/admin-proxy/*` (Go) and `/api/web-proxy/*` (Path-A → :3000 BFF) responses
for ≥400. **Zero failed calls across all 34 pages.**

| Section | Page | Verdict | Notes |
|---------|------|---------|-------|
| Contests & Voting | /admin/contests | PASS | 4 contests in DB; page renders records |
| | /admin/competitions | PASS | dashboard |
| | /admin/open-mic | PASS | |
| | /admin/registration | PASS | Path-A (web-proxy) data path healthy |
| | /admin/judges-scores | PASS | |
| | /admin/voting/packages | PASS | |
| | /admin/stages-evictions | PASS | |
| Finance / escrow / wallets | /admin/finance | PASS | overview |
| | /admin/finance/transactions | PASS | |
| | /admin/finance/wallets | PASS | |
| | /admin/finance/transfers | PASS | |
| | /admin/payments-finance | PASS | |
| | /admin/social-escrow/dashboard | PASS | |
| | /admin/savings/dashboard | PASS | |
| | /admin/fx | PASS | |
| Commerce & marketplace | /admin/marketplace | PASS | FEATURE_MARKETPLACE on |
| | /admin/crowdfunding | PASS | FEATURE_CROWDFUNDING on |
| | /admin/restaurant | PASS | onboarding already proven |
| | /admin/vendors | PASS | |
| | /admin/estate | PASS | |
| | /admin/events/dashboard | PASS | |
| | /admin/mobility | PASS | |
| | /admin/telemedicine/dashboard | PASS | |
| | /admin/social/dashboard | PASS | FEATURE_SOCIAL_PAY on |
| Comms, support & platform | /admin/connect/comms | PASS | |
| | /admin/connect/dashboard | PASS | |
| | /admin/referral/dashboard | PASS | |
| | /admin/leads | PASS | |
| | /admin/handoffs | PASS | |
| | /admin/chatbot | PASS | |
| | /admin/analytics | PASS | |
| | /admin/modules | PASS | |
| | /admin/groups | PASS | |
| | /admin/rbac-settings | PASS | |
| | /admin/intake | PASS | |

Breadth caveat: "PASS" = renders cleanly + real/honest-empty data + no failed
API call. Deep per-module flows are out of scope. Count-vs-API reconciliation
was done on the deep specs (dashboard counts, users, roles, permissions).

## ADMIN-006 — scoped access — UNVERIFIED

Spec: `tests/e2e/admin/admin-006-edge.spec.ts` (skipped with reason recorded).

- `user_roles` carries `scope_type`/`scope_id` columns and role definitions
  `contest-manager` / `state-coordinator` (role_type `program`) exist — the
  scoping machinery is seeded.
- But `select count(*) … where scope_type <> 'global'` = **0**: no scoped admin
  assignment exists in the seed, so "scoped admin sees only their scope" cannot
  be exercised without fabricating the very thing under test. UNVERIFIED, not faked.

## Edge cases — PASS

- `GET /api/admin-proxy/api/v1/admin/menu-counts` with no cookie → **401**
  `{"success":false,"error":"Not authenticated."}` (ADMIN_MIDDLEWARE_ENFORCE=1).
- Same with `Cookie: sb-admin-token=not.a.real.jwt` → **401** (signature check,
  not just presence).
- Logged in → `/admin/users` renders → `context.clearCookies()` → `/admin/roles`
  → middleware 307 → lands on `/admin/login?next=%2Fadmin%2Froles`.

## Observations / findings

| # | Sev | Finding |
|---|-----|---------|
| O1 | P3 (config drift) | `frontend-admin/.env.local` still ships `ADMIN_API_BASE_URL=http://localhost:8095` (dead port). The live dev process only works because it was started with a shell env override to :8080. A fresh `npm run dev` without the override resurrects the dead-upstream failure (auth.md F4): the proxy would error on every call and `signInAdmin`'s admission probe would fail closed — every admin locked out of the console. |
| O2 | info | Cookie-clear is a bounce, not a sign-out: landing on `/admin/login` runs `syncAdminSession()`, which re-mints `sb-admin-token` from the still-live Supabase localStorage session (verified: cookie re-created ~2s after clear). Server-side gate still enforced; full logout requires `clearAdminSession()` (cookie DELETE + supabase signOut + localStorage record drop). |
| O3 | info | `security_events` has no enabled writer in this env (`FEATURE_SESSION_HARDENING_ENABLED` unset → `EvaluateLogin` skipped at login; `force-logout`/`force-password-reset` admin endpoints 503 `feature_disabled`). The Security Events page is verified renderable with an honest empty state; its populated path is unexercised. |
| O4 | info | Users-page counter briefly shows `Total: 0` while the list fetch is in flight (counter renders `users.length` before first load). Cosmetic; could read as "no users" to an operator mid-load. No silent 5xx swallow was observed anywhere in the sweep — every page that rendered empty also had a clean API bill (AUD-FE-006 watch negative this run). |

## API surface exercised

Through `/api/admin-proxy/` (UI paths): `GET /api/v1/admin/menu-counts`,
`GET /api/v1/admin/overview`, `GET /api/v1/admin/stem/my-role`,
`GET/PATCH /api/admin/users`, `PATCH /api/admin/users/:id/suspend|unsuspend`,
`GET /api/admin/roles`, `GET /api/admin/permissions`,
`GET /api/admin/audit-logs`, `GET /api/admin/login-activity`,
`GET /api/admin/security-events`, plus whatever the 34 swept pages called
(admin-proxy + web-proxy — all ≥200 <400 observed).

Direct :8080 probes (admin bearer + x-admin-api-key):
`GET /api/v1/admin/menu-counts`, `GET /api/admin/roles`,
`GET /api/admin/permissions`, `POST /api/admin/users/:id/roles`,
`DELETE /api/admin/users/:id/roles/:roleId`,
`PATCH /api/admin/users/:id/suspend|unsuspend`,
`GET /api/v1/admin/registrations` (permission probe).

Auth path: `POST :3000/api/auth/login` (admin token, suspended-user 401,
restored 200, bad-password 401), `POST/DELETE :3001/api/admin/session`.

## Blockers

- ADMIN-006 scoped-admin journey: **BLOCKED by seed** — no non-global
  `user_roles` assignment exists; scoped console roles are defined but never granted.
- Security Events populated view: **BLOCKED by flag** — session-hardening off;
  nothing writes `security_events`.
