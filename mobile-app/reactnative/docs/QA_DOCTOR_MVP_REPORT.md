# QA Report — Doctor MVP (Core 18 Screens)

**Reviewer:** QA role
**Date:** 2026-06-18
**Scope:** `app/(doctor)/**`, `src/features/doctor/components/**`, against backend
contract (`src/types/doctor.ts`, `src/api/doctor.api.ts`, hooks/constants),
ownership map, API contract, and `DESIGN-Mobile.md` + design tokens.
**Method:** Static review only. No feature code modified.

---

## Summary verdict: **PASS WITH NOTES**

The Frontend delivery is high quality: every screen consumes hooks (not the API
directly), uses design tokens consistently, wires all four screen states, reuses
shared and telemedicine components correctly, and `npx tsc --noEmit` passes
clean. Two screens (#8 Call, #14 HMO) are built and route-registered but have **no
navigation entry point**, and there is a **patient-id-used-as-appointment-id**
routing defect that breaks the appointment->consult flow with real data.

| Category | Count |
|----------|-------|
| Blockers | 0 |
| Majors   | 3 |
| Minors   | 7 |
| Notes    | several (see sections) |

- **Reuse vs duplication:** 12/12 PASS (no duplication found)
- **Design-token compliance:** PASS (1 minor justified fontSize override; rgba overlays acceptable)
- **Screen states:** 18/18 wired (a few N/A for empty where data is a single object)
- **Navigation:** 2 orphaned screens (Major), 1 wrong-id routing (Major)
- **Accessibility:** PASS with notes (back button missing label = Minor)
- **Contract adherence:** PASS
- **Typecheck:** PASS (exit 0)
- **Ownership:** PASS (no boundary crossings in scope)

---

## 1. Reuse vs Duplication — PASS (12/12)

Each new component in `src/features/doctor/components/` was checked against
`src/components/` and `src/features/telemedicine/components/`. No existing
component duplicates the job. There is **no** pre-existing `AppointmentRow`,
`StateView`/`EmptyState`, `MessageBubble`, key/value row, stat tile, toggle row,
multiline note field, drug row, lab-test row, or notification row anywhere in the
shared trees (verified via `find`/`grep`).

| Component | Verdict | Evidence |
|-----------|---------|----------|
| `StateView.tsx` | PASS | Only `PrimaryButton.tsx` uses `ActivityIndicator` in `src/components`; no combined loading/error/empty exists. Reuses `PrimaryButton` for retry (`StateView.tsx:38`). |
| `StatCard.tsx` | PASS | `BalanceCard`/`RecentActivityCard` are wallet-shaped; no icon+label+value tile exists. |
| `SectionCard.tsx` | PASS | No titled surface-card wrapper in shared. |
| `InfoRow.tsx` | PASS | No shared key/value row. |
| `AppointmentRow.tsx` | PASS | No `AppointmentRow` exists elsewhere; correctly reuses `DoctorAvatar` + `ConsultStatusBadge` from telemedicine (`AppointmentRow.tsx:10,46`). |
| `MessageBubble.tsx` | PASS | No reusable bubble component in shared/telemedicine. |
| `ChatComposer.tsx` | PASS | `TextInputField` is labelled single-line (56px); does not fit an inline composer. |
| `SoapSection.tsx` | PASS | `TextInputField` has fixed `height: 56` and no multiline (`TextInputField.tsx:75`); justified. |
| `ToggleRow.tsx` | PASS | `ProfileMenuItem` is a chevron nav row, no `Switch`. |
| `DrugItemRow.tsx` | PASS | Composes shared `SelectField` + `TextInputField` internally (`DrugItemRow.tsx:9-10`) — exemplary reuse. |
| `LabTestRow.tsx` | PASS | No selectable catalogue row exists. |
| `NotificationRow.tsx` | PASS | `RecentActivityCard` is transaction-shaped; distinct. |

**Screens reuse shared components rather than re-implementing:** confirmed.
Screens import `PrimaryButton`, `TextInputField`, `SelectField`,
`SectionHeader`, `ProfileMenuItem` (shared) and `TeleHeader`, `DoctorAvatar`,
`RatingStars`, `ConsultStatusBadge` (telemedicine) instead of inline copies.

> NOTE (Minor): Screens do **not** reuse the shared `AppHeader` for top bars;
> tab screens hand-roll a header `<View>` (e.g. `appointments.tsx:38-40`,
> `index.tsx:54-77`). This is acceptable — `AppHeader` hardcodes patient routes
> (`router.push('/(tabs)/profile')`, `'/(tabs)/notifications')`,
> `AppHeader.tsx:28,44`) that would mis-navigate in the doctor area, so avoiding
> it is the correct call. No action required; documented for completeness.

---

## 2. Design-Token Compliance — PASS

- **Raw hex (`#...`):** none in `app/(doctor)` or doctor components. Clean.
- **Raw `fontSize` literals:** one occurrence —
  `earnings.tsx:126` `balanceValue: { ...Typography.displayLg, fontSize: 36, lineHeight: 44, ... }`.
  This intentionally shrinks `displayLg` (48px) for the hero balance. NOTE
  (Minor): a token-sized step (e.g. `headlineLg` 32 or `headlineMd` 24) would be
  more compliant; the 36/44 override is a deliberate one-off, low risk.
- **Inline `rgba(...)`:** all occurrences are white-on-gradient overlay tints on
  the purple gradient hero/call surfaces (`index.tsx:167,169`,
  `earnings.tsx:125`, `call.tsx:120-133`, `_layout.tsx:74` glass tab bar) plus
  `MessageBubble.tsx:50` (`rgba(255,255,255,0.75)` timestamp on the purple
  bubble). These match the existing accepted gradient/glass pattern
  (`Colors.gradientPurple`, `TeleHeader` uses `rgba(248,249,255,0.92)`). **Not
  violations.**
- **Magic spacing numbers:** the `gap`/`padding` values flagged by grep are all
  small sub-token cosmetic values (`gap: 2`, `gap: 3`, `gap: 4`, `gap: 6`,
  `paddingHorizontal: 8/10/12`, `height: 22/26/28/30/34` for pills/chips). These
  are consistent with the rest of the codebase (the same 2/4/6 gaps appear in the
  telemedicine components) and there is no `Spacing` token below `xs` (4) for the
  2/3 px values. NOTE (Minor): pill/chip heights (22, 26, 28, 30, 34) and chip
  horizontal padding (8/10/12) are ad-hoc rather than tokenized — consider a
  shared `Chip`/`StatusPill` later. Not blocking.

---

## 3. Screen States — 18/18 wired

Legend: OK handled - N/A not applicable - "—" not present.
"Empty N/A" = the read returns a single object (profile/settings/session/
eligibility/result), so list-empty does not apply; missing-object is folded into
the error branch via `|| !data`.

| # | Screen | Loading | Empty | Error | Success |
|---|--------|:------:|:-----:|:-----:|:-------:|
| 1 | signup/index | N/A (form) | N/A | — (mutation only) | OK |
| 2 | signup/pending | OK `:35` | N/A (object) | OK `:37` | OK |
| 3 | (tabs)/index dashboard | OK `:39` | OK queue empty `:122` | OK `:47` | OK |
| 4 | availability | OK `:45` | N/A (object) | OK `:54` | OK |
| 5 | (tabs)/appointments | OK `:57` | OK `:62` | OK `:59` | OK |
| 6 | patient/[id] | OK `:24` | N/A (object) | OK `:26` | OK |
| 7 | consult/chat | OK `:51` | OK `:60` | OK `:53` | OK |
| 8 | consult/call | — (see note) | N/A | — | OK |
| 9 | consult/notes | OK `:60` | N/A (object) | OK `:62` | OK |
| 10 | consult/prescription | N/A (form) | N/A | — (mutation) | OK |
| 11 | prescriptions/index | OK `:28` | OK `:37` | OK `:30` | OK |
| 12 | consult/lab-order | N/A (form) | N/A | — (mutation) | OK |
| 13 | lab/[orderId] | OK `:46` | N/A (object) | OK `:48` | OK |
| 14 | consult/hmo | OK `:33` | N/A (object) | OK `:35` | OK |
| 15 | (tabs)/earnings | OK `:43` | OK payouts `:91` | OK `:50` | OK |
| 16 | notifications | OK `:29` | OK `:39` | OK `:31` | OK |
| 17 | support | OK `:74` | OK `:80` | OK `:76` | OK |
| 18 | settings | OK `:27` | N/A (object) | OK `:36` | OK |

NOTE (Minor): **Call screen (#8) `call.tsx`** uses `useCallSession` but does not
gate on `isLoading`/`isError`; it renders a `Loader` placeholder while
`session` is undefined (`call.tsx:67-71`). Acceptable for a live-call UX, but it
diverges from the StateView pattern used everywhere else and will not show a
retry path if the session read fails. Records tab (#11 hub portion) shows a
`Loading...`/count string for prescriptions inline (`records.tsx:51`) rather than
a spinner — fine.

---

## 4. Navigation Flow — PASS WITH MAJORS

**Tabs:** 5 tabs match the ownership map exactly (Dashboard, Appointments,
Messages, Records, Earnings) — `(tabs)/_layout.tsx:33-65`. OK

**Routes vs ownership map:** all 18 route files exist at the mapped paths and all
18 are registered in `app/(doctor)/_layout.tsx` and the `(doctor)` group is
registered in `app/_layout.tsx:52`. OK

**Back navigation:** every stack screen renders `TeleHeader`, which provides a
back button (`TeleHeader.tsx:16`). OK Tab screens correctly omit back nav.

**Wired links verified (target files all exist):** dashboard quick actions ->
availability/prescriptions/records/settings (`index.tsx:112-115`); dashboard
queue & "see all" -> appointments (`index.tsx:119,125`); messages thread -> chat
(`messages.tsx:47`); records -> prescriptions & lab result (`records.tsx:37,75`);
notes -> prescription & lab-order (`notes.tsx:95,99`); notifications -> tabs by
type (`notifications.tsx:17-21`); settings -> pending/availability/support
(`settings.tsx:89-93`). All targets resolve.

### MAJOR 4a — Patient id used as appointment/consult id
`patient/[id].tsx:106`:
`router.push('/(doctor)/consult/${profile.patient.id}/notes')` passes the
**patient id** into the `[id]` slot that every consult screen treats as the
**appointment id** (`notes.tsx:18` `const appointmentId = String(id)` ->
`useSoapNote(appointmentId)`, `useAppointment(appointmentId)`). With demo data
this silently no-ops (hooks tolerate unknown ids), but with live data the SOAP
note, prescription, lab-order, chat, and call screens will all query the wrong
key. The appointment->consult linkage is therefore broken.
Recommended fix: route appointment/patient screens to consult flows using the
**appointment id** (e.g. pass `appointment.id`), not `patient.id`.

### MAJOR 4b — Call screen (#8) is unreachable
`consult/[id]/call.tsx` is registered (`_layout.tsx:12`) but **no**
`router.push`/`replace` anywhere targets `/call` (grep across `app/` finds only
the Stack.Screen registration). A doctor can never start an audio/video consult.
Recommended fix: add an entry point — e.g. a "Start consult" action on
`AppointmentRow`/appointments screen or patient profile that pushes
`/(doctor)/consult/${appointment.id}/call`.

### MAJOR 4c — HMO eligibility screen (#14) is unreachable
`consult/[id]/hmo.tsx` is registered (`_layout.tsx:16`) but **no** navigation
targets `/hmo` (grep finds only the registration). The screen renders correctly
but is dead. Recommended fix: link it from the consult notes screen and/or from
`AppointmentRow` when `appointment.isHmo` is true (the HMO tag already renders at
`AppointmentRow.tsx:42`).

> NOTE: appointment rows route to `patient/[id]` (`appointments.tsx:66`,
> `index.tsx:125`). The ownership map says appointment -> "patient/consult"; the
> patient half is wired, but there is no path from an appointment to a *consult*
> action (chat/call/notes) except indirectly via the broken 4a link. Combined
> with 4b/4c this leaves the consult flow only reachable from the Messages tab
> (chat) and from inside notes. Consider an action sheet on the appointment row.

---

## 5. Accessibility — PASS WITH NOTES

- **Icon-only Pressables labelled:** dashboard bell (`index.tsx:64-67`), chat
  composer attach/send (`ChatComposer.tsx:33-37,52-55`), notes/chat header
  buttons (`chat.tsx:42-46`), drug remove (`DrugItemRow.tsx:38-43`), call
  controls + end-call (`call.tsx:91-96,107-113`). OK
- **Touch targets >=44:** composer buttons 44x44, dashboard bell 44x44, call
  controls 56/64, lab/doc rows `minHeight: 56`, checkboxes sit inside >=44 rows.
  OK Exceptions (Minor): `DrugItemRow` remove button is 36x36
  (`DrugItemRow.tsx:84`) but has `hitSlop={8}` -> effective 52, OK; `TeleHeader`
  back/icon buttons are 40x40 (`TeleHeader.tsx` `iconBtn`) — slightly under 44.
- **`numberOfLines` on truncatable text:** widely applied (names, metas,
  previews). OK
- **Roles/state on toggles & checkboxes:** `ToggleRow` has
  `accessibilityRole="switch"` (`ToggleRow.tsx:46`); doc/diagnosis/lab/test rows
  use `accessibilityRole="checkbox"` + `accessibilityState={{checked}}`
  (`signup/index.tsx:83-85`, `notes.tsx:88-90`, `LabTestRow.tsx:25-27`). OK
- **Contrast / on* pairs:** text uses `onSurface`/`onSurfaceVariant`/`onPrimary`
  consistently against their surfaces. OK

### MINOR 5a — `TeleHeader` back button has no accessibility label/role
`TeleHeader.tsx:16` renders the back `Pressable` with no `accessibilityLabel`
or `accessibilityRole="button"`. Every stack screen inherits this gap. This is a
telemedicine-owned shared component (out of Frontend's edit scope), but it is the
back affordance for all 14 doctor stack screens. Recommended fix (owner:
telemedicine/Backend-shared): add `accessibilityRole="button"
accessibilityLabel="Go back"`.

### MINOR 5b — Tab bar icons have no explicit a11y label
`(tabs)/_layout.tsx` relies on the tab `title` for the accessible name, which
Expo Router maps automatically — acceptable, noted only for completeness.

---

## 6. Contract Adherence — PASS

- **Screens consume hooks, not `doctor.api` directly:** the only imports from
  `@/api/doctor.api` in `app/(doctor)` are `formatKobo`
  (`index.tsx:13`, `earnings.tsx:13`, `hmo.tsx:11`) — explicitly permitted by
  the contract. No screen imports a `get*`/mutation function directly. OK
- **Mutations omit `idempotencyKey`:** no screen passes `idempotencyKey` (grep
  finds only a comment at `index.tsx:33`). All `.mutate`/`.mutateAsync` inputs
  match the `Omit<..., 'idempotencyKey'>` shapes (e.g. submit `{mdcnNumber,
  documents}` `signup/index.tsx:43`; createPrescription `{appointmentId,
  patientId, diagnosis, items}` `prescription.tsx:43`; requestPayout
  `{amountKobo}` `earnings.tsx:32`). OK
- **Button state from `isPending`:** used throughout — `submit.isPending`,
  `update.isPending`, `create.isPending`, `requestPayout.isPending`,
  `markReviewed.isPending`, `updateSettings.isPending`. `mutateAsync` used when
  awaiting before navigation (signup, availability, prescription, lab-order,
  earnings payout, lab review). OK
- **Money via `formatKobo`, no float math:** all amounts rendered through
  `formatKobo(...)` (earnings, hmo copay, dashboard). No `parseFloat`/`toFixed`/
  `/100` on kobo anywhere. Payout requests the integer `availableKobo` directly
  (`earnings.tsx:32`). OK
- **Arrays defaulted:** every list hook is destructured with `= []`
  (appointments, threads, messages, prescriptions, labOrders, notifications,
  tickets). OK

---

## 7. Typecheck — PASS

`npx tsc --noEmit` from app root -> **exit 0**, no errors.

---

## 8. Ownership — PASS

`git status` shows the only in-scope change to a non-owned file is
`app/_layout.tsx` (the single permitted `<Stack.Screen name="(doctor)" />`
line, `app/_layout.tsx:52`). No edits to `src/types/`, `src/api/`,
`src/features/doctor/hooks/**`, `src/features/doctor/constants/**`, or any
existing telemedicine/voting/Spotlight module file appear in scope. Other
modified files in `git status` (backend Go, web, admin, banking deletions) are
unrelated to this delivery and outside the three doctor roles. No boundary
crossings detected for the doctor MVP work.

---

## Prioritized Defect List

### Blockers
_None._

### Majors
1. **[4a] Patient id passed as appointment id into consult flow.**
   `patient/[id].tsx:106`. Breaks SOAP/prescription/lab/chat/call queries with
   live data. Fix: pass the appointment id into the `consult/[id]/...` route.
2. **[4b] Call screen (#8) unreachable** — no navigation target for `/call`.
   Fix: add a "Start consult" action pushing
   `/(doctor)/consult/${appointment.id}/call`.
3. **[4c] HMO screen (#14) unreachable** — no navigation target for `/hmo`.
   Fix: link from notes and/or from `AppointmentRow` when `isHmo`.

### Minors
1. **[5a]** `TeleHeader` back button lacks `accessibilityLabel`/`Role`
   (shared component; affects all 14 stack screens).
2. **[3/Call]** Call screen does not use the `StateView` loading/error pattern
   (`call.tsx:67-71`); no retry path on session-read failure.
3. **[2]** `earnings.tsx:126` raw `fontSize: 36, lineHeight: 44` override of
   `displayLg` — prefer a token step.
4. **[2]** Ad-hoc pill/chip heights & padding (22/26/28/30/34; 8/10/12) not
   tokenized; candidate for a shared `StatusPill`/`Chip`.
5. **[Nav]** No appointment->consult-action path (only patient profile);
   consult flow reachable mainly via Messages/notes. UX gap.
6. **[1/Header]** Tab screens hand-roll headers instead of a shared component;
   acceptable (shared `AppHeader` hardcodes patient routes) but creates minor
   inconsistency in header spacing across doctor screens.
7. **[Auth]** `AuthGate` (`app/_layout.tsx:15-39`) gates `(doctor)` only on
   `user` presence — there is no doctor-role check, so any logged-in user can
   deep-link into `(doctor)`. Likely out of MVP scope but worth a follow-up.

---

## Conflicts between `DESIGN-Mobile.md` and the Codebase

1. **Typography font family not wired (matches design intent but unmet).**
   `DESIGN-Mobile.md` specifies `fontFamily: Plus Jakarta Sans` for every type
   role. In code, `typography.ts:8`
   `const FONT_FAMILY = Platform.select({ ios: undefined, android: undefined })`
   -> all text falls back to the **system font**. `useFonts()` is **not** called
   anywhere (`app/_layout.tsx` has no font loading; grep for `useFonts`/
   `plus-jakarta` finds only the TODO comments in `typography.ts:2,7`). The doctor
   screens render correctly but in the wrong typeface. **Owner: shared/Backend
   (token file is outside Frontend scope).** Project-wide gap, not a doctor-MVP
   regression.

2. **Card / button / input radius — MATCHES.** Design says base radius 16px
   (`rounded-lg`) for cards, buttons, inputs; `radius.ts` `lg: 16`. `SectionCard`,
   `PrimaryButton`, `SoapSection`, doc/lab rows all use `Radius.lg`. OK
   `xl: 24` (bottom sheets/banners) used for the gradient heroes
   (`index.tsx:160`, `earnings.tsx:121`). OK Consistent.

3. **Button height 56px — MATCHES.** Design says 56px thumb-friendly primary
   buttons; `PrimaryButton.tsx` `height: 56`. OK All form CTAs use it.

4. **Color naming case mismatch (cosmetic).** `DESIGN-Mobile.md` front-matter
   uses kebab-case (`surface-dim`, `surface-container-low`, `on-surface-variant`);
   `colors.ts` uses camelCase (`surfaceDim`, `surfaceContainerLow`,
   `onSurfaceVariant`). Values identical (e.g. `surface-dim #cbdbf5` <->
   `surfaceDim '#CBDBf5'`). NOTE: `colors.ts` `surfaceDim: '#CBDBf5'` has
   **inconsistent hex casing** (`f5` lowercase among uppercase). Cosmetic only;
   token file is outside Frontend scope.

5. **Glassmorphism / backdrop blur — approximated, not implemented.** Design
   calls for "backdrop-filter blur of 20px" on nav bars / bottom sheets (Level 2).
   React Native has no CSS backdrop-filter; the code approximates with a
   translucent fill (`(tabs)/_layout.tsx:74` `rgba(255,255,255,0.92)`,
   `TeleHeader` `rgba(248,249,255,0.92)`) and shadows. Standard RN limitation, not
   a defect — intentional divergence (a real blur needs `expo-blur`/`BlurView`).

6. **Status chip radius.** Design says status chips are pill-shaped "32px radius".
   Code uses `Radius.full` (9999) for pills, which renders identically for short
   pills (fully rounded) — effectively matches; `Radius.xxl` is the 32 token.
   Non-issue.

7. **Elevation values — MATCH.** Design Level 1 `0 4 20 rgba(0,0,0,0.05)` <->
   `shadows.ts shadow1`; Level 3 `0 12 32 rgba(76,29,149,0.12)` <-> `shadow3`. OK

---

## Appendix — verification commands run
- `npx tsc --noEmit` -> exit 0
- `grep -rE "#[0-9a-fA-F]{3,8}"` over `app/(doctor)` + doctor components -> none
- `grep -r "from '@/api/doctor.api'"` over `app/(doctor)` -> only `formatKobo`
- `grep -r "idempotencyKey"` over `app/(doctor)` -> comment only
- `grep -roE "router\.(push|replace)\(.*"` -> mapped all targets; `/call` and
  `/hmo` have zero callers
- `find ... -iname '*AppointmentRow*'` etc. -> no shared duplicates

---

## Post-review fixes applied (all 3 Majors resolved)

The patient profile is now the consult hub. Changes (tsc still exit 0, no raw hex):

1. **MAJOR #1 (wrong id into consult routes) — FIXED.** `(tabs)/appointments.tsx`
   and `(tabs)/index.tsx` now navigate `patient/<patientId>?apptId=<appointmentId>`.
   `patient/[id].tsx` reads `apptId`, resolves the appointment via
   `useAppointment(apptId)`, and all consult actions use the real appointment id
   (with a graceful fallback to the legacy notes link when `apptId` is absent).
2. **MAJOR #2 (call screen orphaned) — FIXED.** `patient/[id].tsx` now has a
   "Start consultation" primary action routing to `consult/<apptId>/call`.
3. **MAJOR #3 (HMO screen orphaned) — FIXED.** `patient/[id].tsx` shows an "HMO
   coverage" action (routing to `consult/<apptId>/hmo`) when `appointment.isHmo`.

Minor items (TeleHeader back-button a11y label, Plus Jakarta Sans not wired,
`surfaceDim` hex casing, call-screen retry state, doctor-role route guard) remain
open as noted above — they sit in shared/out-of-scope files or are non-blocking.
