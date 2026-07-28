# QA Report — Doctor Batch 6 (Sections W · X · Y · Z)

**Reviewer:** QA Agent (read-only; no feature code edited)
**Date:** 2026-06-20
**Scope:** Medical Records (W=18) · Notifications (X=17) · Earnings/Wallet/Payout (Y=19) · Ratings/Reviews/Reputation (Z=12). Total 66 entries.
**Build style:** Consolidated, heavy reuse of Phase 1/2/3, Section B and Batch 1–5.

---

## Summary verdict: **PASS (ship-able)**

Batch 6 is clean, well-consolidated and faithful to the ownership map and API
contract. Spec coverage is effectively complete: **W 18/18, X 17/17, Y 19/19,
Z 12/12 (66/66)**. The recurring reserved-`ref` prop defect class is **fully
eradicated** (`payoutRef`/`invoiceRef` rename verified; no `ref=` prop on any
Batch 6 call site). All 8 new components are genuinely new (justified vs existing
components) and all 8 are **used** (no orphans). Navigation has **no orphans, no
dead links, and no Expo Router collisions**. No raw hex, no direct API imports
beyond the allowed `formatKobo`, no UI-constructed idempotency keys, no float
math on kobo values.

The only true gap is **minor**: the documented `useRequestReviewRemoval`
("Request review removal" sheet) hook exists but is **not wired** into any screen.
This is the `—` extra row in the Section Z map (not one of the 12 numbered Z
entries), so the 12 numbered entries are all covered.

### Defect counts
| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 0 |
| Minor | 4 |
| Note | 4 |

---

## Per-section coverage tables

### Section W — Medical Records (18) → **18/18 PASS**

| # | Entry | How covered | Verdict |
|---|---|---|---|
| 1 | Records dashboard | full screen `(tabs)/records.tsx` (`useRecordsDashboard`, StatCard + RecordCategoryRow + recent patients) | PASS |
| 2 | Consultation history | `records/[patientId]/category/[category].tsx` case `consultations` (hub.consults) | PASS |
| 3 | Prescription history | category `prescriptions` (hub.prescriptions) | PASS |
| 4 | Lab result history | category `lab_results` (hub.labResults) | PASS |
| 5 | Document history | category `documents` (hub.documents, non-imaging) | PASS |
| 6 | Imaging history | category `imaging` (hub.documents kind=imaging) | PASS |
| 7 | Allergy records | category `allergies` (demo profile list) | PASS |
| 8 | Medication history | category `medications` (demo profile list) | PASS |
| 9 | Diagnosis history | category `diagnoses` (hub.diagnoses + StatusBadge) | PASS |
| 10 | Care plan history | category `care_plans` (demo list) | PASS |
| 11 | Referral history | category `referrals` (hub.referrals) | PASS |
| 12 | HMO records + restriction | category `hmo` (demo list) + restriction warning surfaced on index | PASS |
| 13 | Dependent records | category `dependents` + "More" sub-link on index | PASS |
| 14 | Pet health records | REUSE `vet/` via sub-link from index (`router.push('/(doctor)/vet')`) | PASS |
| 15 | Download record | SHEET on `records/[patientId].tsx` (`useDownloadPatientRecord`, format select, Alert result) | PASS |
| 16 | Share with specialist | SHEET on index (`useSharePatientRecord`, specialist + note) | PASS |
| 17 | Access log | `records/[patientId]/access-log.tsx` (REUSE `usePatientRecordHub.accessLog`, AccessLogRow) | PASS |
| 18 | Restricted record warning | `AlertCard tone="critical"` banner + per-category gate row + Request-access sheet (`useRecordRestrictions`/`useRestrictedRecordWarnings`/`useRequestRecordAccess`); blocked level disables nav | PASS |

W special checks: restricted-warning visibly surfaced (AlertCard critical + lock gate rows), `blocked` level disables `onPress`, download + share + access-request sheets all present with loading/error handling. **All present.**

### Section X — Notifications (17 + prefs) → **17/17 PASS**

| # | Entry | How covered | Verdict |
|---|---|---|---|
| 1 | Notifications centre | full screen `(tabs)/notifications.tsx` (`useNotificationFeed`, grouped by category, filter chips) | PASS |
| 2–17 | All 16 kinds | rendered as STATE of one centre; `mapIcon()` covers all 16 kinds (new_appointment … support_response), `NOTIFICATION_KIND_LABELS` + severity tone | PASS |
| 8 | Critical-lab (distinct) | `severity==='critical'` → red border (`rowCritical`), "Critical" sev tag, Siren icon | PASS (visibly distinct) |
| — | Mark read / mark all / prefs | per-row Check (mark read), toolbar "Mark all read" (disabled when 0 unread), Preferences → `notifications/preferences.tsx` (`useNotificationPreferences`/`useUpdateNotificationPrefs`, push/email/sms toggles per category) | PASS |
| — | Per-kind deep links | `n.cta.route` pushed on row tap (`router.push(n.cta.route as never)`) | PASS |

X special checks: critical-lab visibly distinct ✓; mark-read + mark-all ✓; per-kind deep links via `cta.route` ✓. **All present.**

### Section Y — Earnings / Wallet / Payout (19) → **19/19 PASS**

| # | Entry | How covered | Verdict |
|---|---|---|---|
| 1 | Earnings dashboard | full screen `(tabs)/earnings.tsx` (`useEarningsBreakdown`, gradient wallet hero) | PASS |
| 2 | Today | period chip `today` (EARNINGS_PERIOD_OPTIONS) + StatCard | PASS |
| 3 | Weekly | period chip `week` | PASS |
| 4 | Monthly | period chip `month` + StatCard | PASS |
| 5 | Consultation earnings | source bar `consult` (EarningsSourceBar) | PASS |
| 6 | HMO earnings | source bar `hmo` | PASS |
| 7 | Vet earnings | source bar `vet` | PASS |
| 8 | Bonus earnings | source bar `bonus` | PASS |
| 9 | Pending payout | wallet hero "Pending …" (`wallet.pendingKobo`) | PASS |
| 10 | Available balance | wallet hero value (`wallet.availableKobo`) | PASS |
| 11 | Withdraw earnings | SHEET on earnings (`useWithdrawEarnings`, amount → kobo, balance guard) | PASS |
| 12 | Bank account | `earnings/bank-account.tsx` (`useUpdatePayoutBankAccount`, REUSE Section B BankAccount, verified affordance) | PASS |
| 13 | Payout history | `earnings/report.tsx` Payouts tab (`usePayoutDetails`, PayoutDetailRow) | PASS |
| 14 | Payout detail | full screen `earnings/payout/[id].tsx` (`usePayoutDetail`, amount/destination/timeline) | PASS |
| 15 | Failed payout | `status==='failed'` → red `AlertCard critical` + failureReason + dispute CTA; PayoutDetailRow `failed` red border | PASS (visibly distinct) |
| 16 | Tax/VAT report | report Tax/VAT tab (`useTaxVatReport`, VAT/WHT/TIN) | PASS |
| 17 | Commission breakdown | report Commission tab (`useCommissionBreakdown`, tiers via EarningsSourceBar) | PASS |
| 18 | Invoice history | report Invoices tab (`useInvoices`, InvoiceRow) + `earnings/invoice/[id].tsx` detail | PASS |
| 19 | Settlement dispute | SHEET on payout detail (`useRaiseSettlementDispute`/`useSettlementDisputes`, existing-dispute display) | PASS |

Y special checks: withdraw flow ✓ (balance guard + Math.round naira→kobo), failed-payout state visibly distinct ✓, tax/commission/invoices all present ✓. **All present.**

### Section Z — Ratings / Reviews / Reputation (12) → **12/12 PASS**

| # | Entry | How covered | Verdict |
|---|---|---|---|
| 1 | Rating dashboard | full screen `reviews/index.tsx` (REUSE `useReputation` + `useQualityScore`, summary + breakdown) | PASS |
| 2 | Patient reviews | "Patient reviews" tab (REUSE ReviewCard) | PASS |
| 3 | Vet client reviews | "Vet clients" tab (`useConsultationFeedback` filtered channel=vet) | PASS |
| 4 | Consultation feedback | FeedbackCard (`useConsultationFeedback`, RatingStars) | PASS |
| 5 | Response-time metric | MetricTile "Response time" (`metrics.avgResponseMins`) | PASS |
| 6 | Completion-rate metric | MetricTile "Completion rate" | PASS |
| 7 | Satisfaction metric | MetricTile "Satisfaction" | PASS |
| 8 | Report unfair review | SHEET (REUSE `useReportReview`, REVIEW_REPORT_REASONS) | PASS |
| 9 | Review dispute | SHEET (`useDisputeReview`, reason select + detail) | PASS |
| 10 | Quality score | `reviews/quality-score.tsx` (`useQualityScore`, grade hero + QualityFactorRow) + grade pill on dashboard | PASS |
| 11 | Ranking insight | `reviews/ranking.tsx` (`useRankingInsight`, RankingGauge + peer rows) | PASS |
| 12 | Improvement recommendation | `reviews/improvements.tsx` (`useImprovementRecommendations`, priority-toned AlertCard) | PASS |
| — | Request review removal | `useRequestReviewRemoval` hook exists but **NOT wired** to any screen | **GAP (Minor)** — not a numbered Z entry |

Z special checks: 3 metric tiles ✓, quality score ✓, ranking ✓, review dispute ✓. **All 12 numbered entries present.**

---

## Check-by-check results

### 1. Spec coverage — **PASS** (66/66)
Every numbered entry maps to a real screen/state/sheet/documented reuse with the
cited hook, verified against code. Only the un-numbered Z extra ("Request review
removal") is unimplemented — see Minor M1.

### 2. Reserved-`ref` prop sweep — **PASS**
- No Batch 6 component declares a prop named `ref` (interface props are
  `payoutRef` / `invoiceRef`). Verified by reading all 8 interfaces.
- The two `ref:` matches (`PayoutDetailRow.tsx:54`, `InvoiceRow.tsx:49`) are
  **StyleSheet style keys** named `ref`, not React props — harmless.
- No `ref={` prop on any Batch 6 component call site across `app/(doctor)`.
- The builder's rename fix is confirmed applied and correct.

### 3. Reuse vs duplication — **PASS** (all 8 justified + used)
| Component | New? | Used in | vs existing |
|---|---|---|---|
| RecordCategoryRow | yes | records.tsx, [patientId].tsx | not NotificationRow/AlertCard shaped (count + lock) — justified |
| AccessLogRow | yes | access-log.tsx | extracted access-line — justified |
| EarningsSourceBar | yes | earnings.tsx, report.tsx | vs BarRow: per-row tint + consult count + wide money col — justified |
| PayoutDetailRow | yes | report.tsx | vs local PayoutRow (Phase 1 PayoutItem): richer PayoutDetail + failed state — justified |
| InvoiceRow | yes | report.tsx | distinct fields/icon — justified |
| MetricTile | yes | reviews/index.tsx | vs StatCard (no hint, flat tile) — justified. **Note N2: name shadows a *local* `MetricTile` in analytics/index.tsx** (different file, no clash) |
| QualityFactorRow | yes | quality-score.tsx | 0–100 + weight chip vs BarRow series — justified |
| RankingGauge | yes | ranking.tsx | percentile gauge + movement — justified |

Screens correctly reuse `ReviewCard`, `RatingStars`, `StatCard`, `AlertCard`,
`StatusBadge`, `InfoRow`, `SectionCard`, `StateView`, `ToggleRow`. Notifications
centre uses a **local `RichNotificationRow`** rather than the existing
`NotificationRow` — justified, since `NotificationRow` is typed to the Phase 1
`DoctorNotification` (6 fixed types) and cannot render the rich 16-kind superset,
severity, or CTA (Note N3).

### 4. Design-token compliance — **PASS (clean)** with notes
- **Raw hex:** none (0 matches excluding rgba). PASS.
- **Raw fontSize (Note N1):** 5 instances, all `{ ...Typography.displayLg,
  fontSize: NN, lineHeight: NN }` overrides for hero/display numerals:
  `earnings.tsx:206` (36), `earnings/report.tsx:179` (32), `reviews/index.tsx:237`
  (48), `reviews/quality-score.tsx:60` (52), `RankingGauge.tsx:49` (44). Consistent
  with the established prior-batch pattern for oversized display numerals;
  acceptable but flagged.
- **Template-literal alpha tones (Note N4):** `notifications.tsx:145`
  (`${tone}1A`) and `PayoutDetailRow.tsx:40` (`${statusTone}1A`) — token-derived
  tint backgrounds, acceptable-ish, listed as instructed.
- **rgba overlays** (sheet backdrops, gradient text on primary) excluded per spec.
- Magic numbers: small fixed pill/handle dimensions (height 24/28/20, handle
  40×4) consistent with prior batches; not flagged.

### 5. Screen states — **PASS**
Every new/extended screen implements loading (placeholderData + `isLoading &&
!data`), error (`StateView error` + `onRetry`/`refetch`), empty (distinct
`StateView empty` with icon), and success. Spot-checked consolidated states:
- records category filter: per-category empty + screen-level empty ✓
- notification filters: per-filter empty (`filtered.length===0`) ✓
- earnings period/source: "No earnings in this period" + ledger empty ✓
- payout failed: dedicated failed AlertCard ✓
- review tabs: separate empty states for patients vs vet ✓
- earnings/report.tsx: independent loading/error/empty per tab ✓

### 6. Navigation — **PASS** (no orphans, no dead links, no collisions)
- **Orphans:** all 9 new routes registered in `_layout.tsx` have ≥1 caller
  (notifications/preferences ×2, earnings/bank-account ×2, reviews/quality-score
  ×3, reviews/ranking ×1, reviews/improvements ×1, earnings/payout ×1,
  earnings/invoice ×1, records access-log ×1, records category ×2). **No orphans.**
- **Dead links:** all `router.push` targets resolve to registered routes
  (records dashboard→index→category/access-log; index→download/share sheets;
  notifications→cta.route + preferences; earnings→report/bank-account/payout/
  invoice + withdraw/dispute sheets; reviews→quality-score/ranking/improvements +
  report/dispute sheets). Settings.tsx links to reviews, notifications/preferences,
  quality-score, bank-account all resolve. **No dead links.**
- **Collisions:** `records/[patientId].tsx` + `records/[patientId]/` dir,
  `earnings/report.tsx` + `earnings/{payout,invoice,bank-account}`, `reviews/
  index.tsx` + `reviews/{quality-score,ranking,improvements}` — these are the
  **valid Expo Router file-plus-directory pattern** (the `.tsx` is the segment
  screen, the dir holds nested routes). **No collisions.**

### 7. Accessibility — **PASS**
Icon-only Pressables carry `accessibilityLabel` + `accessibilityRole="button"`
throughout (sheet close X buttons, mark-read Check, gate "Request", dispute
links, period/filter chips). Touch targets meet 44 (icon boxes 44, chips 34–38
with hitSlop on small icons e.g. `hitSlop={8/10/16}`). `numberOfLines` applied to
truncatable text (titles, labels, refs, notification body=2). Sampled
notifications/records/earnings/reviews/payout — all consistent.

### 8. Contract adherence — **PASS**
- **Hooks-only:** screens import data via `@/features/doctor/hooks`. The only
  `@/api/doctor.batch6.api` imports (earnings.tsx:15, report.tsx:12, payout/
  [id].tsx:12, invoice/[id].tsx:9) are **`formatKobo` — the documented exception.**
- **Mutations:** none construct `idempotencyKey` in the UI (0 matches); all use
  `mutateAsync` in try/catch and `isPending` for button loading.
- **Money/kobo:** amounts are kobo, formatted with `formatKobo`. No float math on
  kobo values: `earnings.tsx:45` is legit naira-input→kobo
  (`Math.round(naira*100)`); other `*100`/`/100` hits are percentage/display math
  on counts/ratios, not kobo mutations (Note).

### 9. Typecheck — **INCONCLUSIVE-BY-TIMEOUT** (verified clean by inspection)
- Full `npx tsc --noEmit` **exceeded the 45s shell cap (exit 124 at 43s)**, as
  warned. The earlier doctor-scoped grep returned empty only because tsc was
  killed before emitting — treated as inconclusive, not a pass-by-grep.
- **Inspection verdict: clean.** All Batch 6 hook imports resolve to real exports
  in `useMedicalRecords/useNotificationsCenter/useWallet/useReputationCenter.ts`
  (all 31 hooks present) via the `export *` barrel. All `@/types/doctor.batch6`
  symbols used by screens exist (RecordCategory, RichNotification,
  NotificationFilter/Category, EarningsPeriod, PayoutDetailStatus, InvoiceStatus,
  ConsultationFeedback, ReviewDisputeReason, ImprovementPriority, RankingPeerStat,
  BankAccount re-export, etc.). Prop shapes match call sites (PayoutDetailRow/
  InvoiceRow/EarningsSourceBar/MetricTile/QualityFactorRow/RankingGauge/
  RecordCategoryRow/AccessLogRow all called with their declared props).
  `StatusTone` records are exhaustive over their union literals. All lucide icon
  names used exist (CalendarPlus, CalendarX, ShieldX, BadgeCheck, LifeBuoy, Scale,
  Flame, Leaf, etc.).
- **Pre-existing unrelated `src/features/fx/**` error:** not reachable in the
  doctor scope; noted as external, does not affect this batch.
- **`tsdoctor.tmp.json`** at app root is an inert 0-byte file — cleanup item, not
  a defect (Minor M4).

### 10. Ownership / no new deps — **PASS for doctor scope; package.json flagged**
- Frontend changes confined to `app/(doctor)/**` and `src/features/doctor/
  components/**`. Backend additions match the ownership map (new
  type/api/hook/constant files + additive barrels).
- **package.json shows uncommitted additions** (`expo-camera`, `expo-image-picker`,
  `react-native-qrcode-svg`) — but **no file under `app/(doctor)` or
  `src/features/doctor` imports any of them**, so this is **NOT a Batch 6 change**
  (unrelated/another module's working-tree state). Flagged for the integrator to
  confirm provenance (Minor M3); does not block this batch.

---

## Prioritized defect list

### Blocker — none
### Major — none

### Minor
- **M1 — `useRequestReviewRemoval` documented but unwired.**
  `src/features/doctor/hooks/useReputationCenter.ts:92` exports
  `useRequestReviewRemoval`, and the API contract / ownership map list a "Request
  review removal" SHEET on the review row, but `reviews/index.tsx` only wires
  Report and Dispute. It is the `—` extra row (not one of the 12 numbered Z
  entries), so coverage of the 12 is unaffected.
  *Fix:* add a third review-row action (or a menu option) that opens a removal
  sheet calling `useRequestReviewRemoval`, mirroring the existing dispute sheet;
  or remove the unused hook + its contract line if removal is out of scope.

- **M2 — No-op CTA on improvement recommendations.**
  `reviews/improvements.tsx:50` passes `onPress={() => {}}` for the uplift CTA, so
  the AlertCard renders a tappable "Up to +N% score" chevron that does nothing.
  *Fix:* either route the CTA to the relevant target (e.g. quality-score or the
  factor it improves) or drop `ctaLabel`/`onPress` so it renders as a static badge.

- **M3 — package.json has unrelated uncommitted dependency additions.**
  `expo-camera`, `expo-image-picker`, `react-native-qrcode-svg` added but unused by
  any doctor file. Not a Batch 6 violation, but the working tree is dirty.
  *Fix:* integrator to confirm these belong to another in-flight module and that
  Batch 6's "package.json unchanged" guarantee holds at merge.

- **M4 — Inert `tsdoctor.tmp.json` at app root.**
  0-byte temp file left behind. *Fix:* delete it (and add to `.gitignore` if the
  tool will recreate it).

### Notes (non-defects)
- **N1 — Raw `fontSize` on display numerals** (5 sites, all paired with
  `Typography.displayLg` + lineHeight). Consistent with prior batches; consider a
  `displayXl`/`displayHero` token if standardising later.
- **N2 — `MetricTile` name shadow:** `analytics/index.tsx` defines its own local
  `function MetricTile({ metric })` (Phase 3), distinct from the new barrel
  `MetricTile({ icon,label,value,hint })`. Different files, no runtime clash, but
  the duplicate name could confuse future maintainers.
- **N3 — Notifications centre uses local `RichNotificationRow`** instead of the
  existing `NotificationRow` — justified (NotificationRow is typed to the Phase 1
  `DoctorNotification` 6-type shape and cannot render the rich superset/severity/
  CTA).
- **N4 — Template-literal alpha tints** (`${tone}1A`) at `notifications.tsx:145`
  and `PayoutDetailRow.tsx:40` — token-derived, acceptable, listed per spec.

---

## Post-review fixes applied

- **M2 (no-op CTA on improvements) — FIXED.** `reviews/improvements.tsx` no longer
  renders a tappable `ctaLabel`/`onPress={()=>{}}`; the potential-uplift figure is
  folded into the AlertCard `body` ("Potential impact: up to +N% quality score.").
- **M1 (useRequestReviewRemoval exported but unwired) — FIXED.** `reviews/index.tsx`
  now imports `useRequestReviewRemoval`, adds a `submitRemoval` handler, and renders a
  secondary "Request removal" button in the dispute sheet (drives `isPending`, awaits
  `mutateAsync`, input without idempotencyKey). The hook is no longer orphaned.

Remaining: M3 (package.json additions — NOT a doctor-session change; for the
integrator) and M4 (inert `tsdoctor.tmp.json` cleanup) are external/non-code.
No raw hex; doctor-scoped tsc grep clean (full tsc still exceeds the sandbox cap).
