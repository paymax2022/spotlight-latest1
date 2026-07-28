# Doctor API Contract (Phase A)

Reference for the Frontend role. All data is **demo data** resolved with simulated
latency (`wait()`); Phase C swaps bodies for live endpoints. Money is always an
integer in **kobo**. Import path alias is `@/` → `src/`.

- Types:     `@/types/doctor`
- API:       `@/api/doctor.api`   (Frontend should NOT call these directly — use hooks)
- Hooks:     `@/features/doctor/hooks`
- Constants: `@/features/doctor/constants`
- Money fmt: `formatKobo(kobo: number) => string` — re-exported from `@/api/doctor.api`

---

## 1. Exported types (`@/types/doctor`)

Re-exported from telemedicine: `ConsultType`, `ConsultStatus`.

**Enums / unions:** `VerificationStatus`, `VerificationDocType`, `ChatAuthor`,
`CallStatus`, `LabOrderStatus`, `EligibilityStatus`, `Weekday`,
`DoctorNotificationType`, `SupportTicketStatus`.

**Entities:** `DoctorProfile`, `VerificationDocument`, `VerificationSubmission`,
`PatientSummary`, `DoctorAppointment`, `PatientVital`, `PatientHistoryItem`,
`PatientMedicalProfile`, `ChatMessage`, `ChatThread`, `CallSession`, `SoapNote`,
`PrescriptionDrugItem`, `DoctorPrescription`, `LabTest`, `LabOrder`,
`LabResultValue`, `LabResult`, `HmoCoverage`, `HmoEligibility`, `WorkingDay`,
`ScheduleBreak`, `AvailabilitySchedule`, `PayoutItem`, `EarningsSummary`,
`DoctorNotification`, `SupportTicket`, `DoctorSettings`.

**Mutation inputs/results:** `SubmitVerificationInput`/`SubmitVerificationResult`,
`UpdateAvailabilityInput`, `SaveSoapNoteInput`, `PrescriptionDraft`,
`CreatePrescriptionInput`/`CreatePrescriptionResult`,
`CreateLabOrderInput`/`CreateLabOrderResult`, `SendChatMessageInput`,
`UpdateAppointmentStatusInput`, `RequestPayoutInput`/`RequestPayoutResult`,
`MarkLabResultReviewedInput`, `CreateSupportTicketInput`/`CreateSupportTicketResult`,
`UpdateDoctorSettingsInput`.

> Every money/state-changing input type carries `idempotencyKey: string`. Hooks
> generate this automatically via `generateIdempotencyKey()`, so Frontend passes
> the input **without** `idempotencyKey` (`Omit<…, 'idempotencyKey'>`).

---

## 2. API functions (`@/api/doctor.api`)

### Reads
| Function | Returns |
|----------|---------|
| `getDoctorProfile()` | `DoctorProfile` |
| `getVerification()` | `VerificationSubmission` |
| `getAvailability(doctorId?)` | `AvailabilitySchedule` |
| `getAppointments(status?)` | `DoctorAppointment[]` |
| `getAppointment(id)` | `DoctorAppointment \| undefined` |
| `getPatientProfile(patientId)` | `PatientMedicalProfile` |
| `getChatThreads()` | `ChatThread[]` |
| `getChatMessages(threadId)` | `ChatMessage[]` |
| `getCallSession(appointmentId)` | `CallSession` |
| `getSoapNote(appointmentId)` | `SoapNote \| undefined` |
| `getPrescriptions()` | `DoctorPrescription[]` |
| `getPrescription(id)` | `DoctorPrescription \| undefined` |
| `getLabOrders()` | `LabOrder[]` |
| `getLabResult(orderId)` | `LabResult` |
| `getHmoEligibility(appointmentId)` | `HmoEligibility` |
| `getEarnings()` | `EarningsSummary` |
| `getNotifications()` | `DoctorNotification[]` |
| `getSupportTickets()` | `SupportTicket[]` |
| `getSettings()` | `DoctorSettings` |

### Mutations (all require `Idempotency-Key` in Phase C)
| Function | Returns |
|----------|---------|
| `submitVerification(input: SubmitVerificationInput)` | `SubmitVerificationResult` |
| `updateAvailability(input: UpdateAvailabilityInput)` | `AvailabilitySchedule` |
| `updateAppointmentStatus(input: UpdateAppointmentStatusInput)` | `{ status: ConsultStatus }` |
| `saveSoapNote(input: SaveSoapNoteInput)` | `SoapNote` |
| `createPrescription(input: CreatePrescriptionInput)` | `CreatePrescriptionResult` |
| `createLabOrder(input: CreateLabOrderInput)` | `CreateLabOrderResult` |
| `markLabResultReviewed(input: MarkLabResultReviewedInput)` | `{ reviewed: boolean }` |
| `sendChatMessage(input: SendChatMessageInput)` | `ChatMessage` |
| `requestPayout(input: RequestPayoutInput)` | `RequestPayoutResult` |
| `createSupportTicket(input: CreateSupportTicketInput)` | `CreateSupportTicketResult` |
| `updateSettings(input: UpdateDoctorSettingsInput)` | `DoctorSettings` |

**Exported DEMO_* (also used as `placeholderData`):** `DEMO_DOCTOR_PROFILE`,
`DEMO_VERIFICATION`, `DEMO_APPOINTMENTS`, `DEMO_PATIENT_PROFILE`,
`DEMO_CHAT_THREADS`, `DEMO_CHAT_MESSAGES`, `DEMO_AVAILABILITY`, `DEMO_EARNINGS`,
`DEMO_NOTIFICATIONS`, `DEMO_SUPPORT_TICKETS`, `DEMO_SETTINGS`.

---

## 3. Hooks (`@/features/doctor/hooks`)

Query hooks return a TanStack Query `UseQueryResult` (`{ data, isLoading,
isError, error, refetch, … }`). Mutation hooks return a `UseMutationResult`
(`{ mutate, mutateAsync, isPending, isError, isSuccess, data, … }`).

### Queries
| Hook | Signature | `data` type |
|------|-----------|-------------|
| `useDoctorProfile()` | — | `DoctorProfile` |
| `useVerification()` | — | `VerificationSubmission` |
| `useAvailability(doctorId?)` | `string?` | `AvailabilitySchedule` |
| `useAppointments(status?)` | `ConsultStatus?` | `DoctorAppointment[]` |
| `useAppointment(id)` | `string` | `DoctorAppointment \| undefined` |
| `usePatientProfile(patientId)` | `string` | `PatientMedicalProfile` |
| `useChatThreads()` | — | `ChatThread[]` |
| `useChatMessages(threadId)` | `string` | `ChatMessage[]` |
| `useCallSession(appointmentId)` | `string` | `CallSession` |
| `useSoapNote(appointmentId)` | `string` | `SoapNote \| undefined` |
| `usePrescriptions()` | — | `DoctorPrescription[]` |
| `usePrescription(id)` | `string` | `DoctorPrescription \| undefined` |
| `useLabOrders()` | — | `LabOrder[]` |
| `useLabResult(orderId)` | `string` | `LabResult` |
| `useHmoEligibility(appointmentId)` | `string` | `HmoEligibility` |
| `useEarnings()` | — | `EarningsSummary` |
| `useNotifications()` | — | `DoctorNotification[]` |
| `useSupportTickets()` | — | `SupportTicket[]` |
| `useSettings()` | — | `DoctorSettings` |

### Mutations (call `.mutate(input)` with `Omit<Input, 'idempotencyKey'>`)
| Hook | Input (no idempotencyKey) |
|------|---------------------------|
| `useSubmitVerification()` | `{ mdcnNumber, documents }` |
| `useUpdateAvailability()` | `{ schedule }` |
| `useUpdateAppointmentStatus()` | `{ appointmentId, status }` |
| `useSaveSoapNote()` | `{ appointmentId, patientId, subjective, objective, assessment, plan, diagnosis }` |
| `useCreatePrescription()` | `{ appointmentId, patientId, diagnosis, items }` |
| `useCreateLabOrder()` | `{ appointmentId, patientId, testIds, clinicalNote, priority }` |
| `useMarkLabResultReviewed()` | `{ resultId }` |
| `useSendChatMessage()` | `{ threadId, body, attachmentUrl?, attachmentName? }` |
| `useRequestPayout()` | `{ amountKobo }` |
| `useCreateSupportTicket()` | `{ subject, category, body }` |
| `useUpdateSettings()` | `{ settings: Partial<DoctorSettings> }` |

Each mutation invalidates the relevant query key(s) on success (e.g.
`useCreatePrescription` invalidates `['doctor','prescriptions']`).

---

## 4. Constants (`@/features/doctor/constants`)

`SPECIALTY_OPTIONS`, `SUB_SPECIALTY_OPTIONS`, `VERIFICATION_DOC_TYPES`,
`DIAGNOSIS_OPTIONS` (ICD-lite), `DRUG_CATALOGUE`, `ROUTE_OPTIONS`,
`FREQUENCY_OPTIONS`, `DURATION_OPTIONS`, `EMPTY_DRUG_ITEM`, `LAB_TEST_CATALOGUE`,
`WEEKDAYS`, `CONSULT_DURATION_OPTIONS`, `BUFFER_OPTIONS`, `SUPPORT_CATEGORIES`.

---

## 5. Loading / error / empty-state contract

Because every query supplies demo data (via `placeholderData` or by always
resolving), Frontend should render states consistently as follows:

- **Loading:** `isLoading === true` → show a skeleton/`ActivityIndicator`.
  Hooks with `placeholderData` (profile, verification, availability, appointments,
  chat threads/messages, earnings, notifications, support, settings) expose demo
  `data` immediately, so a spinner is only briefly needed; treat `isLoading` as
  the gate (mirrors `app/services/telemedicine/doctors.tsx`).
- **Error:** `isError === true` → render an error/retry view; call `refetch()`.
  In Phase A errors never fire (demo data), but wire the branch now.
- **Empty:** arrays come back as `[]` (never null); object reads of a missing item
  resolve to `undefined` (`getAppointment`, `getPrescription`, `getSoapNote`).
  Render an explicit empty state when `data.length === 0` or `data == null`.
- **Default the array:** destructure with a default, e.g.
  `const { data: appointments = [] } = useAppointments();`
- **Money:** never do float math on kobo. Display with `formatKobo(value)`.
- **Mutations:** drive button state from `isPending`; use `mutateAsync` when you
  need to await before navigating. Inputs omit `idempotencyKey` (auto-generated).
