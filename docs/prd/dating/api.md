# Paymax Connect — API (§23)

REST under `/api/v1/connect/*`, registered in `backend/internal/app/router.go` (new
`connect_routes.go`), gated on `config.FeatureConnectEnabled`. Every route requires
`RequireAuthContext`; protected actions add object-level authz in the service layer (can THIS user
act on THIS record). State-changing money routes require an `Idempotency-Key` header. Responses are
field-masked; validation errors are per-field. Admin routes live under `/api/connect/admin/*` and
require the relevant `connect.*` RBAC permission.

## Phase 0
| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/connect/config` | Backend-owned flags/weights/limits/entitlements/rules for mobile |
| GET | `/api/v1/connect/health` | Module health |
| POST | `/api/v1/connect/onboarding/age-gate` | DOB capture; 18+ check; routes suspected minors to `connect_underage_flags` |
| GET | `/api/connect/admin/audit` | Admin: read `connect_audit_log` (RBAC `connect.audit.read`) |
| GET/POST | `/api/connect/admin/cases` | Admin: list / update safety cases |

## Phase 1 (core MVP)
| Method | Path | Notes |
|---|---|---|
| GET/PATCH | `/api/v1/connect/profile` | Get/update identity profile |
| GET/PATCH | `/api/v1/connect/profile/modes/:mode` | Per-mode visibility/privacy/intent |
| POST | `/api/v1/connect/profile/media` | Upload; returns `moderation_status=pending` (not public yet) |
| POST | `/api/v1/connect/verification/selfie` | Start L0–L1 liveness; evidence stored encrypted |
| GET | `/api/v1/connect/verification/status` | Level + badge |
| GET | `/api/v1/connect/discovery` | Curated daily matches with match-reason cards; honors anti-fatigue limits from config |
| POST | `/api/v1/connect/likes` | Like / super-like; idempotent; may create a mutual match |
| GET | `/api/v1/connect/matches` | List matches |
| GET | `/api/v1/connect/search` | Filters: verified-only, intent, distance (approximate) |
| GET | `/api/v1/connect/conversations/:id/messages` | Participant-only |
| POST | `/api/v1/connect/conversations/:id/messages` | Blocked unless `matched` + `open` + no block; runs AI safety hook |
| POST | `/api/v1/connect/safety/report` | **Always creates a `connect_case`**; never fails silently |
| POST | `/api/v1/connect/safety/block` | Block / unmatch |
| GET/POST/DELETE | `/api/v1/connect/safety/trusted-contacts` | Safety center |
| PATCH | `/api/v1/connect/privacy/location` | Location-visibility control (approximate by default) |
| POST | `/api/v1/connect/date-plans` | Create plan |
| POST | `/api/v1/connect/date-plans/:id/share` | Share with trusted contact |
| POST | `/api/v1/connect/date-plans/:id/checkin` | Check-in |
| POST | `/api/v1/connect/date-plans/:id/feedback` | Post-date feedback/report |
| GET/POST | `/api/connect/admin/verification` | Admin: verification review queue |
| GET/POST | `/api/connect/admin/moderation` | Admin: profile + chat moderation queues |
| GET | `/api/connect/admin/users` | Admin: Connect user management |

## Later phases (outline)
- **Phase 2:** `/professional/profile`, `/professional/discovery`, `/business-card`, `/rooms`.
- **Phase 3:** `/events/:id/networking/opt-in`, `/events/:id/attendees`, `/events/qr/scan` (reuse
  existing events endpoints; add networking opt-in + attendee discovery only).
- **Phase 4:** `/creator/profile`, `/creator/portfolio`, `/creator/collab-requests`.
- **Phase 5:** `/ai/profile-coach`, `/ai/conversation-assistant`, `/ai/match-explanation` (all
  policy-bounded), `/safety/shield` decisions.
- **Phase 6:** `/subscriptions`, `/boosts`, `/passes` — all via Paymax wallet; entitlements
  validated server-side; `/date-plans/:id/ride` and `/date-plans/:id/tickets` integrate Paymax
  Mobility/Events.

## Conventions
- Versioned `/api/v1/connect/*`; admin `/api/connect/admin/*`.
- AuthN on every route; object-level authZ in service layer.
- Idempotency-Key required on all money + match/like writes.
- Structured log + metric + audit entry on every state change.
- No secrets in client; parameterized queries only.
