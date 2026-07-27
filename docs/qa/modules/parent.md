# Module: Academy Parent (Guardian Gate & Controls)

**Risk tier:** 2 &nbsp;·&nbsp; **Money-path:** no (approves commerce purchases; no ledger move here) &nbsp;·&nbsp; **Feature flag:** `FEATURE_ACADEMY_SPINE_ENABLED` (`FlagSpine` = `academy.spine`; registered inside `if spineEnabled`)
**Code:** `backend/internal/academy/parent/` — `gate.go`, `handler.go`, `service.go`, `model.go`, `repository.go`, `parent_test.go`; wiring in `backend/internal/app/academy_routes.go` (`RegisterAcademyParent`).
**Slug:** `PARENT`

## 1. Overview & scope

Guardian-facing layer: child dashboards, per-subject mastery, parental controls (screen time / allowed
hours / content age), progress reports, and **purchase approvals** (the decision half of the commerce
child-safety gate). Every guardian endpoint touching a minor's data is gated **fail-closed** by an
active guardian link (`requireActiveLink` → `canActOnMinor` in `gate.go`): denial is audited
(`parent.access_denied`) and returns 403. Approval decisions additionally enforce ownership AND
re-verify the active link to the minor on the approval row (not trusted from the row). Admin routes
manage notification templates, gated `academy.notifications`. No money moves here — approving a purchase
lets the minor retry in commerce.

Applicable cross-cutting: `../cross-cutting/authentication.md`,
`../cross-cutting/rbac-and-permissions.md` (admin `academy.notifications`; object-level guardian gate),
`../cross-cutting/feature-flags-and-audit.md` (spine flag-off; denial audit).

## 2. Services / endpoints in scope

Member base `/api/finance/academy/parent`; admin group `/notification-templates` (base
`/api/academy/admin`) guarded `RequirePermission("academy.notifications")`.

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| List children | `GET /parent/children` | member; active-link gate | no |
| Child dashboard | `GET /parent/children/:minorId/dashboard` | active-link gate | no |
| Child subject detail | `GET /parent/children/:minorId/subjects/:subjectId` | active-link gate | no |
| Upsert controls | `PUT /parent/children/:minorId/controls` | active-link gate | no |
| List / generate reports | `GET /parent/children/:minorId/reports`, `POST /parent/reports/generate` | active-link gate | no |
| List pending approvals | `GET /parent/approvals` | active-link gate | no |
| Decide approval | `POST /parent/approvals/:id/decide` | active-link gate + ownership | no (unblocks commerce) |
| Template list/upsert/get/delete | `GET/POST/PUT /notification-templates`, `GET/DELETE /:key` | `academy.notifications` | no |

Enums: `ApprovalState` = pending|approved|rejected; channel push|sms|in_app|email. `ParentControls`
(ScreenTimeMinutes 0=unlimited, AllowedHours, ContentMaxAge).

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage | Status |
|---|---|---|---|
| Active-link gate fail-closed | unit/sec | `parent_test.go::TestCanActOnMinor_FailsClosed` | AUTOMATED |
| Approval decision normalization | unit | `parent_test.go::TestValidApprovalDecision` | AUTOMATED |
| Channel validity | unit | `parent_test.go::TestValidChannel` | AUTOMATED |
| Mastery aggregation by subject | unit | `parent_test.go::TestAggregateMasteryBySubject` | AUTOMATED |
| Report payload build | unit | `parent_test.go::TestBuildReportPayload` | AUTOMATED |
| Gate + denial audit against DB | integration | — | TODO |
| Approval ownership + re-verify link | integration/authz | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `PARENT-INT-001` | List children | P1 | guardian with active links | `GET /parent/children` | — | Own linked minors returned |
| `PARENT-INT-002` | Child dashboard aggregates mastery | P1 | active link | `GET /parent/children/:minorId/dashboard` | — | Per-subject mastery (mastered+exam_ready count, avg, ratio), readiness |
| `PARENT-INT-003` | Upsert controls | P2 | active link | `PUT /parent/children/:minorId/controls` | screen_time=60 | Controls saved |
| `PARENT-INT-004` | Generate report | P2 | active link | `POST /parent/reports/generate` | — | Report payload built (readiness omitted when nil) |
| `PARENT-INT-005` | Approve a pending purchase | P0 | pending approval owned by guardian, active link | `POST /parent/approvals/:id/decide {decision:"approve"}` | — | Approval `pending→approved`; minor may retry commerce pay |
| `PARENT-VAL-001` | Invalid decision rejected | P1 | pending approval | decide `{decision:"maybe"}` | invalid | Rejected (`validApprovalDecision`) |
| `PARENT-VAL-002` | Invalid channel rejected | P2 | holder | template upsert `channel:"whatsapp"` | invalid | Rejected (`validChannel`) |
| `PARENT-AUTHZ-001` | No active link → 403 (fail-closed) | P0 | guardian with no/ revoked link to minor | `GET /parent/children/:minorId/dashboard` | — | 403 `forbidden`; `parent.access_denied` audited (`no_active_guardian_link`) |
| `PARENT-AUTHZ-002` | Decide someone else's approval (IDOR) | P0 | approval owned by guardian A | guardian B decides it | A's approval id | 403 `not_owner` audited; B cannot decide |
| `PARENT-AUTHZ-003` | Decide re-verifies link to the minor | P0 | approval owned but link to minor revoked | decide | — | 403 (active link re-checked, not trusted from the row) |
| `PARENT-AUTHZ-004` | Template mgmt denied without permission | P0 | caller lacks `academy.notifications` | `POST /notification-templates` | — | 403 `forbidden` |
| `PARENT-SEC-001` | Cross-guardian data isolation | P0 | guardian A links minor M | guardian B `GET /parent/children/M/...` | M | 403; B never sees A's minor's data |
| `PARENT-SEC-002` | Spine flag-off route inaccessible | P0 | `FEATURE_ACADEMY_SPINE_ENABLED` off | Call any parent endpoint | — | Not mounted / 404 — never 500 (FLAG-SEC-001) |

## 5. State-machine transitions

Purchase approval is a simple guarded decision (no dedicated `statemachine.go`):

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| pending | approve | approved | commerce purchase unblocked for the minor | `PARENT-FSM-001` |
| pending | reject | rejected | purchase stays blocked | `PARENT-FSM-002` |

Decision normalized via `validApprovalDecision` (approve→approved, reject→rejected, else invalid).

## 6. Security & abuse cases

- **Fail-closed guardian gate:** `requireActiveLink` runs before ANY minor-data op; denial is audited
  and returns 403 (`PARENT-AUTHZ-001`, `PARENT-SEC-001`). This is the object-level/IDOR baseline for the
  whole module (RBAC-AUTHZ-007).
- **Approval ownership + re-verify:** decide enforces guardian == row owner AND re-checks the active
  link to the minor (not trusted from the row) — `PARENT-AUTHZ-002/003`.
- **Admin authz:** notification templates gated `academy.notifications`.
- **Flag-off:** spine gate (`PARENT-SEC-002`).

## 7. Automated specs to add

- `parent/live_db_gate_test.go` — active-link gate allows/denies against DB; denial writes one
  `parent.access_denied` audit event. TODO.
- `parent/approval_ownership_test.go` — decide rejects non-owner and revoked-link cases; approve
  unblocks commerce. TODO.

## 8. Coverage target & exit criteria

Pure gate + aggregation + report logic covered by `parent_test.go`. Exit: guardian gate fail-closed +
audited proven against DB; approval ownership + link re-verify green; cross-guardian isolation proven;
admin authz green; spine flag-off inaccessible.
