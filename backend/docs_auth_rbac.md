# Spotlight Auth + RBAC (Phase 1)

## Implemented
- Enterprise RBAC schema migration:
  - users, profiles, roles, permissions, role_permissions, user_roles, user_permissions
  - sessions, email_verification_tokens, password_reset_tokens
  - audit_logs, login_activity
- Effective permission SQL functions:
  - `effective_permissions(user, scope_type, scope_id)`
  - `user_has_permission(user, permission, scope_type, scope_id)`
- Backend middleware:
  - `RequireAuthContext` (Bearer token + account status check)
  - `RequirePermission`
  - `RequireScopedPermission`
- Backend endpoints:
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `GET /api/auth/me`
  - `POST /api/auth/otp/request` (issues an emailed code — purpose `verify_email`, `login`, or `password_reset`; flag-gated, see below)
  - `POST /api/auth/otp/verify` (redeems a code; for `verify_email` confirms the GoTrue account, for `login` completes a step-up sign-in)
  - `POST /api/auth/change-password`
  - `POST /api/auth/complete-profile`
  - `POST /api/auth/request-password-reset`
  - `POST /api/auth/reset-password` (code-based only — takes `{email, code, newPassword}`)
  - `GET /api/auth/sessions` (session-hardening surface, flag-gated)
  - `DELETE /api/auth/sessions/:id`
  - `POST /api/auth/sessions/revoke-all`
  - `GET /api/admin/roles`
  - `POST /api/admin/roles`
  - `DELETE /api/admin/roles/:id`
  - `GET /api/admin/permissions`
  - `DELETE /api/admin/permissions/:permissionId`
  - `POST /api/admin/roles/:id/permissions`
  - `DELETE /api/admin/roles/:id/permissions/:permissionId`
  - `POST /api/admin/users/:id/roles`
  - `DELETE /api/admin/users/:id/roles/:roleId`
  - `PATCH /api/admin/users/:id/suspend`
  - `PATCH /api/admin/users/:id/unsuspend`
  - `PATCH /api/admin/users/:id/lock`
  - `PATCH /api/admin/users/:id/unlock`
  - `GET /api/admin/audit-logs`
  - `GET /api/admin/login-activity`
  - `GET /api/admin/security-events`
- Frontend admin updates:
  - permission utilities
  - permission guard component
  - permission-aware sidebar filtering

## Seed command
- Run idempotent seed:
```bash
./scripts/seed-rbac.sh
```

## New environment variables
- `SUPABASE_DB_URL` (for `scripts/seed-rbac.sh` only)
- `AUTH_MAX_FAILED_LOGIN_ATTEMPTS` (default `5`)
- `AUTH_ACCOUNT_LOCK_MINUTES` (default `30`)
- `FEATURE_OTP_EMAIL_ENABLED` (default `false`) — gates the Brevo/Postgres-backed OTP system (`/api/auth/otp/*`); when off, email verification falls back to GoTrue's own confirmation email
- `FEATURE_OTP_LOGIN_MFA_ENABLED` (default `false`) — requires `FEATURE_OTP_EMAIL_ENABLED`; turns a correct-password login into a second-factor code challenge
- `FEATURE_SESSION_HARDENING_ENABLED` (default `false`) — gates the `/api/auth/sessions*` surface and revocation enforcement

## Notes
- OTP **is** implemented (server-issued email codes for email verification, login MFA, and password reset — see `internal/otp/`), flag-gated as above. The deprecated `{token, newPassword}` reset shape (pre-OTP) is refused, not silently no-op'd.
- Login now enforces account status checks (`active/pending/suspended/locked/deleted`), tracks failed attempts, and auto-locks after configurable threshold.
- Successful login resets failed-attempt counters and updates `last_login_at`.
- Refresh tokens are hashed and written to `auth_sessions`.
- This phase establishes secure auth/RBAC foundation and backend enforcement.

## Release Tracking
- See `RELEASE_READINESS_CHECKLIST.md` at repository root for final gap-closure status and execution order.
