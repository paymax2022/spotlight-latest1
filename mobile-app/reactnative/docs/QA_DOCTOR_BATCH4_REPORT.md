# QA Report — Doctor Batch 4 (Spec Sections O · P · Q · R)

Reviewer: QA Agent · Date: 2026-06-19 · Scope: consolidated build with heavy
reuse of Phase 2 HMO claims / referrals / follow-ups.

App root: `mobile-app/reactnative`

---

## Summary verdict

**PASS WITH DEFECTS** — Batch 4 is functionally complete and the critical
EMERGENCY SAFETY gate passes. Spec coverage is **60/60**. All 7 new components
are genuinely new and used. Navigation is fully wired (no orphans, no dead
links, no Expo Router collisions). Design tokens are clean (no raw hex, no raw
`fontSize`). **One Major defect** (`ref` declared as a data prop on two new
components — React 19 reserved-prop conflict) should be fixed before merge.

### Defect counts
- **Blocker: 0**
- **Major: 1** (reserved `ref` prop on `PreAuthRow` + `IncomingReferralRow`)
- **Minor: 4** (hardcoded care-team thread id; 40x40 add-button touch target
  < 44 w/o hitSlop; isolated magic-number spacing; `tsdoctor.tmp.json` cleanup)

### Key gate results
- **Doctor-scoped tsc grep:** INCONCLUSIVE-BY-TIMEOUT. `npx tsc --noEmit` hit the
  45 s shell cap (exit 124) before emitting output; the doctor/batch4 grep was
  therefore empty but not authoritative. Types verified by inspection instead
  (imports resolve to barrels; hook/prop shapes match call sites; exported
  symbols exist). The pre-existing unrelated `src/features/fx/**` error is noted
  and was not exercised. See Major-1 for the one inspection-found type risk.
- **EMERGENCY disclaimer + non-actionable:** **PASS** (see Section 2).
- **All 7 new components used:** **YES.**
- **Nav orphans / dead links / collisions:** **none / none / none.**
- **Per-section coverage:** O 19/19 · P 16/16 · Q 15/15 · R 10/10.

---

## Per-section coverage tables

### Section O — HMO / Insurance (19/19)

| # | Spec entry | How covered | Verdict |
|---|-----------|-------------|---------|
| O1 | HMO-covered consult detail | `consult/[id]/hmo.tsx` (eligibility base + `useCoveredServices`) | PASS |
| O2 | eligibility view | STATE of `consult/[id]/hmo.tsx` (`useHmoEligibility`, STATUS_CONFIG) | PASS |
| O3 | plan coverage summary | `hmo/plan-coverage.tsx` (`useHmoPlanCoverage`, CoverageBar) | PASS |
| O4 | covered consult status | STATE of `consult/[id]/hmo.tsx` "Covered services" (kind consultation) | PASS |
| O5 | co-pay notice | banner on `hmo/plan-coverage.tsx` + InfoRow on `consult/[id]/hmo.tsx` | PASS |
| O6 | pre-auth request | RequestSheet on `hmo/pre-auth.tsx` (`useRequestPreAuth`) | PASS |
| O7 | approval pending | STATE of `hmo/pre-auth/[id].tsx` (STATUS_CFG.pending) | PASS |
| O8 | approval approved | STATE of `hmo/pre-auth/[id].tsx` (+ authCode InfoRow) | PASS |
| O9 | approval rejected | STATE of `hmo/pre-auth/[id].tsx` (rejection card) | PASS |
| O10 | coverage-limit exceeded | banner on `hmo/pre-auth/[id].tsx` (`status==='limit_exceeded'`) | PASS |
| O11 | covered rx status | STATE of `consult/[id]/hmo.tsx` (covered service kind prescription) | PASS |
| O12 | covered lab status | STATE of `consult/[id]/hmo.tsx` (covered service kind lab) | PASS |
| O13 | claim submission preview | PreviewSheet on `claims/index.tsx` (`useSubmitClaim`) | PASS |
| O14 | doctor service claim status | filter + StatusBadge on `claims/index.tsx` (`CLAIM_STATUS_LABELS`) | PASS |
| O15 | claim approved | STATE (filter `approved`) on `claims/index.tsx` | PASS |
| O16 | claim rejected | STATE (filter `rejected`) on `claims/index.tsx` | PASS |
| O17 | claim dispute | dispute flow on `claims/[id].tsx` (`useDisputeClaim`) | PASS |
| O18 | HMO support chat | `hmo/support.tsx` (`useHmoSupportThread`/`useSendHmoSupportMessage`, ChatComposer) | PASS |
| O19 | HMO fraud warning | acknowledgeable AlertCard banners on `hmo/pre-auth/[id].tsx` (`useHmoFraudWarnings`/`useAcknowledgeFraudWarning`) | PASS |

### Section P — Referral & Specialist Collaboration (16/16)

| # | Spec entry | How covered | Verdict |
|---|-----------|-------------|---------|
| P1 | refer to specialist | REUSE `referrals/new.tsx` (`useCreateReferral`) | PASS |
| P2 | select specialist | REUSE referrals flow (`useSpecialists`, `REFERRAL_SPECIALTY_OPTIONS`); also opinion sheet | PASS |
| P3 | reason | REUSE `SpecialistReferral.reason` + urgency | PASS |
| P4 | attach notes | REUSE `ReferralAttachment` kind note (`REFERRAL_ATTACHMENT_KIND_LABELS`) | PASS |
| P5 | attach lab results | REUSE `ReferralAttachment` kind lab | PASS |
| P6 | attach rx history | REUSE `ReferralAttachment` kind prescription | PASS |
| P7 | referral sent | REUSE `ReferralStatus==='sent'` (`REFERRAL_STATUS_LABELS`) | PASS |
| P8 | referral accepted | REUSE `ReferralStatus==='accepted'` | PASS |
| P9 | referral rejected | REUSE `ReferralStatus==='rejected'` | PASS |
| P10 | incoming referral | `referrals/incoming.tsx` (`useIncomingReferrals`, IncomingReferralRow) | PASS |
| P11 | referral case detail | `referrals/incoming/[id].tsx` (`useAcceptReferral`/`useRejectReferral`, `REFERRAL_REJECTION_REASONS`) | PASS |
| P12 | specialist opinion request | OpinionSheet kind `specialist` on `referrals/incoming.tsx` (`useRequestOpinion`) | PASS |
| P13 | second opinion request | OpinionSheet kind `second` on `referrals/incoming.tsx` | PASS |
| P14 | care team chat | `referrals/[id]/care-team.tsx` (`useCareTeamThread`/`useSendCareTeamMessage`) | PASS |
| P15 | shared case summary | collapsible STATE of `care-team.tsx` (`useSharedCaseSummary`) | PASS |
| P16 | referral history | REUSE `useReferrals` + opinion history tab (`useOpinionRequests`, `OPINION_STATUS_LABELS`) | PASS |

### Section Q — Follow-Up Care (15/15)

| # | Spec entry | How covered | Verdict |
|---|-----------|-------------|---------|
| Q1 | create plan | REUSE `follow-ups/new.tsx` (`useCreateFollowUp`) | PASS |
| Q2 | date selection | STATE of `follow-ups/new.tsx` (DatePickerField) | PASS |
| Q3 | reason | STATE of `follow-ups/new.tsx` | PASS |
| Q4 | free follow-up eligibility | banner on `follow-ups/index.tsx`+`new.tsx` (`useFollowUpEligibility.freeEligible`) | PASS |
| Q5 | paid follow-up requirement | banner (paid branch, `formatKobo(paidFeeKobo)`) | PASS |
| Q6 | patient follow-up request | REUSE `useFollowUps` request items on `follow-ups/index.tsx` | PASS |
| Q7 | approve | REUSE `useReviewFollowUpRequest` (approve) | PASS |
| Q8 | reject | REUSE `useReviewFollowUpRequest` (reject) | PASS |
| Q9 | reminder | reminder action on `follow-ups/index.tsx` (`useSetFollowUpReminder`) | PASS |
| Q10 | follow-up notes | `useCompleteFollowUp` (`outcomeNote`) | PASS |
| Q11 | completed | `useCompleteFollowUp` -> `completed` (`FOLLOW_UP_STATUS_LABELS`) | PASS |
| Q12 | missed | `useCompleteFollowUp({missed:true})` -> `missed` (confirm Alert) | PASS |
| Q13 | long-term care plan | `care-plans/index.tsx` + `care-plans/new.tsx` (`useLongTermCarePlans`/`useSaveCarePlan`, CarePlanCard, EditableListCard) | PASS |
| Q14 | chronic monitoring | section of `care-plans/index.tsx` (`useChronicMonitoring`, `CHRONIC_TREND_LABELS`) | PASS |
| Q15 | medication adherence check | AdherenceSheet on `care-plans/index.tsx` (`useAdherenceChecks`/`useRecordAdherenceCheck`, AdherencePill, `ADHERENCE_OPTIONS`) | PASS |

### Section R — Emergency & Escalation (10/10) — DEMO, non-actionable

| # | Spec entry | How covered | Verdict |
|---|-----------|-------------|---------|
| R1 | emergency warning | DisclaimerBanner on `emergency/index.tsx` (`EMERGENCY_DISCLAIMER`) | PASS |
| R2 | red-flag alert | AlertCards on `emergency/index.tsx` + `[caseId].tsx` (`useRedFlagAlerts`) | PASS |
| R3 | recommend facility | facility sheet on `emergency/index.tsx` (`useEmergencyFacilities`, EmergencyFacilityRow, demo-only) | PASS |
| R4 | emergency referral note | "Actions taken" on `emergency/[caseId].tsx` (`useDocumentEmergencyCase`) | PASS |
| R5 | escalate to hospital | reason sheet on `emergency/index.tsx` (`useEscalateToHospital`, demo Alert) | PASS |
| R6 | escalate to ambulance | reason sheet on `emergency/index.tsx` (`useEscalateToAmbulance`, demo Alert) | PASS |
| R7 | notify emergency contact | contact sheet on `emergency/index.tsx` (`useNotifyEmergencyContact`, "no message sent") | PASS |
| R8 | emergency disclaimer | DisclaimerBanner on BOTH emergency screens AND every escalation sheet | PASS |
| R9 | emergency case documentation | `emergency/[caseId].tsx` (`useEmergencyCaseRecord`/`useDocumentEmergencyCase`) | PASS |
| R10 | emergency follow-up | DatePicker + `useScheduleEmergencyFollowUp` on `[caseId].tsx` (invalidates Phase 2 follow-ups) | PASS |

---

## Per-check findings

### Check 1 — Spec coverage — PASS (60/60)
Every O/P/Q/R entry maps to real code (tables above). All "REUSES existing"
entries verified against the cited screen/hook (claims, referrals, follow-ups,
HMO eligibility). No entry is stubbed or missing.

### Check 2 — EMERGENCY SAFETY (Section R) — PASS (gate)
- `EMERGENCY_DISCLAIMER` sourced from constants (`@/features/doctor/constants`),
  never hardcoded (grep for "not a real emergency" in screens = none).
- Rendered prominently via `DisclaimerBanner`:
  - `emergency/index.tsx:65` (top of scroll, R1/R8).
  - `emergency/index.tsx` facility sheet, escalate sheet, notify-contact sheet —
    disclaimer on EVERY escalation sheet.
  - `emergency/[caseId].tsx:79` (top of case record, R8).
- Non-actionable confirmed:
  - API `escalateToHospital`/`escalateToAmbulance`/`notifyEmergencyContact`/
    `documentEmergencyCase`/`scheduleEmergencyFollowUp`
    (`doctor.batch4.api.ts:543-560+`) all `wait()` demo results; explicit
    `// DEMO ONLY — no real dispatch` comments; `notifyEmergencyContact` does
    `void input.message`.
  - Facility contacts are non-dialable demo strings: `"Demo line — not dialable"`
    (`doctor.batch4.api.ts:317-320`); no `Linking`, `tel:`, or network calls in
    the API or screens.
  - Success copy is demo-explicit: "This is a DEMO. No real dispatch was
    performed." (`emergency/index.tsx:49`); "No message was actually sent.";
    "(demo)" suffixes throughout.

### Check 3 — Reuse vs duplication — PASS (with Major-1 noted)
All 7 new components are genuinely new (unique names; no pre-existing collision)
and each is used:

| Component | New? | Used in | Reuses |
|-----------|------|---------|--------|
| CoverageBar | PASS | `hmo/plan-coverage.tsx` | tokens |
| PreAuthRow | PASS | `hmo/pre-auth.tsx` | StatusBadge |
| IncomingReferralRow | PASS | `referrals/incoming.tsx` | StatusBadge, DoctorAvatar |
| AdherencePill | PASS | `care-plans/index.tsx` | tokens |
| EmergencyFacilityRow | PASS | `emergency/index.tsx` | tokens |
| DisclaimerBanner | PASS | `emergency/index.tsx`, `emergency/[caseId].tsx` | tokens |
| CarePlanCard | PASS | `care-plans/index.tsx` | StatusBadge |

Screens reuse `StateView`, `SectionCard`, `InfoRow`, `StatusBadge`, `AlertCard`,
`ChatComposer`, `EditableListCard` rather than re-implementing. The two inline
chat `Bubble`s (`hmo/support.tsx`, `care-team.tsx`) are justified and documented:
`HmoSupportMessage`/`CareTeamMessage` author shapes differ from the Phase 1
`ChatMessage` that `MessageBubble` expects — not duplication of concern.

### Check 4 — Design-token compliance — PASS
- Raw hex (excluding `rgba` overlays): none across the 7 components + all new/
  edited screens.
- Raw `fontSize`: none (all typography via `Typography.*`).
- Minor magic-number spacing exists (`AdherencePill` height:26/paddingH:10;
  `EmergencyFacilityRow` marginTop:2; `plan-coverage` marginLeft:24;
  `incoming` marginTop:2) — see Minor-3. Matches a pre-existing repo convention
  (17 similar instances in existing components), so a calibration baseline
  rather than a new violation.

### Check 5 — Screen states — PASS
Every new screen implements loading / error / empty / success. Consolidated
states verified: pre-auth pending/approved/rejected/limit_exceeded; claim status
filter; incoming accept/reject; follow-up completed/missed (confirm Alert for
missed); escalation statuses (`ESCALATION_STATUS_LABELS`).

### Check 6 — Navigation — PASS (orphans: none · dead links: none · collisions: none)
- All 14 Batch 4 routes registered in `_layout.tsx:134-144` (+ reused
  `consult/[id]/hmo`, `referrals/*`). Every registered route has >=1 caller.
- Entry points: `(tabs)/records.tsx`, `patient/[id].tsx`, `consult/[id]/hmo.tsx`,
  `claims/index.tsx`, `follow-ups/index.tsx`, `referrals/index.tsx`.
- All `router.push/replace` targets resolve to registered routes.
- No Expo Router collisions: `referrals/[id].tsx` + `referrals/[id]/care-team.tsx`,
  `hmo/pre-auth.tsx` + `hmo/pre-auth/[id].tsx`, `referrals/incoming.tsx` +
  `referrals/incoming/[id].tsx`, `emergency/index.tsx` + `emergency/[caseId].tsx`
  are all valid sibling file+dir patterns.

### Check 7 — Accessibility — PASS (minor nit)
- Icon-only Pressables carry `accessibilityRole="button"` + `accessibilityLabel`.
- `numberOfLines` present on truncatable text throughout.
- Nit (Minor-2): header add buttons are 40x40 (< 44 min touch target) and lack
  `hitSlop` (`hmo/pre-auth.tsx:127`, `care-plans/index.tsx:191`,
  `referrals/incoming.tsx:201`). Matches existing app convention; minor.
- Note: see Major-1 — `PreAuthRow`/`IncomingReferralRow` accessibilityLabels
  interpolate the `ref` prop which is at risk of being `undefined`.

### Check 8 — Contract adherence — PASS
- Hooks-only in screens: the only direct `@/api/doctor.batch4.api` imports are
  `formatKobo` (allowed) in `hmo/plan-coverage.tsx:10`, `hmo/pre-auth.tsx:13`,
  `hmo/pre-auth/[id].tsx:11`. No other direct API calls.
- `EMERGENCY_DISCLAIMER` imported from constants barrel (not hardcoded).
- Mutations omit `idempotencyKey` (hooks inject via `generateIdempotencyKey()`)
  and use `isPending` + `mutateAsync` at call sites.
- Money: kobo integers; displayed via `formatKobo`; NGN->kobo via
  `Math.round(naira*100)`.
- Orchestrator-written hooks consumed: `useFollowUpCare` used by `follow-ups/*`
  and `care-plans/*`; `useEmergency` (all reads + 5 demo mutations) used by
  `emergency/*`. No exported-but-unused hook; no screen imports a missing symbol.

### Check 9 — Typecheck — INCONCLUSIVE-BY-TIMEOUT
- `npx tsc --noEmit` timed out at the 45 s shell cap (exit 124) with no output;
  the doctor/batch4-scoped grep was empty but not authoritative.
- Pre-existing unrelated `src/features/fx/**` error acknowledged (not exercised).
- Verified by inspection: all `@/` imports resolve to existing barrels/modules;
  exported symbols (types, hooks, constants, DEMO_*) exist; hook return types and
  component prop shapes match call sites.
- One inspection-found type risk: Major-1 (`ref` prop).
- `tsdoctor.tmp.json` (empty, app root) is NOT referenced by tsconfig — cleanup
  item only (Minor-4).

### Check 10 — Ownership / no new deps — PASS
- Frontend changes confined to `app/(doctor)/**` and
  `src/features/doctor/components/**`. Backend-owned files match the contract.
- `package.json` dependencies unchanged (React 19.1.0 / RN 0.81.5 /
  @types/react 19.1.10 already present).

---

## Prioritized defect list

### MAJOR

**Major-1 — `ref` declared as a string data prop on two new components (React 19 reserved-prop conflict).**
- Files:
  - `src/features/doctor/components/PreAuthRow.tsx:13` (`ref: string;` in `Props`),
    destructured `ref: paRef`, consumed for display + accessibilityLabel.
  - `src/features/doctor/components/IncomingReferralRow.tsx:18` (`ref: string;`),
    destructured `ref: refCode`.
  - Call sites pass a string: `app/(doctor)/hmo/pre-auth.tsx:55` `ref={r.ref}`;
    `app/(doctor)/referrals/incoming.tsx:73` `ref={r.ref}`.
- Why it matters: `ref` is a reserved React attribute. Under React 19 +
  `@types/react@19.1`, the intrinsic `ref` attribute on a JSX element is typed as
  a `Ref<...>`, so passing a string (`ref={r.ref}`) is a likely tsc type error
  ("Type 'string' is not assignable to type 'Ref<...>'"). Even where it compiles,
  treating `ref` as application data is fragile, and any tooling/runtime that
  intercepts `ref` would leave `paRef`/`refCode` undefined — the row's reference
  code (e.g. "PA-7C1B88" / "REF-9F2A41") and the interpolated accessibilityLabel
  would render blank/"undefined". No prior batch declares a `ref` data prop, so
  this is Batch 4-introduced.
- Could not be confirmed authoritatively because full `tsc` timed out; flagged on
  inspection with high confidence.
- Recommended fix (do not apply here): rename the prop to a non-reserved name
  (e.g. `reference` or `refCode`) in both `Props` interfaces and both call sites;
  update internal usages and the accessibilityLabel interpolation. Re-run `tsc`.

### MINOR

**Minor-1 — Care-team thread id hardcoded, ignoring the route param.**
- `app/(doctor)/referrals/[id]/care-team.tsx:21` — `useCareTeamThread('ctt-1')`
  and send fallback `'ctt-1'`, while the screen correctly passes `caseRef` to
  `useSharedCaseSummary(caseRef)`. Cosmetic on demo data; under live data the
  chat would not key off the actual case. Fix: derive the thread id from the
  case/referral.

**Minor-2 — Header add buttons below 44px touch target without hitSlop.**
- `hmo/pre-auth.tsx:127`, `care-plans/index.tsx:191`, `referrals/incoming.tsx:201`
  (`addBtn` = 40x40). Fix: add `hitSlop={8}` or size to 44. Matches existing
  convention, hence minor.

**Minor-3 — Isolated magic-number spacing/size literals.**
- `AdherencePill.tsx:36`, `EmergencyFacilityRow.tsx:69`,
  `hmo/plan-coverage.tsx:119`, `referrals/incoming.tsx:212`. Fix: route through
  `Spacing.*` where a token exists. Pre-existing pattern, hence minor.

**Minor-4 — Inert temp file at app root.**
- `tsdoctor.tmp.json` (empty, not referenced by tsconfig). Cleanup item, not a
  defect. Recommended: delete.

---

## Notes
- No blocker found. The EMERGENCY SAFETY gate (the one true PASS/FAIL gate for
  this batch) passes cleanly.
- Recommend addressing Major-1 (a ~4-line rename across 4 files) and re-running a
  full `tsc` (outside the 45 s cap) before merge to convert the typecheck result
  from INCONCLUSIVE to confirmed-clean.

---

## Post-review fix applied (Major resolved)

**Major-1 (reserved `ref` prop swallowed by React) — FIXED.** Renamed the prop
`ref` → `reference` in both `PreAuthRow.tsx` and `IncomingReferralRow.tsx`
(interface + destructure; internal aliases `paRef`/`refCode` unchanged) and updated
the two call sites `hmo/pre-auth.tsx` and `referrals/incoming.tsx` to pass
`reference={r.ref}` (the data field `r.ref` is unchanged). React no longer
intercepts the value, so the reference code (e.g. "PA-7C1B88") renders and the
accessibility labels resolve. Verified by grep: no `ref=` props remain on those
components; both now expose `reference`.

Remaining 4 minors (hardcoded care-team thread id, two 40×40 add buttons without
hitSlop, isolated magic-number spacings matching repo convention, and the inert
`tsdoctor.tmp.json` cleanup item) are non-blocking.

> tsc note: full `npx tsc --noEmit` exceeds the sandbox 45s shell cap; the fix is
> mechanical/type-safe by inspection. A full typecheck on a normal machine is the
> formal close-out.
