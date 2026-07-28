# Spotlight Auth + RBAC Acceptance Tracker

Last updated: 2026-05-27

## Implemented
- User auth API foundation: register/login/logout/me/reset/request-reset/verify-email/resend/change-password/complete-profile
- OTP excluded completely
- Enterprise RBAC schema tables and scoped access functions
- Role CRUD: list/create/update/clone/delete (system-role delete/update protection)
- Permission CRUD: list/create/update/delete (system-permission delete/update protection)
- Role-permission assignment/removal
- User-role assignment/removal with last-super-admin protection
- User status controls: suspend/unsuspend/lock/unlock
- Audit + login activity + security events APIs with filter support
- Audit export endpoint
- Backend auth middleware and permission middleware
- Scoped user access enforcement in admin users endpoints (state/program/contest/school)
- Seed script and idempotent role/permission seeds
- Frontend admin pages: Users, Roles, Permissions, Permission Matrix, Audit Logs, Login Activity, Security Events, RBAC Settings
- Frontend route guard + sidebar permission gating

## Partially Implemented
- Permission matrix bulk UX present; advanced conflict/warning UX pending

## Implemented (#23 backend remainder)
- Admin user / RBAC endpoint parity: scoped list filters extended
  (program/contest/school/country), admin-user JSON export, read-only per-user
  session/security view (composes #19 surface, feature-gated), bulk role assign
  (one→many and many→one users), bulk permission→role assign. All deny-by-default
  permission-gated and audited; reflected in contracts/openapi.yaml (AdminUsers).
- Audit coverage for STEM sensitive mutations (school create/verification,
  contest create, submission status, judging score upsert/review-state, judge
  assignment create/conflict, certificate, badge award, vote transaction) and
  contest open-mic create — emitted from the handler edge via the existing
  audit_service (no protected-module edits). Money-path retains its native
  immutable trails (ledger/kyc_events/tier_limit_events). Matrix:
  docs/audit/09-audit-coverage-matrix.md.

## Implemented (#19 session hardening)
- Refresh-token ROTATION with reuse-detection (replay of a rotated token revokes the
  whole session family) and rotation counter.
- Session revocation lifecycle: revoke-one (object-level authz), revoke-all,
  admin force-logout, admin force-password-reset; fail-closed middleware session check
  (RequireAuthContextWithSessions) rejects revoked/expired sessions 401.
- Suspicious-login detection on Login: new-device / new-IP / impossible-travel /
  failed-login-spike → security_events record + Resend notification + configurable
  escalation policy (notify | force_reverify | force_password_reset). All audited.
- Feature-flagged: FEATURE_SESSION_HARDENING_ENABLED (default OFF) → endpoints 503;
  flag-off preserves legacy session behaviour.

## Pending
- Full endpoint parity from original long-form spec across all admin user endpoints and specialized modules
- End-to-end frontend pages for every required auth state (suspended/locked/unauthorized variants for all portals)
- Comprehensive integration tests for all listed scenarios (contest manager/state coordinator/judge/sponsor/school rep full journey)
- Production-grade notification flows for suspicious login/security events
- Broader rate-limit and abuse detection policy verification across all auth/admin endpoints

## Validation Snapshot
- Backend tests: passing (`go test ./...`)
- Frontend build: not validated in current environment (`next` binary missing)
