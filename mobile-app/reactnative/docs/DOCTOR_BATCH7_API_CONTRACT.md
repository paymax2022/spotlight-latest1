# Doctor Batch 7 — API Contract

Batch 7 = spec **sections AA · AB · AC · AD** (Support & Dispute · Compliance,
Privacy & Audit · Settings · Empty/Error/Edge-State). **FINAL C–AD batch.**
Phase A: every read/mutation resolves **demo data** (`DEMO_*` exports double as
`placeholderData`). All money is integers in **kobo**. Every state-changing
mutation requires an `idempotencyKey`; hooks **auto-generate** it, so callers pass
`Omit<Input, 'idempotencyKey'>`.

Files:
- Types: `src/types/doctor.batch7.ts`
- API:   `src/api/doctor.batch7.api.ts` (incl. pure `getEdgeState`)
- Hooks: `useSupportCenter.ts` (AA), `useComplianceCenter.ts` (AB),
  `useSettingsCenter.ts` (AC), `useAppStatus.ts` (AD)
- Constants: `src/features/doctor/constants/batch7.ts`

---

## Exported types

### Section AA — Support & Dispute
- `FaqCategory` (union), `FaqItem`, `HelpArticle`
- `DisputeKind` (`consultation|payment|pharmacy|lab|hmo|prescription|call_failure|patient_complaint`)
- `DisputeStatus` (`open|under_review|awaiting_response|resolved|rejected`)
- `EvidenceKind`, `EvidenceAttachment`, `Dispute`
- `SupportMessageAuthor` (= `ChatAuthor | 'agent' | 'system'`), `SupportMessage`

### Section AB — Compliance, Privacy & Audit
- `VetLicenceInfo` (extends REUSED `LicenceInfo`)
- `DataSharingPreference`, `DataRequestStatus`, `DataPrivacySettings`
- `AuditScope` (`prescription|consultation|lab|hmo`), `AuditTrailEntry` (extends REUSED `ComplianceAuditEntry`), `AuditTrail`
- `TrainingStatus`, `TrainingModule`, `MandatoryTraining`
- `SafetyIssueSeverity`, `SafetyIssueCategory`, `SafetyIssueStatus`, `SafetyIssueReport`
- `AccountReviewReason`, `AccountReviewNotice`

### Section AC — Settings
- `TwoFactorMethod`, `SecuritySettings`, `TwoFactorSetup`
- `DevicePlatform`, `Device`, `DeviceSession` (alias of `Device`)
- `AppLanguage`, `AppTheme`, `AppPreferences`

### Section AD — Empty / Error / Edge-State
- `EdgeStateKind` (26-member union), `EdgeStateTone`, `EdgeStateVariant`
- `EdgeStateCta`, `EdgeStateDescriptor`
- `AppStatusMode`, `AppStatus`
- `AccountState` (= REUSED `VerificationStatus | 'under_review' | 'suspended'`), `AccountStatus`

### Mutation inputs / results
- AA: `CreateDisputeInput`/`Result`, `UploadDisputeEvidenceInput`/`Result`, `SendSupportMessageInput`/`Result`
- AB: `UpdatePrivacySettingsInput`/`Result`, `CompleteTrainingModuleInput`/`Result`, `ReportSafetyIssueInput`/`Result`, `RequestDataExportInput`/`Result`, `RequestAccountDeletionInput`/`Result`
- AC: `ChangePasswordInput`/`Result`, `SetBiometricInput`/`Result`, `SetTwoFactorInput`/`Result`, `RevokeDeviceInput`/`Result`, `UpdateAppPreferencesInput`/`Result`, `LogoutInput`/`Result`

### Re-exported (REUSE — not redeclared)
From `@/types/doctor`: `SupportTicket`, `SupportTicketStatus`, `ChatMessage`, `ChatAuthor`, `DoctorSettings`, `VerificationStatus`.
From `@/types/doctor.phase2`: `ComplianceDashboard`, `LicenceInfo`, `LicenceStatus`, `ConsentRecord`, `ComplianceAuditEntry`, `ComplianceAuditAction`, `ComplianceAlert`, `ComplianceAlertSeverity`, `PolicyAcknowledgement`.
From `@/types/doctor.batch6`: `NotificationPreference`, `NotificationCategory`.
From `@/types/doctor.profile`: `BankAccount`.

---

## API function signatures (`src/api/doctor.batch7.api.ts`)

### Re-exported reused fns
`formatKobo`, `getSupportTickets`, `createSupportTicket`, `getSettings`,
`updateSettings`, `DEMO_SUPPORT_TICKETS`, `DEMO_SETTINGS` (from `doctor.api`);
`getComplianceDashboard`, `acknowledgePolicy`, `DEMO_COMPLIANCE` (from `doctor.phase2.api`).

### Reads
```
// AA
getFaqs(): Promise<FaqItem[]>
getHelpArticles(): Promise<HelpArticle[]>
getDisputes(): Promise<Dispute[]>
getDispute(id: string): Promise<Dispute | undefined>
getSupportMessages(threadId: string): Promise<SupportMessage[]>
// AB
getVetLicence(): Promise<VetLicenceInfo>
getPrivacySettings(): Promise<DataPrivacySettings>
getAuditTrail(scope: AuditScope): Promise<AuditTrail>
getMandatoryTraining(): Promise<MandatoryTraining>
getSafetyIssues(): Promise<SafetyIssueReport[]>
getAccountReviewNotice(): Promise<AccountReviewNotice | null>
// AC
getSecuritySettings(): Promise<SecuritySettings>
getDevices(): Promise<Device[]>
getAppPreferences(): Promise<AppPreferences>
// AD
getAppStatus(): Promise<AppStatus>
getAccountStatus(): Promise<AccountStatus>
getEdgeState(kind: EdgeStateKind): EdgeStateDescriptor   // PURE helper (sync)
```

### Mutations (each takes the full `*Input` incl. `idempotencyKey`)
```
// AA
createDispute(input): Promise<CreateDisputeResult>
uploadDisputeEvidence(input): Promise<UploadDisputeEvidenceResult>
sendSupportMessage(input): Promise<SendSupportMessageResult>
// AB
updatePrivacySettings(input): Promise<UpdatePrivacySettingsResult>
completeTrainingModule(input): Promise<CompleteTrainingModuleResult>
reportSafetyIssue(input): Promise<ReportSafetyIssueResult>
requestDataExport(input): Promise<RequestDataExportResult>
requestAccountDeletion(input): Promise<RequestAccountDeletionResult>   // SHARED AB+AC
// AC
changePassword(input): Promise<ChangePasswordResult>
setBiometric(input): Promise<SetBiometricResult>
setTwoFactor(input): Promise<SetTwoFactorResult>
revokeDevice(input): Promise<RevokeDeviceResult>
updateAppPreferences(input): Promise<UpdateAppPreferencesResult>
logout(input): Promise<LogoutResult>
```

### Demo exports (placeholderData)
`DEMO_FAQS`, `DEMO_HELP_ARTICLES`, `DEMO_DISPUTES`, `DEMO_SUPPORT_MESSAGES`,
`DEMO_VET_LICENCE`, `DEMO_PRIVACY_SETTINGS`, `DEMO_AUDIT_TRAILS` (Record<AuditScope, AuditTrail>),
`DEMO_MANDATORY_TRAINING`, `DEMO_SAFETY_ISSUES`, `DEMO_ACCOUNT_REVIEW_NOTICE`,
`DEMO_SECURITY_SETTINGS`, `DEMO_DEVICES`, `DEMO_APP_PREFERENCES`, `EDGE_STATES`,
`DEMO_APP_STATUS`, `DEMO_ACCOUNT_STATUS`.

---

## Hooks

### `useSupportCenter.ts` (AA)
Reads: `useFaqs()`, `useHelpArticles()`, `useDisputes()`, `useDispute(disputeId)`,
`useSupportMessages(threadId)`.
Mutations: `useCreateDispute()`, `useUploadDisputeEvidence()`, `useSendSupportMessage()`.
> Ticket list/create REUSE Phase 1 `useSupportTickets` / `useCreateSupportTicket`.

### `useComplianceCenter.ts` (AB)
Reads: `useVetLicence()`, `usePrivacySettings()`, `useAuditTrail(scope)`,
`useMandatoryTraining()`, `useSafetyIssues()`, `useAccountReviewNotice()`.
Mutations: `useUpdatePrivacySettings()`, `useCompleteTrainingModule()`,
`useReportSafetyIssue()`, `useRequestDataExport()`, **`useRequestAccountDeletion()`**.
> Dashboard/licence/consent/audit-log/alerts/policy REUSE Phase 2
> `useComplianceDashboard` / `useAcknowledgePolicy`.

### `useSettingsCenter.ts` (AC)
Reads: `useSecuritySettings()`, `useDevices()`, `useAppPreferences()`.
Mutations: `useChangePassword()`, `useSetBiometric()`, `useSetTwoFactor()`,
`useRevokeDevice()`, `useUpdateAppPreferences()`, `useLogout()`.
> Profile/pricing/availability/bank/notification REUSE Phase 1 / Section B /
> Batch 6 hooks. **Account deletion is NOT redeclared here** — the AC
> delete-account screen imports `useRequestAccountDeletion` from
> `useComplianceCenter` (single source of truth).

### `useAppStatus.ts` (AD)
Reads: `useAppStatus()` (polls every 5 min for maintenance/forced-update),
`useAccountStatus()`.
Helper: `useEdgeState(kind)` — thin sync wrapper over the pure `getEdgeState`.

All hooks are exported via `src/features/doctor/hooks/index.ts` (additive lines).
Hook names are distinct from `useSupportTickets` / `useSettings` /
`useComplianceDashboard` to avoid barrel collisions.

---

## Constants (`constants/batch7.ts`, re-exported from the barrel)
`FAQ_CATEGORY_LABELS`, `FAQ_CATEGORIES`, `DISPUTE_KIND_LABELS`, `DISPUTE_KIND_ICONS`,
`DISPUTE_STATUS_LABELS`, `DISPUTE_STATUS_TONES`, `EVIDENCE_KIND_LABELS`,
`AUDIT_SCOPE_LABELS`, `AUDIT_SCOPE_ICONS`, `TRAINING_STATUS_LABELS`,
`TRAINING_STATUS_TONES`, `SAFETY_ISSUE_CATEGORY_OPTIONS`,
`SAFETY_ISSUE_SEVERITY_OPTIONS`, `SAFETY_ISSUE_SEVERITY_TONES`,
`ACCOUNT_REVIEW_REASON_LABELS`, `TWO_FACTOR_METHODS`, `TWO_FACTOR_METHOD_LABELS`,
`DEVICE_PLATFORM_ICONS`, **`APP_LANGUAGE_OPTIONS`** (renamed — see note),
`THEME_OPTIONS`, `EDGE_STATE_TONES`, `EDGE_STATE_LABELS`, `APP_STATUS_MODE_LABELS`,
`ACCOUNT_STATE_LABELS`, `ACCOUNT_STATE_TONES`.

> **Naming note:** the app-UI language selector is exported as
> `APP_LANGUAGE_OPTIONS` (typed `{value: AppLanguage; label}[]`) — **not**
> `LANGUAGE_OPTIONS` — because Section B profile constants already export
> `LANGUAGE_OPTIONS: string[]` ("languages spoken"). Avoiding the collision keeps
> the constants barrel re-export clean.

---

## Loading / error / empty conventions
- **Loading:** queries expose `isLoading`/`isPending`; screens render
  `StateView variant="loading"`. All reads ship `placeholderData` so first paint
  shows demo content immediately.
- **Error:** queries expose `isError`/`refetch`; screens render
  `StateView variant="error"` with `onRetry={refetch}`. Connectivity/server
  failures map to the AD `no_internet` / `server_error` descriptors.
- **Empty:** screens render `StateView variant="empty"` using the matching AD
  descriptor (`EDGE_STATES[kind]` / `getEdgeState(kind)`) for icon/title/message.
- **Edge / gate states:** `useAppStatus` drives maintenance & forced-update gates;
  `useAccountStatus` drives pending/rejected/suspended/under-review gates. Both are
  pure descriptors fed into `StateView`.
- **Mutations:** expose `mutate`/`mutateAsync`, `isPending`, `isError`; callers pass
  inputs **without** `idempotencyKey` (auto-generated). On success the relevant
  query keys are invalidated.

## Verification
Scoped `tsc --noEmit` over the Batch 7 file closure (temp tsconfig under `/tmp`,
`skipLibCheck`): **0 errors**, exit 0. The pre-existing unrelated `src/features/fx/**`
error is out of scope and untouched.
