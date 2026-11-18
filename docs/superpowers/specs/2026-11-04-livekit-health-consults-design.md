# LiveKit paid health consults — design

**Date:** 2026-11-04
**Status:** Approved direction. Slice 1 (shared engine + LiveKit rail) not started.
**Scope:** paid, timed voice/video/chat consultations for telemedicine, vet, pharmacy and lab, on the on-prem LiveKit SFU. Four slices; each later slice gets its own plan, and slices 2–4 may get their own specs.

## Goal

A patient can buy a consult session from a provider, join a LiveKit voice or video room (or a time-boxed chat), and both sides see the same server-authoritative countdown. Five minutes before the end both sides are warned. Either side can extend; a patient-initiated extension needs the provider's approval and then the patient's payment before it takes effect. At 0:00 media is cut and the session is marked ended — both users stay signed in and the record remains readable.

## Verified current state

**LiveKit.** `backend/internal/integrations/livekit` already has `Config`, `Client`, `JoinToken`, `CreateRoom`, `DeleteRoom`, `RemoveParticipant`, `ListRooms`, `Health` and signed webhook verification; `registerLiveKit` mounts `/api/v1/webhooks/livekit` and `/api/v1/admin/rtc/livekit`. Production SFU is deployed (`infra/livekit/`, `room.auto_create: false`). Roles today are `RoleHost`, `RoleParticipant`, `RoleViewer`; none grants publish to a plain 1:1 peer. Only `academyLiveKitRail` (`room prefix academy-live-`) uses the rail.

**Telemedicine.** `doctor_appointments` + `doctor_call_sessions`; tokens come from `internal/integrations/rtc` (VideoSDK only). `StartCallSession` / `IssueCallToken` / `EndCallSession` live in `internal/doctor/service_ops.go`. Patient call screen `mobile-app/reactnative/app/services/telemedicine/consult/[id].tsx` hardcodes `SESSION_SECONDS = 20 * 60`, anchors to `scheduledAt`, has no remote stream and says "Doctor video not connected". Doctor screen `app/(doctor)/consult/[id]/call.tsx` already has real session hooks, controls and `CallStageView`.

**Vet.** `health_consults` rows are created by `healthvet.Service.StartConsult`; `IssueLobbyToken` in `internal/health/consult/service.go` returns an HMAC token that is not joinable by any media SDK. `vet_services(visit_type, price_kobo)` prices a visit; `health_appointments` carries `slot_start`/`slot_end`; `vetapi/owner/appts.go` fixes `slotLength = 30m`. Patient/provider teleconsult screens are placeholders with fake mic/cam indicators.

**Pharmacy.** Only an async text thread (`pharmacy_consult_messages`); no session, no provider selection at session time, no media.

**Lab.** No consult surface at all; `lab/results-interpretation.tsx` redirects to `/services/telemedicine`.

**Money.** All four verticals pay through the wallet → escrow rail (`internal/escrow`: `Hold`, `HoldWithPayee`, `Release`, `Refund`, idempotency keys).

**Mobile media.** `livekit-client ^2.22.4`, `@livekit/react-native ^3.0.0` and the Expo plugin are already installed. Academy web `useLiveRoom.ts` deliberately returns `unsupported`; native `useLiveRoom.native.ts` is real. The consult room must work on Expo web (`:8083`) as well as native.

## Decisions

**A. One shared engine, four verticals.** A single `consult_*` schema and service owns packages, sessions, timers, extensions and session chat. Vertical-specific tables (`doctor_call_sessions`, `health_consults`, `vet_consult_messages`, …) are **not** migrated. A consult session points at its origin through `source_ref`; the originating module keeps owning its own appointment, escrow base hold and records.

**B. Providers price per mode.** A provider publishes packages per `mode ∈ {chat, voice, video}` — e.g. 30 min voice = ₦2,000, 30 min video = ₦3,500. Mode and duration are chosen by the patient at booking. Price is copied onto the session so later package edits never change a booked price.

**C. Server-authoritative timer.** `ends_at` is computed and stored by the server at booking. Clients never decide the end; they render `ends_at` against a server clock offset delivered on join.

**D. Warning at `min(5 min, 20% of the scheduled window)`.** For a normal ≥25-minute session that is 5 minutes; short sessions warn proportionally so the warning is never the whole session. Warning is a session state flag plus a client event; no push notification dependency in Slice 1.

**E. Extension is approve-first, then pay.** Patient requests N added minutes → provider approves → patient has **5 minutes** to pay the server-computed amount into escrow → `ends_at` moves to `max(now, ends_at) + N`. Approval, payment and expiry are explicit states; an unpaid approval changes nothing.

**F. Provider-initiated extension is immediate and free.** A provider may grant extra of their own time; it applies at once, with `price_kobo = 0`. The patient is never charged for time they did not ask for.

**G. Cut media at 0:00, keep the session.** At expiry the server disconnects the room and marks the session `ended`. Auth, session chat (read-only), summary and notes stay available. A background sweeper guarantees the cut even if both clients vanish.

**H. Legacy fallbacks, not new truth.** A session without a package (old telemedicine appointment, old vet slot) falls back to today's duration — 20 minutes telemedicine, 30 minutes vet — but is still a normal `consult_sessions` row once the module starts one.

**I. Fail closed.** `FEATURE_LIVEKIT_ENABLED=true` with an unusable client (bad URL, short secret) returns `503 livekit_unavailable`; it never degrades to an unauthenticated or third-party room. Telemedicine keeps VideoSDK as a rollback behind `CONSULT_MEDIA_PROVIDER=videosdk` until Slice 2 has soaked.

**J. New endpoints are inert by default.** The engine has no feature flag of its own: with no packages published and no caller starting a session, nothing changes. Media remains gated by the existing LiveKit flag.

## Data model (additive)

```
consult_session_packages          what a provider sells
  id                uuid PK
  owner_kind        text CHECK in ('doctor','health_provider')
  owner_id          uuid            -- doctor user_id, or health_providers.id
  vertical          text CHECK in ('telemedicine','vet','pharmacy','lab')
  mode              text CHECK in ('chat','voice','video')
  duration_minutes  int  CHECK 5..480
  price_kobo        bigint CHECK >= 0
  active            boolean default true
  created_at, updated_at
  UNIQUE (owner_kind, owner_id, vertical, mode, duration_minutes)

consult_sessions                  one booked consult
  id                 uuid PK
  vertical           text CHECK in the four verticals
  mode               text CHECK in ('chat','voice','video')
  patient_id         uuid
  provider_owner_kind text CHECK in ('doctor','health_provider')
  provider_owner_id  uuid            -- pricing owner
  provider_user_id   uuid            -- LiveKit identity of the counterparty
  source_ref         text            -- e.g. doctor_appointment:<id>, vet_appointment:<id>
  package_id         uuid NULL -> consult_session_packages(id) ON DELETE SET NULL
  duration_minutes   int             -- snapshot
  price_kobo         bigint          -- snapshot
  booked_start       timestamptz
  ends_at            timestamptz
  warn_at            timestamptz     -- ends_at - min(5m, 20%)
  warning_sent_at    timestamptz NULL
  state              text CHECK in ('scheduled','live','ended','cancelled')
  room_name          text UNIQUE
  base_hold_id       uuid NULL       -- escrow hold booked by the module
  ended_at           timestamptz NULL
  created_at, updated_at

consult_extension_requests
  id                 uuid PK
  session_id         uuid -> consult_sessions(id) ON DELETE CASCADE
  requested_by       uuid
  added_minutes      int CHECK 1..240
  price_kobo         bigint CHECK >= 0
  status             text CHECK in
                       ('pending_approval','approved_awaiting_payment',
                        'paid','declined','expired','cancelled')
  approved_at        timestamptz NULL
  payment_expires_at timestamptz NULL   -- approved_at + 5m
  paid_at            timestamptz NULL
  escrow_id          uuid NULL
  decided_by         uuid NULL
  decline_reason     text NULL
  created_at, updated_at
  -- partial unique index, one open request per session:
  --   CREATE UNIQUE INDEX ... ON consult_extension_requests(session_id)
  --   WHERE status IN ('pending_approval','approved_awaiting_payment')
  -- idempotency key for payment: 'consult-ext:<id>'

consult_session_messages          timed session chat
  id          uuid PK
  session_id  uuid -> consult_sessions(id) ON DELETE CASCADE
  sender_id   uuid
  body        text CHECK length between 1 and 4000
  created_at  timestamptz
  INDEX (session_id, created_at)
```

RLS: enabled on all four tables, **no** anon/authenticated policies; access only through the Go pool (module convention). Migration is additive; version chosen at implementation time and re-checked against `main` and the live `schema_migrations` before merge.

Existing `vet_consult_messages` and the pharmacy thread keep working for legacy rows. New sessions write `consult_session_messages`; the client shows one thread per session.

## Shared engine

New package `backend/internal/health/consultengine` (separate from the existing `internal/health/consult`, which remains the vet HMAC lobby token service and is untouched):

```go
type Mode string  // chat | voice | video
type Vertical string

type Package struct{ ID, OwnerKind, OwnerID, Vertical, Mode string; Duration time.Duration; PriceKobo int64; Active bool }

type Session struct {
    ID, Vertical, Mode, PatientID, ProviderUserID string
    SourceRef, RoomName string
    Duration time.Duration; PriceKobo int64
    BookedStart, EndsAt, WarnAt time.Time
    State string; WarningSentAt *time.Time; BaseHoldID *string
}

func (s *Service) PublishPackage(ctx, pkg Package) (Package, error)
func (s *Service) ListPackages(ctx, vertical, ownerKind, ownerID string) ([]Package, error)
func (s *Service) Book(ctx, req BookRequest) (Session, error)        // prices from package, snapshots, creates room lazily
func (s *Service) Get(ctx, sessionID, callerID string) (Session, error) // caller must be patient or provider
func (s *Service) Join(ctx, sessionID, callerID string) (Join, error)   // token + server clock + window
func (s *Service) Complete(ctx, sessionID, callerID string) error
func (s *Service) RequestExtension(ctx, sessionID, callerID string, minutes int) (Extension, error)
func (s *Service) DecideExtension(ctx, sessionID, extID, callerID string, approve bool, reason string) (Extension, error)
func (s *Service) PayExtension(ctx, sessionID, extID, callerID string) (Extension, Session, error)
func (s *Service) PostMessage(ctx, sessionID, callerID, body string) (Message, error)
func (s *Service) ListMessages(ctx, sessionID, callerID string, after time.Time) ([]Message, error)
func (s *Service) Sweep(ctx) error   // warning + expiry backstop, called by a 30s goroutine
```

Rules enforced inside the service, not by handlers:

- The caller is resolved to patient or provider from `consult_sessions`; anything else is `404` (do not leak existence).
- `Book` refuses a package from another owner/vertical, an inactive package, or a start in the past by more than a grace window. It also verifies `provider_user_id` actually belongs to `(provider_owner_kind, provider_owner_id)`; a session never points at an unrelated provider.
- `Join` refuses when state is `ended`/`cancelled`; returns `409 session_ended` with the final `ends_at`.
- `PostMessage` requires `now < ends_at`; reading stays open forever for participants.
- Extension pricing: `ceil(price_kobo * added_minutes / duration_minutes)`, computed server-side from the session snapshot; a client-supplied price is ignored.
- Extension may only be requested while `now < ends_at`, for 1–240 minutes, and may not push `ends_at` beyond 4 hours after `booked_start`. A pending request not approved by `ends_at` becomes `expired`; the session still ends at 0:00.
- `PayExtension` is idempotent on `consult-ext:<id>`; on success it calls `escrow.HoldWithPayee(patient, providerUserID, sourceRef, "consult_extension", key, amount)`, then moves `ends_at` to `max(now, ends_at) + added`. The payee is pinned to the session's `provider_user_id`, so a later profile change cannot redirect funds.
- Any applied extension recomputes `warn_at = ends_at − min(5m, 20% of (ends_at − booked_start))` and clears `warning_sent_at`, so the counterparty is warned again before the new end.
- Provider-initiated extension skips approval and payment (`status='paid'`, `price_kobo=0`, `escrow_id=NULL`) and follows the same `ends_at` / `warn_at` update.
- At session end the engine releases every `paid` extension escrow for the session (`escrow.Release`) and the module releases its base hold through its existing path.

## LiveKit rail

New `consultLiveKitRail` in `backend/internal/app/consult_livekit.go`, modelled on `academyLiveKitRail`:

- Room name `consult-<vertical>-<sessionID>` (vertical lower-case). `Token` refuses any room not carrying its prefix, so the rail cannot mint tokens for Academy or arbitrary rooms.
- New `livekit.RolePeer`: publish, subscribe and data for both sides; the provider also gets room-admin so the UI can end the call. Grants stay explicit (no `canPublish: true` wildcards beyond the peer role).
- Room is created at booking (idempotent; "already exists" is success) and deleted on end. `auto_create: false` means a missing create is a hard failure, not a silent room.
- Token TTL is `min(configured TTL, remaining + 60s)`, floored at 60s, so a leaked join token cannot outlive the session by much.
- `Join` response:

```json
{
  "token": "<jwt>",
  "rtc": { "provider": "livekit", "url": "wss://…", "room": "consult-vet-…" },
  "session": {
    "id": "…", "mode": "video", "state": "live",
    "server_now": "2026-11-04T10:00:00Z",
    "ends_at": "2026-11-04T10:30:00Z",
    "warn_at": "2026-11-04T10:25:00Z",
    "extendable": true
  }
}
```

- Fail closed: flag on but client unusable → `503 livekit_unavailable`; flag off → telemedicine may return the VideoSDK token while `CONSULT_MEDIA_PROVIDER=videosdk`, and vet/pharmacy/lab return `503 media_unavailable`. No path ever returns a token for a room the rail did not create.
- Webhooks are already verified by `registerLiveKit`; Slice 1 adds only `participant_left` bookkeeping (no state transitions driven by webhooks — the timer owns state).

## Session lifecycle

```
scheduled ──first join──▶ live ──now ≥ ends_at / sweeper──▶ ended
    │                       │
    └──cancel by patient────┴──▶ cancelled   (before start only; base hold refunded by the module)
```

- `ends_at` is fixed at booking from `booked_start` (or "now" for immediate consults) plus the purchased duration.
- `Sweep` runs every 30s: sets `warning_sent_at` once `now ≥ warn_at`; ends sessions at `now ≥ ends_at` (mark `ended`, `DeleteRoom`, expire stale extension requests).
- Client timer is a rendering concern: `remaining = ends_at − (server_now + elapsedMonotonic)`. At 0 it disconnects locally and shows the ended state; the server is still the enforcer.
- Ends are idempotent; a double sweep or a client-triggered `Complete` cannot extend a session.

## Client surface

New shared module `mobile-app/reactnative/src/features/consult/`:

- `sessionTimer.ts` — pure: phase (`ok` | `warning` | `expired`), label, `canExtend`; unit-tested with injected clocks.
- `useConsultSession.ts` — join, poll `GET /consult/sessions/:id` every 15s and on foreground, expose `{session, serverOffset, phase, extension, requestExtension, approveExtension, payExtension, end}`.
- `useConsultRoom.web.ts` / `useConsultRoom.native.ts` — connect `livekit-client` (web) and `@livekit/react-native` (native); expose media state and toggles; auto-disconnect on `expired`. Reuse `src/features/academy/live/connection.ts` (`parseConnection`, `jwtExpiresAt`, `describeConnectionFailure`) rather than duplicating it.
- `ConsultRoom.tsx` — one screen for all four verticals: stage (reuse the Academy/doctor stage visuals), timer chip with warning state, chat drawer, extension sheet (request / approve / pay), ended state. Vertical-specific wrappers only supply `sourceRef`, counterparty name and which mode is allowed.
- Chat mode renders the same screen with the stage hidden and the thread primary.

Screens replaced in later slices: telemedicine patient `consult/[id].tsx`, doctor `(doctor)/consult/[id]/call.tsx` (media path only; existing session hooks stay), vet `teleconsult.tsx` / `teleconsult-lobby.tsx` / `provider/teleconsult.tsx`, pharmacy `pharmacist-consult.tsx` / `provider/consult.tsx`, lab results interpretation.

## HTTP surface

```
GET    /api/v1/consult/packages?vertical=&owner_kind=&owner_id=
POST   /api/v1/consult/packages            (provider auth; publish/update)
GET    /api/v1/consult/sessions/:id
POST   /api/v1/consult/sessions/:id/join
POST   /api/v1/consult/sessions/:id/complete
POST   /api/v1/consult/sessions/:id/extensions
POST   /api/v1/consult/sessions/:id/extensions/:ext/decide     {approve, reason?}
POST   /api/v1/consult/sessions/:id/extensions/:ext/pay
GET    /api/v1/consult/sessions/:id/messages?after=
POST   /api/v1/consult/sessions/:id/messages
```

All routes are bearer-authenticated except `GET /consult/packages`, which is a public read returning active packages only. Booking stays inside each module's own route in later slices, so each module keeps its intake, escrow hold and audit.

## Slices

1. **Engine + rail.** Migration, `consultengine` service with timer/extension FSM, `RolePeer`, `consultLiveKitRail`, routes above, sweeper, tests. No UI changes; endpoints inert until a session exists. Admin LiveKit health already exists and is untouched.
2. **Telemedicine + vet.** Package pickers at booking, module code starts a `consult_sessions` row pinned to its appointment, client `ConsultRoom` on web and native, server timer replaces `SESSION_SECONDS`, provider end/join, extension request + approve + pay. VideoSDK remains selectable as rollback.
3. **Pharmacy + lab.** Patient selects a provider and package; pharmacy gets a timed session instead of an open thread; lab gets a results-review consult. Session chat replaces the ad-hoc thread for new consults.
4. **Provider tooling.** Package management in doctor/vet/pharmacy/lab provider settings, extension approval inbox, session history, admin visibility.

## Testing

- **Go unit:** extension price math and rounding, warning math (including sub-25-minute sessions), extension FSM (pending → approved → paid → applied, expired, declined), idempotent payment, caller authorization, chat window gate, rail prefix refusal, role grants, token TTL cap, fail-closed when the client config is unusable.
- **Go integration:** `Book` → `Join` → warn → `ends_at` → ended with a real Postgres (local Supabase); extension approve+pay moves `ends_at`; unpaid approval changes nothing; sweeper idempotence.
- **Migration:** fresh replay passes the RLS check; additive-only guard passes.
- **RN:** jest for `sessionTimer`; manual two-party verification on Expo web (`:8083`) against the local SFU — join, warning at 5 minutes, media cut at 0:00 while both users stay signed in, chat read-only after end, extension approve-then-pay extends the countdown.
- **Money:** every amount server-computed; a client-supplied price or minutes beyond the cap is rejected; extension escrow releases exactly once.

## Out of scope

- Recording, transcription, egress, phone dial-in.
- Group consults (1:1 only; `MaxParticipants = 2` for consult rooms).
- Push/email notifications for the 5-minute warning (in-app only in Slice 1).
- Moving existing `doctor_call_sessions`, `health_consults` or pharmacy thread rows into the new schema.
- Changes to the deployed LiveKit SFU topology; this reuses `infra/livekit/` as-is.

## Risks

- **Timer skew.** Mitigated by server clock offset on join plus monotonic elapsed time, and by the server sweeper as the enforcer.
- **Two payment rails per session** (module base hold + engine extension hold). The spec keeps them separate and pinned to the same `source_ref`; reconciliation is by reference.
- **LiveKit local availability.** The SFU may not be running in a dev shell; acceptance testing needs `infra/livekit/` up, otherwise the fail-closed `503` is the correct observable.
