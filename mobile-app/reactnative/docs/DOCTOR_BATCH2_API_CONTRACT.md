# Doctor API Contract — Batch 2 (sections G · H · I · J)

Reference for the Frontend role. ADDITIVE to the Phase 1 / Phase 2 / Section B /
Phase 3 / Batch 1 contracts. All data is **demo data** resolved with simulated
latency (`wait()`); Phase C swaps bodies for live endpoints + the
`Idempotency-Key` header. Money is always an integer in **kobo**. Path alias is
`@/` → `src/`. Use `import type` for type-only imports.

- Types:     `@/types/doctor.batch2`   (re-exports the primitives it reuses)
- API:       `@/api/doctor.batch2.api` (Frontend should NOT call these directly — use hooks; pure helpers `searchDiagnosisCodes`, `formatKobo` are the exception)
- Hooks:     `@/features/doctor/hooks`  (same barrel as earlier phases)
- Constants: `@/features/doctor/constants` (same barrel; Batch 2 lists re-exported from `batch2`)
- Money fmt: `formatKobo(kobo)` — re-exported from `@/api/doctor.batch2.api` (and `@/api/doctor.api`)

**Consolidation:** action/state variants (typing/receipts, offline,
reconnecting, drops, draft/lock, alerts) are modelled as states/data on top of
the existing entities. See the Ownership Map for which spec entries are full
screens vs states vs reuse-existing.

---

## 1. Exported types (`@/types/doctor.batch2`)

**Re-exported from Phase 1 (`@/types/doctor`):** `PatientSummary`,
`PatientVital`, `PatientHistoryItem`, `PatientMedicalProfile`, `ChatMessage`,
`ChatThread`, `ChatAuthor`, `CallSession`, `CallStatus`, `SoapNote`,
`DoctorPrescription`, `LabResult`, `HmoCoverage`.
**From Phase 2 (`@/types/doctor.phase2`):** `SpecialistReferral`.

### Section G — patient profile review
`PatientType`, `PatientDemographics`, `SubmittedSymptom`, `AllergyEntry`,
`PastSurgery`, `FamilyHistoryEntry`, `VitalsReading`, `PatientDocumentKind`,
`PatientDocument`, `PatientImage`, `PreviousConsult`, `EmergencyContact`,
`DependentProfile`, `ClinicalAlertSeverity`, `PatientRiskWarning`,
`DrugAllergyAlert`, `ContraindicationAlert`, `PatientClinicalAlerts`,
`PatientFullProfile`.

### Section H — chat consultation
`ChatMessageKind`, `ChatDeliveryStatus`, `ChatAttachment`, `ChatImageAnnotation`,
`SharedEntityKind`, `ChatSharedReference`, `ChatMessageRich`, `PresenceStatus`,
`ChatParticipantPresence`, `ChatLifecycle`, `ChatThreadState`, `ChatTranscript`.

### Section I — audio & video consultation
`CallProvider`, `NetworkQuality`, `CallPhase`, `DeviceCheck`, `PreCallCheck`,
`CallParticipantState`, `CallControls`, `CallSessionRich`, `CallDurationSummary`,
`CallQualityFeedback`, `CallDisputeStatus`, `CallDispute`.

### Section J — consultation notes & diagnosis
`DiagnosisCode`, `RedFlagSeverity`, `RedFlagWarning`, `LifestyleRecommendation`,
`NoteFollowUp`, `NoteReferral`, `ClinicalNoteStatus`, `ClinicalNote`,
`ClinicalNoteDraft`.

### Mutation inputs / results
H: `SendVoiceNoteInput/Result`, `SendAttachmentInput/Result`,
`AnnotateImageInput/Result`, `ShareInChatInput/Result`,
`EscalateToCallInput/Result`, `ReportMessageInput/Result`, `EndChatInput/Result`.
I: `RunDeviceCheckInput/Result`, `JoinCallInput/Result`, `LeaveCallInput/Result`,
`SwitchProviderInput/Result`, `SubmitCallFeedbackInput/Result`,
`RaiseCallDisputeInput/Result`, `ReportTechnicalIssueInput/Result`.
J: `SaveDraftNoteInput/Result`, `FinalizeNoteInput/Result`,
`ShareSummaryInput/Result`.

> Composition note: `PatientFullProfile`, `ChatMessageRich`, `CallSessionRich`
> and `ClinicalNote` each **compose** the Phase 1 entity under a `base` field
> rather than redeclaring it — the base shapes are reused verbatim.

---

## 2. API functions (`@/api/doctor.batch2.api`)

### Reads (resolve `DEMO_*`)
```ts
getPatientFullProfile(patientId: string): Promise<PatientFullProfile>

getRichMessages(threadId: string): Promise<ChatMessageRich[]>
getThreadState(threadId: string): Promise<ChatThreadState>
getChatPresence(threadId: string): Promise<ChatParticipantPresence[]>
getTranscript(threadId: string): Promise<ChatTranscript>

getCallSessionRich(appointmentId: string): Promise<CallSessionRich>
getPreCallCheck(appointmentId: string): Promise<PreCallCheck>
getCallDisputes(): Promise<CallDispute[]>

getClinicalNote(appointmentId: string): Promise<ClinicalNote | undefined>
```

### Pure helpers (safe to call directly)
```ts
searchDiagnosisCodes(query: string): DiagnosisCode[]   // filters ICD_CODES
formatKobo(kobo: number): string                       // re-exported
```

### Mutations (each appends `Idempotency-Key`; hooks generate it)
```ts
// Section H
sendVoiceNote(input: SendVoiceNoteInput): Promise<SendVoiceNoteResult>
sendAttachment(input: SendAttachmentInput): Promise<SendAttachmentResult>
annotateImage(input: AnnotateImageInput): Promise<AnnotateImageResult>
shareInChat(input: ShareInChatInput): Promise<ShareInChatResult>
escalateToCall(input: EscalateToCallInput): Promise<EscalateToCallResult>
reportMessage(input: ReportMessageInput): Promise<ReportMessageResult>
endChat(input: EndChatInput): Promise<EndChatResult>

// Section I
runDeviceCheck(input: RunDeviceCheckInput): Promise<RunDeviceCheckResult>
joinCall(input: JoinCallInput): Promise<JoinCallResult>
leaveCall(input: LeaveCallInput): Promise<LeaveCallResult>
switchProvider(input: SwitchProviderInput): Promise<SwitchProviderResult>
submitCallFeedback(input: SubmitCallFeedbackInput): Promise<SubmitCallFeedbackResult>
raiseCallDispute(input: RaiseCallDisputeInput): Promise<RaiseCallDisputeResult>
reportTechnicalIssue(input: ReportTechnicalIssueInput): Promise<ReportTechnicalIssueResult>

// Section J
saveDraftNote(input: SaveDraftNoteInput): Promise<SaveDraftNoteResult>
finalizeNote(input: FinalizeNoteInput): Promise<FinalizeNoteResult>   // locks the note
shareSummary(input: ShareSummaryInput): Promise<ShareSummaryResult>
```

### DEMO_* exports (used as `placeholderData`)
`DEMO_PATIENT_FULL_PROFILE`, `DEMO_RICH_MESSAGES`, `DEMO_THREAD_STATE`,
`DEMO_TRANSCRIPT`, `DEMO_CALL_SESSION_RICH`, `DEMO_PRECALL_CHECK`,
`DEMO_CALL_DISPUTES`, `DEMO_CALL_FEEDBACK`, `DEMO_CLINICAL_NOTE`.

---

## 3. Hooks (`@/features/doctor/hooks`)

Frontend calls these — not the API fns. Mutations take
`Omit<Input, 'idempotencyKey'>`; the key is auto-generated.

### Section G — `usePatientReview.ts`
```ts
usePatientFullProfile(patientId: string)   // → PatientFullProfile (placeholderData wired)
```
> REUSES Phase 1 `usePatientProfile` for the lightweight base snapshot.

### Section H — `useChatConsult.ts`
```ts
useRichMessages(threadId: string)          // → ChatMessageRich[]
useThreadState(threadId: string)           // → ChatThreadState (presence + lifecycle + secure notice)
useChatPresence(threadId: string)          // → ChatParticipantPresence[]
useChatTranscript(threadId: string)        // → ChatTranscript
useSendVoiceNote()                         // mutate(SendVoiceNoteInput w/o key)
useSendAttachment()                        // mutate(SendAttachmentInput w/o key)  — image | document
useAnnotateImage()                         // mutate(AnnotateImageInput w/o key)
useShareInChat()                           // mutate(ShareInChatInput w/o key)     — prescription | lab | summary
useEscalateToCall()                        // mutate(EscalateToCallInput w/o key)  — audio | video
useReportMessage()                         // mutate(ReportMessageInput w/o key)
useEndChat()                               // mutate(EndChatInput w/o key)
```
> REUSES Phase 1 `useChatThreads`, `useChatMessages`, `useSendChatMessage` (text).

### Section I — `useCall.ts`
```ts
useCallSessionRich(appointmentId: string)  // → CallSessionRich (phase/provider/network/controls/participants)
usePreCallCheck(appointmentId: string)     // → PreCallCheck
useCallDisputes()                          // → CallDispute[]
useRunDeviceCheck()                        // mutate(RunDeviceCheckInput w/o key) → PreCallCheck
useJoinCall()                              // mutate(JoinCallInput w/o key)
useLeaveCall()                             // mutate(LeaveCallInput w/o key) → includes CallDurationSummary
useSwitchProvider()                        // mutate(SwitchProviderInput w/o key) — Agora → VideoSDK fallback
useSubmitCallFeedback()                    // mutate(SubmitCallFeedbackInput w/o key)
useRaiseCallDispute()                      // mutate(RaiseCallDisputeInput w/o key)
useReportTechnicalIssue()                  // mutate(ReportTechnicalIssueInput w/o key)
```
> REUSES Phase 1 `useCallSession` (base) and `useUpdateAppointmentStatus`.

### Section J — `useClinicalNote.ts`
```ts
useClinicalNote(appointmentId: string)     // → ClinicalNote | undefined
useSaveDraftNote()                         // mutate(SaveDraftNoteInput w/o key) → status 'draft'
useFinalizeNote()                          // mutate(FinalizeNoteInput w/o key)  → status 'locked'
useShareSummary()                          // mutate(ShareSummaryInput w/o key)
searchDiagnosisCodes(query)                // pure helper, re-exported from the hook module
```
> REUSES Phase 1 `useSoapNote` / `useSaveSoapNote` for the plain SOAP path.

---

## 4. Constants (`@/features/doctor/constants`, from `batch2`)

Section G: `PATIENT_TYPE_LABELS`, `RELATIONSHIP_OPTIONS`, `SYMPTOM_OPTIONS`,
`SYMPTOM_SEVERITY_OPTIONS`, `ALLERGY_TYPE_OPTIONS`,
`PATIENT_DOCUMENT_KIND_LABELS`, `CLINICAL_ALERT_TONES`.
Section H: `MESSAGE_KIND_LABELS`, `DELIVERY_STATUS_LABELS`,
`CHAT_PRESENCE_LABELS`, `REPORT_REASONS`, `SECURE_CHAT_NOTICE`.
Section I: `CALL_PROVIDER_LABELS`, `NETWORK_QUALITY_LABELS`,
`CALL_FEEDBACK_RATING_LABELS`, `TECHNICAL_ISSUE_CATEGORIES`,
`CALL_DISPUTE_REASONS`.
Section J: `ICD_CODES` (searchable catalogue), `DIAGNOSIS_CATEGORIES`,
`RED_FLAG_OPTIONS`, `LIFESTYLE_CATEGORIES`, `FOLLOW_UP_INTERVAL_OPTIONS`,
`CLINICAL_NOTE_STATUS_LABELS`.

> `CHAT_PRESENCE_LABELS` is named to avoid colliding with Batch 1's
> `PRESENCE_LABELS` (which labels `DoctorPresence`, not chat `PresenceStatus`).
> REUSES barrel `DIAGNOSIS_OPTIONS`, `DRUG_CATALOGUE`, `SUPPORT_CATEGORIES`.

---

## 5. Loading / error / empty conventions

- **Loading:** `isLoading` on queries; `DEMO_*` wired as `placeholderData`.
- **Error:** `isError` / `error` on queries; `isPending` / `isError` / `error`
  on mutations.
- **Empty:** array fields are `[]` (never `null`); optional singles are
  `undefined` (`hmoCoverage?`, `emergencyContact?`, `getClinicalNote` may resolve
  `undefined` before the first draft).
- **Money:** integers in kobo; format with `formatKobo`.
