# Doctor Batch 1 — File Ownership Map

Batch 1 = spec **sections C, D, E, F** (73 entries). This is **additive** to
Phase 1, Phase 2, Section B and Phase 3: nothing in earlier contracts is edited
(only barrels gain new export lines). Money is always integers in **kobo**.

**Consolidation principle:** action/state variants (accept/reject, empty/error,
confirmation steps, countdowns, late warnings) are modelled as **states/data**,
not separate entities. The tables below mark each entry as a **full screen**, a
**STATE of** an existing/sibling screen, a **SHEET on** a screen, or a
**REUSES existing** route. Frontend builds the variants from one data shape.

## Ownership boundaries (do not cross)

### BACKEND (data/type contract) — owns
- `src/types/doctor.batch1.ts`                        *(new)*
- `src/api/doctor.batch1.api.ts`                       *(new)*
- `src/features/doctor/hooks/useVetProfile.ts`         *(new — Section C)*
- `src/features/doctor/hooks/useDashboard.ts`          *(new — Section D)*
- `src/features/doctor/hooks/useSchedule.ts`           *(new — Section E)*
- `src/features/doctor/hooks/useQueue.ts`              *(new — Section F)*
- `src/features/doctor/constants/batch1.ts`            *(new)*
- `src/features/doctor/hooks/index.ts`                 *(edited — additive export lines only)*
- `src/features/doctor/constants/index.ts`             *(edited — additive export line only)*

> Backend continues to own the Phase 1 / 2 / Section B / Phase 3 files unchanged.

### FRONTEND (screens/UI) — owns
- `app/(doctor)/**` (all route files)
- `src/features/doctor/components/**`

### QA — owns
- `docs/QA_DOCTOR_BATCH1_REPORT.md`

> Frontend consumes Backend's hooks/types only — never imports from
> `doctor.batch1.api.ts` directly (use the hooks). All money is kobo; format with
> `formatKobo` (re-exported from `@/api/doctor.batch1.api`, `@/api/doctor.api`).

---

## Reused existing work (do NOT recreate)

| Area | Existing asset | Reused hook / type |
|------|----------------|--------------------|
| Availability base | `app/(doctor)/availability.tsx` | `useAvailability`, `useUpdateAvailability`, `AvailabilitySchedule`, `WorkingDay`, `ScheduleBreak` |
| Appointments | `app/(doctor)/(tabs)/appointments.tsx` | `useAppointments`, `useAppointment`, `useUpdateAppointmentStatus`, `DoctorAppointment`, `ConsultStatus` |
| Dashboard host | `app/(doctor)/(tabs)/index.tsx` | new `useDashboard` aggregate renders on the existing tab |
| Vet builder primitives | Section B profile builder | `PersonalInfo`, `ClinicAffiliation`, `WorkExperienceEntry`, `ConsultationPricing`, `ProfileLicenceInfo`, `UploadedFile`, `ProfileDocumentSlot`, `VerificationDecision`, `LicenceExpiryWarning`, `LicenceRenewal` |
| Earnings | Phase 1 | `EarningsSummary` (embedded in `DoctorDashboardData`) |
| Pet species | Phase 3 | `PetSpecies`, `PET_SPECIES_OPTIONS`, `PET_SPECIES_LABELS` |

REUSED constants (from the barrel — not duplicated): `WEEKDAYS`,
`CONSULT_DURATION_OPTIONS`, `BUFFER_OPTIONS`, `SPECIALTY_OPTIONS`,
`PET_SPECIES_OPTIONS`, `PET_SPECIES_LABELS`, `CONSULT_FEE_PRESETS_KOBO`,
`NIGERIAN_STATES`, `LANGUAGE_OPTIONS`, `DEGREE_OPTIONS`.

REUSED mutation: Phase 1 `useUpdateAppointmentStatus` covers generic status
transitions the Section F named mutations don't.

---

## Section C — Veterinary Doctor Profile & Verification (17)

A wizard under `app/(doctor)/vet/profile/setup/<step>` drives the builder; the
verification lifecycle lives as sibling stack screens under
`app/(doctor)/vet/profile/`. Hooks from `useVetProfile.ts`.

| # | Entry | Screen vs State | Proposed route / location | Hook(s) | Key types |
|---|-------|-----------------|---------------------------|---------|-----------|
| C1 | Create vet profile (hub) | full screen | `vet/profile/setup/index` | `useVetProfileDraft` | `VetProfileDraft`, `VetProfileBuilderStep` |
| C2 | Vet personal info | full screen | `vet/profile/setup/personal` | `useVetProfileDraft`, `useSaveVetProfileDraft` | `PersonalInfo` |
| C3 | Vet specialty selection | full screen | `vet/profile/setup/specialty` | `useVetProfileDraft`, `useSaveVetProfileDraft` | `VetProfileDraft` (+ `VET_SPECIALTY_OPTIONS`) |
| C4 | Pet species specialisation | full screen | `vet/profile/setup/species` | `useVetProfileDraft`, `useSaveVetProfileDraft` | `PetSpecies` (+ `PET_SPECIES_OPTIONS`) |
| C5 | Veterinary licence entry | full screen | `vet/profile/setup/licence-number` | `useVetProfileDraft`, `useSaveVetProfileDraft` | `VetLicenceInfo` (+ `VET_LICENCE_BODIES`) |
| C6 | Veterinary licence upload | full screen | `vet/profile/setup/licence-upload` | `useVetDocumentSlots`, `useSaveVetProfileDraft` | `ProfileDocumentSlot`, `UploadedFile` |
| C7 | Vet certificates upload | full screen | `vet/profile/setup/certificates` | `useVetProfileDraft`, `useSaveVetProfileDraft` | `UploadedFile` |
| C8 | Vet clinic affiliation | full screen | `vet/profile/setup/affiliations` | `useVetProfileDraft`, `useSaveVetProfileDraft` | `ClinicAffiliation` (+ `NIGERIAN_STATES`) |
| C9 | Vet experience history | full screen | `vet/profile/setup/experience` | `useVetProfileDraft`, `useSaveVetProfileDraft` | `WorkExperienceEntry` |
| C10 | Vet consultation pricing (kobo) | full screen | `vet/profile/setup/pricing` | `useVetProfileDraft`, `useSaveVetProfileDraft` | `ConsultationPricing` (+ `CONSULT_FEE_PRESETS_KOBO`) |
| C11 | Vet availability | REUSES existing | `availability` (Phase 1) | `useAvailability`, `useUpdateAvailability` | `AvailabilitySchedule` |
| C12 | Vet profile preview | full screen | `vet/profile/setup/preview` | `useVetProfileDraft` | `VetProfileDraft` |
| C13 | Verification submitted | STATE of C14 (`status==='pending'`, just-submitted) | `vet/profile/verification` | `useVetVerification`, `useSubmitVetVerification` | `VetVerificationSubmission` |
| C14 | Verification pending | full screen | `vet/profile/verification` | `useVetVerification` | `VetVerificationSubmission` (`status==='pending'`) |
| C15 | Verification approved | STATE of C14 (`status==='approved'`) | `vet/profile/verification` | `useVetVerification` | `VetVerificationSubmission.decision`, `VerificationDecision` |
| C16 | Verification rejected | STATE of C14 (`status==='rejected'`) | `vet/profile/verification` | `useVetVerification`, `useSubmitVetVerification` (resubmit) | `VetVerificationSubmission.decision` |
| C17 | Vet licence renewal | full screen | `vet/profile/licence/renew` | `useRenewVetLicence` | `RenewVetLicenceInput`, `LicenceExpiryWarning`, `LicenceRenewal` |

> Publish (`usePublishVetProfile`) is the success terminal of C15 (approved) →
> published, surfaced as a state/CTA, not a separate screen.

---

## Section D — Doctor Dashboard (21)

A single `DoctorDashboardData` aggregate powers the existing dashboard tab; every
widget below is a **section/card of that one screen** reading one slice of the
aggregate. Hooks from `useDashboard.ts`.

| # | Entry | Screen vs State | Location | Source slice | Key types |
|---|-------|-----------------|----------|--------------|-----------|
| D1 | Today's appointments | card on dashboard | `(tabs)/index` | `data.todaysAppointments` / `counts.todaysAppointments` | `DoctorAppointment` |
| D2 | Upcoming appointments | card on dashboard | `(tabs)/index` | `counts.upcomingAppointments` | `DoctorAppointment` |
| D3 | Pending consultation requests | card on dashboard → deep-links Section F | `(tabs)/index` | `data.pendingRequests` / `counts.pendingRequests` | `DoctorAppointment` |
| D4 | Active consultation card | card on dashboard (present when live) | `(tabs)/index` | `data.activeConsultation` | `ActiveConsultationCard` |
| D5 | Waiting-room queue | card on dashboard → deep-links Section F | `(tabs)/index` | `data.waitingRoom` / `counts.waitingRoom` | `WaitingRoomEntry` |
| D6 | Follow-up requests | alert/card | `(tabs)/index` | `alerts[kind='follow_up']` / `counts.followUpRequests` | `DashboardAlert` |
| D7 | Unread patient messages | card on dashboard | `(tabs)/index` | `data.messages` / `counts.unreadMessages` | `DashboardMessagePreview` |
| D8 | New lab-results alert | alert | `(tabs)/index` | `alerts[kind='new_lab_result']` | `DashboardAlert` |
| D9 | Pending prescriptions | alert | `(tabs)/index` | `alerts[kind='pending_prescription']` | `DashboardAlert` |
| D10 | Refill requests | alert | `(tabs)/index` | `alerts[kind='refill_request']` | `DashboardAlert` |
| D11 | HMO approval alerts | alert | `(tabs)/index` | `alerts[kind='hmo_approval']` | `DashboardAlert` |
| D12 | Earnings summary | card on dashboard | `(tabs)/index` | `data.earnings` | `EarningsSummary` |
| D13 | Patient satisfaction rating | card/stat | `(tabs)/index` | `data.satisfactionPct` | `number` |
| D14 | Online/offline + availability status | header control + SHEET | `(tabs)/index` | `data.presence`, `data.acceptsInstant` | `DoctorPresence`, `useSetPresence` |
| D15 | Urgent case alert | alert (severity `critical`) | `(tabs)/index` | `alerts[kind='urgent_case']` | `DashboardAlert` |
| D16 | Compliance alert | alert | `(tabs)/index` | `alerts[kind='compliance']` | `DashboardAlert` |
| D17 | Profile-completion reminder | alert | `(tabs)/index` | `alerts[kind='profile_completion']` | `DashboardAlert` |
| D18 | Licence-expiry alert | alert | `(tabs)/index` | `alerts[kind='licence_expiry']` | `DashboardAlert` |
| D19 | Platform announcement | banner | `(tabs)/index` | `data.announcement` | `PlatformAnnouncement`, `useDismissAnnouncement` |
| D20 | Doctor-late warning | STATE (via `alerts[kind='doctor_late']` + Section F countdown) | `(tabs)/index` / queue | `DashboardAlert` + `ConsultCountdown.isDoctorLate` | `DashboardAlert`, `ConsultCountdown` |
| D21 | Dashboard empty / error | STATE of dashboard | `(tabs)/index` | `isPending` / `isError` / empty `alerts` | — |

> D6–D11, D15–D18, D20 are all rows of the single `DashboardAlert[]` union,
> distinguished by `kind` + `severity` and rendered from `ALERT_*` label/tone maps.

---

## Section E — Availability & Schedule Management (17)

Extends the existing availability screen with a `ScheduleSettings` aggregate.
Hooks from `useSchedule.ts`. The existing `availability.tsx` (working days /
hours / breaks / duration) stays; new settings are sibling screens or sheets.

| # | Entry | Screen vs State | Proposed route / location | Hook(s) | Key types |
|---|-------|-----------------|---------------------------|---------|-----------|
| E1 | Working days | REUSES existing | `availability` | `useAvailability`, `useUpdateAvailability` | `WorkingDay` |
| E2 | Working hours | REUSES existing | `availability` | `useAvailability`, `useUpdateAvailability` | `WorkingDay` |
| E3 | Break time | REUSES existing | `availability` | `useAvailability`, `useUpdateAvailability` | `ScheduleBreak` |
| E4 | Consultation duration | REUSES existing | `availability` | `useAvailability`, `useUpdateAvailability` | `AvailabilitySchedule` (+ `CONSULT_DURATION_OPTIONS`) |
| E5 | Instant vs appointment-only | STATE/toggle on schedule | `availability` / `schedule/settings` | `useScheduleSettings` | `ScheduleSettings.appointmentOnly` |
| E6 | Block unavailable date | full screen / SHEET | `schedule/blocked-dates` | `useBlockedDates`, `useBlockDate` | `BlockedDate`, `BlockDateInput` |
| E7 | Vacation / unavailable mode | full screen | `schedule/vacation` | `useScheduleSettings`, `useSetVacation` | `VacationPeriod`, `SetVacationInput` |
| E8 | Emergency availability toggle | STATE/toggle | `schedule/settings` | `useScheduleSettings`, `useToggleEmergency` | `ScheduleSettings.emergencyAvailable` |
| E9 | Reschedule appointment | SHEET on appointment | from `appointments` / queue | `useRescheduleAppointment` | `RescheduleAppointmentInput` |
| E10 | Cancel appointment | SHEET on appointment | from `appointments` / queue | `useCancelAppointment` | `CancelAppointmentInput` |
| E11 | Appointment reminder settings | full screen | `schedule/reminders` | `useScheduleSettings`, `useSaveReminderSettings` | `ReminderSettings` (+ `REMINDER_OFFSET_OPTIONS`) |
| E12 | Recurring availability setup | full screen | `schedule/recurring` | `useScheduleSettings`, `useSaveRecurringRule` | `RecurringRule` (+ `RECURRENCE_OPTIONS`) |
| E13 | Timezone settings | full screen / SHEET | `schedule/timezone` | `useScheduleSettings`, `useSetTimezone` | `TimezoneOption` (+ `TIMEZONE_OPTIONS`) |
| E14 | Overbooking warning | STATE (inline) | any schedule edit | `checkOverbooking` (helper) | `OverbookingCheck` |
| E15 | Saved confirmation | STATE of any save mutation | all of the above | mutation `isSuccess` | — |
| E16 | Schedule settings hub | full screen | `schedule/settings` | `useScheduleSettings` | `ScheduleSettings` |
| E17 | Empty / error states | STATE | all schedule screens | query `isPending` / `isError` | — |

---

## Section F — Appointment & Consultation Queue (18)

Reuses Phase 1 `DoctorAppointment` + `useUpdateAppointmentStatus`. Accept/reject,
missed/no-show, late and countdown are **states/data**, not separate screens.
Hooks from `useQueue.ts`.

| # | Entry | Screen vs State | Proposed route / location | Hook(s) | Key types |
|---|-------|-----------------|---------------------------|---------|-----------|
| F1 | Appointment list | REUSES existing | `(tabs)/appointments` | `useAppointments` | `DoctorAppointment` |
| F2 | Appointment detail | REUSES existing (extended) | `appointments/[id]` | `useAppointment` | `DoctorAppointment`, `AppointmentBilling` |
| F3 | Pending request | full screen | `appointments/requests` | `useAppointmentRequests` | `AppointmentRequest` |
| F4 | Request detail | full screen | `appointments/requests/[id]` | `useAppointmentRequest` | `AppointmentRequest` |
| F5 | Accept appointment | STATE/action on F3/F4 (`status='accepted'`) | request detail | `useAcceptAppointment` | `AcceptAppointmentInput` |
| F6 | Reject appointment | STATE/action on F3/F4 (`status='rejected'`) | request detail (SHEET) | `useRejectAppointment` | `RejectAppointmentInput` (+ `APPOINTMENT_REJECT_REASONS`) |
| F7 | Reschedule request | STATE/action on F3/F4 (`status='reschedule_requested'`) | request detail (SHEET) | `useRequestReschedule` | `RequestRescheduleInput` |
| F8 | Patient waiting room | full screen | `queue/waiting-room` | `useConsultationQueue` (filter waiting) | `ConsultationQueueItem` |
| F9 | Consultation queue | full screen | `queue` | `useConsultationQueue` | `ConsultationQueueItem` |
| F10 | Priority queue | STATE/sort of F9 | `queue` (sorted by `priority`) | `useConsultationQueue` | `QueuePriority` (+ `QUEUE_PRIORITY_*`) |
| F11 | HMO-covered appointment detail | STATE of F2 (`billing='hmo'`) | `appointments/[id]` | `useAppointment` | `AppointmentBilling` (+ `APPOINTMENT_BILLING_*`) |
| F12 | Paid appointment detail | STATE of F2 (`billing='paid'`) | `appointments/[id]` | `useAppointment` | `AppointmentBilling` |
| F13 | Free-follow-up appointment detail | STATE of F2 (`billing='free_follow_up'`) | `appointments/[id]` | `useAppointment` | `AppointmentBilling` |
| F14 | Missed / no-show | STATE/action (`status='cancelled'`) | appointment / queue | `useMarkNoShow` | `MarkNoShowInput` |
| F15 | Doctor-late warning | STATE (inline) | queue / detail | `computeConsultCountdown` (helper) | `ConsultCountdown.isDoctorLate` |
| F16 | Consultation countdown | STATE (inline) | queue / detail | `computeConsultCountdown` (helper) | `ConsultCountdown` |
| F17 | Start consultation | STATE/action (`status='in_progress'`) | queue / detail | `useStartConsultation` | `StartConsultationInput` |
| F18 | End consultation | STATE/action (`status='completed'`) | active consult | `useEndConsultation` | `EndConsultationInput` |

> F10–F13 are sort/filter/data states of one queue/detail; F5–F7, F14, F17–F18
> are intent-named mutation actions whose outcome is reflected in `status`.

---

## Loading / error / empty conventions (mirror earlier phases)
- Every read hook ships `placeholderData` (a `DEMO_*`) so first paint has content.
- **Loading:** `isPending` (gate skeletons on `isPlaceholderData` where a true
  spinner is wanted).
- **Error:** `isError` + `error`; render a retry affordance.
- **Empty:** arrays may be `[]` (no requests / empty queue / no alerts) — render
  an empty state. Detail reads (`getAppointmentRequest`, `getAnnouncement`,
  vacation) may resolve `undefined` — render not-found / "none configured".
- **Confirmation / state variants:** consolidated — read from `status` / mutation
  `isSuccess` / the countdown helper, not from separate entities.
- **Money:** integers in kobo; format with `formatKobo`. Never do float math.
- Mutations expose `mutate` / `mutateAsync`, `isPending`, `isError`, `error`;
  Frontend passes inputs **without** `idempotencyKey` (`Omit<…,'idempotencyKey'>`).
