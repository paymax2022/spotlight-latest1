# Spotlight Auth + RBAC Release Readiness Checklist

Last updated: 2026-05-28

## Status Legend
- [x] Done
- [~] Partial
- [ ] Pending

## 1) Security-Critical (Do First)
- [x] Deny-by-default backend permission middleware in place
- [x] Scoped RBAC support (global/program/contest/state/school/cohort/season)
- [x] Last Super Admin removal protection
- [x] System role deletion protection
- [x] System permission deletion/update protection
- [x] Critical-permission assignment restricted to super-admin
- [x] Audit logs for sensitive RBAC actions
- [x] Login activity + security events endpoints
- [~] Full suspicious-activity response playbook (notify user, revoke sessions, forced reset)
- [~] Full refresh-token/session revocation lifecycle hardening

## 2) API Completion
- [x] Auth core endpoints available
- [x] Role endpoints (list/create/update/clone/delete)
- [x] Permission endpoints (list/create/update/delete + matrix)
- [x] User-role assignment/removal endpoints
- [x] User status endpoints (suspend/unsuspend/lock/unlock)
- [x] Audit/log activity/security/export endpoints with filters
- [~] Full endpoint parity from long-form spec across every domain module

## 3) Frontend Admin Completion
- [x] Route guard + permission-based sidebar visibility
- [x] Users management page
- [x] Roles management page
- [x] Permissions management page
- [x] Permission matrix page (+ bulk actions)
- [x] Audit logs / login activity / security events pages
- [x] RBAC settings landing page
- [~] Rich UX polish: pagination/sorting/advanced filter chips/toasts at scale
- [ ] Frontend test coverage for critical admin flows

## 4) Testing & QA
- [x] Backend unit tests passing (`go test ./...`)
- [x] Handler tests for permission endpoint validation + success paths
- [~] Integration tests for all scenario personas (contest manager, judge, sponsor, school rep, etc.)
- [ ] End-to-end browser tests for admin RBAC operations
- [ ] Load tests on permission matrix and audit queries

## 5) Ops & Production Hardening
- [x] Idempotent RBAC seed script
- [~] Environment variable docs (core done; final production matrix pending)
- [ ] Observability dashboard + alerts for authz failures/security spikes
- [ ] Incident rollback/runbook docs

## Priority Execution Plan
1. Implement suspicious-login response and session-revocation hardening (high risk reduction).
2. Add integration tests for scenario matrix from acceptance criteria (high confidence gain).
3. Add admin frontend pagination/sorting and standardized operation toasts (operator reliability).
4. Add observability + alerts for security events and permission-denied spikes.

## Estimated Remaining Effort
- Security hardening: 1.5 to 2.5 days
- Scenario integration testing: 2 to 3 days
- Frontend polish + QA: 1.5 to 2 days
- Observability/runbooks: 1 day

Total: ~6 to 8.5 engineering days for production-ready sign-off.
