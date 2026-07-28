# Doctor API Contract — Batch 1 (sections C · D · E · F)

Reference for the Frontend role. ADDITIVE to the Phase 1 / Phase 2 / Section B /
Phase 3 contracts. All data is **demo data** resolved with simulated latency
(`wait()`); Phase C swaps bodies for live endpoints + the `Idempotency-Key`
header. Money is always an integer in **kobo**. Path alias is `@/` → `src/`. Use
`import type` for type-only imports.

- Types:     `@/types/doctor.batch1`   (re-exports the primitives it reuses)
- API:       `@/api/doctor.batch1.api` (Frontend should NOT call these directly — use hooks; pure helpers are an exception)
- Hooks:     `@/features/doctor/hooks`  (same barrel as earlier phases)
- Constants: `@/features/doctor/constants` (same barrel; Batch 1 lists re-exported)
- Money fmt: `formatKobo(kobo)` — re-exported from `@/api/doctor.batch1.api` (and `@/api/doctor.api`)

**Consolidation:** action/state variants are modelled as states/data. See the
Ownership Map for which spec entries are full screens vs states vs reuse-existing.

---

## 1. Exported types (`@/types/doctor.batch1`)

**Re-exported from Phase 1 (`@/types/doctor`):** `VerificationStatus`,
`AvailabilitySchedule`, `WorkingDay`, `ScheduleBreak`, `DoctorAppointment`,
`ConsultStatus`, `ConsultType`, `EarningsSummary`.
**From Phase 2 (`@/types/doctor.phase2`):** `LicenceStatus`.
**From Section B (`@/types/doctor.profile`):** `PersonalInfo`,
`ClinicAffiliation`, `WorkExperienceEntry`, `ConsultationPricing`,
`ProfileLicenceInfo`, `UploadedFile`, `ProfileDocumentSlot`,
`VerificationDecision`, `LicenceExpiryWarning`, `LicenceRenewal`.
**From Phase 3 (`@/types/doctor.phase3`):** `PetSpecies`.

### Section C — vet profile & verification
`VetLicenceBody`, `VetLicenceInfo`, `VetProfileBuilderStep`, `VetProfileDraft`,
`VetVerificationSubmission`.

### Section D — dashboard
`DoctorPresence`, `DashboardAlertKind`, `DashboardAlertSeverity`,
`DashboardAlertCta`, `DashboardAlert`, `AnnouncementTone`,
`PlatformAnnouncement`, `DashboardMessagePreview`, `ActiveConsultationCard`,
`WaitingRoomEntry`, `DashboardCounts`, `DoctorDashboardData`.

### Section E — availability & schedule
`BlockedDate`, `VacationPeriod`, `ReminderSettings`, `RecurrenceFrequency`,
`RecurringRule`, `TimezoneOption`, `ScheduleSettings`, `OverbookingCheck`.

### Section F — appointment & consultation queue
`AppointmentBilling`, `QueuePriority`, `ConsultationQueueItem`,
`AppointmentRequestStatus`, `AppointmentRequest`, `ConsultCountdown`.

### Mutation inputs / results
- **C:** `SaveVetProfileDraftInput`/`Result`, `SubmitVetVerificationInput`/`Result`,
  `RenewVetLicenceInput`/`Result`, `PublishVetProfileInput`/`Result`.
- **D:** `SetPresenceInput`/`Result`, `DismissAnnouncementInput`/`Result`.
- **E:** `BlockDateInput`/`Result`, `SetVacationInput`/`Result`,
  `ToggleEmergencyInput`/`Result`, `SaveReminderSettingsInput`/`Result`,
  `SaveRecurringRuleInput`/`Result`, `SetTimezoneInput`/`Result`.
- **F:** `AcceptAppointmentInput`/`Result`, `RejectAppointmentInput`/`Result`,
  `RequestRescheduleInput`/`Result`, `RescheduleAppointmentInput`/`Result`,
  `CancelAppointmentInput`/`Result`, `StartConsultationInput`/`Result`,
  `EndConsultationInput`/`Result`, `MarkNoShowInput`/`Result`.

> Every state-changing input type carries `idempotencyKey: string`. Hooks
> generate it via `generateIdempotencyKey()`, so Frontend passes the input
> **without** `idempotencyKey` (`Omit<…, 'idempotencyKey'>`).

---

## 2. API functions (`@/api/doctor.batch1.api`)

### Reads
| Function | Returns |
|----------|---------|
| `getVetProfileDraft(draftId?)` | `VetProfileDraft` |
| `getVetDocumentSlots()` | `ProfileDocumentSlot[]` |
| `getVetVerification(submissionId?)` | `VetVerificationSubmission` |
| `getDashboard()` | `DoctorDashboardData` |
| `getAnnouncement()` | `PlatformAnnouncement \| undefined` |
| `getScheduleSettings()` | `ScheduleSettings` |
| `getBlockedDates()` | `BlockedDate[]` |
| `getConsultationQueue()` | `ConsultationQueueItem[]` |
| `getAppointmentRequests()` | `AppointmentRequest[]` |
| `getAppointmentRequest(id)` | `AppointmentRequest \| undefined` |

### Pure helpers (no latency — UI may call inline)
| Function | Returns |
|----------|---------|
| `checkOverbooking(date, capacity, booked, requested)` | `OverbookingCheck` |
| `computeConsultCountdown(appointmentId, slotAt, soonWindowMins?, graceMins?, now?)` | `ConsultCountdown` |

### Mutations (all require `Idempotency-Key` in Phase C)
| Function | Returns |
|----------|---------|
| `saveVetProfileDraft(input)` | `SaveVetProfileDraftResult` |
| `submitVetVerification(input)` | `SubmitVetVerificationResult` |
| `renewVetLicence(input)` | `RenewVetLicenceResult` |
| `publishVetProfile(input)` | `PublishVetProfileResult` |
| `setPresence(input)` | `SetPresenceResult` |
| `dismissAnnouncement(input)` | `DismissAnnouncementResult` |
| `blockDate(input)` | `BlockDateResult` |
| `setVacation(input)` | `SetVacationResult` |
| `toggleEmergency(input)` | `ToggleEmergencyResult` |
| `saveReminderSettings(input)` | `SaveReminderSettingsResult` |
| `saveRecurringRule(input)` | `SaveRecurringRuleResult` |
| `setTimezone(input)` | `SetTimezoneResult` |
| `acceptAppointment(input)` | `AcceptAppointmentResult` |
| `rejectAppointment(input)` | `RejectAppointmentResult` |
| `requestReschedule(input)` | `RequestRescheduleResult` |
| `rescheduleAppointment(input)` | `RescheduleAppointmentResult` |
| `cancelAppointment(input)` | `CancelAppointmentResult` |
| `startConsultation(input)` | `StartConsultationResult` |
| `endConsultation(input)` | `EndConsultationResult` |
| `markNoShow(input)` | `MarkNoShowResult` |

**Exported DEMO_* (also used as `placeholderData`):** `DEMO_VET_PROFILE_DRAFT`,
`DEMO_VET_DOCUMENT_SLOTS`, `DEMO_VET_VERIFICATION`, `DEMO_DASHBOARD`,
`DEMO_ANNOUNCEMENT`, `DEMO_SCHEDULE_SETTINGS`, `DEMO_BLOCKED_DATES`,
`DEMO_VACATION`, `DEMO_REMINDER_SETTINGS`, `DEMO_RECURRING_RULES`, `DEMO_QUEUE`,
`DEMO_APPOINTMENT_REQUESTS`.

---

## 3. Hooks (`@/features/doctor/hooks`)

### Section C — vet profile (`useVetProfile.ts`)
| Hook | Kind | Signature |
|------|------|-----------|
| `useVetProfileDraft(draftId?)` | query | → `VetProfileDraft` |
| `useVetDocumentSlots()` | query | → `ProfileDocumentSlot[]` |
| `useVetVerification(submissionId?)` | query | → `VetVerificationSubmission` |
| `useSaveVetProfileDraft()` | mutation | `Omit<SaveVetProfileDraftInput,'idempotencyKey'>` |
| `useSubmitVetVerification()` | mutation | `Omit<SubmitVetVerificationInput,'idempotencyKey'>` |
| `useRenewVetLicence()` | mutation | `Omit<RenewVetLicenceInput,'idempotencyKey'>` |
| `usePublishVetProfile()` | mutation | `Omit<PublishVetProfileInput,'idempotencyKey'>` |

### Section D — dashboard (`useDashboard.ts`)
| Hook | Kind | Signature |
|------|------|-----------|
| `useDashboard()` | query | → `DoctorDashboardData` |
| `useAnnouncement()` | query | → `PlatformAnnouncement \| undefined` |
| `useSetPresence()` | mutation | `Omit<SetPresenceInput,'idempotencyKey'>` |
| `useDismissAnnouncement()` | mutation | `Omit<DismissAnnouncementInput,'idempotencyKey'>` |

### Section E — schedule (`useSchedule.ts`)
| Hook | Kind | Signature |
|------|------|-----------|
| `useScheduleSettings()` | query | → `ScheduleSettings` |
| `useBlockedDates()` | query | → `BlockedDate[]` |
| `useBlockDate()` | mutation | `Omit<BlockDateInput,'idempotencyKey'>` |
| `useSetVacation()` | mutation | `Omit<SetVacationInput,'idempotencyKey'>` |
| `useToggleEmergency()` | mutation | `Omit<ToggleEmergencyInput,'idempotencyKey'>` |
| `useSaveReminderSettings()` | mutation | `Omit<SaveReminderSettingsInput,'idempotencyKey'>` |
| `useSaveRecurringRule()` | mutation | `Omit<SaveRecurringRuleInput,'idempotencyKey'>` |
| `useSetTimezone()` | mutation | `Omit<SetTimezoneInput,'idempotencyKey'>` |
| `useRescheduleAppointment()` | mutation | `Omit<RescheduleAppointmentInput,'idempotencyKey'>` |
| `useCancelAppointment()` | mutation | `Omit<CancelAppointmentInput,'idempotencyKey'>` |
| `checkOverbooking` | helper (re-export) | `(date, capacity, booked, requested) → OverbookingCheck` |

### Section F — queue (`useQueue.ts`)
| Hook | Kind | Signature |
|------|------|-----------|
| `useConsultationQueue()` | query | → `ConsultationQueueItem[]` |
| `useAppointmentRequests()` | query | → `AppointmentRequest[]` |
| `useAppointmentRequest(id)` | query | → `AppointmentRequest \| undefined` |
| `useAcceptAppointment()` | mutation | `Omit<AcceptAppointmentInput,'idempotencyKey'>` |
| `useRejectAppointment()` | mutation | `Omit<RejectAppointmentInput,'idempotencyKey'>` |
| `useRequestReschedule()` | mutation | `Omit<RequestRescheduleInput,'idempotencyKey'>` |
| `useStartConsultation()` | mutation | `Omit<StartConsultationInput,'idempotencyKey'>` |
| `useEndConsultation()` | mutation | `Omit<EndConsultationInput,'idempotencyKey'>` |
| `useMarkNoShow()` | mutation | `Omit<MarkNoShowInput,'idempotencyKey'>` |
| `computeConsultCountdown` | helper (re-export) | `(appointmentId, slotAt, soonWindowMins?, graceMins?, now?) → ConsultCountdown` |

> **REUSED:** Phase 1 `useUpdateAppointmentStatus` (already in the barrel) covers
> generic status transitions the Section F named mutations don't. It is NOT
> re-exported from `useQueue.ts` (avoids a duplicate barrel export).

---

## 4. Constants (`@/features/doctor/constants`)

### Section C
`VET_LICENCE_BODIES`, `VET_SPECIALTY_OPTIONS`, `VET_SUB_SPECIALTY_OPTIONS`,
`VET_PROFILE_BUILDER_STEPS`.

### Section D
`PRESENCE_LABELS`, `PRESENCE_TONES`, `DASHBOARD_ALERT_KIND_LABELS`,
`DASHBOARD_ALERT_SEVERITY_LABELS`, `DASHBOARD_ALERT_SEVERITY_TONES`,
`DASHBOARD_ALERT_SEVERITY_RANK`, `ANNOUNCEMENT_TONE_TONES`.
> Prefixed `DASHBOARD_` to avoid colliding with the Phase 2 compliance
> `ALERT_SEVERITY_LABELS` already in the barrel.

### Section E
`REMINDER_OFFSET_OPTIONS`, `RECURRENCE_OPTIONS`, `RECURRENCE_LABELS`,
`TIMEZONE_OPTIONS`.

### Section F
`QUEUE_PRIORITY_LABELS`, `QUEUE_PRIORITY_TONES`, `QUEUE_PRIORITY_RANK`,
`APPOINTMENT_BILLING_LABELS`, `APPOINTMENT_BILLING_TONES`,
`APPOINTMENT_REJECT_REASONS`, `CONSULT_SOON_WINDOW_MINS`,
`CONSULT_LATE_GRACE_MINS`.

**REUSED from the barrel (not duplicated):** `WEEKDAYS`,
`CONSULT_DURATION_OPTIONS`, `BUFFER_OPTIONS`, `SPECIALTY_OPTIONS`,
`PET_SPECIES_OPTIONS`, `PET_SPECIES_LABELS`, `CONSULT_FEE_PRESETS_KOBO`,
`NIGERIAN_STATES`, `LANGUAGE_OPTIONS`, `DEGREE_OPTIONS`.

---

## 5. Loading / error / empty conventions

Identical to earlier phases:
- **Loading:** `isPending` (queries with `placeholderData` show demo data
  immediately; gate skeletons on `isPlaceholderData` where a true spinner is
  wanted).
- **Error:** `isError` + `error`; render a retry affordance.
- **Empty:** arrays may be `[]` (no requests, empty queue, no alerts, no blocked
  dates) — render an empty state. `getAppointmentRequest` / `getAnnouncement` and
  the optional `vacation` may resolve `undefined` — render not-found / "none set".
- **State variants (consolidated):** accept/reject → `AppointmentRequestStatus`;
  HMO/paid/free → `AppointmentBilling`; countdown / late / overbooking → the pure
  helpers (`computeConsultCountdown`, `checkOverbooking`); "saved confirmation" →
  mutation `isSuccess`. No separate entities for these.
- **Money:** integers in kobo; format with `formatKobo`. Never do float math.
