# Doctor dashboard metrics — design

Fix the five metrics on the signed-in doctor's dashboard
(`mobile-app/reactnative/app/(doctor)/(tabs)/index.tsx`): Today's consults, Upcoming,
Available (revenue from paid patients), Satisfaction %, and Today's queue. Each is
delivered from a real projection over the tables the product actually writes, and each
is pinned by a live-DB test.

## Goal

A doctor with real bookings sees, on `GET /api/v1/doctor/dashboard` and the screen that
consumes it:

1. **Today's consults** — how many consults fall on the doctor's own calendar day.
2. **Upcoming** — how many live future bookings they hold.
3. **Available** — money they can actually spend, plus the consult-specific revenue the
   `earnings` object already claims to carry (`pendingKobo`, `thisMonthKobo`,
   `lifetimeKobo`, `consultsThisMonth`).
4. **Satisfaction %** — derived from real reviews, and visibly *absent* rather than
   falsely `0%` when there are none.
5. **Today's queue** — the list behind tile 1, i.e. the same rows, same day, same scope.

## Verified current state

Measured at `origin/main` = `effe1b355` on 2026-11-13.

- `src/api/doctor.batch1.api.ts` `getDashboard()` live branch **hard-codes**
  `counts.todaysAppointments: 0`, `counts.upcomingAppointments: 0`,
  `todaysAppointments: []`, `satisfactionPct: 0`, `pendingKobo: 0`, `thisMonthKobo: 0`,
  `consultsThisMonth: 0`. The screen's `counts?.todaysAppointments ?? todays.length`
  fallback can never fire, because `0` is not nullish. That is why the tiles read
  `0 / 0 / 0%` for every live account, including one with bookings.
- `GET /dashboard` (`service_tail2.go` `GetDashboard`, `handler_tail2.go`
  `DashboardSummary`) returns only `{appointmentCounts, unreadNotifications,
  walletBalanceKobo, currency}`. `appointmentCounts` comes from
  `repository_tail2.go` `appointmentStatusCounts`:
  `SELECT status, COUNT(*) FROM doctor_appointments … GROUP BY status` — no date
  dimension, so "today" and "upcoming" are not expressible in the payload at all.
- `doctor_appointments` is an **orphan table**: `git grep "INSERT INTO doctor_appointments"`
  over backend/, supabase/ and mobile-app/ on `origin/main` returns zero hits. A patient's
  `BookAppointment` (`internal/telemedicine/service.go:570`) writes exactly one row into
  `public.appointments` (`status='booked'`, `scheduled_at timestamptz`, `doctor_id →
  doctors.id`). So every doctor-side appointment read answers empty for real bookings.
  `doctor_consult_queue` is orphaned the same way.
- The screen's Today's queue is `appointments.filter(a => ACTIVE_STATUSES.includes(a.status))`
  (`index.tsx:71`) — **status-only, never date-scoped**, so a booking next Friday would
  appear as "today" the moment the read is fixed.
- `DoctorDashboardData.todaysAppointments` (an array, `src/types/doctor.batch1.ts:248`,
  documented in `docs/DOCTOR_BATCH1_OWNERSHIP_MAP.md:101` as `data.todaysAppointments`)
  already exists in the client contract and is filled by the mock fixture but **never
  populated live and never read by the screen**. The intended architecture for this tile
  and list is therefore already declared; this design implements it.
- Money: `settlement.Service.Settle` (finance/settlement/service.go:342-391) CREDITS the
  provider's `user_wallet` via the ledger, and `telemedicine.CompleteAppointment`
  (service.go:700-706) settles with `ProviderPct: 0.85 / PlatformPct: 0.15 /
  ServiceFeeKobo: appt.PlatformFeeKobo`. So `ledger.GetBalance` (what `Available` shows
  today) *does* contain 85% of every completed consult — it is real money, but it also
  contains every other wallet credit, so it cannot be reported as consult revenue.
- Satisfaction already has a projection: `repository_account_tail.go` `GetReputation`
  reads `AVG(rating), COUNT(*) FROM doctor_reviews WHERE user_id = $1 AND rating IS NOT
  NULL` (`doctor_reviews.user_id` is documented in the DDL as "reviewed doctor"), exposed
  at `GET /doctor/reputation`.
- Timezone: two columns carry one, both `text NOT NULL DEFAULT 'Africa/Lagos'` —
  `doctor_profiles.timezone` (`20260625000000_doctor_module.sql:60`) and
  `doctor_availability.timezone` (same file, `:165`). Only the first is a setting: the app's
  one timezone screen, `app/(doctor)/schedule/timezone.tsx:26`, saves through
  `PUT /schedule/timezone` → `Service.SetTimezone` (`service_ops.go:360`) →
  `UPDATE doctor_profiles SET timezone` (`repository_ops.go:409`). The read-back is the profile
  read itself — `GET /doctor/profile` (`finance_routes.go:3102` → `Repository.GetProfile`,
  which scans `timezone` into `Profile.Timezone` at `model.go:33`). `GET /schedule` is **not** a
  read-back: its `ScheduleSettings` response (`handler_tail2.go:493-498`) carries
  `blockedDates / recurringRules / reminders / vacation` and no timezone field — see
  Follow-ups F5. `doctor_availability.timezone` is written only as a side effect of the
  availability upsert (`repository.go:149`, from whatever `in.Timezone` the client echoed) and
  no screen sets it. Nothing in this module applies either column to a booking yet —
  `AT TIME ZONE` appears nowhere in `internal/doctor/*.go`, which is precisely why "today" has
  never been the doctor's day here.
- Two render defects in `src/features/doctor/components/AppointmentRow.tsx`:
  `TYPE_ICON[appointment.consultType]` is `undefined` whenever the booking's
  `consultation_type` is `'in_person'` — that value is allowed by the live CHECK
  (`appointments_consultation_type_check`: `video|audio|chat|in_person`,
  `20260618040000_telemedicine_clinical.sql:10`) but is not a key of the map (nor a member
  of `ConsultType`), and rendering `undefined` as a component crashes the screen. It also
  misses on a NULL from the orphan-table read.
  Separately, `new Date(\`${slotDate}T00:00:00\`)` yields "Invalid Date" whenever `slotDate`
  arrives as a full timestamp (which is what the current `Appointment.SlotDate *time.Time`
  serialises to).
  > **Correction (2026-11-15, from Task 6's review — the defect above is stated as if
  > observable, and neither half was.)** No value reached this component in a shape that could
  > trigger either defect at spec-approval time. `*time.Time` does serialise to a full timestamp,
  > but that is upstream of the RN mapper: `slotParts` (`src/features/telemedicine/mapping.ts:131-142`)
  > already re-formats it to a `YYYY-MM-DD` `slotDate` before a `DoctorAppointment` is built, and the
  > new queue path produces `to_char(..., 'YYYY-MM-DD')`
  > (`backend/internal/doctor/dashboard_metrics.go:218`). Likewise `in_person` cannot arrive on the
  > old path, because `mapConsultType` (`mapping.ts:124-128`) collapses every unrecognised type to
  > `'video'` and no screen read `dashboard.todaysAppointments` until this PR rewired the queue.
  > So both render defects are **preconditions this PR creates the route for**, not repairs of
  > behaviour a doctor could see — the fixes stand, the motivating observations do not. Line 282's
  > "cannot render Invalid Date for any shape the server sends" remains literally true, and is now
  > the weaker claim: the server only ever sends one shape.
- `EXPO_PUBLIC_DOCTOR_USE_MOCK` is `false` locally and `mockPolicy.ts` forces mockless in
  staging/production, so these tiles are live-mode behaviour, not a dev-only artefact.
  `mobile-app/reactnative/docs/QA_DOCTOR_BATCH1_REPORT.md` records D1 as PASS from the mock fixtures — a false
  green.

## Decisions

**D1 — Fix the tiles through `/dashboard`, not through `/appointments`.** A concurrent
session holds an uncommitted rewrite of `ListAppointments` plus accept/reject write-back
(`appointments_plane_live_db_test.go`). This design does not touch `ListAppointments`,
`GET /appointments`, the appointment requests, or `Appointment.SlotDate`. The dashboard
gets its own reads. Consequence: the dashboard queue and the Appointments tab are two
projections of the same rows until that branch lands — see Follow-ups F1.

**D2 — Count and list come from one query.** `todayCount` and the queue rows are produced
by the same repository call, so tile 1 can never disagree with the list under it.

**D2a — The list is capped at 20, the count is not.** `todaysCount` is the true
`COUNT(*)` over the predicate; `todaysAppointments` carries the first 20 rows in
doctor-local ascending slot order. A day with more than 20 consults therefore shows the
real number on the tile and 20 rows below it — a summary endpoint should not carry an
unbounded list, and the queue is a preview, not the appointments screen.

**D3 — Date logic lives in SQL**, via `AT TIME ZONE $2::text`, where `$2` is the doctor's zone
resolved once in Go and passed down. No `time.LoadLocation`, no `time/tzdata` import, no new
dependency — the Go side never has to know what Asia/Karachi means. The zone comes from the
existing scoped `Repository.GetProfile` read, because `doctor_profiles.timezone` is the column
the timezone screen writes and the profile read returns (see above); `ErrNotFound` (a doctor with no
profile row at all) and an empty value both map to `Africa/Lagos` in Go, the same fallback the
availability write path uses at `repository.go:149`. One resolved value feeds all three reads,
so the day cannot drift between them. `doctor_availability.timezone` is deliberately not a
source: no screen sets it, so reading it would add a second zone nobody can predict from the UI.

**D3a — a zone Postgres will not accept also maps to `Africa/Lagos`** (added during Task 2's
review, which asked what happens to the read when the column holds junk). `PUT /schedule/timezone`
stores its body verbatim — `service_ops.go:365` defaults only the empty string and validates no
IANA name — so `doctor_profiles.timezone` can already hold a value the server rejects. Before this
PR that was inert, because the column was only ever selected or written; once a date expression
interpolates it, `AT TIME ZONE` raises SQLSTATE 22023 and takes the whole dashboard down. Rather
than trust the write path, the read asks Postgres the same question it will later answer
(`to_char(CURRENT_TIMESTAMP AT TIME ZONE $1::text, …)`), falls back on 22023 alone, and lets every
other error surface — a dead pool must not look like an unset timezone. A catalog lookup is not
equivalent: `'-05'` and `'+05:30'` are absent from `pg_timezone_names` yet valid zones, so an
`EXISTS` check would silently overwrite a doctor's real setting.

**D4 — Metric definitions** (all scoped through `doctors d ON d.user_id = $1`, the signed-in
doctor's auth id, because `appointments.doctor_id` is a `doctors.id`):

| Metric | Predicate |
|---|---|
| Today's consults | `to_char(scheduled_at AT TIME ZONE tz,'YYYY-MM-DD') = <doctor-local today>` AND `status <> 'cancelled'` |
| Today's queue | the same rows, `ORDER BY scheduled_at ASC`, capped at 20 (see D2a) |
| Upcoming | `scheduled_at > now()` AND `status IN ('booked','confirmed')` |
| Consults this month | `status = 'completed'` AND `to_char(scheduled_at AT TIME ZONE tz,'YYYY-MM') = <doctor-local current month>` |
| Available | `ledger.GetBalance(userID)` — unchanged source, unchanged meaning |
| Pending revenue | Σ `ComputeLegs(total, split).ProviderKobo` over this doctor's `escrowed` telemedicine settlements |
| Lifetime / this-month revenue | Σ `settlements.provider_kobo` where `status='settled'`, all-time and doctor-local current month |
| Satisfaction | `ROUND(AVG(rating) / 5 * 100)` over `doctor_reviews`; `null` when `COUNT(*) = 0` |

`appointments.status` is constrained to exactly `booked|confirmed|completed|cancelled`
(`20260616280000_telemedicine.sql:28`), so "not cancelled" is the whole workload set and a
completed consult still counts as a consult that was on today's board.

**D5 — Pending revenue is computed by `settlement.ComputeLegs`, not in SQL.** That function
is the repo's single definition of the split algebra (`Settle` calls it). Re-deriving 85/15
with `FLOOR` in a query is exactly the drift it exists to prevent. The doctor module gains a
new import of `internal/finance/settlement` (verified cycle-free: settlement does not import
doctor, and `ComputeLegs` is a pure package-level function, so no DI change).

**D6 — `satisfactionPct` becomes nullable end-to-end.** Backend `*float64`, OpenAPI
`nullable`, client `number | null`, tile renders `—` on null. A doctor with no reviews has
no satisfaction score; showing `0%` states a false fact about them.

**D7 — `Available` keeps the wallet balance; consult revenue gets its own fields.** The tile
label "Available" means withdrawable money, and the wallet balance is exactly that. The
consult-scoped numbers land in the `earnings` fields that already exist in
`DoctorDashboardData` and are currently fabricated as `0`.

**D8 — Queue row shape.** A new `DashboardQueueAppointment` Go struct emits the JSON keys the
RN `DoctorAppointment` type already declares, with `slotDate` as a **date-only** string in the
doctor's local day (what the type documents as "ISO date") and `slotTime` as `"HH:MM AM"`.
Reusing `doctor.Appointment` is impossible without changing `SlotDate`'s type, which is D1's
excluded territory.
`consultType` passes the stored `consultation_type` through **unchanged**, including
`'in_person'`, rather than being coerced into `ConsultType` — a booking that says in-person
must not be displayed as a chat. The client cast is local to the adapter, and `AppointmentRow`
renders a fallback icon for any value outside its map. Widening `ConsultType` to include
`'in_person'` is the honest fix but is used across the telemedicine vertical, so it is
follow-up F4, not this PR.

**D9 — `patient.initials` / `avatarColor` are derived client-side.** They are presentation
tokens (a `Colors` reference in the mock data), not booking facts, so they stay off the wire.
The adapter derives initials from the first letters of the first and last name words and picks
`avatarColor` from a fixed 5-entry palette indexed by a hash of the patient id, so a patient's
avatar is stable across renders. `PatientSummary.age` and `.gender` come from `user_profiles`;
an absent gender maps to `'other'`.

## Interface

`GET /api/v1/doctor/dashboard` — additive; existing four keys keep their meaning.

```jsonc
{
  "appointmentCounts":   { "booked": 3, "confirmed": 1, … },   // unchanged
  "unreadNotifications": 2,                                    // unchanged
  "walletBalanceKobo":   255000,                               // unchanged → "Available"
  "currency":            "NGN",                                // unchanged
  "metrics": {
    "todaysCount": 3,
    "upcomingCount": 5,
    "satisfactionPct": 96,          // null when the doctor has no reviews
    "ratingCount": 24,
    "revenue": {
      "pendingKobo": 170000,        // escrowed, via ComputeLegs
      "lifetimeKobo": 2040000,      // settled provider_kobo, all time
      "thisMonthKobo": 510000,      // settled provider_kobo, doctor-local month
      "consultsThisMonth": 12
    },
    "timezone": "Africa/Lagos",     // the anchor every date above used
    "today": "2026-11-13"           // doctor-local today, for display/debug
  },
  "todaysAppointments": [            // the rows behind todaysCount, ordered by slot
    { "id": "…", "ref": "TM-9F2A41",
      "patient": { "id": "…", "name": "Chidi Okeke", "age": 34, "gender": "male" },
      "consultType": "video", "status": "upcoming",
      "slotDate": "2026-11-13", "slotTime": "12:00 PM",
      "feeKobo": 200000, "reason": "…", "isHmo": false,
      "createdAt": "2026-11-11T09:12:00Z" }
  ]
}
```

Go: `DashboardSummary` gains `Metrics DashboardMetrics` (a value, not a pointer — it always
ships, so the client never has to distinguish "absent" from "zero") and
`TodaysAppointments []DashboardQueueAppointment` (both `json` tags as above;
`satisfactionPct` is `*float64`). `Service.GetDashboard` composes the new reads alongside
the existing three, keeping the method's documented rule — compose existing scoped reads,
project money, never store a balance.

Client: `DashboardWire` gains `metrics` and `todaysAppointments`; the adapter maps
`counts.todaysAppointments ← metrics.todaysCount`, `counts.upcomingAppointments ←
metrics.upcomingCount`, `satisfactionPct ← metrics.satisfactionPct ?? null`,
`earnings.{pendingKobo,lifetimeKobo,thisMonthKobo,consultsThisMonth} ← metrics.revenue.*`,
`earnings.availableKobo ← walletBalanceKobo` (the existing path, unchanged), and
`todaysAppointments ← wire.todaysAppointments` through the D9 patient mapping.

`src/types/doctor.batch1.ts`: `satisfactionPct: number | null`. `DoctorDashboardData.counts.todaysAppointments`
and `.upcomingAppointments` stay `number` (the backend always sends both, defaulting to 0 —
"no bookings today" is a true zero, unlike a missing score).

Contract: `contracts/doctor.openapi.yaml` `/dashboard` response moves from `Generic` to a
`DashboardSummary` schema describing the payload above.

Screen: `index.tsx` reads `counts?.todaysAppointments` (now real), drops the local
`ACTIVE_STATUSES`/`todays` status filter in favour of `dashboard.todaysAppointments`, and
renders `dashboard.satisfactionPct == null ? '—' : \`${pct}%\``.

## Data flow

```
expo (doctor dashboard, live mode)
  → BFF :3000 /api/v1/doctor/dashboard
    → Go :8080 doctor.Handler.Dashboard → Service.GetDashboard(userID)
        ├─ appointmentStatusCounts        (unchanged, doctor_appointments)
        ├─ unreadNotificationCount        (unchanged)
        ├─ ledger.GetBalance              (unchanged → wallet)
        ├─ repo.dashboardAggregates  ★new — appointments ⋈ doctors, doctor-local day/month
        ├─ repo.todayQueue           ★new — the same day, capped rows, UI status vocabulary
        ├─ repo.consultRevenue       ★new — settlements ⋈ appointments ⋈ doctors
        │                                + settlement.ComputeLegs for escrowed rows
        ├─ repo.GetProfile                (existing → the doctor's timezone)
        └─ repo.GetReputation             (existing → satisfaction)
  → adapter maps wire → DoctorDashboardData → StatCards + AppointmentRow list
```

## Error handling

- A doctor with no `doctors` row, no `doctor_profiles` row, no bookings, no reviews and
  no settlements gets `200` with zeros, an empty `todaysAppointments`, and
  `satisfactionPct: null` — never `404`, never a crash. The timezone comes from
  `Repository.GetProfile`, whose `ErrNotFound` maps to `Africa/Lagos` in Go — the same
  fallback the availability write path applies at `repository.go:149` (`strOrDefault(in.Timezone,
  "Africa/Lagos")`) and the value of both timezone columns' own `NOT NULL DEFAULT`. The resolved
  zone is then a query parameter, so all three reads price the same day.
- `GetReputation` already returns a zeroed `ReputationSummary` on no rows; `GetDashboard`
  maps `ReviewCount == 0` to a null `satisfactionPct` rather than trusting the averaged 0.
- One read failing fails the whole endpoint (unchanged behaviour — `GetDashboard` returns
  the error today). No partial payload, no silent fallback to zeros: a zero that came from a
  failed query is indistinguishable from a real zero, which is how this bug hid.
- `settlement.ComputeLegs` erroring (malformed stored row) is returned wrapped as
  `doctor: project pending consult revenue: %w`, matching the existing ledger error style.
- Queue rows never enter the client as `undefined`: the adapter emits `wire.todaysAppointments ?? []`.
- `AppointmentRow` gets a fallback icon for an unknown/absent `consultType`, and its date
  parse accepts both `YYYY-MM-DD` and a full timestamp (split on `T`, take the date part,
  build the local date) so it cannot render "Invalid Date" for any shape the server sends.

## Testing

Go, `backend/internal/doctor/dashboard_metrics_live_db_test.go` (new; `TEST_DATABASE_URL`-gated,
self-cleaning fixture; owns fresh `auth.users`, `doctors`, `doctor_profiles`,
`appointments`, `settlements`, `ledger_entries`, `doctor_reviews` rows):

- Today's count is the **doctor's** day: a booking at 23:30 WAT yesterday and one at
  00:30 WAT today land on different sides of the boundary than a UTC day would put them. The
  zone under test is written the way the app writes it — `doctor_profiles.timezone` — so the
  test fails if the read ever points at a column no screen sets.
- `cancelled` excluded from today's count but `completed` included.
- Upcoming excludes a past `booked` row and every cancelled/completed row.
- `todaysCount == len(todaysAppointments)` (D2) and the rows are ascending by slot; a
  21-row day yields `todaysCount: 21` with 20 rows (D2a).
- Scoping: an appointment for a second doctor never counts, and the queue never lists it.
- Brand-new doctor: every count 0, queue empty, `satisfactionPct` nil — `err == nil`. The
  same call resolves the timezone to `Africa/Lagos` rather than failing, so the no-profile-row
  branch of D3 is executed by an assertion, not only by a comment.
- Revenue: settled telemedicine settlement → `lifetimeKobo`/`thisMonthKobo` =
  `provider_kobo`; escrowed one → `pendingKobo` equals what `ComputeLegs` yields for the
  same total and split (asserted by calling the function, not by a hand-computed literal);
  a `refunded` settlement contributes to neither; a settled non-telemedicine settlement for
  the same user contributes to neither; the wallet balance is unaffected by either.
- Satisfaction: ratings 4,5,5 → 93 (rounded), `ratingCount` 3; no rows → nil; a review of a
  *different* doctor does not move it.
- Queue wire shape: `slotDate` matches `^\d{4}-\d{2}-\d{2}$` and `status` is in the UI
  vocabulary, asserted from the marshalled JSON like the neighbour's plane test does.

Client, `mobile-app/reactnative/src/features/doctor/__tests__/dashboardWire.test.ts` (new;
`node --experimental-strip-types --test`, the runner this module already uses for
`batch6Wire.test.ts` — the react-native package has no jest):
the adapter maps a representative wire payload onto all five metrics, maps a null
`satisfactionPct` through as null, tolerates a missing `metrics` object (all zeros, `[]`,
never `undefined`), derives stable `initials`/`avatarColor`, and no live branch still
returns a literal `0` for a metric the wire supplied.

Gate commands before publishing: `go build ./... && go vet ./...` in `backend/`, the doctor
package tests with `TEST_DATABASE_URL` pointed at the local dev DB, the RN unit spec,
`tsc --noEmit` for `mobile-app/reactnative`, and `redocly lint` on the contracts workspace.

Browser acceptance (the user-visible claim): against the local stack with a seeded fixture —
bookings spanning yesterday/today/tomorrow plus a settled and an escrowed consult and two
reviews — the five tiles show the seeded numbers and the queue lists exactly today's rows.
This needs the API container rebuilt and Metro restarted, both shared with other sessions;
it is therefore run as a locally built binary on a spare port against the same dev DB for
the wire evidence, and the in-browser pass is done only with an explicit go-ahead.

## Out of scope

- `ListAppointments` / `GET /appointments`, `appointment-requests`, accept/reject
  write-back, and `doctor.Appointment.SlotDate`'s type — the in-flight branch owns them.
- The Appointments tab, `/queue` (`doctor_consult_queue`), `earnings.payouts` (no doctor
  payout table exists to project), `activeConsultation`, `waitingRoom`, `unreadMessages`
  beyond the existing notification count, and every other zero in `counts` the dashboard
  does not display.
- The presence / announcement / `mapHeaderAvatar` edits already in the shared dirty tree.
- Any migration: everything reads existing tables and columns.
- Retiring `appointmentStatusCounts` or the orphan tables.

## Risks and follow-ups

- **R1 — same-module concurrency.** Another session's uncommitted diff rewrites
  `ListAppointments` and edits `doctor.batch1.api.ts` and `(tabs)/index.tsx`, the two client
  files this PR also edits. Published first, this PR makes their rebase non-trivial in those
  files (their `repository.go`/`service.go`/`handler.go` changes are unaffected). Mitigation:
  edits in those two client files are additive and line-minimal, and D8's row shape
  deliberately matches the contract their test pins (`slotDate` date-only, UI status
  vocabulary), so the two projections agree rather than compete.
- **F1 — one projection.** Once the `/appointments` repoint is on `main`, fold
  `DashboardQueueAppointment`'s SQL and their `appointmentColumns` into one const, and switch
  the queue to `GET /appointments?scope=today&limit=20` so the tile and the tab share a read.
- **F2 — stale QA.** `mobile-app/reactnative/docs/QA_DOCTOR_BATCH1_REPORT.md` records D1/D13 as PASS on mock
  fixtures. Rewrite those rows against live mode as part of this change's verification.
- **F3 — a doctor is also a patient.** `Available` is the whole `user_wallet` balance, so a
  doctor's own spend refunds inflate it relative to "revenue". D7 keeps the label honest;
  renaming the tile to "Wallet" is a one-line product call, not a data fix.
- **F4 — `ConsultType` has no `'in_person'`.** The booking table's CHECK allows it, so the
  doctor module passes it through (D8) and `AppointmentRow` draws a fallback icon. Widening
  the union to the four real values, and giving in-person consults their own icon, touches the
  telemedicine vertical's shared type and every `ConsultType` consumer — its own change.
- **F5 — the timezone screen cannot save in live mode, so the zone this PR reads is almost
  always the default.** Discovered while correcting D3. `app/(doctor)/schedule/timezone.tsx:20-22`
  seeds `tz` from `useScheduleSettings()`'s `settings.timezone`, but `GET /schedule` sends no
  timezone field at all (its `ScheduleSettings` has four keys and none of them is a zone), so in
  live mode `tz` becomes `undefined` and `handleSave`'s `if (!tz) return;` makes the save button a
  no-op — `PUT /schedule/timezone` is never called and `doctor_profiles.timezone` stays
  `'Africa/Lagos'`. The QA row F2 refers to (`QA_DOCTOR_BATCH1_REPORT.md` E13, "PASS") was earned
  on mock fixtures, which do return a timezone. **Consequence for this PR:** D3's column choice is
  correct and its Karachi test proves the mechanism, but on real data the corrected read rarely
  diverges from the old default — the fix unlocks the behaviour, it does not yet exercise it.
  Repairing the screen (seed `tz` from the profile read, or add `timezone` to `ScheduleSettings`
  and populate it) is one small change in either plane and belongs to no task here; it is out of
  scope because it edits neither the dashboard nor the aggregate.
  **Correction (2026-11-15, after #1008 landed):** the parenthetical above is now stale — `GET /schedule`
  does send a zone since #1008, because `ScheduleSettings` nests the availability row
  (`backend/internal/doctor/handler_tail2.go:499`, whose `Availability.Timezone` is
  `backend/internal/doctor/model.go:76`). The F5 outcome is unchanged: that zone arrives under
  `schedule`, the screen still reads the top-level `settings.timezone` (`app/(doctor)/schedule/timezone.tsx:21`),
  and the client's `AvailabilitySchedule` (`src/types/doctor.ts:262-269`) does not declare the nested field,
  so the live-mode no-op stands. What did change is the meaning of a repair: seeding `tz` from
  `settings.schedule.timezone` would make the button work while displaying `doctor_availability.timezone`
  — the column `PUT /schedule/timezone` does not write and `repository.go:220-221` now reads.
