# Doctor Batch 7 — File Ownership Map

Batch 7 = spec **sections AA · AB · AC · AD** (Support & Dispute · Compliance,
Privacy & Audit · Settings · Empty/Error/Edge-State). This is the **FINAL C–AD
batch** and is **additive** to Phase 1, Phase 2, Section B, Phase 3 and Batch 1–6:
nothing in earlier contracts is edited (only the hooks/constants barrels gain new
export lines). Money is always integers in **kobo**.

**Consolidation + reuse principle:** granular variants (the 8 dispute kinds, the 4
audit scopes, the 26 edge states, statuses) are modelled as **states/data** on top
of a small set of entities, not as separate entities. Batch 7 leans **heavily on
the Phase 1 support-ticket + settings shapes**, the **Phase 2 compliance dashboard
/ licence / consent / audit / policy** shapes, the **Batch 6 notification-preference**
rows and the **Section B `BankAccount`** (reused, never redeclared). The tables below
mark each spec entry as a **full screen**, a **STATE of** an existing/sibling screen,
a **SHEET on** a screen, or a **REUSES existing** route/hook.

## Ownership boundaries (do not cross)

### BACKEND (data/type contract) — owns
- `src/types/doctor.batch7.ts`                          *(new)*
- `src/api/doctor.batch7.api.ts`                         *(new — incl. pure `getEdgeState`)*
- `src/features/doctor/hooks/useSupportCenter.ts`        *(new — Section AA)*
- `src/features/doctor/hooks/useComplianceCenter.ts`     *(new — Section AB)*
- `src/features/doctor/hooks/useSettingsCenter.ts`       *(new — Section AC)*
- `src/features/doctor/hooks/useAppStatus.ts`            *(new — Section AD)*
- `src/features/doctor/constants/batch7.ts`              *(new)*
- `src/features/doctor/hooks/index.ts`                   *(edited — additive export lines only)*
- `src/features/doctor/constants/index.ts`              *(edited — additive export line only)*

> Backend continues to own the Phase 1 / 2 / Section B / Phase 3 / Batch 1–6
> files unchanged. **No Spotlight legacy modules touched.**

### FRONTEND (screens/UI) — owns
- `app/(doctor)/**` (all route files). In particular the screens Batch 7 extends:
  - `app/(doctor)/support.tsx`              (AA — help centre / tickets / disputes hub)
  - `app/(doctor)/compliance/index.tsx`    (AB — compliance dashboard host)
  - `app/(doctor)/settings.tsx`            (AC — settings hub)
  - `app/(doctor)/signup/pending.tsx`      (AD — account-status states)
- `src/features/doctor/components/StateView.tsx` — the shared loading/empty/error
  component every AD edge state renders into (already exists; **not edited**).

---

## Section AA — Support & Dispute (18)

| # | Spec entry | Ownership | Hooks | Types |
|---|---|---|---|---|
| 1 | Help center | STATE of `support.tsx` (landing) | `useHelpArticles`, `useFaqs` | `HelpArticle`, `FaqItem` |
| 2 | FAQs | SHEET/section on `support.tsx` | `useFaqs` | `FaqItem`, `FaqCategory` |
| 3 | Contact support | SHEET on `support.tsx` | `useCreateSupportTicket` **(REUSE Phase 1)** | `CreateSupportTicketInput` **(REUSE)** |
| 4 | Support ticket list | STATE of `support.tsx` | `useSupportTickets` **(REUSE Phase 1)** | `SupportTicket` **(REUSE)** |
| 5 | Create support ticket | SHEET on `support.tsx` | `useCreateSupportTicket` **(REUSE)** | `CreateSupportTicketInput` **(REUSE)** |
| 6 | Technical issue report | SHEET on `support.tsx` (category=Technical) | `useCreateSupportTicket` **(REUSE)** | `CreateSupportTicketInput` **(REUSE)** |
| 7 | Payment issue report | `useCreateDispute` (kind=`payment`) | `useCreateDispute` | `Dispute`, `DisputeKind` |
| 8 | Consultation dispute | `Dispute` (kind=`consultation`) | `useCreateDispute` | `Dispute` |
| 9 | Patient complaint detail | `Dispute` (kind=`patient_complaint`) | `useDispute` | `Dispute` |
| 10 | Pharmacy dispute | `Dispute` (kind=`pharmacy`) | `useCreateDispute` | `Dispute` |
| 11 | Lab dispute | `Dispute` (kind=`lab`) | `useCreateDispute` | `Dispute` |
| 12 | HMO dispute | `Dispute` (kind=`hmo`) | `useCreateDispute` | `Dispute` |
| 13 | Prescription dispute | `Dispute` (kind=`prescription`) | `useCreateDispute` | `Dispute` |
| 14 | Call failure dispute | `Dispute` (kind=`call_failure`) | `useCreateDispute` | `Dispute` |
| 15 | Upload evidence | SHEET on dispute detail | `useUploadDisputeEvidence` | `EvidenceAttachment`, `EvidenceKind` |
| 16 | Support chat | STATE of ticket/dispute detail | `useSupportMessages`, `useSendSupportMessage` | `SupportMessage` (reuses `ChatAuthor`) |
| 17 | Ticket status | STATE of ticket row | `useSupportTickets` **(REUSE)** | `SupportTicketStatus` **(REUSE)** |
| 18 | Resolved support ticket | STATE (`status='resolved'`) of ticket list | `useSupportTickets` **(REUSE)** | `SupportTicketStatus` **(REUSE)** |

**AA consolidation:** the 8 dispute sub-screens collapse to **one `Dispute` union**
keyed by `DisputeKind`; the support-chat is **one `SupportMessage` thread** reusing
the Phase 1 `ChatAuthor` (+`agent`/`system`). Ticket list/status/resolved are
**states** over the REUSED `SupportTicket`.

---

## Section AB — Compliance, Privacy & Audit (16)

| # | Spec entry | Ownership | Hooks | Types |
|---|---|---|---|---|
| 1 | Compliance dashboard | `compliance/index.tsx` | `useComplianceDashboard` **(REUSE Phase 2)** | `ComplianceDashboard` **(REUSE)** |
| 2 | Medical licence status | STATE of dashboard | `useComplianceDashboard` **(REUSE)** | `LicenceInfo`, `LicenceStatus` **(REUSE)** |
| 3 | Vet licence status | STATE of dashboard (vet mode) | `useVetLicence` | `VetLicenceInfo` (extends `LicenceInfo`) |
| 4 | Data privacy settings | full screen | `usePrivacySettings`, `useUpdatePrivacySettings` | `DataPrivacySettings`, `DataSharingPreference` |
| 5 | Patient consent history | STATE of dashboard | `useComplianceDashboard` **(REUSE)** | `ConsentRecord` **(REUSE)** |
| 6 | Access log | STATE of dashboard | `useComplianceDashboard` **(REUSE)** | `ComplianceAuditEntry` **(REUSE)** |
| 7 | Prescription audit | `useAuditTrail('prescription')` | `useAuditTrail` | `AuditTrail`, `AuditTrailEntry`, `AuditScope` |
| 8 | Consultation audit trail | `useAuditTrail('consultation')` | `useAuditTrail` | `AuditTrail` |
| 9 | Lab order audit trail | `useAuditTrail('lab')` | `useAuditTrail` | `AuditTrail` |
| 10 | HMO claim audit trail | `useAuditTrail('hmo')` | `useAuditTrail` | `AuditTrail` |
| 11 | Suspicious activity alert | STATE of dashboard | `useComplianceDashboard` **(REUSE)** | `ComplianceAlert` (`severity='critical'`) **(REUSE)** |
| 12 | Compliance warning | STATE of dashboard | `useComplianceDashboard` **(REUSE)** | `ComplianceAlert` **(REUSE)** |
| 13 | Mandatory training | full screen | `useMandatoryTraining`, `useCompleteTrainingModule` | `MandatoryTraining`, `TrainingModule` |
| 14 | Policy update acknowledgement | SHEET on dashboard | `useAcknowledgePolicy` **(REUSE Phase 2)** | `PolicyAcknowledgement` **(REUSE)** |
| 15 | Account review notice | STATE/banner (also AD `account_review`) | `useAccountReviewNotice` | `AccountReviewNotice` |
| 16 | Report medical safety issue | SHEET / full screen | `useReportSafetyIssue`, `useSafetyIssues` | `SafetyIssueReport` |

**AB consolidation:** the 4 audit screens collapse to **one `AuditTrail` keyed by
`AuditScope`** (the entry extends the REUSED `ComplianceAuditEntry`). Suspicious-
activity / compliance-warning are **states** over the REUSED `ComplianceAlert`.
Data-export & account-deletion are **privacy mutations** (`useRequestDataExport`,
`useRequestAccountDeletion`) — see consolidation note below.

---

## Section AC — Settings (16)

| # | Spec entry | Ownership | Hooks | Types |
|---|---|---|---|---|
| 1 | Doctor profile settings | `settings.tsx` | `useSettings` **(REUSE Phase 1)** | `DoctorSettings` **(REUSE)** |
| 2 | Edit professional profile | SHEET/screen | `useUpdateProfile` **(REUSE Section B)** | profile types **(REUSE Section B)** |
| 3 | Edit consultation pricing | SHEET | `useUpdateSettings` / profile pricing **(REUSE)** | `DoctorSettings` **(REUSE)** |
| 4 | Edit availability | SHEET | `useUpdateAvailability` **(REUSE Phase 1)** | `AvailabilitySchedule` **(REUSE)** |
| 5 | Edit bank account | SHEET | `useUpdatePayoutBankAccount` **(REUSE Batch 6)** | `BankAccount` **(REUSE Section B)** |
| 6 | Notification settings | STATE of `settings.tsx` | `useNotificationPreferences`, `useUpdateNotificationPrefs` **(REUSE Batch 6)** | `NotificationPreference` **(REUSE Batch 6)** |
| 7 | Security settings | full screen | `useSecuritySettings` | `SecuritySettings` |
| 8 | Change password | SHEET | `useChangePassword` | `ChangePasswordInput` |
| 9 | Biometric settings | STATE of security | `useSetBiometric` | `SetBiometricInput` |
| 10 | Two-factor authentication | SHEET on security | `useSetTwoFactor` | `TwoFactorSetup`, `TwoFactorMethod` |
| 11 | Privacy settings | STATE / link to AB | `usePrivacySettings` **(REUSE AB)** | `DataPrivacySettings` **(REUSE AB)** |
| 12 | Language settings | SHEET | `useAppPreferences`, `useUpdateAppPreferences` | `AppPreferences`, `AppLanguage` |
| 13 | App theme settings | SHEET | `useUpdateAppPreferences` | `AppTheme` |
| 14 | Device management | full screen | `useDevices`, `useRevokeDevice` | `Device`/`DeviceSession` |
| 15 | Logout confirmation | SHEET | `useLogout` | `LogoutInput` |
| 16 | Delete account request | SHEET | `useRequestAccountDeletion` **(SHARED w/ AB)** | `RequestAccountDeletionInput` |

**AC consolidation:** profile/pricing/availability/bank/notification screens are
**REUSED** Phase 1 / Section B / Batch 6 mutations — no new write surface. Language
and theme share **one `AppPreferences`** + one `useUpdateAppPreferences`.
`Device` and `DeviceSession` are the same shape (alias).

---

## Section AD — Empty, Error & Edge-State (26)

Almost all of AD is **`StateView` variants on existing screens**, fed by the
**`EDGE_STATES` descriptor map** / pure **`getEdgeState(kind)`** helper. Only the
maintenance / forced-update banner and the account-status gate need a read
(`useAppStatus`, `useAccountStatus`). **No new screens are required for the empty
states** — each is a `StateView` variant on its owning list/detail screen.

| # | Edge state (`EdgeStateKind`) | Variant | Maps to |
|---|---|---|---|
| 1 | `no_appointments` | empty | StateView variant on `appointments` screen |
| 2 | `no_messages` | empty | StateView variant on `chat`/`messages` screen |
| 3 | `no_prescriptions` | empty | StateView variant on `prescriptions` screen |
| 4 | `no_lab_results` | empty | StateView variant on `lab-results` screen |
| 5 | `no_earnings` | empty | StateView variant on `earnings` screen |
| 6 | `no_reviews` | empty | StateView variant on `reviews` screen |
| 7 | `no_internet` | error | StateView variant on any data screen (global) |
| 8 | `server_error` | error | StateView variant on any data screen (global) |
| 9 | `session_expired` | error | StateView variant → CTA `login` (`/(auth)/login`) |
| 10 | `camera_permission_denied` | error | StateView variant on call/video screen |
| 11 | `microphone_permission_denied` | error | StateView variant on call screen |
| 12 | `file_upload_failed` | error | StateView variant on upload sheets (AA evidence, records) |
| 13 | `patient_unavailable` | empty | StateView variant on call/waiting-room screen |
| 14 | `patient_cancelled` | empty | StateView variant on call/appointment screen |
| 15 | `call_connection_failed` | error | StateView variant on call screen |
| 16 | `agora_unavailable` | error | StateView variant on call screen (provider switch) |
| 17 | `videosdk_fallback_failed` | error | StateView variant on call screen (both providers failed) |
| 18 | `prescription_blocked` | error | StateView variant on e-prescription screen |
| 19 | `drug_interaction_detected` | error | StateView variant on e-prescription screen |
| 20 | `lab_order_blocked` | error | StateView variant on lab-ordering screen |
| 21 | `hmo_verification_failed` | error | StateView variant on HMO claim screen |
| 22 | `account_verification_pending` | empty | StateView variant on `signup/pending.tsx` (gate) — `useAccountStatus` |
| 23 | `licence_expired` | error | StateView variant on compliance/dashboard gate — `useAccountStatus` |
| 24 | `access_denied` | error | StateView variant on any RBAC-gated screen |
| 25 | `maintenance_mode` | error | App-level banner/gate — `useAppStatus` (`mode='maintenance'`) |
| 26 | `app_update_required` | error | App-level gate — `useAppStatus` (`mode='app_update_required'`) |

**AD consolidation:** all 26 are **pure descriptors** (`EdgeStateDescriptor` with
title/message/icon/cta/tone) in **one `EDGE_STATES` map**; the helper
`getEdgeState(kind)` (api) and the thin `useEdgeState(kind)` wrapper resolve them
synchronously into `StateView`. Account-state reads reuse the Phase 1
`VerificationStatus` vocabulary, extended with `under_review` / `suspended` via
`AccountState`. **No new screen files; backend supplies data + descriptors only.**

---

## Reuse summary (what Batch 7 did NOT re-create)

| Reused from | Types | API fns | Hooks |
|---|---|---|---|
| **Phase 1** (`doctor.ts` / `doctor.api` / `useAccount`) | `SupportTicket`, `SupportTicketStatus`, `ChatMessage`, `ChatAuthor`, `DoctorSettings`, `VerificationStatus` | `getSupportTickets`, `createSupportTicket`, `getSettings`, `updateSettings` | `useSupportTickets`, `useCreateSupportTicket`, `useSettings`, `useUpdateSettings` |
| **Phase 2** (`doctor.phase2` / `useCompliance`) | `ComplianceDashboard`, `LicenceInfo`, `LicenceStatus`, `ConsentRecord`, `ComplianceAuditEntry`, `ComplianceAuditAction`, `ComplianceAlert`, `ComplianceAlertSeverity`, `PolicyAcknowledgement` | `getComplianceDashboard`, `acknowledgePolicy` | `useComplianceDashboard`, `useAcknowledgePolicy` |
| **Batch 6** (`doctor.batch6`) | `NotificationPreference`, `NotificationCategory` | `getNotificationPreferences`, `updateNotificationPrefs`, `updatePayoutBankAccount` | `useNotificationPreferences`, `useUpdateNotificationPrefs`, `useUpdatePayoutBankAccount` |
| **Section B** (`doctor.profile`) | `BankAccount` | profile mutations | `useUpdateProfile`, profile builder hooks |
| **Shared** | — | `formatKobo` | — |

## Frontend component-reuse notes
- Every AD edge state renders via the existing **`StateView`** (`variant='empty'`
  or `'error'`, with `icon`/`title`/`message` from the descriptor and an optional
  retry/login CTA). Do not author bespoke empty/error views.
- The AA support-chat thread reuses the existing chat bubble layout (Phase 1/2
  `ChatMessage` UI), extended for the `agent`/`system` author tones.
- The AC settings rows reuse the existing settings toggle/list-item components on
  `settings.tsx` — Batch 7 only supplies new data hooks.
