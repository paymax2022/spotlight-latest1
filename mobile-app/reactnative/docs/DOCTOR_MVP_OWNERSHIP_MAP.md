# Doctor MVP — File Ownership Map

This document defines who owns what across the 3 roles building the doctor-side
(provider) telemedicine experience inside the existing Expo Router app. Money is
always integers in **kobo** (minor units).

## Ownership boundaries (do not cross)

### BACKEND (data/type contract) — owns
- `src/types/doctor.ts`
- `src/api/doctor.api.ts`
- `src/features/doctor/hooks/**`
- `src/features/doctor/constants/**`

### FRONTEND (screens/UI) — owns
- `app/(doctor)/**` (all route files)
- `src/features/doctor/components/**`

### QA — owns
- `mobile-app/reactnative/docs/QA_DOCTOR_MVP_REPORT.md`

> Backend may import/re-export from existing telemedicine/voting files but never
> edits them. Frontend consumes Backend's hooks/types only — never imports from
> `doctor.api.ts` directly (use the hooks). All money is kobo; format with
> `formatKobo` (re-exported from `@/api/doctor.api`).

---

## Proposed doctor tab layout

Doctor area lives under `app/(doctor)/`. Bottom tab bar (5 tabs):

| Tab          | Route                          | Purpose                          |
|--------------|--------------------------------|----------------------------------|
| Dashboard    | `app/(doctor)/(tabs)/index`    | Daily overview, online toggle    |
| Appointments | `app/(doctor)/(tabs)/appointments` | Consult queue / list         |
| Messages     | `app/(doctor)/(tabs)/messages` | Chat thread list                 |
| Records      | `app/(doctor)/(tabs)/records`  | Prescriptions + lab orders hub   |
| Earnings     | `app/(doctor)/(tabs)/earnings` | Balance + payouts                |

Everything else is a **stack screen** pushed on top (detail/flow screens).

---

## The 18 Core MVP screens

| # | Screen | Route (under `app/(doctor)/`) | Tab/Stack | Hooks consumed | Key types |
|---|--------|-------------------------------|-----------|----------------|-----------|
| 1 | Doctor signup / verification | `signup/index` | Stack | `useSubmitVerification` | `SubmitVerificationInput`, `VerificationDocType` |
| 2 | Verification pending | `signup/pending` | Stack | `useVerification` | `VerificationSubmission`, `VerificationStatus` |
| 3 | Doctor dashboard | `(tabs)/index` | Tab | `useDoctorProfile`, `useAppointments`, `useEarnings`, `useNotifications` | `DoctorProfile`, `DoctorAppointment`, `EarningsSummary` |
| 4 | Availability setup | `availability` | Stack | `useAvailability`, `useUpdateAvailability` | `AvailabilitySchedule`, `WorkingDay`, `ScheduleBreak`, `UpdateAvailabilityInput` |
| 5 | Appointment list | `(tabs)/appointments` | Tab | `useAppointments` | `DoctorAppointment`, `ConsultStatus` |
| 6 | Patient profile | `patient/[id]` | Stack | `usePatientProfile` | `PatientMedicalProfile`, `PatientSummary` |
| 7 | Chat consultation | `consult/[id]/chat` | Stack | `useChatMessages`, `useSendChatMessage`, `useAppointment` | `ChatMessage`, `SendChatMessageInput` |
| 8 | Audio/video consultation | `consult/[id]/call` | Stack | `useCallSession`, `useUpdateAppointmentStatus` | `CallSession`, `CallStatus` |
| 9 | Consultation (SOAP) notes | `consult/[id]/notes` | Stack | `useSoapNote`, `useSaveSoapNote` | `SoapNote`, `SaveSoapNoteInput` |
| 10 | Create e-prescription | `consult/[id]/prescription` | Stack | `useCreatePrescription` | `PrescriptionDraft`, `PrescriptionDrugItem`, `CreatePrescriptionInput` |
| 11 | Prescription history | `prescriptions/index` | Stack | `usePrescriptions`, `usePrescription` | `DoctorPrescription` |
| 12 | Create lab order | `consult/[id]/lab-order` | Stack | `useCreateLabOrder` | `LabTest`, `CreateLabOrderInput`, `LabOrder` |
| 13 | Lab result review | `lab/[orderId]` | Stack | `useLabResult`, `useMarkLabResultReviewed` | `LabResult`, `LabResultValue`, `MarkLabResultReviewedInput` |
| 14 | HMO eligibility view | `consult/[id]/hmo` | Stack | `useHmoEligibility` | `HmoEligibility`, `HmoCoverage`, `EligibilityStatus` |
| 15 | Earnings dashboard | `(tabs)/earnings` | Tab | `useEarnings`, `useRequestPayout` | `EarningsSummary`, `PayoutItem`, `RequestPayoutInput` |
| 16 | Notifications | `notifications` | Stack | `useNotifications` | `DoctorNotification`, `DoctorNotificationType` |
| 17 | Support | `support` | Stack | `useSupportTickets`, `useCreateSupportTicket` | `SupportTicket`, `CreateSupportTicketInput` |
| 18 | Profile / settings | `settings` | Stack | `useDoctorProfile`, `useSettings`, `useUpdateSettings` | `DoctorProfile`, `DoctorSettings`, `UpdateDoctorSettingsInput` |

Notes for Frontend:
- The **Messages** tab uses `useChatThreads()` → `ChatThread[]`; tapping a thread
  routes to screen #7 (`consult/[id]/chat`).
- The **Records** tab is a hub linking to #11 (prescriptions) and #12/#13 (labs);
  it can use `usePrescriptions()` + `useLabOrders()`.
- Static option lists for forms (specialties, ICD-lite diagnoses, drug catalogue,
  lab tests, frequency/duration, verification doc types, weekdays) come from
  `@/features/doctor/constants`.
