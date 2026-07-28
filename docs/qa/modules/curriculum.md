# Module: Academy Curriculum

**Risk tier:** 2 &nbsp;·&nbsp; **Money-path:** no &nbsp;·&nbsp; **Feature flag:** `FEATURE_ACADEMY_ENABLED` (registered unconditionally in `RegisterAcademy`; member base `/api/finance`, admin base `/api`)
**Code:** `backend/internal/academy/curriculum/` — `handler.go`, `service.go`, `model.go`, `repository.go`, `seed.go`, `curriculum_test.go`; wiring in `backend/internal/app/academy_routes.go` (`RegisterAcademyCurriculum`).
**Slug:** `CURRICULUM`

## 1. Overview & scope

Versioned curriculum spine: versions → classes → subjects → topics → objectives (plus streams,
trade-tracks, lessons). Member routes are open reads of the published spine; admin routes are
RBAC-gated by `academy.curriculum` and audited (actor from token). Golden rule: curriculum is
**versioned data** — handlers only read/administer rows in `academy_curriculum_versions` and child
tables, never hardcoded lists. A version has a guarded `draft → active` publish. Seeding runs
best-effort on startup in a logged goroutine so a missing pool never blocks registration. No money.

Applicable cross-cutting: `../cross-cutting/authentication.md`,
`../cross-cutting/rbac-and-permissions.md` (admin `academy.curriculum`),
`../cross-cutting/feature-flags-and-audit.md`.

## 2. Services / endpoints in scope

Member group `/academy/curriculum` (base `/api/finance`); admin group `/academy/admin/curriculum`
(base `/api`) guarded `RequirePermission("academy.curriculum")`.

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| List versions | `GET /academy/curriculum/versions` | member (auth) | no |
| List classes (`?version=`) | `GET /academy/curriculum/classes` | member | no |
| Class subjects / subject / topics / objectives / lessons | `GET /academy/curriculum/classes/:id/subjects`, `/subjects/:id`, `/subjects/:id/topics`, `/topics/:id`, `/topics/:id/objectives`, `/topics/:id/lessons`, `/lessons/:id` | member | no |
| Streams / trade-tracks | `GET /academy/curriculum/streams`, `/trade-tracks` | member | no |
| Admin tree | `GET /academy/admin/curriculum/tree` | `academy.curriculum` | no |
| Create/update version | `POST /versions`, `PATCH /versions/:id` | `academy.curriculum` | no |
| Publish version | `POST /versions/:id/publish` | `academy.curriculum` | no |
| Create/update class/subject/topic/objective | `POST`/`PATCH /classes`,`/subjects`,`/topics`,`/objectives` | `academy.curriculum` | no |

Version `Status` = draft | active | retired. All admin mutations write audit (`actor = c.GetString("user_id")`).

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage | Status |
|---|---|---|---|
| Version binding / boundary | unit | `curriculum_test.go::TestBindVersion`, `TestBindVersionBoundary` | AUTOMATED |
| Class spine contract | unit/con | `curriculum_test.go::TestClassSpineContract` | AUTOMATED |
| Entry-class tree contract | unit/con | `curriculum_test.go::TestEntryClassTreeContract` | AUTOMATED |
| Seed no-op on nil pool | unit | `curriculum_test.go::TestSeedNilPoolIsNoop` | AUTOMATED |
| Publish draft→active + audit | integration | — | TODO |
| Admin CRUD authz | integration/authz | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `CURRICULUM-INT-001` | List versions | P2 | seeded curriculum | `GET /academy/curriculum/versions` | — | 200; `{versions:[...]}` from DB (not hardcoded) |
| `CURRICULUM-INT-002` | Classes filtered by version | P2 | ≥2 versions | `GET /academy/curriculum/classes?version=<id>` | version id | Only that version's classes |
| `CURRICULUM-INT-003` | Drill subjects→topics→objectives | P2 | seeded | walk `GET .../classes/:id/subjects` → topics → objectives | — | Consistent parent/child chain |
| `CURRICULUM-INT-004` | Create version defaults to draft | P1 | holder of `academy.curriculum` | `POST /versions` | — | 201; status `draft`; audit written |
| `CURRICULUM-INT-005` | Publish version draft→active | P1 | draft version | `POST /versions/:id/publish` | — | 200; status `active`; `academy.curriculum.version.published` audit |
| `CURRICULUM-VAL-001` | Malformed create body rejected | P2 | holder | `POST /versions {}` (missing required) | invalid | 400 `invalid_body` |
| `CURRICULUM-VAL-002` | Unknown id returns not_found | P2 | — | `GET /academy/curriculum/subjects/:bogus` | bad id | 404 `not_found` |
| `CURRICULUM-AUTHZ-001` | Admin CRUD denied without permission | P0 | caller lacks `academy.curriculum` | `POST /academy/admin/curriculum/versions` | — | 403 `forbidden` (RBAC-AUTHZ-001) |
| `CURRICULUM-AUTHZ-002` | Admin CRUD allowed for holder | P1 | holder | same | — | 201/200 |
| `CURRICULUM-AUTHZ-003` | Member cannot reach admin tree | P1 | member (no perm) | `GET /academy/admin/curriculum/tree` | — | 403 |
| `CURRICULUM-SEC-001` | Audit actor is token identity | P1 | holder; spoofed `user_id` in body | `POST /versions` with body `user_id` | spoofed | Audit records token identity, not body (AUDIT-SEC-001) |
| `CURRICULUM-SEC-002` | Academy flag-off route inaccessible | P0 | `FEATURE_ACADEMY_ENABLED` off | Call any curriculum endpoint | — | Not mounted / 404 — never 500 (FLAG-SEC-001) |

## 5. State-machine transitions

Version publish is a single guarded transition (no dedicated `statemachine.go`):

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| draft | publish | active | audit `version.published` | `CURRICULUM-FSM-001` |

Publishing an already-active/retired version should be a no-op or rejected (assert not double-audited).

## 6. Security & abuse cases

- **Authz:** admin CRUD requires `academy.curriculum`; deny-by-default + fail-closed (`rbac-and-permissions.md`).
- **Data integrity:** spine is versioned data; reads must reflect DB rows, seeds are idempotent (`TestSeedNilPoolIsNoop`).
- **Audit actor:** token identity, never client-supplied `user_id` (`CURRICULUM-SEC-001`).
- **Flag-off:** whole academy gated (`CURRICULUM-SEC-002`).

## 7. Automated specs to add

- `curriculum/service_publish_test.go` — publish transitions draft→active and writes exactly one
  audit; re-publish is idempotent. TODO.
- `curriculum/authz_test.go` — admin CRUD denied without `academy.curriculum`, allowed with. TODO.

## 8. Coverage target & exit criteria

Pure-logic (binding, contracts, seed) covered by `curriculum_test.go`. Exit: publish + audit proven;
admin authz green; reads reflect DB spine; flag-off inaccessible.
