# Audit Coverage Matrix (#23)

_Last updated: 2026-06-23_

Tracks structured audit-event coverage for every sensitive mutation
(create / update / delete / state-transition / approve / settle) across domain
module paths. "Audited via `audit_service`" means the handler/service edge calls
`AuditService.LogAction(actor, target, action, module, resourceType, resourceId,
old, new, ip, ua, severity)` and the event lands in `public.audit_logs`.

Brownfield rule honoured: events are emitted from the **handler edge** (or an
adapter), never by modifying protected legacy Spotlight module internals.

## Status legend
- ✅ audited via `audit_service`
- 🟦 audited via module-native immutable trail (ledger / kyc_events / module audit feed)
- ⬚ read-only (no mutation — audit not required)

## RBAC / Admin user (already covered, verified)

| Path / action | Audit | Severity |
| --- | --- | --- |
| role create/update/clone/delete | ✅ `role.*` | high/critical |
| permission create/update/delete | ✅ `permission.*` | high/critical |
| role↔permission assign/remove (+ **bulk**) | ✅ `role.permission.*` | high |
| user role assign/remove (+ **bulk**) | ✅ `user.role.*` | high/critical |
| user suspend/unsuspend/lock/unlock | ✅ `user.*` | high |
| admin user update | ✅ `user.update` | high |
| **admin user export** (new) | ✅ `user.export` | high |
| **per-user session view** (new) | ✅ `user.sessions.view` | info |
| session revoke / revoke-all / force-logout / force-reset (#19) | ✅ `session.*` | high/critical |
| suspicious-login detection / escalation (#19) | ✅ `session.suspicious_*` | high/critical |

## STEM (newly instrumented — #23)

| Path / action | Audit (before → after) | Action slug | Severity |
| --- | --- | --- | --- |
| `POST /schools` create school | ⬚→✅ | `stem.school.create` | medium |
| `PATCH /schools/:id/verification` (state transition) | ⬚→✅ | `stem.school.verification` | high |
| `POST /stem-contests` create contest | ⬚→✅ | `stem.contest.create` | high |
| `PATCH /stem-submissions/:id/status` (state transition) | ⬚→✅ | `stem.submission.status` | high |
| `POST /stem-judging/scores` upsert score | ⬚→✅ | `stem.judging.score.upsert` | high |
| `PATCH /stem-judging/scores/:id/review-state` (lock/transition) | ⬚→✅ | `stem.judging.score.review_state` | high |
| `POST /stem-judging/assignments` create assignment | ⬚→✅ | `stem.judging.assignment.create` | high |
| `PATCH /stem-judging/assignments/:id/conflict` (transition) | ⬚→✅ | `stem.judging.assignment.conflict` | high |
| `POST /stem-awards/certificates` (award) | ⬚→✅ | `stem.award.certificate.create` | high |
| `POST /stem-awards/badge-awards` (grant) | ⬚→✅ | `stem.award.badge.grant` | high |
| `POST /stem-voting/transactions` (money-adjacent) | ⬚→✅ | `stem.voting.transaction.create` | high |

Lower-risk STEM creates (school profiles/teams, emerging innovators/teams/projects,
rubrics, vote packages/rules, bootcamp cohorts/tasks/scores, sponsors, badges)
remain read-trail only; they can be added to the same `emitAudit` edge if a
compliance requirement emerges (the hook is already in place on the handler).

## Contest (newly instrumented — #23)

| Path / action | Audit (before → after) | Action slug | Severity |
| --- | --- | --- | --- |
| `POST /api/v1/admin/competitions/open-mic` create open-mic | ⬚→✅ | `contest.openmic.create` | high |

## Payment / money flows

The money path uses an **append-only double-entry ledger** plus module-native
immutable trails as the primary source of truth (per the Iron Rules — balances
are projections of the ledger, entries are immutable). These satisfy the
"what happened / who did it" requirement without a parallel `audit_service` write:

| Module path | Trail | Status |
| --- | --- | --- |
| Ledger entries (all money movement) | `public.ledger_entries` (immutable, balanced) | 🟦 |
| KYC tier transitions | `public.kyc_events` | 🟦 |
| Tier-limit decisions | `public.tier_limit_events` | 🟦 |
| Transfers / wallet debit | ledger entries + idempotency keys | 🟦 |
| Disputes resolve / settlement | module service trail | 🟦 |
| Transport admin mutations | module audit feed (`/admin/transport/audit`) | 🟦 |
| Session / auth (#19) | `audit_service` + `security_events` | ✅ |

### Follow-ups (payment edge → audit_service)
For unified compliance export, the money-path **administrative** decisions
(refund approval `payments.refund`, dispute resolution, manual settlement) should
additionally emit an `audit_service` event from the handler edge so they appear
in the single admin audit-log export alongside RBAC/STEM/contest events. This is
a forward-looking enhancement; the ledger/event trails already make these actions
fully reconstructable today.

## Test coverage
- `internal/handlers/stem_audit_test.go` — table-driven: every instrumented STEM
  mutation emits the expected `(action, module, severity)` via a spy audit sink;
  nil-sink path is panic-safe.
- `internal/handlers/admin_users_parity_test.go` — bulk role assign success +
  audit emission, export audit, session-view feature-gate (503 deny-by-default),
  bulk validation 400.
- `internal/services/rbac_service_test.go` — bulk ops preserve the per-item
  critical-permission gate and skip empty ids.
- `internal/app/router_parity_check_test.go` — new static/param routes register
  without a Gin conflict panic.
