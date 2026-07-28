# Doctor Module — Live Endpoint Inventory (backend build list)

Every endpoint the backend must implement to satisfy the doctor (provider)
module when `EXPO_PUBLIC_DOCTOR_USE_MOCK=false`. All paths are relative to the
prefix **`/api/v1/doctor`** on `EXPO_PUBLIC_API_BASE_URL`. Path params shown as `:id`,
`:patientId`, etc.; remaining `input` fields and all read filters travel as the
JSON body (mutations) or query string (reads). Money fields (`*Kobo`) are **kobo**
integers. Mutations send `Idempotency-Key: <input.idempotencyKey>` and must be
deduped. Response envelope: `res.data.data ?? res.data` (see DOCTOR_GO_LIVE.md).

## MVP (doctor.api.ts)

| Function | Method | Path | Response | Idempotent |
|---|---|---|---|---|
| `getDoctorProfile` | GET | `/profile` | `DoctorProfile` | no |
| `getVerification` | GET | `/verification` | `VerificationSubmission` | no |
| `getAvailability` | GET | `/availability` | `AvailabilitySchedule` | no |
| `getAppointments` | GET | `/appointments` | `DoctorAppointment[]` | no |
| `getAppointment` | GET | `/appointments/:id` | `DoctorAppointment \| undefined` | no |
| `getPatientProfile` | GET | `/patients/:patientId` | `PatientMedicalProfile` | no |
| `getChatThreads` | GET | `/chat/threads` | `ChatThread[]` | no |
| `getChatMessages` | GET | `/chat/:threadId/messages` | `ChatMessage[]` | no |
| `getCallSession` | GET | `/calls/:appointmentId` | `CallSession` | no |
| `getSoapNote` | GET | `/appointments/:appointmentId/notes` | `SoapNote \| undefined` | no |
| `getPrescriptions` | GET | `/prescriptions` | `DoctorPrescription[]` | no |
| `getPrescription` | GET | `/prescriptions/:id` | `DoctorPrescription \| undefined` | no |
| `getLabOrders` | GET | `/lab-orders` | `LabOrder[]` | no |
| `getLabResult` | GET | `/lab-orders/:orderId/result` | `LabResult` | no |
| `getHmoEligibility` | GET | `/appointments/:appointmentId/hmo-eligibility` | `HmoEligibility` | no |
| `getEarnings` | GET | `/earnings` | `EarningsSummary` | no |
| `getNotifications` | GET | `/notifications` | `DoctorNotification[]` | no |
| `getSupportTickets` | GET | `/support/tickets` | `SupportTicket[]` | no |
| `getSettings` | GET | `/settings` | `DoctorSettings` | no |
| `submitVerification` | POST | `/verification` | `SubmitVerificationResult` | yes |
| `updateAvailability` | PUT | `/availability` | `AvailabilitySchedule` | yes |
| `updateAppointmentStatus` | POST | `/appointments/:appointmentId/status` | `{ status: ConsultStatus }` | yes |
| `saveSoapNote` | POST | `/appointments/:appointmentId/notes` | `SoapNote` | yes |
| `createPrescription` | POST | `/prescriptions` | `CreatePrescriptionResult` | yes |
| `createLabOrder` | POST | `/lab-orders` | `CreateLabOrderResult` | yes |
| `markLabResultReviewed` | POST | `/lab-results/:resultId/review` | `{ reviewed: boolean }` | yes |
| `sendChatMessage` | POST | `/chat/:threadId/messages` | `ChatMessage` | yes |
| `requestPayout` | POST | `/payouts` | `RequestPayoutResult` | yes |
| `createSupportTicket` | POST | `/support/tickets` | `CreateSupportTicketResult` | yes |
| `updateSettings` | PUT | `/settings` | `DoctorSettings` | yes |

## Phase 2 (doctor.phase2.api.ts)

| Function | Method | Path | Response | Idempotent |
|---|---|---|---|---|
| `getPharmacyFulfilments` | GET | `/pharmacy/fulfilments` | `PharmacyFulfilment[]` | no |
| `getPharmacyFulfilment` | GET | `/pharmacy/fulfilments/:id` | `PharmacyFulfilment \| undefined` | no |
| `getDrugDeliveries` | GET | `/drug-deliveries` | `DrugDelivery[]` | no |
| `getDrugDelivery` | GET | `/pharmacy/fulfilments/:fulfilmentId/delivery` | `DrugDelivery \| undefined` | no |
| `getRefillRequests` | GET | `/refills` | `RefillRequest[]` | no |
| `getRefillRequest` | GET | `/refills/:id` | `RefillRequest \| undefined` | no |
| `getSpecialists` | GET | `/specialists` | `Specialist[]` | no |
| `getReferrals` | GET | `/referrals` | `SpecialistReferral[]` | no |
| `getReferral` | GET | `/referrals/:id` | `SpecialistReferral \| undefined` | no |
| `getPatientRecordHub` | GET | `/patients/:patientId/record-hub` | `PatientRecordHub` | no |
| `getHmoClaims` | GET | `/hmo/claims` | `HmoClaim[]` | no |
| `getHmoClaim` | GET | `/hmo/claims/:id` | `HmoClaim \| undefined` | no |
| `getFollowUps` | GET | `/follow-ups` | `FollowUpPlan[]` | no |
| `getFollowUp` | GET | `/follow-ups/:id` | `FollowUpPlan \| undefined` | no |
| `getReputation` | GET | `/reputation` | `ReputationSummary` | no |
| `getPayoutReport` | GET | `/payout-report` | `PayoutReport` | no |
| `getComplianceDashboard` | GET | `/compliance` | `ComplianceDashboard` | no |
| `reviewSubstitute` | POST | `/pharmacy/fulfilments/:fulfilmentId/substitute` | `ReviewSubstituteResult` | yes |
| `reviewRefill` | POST | `/refills/:refillId/review` | `ReviewRefillResult` | yes |
| `createReferral` | POST | `/referrals` | `CreateReferralResult` | yes |
| `submitClaim` | POST | `/hmo/claims` | `SubmitClaimResult` | yes |
| `disputeClaim` | POST | `/hmo/claims/:claimId/dispute` | `DisputeClaimResult` | yes |
| `createFollowUp` | POST | `/follow-ups` | `CreateFollowUpResult` | yes |
| `reviewFollowUpRequest` | POST | `/follow-ups/:followUpId/review` | `ReviewFollowUpRequestResult` | yes |
| `reportReview` | POST | `/reviews/:reviewId/report` | `ReportReviewResult` | yes |
| `acknowledgePolicy` | POST | `/compliance/policies/:policyKey/ack` | `AcknowledgePolicyResult` | yes |

## Phase 3 — vet / AI / practice (doctor.phase3.api.ts)

| Function | Method | Path | Response | Idempotent |
|---|---|---|---|---|
| `getVetDashboard` | GET | `/vet/dashboard` | `VetDashboard` | no |
| `getPetProfile` | GET | `/vet/pets/:petId` | `PetProfile` | no |
| `getPetPrescription` | GET | `/vet/pets/:petId/prescription` | `PetPrescription` | no |
| `getPetLabOrders` | GET | `/vet/lab-orders` | `PetLabOrder[]` | no |
| `getPetLabResult` | GET | `/vet/lab-orders/:orderId/result` | `PetLabResult \| undefined` | no |
| `getPetProducts` | GET | `/vet/products` | `PetStoreProduct[]` | no |
| `getPetRecommendations` | GET | `/vet/pets/:petId/recommendations` | `PetProductRecommendation[]` | no |
| `getQualityAnalytics` | GET | `/analytics/quality` | `QualityAnalytics` | no |
| `getClinicPortfolio` | GET | `/clinics` | `ClinicPortfolio` | no |
| `getAiNoteSummary` | GET | `/ai/note-summary/:appointmentId` | `AiNoteSummary` | no |
| `getAiSafetyReport` | GET | `/ai/rx-safety/:id` | `AiSafetyReport` | no |
| `getAiLabExplanation` | GET | `/ai/lab-explanation/:resultId` | `AiLabExplanation` | no |
| `toggleVetMode` | POST | `/vet/mode` | `ToggleVetModeResult` | yes |
| `createPetPrescription` | POST | `/vet/prescriptions` | `CreatePetPrescriptionResult` | yes |
| `createPetLabOrder` | POST | `/vet/lab-orders` | `CreatePetLabOrderResult` | yes |
| `markPetLabResultReviewed` | POST | `/vet/lab-results/:resultId/review` | `{ resultId: string; reviewed: boolean }` | yes |
| `recommendProducts` | POST | `/vet/recommendations` | `RecommendProductsResult` | yes |
| `generateAiNoteSummary` | POST | `/ai/note-summary` | `AiNoteSummary` | yes |
| `acceptAiNoteSummary` | POST | `/ai/note-summary/accept` | `AcceptAiNoteSummaryResult` | yes |
| `checkPrescriptionSafety` | POST | `/ai/rx-safety` | `AiSafetyReport` | yes |
| `explainLabResult` | POST | `/ai/lab-explanation` | `AiLabExplanation` | yes |
| `setActiveClinic` | POST | `/clinics/active` | `SetActiveClinicResult` | yes |
| `updateClinicSchedule` | PATCH | `/clinics/:clinicId/schedule` | `UpdateClinicScheduleResult` | yes |

## Profile & Verification — Section B (doctor.profile.api.ts)

| Function | Method | Path | Response | Idempotent |
|---|---|---|---|---|
| `getProfileDraft` | GET | `/profile/draft` | `DoctorProfileDraft` | no |
| `getDocumentSlots` | GET | `/profile/documents` | `ProfileDocumentSlot[]` | no |
| `getLicenceExpiryWarning` | GET | `/licence/expiry-warning` | `LicenceExpiryWarning \| undefined` | no |
| `getVerificationDecision` | GET | `/verification/decision` | `VerificationDecision` | no |
| `saveProfileDraft` | PUT | `/profile/draft` | `SaveProfileDraftResult` | yes |
| `uploadProfilePhoto` | POST | `/profile/photo` | `UploadResult` | yes |
| `uploadDocument` | POST | `/profile/documents` | `UploadResult` | yes |
| `saveBankAccount` | POST | `/profile/bank-account` | `SaveBankAccountResult` | yes |
| `saveTaxInfo` | PUT | `/profile/tax-info` | `SaveTaxInfoResult` | yes |
| `submitProfileVerification` | POST | `/verification` | `SubmitProfileVerificationResult` | yes |
| `renewLicence` | POST | `/licence/renew` | `RenewLicenceResult` | yes |
| `publishProfile` | POST | `/profile/publish` | `PublishProfileResult` | yes |

## Batch 1 — Vet profile / Dashboard / Schedule / Queue (doctor.batch1.api.ts)

| Function | Method | Path | Response | Idempotent |
|---|---|---|---|---|
| `getVetProfileDraft` | GET | `/vet/profile/draft` | `VetProfileDraft` | no |
| `getVetDocumentSlots` | GET | `/vet/profile/documents` | `ProfileDocumentSlot[]` | no |
| `getVetVerification` | GET | `/vet/verification` | `VetVerificationSubmission` | no |
| `saveVetProfileDraft` | PUT | `/vet/profile/draft` | `SaveVetProfileDraftResult` | yes |
| `submitVetVerification` | POST | `/vet/verification` | `SubmitVetVerificationResult` | yes |
| `renewVetLicence` | POST | `/vet/licence/renew` | `RenewVetLicenceResult` | yes |
| `publishVetProfile` | POST | `/vet/profile/publish` | `PublishVetProfileResult` | yes |
| `getDashboard` | GET | `/dashboard` | `DoctorDashboardData` | no |
| `getAnnouncement` | GET | `/announcements/latest` | `PlatformAnnouncement \| undefined` | no |
| `setPresence` | PUT | `/presence` | `SetPresenceResult` | yes |
| `dismissAnnouncement` | POST | `/announcements/:announcementId/dismiss` | `DismissAnnouncementResult` | yes |
| `getScheduleSettings` | GET | `/schedule` | `ScheduleSettings` | no |
| `getBlockedDates` | GET | `/schedule/blocked-dates` | `BlockedDate[]` | no |
| `blockDate` | POST | `/schedule/blocked-dates` | `BlockDateResult` | yes |
| `setVacation` | PUT | `/schedule/vacation` | `SetVacationResult` | yes |
| `toggleEmergency` | PUT | `/schedule/emergency` | `ToggleEmergencyResult` | yes |
| `saveReminderSettings` | PUT | `/schedule/reminders` | `SaveReminderSettingsResult` | yes |
| `saveRecurringRule` | PUT | `/schedule/recurring` | `SaveRecurringRuleResult` | yes |
| `setTimezone` | PUT | `/schedule/timezone` | `SetTimezoneResult` | yes |
| `getConsultationQueue` | GET | `/queue` | `ConsultationQueueItem[]` | no |
| `getAppointmentRequests` | GET | `/appointment-requests` | `AppointmentRequest[]` | no |
| `getAppointmentRequest` | GET | `/appointment-requests/:id` | `AppointmentRequest \| undefined` | no |
| `acceptAppointment` | POST | `/appointments/:appointmentId/accept` | `AcceptAppointmentResult` | yes |
| `rejectAppointment` | POST | `/appointments/:appointmentId/reject` | `RejectAppointmentResult` | yes |
| `requestReschedule` | POST | `/appointments/:appointmentId/request-reschedule` | `RequestRescheduleResult` | yes |
| `rescheduleAppointment` | POST | `/appointments/:appointmentId/reschedule` | `RescheduleAppointmentResult` | yes |
| `cancelAppointment` | POST | `/appointments/:appointmentId/cancel` | `CancelAppointmentResult` | yes |
| `startConsultation` | POST | `/appointments/:appointmentId/start` | `StartConsultationResult` | yes |
| `endConsultation` | POST | `/appointments/:appointmentId/end` | `EndConsultationResult` | yes |
| `markNoShow` | POST | `/appointments/:appointmentId/no-show` | `MarkNoShowResult` | yes |

## Batch 2 — Patient profile / Chat / Calls / Notes (doctor.batch2.api.ts)

| Function | Method | Path | Response | Idempotent |
|---|---|---|---|---|
| `getPatientFullProfile` | GET | `/patients/:patientId/full-profile` | `PatientFullProfile` | no |
| `getRichMessages` | GET | `/chat/:threadId/rich-messages` | `ChatMessageRich[]` | no |
| `getThreadState` | GET | `/chat/:threadId/state` | `ChatThreadState` | no |
| `getChatPresence` | GET | `/chat/:threadId/presence` | `ChatParticipantPresence[]` | no |
| `getTranscript` | GET | `/chat/:threadId/transcript` | `ChatTranscript` | no |
| `sendVoiceNote` | POST | `/chat/:threadId/voice` | `SendVoiceNoteResult` | yes |
| `sendAttachment` | POST | `/chat/:threadId/attachments` | `SendAttachmentResult` | yes |
| `annotateImage` | PUT | `/chat/messages/:messageId/annotations` | `AnnotateImageResult` | yes |
| `shareInChat` | POST | `/chat/:threadId/share` | `ShareInChatResult` | yes |
| `escalateToCall` | POST | `/chat/:threadId/escalate` | `EscalateToCallResult` | yes |
| `reportMessage` | POST | `/chat/messages/:messageId/report` | `ReportMessageResult` | yes |
| `endChat` | POST | `/chat/:threadId/end` | `EndChatResult` | yes |
| `getCallSessionRich` | GET | `/calls/:appointmentId/rich` | `CallSessionRich` | no |
| `getPreCallCheck` | GET | `/calls/:appointmentId/pre-check` | `PreCallCheck` | no |
| `getCallDisputes` | GET | `/calls/disputes` | `CallDispute[]` | no |
| `joinCall` | POST | `/calls/:appointmentId/join` | `JoinCallResult` | yes |
| `leaveCall` | POST | `/calls/:appointmentId/leave` | `LeaveCallResult` | yes |
| `switchProvider` | POST | `/calls/:appointmentId/switch-provider` | `SwitchProviderResult` | yes |
| `submitCallFeedback` | POST | `/calls/:appointmentId/feedback` | `SubmitCallFeedbackResult` | yes |
| `raiseCallDispute` | POST | `/calls/:appointmentId/dispute` | `RaiseCallDisputeResult` | yes |
| `reportTechnicalIssue` | POST | `/support/technical` | `ReportTechnicalIssueResult` | yes |
| `getClinicalNote` | GET | `/appointments/:appointmentId/clinical-note` | `ClinicalNote \| undefined` | no |
| `saveDraftNote` | PUT | `/appointments/:appointmentId/clinical-note` | `SaveDraftNoteResult` | yes |
| `finalizeNote` | POST | `/clinical-notes/:noteId/finalize` | `FinalizeNoteResult` | yes |
| `shareSummary` | POST | `/clinical-notes/:noteId/share` | `ShareSummaryResult` | yes |

## Batch 3 — Prescriptions / Pharmacy / Lab order & results (doctor.batch3.api.ts)

| Function | Method | Path | Response | Idempotent |
|---|---|---|---|---|
| `getIssuedPrescription` | GET | `/prescriptions/:id/issued` | `IssuedPrescription` | no |
| `issuePrescription` | POST | `/prescriptions/:prescriptionId/issue` | `IssuePrescriptionResult` | yes |
| `cancelPrescription` | POST | `/prescriptions/:prescriptionId/cancel` | `CancelPrescriptionResult` | yes |
| `sharePrescription` | POST | `/prescriptions/:prescriptionId/share` | `SharePrescriptionResult` | yes |
| `sendToPharmacy` | POST | `/prescriptions/:prescriptionId/send-to-pharmacy` | `SendToPharmacyResult` | yes |
| `requestRefillConsultation` | POST | `/prescriptions/:prescriptionId/refill-consultation` | `RequestRefillConsultationResult` | yes |
| `getPharmacies` | GET | `/pharmacies` | `Pharmacy[]` | no |
| `getPreferredPharmacy` | GET | `/pharmacies/preferred` | `Pharmacy \| undefined` | no |
| `getDrugStock` | GET | `/pharmacies/:pharmacyId/stock` | `DrugStock[]` | no |
| `getPharmacyMessages` | GET | `/pharmacy/:fulfilmentId/messages` | `PharmacyMessage[]` | no |
| `getDeliveryAlerts` | GET | `/delivery-alerts` | `DeliveryAlert[]` | no |
| `selectPharmacy` | POST | `/prescriptions/:prescriptionId/pharmacy` | `SelectPharmacyResult` | yes |
| `sendPharmacyMessage` | POST | `/pharmacy/:fulfilmentId/messages` | `SendPharmacyMessageResult` | yes |
| `confirmPatientReceived` | POST | `/pharmacy/:fulfilmentId/received` | `ConfirmPatientReceivedResult` | yes |
| `reportPharmacy` | POST | `/pharmacy/:pharmacyId/report` | `ReportPharmacyResult` | yes |
| `getLabCatalogue` | GET | `/lab-catalogue` | `LabCatalogueEntry[]` | no |
| `getLabPackages` | GET | `/lab-packages` | `LabPackage[]` | no |
| `getLabProviders` | GET | `/lab-providers` | `LabProvider[]` | no |
| `getLabOrderRich` | GET | `/lab-orders/:orderId/rich` | `LabOrderRich` | no |
| `shareLabOrder` | POST | `/lab-orders/:orderId/share` | `ShareLabOrderResult` | yes |
| `cancelLabOrder` | POST | `/lab-orders/:orderId/cancel` | `CancelLabOrderResult` | yes |
| `getResultInbox` | GET | `/lab-results/inbox` | `LabResultInbox[]` | no |
| `getLabResultRich` | GET | `/lab-results/:resultId/rich` | `LabResultRich` | no |
| `getLabValueComparisons` | GET | `/lab-results/:resultId/comparisons` | `LabValueComparison[]` | no |
| `addInterpretation` | PUT | `/lab-results/:resultId/interpretation` | `AddInterpretationResult` | yes |
| `requestRepeatTest` | POST | `/lab-orders` | `RequestRepeatTestResult` | yes |
| `shareResultExplanation` | POST | `/lab-results/:resultId/share-explanation` | `ShareResultExplanationResult` | yes |
| `reportSuspiciousResult` | POST | `/lab-results/:resultId/report` | `ReportSuspiciousResultResult` | yes |

## Batch 4 — HMO / Referrals / Care plans / Emergency (doctor.batch4.api.ts)

| Function | Method | Path | Response | Idempotent |
|---|---|---|---|---|
| `getHmoPlanCoverage` | GET | `/hmo/coverage/:patientId` | `HmoPlanCoverage` | no |
| `getPreAuthRequests` | GET | `/hmo/pre-auth` | `PreAuthRequest[]` | no |
| `getPreAuthRequest` | GET | `/hmo/pre-auth/:id` | `PreAuthRequest \| undefined` | no |
| `getCoveredServices` | GET | `/hmo/covered-services` | `CoveredService[]` | no |
| `getHmoSupportThread` | GET | `/hmo/support/:threadId` | `HmoSupportThread` | no |
| `getHmoFraudWarnings` | GET | `/hmo/fraud-warnings` | `HmoFraudWarning[]` | no |
| `getIncomingReferrals` | GET | `/referrals/incoming` | `IncomingReferral[]` | no |
| `getIncomingReferral` | GET | `/referrals/incoming/:id` | `IncomingReferral \| undefined` | no |
| `getOpinionRequests` | GET | `/opinions` | `OpinionRequest[]` | no |
| `getOpinionRequest` | GET | `/opinions/:id` | `OpinionRequest \| undefined` | no |
| `getCareTeamThread` | GET | `/care-team/:threadId` | `CareTeamThread` | no |
| `getSharedCaseSummary` | GET | `/case-summaries/:caseRef` | `SharedCaseSummary` | no |
| `getFollowUpEligibility` | GET | `/patients/:patientId/follow-up-eligibility` | `FollowUpEligibility` | no |
| `getLongTermCarePlans` | GET | `/care-plans` | `LongTermCarePlan[]` | no |
| `getLongTermCarePlan` | GET | `/care-plans/:id` | `LongTermCarePlan \| undefined` | no |
| `getChronicMonitoring` | GET | `/chronic-monitoring` | `ChronicMonitoringEntry[]` | no |
| `getAdherenceChecks` | GET | `/adherence-checks` | `MedicationAdherenceCheck[]` | no |
| `getEmergencyFacilities` | GET | `/emergency/facilities` | `EmergencyFacility[]` | no |
| `getRedFlagAlerts` | GET | `/red-flag-alerts` | `RedFlagAlert[]` | no |
| `getEmergencyEscalations` | GET | `/emergency/escalations` | `EmergencyEscalation[]` | no |
| `getEmergencyCaseRecords` | GET | `/emergency/cases` | `EmergencyCaseRecord[]` | no |
| `getEmergencyCaseRecord` | GET | `/emergency/cases/:id` | `EmergencyCaseRecord \| undefined` | no |
| `requestPreAuth` | POST | `/hmo/pre-auth` | `RequestPreAuthResult` | yes |
| `sendHmoSupportMessage` | POST | `/hmo/support/:threadId/messages` | `SendHmoSupportMessageResult` | yes |
| `acknowledgeFraudWarning` | POST | `/hmo/fraud-warnings/:warningId/ack` | `AcknowledgeFraudWarningResult` | yes |
| `acceptReferral` | POST | `/referrals/incoming/:referralId/accept` | `AcceptReferralResult` | yes |
| `rejectReferral` | POST | `/referrals/incoming/:referralId/reject` | `RejectReferralResult` | yes |
| `requestOpinion` | POST | `/opinions` | `RequestOpinionResult` | yes |
| `sendCareTeamMessage` | POST | `/care-team/:threadId/messages` | `SendCareTeamMessageResult` | yes |
| `setFollowUpReminder` | POST | `/follow-ups/:followUpId/reminder` | `SetFollowUpReminderResult` | yes |
| `completeFollowUp` | POST | `/follow-ups/:followUpId/complete` | `CompleteFollowUpResult` | yes |
| `recordAdherenceCheck` | POST | `/adherence-checks` | `RecordAdherenceCheckResult` | yes |
| `saveCarePlan` | POST | `/care-plans` | `SaveCarePlanResult` | yes |
| `escalateToHospital` | POST | `/emergency/escalate/hospital` | `EscalateResult` | yes |
| `escalateToAmbulance` | POST | `/emergency/escalate/ambulance` | `EscalateResult` | yes |
| `notifyEmergencyContact` | POST | `/emergency/contacts/:patientId/notify` | `NotifyEmergencyContactResult` | yes |
| `documentEmergencyCase` | POST | `/emergency/cases` | `DocumentEmergencyCaseResult` | yes |
| `scheduleEmergencyFollowUp` | POST | `/follow-ups` | `ScheduleEmergencyFollowUpResult` | yes |

## Batch 5 — Vet consults / Rx / Lab / Records / Store (doctor.batch5.api.ts)

| Function | Method | Path | Response | Idempotent |
|---|---|---|---|---|
| `getVetAppointments` | GET | `/vet/appointments` | `VetAppointment[]` | no |
| `getPetOwnerRequests` | GET | `/vet/owner-requests` | `PetOwnerRequest[]` | no |
| `getVetChatThread` | GET | `/vet/pets/:petId/chat` | `VetChatThread` | no |
| `getVetCallSession` | GET | `/vet/pets/:petId/call` | `VetCallSession` | no |
| `getVetSoapNote` | GET | `/vet/pets/:petId/soap-note` | `VetClinicalNote` | no |
| `getPetEmergencyWarnings` | GET | `/vet/pets/:petId/emergency-warnings` | `PetEmergencyWarning[]` | no |
| `getVetSpecialists` | GET | `/vet/specialists` | `VetSpecialist[]` | no |
| `getVetReferrals` | GET | `/vet/pets/:petId/referrals` | `VetReferral[]` | no |
| `getVetConsultSummary` | GET | `/vet/consults/:consultId/summary` | `VetConsultSummary` | no |
| `getVetConsultHistory` | GET | `/vet/consults/history` | `VetConsultHistoryItem[]` | no |
| `getPetPharmacies` | GET | `/vet/pharmacies` | `PetPharmacy[]` | no |
| `getIssuedPetPrescription` | GET | `/vet/prescriptions/:prescriptionId/issued` | `IssuedPetPrescription` | no |
| `getPetRefillRequests` | GET | `/vet/refills` | `PetRefillRequest[]` | no |
| `getPetLabCatalogue` | GET | `/vet/lab-catalogue` | `PetLabCatalogueEntry[]` | no |
| `getPetLabInbox` | GET | `/vet/lab-results/inbox` | `PetLabResultInboxItem[]` | no |
| `getPetVaccinationRecommendations` | GET | `/vet/pets/:petId/vaccination-recommendations` | `PetVaccinationRecommendation[]` | no |
| `getPetVaccinationReminders` | GET | `/vet/pets/:petId/vaccination-reminders` | `PetVaccinationReminder[]` | no |
| `getPetHealthRecord` | GET | `/vet/pets/:petId/health-record` | `PetHealthRecord` | no |
| `getPetGrowthHistory` | GET | `/vet/pets/:petId/growth` | `PetGrowthHistory` | no |
| `getPetChronicMonitoring` | GET | `/vet/pets/:petId/chronic-monitoring` | `PetChronicMonitoringEntry[]` | no |
| `getPetProductDetail` | GET | `/vet/products/:productId` | `PetProductDetail` | no |
| `getPetProductFulfilments` | GET | `/vet/product-fulfilments` | `PetProductFulfilment[]` | no |
| `getPetProductFulfilment` | GET | `/vet/product-fulfilments/:id` | `PetProductFulfilment \| undefined` | no |
| `respondToPetRequest` | POST | `/vet/requests/:requestId/respond` | `RespondToPetRequestResult` | yes |
| `saveVetSoapNote` | POST | `/vet/soap-notes` | `SaveVetSoapNoteResult` | yes |
| `createVetReferral` | POST | `/vet/referrals` | `CreateVetReferralResult` | yes |
| `issuePetPrescription` | POST | `/vet/prescriptions/:prescriptionId/issue` | `IssuePetPrescriptionResult` | yes |
| `sendPetRxToPharmacy` | POST | `/vet/prescriptions/:prescriptionId/send` | `SendPetRxToPharmacyResult` | yes |
| `requestPetRefill` | POST | `/vet/refills` | `RequestPetRefillResult` | yes |
| `reviewPetRefill` | POST | `/vet/refills/:refillId/review` | `ReviewPetRefillResult` | yes |
| `addPetLabInterpretation` | POST | `/vet/lab-results/:resultId/interpretation` | `AddPetLabInterpretationResult` | yes |
| `setPetVaccinationReminder` | POST | `/vet/vaccination-reminders` | `SetPetVaccinationReminderResult` | yes |
| `recordPetGrowth` | POST | `/vet/pets/:petId/growth` | `RecordPetGrowthResult` | yes |
| `savePetChronicMonitoring` | POST | `/vet/pets/:petId/chronic-monitoring` | `SavePetChronicMonitoringResult` | yes |
| `shareProductWithOwner` | POST | `/vet/recommendations/:recommendationId/share` | `ShareProductWithOwnerResult` | yes |

## Batch 6 — Records / Notifications / Earnings / Quality (doctor.batch6.api.ts)

| Function | Method | Path | Response | Idempotent |
|---|---|---|---|---|
| `getRecordsDashboard` | GET | `/records/dashboard` | `DoctorRecordsDashboard` | no |
| `getPatientRecordIndex` | GET | `/records/:patientId/index` | `PatientRecordIndex` | no |
| `getRecordRestrictions` | GET | `/records/:patientId/restrictions` | `RecordRestriction[]` | no |
| `getRestrictedRecordWarnings` | GET | `/records/:patientId/restricted-warnings` | `RestrictedRecordWarning[]` | no |
| `getRecordShares` | GET | `/records/shares` | `RecordShare[]` | no |
| `getRichNotifications` | GET | `/notifications` | `RichNotification[]` | no |
| `getNotificationGroups` | GET | `/notifications/groups` | `NotificationGroup[]` | no |
| `getNotificationPreferences` | GET | `/notifications/preferences` | `NotificationPreference[]` | no |
| `getEarningsBreakdown` | GET | `/earnings/breakdown` | `EarningsBreakdown` | no |
| `getWalletBalance` | GET | `/wallet/balance` | `WalletBalance` | no |
| `getPayoutDetails` | GET | `/payouts` | `PayoutDetail[]` | no |
| `getPayoutDetail` | GET | `/payouts/:id` | `PayoutDetail \| undefined` | no |
| `getInvoices` | GET | `/invoices` | `Invoice[]` | no |
| `getCommissionBreakdown` | GET | `/earnings/commission` | `CommissionBreakdown` | no |
| `getTaxVatReport` | GET | `/earnings/tax-vat` | `TaxVatReport` | no |
| `getSettlementDisputes` | GET | `/payouts/disputes` | `SettlementDispute[]` | no |
| `getConsultationFeedback` | GET | `/feedback` | `ConsultationFeedback[]` | no |
| `getQualityScore` | GET | `/quality/score` | `QualityScore` | no |
| `getRankingInsight` | GET | `/quality/ranking` | `RankingInsight` | no |
| `getImprovementRecommendations` | GET | `/quality/recommendations` | `ImprovementRecommendation[]` | no |
| `getReviewDisputes` | GET | `/reviews/disputes` | `ReviewDispute[]` | no |
| `downloadPatientRecord` | POST | `/records/:patientId/export` | `DownloadPatientRecordResult` | yes |
| `sharePatientRecordWithSpecialist` | POST | `/records/:patientId/share` | `SharePatientRecordResult` | yes |
| `requestRecordAccess` | POST | `/records/:patientId/access-request` | `RequestRecordAccessResult` | yes |
| `markNotificationRead` | POST | `/notifications/:notificationId/read` | `MarkNotificationReadResult` | yes |
| `markAllNotificationsRead` | POST | `/notifications/read-all` | `MarkAllNotificationsReadResult` | yes |
| `updateNotificationPrefs` | PUT | `/notifications/preferences` | `UpdateNotificationPrefsResult` | yes |
| `withdrawEarnings` | POST | `/payouts` | `WithdrawEarningsResult` | yes |
| `updatePayoutBankAccount` | PUT | `/payout-account` | `UpdatePayoutBankAccountResult` | yes |
| `raiseSettlementDispute` | POST | `/payouts/:payoutId/dispute` | `RaiseSettlementDisputeResult` | yes |
| `disputeReview` | POST | `/reviews/:reviewId/dispute` | `DisputeReviewResult` | yes |
| `requestReviewRemoval` | POST | `/reviews/:reviewId/removal-request` | `RequestReviewRemovalResult` | yes |

## Batch 7 — Support / Privacy / Security / Account (doctor.batch7.api.ts)

| Function | Method | Path | Response | Idempotent |
|---|---|---|---|---|
| `getFaqs` | GET | `/support/faqs` | `FaqItem[]` | no |
| `getHelpArticles` | GET | `/support/help-articles` | `HelpArticle[]` | no |
| `getDisputes` | GET | `/disputes` | `Dispute[]` | no |
| `getDispute` | GET | `/disputes/:id` | `Dispute \| undefined` | no |
| `getSupportMessages` | GET | `/support/:threadId/messages` | `SupportMessage[]` | no |
| `getVetLicence` | GET | `/vet/licence` | `VetLicenceInfo` | no |
| `getPrivacySettings` | GET | `/privacy` | `DataPrivacySettings` | no |
| `getAuditTrail` | GET | `/audit-trail` | `AuditTrail` | no |
| `getMandatoryTraining` | GET | `/training` | `MandatoryTraining` | no |
| `getSafetyIssues` | GET | `/safety-issues` | `SafetyIssueReport[]` | no |
| `getAccountReviewNotice` | GET | `/account/review-notice` | `AccountReviewNotice \| null` | no |
| `getSecuritySettings` | GET | `/security` | `SecuritySettings` | no |
| `getDevices` | GET | `/security/devices` | `Device[]` | no |
| `getAppPreferences` | GET | `/preferences` | `AppPreferences` | no |
| `getAppStatus` | GET | `/app-status` | `AppStatus` | no |
| `getAccountStatus` | GET | `/account/status` | `AccountStatus` | no |
| `createDispute` | POST | `/disputes` | `CreateDisputeResult` | yes |
| `uploadDisputeEvidence` | POST | `/disputes/:disputeId/evidence` | `UploadDisputeEvidenceResult` | yes |
| `sendSupportMessage` | POST | `/support/:threadId/messages` | `SendSupportMessageResult` | yes |
| `updatePrivacySettings` | PUT | `/privacy` | `UpdatePrivacySettingsResult` | yes |
| `completeTrainingModule` | POST | `/training/:moduleId/complete` | `CompleteTrainingModuleResult` | yes |
| `reportSafetyIssue` | POST | `/safety-issues` | `ReportSafetyIssueResult` | yes |
| `requestDataExport` | POST | `/privacy/export` | `RequestDataExportResult` | yes |
| `requestAccountDeletion` | POST | `/privacy/delete` | `RequestAccountDeletionResult` | yes |
| `changePassword` | POST | `/security/password` | `ChangePasswordResult` | yes |
| `setBiometric` | PUT | `/security/biometric` | `SetBiometricResult` | yes |
| `setTwoFactor` | PUT | `/security/2fa` | `SetTwoFactorResult` | yes |
| `revokeDevice` | DELETE | `/security/devices/:deviceId` | `RevokeDeviceResult` | yes |
| `updateAppPreferences` | PUT | `/preferences` | `UpdateAppPreferencesResult` | yes |
| `logout` | POST | `/auth/logout` | `LogoutResult` | yes |

**Total live endpoints: 309** across 11 modules.

> Request bodies/queries: each function passes the corresponding `*Input` object
> (mutations, as JSON body) or filter args (reads, as query params). Field names
> are defined in `src/types/doctor*.ts`. Key money/identity fields per call are
> the path params shown plus the `*Input` members (e.g. `amountKobo`, `bankAccount`,
> `signaturePin`, `categories`, `format`).