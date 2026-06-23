# QA Report — Doctor Phase 3 (Vet mode · AI assist · Analytics · Multi-clinic)

**Reviewer:** QA Agent (evidence-based pass, no feature-code edits)
**Date:** 2026-06-19
**Scope:** 10 screens / 11 route files, 6 new components, additive nav edits.
**Branch:** `feat/tiers-and-limits` (doctor tree untracked/new).

---

## Summary verdict: **PASS-WITH-NOTES**

| Severity | Count |
|----------|-------|
| Blocker  | 0 |
| Major    | 0 |
| Minor    | 4 |

- **`npx tsc --noEmit`: PASS (exit 0).**
- AI envelope contract (idle / generating / ready / error + model + disclaimer): **PASS** on all 3 AI screens.
- Navigation: **no orphans, no dead links, no Expo Router collision.**
- Dependencies: **none added** (package.json unchanged; BarRow/charts pure RN).

This is a clean, high-quality additive phase. The 4 minor items are polish, not
correctness, and none block merge.

---

## Check 1 — Reuse vs Duplication

### The 6 new components (PASS each)

| Component | Verdict | Justification (evidence) |
|-----------|---------|--------------------------|
| `AiPanel.tsx` | **PASS** | No existing component renders the AiEnvelope chrome (model tag + confidence + generating spinner + mandatory disclaimer footer). Composed by all 3 AI screens. (AiPanel.tsx:23-59) |
| `SeverityFinding.tsx` | **PASS** | Finding card = kind chip + severity `StatusBadge` + detail + implicated drugs + recommendation box. Reuses `StatusBadge` (SeverityFinding.tsx:7,28). No existing row composes this. |
| `BarRow.tsx` | **PASS** | Pure-RN labelled value bar series. No charting dep exists; nothing in the barrel renders a value series. (BarRow.tsx:21-40) |
| `PetHeader.tsx` | **PASS** | Paw-glyph identity header w/ species/breed/owner line. `DoctorAvatar` renders human initials only — genuinely distinct. (PetHeader.tsx:21-35) |
| `ClinicRow.tsx` | **PASS** | Membership row w/ active affordance + schedule + fee-share. `EditableListCard` is a generic edit/remove row without active/schedule. Reuses `StatusBadge`. (ClinicRow.tsx:8,38) |
| `PetProductTile.tsx` | **PASS** | Selectable product tile (swatch + price + vet-approved + checkbox). `LabTestRow` is text-only, no price/swatch. (PetProductTile.tsx:23-50) |

### 10 screens reuse the shared library — confirmed
Screens consistently reuse `StateView`, `StatCard`, `SectionCard`, `InfoRow`,
`ToggleRow`, `StatusBadge`, `SoapSection`, `LabTestRow`, `ChipMultiSelect`,
`RatingStars`, `TeleHeader`, `PrimaryButton`, `SelectField`:
- vet/index → `StatCard`, `SectionCard`, `StateView`, `ToggleRow`, `RatingStars` (vet/index.tsx:13-14)
- vet/pet/[id]/index → `SectionCard`, `InfoRow`, `StateView`, `PetHeader`, `StatusBadge` (index.tsx:12)
- vet/pet/[id]/prescription → `SectionCard`, `SoapSection`, `StatusBadge` (prescription.tsx:13)
- vet/pet/[id]/lab-order → `LabTestRow`, `SoapSection`, `SectionCard`, `StatusBadge` (lab-order.tsx:12)
- clinics → `ClinicRow`, `ChipMultiSelect`, `StateView` (clinics.tsx:12)

**Note (Minor #1):** `analytics/index.tsx` defines an inline `MetricTile`
(index.tsx:90-103). It is intentionally distinct from `StatCard` (carries
trend icon + delta %, different layout), so this is acceptable — not flagged as
a defect, recorded for awareness.

**Verdict: PASS.** No unjustified duplication of cards/rows/tiles/charts.

---

## Check 2 — Design-token compliance

- **Raw hex:** `NO RAW HEX` across all Phase 3 screens + the 6 components.
- **Raw `fontSize`:** none — all text uses `Typography.*` spreads.
- **Acceptable rgba overlays** (on-gradient text/icon scrims, modal backdrop):
  `rgba(255,255,255,0.18/0.8/0.85)` (vet/index.tsx:138,141,143; analytics
  index.tsx:114,117) and `rgba(11,28,48,0.4)` (clinics.tsx:123). These overlay
  gradients/backdrops where a flat token cannot express alpha — **acceptable**.
- **Magic token arithmetic (Minor #2):** `borderRadius: Radius.sm + 2`
  (PetProductTile.tsx:64). One occurrence; cosmetically fine but a literal
  `Radius.md` would be cleaner.

**Verdict: PASS (clean, 1 minor note).**

---

## Check 3 — Screen states

| # | Screen | loading | empty | error | success |
|---|--------|:------:|:-----:|:-----:|:-------:|
| 1 | vet/index | ✓ | ✓ (no consults) | ✓ | ✓ |
| 2 | vet/pet/[id]/index | ✓ | ✓ (per-section empties) | ✓ | ✓ |
| 3 | vet/pet/[id]/prescription | ✓ | N/A (form) | ✓ | ✓ |
| 4a | vet/pet/[id]/lab-order | ✓ | ✓ (existing-orders gated) | ✓ | ✓ |
| 4b | vet/lab-result/[orderId] | ✓ | ✓ (not-found undefined) | ✓ | ✓ |
| 5 | vet/pet-store | ✓ | ✓ (no products) | ✓ | ✓ |
| 6 | ai/note-summary | ✓ | idle CTA | ✓+retry | ✓ |
| 7 | ai/rx-safety | idle CTA | ✓ (no findings) | ✓+retry | ✓ |
| 8 | ai/lab-explanation | ✓ | idle CTA | ✓+retry | ✓ |
| 9 | analytics/index | ✓ | N/A (always populated) | ✓ | ✓ |
| 10 | clinics/index | ✓ | ✓ (no memberships) | ✓ | ✓ |

### AI envelope contract — EXPLICIT verification (all 3 AI screens: PASS)

| Requirement | note-summary | rx-safety | lab-explanation |
|-------------|:------------:|:---------:|:---------------:|
| idle + Generate affordance | ✓ (130 "Generate summary") | ✓ (110 "Run safety check") | ✓ (117 "Explain with AI") |
| generating = mutation `isPending` | ✓ (34) | ✓ (33) | ✓ (32) |
| ready: structured output rendered | ✓ SOAP+keyPoints (84-119) | ✓ verdict+findings (66-100) | ✓ headline+flags+followUps (59-107) |
| error + retry | ✓ (73-80) | ✓ (56-63) | ✓ (49-56) |
| model label on ready | ✓ | ✓ | ✓ |
| disclaimer on ready | ✓ | ✓ | ✓ |
| model + disclaimer on **all** states | ✓ | ✓ | ✓ |

`AiPanel` renders `model` + `disclaimer` unconditionally in every branch
(AiPanel.tsx:30,56), and each screen passes them to AiPanel in the idle,
generating, ready, AND error branches. Confidence + generatedAt render on ready
(AiPanel.tsx:32-34,45-49). **Full contract compliance.**

> Implementation detail (not a defect): note-summary & lab-explanation drive
> `generating`/`error` from the **mutation** (`generate`/`explain`), and use the
> read-hook envelope only to seed `model`/`disclaimer`/cached output — exactly as
> the contract's "generating = mutation isPending, ready = resolved envelope"
> mapping prescribes. rx-safety has no read hook (mutation-only) per the contract.

**Verdict: PASS.**

---

## Check 4 — Navigation flow

### Routes match the ownership map — ✓
All 11 route files map to the 10 proposed screens (screen 4 = create +
result split, as the map specifies).

### Registration & reachability — ✓ (no orphans)
Every Phase 3 route is registered in `_layout.tsx` (lines 71-85) AND has ≥1 caller:

| Registered route | Caller(s) | OK |
|------------------|-----------|:--:|
| vet/index | settings.tsx:109, (tabs)/index.tsx:120 → `/(doctor)/vet` | ✓ |
| vet/pet/[id]/index | vet/index.tsx:99 → `/vet/pet/${c.id}` | ✓ |
| vet/pet/[id]/prescription | pet/[id]/index.tsx:49 | ✓ |
| vet/pet/[id]/lab-order | pet/[id]/index.tsx:50 | ✓ |
| vet/lab-result/[orderId] | pet/[id]/lab-order.tsx:74 | ✓ |
| vet/pet-store | vet/index.tsx:81, pet/[id]/index.tsx:51 (`?petId=`) | ✓ |
| ai/note-summary | consult/[id]/notes.tsx:105 (`?appointmentId=`) | ✓ |
| ai/rx-safety | consult/[id]/prescription.tsx:83 (`?patientId=`), vet/pet/[id]/prescription.tsx:171 (`?petId=`) | ✓ |
| ai/lab-explanation | lab/[orderId].tsx:88, vet/lab-result/[orderId].tsx:91 (`?resultId=`) | ✓ |
| analytics/index | settings.tsx:111, (tabs)/index.tsx:127 | ✓ |
| clinics/index | settings.tsx:113 | ✓ |

### Dead-link check — ✓
Every `router.push` target across `app/(doctor)` resolves to an existing file.
No dangling targets.

### AI entry points added in the 3 consult artefacts — ✓
- `consult/[id]/notes.tsx:105` → `ai/note-summary?appointmentId=${appointmentId}` (param ✓, screen reads `appointmentId` note-summary.tsx:17)
- `consult/[id]/prescription.tsx:83` → `ai/rx-safety?patientId=...` (param ✓, screen reads `patientId` rx-safety.tsx:29)
- `lab/[orderId].tsx:88` → `ai/lab-explanation?resultId=${result.id}` (param ✓, screen reads `resultId` lab-explanation.tsx:24)

### Vet chain — ✓
entry (settings/dashboard) → vet dashboard → pet profile → rx / lab-order /
pet-store; lab-order → lab-result → `ai/lab-explanation`. Fully wired.

### Expo Router collision — ✓ NO COLLISION
`vet/pet/[id]/` is a **directory route** containing `index.tsx` + sibling
`prescription.tsx` + `lab-order.tsx`. There is **no** `vet/pet/[id].tsx` file,
so there is no file-vs-folder ambiguity. This is actually cleaner than the Phase 2
precedent (`pharmacy/[id].tsx` + `pharmacy/[id]/` coexist, which Expo treats as
index-file + children and resolved fine). The vet nesting mirrors Phase 1's
`consult/[id]/` folder pattern. `vet/lab-result/[orderId].tsx` is an unrelated
sibling segment — no overlap.

**Verdict: PASS.**

**Note (Minor #3):** `clinics/index` is reachable only from Settings, not the
dashboard tab (the dashboard Phase-3 row exposes only Vet + Analytics,
(tabs)/index.tsx:118-134). The ownership map says clinics is reached "from
Settings / Dashboard". Not an orphan (Settings entry exists), but the dashboard
shortcut promised by the map is absent. Low-priority gap.

---

## Check 5 — No new dependencies

- `package.json` / `package-lock.json`: **unchanged** (git shows no modification).
- BarRow + analytics charts are **pure RN `View`s** (BarRow.tsx, analytics
  completion bar index.tsx:77-82) — no charting library imported.
- Import sweep of the 6 components + analytics screen yields only pre-existing
  packages: `react`, `react-native`, `react-native-safe-area-context`,
  `expo-linear-gradient`, `lucide-react-native`, and internal `@/` aliases.

**Verdict: PASS.**

---

## Check 6 — Accessibility

- **Icon-only Pressables:** all carry `accessibilityRole="button"` +
  `accessibilityLabel`. Samples: vet/index store link & consult rows
  (vet/index.tsx:81,100-101); pet care links (pet/[id]/index.tsx:153);
  rx remove button w/ `hitSlop={8}` (prescription.tsx:118); clinics close-sheet
  `hitSlop={16}` (clinics.tsx:99); AI regenerate (note-summary.tsx:112).
- `PetProductTile` uses `accessibilityRole="checkbox"` +
  `accessibilityState={{ checked }}` (PetProductTile.tsx:28-29) — correct semantics.
- **`numberOfLines`** applied on truncatable text throughout (names, refs, metas).
- **Touch targets:** primary actions are ≥44–56px. The rx remove button is 36×36
  but `hitSlop={8}` → ~52px effective (OK).
- **AI = doctor-review drafts, not authoritative advice:** ✓ Every AI screen
  renders the not-medical-advice disclaimer in all states (AiPanel.tsx:54-57),
  uses "draft / for clinician review" copy (note-summary.tsx:95 "Review and edit
  the draft before accepting"; rx-safety verdict "Review before issuing"), and
  gates persistence behind explicit Accept actions. Strong compliance.

**Note (Minor #4):** Horizontal filter/period chips render at `height: 36`
without `hitSlop` (pet-store.tsx:130, analytics index.tsx:109) — below the 44px
target. Cosmetic-pill chips (keyChip 28, causeChip 26, drugChip) are
non-interactive display elements (OK). Recommend a small `hitSlop` on the 36px
interactive chips.

**Verdict: PASS (1 minor a11y note).**

---

## Check 7 — Contract adherence

- **Hooks-only consumption:** the only `from '@/api/doctor.phase3.api'` imports
  in `app/(doctor)` are **`formatKobo`** (vet/index.tsx:17, pet-store.tsx:15,
  analytics index.tsx:15) — explicitly allowed. No screen imports API read/write
  functions directly; all data flows through the documented hooks.
- **Idempotency:** no `idempotencyKey` appears in any screen input (the hooks
  inject it). The single grep hit is a comment in (tabs)/index.tsx:33.
- **Mutations use `isPending` / `mutateAsync`:** confirmed — e.g.
  `toggle.isPending` (vet/index.tsx:66), `create.mutateAsync` (prescription.tsx:82,
  lab-order.tsx:46), `setActive.isPending` (clinics.tsx:85),
  `check.mutate` (rx-safety.tsx:41).
- **Money:** kobo integers formatted via `formatKobo`
  (vet/index.tsx:76,121; pet-store.tsx:104; analytics index.tsx:73). **No float
  math** anywhere (no `parseFloat` / `toFixed` / `/100` / `*1.x`).

**Verdict: PASS.**

---

## Check 8 — Typecheck

```
$ npx tsc --noEmit
EXIT: 0
```

**Verdict: PASS.** (Note: `ClinicRow.feeSharePct` is fed from
`m.feeShareePct` (clinics.tsx:83) — the double-`e` spelling matches the type
field `feeShareePct` at doctor.phase3.ts:422, so it compiles. The spelling is a
backend-owned typo, out of Frontend's remit, and not a defect for this phase.)

---

## Check 9 — Ownership

- **Frontend touched only** `app/(doctor)/**` and
  `src/features/doctor/components/**` — confirmed (the doctor tree is a single
  untracked addition; no edits leaked into `src/types`, `src/api`,
  `src/constants`, or earlier-phase feature dirs by Frontend).
- **Backend additive:** `doctor.phase3.ts`, `doctor.phase3.api.ts`,
  `useVet/useAiAssist/usePractice.ts`, `constants/phase3.ts` are all new files;
  the hooks/constants barrels gained additive export lines only (barrel shows
  Phase 3 block appended after earlier phases).
- **QA owns** only this report.

**Verdict: PASS.**

---

## Prioritized defect list

### Blocker — none
### Major — none

### Minor
1. **Inline `MetricTile` in analytics** — `analytics/index.tsx:90-103`. Distinct
   from `StatCard` (trend + delta), so acceptable; consider extracting to the
   barrel if reused later. *Fix:* none required; optional future extraction.
2. **Token arithmetic** — `borderRadius: Radius.sm + 2`
   (`PetProductTile.tsx:64`). *Fix:* use `Radius.md` (or add a token) instead of
   `Radius.sm + 2`.
3. **Clinics not on dashboard tab** — ownership map lists clinics reachable from
   "Settings / Dashboard"; only the Settings entry exists
   (`(tabs)/index.tsx:118-134` exposes Vet + Analytics only). *Fix:* add a third
   Phase-3 dashboard shortcut to `/(doctor)/clinics`, or amend the map to
   "Settings only".
4. **Interactive 36px chips lack hitSlop** — `pet-store.tsx:130`,
   `analytics/index.tsx:109` filter/period chips are below the 44px target.
   *Fix:* add `hitSlop={6}`–`8` (or raise height to 44) on the chip Pressables.

---

## New design-doc-vs-codebase conflicts

- **rx-safety query param:** the ownership map lists `ai/rx-safety` with **no**
  query param, but the screen accepts `?petId=` / `?patientId=` and both callers
  pass one (consult/[id]/prescription.tsx:83, vet/pet/[id]/prescription.tsx:171).
  This is a sensible extension (the safety check needs patient context) and is
  internally consistent — recorded as a **doc gap**, not a defect. Recommend
  updating the map to document the `?petId=` / `?patientId=` params.
- **Clinics dashboard entry** (Minor #3 above) — map says Dashboard, code uses
  Settings only.

No other conflicts beyond those already logged in prior phases.
