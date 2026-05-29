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
- Full auth/session hardening (refresh rotation/session revocation depth)
- Full audit coverage for every domain module path (STEM/contest/payment flows still mixed)
- Permission matrix bulk UX present; advanced conflict/warning UX pending

## Pending
- Full endpoint parity from original long-form spec across all admin user endpoints and specialized modules
- End-to-end frontend pages for every required auth state (suspended/locked/unauthorized variants for all portals)
- Comprehensive integration tests for all listed scenarios (contest manager/state coordinator/judge/sponsor/school rep full journey)
- Production-grade notification flows for suspicious login/security events
- Broader rate-limit and abuse detection policy verification across all auth/admin endpoints

## Validation Snapshot
- Backend tests: passing (`go test ./...`)
- Frontend build: not validated in current environment (`next` binary missing)
