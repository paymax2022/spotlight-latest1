# Doctor Batch 2 — File Ownership Map

Batch 2 = spec **sections G, H, I, J** (100 entries). This is **additive** to
Phase 1, Phase 2, Section B, Phase 3 and Batch 1: nothing in earlier contracts
is edited (only the hooks/constants barrels gain new export lines). Money is
always integers in **kobo**.

**Consolidation principle:** action/state variants (typing/receipts, offline,
reconnecting, drops, draft/lock, alerts) are modelled as **states/data** on top
of the existing entities, not as separate entities. The tables below mark each
entry as a **full screen**, a **STATE of** an existing/sibling screen, a
**SHEET on** a screen, or a **REUSES existing** route. Frontend builds the
variants from one data shape.

## Ownership boundaries (do not cross)

### BACKEND (data/type contract) — owns
- `src/types/doctor.batch2.ts`                          *(new)*
- `src/api/doctor.batch2.api.ts`                         *(new)*
- `src/features/doctor/hooks/usePatientReview.ts`        *(new — Section G)*
- `src/features/doctor/hooks/useChatConsult.ts`          *(new — Section H)*
- `src/features/doctor/hooks/useCall.ts`                 *(new — Section I)*
- `src/features/doctor/hooks/useClinicalNote.ts`         *(new — Section J)*
- `src/features/doctor/constants/batch2.ts`              *(new)*
- `src/features/doctor/hooks/index.ts`                   *(edited — additive export lines only)*
- `src/features/doctor/constants/index.ts`              *(edited — additive export line only)*

> Backend continues to own the Phase 1 / 2 / Section B / Phase 3 / Batch 1 files unchanged.

### FRONTEND (screens/UI) — owns
- `app/(doctor)/**` (all route files), in particular the screens Batch 2 extends:
  - `app/(doctor)/patient/[id].tsx`        (Section G)
  - `app/(doctor)/consult/[id]/chat.tsx`   (Section H)
  - `app/(doctor)/consult/[id]/call.tsx`   (Section I)
  - `app/(doctor)/consult/[id]/notes.tsx`  (Section J)
- `src/features/doctor/components/**`

### QA — owns
- `docs/QA_DOCTOR_BATCH2_REPORT.md`

> Frontend consumes Backend's hooks/types only — never imports from
> `doctor.batch2.api.ts` directly (use the hooks; pure helpers
> `searchDiagnosisCodes` and `formatKobo` re-exported via the hooks/api are the
> exception). All money is kobo; format with `formatKobo`.

---

## Reused existing work (do NOT recreate)

| Area | Existing asset | Reused hook / type |
|------|----------------|--------------------|
| Patient profile (base) | `app/(doctor)/patient/[id].tsx` | `usePatientProfile`, `PatientMedicalProfile`, `PatientVital`, `PatientHistoryItem` (embedded as `PatientFullProfile.base`) |
| Chat (text path) | `app/(doctor)/consult/[id]/chat.tsx` | `useChatThreads`, `useChatMessages`, `useSendChatMessage`, `ChatThread`, `ChatMessage`, `ChatAuthor` |
| Call (base) | `app/(doctor)/consult/[id]/call.tsx` | `useCallSession`, `CallSession`, `CallStatus` (embedded as `CallSessionRich.base`) |
| Notes (SOAP path) | `app/(doctor)/consult/[id]/notes.tsx` | `useSoapNote`, `useSaveSoapNote`, `SoapNote` (embedded as `ClinicalNote.base`) |
| Appointment status | Phase 1 | `useUpdateAppointmentStatus`, `updateAppointmentStatus` (consult lifecycle) |
| Prescriptions / labs | Phase 1 | `DoctorPrescription`, `LabResult` (previous rx / labs in `PatientFullProfile`) |
| HMO coverage | Phase 1 | `HmoCoverage` (patient HMO summary) |
| Specialist referral | Phase 2 | `SpecialistReferral['urgency']` (note referral recommendation) |
| ICD-lite | barrel | `DIAGNOSIS_OPTIONS` (Section J extends it via richer `ICD_CODES`) |

REUSED constants (from the barrel — not duplicated): `DIAGNOSIS_OPTIONS`,
`DRUG_CATALOGUE`, `SUPPORT_CATEGORIES`.

---

## SECTION G — Patient Profile Review (25)

All 25 entries are **STATEs / SHEETs of** the existing `patient/[id].tsx` review
screen (or sections within it). The whole section is read-only and driven by one
`PatientFullProfile` aggregate. Hook: `usePatientFullProfile(patientId)`.

| # | Spec entry | Ownership | Data |
|---|-----------|-----------|------|
| G1 | patient summary | SECTION of `patient/[id]` | `PatientFullProfile.base.patient` (`PatientSummary`) |
| G2 | medical profile | SECTION of `patient/[id]` | `PatientFullProfile.base` (`PatientMedicalProfile`) |
| G3 | demographics | SECTION of `patient/[id]` | `PatientDemographics` |
| G4 | chief complaint | STATE of `patient/[id]` | `chiefComplaint` |
| G5 | symptoms submitted | SECTION of `patient/[id]` | `submittedSymptoms[]` (`SubmittedSymptom`) |
| G6 | medical history | SECTION of `patient/[id]` | `base.history` (`PatientHistoryItem[]`) |
| G7 | allergy history | SECTION of `patient/[id]` | `allergyHistory[]` (`AllergyEntry`) |
| G8 | current medications | STATE of `patient/[id]` | `base.currentMedications` |
| G9 | chronic conditions | STATE of `patient/[id]` | `base.chronicConditions` |
| G10 | past surgeries | SECTION of `patient/[id]` | `pastSurgeries[]` (`PastSurgery`) |
| G11 | family medical history | SECTION of `patient/[id]` | `familyHistory[]` (`FamilyHistoryEntry`) |
| G12 | vitals history | SECTION of `patient/[id]` | `vitalsHistory[]` (`VitalsReading` timeseries) |
| G13 | uploaded medical documents | SHEET on `patient/[id]` | `documents[]` (`PatientDocument`) |
| G14 | uploaded images | SHEET on `patient/[id]` | `images[]` (`PatientImage`) |
| G15 | previous consultations | SECTION of `patient/[id]` | `previousConsults[]` (`PreviousConsult`) |
| G16 | previous prescriptions | SECTION of `patient/[id]` | `previousPrescriptions[]` (reuse `DoctorPrescription`) |
| G17 | previous lab results | SECTION of `patient/[id]` | `previousLabResults[]` (reuse `LabResult`) |
| G18 | HMO coverage summary | STATE of `patient/[id]` | `hmoCoverage` (reuse `HmoCoverage`) |
| G19 | emergency contact | STATE of `patient/[id]` | `emergencyContact` (`EmergencyContact`) |
| G20 | dependent profile | SHEET on `patient/[id]` | `dependents[]` (`DependentProfile`) |
| G21 | child patient profile | STATE of `patient/[id]` | `demographics.patientType === 'child'` + `dependents[]` |
| G22 | elderly/caregiver profile | STATE of `patient/[id]` | `demographics.patientType === 'elderly'` + `hasCaregiver` |
| G23 | patient risk warning | STATE (banner) of `patient/[id]` | `alerts.riskWarnings[]` (`PatientRiskWarning`) |
| G24 | drug allergy alert | STATE (banner) of `patient/[id]` | `alerts.drugAllergyAlerts[]` (`DrugAllergyAlert`) |
| G25 | contraindication alert | STATE (banner) of `patient/[id]` | `alerts.contraindications[]` (`ContraindicationAlert`) |

---

## SECTION H — Chat Consultation (23)

Reuses the existing `consult/[id]/chat.tsx` screen. Text send REUSES Phase 1
`useSendChatMessage`; everything else layers on `ChatMessageRich` +
`ChatParticipantPresence` + `ChatThreadState`. Hooks: `useRichMessages`,
`useThreadState`, `useChatPresence`, `useChatTranscript`, `useSendVoiceNote`,
`useSendAttachment`, `useAnnotateImage`, `useShareInChat`, `useEscalateToCall`,
`useReportMessage`, `useEndChat`.

| # | Spec entry | Ownership | Data / hook |
|---|-----------|-----------|-------------|
| H1 | consultation chat | full screen `consult/[id]/chat` | `useRichMessages`, `useThreadState` |
| H2 | secure chat | STATE (banner) of chat | `ChatThreadState.secureNotice` / `SECURE_CHAT_NOTICE` |
| H3 | thread list | REUSES Phase 1 | `useChatThreads`, `ChatThread` |
| H4 | new message | STATE of chat | `useSendChatMessage` (Phase 1, text) |
| H5 | typing indicator | STATE of chat | `ChatParticipantPresence.status === 'typing'` |
| H6 | read receipts | STATE of chat | `ChatMessageRich.deliveryStatus` |
| H7 | send text | REUSES Phase 1 | `useSendChatMessage` |
| H8 | send voice note | SHEET on chat | `useSendVoiceNote` |
| H9 | upload image | SHEET on chat | `useSendAttachment` (kind `image`) |
| H10 | upload medical document | SHEET on chat | `useSendAttachment` (kind `document`) |
| H11 | view patient attachment | SHEET on chat | `ChatMessageRich.attachment` |
| H12 | annotate image | SHEET on chat | `useAnnotateImage` (`ChatImageAnnotation`) |
| H13 | share prescription in chat | SHEET on chat | `useShareInChat` (kind `prescription`) |
| H14 | share lab order in chat | SHEET on chat | `useShareInChat` (kind `lab`) |
| H15 | share consultation summary | SHEET on chat | `useShareInChat` (kind `summary`) |
| H16 | escalate to audio call | STATE of chat | `useEscalateToCall` (mode `audio`) |
| H17 | escalate to video call | STATE of chat | `useEscalateToCall` (mode `video`) |
| H18 | patient offline | STATE of chat | `ChatParticipantPresence` (patient `offline`) |
| H19 | doctor offline warning | STATE of chat | `ChatParticipantPresence` (doctor `offline`) |
| H20 | chat ended | STATE of chat | `ChatThreadState.lifecycle === 'ended'` / `useEndChat` |
| H21 | transcript | SHEET on chat | `useChatTranscript` (`ChatTranscript`) |
| H22 | report abusive message | SHEET on chat | `useReportMessage` + `REPORT_REASONS` |
| H23 | secure-chat notice | STATE (banner) of chat | `SECURE_CHAT_NOTICE` |

---

## SECTION I — Audio & Video Consultation (28)

Reuses the existing `consult/[id]/call.tsx` screen. Base call REUSES Phase 1
`useCallSession`; everything layers on `CallSessionRich` + `PreCallCheck`.
Reconnecting / dropped / disconnected / poor-network / Agora-failure /
VideoSDK-fallback are STATES read from `CallSessionRich.phase` / `provider` /
`networkQuality` / participant states. Hooks: `useCallSessionRich`,
`usePreCallCheck`, `useCallDisputes`, `useRunDeviceCheck`, `useJoinCall`,
`useLeaveCall`, `useSwitchProvider`, `useSubmitCallFeedback`,
`useRaiseCallDispute`, `useReportTechnicalIssue`.

| # | Spec entry | Ownership | Data / hook |
|---|-----------|-----------|-------------|
| I1 | pre-call checklist | full screen (pre-call) | `usePreCallCheck`, `PreCallCheck` |
| I2 | camera/mic test | STATE of pre-call | `useRunDeviceCheck` → `DeviceCheck.cameraOk/micOk` |
| I3 | network quality test | STATE of pre-call | `useRunDeviceCheck` → `DeviceCheck.networkQuality` |
| I4 | call waiting room | STATE of call | `CallPhase === 'waiting_room'` |
| I5 | incoming call | STATE of call | `CallSessionRich.base.status === 'ringing'` |
| I6 | outgoing call | STATE of call | `CallSessionRich.base.status === 'connecting'` |
| I7 | audio call | full screen `consult/[id]/call` | `useCallSessionRich` (mode `audio`) |
| I8 | video call | full screen `consult/[id]/call` | `useCallSessionRich` (mode `video`) |
| I9 | minimized view | STATE of call | `CallControls.minimized === true` |
| I10 | fullscreen | STATE of call | `CallControls.minimized === false` |
| I11 | mute/unmute | STATE of call | `CallControls.muted` |
| I12 | camera on/off | STATE of call | `CallControls.cameraOn` |
| I13 | switch camera | STATE of call | `CallControls.frontCamera` |
| I14 | speaker toggle | STATE of call | `CallControls.speakerOn` |
| I15 | poor network warning | STATE of call | `networkQuality === 'poor'` + `NETWORK_QUALITY_LABELS` |
| I16 | reconnecting | STATE of call | `CallPhase === 'reconnecting'` |
| I17 | Agora active | STATE of call | `provider === 'agora'` |
| I18 | Agora failure | STATE of call | `providerFailed === true` |
| I19 | switch to VideoSDK fallback | STATE of call | `useSwitchProvider` (to `videosdk`) |
| I20 | VideoSDK active | STATE of call | `provider === 'videosdk'` |
| I21 | call dropped | STATE of call | `CallPhase === 'dropped'` |
| I22 | patient disconnected | STATE of call | `patientState.connected === false` |
| I23 | doctor disconnected | STATE of call | `doctorState.connected === false` |
| I24 | call ended | STATE of call | `useLeaveCall` → `CallPhase === 'ended'` |
| I25 | duration summary | SHEET on call | `LeaveCallResult.summary` (`CallDurationSummary`) |
| I26 | failed-call dispute | SHEET on call | `useRaiseCallDispute`, `useCallDisputes` (`CallDispute`) |
| I27 | call quality feedback | SHEET on call | `useSubmitCallFeedback` (`CallQualityFeedback`) |
| I28 | report technical issue | SHEET on call | `useReportTechnicalIssue` + `TECHNICAL_ISSUE_CATEGORIES` |

---

## SECTION J — Consultation Notes & Diagnosis (24)

Reuses the existing `consult/[id]/notes.tsx` screen. Plain SOAP REUSES Phase 1
`useSoapNote` / `useSaveSoapNote`; the richer note layers on `ClinicalNote`.
Draft / finalize / locked / edit-before-submission are STATES driven by
`ClinicalNote.status`. Hooks: `useClinicalNote`, `useSaveDraftNote`,
`useFinalizeNote`, `useShareSummary`, `searchDiagnosisCodes` (pure helper).

| # | Spec entry | Ownership | Data / hook |
|---|-----------|-----------|-------------|
| J1 | start clinical note | full screen `consult/[id]/notes` | `useClinicalNote`, `useSaveDraftNote` |
| J2 | SOAP | SECTION of notes | `ClinicalNote.base` (reuse `SoapNote`) |
| J3 | subjective | STATE of notes | `base.subjective` |
| J4 | objective | STATE of notes | `base.objective` |
| J5 | assessment | STATE of notes | `base.assessment` |
| J6 | plan | STATE of notes | `base.plan` |
| J7 | diagnosis entry | SECTION of notes | `base.diagnosis` + `icdCodes[]` |
| J8 | diagnosis search | SHEET on notes | `searchDiagnosisCodes()` over `ICD_CODES` |
| J9 | ICD/code selection | SHEET on notes | `DiagnosisCode` + `ICD_CODES` |
| J10 | symptom summary | STATE of notes | `submittedSymptoms` from Section G (read) |
| J11 | clinical impression | STATE of notes | `clinicalImpression` |
| J12 | treatment plan | STATE of notes | `treatmentPlan` |
| J13 | lifestyle recommendation | SECTION of notes | `lifestyleRecommendations[]` + `LIFESTYLE_CATEGORIES` |
| J14 | red-flag warning | STATE (banner) of notes | `redFlags[]` (`RedFlagWarning`) + `RED_FLAG_OPTIONS` |
| J15 | emergency referral recommendation | STATE of notes | `referral.urgency === 'urgent'` (`NoteReferral`) |
| J16 | specialist referral | STATE of notes | `referral` (`NoteReferral`); full referral via Phase 2 flow |
| J17 | follow-up recommendation | STATE of notes | `followUp` (`NoteFollowUp`) + `FOLLOW_UP_INTERVAL_OPTIONS` |
| J18 | save draft | STATE of notes | `useSaveDraftNote` → `status === 'draft'` |
| J19 | finalize | STATE of notes | `useFinalizeNote` → `status === 'locked'` |
| J20 | summary preview | SHEET on notes | `ClinicalNote` (read view before share) |
| J21 | share summary with patient | SHEET on notes | `useShareSummary` → `sharedWithPatient` |
| J22 | private doctor-only notes | SECTION of notes | `privateNotes` |
| J23 | edit before submission | STATE of notes | `status === 'draft'` (editable) |
| J24 | locked note after submission | STATE of notes | `status === 'locked'` (immutable) |

---

## Loading / error / empty conventions

Same as earlier batches:
- **Loading:** queries return `isLoading`; `DEMO_*` are wired as `placeholderData`
  so screens render immediately with demo content.
- **Error:** queries expose `isError` / `error`; mutations expose
  `isError` / `error` / `isPending`.
- **Empty:** array fields are `[]` (never `null`); optional single objects are
  `undefined` (`hmoCoverage?`, `emergencyContact?`, clinical note may be
  `undefined` before the first draft).
