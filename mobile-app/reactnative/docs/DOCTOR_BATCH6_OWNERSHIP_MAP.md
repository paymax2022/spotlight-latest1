# Doctor Batch 6 — File Ownership Map

Batch 6 = spec **sections W · X · Y · Z** (Medical Records · Notifications ·
Earnings/Wallet/Payout · Ratings/Reviews/Reputation). This is **additive** to
Phase 1, Phase 2, Section B, Phase 3 and Batch 1–5: nothing in earlier contracts
is edited (only the hooks/constants barrels gain new export lines). Money is
always integers in **kobo**.

**Consolidation + reuse principle:** granular variants (notification kinds,
earnings periods, metric tiles, statuses) are modelled as **states/data** on top
of a small set of entities, not as separate entities. Batch 6 leans **heavily on
the Phase 2 record-hub / reputation / payout-report work** and the **Phase 1
notification / earnings** shapes, plus the **Phase 3 quality analytics** and the
**Section B `BankAccount`** (reused, never redeclared). The tables below mark each
spec entry as a **full screen**, a **STATE of** an existing/sibling screen, a
**SHEET on** a screen, or a **REUSES existing** route/hook.

## Ownership boundaries (do not cross)

### BACKEND (data/type contract) — owns
- `src/types/doctor.batch6.ts`                          *(new)*
- `src/api/doctor.batch6.api.ts`                         *(new)*
- `src/features/doctor/hooks/useMedicalRecords.ts`       *(new — Section W)*
- `src/features/doctor/hooks/useNotificationsCenter.ts`  *(new — Section X)*
- `src/features/doctor/hooks/useWallet.ts`               *(new — Section Y)*
- `src/features/doctor/hooks/useReputationCenter.ts`     *(new — Section Z)*
- `src/features/doctor/constants/batch6.ts`              *(new)*
- `src/features/doctor/hooks/index.ts`                   *(edited — additive export lines only)*
- `src/features/doctor/constants/index.ts`             *(edited — additive export line only)*

> Backend continues to own the Phase 1 / 2 / Section B / Phase 3 / Batch 1–5
> files unchanged.

### FRONTEND (screens/UI) — owns
- `app/(doctor)/**` (all route files), in particular the screens Batch 6 extends:
  - `app/(doctor)/(tabs)/records.tsx`        (W — records dashboard)
  - `app/(doctor)/records/[patientId].tsx`   (W — per-patient record index)
  - `app/(doctor)/(tabs)/notifications.tsx`  (X — notifications centre)
  - `app/(doctor)/(tabs)/earnings.tsx`       (Y — earnings dashboard / wallet)
  - `app/(doctor)/earnings/report.tsx`       (Y — payout / commission / tax report)
  - `app/(doctor)/reviews/index.tsx`         (Z — rating dashboard / reviews)
- `src/features/doctor/components/**`

### QA — owns
- `docs/QA_DOCTOR_BATCH6_REPORT.md`

> Frontend consumes Backend's hooks/types only — never imports from
> `doctor.batch6.api.ts` directly (use the hooks; `formatKobo` re-exported via the
> api/hook is the exception). All money is kobo; format with `formatKobo`.

---

## Section W — Medical Records (18)

| # | Spec entry | Ownership | Hook(s) | Type(s) |
|---|---|---|---|---|
| 1 | Doctor records dashboard | full screen `(tabs)/records.tsx` | `useRecordsDashboard` | `DoctorRecordsDashboard`, `RecordCategoryCount`, `RecentPatientRecord` |
| 2 | Patient consultation history | STATE of `records/[patientId].tsx` (category `consultations`) | `usePatientRecordIndex` + REUSE `usePatientRecordHub` (Phase 2) | `PatientRecordIndex`, REUSE `SoapNote` |
| 3 | Patient prescription history | STATE of `records/[patientId].tsx` (`prescriptions`) | REUSE `usePatientRecordHub` | REUSE `DoctorPrescription` |
| 4 | Patient lab result history | STATE of `records/[patientId].tsx` (`lab_results`) | REUSE `usePatientRecordHub` | REUSE `LabResult` |
| 5 | Patient document history | STATE of `records/[patientId].tsx` (`documents`) | REUSE `usePatientRecordHub` | REUSE `RecordDocument` |
| 6 | Patient imaging history | STATE of `records/[patientId].tsx` (`imaging`) | REUSE `usePatientRecordHub` | REUSE `RecordDocument` (kind `imaging`) |
| 7 | Patient allergy records | STATE of `records/[patientId].tsx` (`allergies`) | `usePatientRecordIndex` | REUSE `PatientMedicalProfile.allergies` |
| 8 | Patient medication history | STATE of `records/[patientId].tsx` (`medications`) | `usePatientRecordIndex` | REUSE `PatientMedicalProfile.currentMedications` |
| 9 | Patient diagnosis history | STATE of `records/[patientId].tsx` (`diagnoses`) | REUSE `usePatientRecordHub` | REUSE `RecordDiagnosisEntry` |
| 10 | Patient care plan history | STATE of `records/[patientId].tsx` (`care_plans`) | REUSE `useFollowUps` (Phase 2) | REUSE `FollowUpPlan` |
| 11 | Patient referral history | STATE of `records/[patientId].tsx` (`referrals`) | REUSE `usePatientRecordHub` | REUSE `SpecialistReferral` |
| 12 | Patient HMO records | STATE of `records/[patientId].tsx` (`hmo`) + restriction warning | REUSE `useHmoClaims` (Batch 4) | REUSE `HmoClaim`; `RecordRestriction` |
| 13 | Dependent patient records | STATE of `records/[patientId].tsx` (`dependents`) | `usePatientRecordIndex` | REUSE Batch 4/5 dependent records |
| 14 | Pet health records | REUSES `vet/pet/[id]/index.tsx` + `usePetHealthRecord` (Batch 5) | `usePetHealthRecord` (Batch 5) | REUSE `PetHealthRecord` (Batch 5) |
| 15 | Download patient record | SHEET on `records/[patientId].tsx` | `useDownloadPatientRecord` | `RecordDownloadDescriptor`, `RecordExportFormat`, `DownloadPatientRecordInput` |
| 16 | Share record with specialist | SHEET on `records/[patientId].tsx` | `useSharePatientRecord`, `useRecordShares` | `RecordShare`, `RecordShareStatus`, `SharePatientRecordInput` |
| 17 | Medical record access log | STATE of `records/[patientId].tsx` (access tab) | REUSE `usePatientRecordHub` | REUSE `RecordAccessEntry`, `RecordAccessAction` |
| 18 | Restricted record warning | SHEET/banner on `records/[patientId].tsx` | `useRecordRestrictions`, `useRestrictedRecordWarnings`, `useRequestRecordAccess` | `RecordRestriction`, `RestrictedRecordWarning`, `RecordRestrictionLevel` |

---

## Section X — Notifications (17)

> All 17 are **KINDS of one notification**, surfaced on the single notifications
> centre. They reuse Phase 1 `DoctorNotification`/`useNotifications`; Batch 6 adds
> the rich superset + grouping + preferences.

| # | Spec entry (notification) | Ownership | Hook(s) | Type / kind |
|---|---|---|---|---|
| 1 | Notifications centre | full screen `(tabs)/notifications.tsx` | `useNotificationFeed`, `useNotificationGroups` | `RichNotification`, `NotificationGroup`, `NotificationFilter` |
| 2 | New-appointment | STATE (kind) of centre | `useNotificationFeed` | kind `new_appointment` |
| 3 | Appointment-cancelled | STATE (kind) | `useNotificationFeed` | kind `appointment_cancelled` |
| 4 | Patient-waiting | STATE (kind) | `useNotificationFeed` | kind `patient_waiting` |
| 5 | New-chat-message | STATE (kind) | `useNotificationFeed` | kind `new_chat_message` |
| 6 | Prescription-refill-request | STATE (kind) | `useNotificationFeed` | kind `prescription_refill_request` |
| 7 | Lab-result-ready | STATE (kind) | `useNotificationFeed` | kind `lab_result_ready` |
| 8 | Critical-lab-result | STATE (kind, severity `critical`) | `useNotificationFeed` | kind `critical_lab_result` |
| 9 | Pharmacy-substitution-request | STATE (kind) | `useNotificationFeed` | kind `pharmacy_substitution_request` |
| 10 | Drug-delivery-update | STATE (kind) | `useNotificationFeed` | kind `drug_delivery_update` |
| 11 | HMO-approval | STATE (kind) | `useNotificationFeed` | kind `hmo_approval` |
| 12 | HMO-rejection | STATE (kind) | `useNotificationFeed` | kind `hmo_rejection` |
| 13 | Payout | STATE (kind) | `useNotificationFeed` | kind `payout` |
| 14 | Compliance | STATE (kind) | `useNotificationFeed` | kind `compliance` |
| 15 | Licence-renewal | STATE (kind) | `useNotificationFeed` | kind `licence_renewal` |
| 16 | Rating/review | STATE (kind) | `useNotificationFeed` | kind `rating_review` |
| 17 | Support-response | STATE (kind) | `useNotificationFeed` | kind `support_response` |
| — | Mark read / mark all / prefs | SHEET on centre | `useMarkNotificationRead`, `useMarkAllNotificationsRead`, `useNotificationPreferences`, `useUpdateNotificationPrefs` | `NotificationPreference`, `MarkNotificationReadInput`, `MarkAllNotificationsReadInput`, `UpdateNotificationPrefsInput` |

---

## Section Y — Earnings, Wallet & Payout (19)

| # | Spec entry | Ownership | Hook(s) | Type(s) |
|---|---|---|---|---|
| 1 | Earnings dashboard | full screen `(tabs)/earnings.tsx` | `useEarningsBreakdown` + REUSE `useEarnings` (Phase 1) | `EarningsBreakdown`, REUSE `EarningsSummary` |
| 2 | Today earnings | STATE of dashboard (period `today`) | `useEarningsBreakdown` | `EarningsPeriodTotals` |
| 3 | Weekly earnings | STATE (period `week`) | `useEarningsBreakdown` | `EarningsPeriodTotals` |
| 4 | Monthly earnings | STATE (period `month`) | `useEarningsBreakdown` | `EarningsPeriodTotals` |
| 5 | Consultation earnings | STATE (source `consult`) | `useEarningsBreakdown` | `EarningsSourceAmount` |
| 6 | HMO earnings | STATE (source `hmo`) | `useEarningsBreakdown` | `EarningsSourceAmount` |
| 7 | Vet consultation earnings | STATE (source `vet`) | `useEarningsBreakdown` | `EarningsSourceAmount` |
| 8 | Bonus/incentive earnings | STATE (source `bonus`) | `useEarningsBreakdown` | `EarningsSourceAmount` |
| 9 | Pending payout | STATE of wallet | `useWalletBalance` | `WalletBalance.pendingKobo` |
| 10 | Available balance | STATE of wallet | `useWalletBalance` | `WalletBalance.availableKobo` |
| 11 | Withdraw earnings | SHEET on `(tabs)/earnings.tsx` | `useWithdrawEarnings` | `WithdrawEarningsInput`, `PayoutDetailStatus` |
| 12 | Bank account screen | SHEET on earnings/report | `useUpdatePayoutBankAccount` | REUSE Section B `BankAccount`; `UpdatePayoutBankAccountInput` |
| 13 | Payout history | STATE of `earnings/report.tsx` | `usePayoutDetails` + REUSE `usePayoutReport` (Phase 2) | `PayoutDetail`, REUSE `PayoutItem`/`PayoutReport` |
| 14 | Payout detail | full screen `earnings/payout/[id].tsx` | `usePayoutDetail` | `PayoutDetail` |
| 15 | Failed payout | STATE of payout detail (`status: failed`) | `usePayoutDetail` | `PayoutDetail.failureReason` |
| 16 | Tax/VAT report | STATE of `earnings/report.tsx` | `useTaxVatReport` | `TaxVatReport` |
| 17 | Commission breakdown | STATE of `earnings/report.tsx` | `useCommissionBreakdown` | `CommissionBreakdown`, `CommissionTier` |
| 18 | Invoice history | STATE of `earnings/report.tsx` | `useInvoices` | `Invoice`, `InvoiceLineItem`, `InvoiceStatus` |
| 19 | Settlement dispute | SHEET on payout detail | `useSettlementDisputes`, `useRaiseSettlementDispute` | `SettlementDispute`, `RaiseSettlementDisputeInput` |

---

## Section Z — Ratings, Reviews & Reputation (12)

| # | Spec entry | Ownership | Hook(s) | Type(s) |
|---|---|---|---|---|
| 1 | Rating dashboard | full screen `reviews/index.tsx` | REUSE `useReputation` (Phase 2) + `useQualityScore` | REUSE `ReputationSummary`; `QualityScore` |
| 2 | Patient reviews | STATE of dashboard | REUSE `useReputation` | REUSE `DoctorReview` |
| 3 | Vet client reviews | STATE of dashboard (channel `vet`) | `useConsultationFeedback` | `ConsultationFeedback` (channel `vet`) |
| 4 | Consultation feedback | STATE of dashboard | `useConsultationFeedback` | `ConsultationFeedback` |
| 5 | Response-time metric | metric tile (STATE) | REUSE `useReputation` / `useQualityScore` | REUSE `ReputationMetrics.avgResponseMins`; `QualityScoreFactor` |
| 6 | Completion-rate metric | metric tile (STATE) | REUSE `useReputation` / `useQualityScore` | REUSE `ReputationMetrics.completionRate` |
| 7 | Patient-satisfaction metric | metric tile (STATE) | REUSE `useReputation` / `useQualityScore` | REUSE `ReputationMetrics.satisfactionScore` |
| 8 | Report unfair review | SHEET on review row | REUSE `useReportReview` (Phase 2) | REUSE `ReportReviewInput` |
| 9 | Review dispute | SHEET on review row | `useDisputeReview`, `useReviewDisputes` | `ReviewDispute`, `DisputeReviewInput` |
| 10 | Quality score | STATE of dashboard | `useQualityScore` | `QualityScore`, `QualityScoreFactor`, `QualityScoreGrade` |
| 11 | Profile ranking insight | STATE of dashboard | `useRankingInsight` + REUSE `useQualityAnalytics` (Phase 3) | `RankingInsight`, `RankingPeerStat` |
| 12 | Improvement recommendation | STATE of dashboard | `useImprovementRecommendations` | `ImprovementRecommendation` |
| — | Request review removal | SHEET on review row | `useRequestReviewRemoval` | `RequestReviewRemovalInput` |

---

## Frontend notes — component reuse

- **Records dashboard / index** reuse the existing patient-list and category-tile
  components from `records.tsx` / `records/[patientId].tsx`. `RecordCategory` +
  `RECORD_CATEGORY_LABELS` / `RECORD_CATEGORY_ICONS` drive the category grid; the
  per-category detail screens are STATES filtered from the Phase 2
  `PatientRecordHub` (no new screens for entries 2–11/17).
- **Restricted-record warning** renders as a banner/sheet using
  `RECORD_RESTRICTION_LEVEL_TONES`; gate the category detail behind
  `RecordRestriction.level` and offer `useRequestRecordAccess` when
  `canRequestAccess`.
- **Notifications centre** is one list. Render `RichNotification.kind` via
  `NOTIFICATION_KIND_LABELS` + the category icon (`NOTIFICATION_CATEGORY_ICONS`)
  and the severity tone (`NOTIFICATION_SEVERITY_TONES`). Filter chips use
  `NotificationFilter` (`all` / `unread` / category). Grouped view consumes
  `useNotificationGroups`. `cta.route` is an expo-router path for the row tap.
- **Earnings dashboard** reuses the existing summary cards from `earnings.tsx`;
  the period switcher uses `EARNINGS_PERIOD_OPTIONS`, source rows use
  `EARNINGS_SOURCE_LABELS` / `EARNINGS_SOURCE_TONES`. The wallet ledger reuses a
  transaction-row component. **All amounts are kobo — format with `formatKobo`.**
- **Bank account** reuses the Section B `BankAccount` shape and its
  name-enquiry/verified affordances; `useUpdatePayoutBankAccount` returns the
  resolved account.
- **Rating dashboard** reuses the Phase 2 reviews list + rating-breakdown bars and
  the Phase 3 trend charts; metric tiles use `METRIC_LABELS`. Quality score uses
  `QUALITY_SCORE_GRADE_TONES`; ranking insight reuses the peer-compare bar.

## Reaffirmation of ownership

Backend (this role) owns only the new type/api/hook/constant files plus the two
additive barrel edits listed above. **No screen/UI files were created or
modified.** All earlier-phase contract files remain untouched; every reused
shape is imported (and re-exported) from its original module, never duplicated.
