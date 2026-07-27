# Module: Academy Platform (Feature-Flag Admin + Super-Admin Console + Offline Sync)

**Risk tier:** 1 (flag writes gate every money sub-module) &nbsp;·&nbsp; **Money-path:** no (config + audit writes; reads money in kobo) &nbsp;·&nbsp; **Feature flag:** the flag store itself — group gated by RBAC `platform_edtech_admin`
**Code:** `backend/internal/academy/platform/` — `actions.go`, `feature_flags.go`, `handlers.go`, `repo.go` (**no `*_test.go`**); routes in `backend/internal/app/academy_platform_routes.go` (`RegisterAcademyPlatform`). Offline sync: `backend/internal/academy/offlinesync/` (`RegisterAcademySync`).
**Slug:** `ACADEMYPLATFORM`

## 1. Overview & scope

The super-admin console + feature-flag control plane for the whole academy. The `FlagResolver`
(read once at startup) resolves each sub-module flag against `public.academy_feature_flags`, falling
back **fail-closed** to the compile-time env default — a store read error yields `overrides=nil` (every
flag → compile default) and never destabilizes route registration or silently enables a module. The
console surfaces (SU-01…SU-12): schools/verification-queue, collections, risk, gov-sync/compliance,
competitions, trust-scores, scholarship pledges, support tickets, **flags**, audit log, compliance
posture. Flag toggles and other writes upsert + append an immutable audit row in **one transaction**.
The whole `/api/academy/admin/platform` group is gated by a single slug `platform_edtech_admin`; there
is no separate flag-write permission. §2b covers the thin, member-only offline sync ingest.

Applicable cross-cutting: `../cross-cutting/feature-flags-and-audit.md` (flag semantics + audit
atomicity — do not repeat), `../cross-cutting/rbac-and-permissions.md` (`platform_edtech_admin`),
`../cross-cutting/authentication.md`.

## 2. Services / endpoints in scope

### 2a. Platform console (`RegisterAcademyPlatform`)
All under `/api/academy/admin/platform`, all gated `RequirePermission("platform_edtech_admin")`.

| Operation | Method + path | SU-# | Write? |
|---|---|---|---|
| Schools / verification queue | `GET /schools`, `GET /verification-queue` | SU-01/02 | no |
| Verify school | `POST /schools/:id/verify`, `POST /verification-queue/:id/review` | | yes (advances `verification_tier`) |
| Collections | `GET /collections` | SU-03 | no |
| Risk cases / action | `GET /risk`, `POST /risk/:id/action` | SU-04 | audit-only |
| Gov-sync / compliance exports | `GET /gov-sync`, `GET /compliance-exports` | SU-05 | no |
| Competitions / transition | `GET /competitions`, `POST /competitions/:id/transition` | SU-06 | yes (reuses fees competition FSM) |
| Trust-scores / override | `GET /trust-scores`, `POST /trust-scores/:schoolId/override` | SU-07 | yes (appends override) |
| Scholarship pledges | `GET /scholarship-pledges` | SU-08 | no |
| Support tickets | `GET /support-tickets` | SU-09 | no (documented empty) |
| **Flags** list/toggle/replace | `GET /flags`, `POST /flags/toggle`, `PUT /flags` | SU-10 | **yes (flag write)** |
| Audit log | `GET /audit-log` | SU-11 | no |
| Compliance posture | `GET /compliance-posture` | SU-12 | no |

### 2b. Offline sync (`RegisterAcademySync`) — member-only
`POST /api/finance/academy/sync` (auth only, self-scoped, no RBAC). Ingests a single flat event or
`{events:[...]}` batch; per-event result acked|duplicate|rejected. Idempotency key = per-event
`clientEventId` (fallback `Idempotency-Key`). Kinds progress|attempt_queued|reward_eligible; unknown
kind or missing key → rejected. **No money / no ledger** — buffers into `academy_sync_events` for
downstream reconciliation.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage | Status |
|---|---|---|---|
| FlagResolver fail-closed to compile default | unit | — (no in-package test) | TODO |
| Flag toggle upsert + audit atomic | integration | — | TODO |
| Console read surfaces (SU-01..12) | integration | — | TODO |
| Competition transition delegates to fees FSM | integration | (fees `statemachine/statemachine_test.go` covers FSM) | PARTIAL |
| Offline sync idempotent ingest (acked/duplicate/rejected) | integration | — | TODO |
| `platform_edtech_admin` authz | integration/authz | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `ACADEMYPLATFORM-INT-001` | List flags | P1 | holder `platform_edtech_admin` | `GET /platform/flags` | — | 200; flags with key/enabled/description/updatedBy |
| `ACADEMYPLATFORM-INT-002` | Toggle flag writes + audits atomically | P0 | holder | `POST /platform/flags/toggle {key:"academy.exam"}` | — | Flag upserted in `academy_feature_flags` + one `academy.flag.enable/disable` audit row in the same tx |
| `ACADEMYPLATFORM-INT-003` | Verify school advances tier | P1 | holder; pending school | `POST /platform/schools/:id/verify` | — | `verification_tier` advanced; audited |
| `ACADEMYPLATFORM-INT-004` | Competition transition via console | P2 | holder; competition | `POST /platform/competitions/:id/transition` | valid event | Reuses fees competition FSM; illegal/terminal → 409, unknown event/scope → 400 |
| `ACADEMYPLATFORM-INT-005` | Trust-score override appends | P2 | holder | `POST /platform/trust-scores/:schoolId/override` | score+reason | Override appended; audited |
| `ACADEMYPLATFORM-INT-006` | Offline sync acks new event | P1 | authed learner | `POST /academy/sync {clientEventId, kind:"progress"}` | new id | `acked`; buffered into `academy_sync_events` |
| `ACADEMYPLATFORM-INT-007` | Offline sync duplicate is idempotent | P0 | event already ingested | replay same `clientEventId` | same id | `duplicate`; no second buffer row |
| `ACADEMYPLATFORM-VAL-001` | Offline sync unknown kind rejected | P1 | authed | `POST /academy/sync {kind:"xyz"}` | invalid | `rejected` |
| `ACADEMYPLATFORM-VAL-002` | Offline sync missing key rejected | P1 | authed | `POST /academy/sync {kind:"progress"}` no id/key | — | `rejected` |
| `ACADEMYPLATFORM-AUTHZ-001` | Console denied without `platform_edtech_admin` | P0 | caller lacks slug | `GET /platform/flags` | — | 403 `forbidden` (RBAC-AUTHZ-001) |
| `ACADEMYPLATFORM-AUTHZ-002` | Flag write uses same slug (no self-grant) | P0 | caller with unrelated perms | `POST /platform/flags/toggle` | — | 403; flag writes gated by `platform_edtech_admin` only, verbatim slug |
| `ACADEMYPLATFORM-AUTHZ-003` | Offline sync is self-scoped | P1 | user A | `POST /academy/sync` | — | Events buffered under A's identity (token, not body) |
| `ACADEMYPLATFORM-SEC-001` | FlagResolver fail-closed on store error | P0 | `academy_feature_flags` read errors at boot | start server | — | `overrides=nil`; every flag → compile-time env default; error logged; routes still register (never silently enabled) |
| `ACADEMYPLATFORM-SEC-002` | No toggle without its audit | P0 | holder | force audit insert to fail within `SetFlag` | — | Whole tx rolls back; flag not changed (upsert+audit atomic) |
| `ACADEMYPLATFORM-SEC-003` | Disabled-module flag actually gates routes | P0 | toggle `academy.tutor` off, restart | call a tutor endpoint | — | Tutor routes not mounted / 404 (flag store drives `RegisterAcademy`; FLAG-SEC-001) |

## 5. State-machine transitions

No local FSM. Competition transitions delegate to `feescompetition` / `feesstatemachine.CompetitionTransition`
(see `fees.md §5`): `ErrUnknownEvent`/`ErrScopeInvalid` → 400; illegal/terminal → 409.

## 6. Security & abuse cases

- **Fail-closed flag resolution:** a store read failure resolves every flag to its compile-time default;
  a flag with no row keeps its default — the store never silently enables a module
  (`ACADEMYPLATFORM-SEC-001`; see `feature-flags-and-audit.md`).
- **Audit atomicity:** `SetFlag` upsert + audit share one transaction — no toggle without its trail
  (`ACADEMYPLATFORM-SEC-002`).
- **Single privileged slug:** every console route (including flag writes) requires
  `platform_edtech_admin`; no separate flag-write permission and no self-grant path
  (`ACADEMYPLATFORM-AUTHZ-001/002`).
- **Flag drives registration:** toggling a sub-module flag makes its routes appear/disappear on restart
  (`ACADEMYPLATFORM-SEC-003`).
- **Offline sync:** self-scoped, idempotent, no money/ledger; unknown kind or missing key rejected
  (`ACADEMYPLATFORM-VAL-001/002`, `ACADEMYPLATFORM-INT-007`).
- **Audit actor** is the token identity, not a spoofed body `user_id` (AUDIT-SEC-001).

## 7. Automated specs to add

- `platform/feature_flags_test.go` — `FlagResolver` returns compile default on store error / missing
  row, stored override otherwise (fail-closed table). TODO (no in-package suite exists).
- `platform/set_flag_atomic_test.go` — toggle upsert + audit atomic; rollback on audit failure. TODO.
- `platform/authz_test.go` — every console route denied without `platform_edtech_admin`. TODO.
- `offlinesync/ingest_test.go` — acked/duplicate/rejected classification; self-scope; unknown kind /
  missing key rejected. TODO.

## 8. Coverage target & exit criteria

Exit: FlagResolver fail-closed proven (store error → compile defaults, never silent-enable); flag
toggle + audit atomic; console fully gated `platform_edtech_admin`; disabled-flag routes proven absent;
offline sync idempotent + self-scoped. This module is the control plane for every other academy flag —
its fail-closed behavior is a Tier-0 dependency for the money sub-modules' flag-off cases.
