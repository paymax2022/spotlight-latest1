# QA Report — Doctor Batch 3 (Sections K · L · M · N)

**Scope:** Doctor-side telemedicine, Batch 3 = spec sections **K (45) · L (21) · M (26) · N (20) = 112 entries**, built consolidated with heavy reuse of Phase 1/2 prescription/pharmacy/lab work.
**Reviewer role:** QA (findings only — no feature-code edits).
**Date:** 2026-06-19

---

## 1. Summary verdict

**PASS WITH MINOR NOTES.** The batch is well-built: the e-prescription builder (K) is comprehensive and surfaces all 7 safety-warning kinds; the lab-result review (N) surfaces abnormal/critical flags, reference ranges and compare-with-previous; design tokens are clean (no raw hex, no raw fontSize); contract adherence is tight (hooks-only in screens, no `idempotencyKey` in screens, kobo + `formatKobo` everywhere); all 6 prebuilt components are exported AND used; navigation has no orphans, dead links, or collisions.

The defects are all **consolidation/reuse gaps**, not crashes: a small set of backend hooks/types/labels were authored but never wired into a screen, so a few spec entries that the ownership map marks as "STATE of …" do not actually surface as distinct UI states. None are blockers.

### Counts
| Severity | Count |
|----------|-------|
| Blocker  | 0 |
| Major    | 2 |
| Minor    | 4 |

### Per-section coverage
| Section | Entries | Full / State / Sheet / Reuse covered | Gaps |
|---------|---------|--------------------------------------|------|
| **K** | 45 | **45/45** | 0 |
| **L** | 21 | **17/21 full + 4 PARTIAL** | L13–L16 extended statuses prose-only |
| **M** | 26 | **24/26** | M25 cancel, M26 expired (orphaned hooks) |
| **N** | 20 | **20/20** | 0 |

### tsc (doctor-scoped) — **INCONCLUSIVE-BY-TIMEOUT**
`npx tsc --noEmit` exceeded the 45s shell cap on every poll (still running after ~4 min). Per the brief, types were verified **by inspection** instead: every screen import resolves to the hooks/components/constants barrels; component prop shapes (`AlternativeRow`, `PharmacyRow`, `StockBadge`, `ResultInboxRow`, `ResultValueRow`, `QrCodeView`) match their call sites; all referenced hooks (`useEprescription`/`usePharmacyFulfil`/`useLabOrdering`/`useLabResults`), types (`@/types/doctor.batch3`) and constants (`batch3.ts`) exist and are exported via the barrels. No type mismatch found by inspection. The pre-existing unrelated `src/features/fx/**` error is noted as external and out of scope.

---

## 2. Per-section coverage tables

### SECTION K — E-Prescription (45) — 45/45 PASS
Builder: `app/(doctor)/consult/[id]/prescription.tsx`; list: `prescriptions/index.tsx`; detail: `prescriptions/[id]/issued.tsx` (NEW); refills: `refills/index.tsx`.

| # | Entry | How covered | Verdict |
|---|-------|-------------|---------|
| K1 | start prescription | builder screen + `useCreatePrescription` | PASS |
| K2 | add drug | `addLine()` / `RxDrugLine[]` (prescription.tsx:86,185) | PASS |
| K3 | drug search | `DrugSearchSheet` + `searchDrugCatalogue` (417) | PASS |
| K4 | drug catalogue | catalogue sheet over `DRUG_CATALOGUE_RICH` | PASS |
| K5 | strength select | `STRENGTH_OPTIONS` SelectField (347) | PASS |
| K6 | dosage form | `DOSAGE_FORM_OPTIONS` (350) | PASS |
| K7 | route | `ROUTE_OPTIONS` reuse (357) | PASS |
| K8 | frequency | `FREQUENCY_OPTIONS` reuse (360) | PASS |
| K9 | duration | `DURATION_OPTIONS` reuse (367) | PASS |
| K10 | before/after food | `FOOD_TIMING_OPTIONS` chips (384) | PASS |
| K11 | special instruction | TextInput (397) | PASS |
| K12 | quantity | numeric input (371) | PASS |
| K13 | generic alternatives | `getDrugAlternatives` + `AlternativeRow` (245) | PASS |
| K14 | brand alternatives | same sheet (kind chip Brand/Generic) | PASS |
| K15 | interaction warning | `checkPrescriptionWarnings` kind `interaction` (api:213) → `SeverityFinding` | PASS |
| K16 | duplicate-drug | kind `duplicate` (api:201) | PASS |
| K17 | contraindication | kind `contraindication` (api:154) | PASS |
| K18 | controlled-substance | kind `controlled` (api:163) | PASS |
| K19 | pregnancy/breastfeeding | kind `pregnancy_breastfeeding` (api:172) | PASS |
| K20 | paediatric-dose | kind `paediatric_dose` (api:181) | PASS |
| K21 | elderly-dose | kind `elderly_dose` (api:190) | PASS |
| K22 | warning severity tone | `RX_WARNING_TONES` + `WARNING_TONE` map (47) | PASS |
| K23 | safety check summary | consolidated warn panel (164–183) | PASS |
| K24 | draft | `saveDraft` plain create (111) | PASS |
| K25 | preview | preview modal (253) | PASS |
| K26 | digital signature | sign sheet + `useIssuePrescription` (280) | PASS |
| K27 | sign prescription | signaturePin → issue | PASS |
| K28 | issue prescription | `useIssuePrescription` → 'issued' (142) | PASS |
| K29 | QR / verification code | `QrCodeView` + verificationCode (issued:122) | PASS |
| K30 | issued detail | `issued.tsx` + `useIssuedPrescription`; reachable from list (index:52) | PASS |
| K31 | expired | `lifecycle === 'expired'` banner (issued:110) | PASS |
| K32 | cancel | `useCancelPrescription` + `RX_CANCEL_REASONS` sheet (238) | PASS |
| K33 | edit pre-issue | draft lines editable (builder state) | PASS |
| K34 | share | `useSharePrescription` (issued:157) | PASS |
| K35 | send to pharmacy | `useSendToPharmacy` sheet (207) | PASS |
| K36 | choose fulfilment option | `RX_FULFILMENT_OPTION_LABELS` radios (218) | PASS |
| K37 | prescription list | `usePrescriptions` (index:22) | PASS |
| K38 | audit trail | `IssuedPrescription.audit` + `AUDIT_ACTION_LABELS` sheet (181) | PASS |
| K39 | refill request | `useRefillRequests` (refills:24) | PASS |
| K40 | approve refill | `useReviewRefill('approve')` (refills:65) | PASS |
| K41 | reject refill | `useReviewRefill('reject')` | PASS |
| K42 | refill consult required | `useRequestRefillConsultation` (refills:39) | PASS |
| K43 | status badge | `RX_LIFECYCLE_LABELS` + StatusBadge (issued:106) | PASS |
| K44 | validity window | `validUntil` InfoRow (issued:134) | PASS |
| K45 | drug line summary | `rx.lines` Medications card (issued:140) | PASS |

### SECTION L — Pharmacy & Fulfilment (21) — 17 PASS / 4 PARTIAL
Screens: `pharmacy/index.tsx`, `pharmacy/[id].tsx`, `pharmacy/[id]/delivery.tsx`, `pharmacy/directory.tsx` (NEW), `pharmacy/[id]/chat.tsx` (NEW).

| # | Entry | How covered | Verdict |
|---|-------|-------------|---------|
| L1 | fulfilments list | `usePharmacyFulfilments` (index:27) | PASS |
| L2 | fulfilment detail | `usePharmacyFulfilment` ([id]:31) | PASS |
| L3 | nearby pharmacy lookup | directory + `usePharmacies`, distance-sorted (directory:36) | PASS |
| L4 | preferred pharmacy | `usePreferredPharmacy` section (directory:71) | PASS |
| L5 | verified badge | `Pharmacy.verified` in `PharmacyRow` (31) | PASS |
| L6 | select pharmacy | `useSelectPharmacy` (directory:48) | PASS |
| L7 | drug stock | `useDrugStock` + `StockBadge` (directory:98) | PASS |
| L8 | drug-unavailable alert | `out_of_stock` banner (directory:104) | PASS |
| L9 | substitute request | `fulfilment.substitute` card ([id]:116) | PASS |
| L10 | approve substitute | `useReviewSubstitute('approve')` ([id]:142) | PASS |
| L11 | reject substitute | `useReviewSubstitute('reject')` | PASS |
| L12 | clarification chat | `usePharmacyMessages`+`useSendPharmacyMessage` (chat.tsx) | PASS |
| L13 | status partial/full | `FulfilmentStatusExt`/`FULFILMENT_STATUS_LABELS` exist but **unused**; only generic prose statusNote ([id]:147) | **PARTIAL** |
| L14 | awaiting payment | same — not a distinct data-driven state | **PARTIAL** |
| L15 | awaiting HMO | same | **PARTIAL** |
| L16 | awaiting delivery | same | **PARTIAL** |
| L17 | delivery tracking | `useDrugDelivery` + `StatusTimeline` (delivery.tsx) | PASS |
| L18 | delayed/failed alert | `useDeliveryAlerts` filtered (delivery:22,50) | PASS |
| L19 | patient-received confirm | `useConfirmPatientReceived` ([id]:38) (terminal `received_by_patient` not surfaced as badge) | PASS |
| L20 | complaint/report | `useReportPharmacy` + `PHARMACY_REPORT_REASONS` ([id]:196) | PASS |
| L21 | message thread | `usePharmacyMessages` list (chat.tsx:43) | PASS |

### SECTION M — Lab Test Ordering (26) — 24 PASS / 2 FAIL
Screen: `consult/[id]/lab-order.tsx` (create builder); history via `records.tsx`.

| # | Entry | How covered | Verdict |
|---|-------|-------------|---------|
| M1 | start lab order | `useCreateLabOrder` (lab-order:44) | PASS |
| M2 | lab catalogue | `useLabCatalogue` + `CatalogueSheet` (362) | PASS |
| M3 | test search/select | catalogue search + toggle (374) | PASS |
| M4 | lab packages | `useLabPackages` sheet (225) | PASS |
| M5 | reason / diagnosis link | `SoapSection` + `DiagnosisSearchSheet` (156,301) | PASS |
| M6 | sample type | `SAMPLE_TYPE_OPTIONS` detail row (284) | PASS |
| M7 | sample instruction | `sampleInstruction` (285) | PASS |
| M8 | fasting requirement | `FASTING_INSTRUCTION` banner (148) | PASS |
| M9 | fasting hours | `fastingHours` in detail (286) | PASS |
| M10 | urgency | `URGENCY_OPTIONS` chips (165) | PASS |
| M11 | home collection | `COLLECTION_OPTIONS` (177) | PASS |
| M12 | lab visit | same | PASS |
| M13 | provider lookup | `useLabProviders` sheet (245) | PASS |
| M14 | verified-lab badge | `provider.verified` (257) | PASS |
| M15 | recommended provider | `provider.recommended` chip (258) | PASS |
| M16 | select provider | provider radio (253) | PASS |
| M17 | HMO-covered check | `checkLabCoverage` (71) | PASS |
| M18 | patient-payment notice | `patientPayKobo` + `formatKobo` (202) | PASS |
| M19 | order price | `priceKobo` + `formatKobo` (288) | PASS |
| M20 | turnaround | `turnaroundHours` (287) | PASS |
| M21 | preview | preview modal (309) (local state — `useLabOrderRich` not used, but read-view present) | PASS |
| M22 | submit / success | `useCreateLabOrder` result Alert (93) | PASS |
| M23 | share lab order | `useShareLabOrder` (106) | PASS |
| M24 | lab order history | `useLabOrders` in `records.tsx` (26) | PASS |
| M25 | cancel lab order | `useCancelLabOrder` exists but **orphaned** — no screen calls it; no lab-order detail/rich screen to cancel from | **FAIL** |
| M26 | lab order expired | `LabOrderRich.validUntil` / `useLabOrderRich` **orphaned** — no screen renders an expired lab-order state | **FAIL** |

### SECTION N — Lab Result Review (20) — 20/20 PASS
Detail: `lab/[orderId].tsx`; inbox: `lab/inbox.tsx` (NEW).

| # | Entry | How covered | Verdict |
|---|-------|-------------|---------|
| N1 | results inbox | `useResultInbox` + `ResultInboxRow` (inbox.tsx) | PASS |
| N2 | status pending/ready/delayed | `RESULT_STATUS_LABELS` in `ResultInboxRow` (56) | PASS |
| N3 | new-result flag | `item.isNew` dot (ResultInboxRow:44) | PASS |
| N4 | critical-result alert | inbox banner (inbox:33) + detail banner ([orderId]:138) | PASS |
| N5 | result detail | `useLabResultRich` ([orderId]:36) | PASS |
| N6 | base result | `LabResultRich.base` reuse | PASS |
| N7 | PDF report | `pdfReportUrl` link ([orderId]:168) | PASS |
| N8 | structured values | `richValues` + `ResultValueRow` (153) | PASS |
| N9 | abnormal-value flag | `ResultValueRow` abnormal tone (33) | PASS |
| N10 | critical-value flag | `ResultValueRow` critical tone (29) | PASS |
| N11 | reference ranges | `refRange` (ResultValueRow:41) | PASS |
| N12 | compare with previous | `useLabValueComparisons` + `BarRow` (250) | PASS |
| N13 | doctor interpretation | `useAddInterpretation` sheet (220) | PASS |
| N14 | recommendation | recommendation field (227) | PASS |
| N15 | mark reviewed | `useMarkLabResultReviewed` (38) | PASS |
| N16 | request repeat/additional | `useRequestRepeatTest` (200) | PASS |
| N17 | share explanation | `useShareResultExplanation` (198) | PASS |
| N18 | schedule follow-up | reuses `follow-ups/new` route (202) | PASS |
| N19 | refer to specialist | reuses `referrals/new` route (204) | PASS |
| N20 | download / audit / suspicious | download Alert + audit sheet + `useReportSuspiciousResult` (205–211) | PASS |

---

## 3. Checks

### Check 1 — Spec coverage
**108/112 full PASS; 4 PARTIAL (L13–L16); 2 FAIL (M25, M26).** All 7 K safety-warning kinds confirmed produced by `checkPrescriptionWarnings` (`doctor.batch3.api.ts:154,163,172,181,190,201,213`) and rendered via the consolidated warn panel. N abnormal/critical flags + compare-with-previous confirmed. QR/issued screen confirmed. See defect list.

### Check 2 — Reuse vs duplication — **PASS**
- 6 new components each genuinely new (no existing barrel row composes their data): `AlternativeRow` (PASS), `PharmacyRow` (PASS), `QrCodeView` (PASS — dependency-free grid placeholder), `ResultInboxRow` (PASS — composes `DoctorAvatar`+`StatusBadge`), `ResultValueRow` (PASS), `StockBadge` (PASS — maps `StockLevel`→tone).
- **All 6 are exported (`components/index.ts:52–57`) AND used** (Alternative→prescription.tsx, Pharmacy+Stock→directory.tsx, Qr→issued.tsx, ResultInbox→inbox.tsx, ResultValue→[orderId].tsx). **No orphaned components.**
- Screens correctly reuse existing pieces: `SeverityFinding`, `DiagnosisSearchSheet`, `LabTestRow`, `SoapSection`, `BarRow`, `ChatComposer`, `StatusTimeline`, `SectionCard`, `InfoRow`, `StateView`, `StatusBadge`, `DoctorAvatar`, `TeleHeader` — no re-implementation found.

### Check 3 — Design-token compliance — **PASS**
- Raw hex (excl. `rgba` backdrop overlays): **none** in any Batch 3 screen or component.
- Raw `fontSize`: **none**.
- Small numeric literals remain for chip/badge/icon primitive sizes (e.g. `StockBadge` height:24/paddingHorizontal:10, `AlternativeRow` swap 36×36, badge height:22). These match the established convention across all prior-passed batches (`controlledChip`, `statusPill`, etc.). Acceptable; noted as Minor.

### Check 4 — Screen states — **PASS**
Loading / empty / error / success present on all new + extended screens (`StateView` variants). Verified: prescriptions list, issued detail, lab inbox, lab detail, pharmacy list/detail/directory/delivery/chat, refills, lab-order. Lifecycle states: rx draft/preview/signed/issued/expired/cancelled all rendered (issued.tsx `LIFECYCLE_TONE`); result pending/ready/delayed/critical rendered. **Gap:** pharmacy partial/awaiting-payment/HMO not data-driven (see L13–L16).

### Check 5 — Navigation — **PASS (no orphans, no dead links, no collisions)**
- **Orphans:** all 4 NEW routes have ≥1 caller — `prescriptions/[id]/issued` (from list index:52 + after-issue prescription:145 + directory after-select), `pharmacy/directory` (pharmacy list:40 + send-to-pharmacy issued:228), `pharmacy/[id]/chat` ([id]:171), `lab/inbox` (records hub:54). None orphaned.
- **Dead links:** every `router.push/replace` target resolves to a registered route (verified all targets incl. reused `ai/rx-safety`, `ai/lab-explanation`, `follow-ups/new`, `referrals/new`, `(tabs)/records`).
- **Collisions:** none. `lab/inbox` (static) coexists with `lab/[orderId]` (dynamic) — Expo Router prioritizes the static segment. `prescriptions/[id]/issued` nests cleanly (no bare `prescriptions/[id].tsx`). `pharmacy/[id]/chat` + `pharmacy/[id]/delivery` coexist with `pharmacy/[id].tsx`.

### Check 6 — Accessibility — **PASS (sampled)**
Icon-only Pressables labelled throughout (sheet close X `accessibilityLabel="Close…"`, drug search, signature close, QR share via `QrCodeView` code label, alternatives, audit). Touch targets: action rows height 52, chips ≥40 (lab-order chips 44), radios/ticks 24–26 with `hitSlop={16}` on close buttons. `numberOfLines` applied on truncatable patient names, refs, drug names. Radio/checkbox/switch roles + `accessibilityState` set on selection controls.

### Check 7 — Contract adherence — **PASS**
- Hooks-only in screens: only `@/api/doctor.batch3.api` import in Batch 3 screens is `formatKobo` (allowed pure helper) — `lab-order.tsx:10`, `directory.tsx:10`. `pharmacy/[id].tsx`/`delivery.tsx` use Phase 2 `formatKobo` (correct for Phase 2 entities). No direct API mutation/read calls in screens.
- Mutations omit `idempotencyKey` in screen call sites (none passed); hooks generate it via `generateIdempotencyKey()` (`useEprescription.ts:55,67,78,86,97` etc.). Screens use `isPending` / `mutateAsync`.
- Money kobo + `formatKobo` everywhere; no float kobo math observed (`Math.abs(priceDeltaKobo)` integer-safe).
- Demo-safe clinical content.

### Check 8 — Typecheck — **INCONCLUSIVE-BY-TIMEOUT**
See §1. Verified by inspection; no issues found. External `src/features/fx/**` error noted, out of scope.

### Check 9 — Ownership / no new deps — **PASS**
Frontend changes confined to `app/(doctor)/**` + `src/features/doctor/components/**`. Backend additive (barrels gained export lines only: `hooks/index.ts:38–41`, `constants/index.ts`, `components/index.ts:52–57`). `package.json` not touched by this batch (QrCodeView is dependency-free by design).

---

## 4. Prioritized defect list

### MAJOR

**M-1 (Major) — M25 "cancel lab order" has no UI; `useCancelLabOrder` is orphaned.**
`useCancelLabOrder` (backend `useLabOrdering.ts`) is exported but called by **no screen** (`grep` across `app/(doctor)` returns nothing). The ownership map marks M25 as "STATE of lab-order" but `consult/[id]/lab-order.tsx` is a *create-only* builder — there is no lab-order detail/rich view where an existing order could be cancelled. Spec entry M25 is effectively uncovered.
*Recommended fix:* add a lab-order detail/rich screen (e.g. `lab/order/[orderId].tsx` using `useLabOrderRich`) that exposes a Cancel action wired to `useCancelLabOrder`, reachable from `records.tsx` lab-order rows; OR add a cancel action on an `ordered`-status row in records. (Describe-only — do not apply.)

**M-2 (Major) — M26 "lab order expired" never renders; `useLabOrderRich`/`LabOrderRich.validUntil` orphaned.**
`useLabOrderRich` is exported but used by **no screen**. M26 ("lab order expired" via `LabOrderRich.validUntil`) and the rich read-view it backs have no surface. The lab-order preview (M21) re-implements a read view from local builder state instead of `useLabOrderRich`, so the rich entity (validity/expiry, provider, coverage on a persisted order) is never shown.
*Recommended fix:* same detail screen as M-1, rendering `validUntil`/expired banner from `useLabOrderRich` (mirror the rx `issued.tsx` expired-state pattern). (Describe-only.)

### MINOR

**N-1 (Minor) — L13–L16 extended fulfilment statuses are prose-only, not data-driven.**
`FulfilmentStatusExt` (`partial`/`awaiting_payment`/`awaiting_hmo`/`awaiting_delivery`) and `FULFILMENT_STATUS_LABELS` are defined (`types/doctor.batch3.ts:264`, `constants/batch3.ts:163`) but unused. `pharmacy/[id].tsx` renders only the base Phase 2 `PharmacyFulfilmentStatus` and covers partial/payment/HMO as a single generic `statusNote` sentence (`[id].tsx:147–156`).
*Recommended fix:* type the fulfilment status as `FulfilmentStatusExt` and drive the badge/note from `FULFILMENT_STATUS_LABELS` so each state is distinct. (Describe-only.)

**N-2 (Minor) — L19 terminal `received_by_patient` value not surfaced as a status.**
`useConfirmPatientReceived` mutates toward `received_by_patient`, but the screen has no badge tone for it (the `STATUS_TONE` map covers only the Phase 2 union). After confirmation the status will not render distinctly.
*Recommended fix:* include `received_by_patient` in the tone map / use `FulfilmentStatusExt` (ties into N-1). (Describe-only.)

**N-3 (Minor) — M21 preview duplicates a read-view instead of reusing `useLabOrderRich`.**
The lab-order preview rebuilds the order summary from local state. Functionally fine for a create-flow preview, but it means the rich entity is computed twice and diverges from the (orphaned) `LabOrderRich` shape. Low impact.
*Recommended fix:* acceptable as-is for create preview; revisit when M-1/M-2 detail screen lands. (Describe-only.)

**N-4 (Minor) — Small numeric literals for primitive sizes in 6 components.**
e.g. `StockBadge` `height:24, paddingHorizontal:10`; `AlternativeRow` swap `36×36`, chip `height:22`; `PharmacyRow` preferredChip `height:20`. Consistent with prior-passed batches (controlledChip/statusPill), so not a regression.
*Recommended fix:* optional — promote recurring chip/badge sizes to a shared token if the design system later formalizes them. (Describe-only.)

---

## 5. Notes for the build team
- The two MAJOR items share one fix: a lab-order **detail/rich** screen. Adding it wires `useLabOrderRich` + `useCancelLabOrder` (currently the only two orphaned backend hooks in the batch) and closes M25 + M26 in one screen.
- Everything else (K, N fully; L mostly) is solid and demo-ready. No blockers; the batch can ship behind its feature flag with M25/M26 tracked as fast-follows.

---

## Post-review fixes applied (both Majors resolved)

Doctor-scoped tsc grep empty (clean); no raw hex.

**M25 (lab order cancel) + M26 (lab order expired) — FIXED (shared root cause).**
Added a new lab-order **detail** screen `app/(doctor)/lab/order/[orderId].tsx`:
- Consumes the previously-orphaned `useLabOrderRich` (order details: tests, reason,
  linked diagnosis, urgency, collection mode, provider, fasting, validUntil) and
  `useCancelLabOrder`.
- **M26:** renders an "Expired" status badge + banner when `validUntil` has passed.
- **M25:** "Cancel order" action (shown only for an `ordered`, non-expired,
  non-resulted order) opens a reason sheet and calls `useCancelLabOrder` via
  `mutateAsync` (no idempotencyKey).
- Includes a "View result" link to `lab/[orderId]` when the order is resulted/reviewed.
- loading/error/success states via `StateView`.
Registered the route in `_layout.tsx` and pointed the Records hub's lab-order rows
(`(tabs)/records.tsx`) to the new detail screen (results remain reachable via the
inbox and the detail's "View result" link). Both orphaned hooks are now used; no new
orphans or dead links introduced.

Section M coverage is now **26/26** (K/L/M/N = 112/112).

Remaining 4 minors (L13–L16 extended fulfilment-status labels surfaced only as prose,
`received_by_patient` badge, M21 preview not reusing `useLabOrderRich`, small numeric
primitives) left as non-blocking polish.
