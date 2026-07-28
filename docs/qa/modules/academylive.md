# Module: Academy Live (Live Classes + Community + Moderation)

**Risk tier:** 2 &nbsp;·&nbsp; **Money-path:** no &nbsp;·&nbsp; **Feature flag:** `FEATURE_ACADEMY_LIVE_ENABLED` (`FlagLive` = `academy.live`; registered inside `if liveEnabled`)
**Code:** `backend/internal/academy/live/` — `handler.go`, `service.go`, `model.go`, `statemachine.go`, `provider.go`, `repository.go`, `live_test.go`; wiring in `backend/internal/app/academy_routes.go` (`RegisterAcademyLive`, RTC via `academyLiveRail`/`integrations/rtc`).
**Slug:** `ACADEMYLIVE`

## 1. Overview & scope

Live classes, community groups/discussions, and content moderation. Learners list/join live sessions
(join returns an RTC token via the injected `LiveRoomProvider`; nil → deterministic stub), post in
community scopes (subject/group/session — **no DM/1:1 scope**, child-safety), and report content.
Sessions are a guarded FSM (`scheduled → live → ended`, `scheduled → cancelled`); the moderation report
workflow is a guarded FSM. Two admin permission slugs apply: `academy.live` (session management) and
`academy.moderation` (report workflow). Discussion posting is gated by a fail-closed child-safety guard:
minors cannot post in DM-shaped scopes. No money.

Applicable cross-cutting: `../cross-cutting/authentication.md`,
`../cross-cutting/rbac-and-permissions.md` (`academy.live` / `academy.moderation`),
`../cross-cutting/feature-flags-and-audit.md`.

## 2. Services / endpoints in scope

Member base `/api/finance/academy`; admin base `/api/academy/admin`.

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| List/get sessions | `GET /live/sessions`, `/live/sessions/:id` | member (auth) | no |
| Join session (RTC token) | `POST /live/sessions/:id/join` | member; only when session `live` | no |
| Community groups list/create/join | `GET/POST /community/groups`, `POST /community/groups/:id/join` | member | no |
| Discussions list/post | `GET /community/discussions`, `POST /community/discussions` | member; child-safety guard | no |
| Report content | `POST /moderation/report` | member (incl. minors) | no |
| Admin sessions list/replays/create | `GET /live/sessions`, `/live/replays`, `POST /live/sessions` | `academy.live` | no |
| Start/end/cancel session | `POST /live/sessions/:id/{start,end,cancel}` | `academy.live` | no |
| Moderation reports list | `GET /moderation/reports` | `academy.moderation` | no |
| Decide/triage/escalate report | `POST /moderation/reports/:id/{decide,triage,escalate}` | `academy.moderation` | no |

Enums: `SessionState` = scheduled|live|ended|cancelled; community scopes subject|group|session (no
dm/direct/1:1); `DiscussionState` = visible|hidden; report states pending|actioned|dismissed (+
triaged|escalated — noted DB CHECK gap needing an additive migration); moderation actions
hide|warn|ban|none. `LiveRoomProvider` = `CreateRoom` + `Token`; nil → `stubRoomProvider`.

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage | Status |
|---|---|---|---|
| Session FSM legal/illegal | unit/fsm | `live_test.go::TestCanSession_AllowedTransitions`, `TestCanSession_IllegalTransitions` | AUTOMATED |
| Report action → state mapping | unit/fsm | `live_test.go::TestReportStateForAction`, `TestDecideHide_MapsToActioned` | AUTOMATED |
| Moderation action validity | unit | `live_test.go::TestValidModerationAction` | AUTOMATED |
| Discussions exclude hidden | unit | `live_test.go::TestListDiscussions_ExcludesHidden` | AUTOMATED |
| Minor DM guard (child-safety) | unit/sec | `live_test.go::TestCanPostDiscussion_MinorDMGuard`, `TestScopeHelpers` | AUTOMATED |
| Stub RTC provider deterministic | unit | `live_test.go::TestStubRoomProvider_Deterministic` | AUTOMATED |
| Join issues RTC token against issuer | integration | — | TODO |
| Admin session/moderation authz split | integration/authz | — | TODO |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `ACADEMYLIVE-INT-001` | Join live session returns token | P1 | session `live` | `POST /live/sessions/:id/join` | — | Session + short-lived RTC token; host detected by `HostID==userID` → host role |
| `ACADEMYLIVE-INT-002` | Start session provisions room | P1 | session `scheduled`; holder `academy.live` | `POST /live/sessions/:id/start` | — | `scheduled→live`; `room_ref` persisted atomically |
| `ACADEMYLIVE-INT-003` | Post discussion in group scope | P1 | member | `POST /community/discussions {scope:"group",...}` | — | Posted `visible` |
| `ACADEMYLIVE-INT-004` | Report content (minor allowed) | P1 | minor user | `POST /moderation/report` | — | Report `pending` created (any user may report) |
| `ACADEMYLIVE-INT-005` | Moderation decide(hide) | P1 | report `pending`; holder `academy.moderation` | `POST /moderation/reports/:id/decide {action:"hide"}` | — | Report `actioned`; discussion hidden |
| `ACADEMYLIVE-VAL-001` | Join non-live session rejected | P1 | session `scheduled`/`ended` | `POST /live/sessions/:id/join` | — | Rejected `ErrIllegalTransition` (join only when live) |
| `ACADEMYLIVE-VAL-002` | Invalid moderation action rejected | P2 | holder | decide `{action:"nuke"}` | invalid | Rejected (`validModerationAction`) |
| `ACADEMYLIVE-AUTHZ-001` | Session mgmt denied without `academy.live` | P0 | caller lacks slug | `POST /live/sessions` | — | 403 `forbidden` |
| `ACADEMYLIVE-AUTHZ-002` | Moderation denied without `academy.moderation` | P0 | caller has `academy.live` only | `GET /moderation/reports` | — | 403 (distinct slug) |
| `ACADEMYLIVE-SEC-001` | Minor cannot post in DM scope | P0 | minor user | `POST /community/discussions {scope:"1:1"}` | dm-shaped | Rejected `minor_dm_forbidden`; blocked post audited (fail-closed) |
| `ACADEMYLIVE-SEC-002` | Adult DM scope also blocked | P1 | adult user | post `{scope:"dm"}` | — | Rejected `dm_scope_forbidden` (no 1:1 scope exists) |
| `ACADEMYLIVE-SEC-003` | Hidden discussions excluded from list | P1 | hidden discussion exists | `GET /community/discussions` | — | Hidden rows excluded (visible-only) |
| `ACADEMYLIVE-SEC-004` | Live flag-off route inaccessible | P0 | `FEATURE_ACADEMY_LIVE_ENABLED` off | Call any live endpoint | — | Not mounted / 404 — never 500 (FLAG-SEC-001) |

## 5. State-machine transitions

**Session** (`sessionTransitions`, `canSession`):

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| scheduled | start | live | provision room + persist room_ref | `ACADEMYLIVE-FSM-001` |
| scheduled | cancel | cancelled (terminal) | — | `ACADEMYLIVE-FSM-002` |
| live | end | ended (terminal) | replay ref may be set | `ACADEMYLIVE-FSM-003` |

Cannot cancel a live session; ended/cancelled terminal; self-loops illegal
(`TestCanSession_IllegalTransitions`).

**Moderation report** (`reportTransitions`, `canReport`): `pending → triaged|escalated|actioned|
dismissed`; `triaged → escalated|actioned|dismissed`; `escalated → actioned|dismissed`;
actioned/dismissed terminal. `reportStateForAction`: none→dismissed, else actioned.
`ACADEMYLIVE-FSM-004`. (Persisting triaged/escalated requires an additive DB CHECK migration — noted
gap.)

## 6. Security & abuse cases

- **Child-safety:** no DM/1:1 community scope exists; minors blocked from DM-shaped posts fail-closed,
  and blocked attempts are audited (`ACADEMYLIVE-SEC-001/002`).
- **RTC issuer:** join returns a token only for a `live` session; nil provider yields a deterministic
  stub, never fabricating a real stream (`ACADEMYLIVE-VAL-001`).
- **Authz split:** `academy.live` (sessions) vs `academy.moderation` (reports) — assert independently.
- **Visibility:** hidden discussions excluded from member lists (`ACADEMYLIVE-SEC-003`).
- **Flag-off:** live gate (`ACADEMYLIVE-SEC-004`).

## 7. Automated specs to add

- `live/live_db_join_test.go` — join a `live` session issues an RTC token via the issuer; non-live join
  rejected; room_ref persisted on start. TODO.
- `live/authz_test.go` — `academy.live` vs `academy.moderation` slug split. TODO.
- Additive migration + test to persist `triaged`/`escalated` report states (noted DB CHECK gap). TODO.

## 8. Coverage target & exit criteria

Pure session/report FSM + child-safety + stub-provider logic covered by `live_test.go`. Exit: session
FSM + RTC token issuance proven; child-safety DM guard fail-closed + audited; moderation workflow +
authz split green; live flag-off inaccessible.
