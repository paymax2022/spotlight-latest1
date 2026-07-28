# Visitor + Election — Backend Endpoint Inventory

Every endpoint the mobile live branches call (when `EXPO_PUBLIC_VISITOR_USE_MOCK=false` /
`EXPO_PUBLIC_ELECTION_USE_MOCK=false`). Full URL = `EXPO_PUBLIC_API_BASE_URL` + the path below.
**All paths are under `/api/v1`** (the stable frontend-web route-handler convention — the
client bases are `/api/v1/visitor`, `/api/v1/elections`, `/api/v1/notifications`). The tables
below omit the `/api/v1` prefix for brevity. All requests carry the Supabase Bearer token
(api/client interceptor). Mutations send an `Idempotency-Key` header.

Source of truth for shapes: `contracts/visitor.openapi.yaml` + the TS types in
`src/features/visitor/types/visitor.types.ts` and `src/features/election/types/election.types.ts`.

## Visitor (`/visitor`)

| Client fn | Method | Path | Idem | Request | Response |
|---|---|---|---|---|---|
| getRestrictionStatus | GET | `/visitor/restriction` | — | — | RestrictionStatus |
| listAccessCodes | GET | `/visitor/codes` | — | — | AccessCode[] |
| getAccessCode | GET | `/visitor/codes/{id}` | — | — | AccessCode |
| createAccessCode | POST | `/visitor/codes` | ✓ | CreateAccessCodeInput | AccessCode |
| revokeAccessCode | POST | `/visitor/codes/{id}/revoke` | ✓ | — | AccessCode |
| extendAccessCode | POST | `/visitor/codes/{id}/extend` | ✓ | `{ validityEnd }` | AccessCode |
| logShare | POST | `/visitor/codes/{id}/share` | — | — | 204 |
| listVisitHistory | GET | `/visitor/history` | — | — | VisitEvent[] |
| getGateSession | GET | `/visitor/gate/session` | — | — | GateSession |
| listExpectedVisitors | GET | `/visitor/gate/expected` | — | — | AccessCode[] |
| listGateLog | GET | `/visitor/gate/log` | — | — | VisitEvent[] |
| pendingSyncCount | GET | `/visitor/gate/pending-sync-count` | — | — | `{ count }` |
| syncPendingLogs | POST | `/visitor/gate/sync` | ✓ | — | `{ synced }` |
| lookupCode | GET | `/visitor/gate/lookup?code=` | — | — | LookupOutcome |
| approveEntry | POST | `/visitor/gate/approve` | ✓ | ApproveEntryInput | VisitEvent |
| denyEntry | POST | `/visitor/gate/deny` | ✓ | DenyEntryInput | VisitEvent |
| getCodeAttendance | GET | `/visitor/codes/{id}/attendance` | — | — | CodeAttendance |
| recordArrival | POST | `/visitor/codes/{id}/arrival` | — | `{ gateId }` | CodeAttendance |
| recordExit | POST | `/visitor/codes/{id}/exit` | ✓ | `{ gateId }` | VisitEvent |
| listOpenVisits | GET | `/visitor/gate/open-visits` | — | — | OpenVisit[] |
| listOverstays | GET | `/visitor/gate/overstays` | — | — | OverstayVisit[] |
| getOpenVisitCount | GET | `/visitor/gate/open-visits/count` | — | — | `{ count }` |
| checkOutVisit | POST | `/visitor/gate/checkout` | ✓ | `{ visitEventId, gateId }` | VisitEvent |
| createWalkIn | POST | `/visitor/gate/walkin` | ✓ | WalkInInput | VisitEvent |
| submitHandover | POST | `/visitor/gate/handover` | ✓ | `{ gateId, notes }` | GateSession |
| listNotifications | GET | `/visitor/notifications` | — | — | VisitorNotification[] |
| markNotificationRead | POST | `/visitor/notifications/{id}/read` | — | — | 204 |
| markAllNotificationsRead | POST | `/visitor/notifications/read-all` | — | — | 204 |
| unreadNotificationCount | GET | `/visitor/notifications/unread-count` | — | — | `{ count }` |
| listBlacklist | GET | `/visitor/blacklist` | — | — | BlacklistEntry[] |
| addBlacklist | POST | `/visitor/blacklist` | ✓ | BlacklistInput | BlacklistEntry |
| removeBlacklist | DELETE | `/visitor/blacklist/{id}` | — | — | 204 |
| listIncidents | GET | `/visitor/incidents` | — | — | IncidentReport[] |
| submitIncident | POST | `/visitor/incidents` | ✓ | IncidentInput | IncidentReport |
| getVisitorAnalytics | GET | `/visitor/analytics` | — | — | VisitorAnalytics |
| lookupVisitorsAndResidents | GET | `/visitor/search?q=` | — | — | LookupResults |
| listVehicleEntries | GET | `/visitor/gate/vehicles` | — | — | VisitEvent[] |
| createEventGuestCodes | POST | `/visitor/codes/event` | ✓ | EventGuestInput | EventGuestManifest |
| submitProofOfPayment | POST | `/visitor/restriction/proof` | — | (multipart receipt later) | RestrictionStatus |
| submitAppeal | POST | `/visitor/restriction/appeal` | — | `{ reason, detail? }` | RestrictionStatus |

> `listPhonebookContacts` has **no** endpoint — it is device-sourced (expo-contacts).

## Election (`/elections`)

| Client fn | Method | Path | Idem | Request | Response |
|---|---|---|---|---|---|
| getActiveElection | GET | `/elections/active` | — | — | Election \| null |
| listElections | GET | `/elections` | — | — | Election[] |
| getElection | GET | `/elections/{id}` | — | — | Election |
| getVoterEligibility | GET | `/elections/{id}/eligibility` | — | — | VoterEligibility |
| getMyBallot | GET | `/elections/{id}/ballot` | — | — | MyBallot |
| castVote | POST | `/elections/{id}/vote` | ✓ | `{ positionId, candidateId }` | MyBallot |
| createElection | POST | `/elections` | ✓ | CreateElectionInput | Election |
| publishResults | POST | `/elections/{id}/publish` | — | — | Election |

## Notifications

| Client fn | Method | Path | Request | Response |
|---|---|---|---|---|
| sendPushTokenToBackend | POST | `/notifications/push-token` | `{ token, platform }` | 204 |

## Server-side rules (from CLAUDE.md)
- Validate the Bearer JWT; scope every query to the caller's estate + role (RBAC).
- Money in **kobo** (RestrictionStatus.outstandingBalanceKobo); never floats.
- Mutations: require `Idempotency-Key`, write an audit event; for any money-touching path post balanced double-entry ledger entries.
- Migrations additive-only. Spec PR (`contracts/visitor.openapi.yaml`) before implementation.
- `getVoterEligibility` reads the resident's payment standing (hard_ban ⇒ payment-ineligible).
- Push: on visitor/election events, emit a push whose `data` matches the routing contract in `docs/visitor/08-PUSH-AND-BRAND-FONT.md`.

## Backend reconciliation (existing schema vs client contract)

The estate/visitor/election schema already exists in `supabase/migrations`. Some shapes differ from the client contract — resolve these when implementing the `/api/v1` handlers:

**Tables that already exist:** `estates`, `estate_gates`, `estate_residents`, `estate_properties`, `estate_invite_codes`, `estate_join_requests`, `visitor_access_codes` (+ `recurrence` JSONB), `visitor_checkins`, `visitor_passes`, `elections`, `election_candidates`, `election_votes`.

**Gaps to add (additive migration):**
- `election_positions` (id, election_id, title, seats) and a `position_id` FK on `election_candidates` + `election_votes` — the current schema is **single-position** (`election_votes` has `UNIQUE(election_id, voter_id)` = one vote per voter), but the client models **multi-position** ballots (one vote per position). Change the uniqueness to `UNIQUE(election_id, voter_id, position_id)`.
- `gate_sessions`, `visitor_notifications`, `visitor_blacklist`, `visitor_incidents`, `device_push_tokens` — not present; needed by the corresponding endpoints.

**Field/enum mappings:**
- Election status: DB `draft|open|closed|tallied` → client `scheduled|live|closed|results_published`. Derive `live` from the open window (`starts_at..ends_at`), `results_published` from `tallied`.
- `elections` lacks `total_eligible_voters` / `votes_cast` / `results_published` — compute from `estate_residents` count, `election_votes`, and `status='tallied'` (or add columns).
- `AccessCode.usageMode`/`partySize` and `CreateAccessCodeInput.recurrenceRule` (string `"MON,WED,FRI 07:00-18:00"`) ↔ `visitor_access_codes.recurrence` JSONB `{days_of_week,time_start,time_end}` + a `max_uses`/`code_type` mapping. Add `usage_mode` + `party_size` columns (additive).
- Money: `RestrictionStatus.outstandingBalanceKobo` is kobo; source from the Payments module.
