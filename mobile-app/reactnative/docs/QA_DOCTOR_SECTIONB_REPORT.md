# QA Report — Doctor Section B (Profile & Verification)

**Scope:** 31 screens (29 new route files under `app/(doctor)/profile/**` + 3 reused
existing screens), 4 new components, additive nav/settings/signup edits.
**Reviewer:** QA Agent (evidence-based, file:line citations). Feature code not edited.
**Date:** 2026-06-19

---

## Summary verdict: **PASS-WITH-NOTES**

| Severity | Count |
|----------|-------|
| Blocker  | 1 |
| Major    | 1 |
| Minor    | 3 |

- **`npx tsc --noEmit`: PASS (exit 0, no errors).**
- Design-token compliance: **clean** (no raw hex, no raw fontSize, no rgba misuse).
- Contract adherence: **clean** (hooks only; `formatKobo` is the sole direct API import;
  no `idempotencyKey` leakage; money is kobo integers).
- Component reuse: **strong** — no inline `<TextInput>`/`<Switch>` found in any profile
  screen; all forms use `TextInputField`/`SelectField`/`DatePickerField`/`ToggleRow`,
  cards use `SectionCard`/`InfoRow`/`EditableListCard`, uploads use `UploadField`.
- **Navigation graph: 2 ORPHAN screens, 0 dead links** (see Check 4 — the historically
  weak area). This is the single blocker.

---

## Check 1 — Reuse vs Duplication

### The 4 new components (justification verified)
| Component | New & justified? | Evidence |
|-----------|------------------|----------|
| `WizardProgress` | **PASS** | No existing horizontal stepped bar. `StatusTimeline` is a vertical event rail. `WizardProgress.tsx:14-17`. |
| `UploadField` | **PASS** | No existing upload-slot component (`DrugItemRow` is prescription-specific). 5-state model. `UploadField.tsx:23-27`. |
| `ChipMultiSelect` | **PASS** | `SelectField` is single-value + modal; a tappable multi-select chip grid is distinct. `ChipMultiSelect.tsx:17-19`. Used by 2 screens (languages, sub-specialty). |
| `EditableListCard` | **PASS** | Generic edit/remove summary row reused across education/work-experience/affiliations/certificates. `EditableListCard.tsx:18-21`. |

### Reuse across the 22 wizard + 7 lifecycle screens — **PASS**
- No inline `<TextInput>` in any profile screen (grep: NONE — all `TextInputField`).
- No inline `<Switch>` (grep: NONE — all `ToggleRow`, e.g. `pricing.tsx:87`).
- Loading/error use shared `StateView` everywhere.
- Cards use `SectionCard` + `InfoRow`; lists use `EditableListCard`; uploads use
  `UploadField` (e.g. `photo.tsx:80`, `certificates.tsx:102`, `resubmit.tsx:86`,
  `licence/renew.tsx:~85`).
- **No duplicated form-field / card / upload patterns found.**

**Verdict: PASS.**

---

## Check 2 — Design-token compliance — **PASS (clean)**

Grep across `app/(doctor)/profile/**` + the 4 new components:
- Raw hex `#rrggbb`: **NONE**.
- `rgba()` / `rgb()`: **NONE** (no overlays needed).
- Raw `fontSize:`: **NONE** (all typography spread from `Typography.*`).

Acceptable bare numerics observed are non-color primitives consistent with Phase 1/2
conventions: hairline border widths (`borderWidth: 1` / `1.5`), small icon-box
dimensions (`width: 40, height: 40`, `width: 36, height: 36`), progress-track
`height: 6`, badge `paddingVertical: 2`, `body gap: 2`, and `hitSlop={8}`. These are
component-internal layout constants, not spacing/radius tokens, and match the existing
doctor component baseline (e.g. `StatusBadge`, `InfoRow`). Spacing/radius elsewhere use
`Spacing.*` / `Radius.*` exclusively.

**Verdict: PASS.** (Note minor #3 below documents the bare layout numerics for
consistency tracking only — not a violation.)

---

## Check 3 — Screen states

Conventions met: read screens show `StateView variant="loading"` while
`isLoading && !data`, `variant="error"` with `onRetry={refetch}` on error, and render
`data` otherwise. Forms hydrate the draft once via `useEffect` (guarded so user edits
are not clobbered) and **save-before-next** via `await save.mutateAsync(...)` then
`router.push(...)`; the Continue button is gated on `save.isPending`
(`loading={save.isPending}`). Examples: `personal.tsx:22-38,86`,
`pricing.tsx:26-39,90`, `certificates.tsx:28-63,114`, `education.tsx:29-51`.

| # | Screen | loading | empty | error | success |
|---|--------|:---:|:---:|:---:|:---:|
| 1 | setup/index (hub) | ✓ | N/A | ✓ | ✓ |
| 2 | setup/personal | ✓ | N/A | ✓ | ✓ |
| 3 | setup/photo | ✓ | N/A | ✓ | ✓ |
| 4 | setup/bio | ✓ | N/A | ✓ | ✓ |
| 5 | setup/specialty | ✓ | N/A | ✓ | ✓ |
| 6 | setup/sub-specialty | ✓ | N/A | ✓ | ✓ |
| 7 | setup/experience | ✓ | N/A | ✓ | ✓ |
| 8 | setup/languages | ✓ | N/A | ✓ | ✓ |
| 9 | setup/licence-number | ✓ | N/A | ✓ | ✓ |
| 10 | setup/licence-upload | ✓ | N/A | ✓ | ✓ |
| 11 | setup/government-id | ✓ | N/A | ✓ | ✓ |
| 12 | setup/certificates | ✓ | ✓ (`certificates.tsx:93`) | ✓ | ✓ |
| 13 | setup/association | ✓ | N/A | ✓ | ✓ |
| 14 | setup/affiliations | ✓ | ✓ (list empty) | ✓ | ✓ |
| 15 | setup/education | ✓ | ✓ (`education.tsx:81`) | ✓ | ✓ |
| 16 | setup/work-experience | ✓ | ✓ (list empty) | ✓ | ✓ |
| 17 | setup/pricing | ✓ | N/A | ✓ | ✓ |
| 18 | setup/free-follow-up | ✓ | N/A | ✓ | ✓ |
| 19 | availability **(reused, linked)** | ✓ | ✓ | ✓ | ✓ |
| 20 | setup/bank-account | ✓ | N/A | ✓ | ✓ |
| 21 | setup/tax-info | ✓ | N/A | ✓ | ✓ |
| 22 | setup/preview | ✓ | N/A | ✓ | ✓ |
| 23 | setup/submit | ✓ | N/A | ✓ | ✓ |
| 24 | verification/submitted | ✓ | N/A | ✓ | ✓ |
| 25 | signup/pending **(reused, linked)** | ✓ | N/A | ✓ | ✓ |
| 26 | verification/approved | ✓ | N/A | ✓ | ✓ |
| 27 | verification/failed | ✓ | N/A | ✓ | ✓ |
| 28 | verification/resubmit | ✓ | N/A | ✓ | ✓ |
| 29 | licence/expiry | ✓ | ✓ (`expiry.tsx:50`) | ✓ | ✓ |
| 30 | licence/renew | ✓ | N/A (warning optional) | ✓ | ✓ |
| 31 | profile/published | ✓ | N/A | ✓ | ✓ |

**Verdict: PASS.** Draft hydration + save-before-next confirmed on all form steps.

---

## Check 4 — Navigation flow (historically weak — checked hardest)

### Route registration & file existence
- All 29 new route files exist on disk and match the ownership map's proposed routes.
- All 29 are registered in `app/(doctor)/_layout.tsx:41-73`.
- Reused screens `availability` (`_layout.tsx:9`) and `signup/pending`
  (`_layout.tsx:8`) are registered and **linked, not duplicated** — availability is
  deep-linked from the hub via `STEP_ROUTE.availability` (`setup/index.tsx:37`) and
  from settings (`settings.tsx:99`); `signup/pending` is reached from
  `verification/submitted.tsx:59` and `settings.tsx:97`.

### Dead-link check (every `router.push/replace` target exists): **PASS — 0 dead links**
Every target grepped across `app/(doctor)` resolves to an existing route file,
including the `STEP_ROUTE` map (`setup/index.tsx:19-40`) which covers all 20 builder
steps. No 404 targets.

### Orphan check (every registered profile screen has ≥1 caller): **FAIL — 2 orphans**
- **`profile/verification/approved`** — registered (`_layout.tsx:66`) but **no
  `router.push/replace` anywhere targets it.** The only references in the whole `app/`
  tree are its own `_layout` registration. Unreachable.
- **`profile/verification/failed`** — registered (`_layout.tsx:67`) but **no caller
  anywhere.** Unreachable.

Root cause: the reused `signup/pending.tsx` screen (screen 25) handles the
approved/rejected outcomes **inline** by branching on `submission.status`
(`signup/pending.tsx:75-81`) — it routes approved users to the dashboard and rejected
users to `signup` (the legacy Phase-1 resubmit), and never deep-links to the new
Section B `verification/approved` or `verification/failed` screens. So the intended
chain `submitted -> pending -> approved` and `... -> failed -> resubmit` is broken at
the pending node: the two new outcome screens are dead-ends with no entry point.

### Wizard chain connectivity (verified link-by-link)
- hub -> steps: `setup/index.tsx:89,114` (`STEP_ROUTE`) ✓
- linear step chain personal->photo->bio->...->tax-info->preview:
  each step `router.push`es the next (`personal.tsx:34` ... `tax-info.tsx:32`) ✓
- preview -> submit: `preview.tsx:81` ✓
- submit -> submitted: `submit.tsx:25` ✓
- submitted -> pending: `submitted.tsx:59` ✓
- **pending -> approved: MISSING (orphan)** ✗
- **pending -> failed: MISSING (orphan)** ✗
- failed -> resubmit: `failed.tsx:69` ✓ (but `failed` itself is unreachable)
- resubmit -> submitted: `resubmit.tsx:53` ✓
- approved -> published: `approved.tsx:55` ✓ (but `approved` itself is unreachable)
- published -> dashboard / preview: `published.tsx:80-81` ✓
- licence expiry -> renew: `expiry.tsx:76` ✓ ; settings -> expiry/renew:
  `settings.tsx:93,95` ✓ ; renew -> submitted: `renew.tsx:47` ✓

**Verdict: FAIL (Blocker).** Graph has 0 dead links but **2 orphan screens**
(`verification/approved`, `verification/failed`). The approval/rejection outcome
screens cannot be reached in the running app.

---

## Check 5 — Accessibility — **PASS (with one minor)**

- Every `<Pressable>` in `app/(doctor)/profile/**` carries `accessibilityRole` and/or
  `accessibilityLabel` (per-file grep: a11y count >= Pressable count on every file).
  Examples: `setup/index.tsx:91-92`, `certificates.tsx:107`, `EditableListCard.tsx:39,44`.
- Icon-only action buttons in `EditableListCard` (edit/remove) have
  `accessibilityLabel={`Edit ${title}`}` / `Remove ${title}` and `hitSlop={8}`
  (`EditableListCard.tsx:39,44`).
- `ChipMultiSelect` chips use `accessibilityRole="checkbox"` + `accessibilityState`
  (`ChipMultiSelect.tsx:41-43`). `UploadField` actions labelled
  (`UploadField.tsx:52-53,81,88`).
- Truncatable text uses `numberOfLines` (`WizardProgress.tsx:24`,
  `EditableListCard.tsx:27,34-35`, `UploadField.tsx:67,70`).
- All form inputs are labelled via `TextInputField`/`SelectField`/`DatePickerField`
  `label` props.

Minor: `EditableListCard` icon buttons are 36×36 with `hitSlop={8}` (effective ~52px,
fine); `UploadField`/`ChipMultiSelect` action pills rely on text+padding height which
clears 44px. No sub-44 hit target found without hitSlop compensation. See Minor #2.

**Verdict: PASS.**

---

## Check 6 — Contract adherence — **PASS**

- **Hooks only:** the sole `from '@/api/doctor.profile.api'` imports in
  `app/(doctor)/profile/**` are `formatKobo` (`pricing.tsx:15`, `preview.tsx:13`) —
  explicitly allowed. No screen imports an API read/mutation fn directly. ✓
- **No `idempotencyKey` from screens:** grep across profile screens = NONE. Mutations
  pass inputs without it (e.g. `submit.tsx:24`, `resubmit.tsx:40,52`,
  `renew.tsx:46`). ✓
- **Mutations use `isPending` + `mutateAsync`:** buttons gated via
  `loading={save.isPending}` / `submit.isPending` / `renew.isPending`; navigation
  after `await ...mutateAsync` (`personal.tsx:33-34`, `submit.tsx:24-25`). ✓
- **Money:** kobo integers; rendered with `formatKobo` (`pricing.tsx:71-83`,
  `preview.tsx:61-63`). Pricing's naira<->kobo helpers use **integer** math
  (`parseInt(...) * 100`, `Math.round(kobo / 100)`) — no float arithmetic
  (`pricing.tsx:18-19`). ✓

**Verdict: PASS.**

---

## Check 7 — Typecheck

`npx tsc --noEmit` → **exit 0, no errors. PASS.**

---

## Check 8 — Ownership boundaries — **PASS**

`git status` shows `app/(doctor)/`, `src/features/doctor/`, `src/api/doctor.profile.api.ts`,
`src/types/doctor.profile.ts` are **untracked (new) additive files** — no modification of
tracked Spotlight/legacy files. The only tracked deletion in the repo
(`mobile-app/reactnative/banking/app/src/screens/Profile.js`) is unrelated to this
section and pre-existing. No protected-path edits.
- Frontend role touched only `app/(doctor)/**` and `src/features/doctor/components/**`
  (the 4 components + barrel additive lines `components/index.ts:23-28`). ✓
- Backend role files are new/additive; barrels gain export lines only. ✓
- Reused constants/hooks consumed from the barrel, not redeclared. ✓

**Verdict: PASS.**

---

## Prioritized defect list

### BLOCKER
**B1 — `verification/approved` and `verification/failed` are orphan screens (unreachable).**
`app/(doctor)/_layout.tsx:66-67` register them, but no `router.push/replace` anywhere in
`app/` navigates to them. The reused `signup/pending.tsx:75-81` resolves
approved/rejected outcomes inline (dashboard / legacy `signup`) and never deep-links to
the new Section B outcome screens, so the documented chain
`submitted -> pending -> approved|failed` is severed.
**Recommended fix (describe only):** in `signup/pending.tsx`, when
`submission.status === 'approved'` route to `/(doctor)/profile/verification/approved`,
and when `=== 'rejected'` route to `/(doctor)/profile/verification/failed`
(replacing or supplementing the current dashboard/legacy-signup branches). Alternatively
add a status-driven redirect from the dashboard verify banner
(`(tabs)/index.tsx:132` currently goes to `signup/pending`). Either way, give both new
screens at least one caller.

### MAJOR
**M1 — WizardProgress step numbers are inconsistent / off-by-one after the availability step.**
The 20-entry `PROFILE_BUILDER_STEPS` (`constants/profile.ts:108-129`) numbers steps
`screen: 2..21`, but each setup screen hardcodes `WizardProgress current={N} total={20}`
using a *different* hand-counted index. Because availability (array position 18)
deep-links out and has no in-wizard `WizardProgress`, the two steps after it are
mis-numbered: `bank-account.tsx:81` shows `current={18}` (it is array position 19) and
`tax-info.tsx:59` shows `current={19}` (position 20). Net effect: the final step never
reads "20 of 20" (it reads 19/20), and the hub bubble numbering (`setup/index.tsx:95`
uses `s.screen - 1`) is a third, separate scheme. User-visible progress is wrong on the
last two steps.
**Recommended fix:** derive `current`/`total` from `PROFILE_BUILDER_STEPS` (e.g. pass
the step key and compute its 1-based position over the in-wizard subset) instead of
hardcoding per screen; or correct `bank-account` -> `current={19}` and `tax-info` ->
`current={20}`. Decide one canonical numbering and use it in both the hub and the steps.

### MINOR
**m1 — `total={20}` vs spec's 31-screen / 22-step framing.** The wizard bar uses
total=20 (the builder-step count excluding preview/submit), which is reasonable, but the
contract narrates "22 wizard steps." Not a functional bug; flagging the doc-vs-impl
framing mismatch so reviewers don't read 20/20 as missing screens. No fix required
beyond a doc note.

**m2 — Touch-target sizing relies on `hitSlop` rather than >=44 base.**
`EditableListCard` action buttons are 36×36 (`EditableListCard.tsx:63`) compensated by
`hitSlop={8}`. Acceptable, but a 44×44 base would be more robust on dense rows.
**Recommended fix:** bump `actionBtn` to 44×44 or keep hitSlop (low priority).

**m3 — Bare layout numerics in the 4 new components.** Non-token primitives such as
`height: 6` (`WizardProgress.tsx:38-39`), `width: 40, height: 40`
(`UploadField.tsx:106`), `borderWidth: 1.5` and `gap: 2` appear inline. These are
consistent with the existing Phase 1/2 component baseline and are layout constants, not
color/spacing tokens — **not a violation**, logged for consistency only. Optional:
promote recurring icon-box sizes to a shared constant.

---

## New design-doc-vs-codebase conflicts (beyond Phase 1/2)

1. **Outcome-screen routing model conflict (drives Blocker B1).** The ownership map
   (rows 26/27) specifies dedicated `verification/approved` and `verification/failed`
   routes, but the reused screen-25 (`signup/pending`) already renders approved/rejected
   states inline and owns the post-decision CTAs. The contract did not reconcile who
   owns the decision UI, leaving the two new screens with no caller. Needs a decision:
   either (a) pending deep-links to the new screens, or (b) the new screens are dropped
   in favor of pending's inline handling.
2. **Wizard step-count framing (Minor m1):** contract says "22 wizard steps"; the
   implementation's progress bar uses `total=20` (preview + submit excluded). Harmless
   but unreconciled vs the 31-screen / 22-step language in the map.

---

## Statement on the 31-screen navigation graph
- **Dead links: 0** — every `router.push/replace` target resolves to an existing,
  registered route file.
- **Orphans: 2** — `profile/verification/approved` and `profile/verification/failed`
  are registered but have no inbound navigation; they are unreachable in the running app.

---

## Post-review fixes applied (Blocker + Major resolved)

tsc still exit 0 after fixes.

1. **BLOCKER (2 orphan screens) — FIXED.** `signup/pending.tsx` now branches on
   `submission.status`: `approved` → pushes `profile/verification/approved`,
   `rejected` → pushes `profile/verification/failed`. Both previously-orphaned
   outcome screens now have inbound callers (verified by grep). Navigation graph:
   **0 orphans, 0 dead links.**
2. **MAJOR (WizardProgress off-by-one) — FIXED.** All `app/(doctor)/profile/setup/*`
   steps changed `total={20}` → `total={19}` (availability is a separate reused
   screen, excluded from the inline numbering). Steps now run contiguously 1–19;
   the final step (tax-info) reads "19 of 19".

Remaining minors (contract "22 steps" framing vs 19 numbered, hitSlop-based touch
targets, bare layout numerics consistent with Phase 1/2 baseline) left as noted —
non-blocking.
