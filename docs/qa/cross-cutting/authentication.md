# Cross-cutting: Authentication

**Risk tier: 0.** Applies to every authenticated endpoint on the backend and both web/mobile
clients. Source of truth: `backend/internal/middleware/auth_context.go`
(`RequireAuthContext` / `RequireAuthContextWithSessions` / `requireAuth`),
`backend/internal/integrations/supabase_http.go` (`AuthUser`),
`backend/internal/handlers/auth_handler.go` + `services/auth_service.go`,
web `frontend-web/app/api/auth/**` and `frontend-web/src/lib/auth/request.ts`.

## 1. How auth actually works here (test-relevant facts)

- Client sends `Authorization: Bearer <supabase-access-token>`.
- The Go middleware does **NOT verify the JWT signature locally.** It calls Supabase
  `GET /auth/v1/user` (`supabase.AuthUser(token)`); trust is delegated to Supabase. A token is
  "valid" iff Supabase resolves it to a user with a non-empty `id`.
- After identity resolution the middleware checks `rbac.GetUserStatus(id)` and **rejects
  `suspended` / `locked` / `deleted` with 403** — *even when the token itself is valid*.
- Optional session-revocation layer (`RequireAuthContextWithSessions`, flag-gated): when
  enforced, a token mapping to a revoked/expired `auth_session` is rejected **401 fail-closed**.
- On success it sets `authUser`, `authToken`, and mirrors `user_id` / `user_email` onto the Gin
  context (downstream `requireUserID` handlers depend on these being set **before** `c.Next()`).

Error contract (assert exactly):

| Condition | Status | Body `error` |
|---|---|---|
| No / malformed `Authorization` header | 401 | `missing bearer token` |
| Supabase rejects token | 401 | `invalid token` |
| Token resolves but `id` empty | 401 | `invalid token subject` |
| `user_status` ∈ {suspended, locked, deleted} | 403 | `account restricted` |
| Session revoked (enforce on) | 401 | `session revoked` |

## 2. Test matrix by layer

| Behavior | Layer | Existing coverage |
|---|---|---|
| Bearer parsing / status gate | unit | partial (`middleware/session_enforcement_test.go`, personas test) |
| Suspended/locked/deleted → 403 | unit/integration | **gap** — add |
| Session revocation fail-closed | integration | `session_enforcement_test.go` documents flag path |
| Login / register / OTP / reset flows | integration | web `tests/unit/golden-path` partial |
| Full login→protected→suspended e2e | e2e | **gap G4** |

## 3. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| AUTH-UNIT-001 | Missing Authorization header | P0 | any protected endpoint | Call endpoint with no `Authorization` header | — | 401, `{"success":false,"error":"missing bearer token"}`; handler body never runs |
| AUTH-UNIT-002 | Malformed header (no `bearer ` prefix) | P0 | — | Send `Authorization: Token abc` | header `Token abc` | 401 `missing bearer token` |
| AUTH-UNIT-003 | Invalid/expired token | P0 | — | Send a token Supabase rejects | garbage/expired JWT | 401 `invalid token` |
| AUTH-UNIT-004 | Valid token, empty subject | P1 | mock Supabase returns no `id` | Call with such token | — | 401 `invalid token subject` |
| AUTH-UNIT-005 | Happy path authenticated | P0 | `qa-user-a` valid token | Call `GET /api/finance/wallet/me` | valid token | 200; `user_id`/`user_email` populated downstream |
| AUTH-SEC-001 | Suspended account blocked | P0 | `qa-suspended` (`user_status=suspended`), valid token | Call any protected endpoint | valid token | **403** `account restricted` (token validity is irrelevant) |
| AUTH-SEC-002 | Locked account blocked | P0 | `user_status=locked` | same | — | 403 `account restricted` |
| AUTH-SEC-003 | Deleted account blocked | P0 | `user_status=deleted` | same | — | 403 `account restricted` |
| AUTH-SEC-004 | Session revoked → fail-closed | P0 | session enforcement flag ON; revoke `qa-user-a` session | Call protected endpoint with the revoked session's token | — | 401 `session revoked` |
| AUTH-SEC-005 | Session enforcement OFF preserves behavior | P1 | flag OFF | Call with any valid token whose session row is missing | — | 200 (no session check) |
| AUTH-INT-001 | Login success issues session | P0 | registered `qa-user-a` | `POST /api/auth/login` correct creds | valid email+pw | 200 + token; subsequent protected call succeeds |
| AUTH-INT-002 | Login wrong password | P0 | registered user | `POST /api/auth/login` wrong pw | bad pw | 401; no token |
| AUTH-INT-003 | Account lockout after N failures | P1 | `AUTH_MAX_FAILED_LOGIN_ATTEMPTS=5`, `AUTH_ACCOUNT_LOCK_MINUTES` set | Fail login 5×, then try correct pw | — | After threshold, further attempts blocked/locked until window elapses |
| AUTH-INT-004 | Forgot/reset password | P1 | registered user | `forgot-password` → use reset token → `reset-password` → login with new pw | — | Old pw rejected; new pw works |
| AUTH-INT-005 | OTP verify + resend | P1 | user pending verification | `verify-otp` wrong code (reject) → `resend-otp` → correct code | — | Wrong code rejected; correct verifies |
| AUTH-INT-006 | Logout invalidates session | P0 | logged-in user, enforcement ON | `logout` then reuse token | — | Subsequent protected call 401 |
| AUTH-SEC-006 | Impossible-travel / anomaly escalation | P2 | `AUTH_SUSPICIOUS_IMPOSSIBLE_KMH` set | Two logins from geo-distant IPs within short window | — | Escalation policy applied per `AUTH_SUSPICIOUS_ESCALATION_POLICY` (challenge/lock) |
| AUTH-E2E-001 | Login → use app → suspended mid-session | P0 | staging | Login as `qa-user-a`; admin suspends; user retries an action | — | Next request 403 `account restricted` |

## 4. Security & abuse cases

- **Token replay across users:** `qa-user-a` token must never resolve to `qa-user-b`'s data
  (covered by IDOR cases in each module; the id comes from Supabase, not the request body).
- **No local-verify bypass:** confirm that tampering with a JWT's claims (client-side) does not
  grant access — Supabase must reject it (AUTH-UNIT-003 variant with edited claims).
- **Header injection:** `user_id`/`user_email` must come only from the resolved token, never
  from a client-supplied `user_id` body/query param. Add a case per money module: pass a
  spoofed `user_id` in the body and assert the server uses the token identity.

## 5. Automated specs to add

- `backend/internal/middleware/auth_status_test.go` — table-driven: each `user_status` →
  expected status/error, using a fake `RBACService.GetUserStatus`. (gap)
- `backend/internal/middleware/auth_bearer_test.go` — header parsing table (missing/malformed/
  valid) with a fake `SupabaseRestClient`. (gap)
- `frontend-web/tests/unit/auth/login-lockout.spec.ts` — lockout threshold + reset. (gap)
- Playwright `mobile-app/reactnative/tests/e2e/auth/suspended-mid-session.spec.ts` for
  AUTH-E2E-001 via `page.route` mocking Supabase user + status. (gap G4)

## 6. Coverage target & exit criteria

Pure-logic auth middleware ≥ 85%. Exit: AUTH-*-00x P0 cases all green on backend + web;
suspended/locked/deleted 403 proven; session fail-closed proven; spoofed-`user_id` rejected on
at least the wallet + transfers modules.
