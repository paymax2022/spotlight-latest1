# Module: Academy Content (CMS)

**Risk tier:** 2 &nbsp;·&nbsp; **Money-path:** no &nbsp;·&nbsp; **Feature flag:** `FEATURE_ACADEMY_SPINE_ENABLED` (`FlagSpine` = `academy.spine`; registered only inside `if spineEnabled`)
**Code:** `backend/internal/academy/content/` — `handler.go`, `service.go`, `model.go`, `statemachine.go`, `repository.go`, `content_test.go`; wiring in `backend/internal/app/academy_routes.go` (`RegisterAcademyContent`).
**Slug:** `CONTENT`

## 1. Overview & scope

Content management for the curriculum spine: two guarded lifecycles live here — the **publish
lifecycle** for lessons and content bundles (`draft → review → approved → live → archived`) and the
**production pipeline** board (`script → storyboard → shoot → edit → qa → publish`), plus content
localizations. Learners read only **live** content; all authoring/transition routes are admin-gated
by `academy.content`. No money path. `approved → live` re-packages the offline bundle manifest; `live
→ archived` retains immutable history. The transition tables are pure (`statemachine.go`), so the
guard logic is unit-testable without a DB.

Applicable cross-cutting: `../cross-cutting/authentication.md`,
`../cross-cutting/rbac-and-permissions.md` (admin group `academy.content`),
`../cross-cutting/feature-flags-and-audit.md` (spine flag-off + audit on transitions).

## 2. Services / endpoints in scope

Member base `/api/finance/academy`; admin base `/api/academy/admin`; admin group `/content` guarded
`RequirePermission("academy.content")`.

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Live lessons for objective | `GET /content/lessons/:objectiveId` | auth (member) | no |
| Live bundles / manifest | `GET /content/bundles`, `GET /content/bundles/:id/manifest` | auth | no |
| Admin list items (all statuses) | `GET /content/items` | `academy.content` | no |
| Transition lesson | `POST /content/lessons/:id/publish` | `academy.content` | no |
| Transition bundle | `POST /content/bundles/:id/publish` | `academy.content` | no |
| Production board list/create/get | `GET/POST /content/productions`, `GET /content/productions/:id` | `academy.content` | no |
| Update production | `PUT /content/productions/:id` | `academy.content` | no |
| Advance / block production | `POST /content/productions/:id/advance`, `POST /content/productions/:id/block` | `academy.content` | no |
| Localizations list/upsert/delete | `GET/POST/DELETE /content/localizations` | `academy.content` | no |

Enums: `PublishStatus` = draft|review|approved|live|archived; `ProductionStage` =
script|storyboard|shoot|edit|qa|publish; `ProductionStatus` = active|done|blocked. Transition
request body carries `to` (target state/stage).

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage | Status |
|---|---|---|---|
| Publish lifecycle legal/illegal transitions | unit/fsm | `content_test.go::TestCanPublish` | AUTOMATED |
| approved→live repackages manifest | unit/fsm | `content_test.go::TestRepackagesManifest` | AUTOMATED |
| Production pipeline single-step forward/back | unit/fsm | `content_test.go::TestCanStage` | AUTOMATED |
| Learner sees live-only | integration | — | TODO |
| Admin transition authz + audit | integration/authz | — | TODO |
| Illegal transition rejected + audited (service) | integration | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `CONTENT-INT-001` | Learner reads only live lessons | P1 | lessons in draft, live, archived | `GET /content/lessons/:objectiveId` | — | Only `live` lessons returned; draft/archived hidden |
| `CONTENT-INT-002` | Bundle manifest available for live bundle | P1 | live bundle | `GET /content/bundles/:id/manifest` | — | Manifest returned (re-packaged at approved→live) |
| `CONTENT-INT-003` | Admin lists all statuses | P2 | mixed-status lessons | `GET /content/items` | — | All statuses returned (admin CMS view) |
| `CONTENT-INT-004` | Publish transition draft→review | P1 | lesson `draft`; caller holds `academy.content` | `POST /content/lessons/:id/publish {to:"review"}` | — | Status `review`; audit written |
| `CONTENT-INT-005` | Approve→live re-packages bundle | P1 | bundle `approved` | `POST /content/bundles/:id/publish {to:"live"}` | — | Status `live`; manifest re-packaged |
| `CONTENT-INT-006` | Production advances one stage | P2 | production at `script` | `POST /content/productions/:id/advance {to:"storyboard"}` | — | Stage `storyboard` |
| `CONTENT-INT-007` | Block an active production | P2 | production `active` | `POST /content/productions/:id/block` | — | Status `blocked` |
| `CONTENT-VAL-001` | Unknown target status rejected | P1 | lesson `draft` | `POST .../publish {to:"published"}` | invalid enum | 400 / rejected (not a known status) |
| `CONTENT-VAL-002` | Missing `to` rejected | P2 | — | `POST .../publish {}` | — | 400 `invalid_body` |
| `CONTENT-AUTHZ-001` | Transition denied without permission | P0 | caller lacks `academy.content` | `POST /content/lessons/:id/publish` | — | 403 `forbidden` (RBAC-AUTHZ-001) |
| `CONTENT-AUTHZ-002` | Transition allowed for holder | P1 | caller holds `academy.content` | same | — | 200; transition applied |
| `CONTENT-SEC-001` | Illegal publish transition rejected + audited | P1 | lesson `draft` | `POST .../publish {to:"live"}` (skip) | — | Rejected (draft→live not in table); illegal transition audited |
| `CONTENT-SEC-002` | Archived is terminal | P1 | lesson `archived` | `POST .../publish {to:"live"}` | — | Rejected; archived has no legal targets |
| `CONTENT-SEC-003` | Production stage skip rejected | P2 | production `script` | advance `{to:"shoot"}` | skip | Rejected (only ±1 step legal) |
| `CONTENT-SEC-004` | Spine flag-off route inaccessible | P0 | `FEATURE_ACADEMY_SPINE_ENABLED` off | Call any content endpoint | — | Routes not mounted / 404 — never 500 (FLAG-SEC-001) |

## 5. State-machine transitions

**Publish lifecycle** (`publishTransitions`, `canPublish` — no-op self-transition rejected):

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| draft | submit | review | — | `CONTENT-FSM-001` |
| review | approve | approved | — | `CONTENT-FSM-002` |
| review | bounce back | draft | — | `CONTENT-FSM-003` |
| approved | go live | live | re-package bundle manifest | `CONTENT-FSM-004` |
| approved | kick back | review | — | `CONTENT-FSM-005` |
| draft / review / approved / live | archive | archived (terminal) | retains immutable history | `CONTENT-FSM-006` |

**Production pipeline** (`canStage`): exactly one step forward or one step back across
`script→storyboard→shoot→edit→qa→publish`; no skips, no self-loops. Block: only an `active` card can
be `blocked` (`canBlock`); `done` terminal. Case IDs `CONTENT-FSM-007` (stage), `CONTENT-FSM-008`
(block).

Illegal transitions asserted rejected (`TestCanPublish`, `TestCanStage`): skips (`draft→live`,
stage jumps), re-entering `archived`, self-transitions, unknown states.

## 6. Security & abuse cases

- **Authz:** all authoring/transition routes require `academy.content`; deny-by-default + fail-closed
  per `rbac-and-permissions.md` (RBAC-AUTHZ-001/004).
- **Learner exposure:** member routes must return `live` content only — draft/review/approved/archived
  must never leak (`CONTENT-INT-001`).
- **Illegal transitions** rejected AND audited (never a silent no-op) — `CONTENT-SEC-001/002/003`.
- **Flag-off:** spine-gated; disabled → routes absent (`CONTENT-SEC-004`).

## 7. Automated specs to add

- `content/service_transition_test.go` — service-level: legal transition applies + audits; illegal
  transition returns error + writes an audit row; approved→live triggers manifest repackage. TODO.
- `content/live_visibility_test.go` — learner endpoints return live-only across a mixed-status
  fixture. TODO.
- `content/authz_test.go` — transition denied without `academy.content`, allowed with. TODO.

## 8. Coverage target & exit criteria

Pure-logic `statemachine.go` already covered by `content_test.go`. Exit: publish + production FSM
legal/illegal proven at service layer with audit; learner live-only visibility proven; admin authz
green; spine flag-off inaccessible.
