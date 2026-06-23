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
  - `GET /api/auth/verify-email`
  - `POST /api/auth/resend-verification-link`
  - `POST /api/auth/change-password`
  - `POST /api/auth/complete-profile`
  - `POST /api/auth/request-password-reset`
  - `POST /api/auth/reset-password`
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

## Notes
- OTP is not implemented.
- Login now enforces account status checks (`active/pending/suspended/locked/deleted`), tracks failed attempts, and auto-locks after configurable threshold.
- Successful login resets failed-attempt counters and updates `last_login_at`.
- Refresh tokens are hashed and written to `auth_sessions`.
- This phase establishes secure auth/RBAC foundation and backend enforcement.

## Release Tracking
- See `RELEASE_READINESS_CHECKLIST.md` at repository root for final gap-closure status and execution order.
