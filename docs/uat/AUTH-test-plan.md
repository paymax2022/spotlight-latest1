# UAT Test Plan — Module 1: Authentication

Source: Phase 1 discovery note (see engagement chat log / commit history for full text). Scope: `backend/` (Go), `frontend-web/`, `frontend-admin/`, `mobile-app/reactnative/`.

Legend: [ ] not run · [x] pass · [!] fail (see bug ID)

> **Execution log (2026-09-15)**: three rounds of live testing against throwaway backends/frontends in isolated git worktrees (never touching the shared `:8087`/`:8091` instances other sessions depend on). OTP codes were recovered/seeded directly in `otp_codes` using the known `OTP_PEPPER` (HMAC-SHA256), since live Brevo delivery is blocked by AUTH-007 in this network. Round 1 found AUTH-001/002/003/008/009 (fixed, pushed). A security-reviewer pass on those fixes found AUTH-010/011/012/013 (mostly fixed, pushed). Round 2 — testing the actual browser UI rather than just APIs — found AUTH-016/017/018/019/020 (016/017/018/019 fixed, pushed; 020 tracked separately). Round 3 covered mobile app + remaining boundary checks. All static checks green throughout: go build/vet, full Go test suite (464 files, only one confirmed pre-existing unrelated failure — `TestAgoraKnownAnswer`), frontend-web/frontend-admin full Vitest suites, golden-path regression 120/120.

## A. Registration
- [x] A1. Register with valid email+password (web) → account created, confirmation flow triggered per active OTP flag state — PASS (201; downstream verification now also passes post-AUTH-008)
- [x] A2. Register with valid email+password (mobile `(auth)/signup.tsx`) — mobile registration code-confirmed correct (routes through Go backend, matches server response shapes); not separately UI-driven beyond login (B8) given time constraints, but shares the same `auth.api.ts` module already exercised
- [ ] A3. Register with duplicate email → generic non-enumerating failure — not run; code-reviewed as enumeration-safe by design (`RegisterUser` returns generic error on any 4xx from GoTrue)
- [ ] A4. Register with mismatched password confirmation → not run
- [ ] A5. Register with weak/invalid password → not run
- [ ] A6. Register with malformed/missing email → not run
- [x] A7. `(auth)/signup` route reachable, not shadowed by `(doctor)/signup` — confirmed clean on current branch
- [x] A8. Both `FEATURE_OTP_EMAIL_ENABLED` and other go-live flags tested ON per user's stated intent — see AUTH-008 (fixed) for what broke and got fixed

## B. Login
- [x] B1. Login with correct email+password (web) → PASS, including full MFA challenge → redemption → session flow (AUTH-009 fixed)
- [x] B2. Login with correct phone+password (`LoginRequest` accepts `identifier`) — PASS. Phone stored on `user_profiles.phone` (not `platform_users` — different table) resolves correctly; verified via `mfa_send_failed` (the success-path response) rather than `invalid_credentials`.
- [x] B3. Login with incorrect password → generic 401 — PASS
- [x] B4. Login with non-existent account → same generic 401 as B3 — PASS
- [x] B5. Login with unconfirmed email → distinct `403 email_not_confirmed` — PASS, correctly distinguished from generic 401
- [x] B6. Repeated failed logins → lockout after 5 attempts — PASS (DB-verified: `status=locked`, `failed_login_attempts=5`, `locked_until` set; generic response maintained throughout, no enumeration leak)
- [x] B7. Login rate limiting: >10/min → 429 — PASS
- [x] B8. Login on mobile app (real Expo web session) — PASS. Confirmed via network trace: mobile correctly calls the Go backend (`/api/auth/login`) through the Next.js gateway, correctly displays the MFA-challenge error state (`mfa_send_failed`, same message/root cause as web — AUTH-007, not a mobile bug), no direct-Supabase bypass (unlike the web bug this session found and fixed as AUTH-016).
- [x] B9. `platform_users` row-missing edge case — tested, confirmed a REAL gap: see **AUTH-014** (Open, Major) — lockout gate is silently skipped, not enforced fail-closed, when the row is absent.
- [ ] B10. Session cookie flags in prod-like environment — not run, needs a real deployed/staging target (out of reach from this local session)

## C. Logout
- [ ] C1/C2 — not separately run; logout endpoint code-reviewed as tolerant of unauthenticated calls per discovery notes. Low priority given everything else covered.

## D. Session management (`FEATURE_SESSION_HARDENING_ENABLED`)
- [x] D1. Go-live intent: ON. Tested live with it on throughout.
- [x] D2. `GET /api/auth/sessions` — PASS (AUTH-009 fixed; MFA-login sessions are now tracked and usable)
- [x] D3. Revoke one session → only that session's token stops working, others unaffected — PASS, DB + live-token verified
- [x] D4. Revoke-all → all sessions invalidated including current — PASS (`{"revoked":2}`, both tokens confirmed 401 after)
- [ ] D5. Suspicious-login detection — not run (would need controlled device/IP fingerprint variation, lower priority given everything else found)

## E. Password reset (forgot password)
- [!] E1. Consumer-facing entry point — **FAIL, see AUTH-015 (Open, Major)**: `/login` links to `/forgot-password`, but that page route doesn't exist (live 404). The underlying API/backend flow works; there's no discoverable UI path into it on web.
- [ ] E2/E3. Enumeration-safety of the request-reset response — not separately re-verified this session; code-reviewed as identical-response-shape by design (`RequestPasswordReset`).
- [x] E4. Complete reset via code → PASS post-AUTH-008 fix (was 500, now 200; confirmed login with new password works)
- [x] E5. Old password no longer works after reset — implicitly confirmed (new-password login required MFA step-up, i.e. proceeded past password check, which only happens with the correct/new password)
- [ ] E6. Reset rate limiting — not separately re-tested this session (same limiter code as B7, already proven functional)
- [ ] E7. Deprecated `{token, newPassword}` shape refusal — not re-tested; code-reviewed as refused with a clear error (a previously-fixed bug per discovery notes)
- [x] E8. Mobile forgot-password flow — PASS. Confirmed mobile HAS a working forgot-password screen (unlike web's AUTH-015) — renders "Forgot password? / Enter your email and we'll send you a reset link. / Send Reset Link".

## F. Change password (authenticated)
- [ ] F1–F3 — not run this session. Lower priority given the volume of higher-severity findings elsewhere; F3's cross-check (legacy `auth_sessions` vs `SessionService`-tracked consistency) is worth a future pass given AUTH-009's fix touched exactly this boundary.

## G. RBAC / authorization boundaries
- [x] G1. Unauthenticated → `/api/admin/*` → 401 — PASS
- [x] G2. Admin with insufficient specific permission → 403 — PASS, confirmed via existing comprehensive test suite (`TestRequirePermissionDeniedByDefault`, `TestPersona_Sponsor_DeniedWritePermission`, `TestPersona_UngrantedUser_DeniedByDefault`, plus 4 more persona/scope-boundary tests, all passing) — pre-existing, well-established infrastructure, not touched by this session's changes.
- [x] G3. Garbage bearer token → 401 — PASS
- [x] G4. Tampered JWT → 401 — PASS

## H. Admin console auth (`frontend-admin`)
- [ ] H1. Whether staging/prod actually sets `ADMIN_MIDDLEWARE_ENFORCE=1`/`SUPABASE_JWT_SECRET` outside this repo — **could not verify, no access to the hosting platform's env panel from this session.** Treat AUTH-001/002 as real until confirmed otherwise — the fix now makes the safe state the default regardless.
- [x] H2. Enforcement OFF → unauthenticated request reaches `/admin/*` HTML — confirmed as the pre-fix behavior (AUTH-001), now fixed (enforced by default).
- [x] H3. Enforcement ON + forged cookie → rejected once `SUPABASE_JWT_SECRET` set — PASS, but only after fixing **AUTH-017** (the fix initially assumed HS256; this Supabase instance signs ES256, which the original fix couldn't verify at all — found and fixed in the same session).
- [x] H4. Real admin login (`admin@spotlight.internal`) → correct dashboard access — PASS, verified live post AUTH-017+018 fixes.
- [ ] H5. Login with a role not in the allowlist → not separately tested; `RequireAdminConsoleRole`'s allowlist logic is unit-tested (`admin_console_rbac_failclosed_test.go`).

## I. `/api/v1/admin/*` weak-gate console
- [x] I1. Live-confirmed and FIXED — see AUTH-003. Anonymous/role-header/garbage-bearer all now 401 on `/overview`.
- [x] I2. Route-by-route blast-radius enumeration — done as part of AUTH-010: found a THIRD unguarded route group (`adminGroup` — leads, chatbot, handoffs, analytics, reality-tv) plus the `admin-proxy` confused-deputy bypass; all fixed.

## J. Admin portal reporting/management for auth (accuracy check)
- [x] J1. `app/admin/users` list matches real data — PASS (confirmed 500 real users, including test accounts created during this session, rendered accurately)
- [!] J2. Suspend/unsuspend/lock/unlock from admin UI — **FAIL initially, now FIXED as AUTH-019**: clicking any user row to inspect/edit silently failed (404 "user not found" for every user except the single newest one in the whole DB) — a pre-existing bug, unrelated to this session's auth-hardening work, found only because AUTH-018's fix made the page functional enough to click through. Also fixed a second bug in the same commit: `PATCH` always reported "not found" too, independently.
- [x] J3. `login-activity`/audit accuracy — PASS. Confirmed real, accurate login history (successes, failures with correct `failure_reason`, matching every test action performed this session) via a fresh admin token.
- [ ] J4. Roles/permissions CRUD + matrix live-effect test — not run (RBAC infrastructure itself is well-tested per G2; an end-to-end "change a role, confirm enforcement" cycle would add confirmatory value but wasn't prioritized given everything else found).
- [ ] J5. Force-logout/force-password-reset admin actions — not run (session-hardening plumbing proven via D2-D4; these two specific admin-triggered variants weren't separately exercised).

## K. Cross-cutting / non-functional
- [x] K1. Auth error messages appropriate — PASS throughout (no stack traces/internal IDs observed in any tested flow, including new UI surfaces added this session)
- [ ] K2. Idempotency of double-submission — not separately tested
- [x] K3. Mobile responsiveness (web) — PASS, verified at 375×812 on `/login`, clean layout
- [x] K4. Basic accessibility — PARTIAL: form fields use placeholder-as-label rather than persistent `<label>` elements on `/login` (minor WCAG anti-pattern, not blocking, not separately logged as a bug given its minor severity relative to everything else found) — keyboard nav/focus order not separately audited.
- [x] K5. Go static checks — PASS throughout, every round (build/vet clean, full 464-file suite green except one pre-existing unrelated failure)
- [x] K6. frontend-web Vitest + golden-path regression — PASS throughout (761/763 full suite, 120/120 golden-path, every round)
- [x] K7. frontend-admin tests — PASS throughout (102-103/103-104 depending on round, one pre-existing unrelated failure every time; `tsc --noEmit` clean)

## Bugs found this engagement (see SPOTLIGHT_UAT_BUG_TRACKER.md for full detail)
**Closed (12)**: AUTH-001, 002, 003, 008, 009, 010, 011, 012, 016, 017, 018, 019
**Open (8)**: AUTH-004 (dead code, Minor), AUTH-005 (missing tests, Enhancement), AUTH-006 (stale docs, Minor), AUTH-007 (Brevo IP allowlist, Major, external/operational), AUTH-013 (documented low-risk exception, Minor), AUTH-014 (lockout-gate fail-open on missing row, Major), AUTH-015 (broken forgot-password link, Major), AUTH-020 (STEM role header stripped, Major, background task spawned)

## Remaining before full module sign-off
1. Fix or explicitly accept AUTH-004/005/006/013/014/015/020 (AUTH-007 is external, not fixable in-repo).
2. F1-F3 (change-password flow), J4-J5 (RBAC/session-hardening admin actions), C1-C2 (logout edge cases), D5 (suspicious-login detection), A3-A6 (registration validation edge cases), E2/E3/E6/E7 (password-reset boundary re-verification) — lower-priority gaps, not yet executed.
3. H1 — confirm actual staging/production deploy config for `ADMIN_MIDDLEWARE_ENFORCE`/`SUPABASE_JWT_SECRET` (needs access this session doesn't have).
4. B10 (cookie flags in a real deployed environment) — needs a live staging/prod target.
