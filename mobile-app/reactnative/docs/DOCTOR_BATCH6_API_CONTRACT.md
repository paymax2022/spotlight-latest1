# Doctor API Contract — Batch 6 (sections W · X · Y · Z)

Reference for the Frontend role. ADDITIVE to the Phase 1 / Phase 2 / Section B /
Phase 3 / Batch 1–5 contracts. All data is **demo data** resolved with simulated
latency (`wait()`); Phase C swaps bodies for live endpoints + the
`Idempotency-Key` header (each mutation carries a `// TODO(Phase C)` for the live
wire-up). Money is always an integer in **kobo**. Path alias is `@/` → `src/`.
Use `import type` for type-only imports.

- Types:     `@/types/doctor.batch6`   (re-exports the primitives it reuses)
- API:       `@/api/doctor.batch6.api` (Frontend should NOT call these directly — use hooks; exception: `formatKobo`)
- Hooks:     `@/features/doctor/hooks` (same barrel as earlier phases)
- Constants: `@/features/doctor/constants` (same barrel; Batch 6 lists re-exported from `batch6`)

**Consolidation + reuse:** Batch 6 covers Medical Records, Notifications,
Earnings/Wallet/Payout and Ratings/Reputation, and is built largely on **reuse**.
The 18 record sub-screens collapse to a category index over the Phase 2
`PatientRecordHub`; the 17 notifications are **KINDS** of one `RichNotification`
composing the Phase 1 `DoctorNotification`; the earnings periods/sources and the
metric tiles are **states/data** over `EarningsBreakdown` / the Phase 2
`ReputationSummary`. Section B's `BankAccount` is reused, never redeclared. See the
Ownership Map for which spec entries are full screens vs states vs reuse-existing.

---

## 1. Exported types (`@/types/doctor.batch6`)

**Re-exported from Phase 1 (`@/types/doctor`):** `PatientSummary`,
`DoctorNotification`, `DoctorNotificationType`, `EarningsSummary`, `PayoutItem`.
**From Phase 2 (`@/types/doctor.phase2`):** `PatientRecordHub`, `RecordDocument`,
`RecordDocumentKind`, `RecordAccessEntry`, `RecordAccessAction`,
`RecordDiagnosisEntry`, `ReputationSummary`, `DoctorReview`, `RatingBreakdown`,
`ReputationMetrics`, `PayoutReport`, `PayoutPeriodBreakdown`.
**From Phase 3 (`@/types/doctor.phase3`):** `QualityAnalytics`.
**From Section B (`@/types/doctor.profile`):** `BankAccount` (reused — NOT redeclared).

### Section W — Medical Records
`RecordCategory`, `RecordCategoryCount`, `RecentPatientRecord`,
`DoctorRecordsDashboard`, `PatientRecordIndexEntry`, `PatientRecordIndex`,
`RecordRestrictionLevel`, `RecordRestriction`, `RestrictedRecordWarning`,
`RecordExportFormat`, `RecordDownloadDescriptor`, `RecordShareStatus`,
`RecordShare`.

### Section X — Notifications
`DoctorNotificationKind` (16-kind superset), `NotificationCategory`,
`NotificationSeverity`, `NotificationFilter`, `NotificationCta`,
`RichNotification` (extends `DoctorNotification`), `NotificationGroup`,
`NotificationPreference`.

### Section Y — Earnings, Wallet & Payout
`EarningsSource`, `EarningsPeriod`, `EarningsSourceAmount`,
`EarningsPeriodTotals`, `EarningsBreakdown`, `WalletLedgerEntry`,
`WalletBalance`, `PayoutDetailStatus`, `PayoutDetail`, `InvoiceLineItem`,
`InvoiceStatus`, `Invoice`, `CommissionTier`, `CommissionBreakdown`,
`TaxVatReport`, `SettlementDisputeStatus`, `SettlementDispute`.

### Section Z — Ratings, Reviews & Reputation
`ConsultFeedbackChannel`, `ConsultationFeedback`, `QualityScoreGrade`,
`QualityScoreFactor`, `QualityScore`, `RankingPeerStat`, `RankingInsight`,
`ImprovementPriority`, `ImprovementRecommendation`, `ReviewDisputeReason`,
`ReviewDisputeStatus`, `ReviewDispute`.

### Mutation input / result types
- **W:** `DownloadPatientRecordInput`/`Result`, `SharePatientRecordInput`/`Result`,
  `RequestRecordAccessInput`/`Result`.
- **X:** `MarkNotificationReadInput`/`Result`, `MarkAllNotificationsReadInput`/`Result`,
  `UpdateNotificationPrefsInput`/`Result`.
- **Y:** `WithdrawEarningsInput`/`Result`, `UpdatePayoutBankAccountInput`/`Result`,
  `RaiseSettlementDisputeInput`/`Result`.
- **Z:** `DisputeReviewInput`/`Result`, `RequestReviewRemovalInput`/`Result`.

> Every mutation input carries `idempotencyKey: string`. Callers pass
> `Omit<Input, 'idempotencyKey'>` to the hook, which generates the key.

---

## 2. API functions (`@/api/doctor.batch6.api`)

> Frontend uses the **hooks**, not these directly. `formatKobo` is re-exported here
> for convenience.

### Reads
```ts
// Section W
getRecordsDashboard(): Promise<DoctorRecordsDashboard>
getPatientRecordIndex(patientId: string): Promise<PatientRecordIndex>
getRecordRestrictions(patientId: string): Promise<RecordRestriction[]>
getRestrictedRecordWarnings(patientId: string): Promise<RestrictedRecordWarning[]>
getRecordShares(): Promise<RecordShare[]>

// Section X
getRichNotifications(): Promise<RichNotification[]>
getNotificationGroups(): Promise<NotificationGroup[]>
getNotificationPreferences(): Promise<NotificationPreference[]>

// Section Y
getEarningsBreakdown(): Promise<EarningsBreakdown>
getWalletBalance(): Promise<WalletBalance>
getPayoutDetails(): Promise<PayoutDetail[]>
getPayoutDetail(id: string): Promise<PayoutDetail | undefined>
getInvoices(): Promise<Invoice[]>
getCommissionBreakdown(rangeLabel?: string): Promise<CommissionBreakdown>
getTaxVatReport(rangeLabel?: string): Promise<TaxVatReport>
getSettlementDisputes(): Promise<SettlementDispute[]>

// Section Z
getConsultationFeedback(): Promise<ConsultationFeedback[]>
getQualityScore(): Promise<QualityScore>
getRankingInsight(): Promise<RankingInsight>
getImprovementRecommendations(): Promise<ImprovementRecommendation[]>
getReviewDisputes(): Promise<ReviewDispute[]>
```

### Mutations
```ts
// Section W
downloadPatientRecord(input: DownloadPatientRecordInput): Promise<DownloadPatientRecordResult>
sharePatientRecordWithSpecialist(input: SharePatientRecordInput): Promise<SharePatientRecordResult>
requestRecordAccess(input: RequestRecordAccessInput): Promise<RequestRecordAccessResult>

// Section X
markNotificationRead(input: MarkNotificationReadInput): Promise<MarkNotificationReadResult>
markAllNotificationsRead(input: MarkAllNotificationsReadInput): Promise<MarkAllNotificationsReadResult>
updateNotificationPrefs(input: UpdateNotificationPrefsInput): Promise<UpdateNotificationPrefsResult>

// Section Y
withdrawEarnings(input: WithdrawEarningsInput): Promise<WithdrawEarningsResult>
updatePayoutBankAccount(input: UpdatePayoutBankAccountInput): Promise<UpdatePayoutBankAccountResult>
raiseSettlementDispute(input: RaiseSettlementDisputeInput): Promise<RaiseSettlementDisputeResult>

// Section Z
disputeReview(input: DisputeReviewInput): Promise<DisputeReviewResult>
requestReviewRemoval(input: RequestReviewRemovalInput): Promise<RequestReviewRemovalResult>
```

### Demo exports (also used as `placeholderData`)
`DEMO_RECORDS_DASHBOARD`, `DEMO_PATIENT_RECORD_INDEX`, `DEMO_RECORD_RESTRICTIONS`,
`DEMO_RESTRICTED_WARNINGS`, `DEMO_RECORD_SHARES`, `DEMO_RICH_NOTIFICATIONS`,
`DEMO_NOTIFICATION_GROUPS`, `DEMO_NOTIFICATION_PREFERENCES`,
`DEMO_EARNINGS_BREAKDOWN`, `DEMO_WALLET_BALANCE`, `DEMO_PAYOUT_DETAILS`,
`DEMO_INVOICES`, `DEMO_COMMISSION_BREAKDOWN`, `DEMO_TAX_VAT_REPORT`,
`DEMO_SETTLEMENT_DISPUTES`, `DEMO_CONSULT_FEEDBACK`, `DEMO_QUALITY_SCORE`,
`DEMO_RANKING_INSIGHT`, `DEMO_IMPROVEMENT_RECOMMENDATIONS`,
`DEMO_REVIEW_DISPUTES`. Plus re-export: `formatKobo`.

---

## 3. Hooks (`@/features/doctor/hooks`)

Query keys are namespaced under `['doctor', …]`. Mutations auto-generate the
`idempotencyKey`; pass `Omit<Input, 'idempotencyKey'>`. Each read seeds
`placeholderData` so screens render instantly.

### Section W — `useMedicalRecords.ts`
```ts
useRecordsDashboard()                        // ['doctor','records','dashboard']
usePatientRecordIndex(patientId: string)     // ['doctor','records','index',patientId]
useRecordRestrictions(patientId: string)     // ['doctor','records','restrictions',patientId]
useRestrictedRecordWarnings(patientId)       // ['doctor','records','restricted-warnings',patientId]
useRecordShares()                            // ['doctor','records','shares']
useDownloadPatientRecord()                   // → DownloadPatientRecordResult
useSharePatientRecord()                      // invalidates shares + dashboard
useRequestRecordAccess()                     // invalidates restrictions[patientId]
```

### Section X — `useNotificationsCenter.ts`
```ts
useNotificationFeed()                        // ['doctor','notifications','rich']
useNotificationGroups()                      // ['doctor','notifications','groups']
useNotificationPreferences()                 // ['doctor','notifications','preferences']
useMarkNotificationRead()                    // invalidates ['doctor','notifications']
useMarkAllNotificationsRead()                // invalidates ['doctor','notifications']
useUpdateNotificationPrefs()                 // invalidates …'preferences'
```
> Names are deliberately distinct from the Phase 1 `useNotifications` (plain feed)
> to avoid a barrel collision; both coexist.

### Section Y — `useWallet.ts`
```ts
useEarningsBreakdown()                        // ['doctor','earnings','breakdown']
useWalletBalance()                            // ['doctor','wallet','balance']
usePayoutDetails()                            // ['doctor','wallet','payout-details']
usePayoutDetail(id: string)                   // ['doctor','wallet','payout-detail',id]
useInvoices()                                 // ['doctor','wallet','invoices']
useCommissionBreakdown(rangeLabel?: string)   // ['doctor','wallet','commission',rangeLabel]
useTaxVatReport(rangeLabel?: string)          // ['doctor','wallet','tax-vat',rangeLabel]
useSettlementDisputes()                       // ['doctor','wallet','disputes']
useWithdrawEarnings()                         // invalidates wallet + earnings
useUpdatePayoutBankAccount()                  // invalidates wallet
useRaiseSettlementDispute()                   // invalidates disputes + payout-details
```
> Names are distinct from the Phase 1 `useEarnings` / `useRequestPayout` and the
> Phase 2 `usePayoutReport`; reuse those for the headline summary + period report.

### Section Z — `useReputationCenter.ts`
```ts
useConsultationFeedback()                     // ['doctor','reputation','feedback']
useQualityScore()                             // ['doctor','reputation','quality-score']
useRankingInsight()                           // ['doctor','reputation','ranking']
useImprovementRecommendations()               // ['doctor','reputation','recommendations']
useReviewDisputes()                           // ['doctor','reputation','disputes']
useDisputeReview()                            // invalidates disputes + reputation
useRequestReviewRemoval()                     // invalidates reputation
```
> Names are distinct from the Phase 2 `useReputation` / `useReportReview` and the
> Phase 3 `useQualityAnalytics`; reuse those for the rating dashboard, the
> report-unfair-review flow and the trend tiles.

---

## 4. Constants (`@/features/doctor/constants`, from `batch6`)

- **W:** `RECORD_CATEGORY_LABELS`, `RECORD_CATEGORY_ICONS`,
  `RECORD_RESTRICTION_LEVEL_LABELS`, `RECORD_RESTRICTION_LEVEL_TONES`,
  `RECORD_EXPORT_FORMAT_OPTIONS`, `RECORD_SHARE_STATUS_LABELS`.
- **X:** `NOTIFICATION_CATEGORY_LABELS`, `NOTIFICATION_CATEGORY_ICONS`,
  `NOTIFICATION_KIND_CATEGORY`, `NOTIFICATION_KIND_LABELS`,
  `NOTIFICATION_SEVERITY_TONES`.
- **Y:** `EARNINGS_PERIOD_OPTIONS`, `EARNINGS_PERIOD_LABELS`,
  `EARNINGS_SOURCE_LABELS`, `EARNINGS_SOURCE_TONES`,
  `PAYOUT_DETAIL_STATUS_LABELS`, `PAYOUT_DETAIL_STATUS_TONES`,
  `INVOICE_STATUS_LABELS`, `SETTLEMENT_DISPUTE_STATUS_LABELS`.
- **Z:** `METRIC_LABELS`, `QUALITY_SCORE_GRADE_LABELS`,
  `QUALITY_SCORE_GRADE_TONES`, `REVIEW_DISPUTE_REASON_OPTIONS`,
  `REVIEW_DISPUTE_REASON_LABELS`, `REVIEW_DISPUTE_STATUS_LABELS`.

---

## 5. Loading / error / empty conventions

Same as earlier phases:
- **Loading:** every read seeds `placeholderData` from its `DEMO_*` export, so the
  screen renders immediately; use `isFetching` for a subtle refresh affordance.
- **Error:** `query.isError` / `query.error`; show a retry that calls
  `query.refetch()`. Mutations expose `mutateAsync` for try/catch and
  `isPending` / `isError` for inline feedback.
- **Empty:** treat an empty array (`[]`) or `undefined` single-item result as the
  empty state (e.g. no shares, no disputes, no recommendations) — distinct from
  loading because `placeholderData` is non-empty.
- **Money:** all amounts are integers in **kobo**; format with `formatKobo`
  (re-exported from `@/api/doctor.batch6.api` and the Phase 1 api).
- **Idempotency:** never construct `idempotencyKey` in the UI — the hook does it.
