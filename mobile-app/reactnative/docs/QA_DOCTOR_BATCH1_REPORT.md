# QA Report — Doctor Telemedicine, Batch 1 (Sections C · D · E · F)

**Reviewer:** QA Agent (rigorous, evidence-based pass)
**Scope:** Spec sections C (17), D (21), E (17), F (18) = **73 entries**, built with the
**consolidated** approach (action/state variants = states/sheets of parent screens).
**Approach note:** QA does not edit feature code; defects are described with `file:line`
and a recommended fix only.

---

## 1. Summary verdict

### **PASS-WITH-NOTES**

The batch is high quality. The backend contract (types/api/hooks/constants) is clean and
fully matches `DOCTOR_BATCH1_API_CONTRACT.md`. All 73 spec entries are accounted for as
full screens, consolidated states/sheets, or documented reuse. Type-check is clean for the
doctor module. Navigation is sound: **no orphan routes, no dead links, no Expo Router
collisions.** The four new components are genuinely new and the screens reuse the shared
component library well.

Defects are dominated by **one spec-level miss (E14 overbooking warning never wired into the
UI)** plus minor reuse/consistency/a11y polish items. None are blockers.

### Defect counts
| Severity | Count |
|----------|-------|
| **Blocker** | 0 |
| **Major** | 2 |
| **Minor** | 8 |

### Required headline facts
- **Doctor-module tsc grep** (`npx tsc --noEmit 2>&1 | grep -iE "doctor|batch1|\(doctor\)"`): **EMPTY (pass).** Full-project `tsc --noEmit` returned **0 errors** (rc=0). tsc 5.9.3 verified working against a probe.
- **Pre-existing fx error:** The brief flagged a known type error in `src/features/fx/api/fx.mock.ts`. As of this review the file exists but the **full project type-checks with 0 errors** — the fx error appears to have already been resolved upstream. It is **not** a Batch 1 concern either way.
- **Per-section coverage:** **C: 17/17 · D: 21/21 · E: 17/17 · F: 18/18 — 73/73 covered.**
- **Nav:** orphans **0**, dead links **0**, collisions **0**.

---

## 2. Per-section coverage tables (key deliverable)

### Section C — Veterinary Doctor Profile & Verification (17/17)

| # | Entry | How covered | Status |
|---|-------|-------------|--------|
| C1 | Create vet profile (hub) | screen `vet/profile/setup/index.tsx` (WizardProgress + checklist) | PASS |
| C2 | Vet personal info | screen `vet/profile/setup/personal.tsx` | PASS |
| C3 | Vet specialty selection | screen `vet/profile/setup/specialty.tsx` (+ ChipMultiSelect for sub-specialty) | PASS |
| C4 | Pet species specialisation | screen `vet/profile/setup/species.tsx` | PASS |
| C5 | Veterinary licence entry | screen `vet/profile/setup/licence-number.tsx` | PASS |
| C6 | Veterinary licence upload | screen `vet/profile/setup/licence-upload.tsx` (UploadField, useVetDocumentSlots) | PASS |
| C7 | Vet certificates upload | screen `vet/profile/setup/certificates.tsx` (UploadField + EditableListCard) | PASS |
| C8 | Vet clinic affiliation | screen `vet/profile/setup/affiliations.tsx` (EditableListCard) | PASS |
| C9 | Vet experience history | screen `vet/profile/setup/experience.tsx` (EditableListCard) | PASS |
| C10 | Vet consultation pricing (kobo) | screen `vet/profile/setup/pricing.tsx` (kobo + formatKobo) | PASS |
| C11 | Vet availability | reuses Phase 1 `availability.tsx` (linked from pricing.tsx:89) | PASS |
| C12 | Vet profile preview | screen `vet/profile/setup/preview.tsx` (InfoRow) | PASS |
| C13 | Verification submitted | state of `vet/profile/verification.tsx` (`status==='pending'`, "Verification submitted") | PARTIAL — see Minor #6 |
| C14 | Verification pending | state of `vet/profile/verification.tsx` (`status==='pending'`) | PASS |
| C15 | Verification approved | state of `verification.tsx` (`status==='approved'`) + Publish CTA via `usePublishVetProfile` | PASS |
| C16 | Verification rejected | state of `verification.tsx` (`status==='rejected'`) + reason block + "Review & resubmit" | PASS |
| C17 | Vet licence renewal | screen `vet/profile/licence/renew.tsx` (useRenewVetLicence) | PASS |

> verification.tsx confirmed to render distinct states via a `STATUS` config map and a
> three-way CTA branch (verification.tsx:101-107): approved→publish, rejected→resubmit,
> pending→refresh. C13 (submitted) and C14 (pending) intentionally collapse into the single
> `pending` state because `VerificationStatus` has no separate `submitted` member — see Minor #6.

### Section D — Doctor Dashboard (21/21)

All entries are cards/alerts/banners/states of the single `DoctorDashboardData` aggregate
on `(tabs)/index.tsx`, per the consolidation plan.

| # | Entry | How covered | Status |
|---|-------|-------------|--------|
| D1 | Today's appointments | StatCard `counts.todaysAppointments` + "Today's queue" list (index.tsx:167,294) | PASS |
| D2 | Upcoming appointments | StatCard `counts.upcomingAppointments` (index.tsx:168) | PASS |
| D3 | Pending consultation requests | quick-stat → deep-links `appointments/requests` (index.tsx:198) | PASS |
| D4 | Active consultation card | `dashboard.activeConsultation` card (index.tsx:176-193) | PASS |
| D5 | Waiting-room queue | quick-stat → deep-links `queue/waiting-room` (index.tsx:203) | PASS |
| D6 | Follow-up requests | `alerts[kind='follow_up']` via AlertCard | PASS |
| D7 | Unread patient messages | quick-stat + "Recent messages" SectionCard (index.tsx:208,242) | PASS |
| D8 | New lab-results alert | `alerts[kind='new_lab_result']` | PASS |
| D9 | Pending prescriptions | `alerts[kind='pending_prescription']` | PASS |
| D10 | Refill requests | `alerts[kind='refill_request']` | PASS |
| D11 | HMO approval alerts | `alerts[kind='hmo_approval']` | PASS |
| D12 | Earnings summary | StatCard `dashboard.earnings.availableKobo` via formatKobo (index.tsx:171) | PASS |
| D13 | Patient satisfaction rating | StatCard `dashboard.satisfactionPct` (index.tsx:172) | PASS |
| D14 | Online/offline + availability | header status card + Go online/offline toggle (index.tsx:144-163), `useSetPresence` | PASS — see Minor #7 (rendered as toggle, not a presence-picker sheet) |
| D15 | Urgent case alert | `alerts[kind='urgent_case']` severity `critical` | PASS |
| D16 | Compliance alert | `alerts[kind='compliance']` | PASS |
| D17 | Profile-completion reminder | `alerts[kind='profile_completion']` | PASS |
| D18 | Licence-expiry alert | `alerts[kind='licence_expiry']` | PASS |
| D19 | Platform announcement | AnnouncementBanner on dashboard + detail `announcement.tsx` | PASS |
| D20 | Doctor-late warning | `alerts[kind='doctor_late']` + `ConsultCountdown.isDoctorLate` | PASS |
| D21 | Dashboard empty / error | screen-level loading/error StateView (index.tsx:86-99) + alerts-empty hides section | PASS |

> Alert severity sorting confirmed: `[...alerts].sort((a,b)=>DASHBOARD_ALERT_SEVERITY_RANK[b.severity]-RANK[a.severity])` (index.tsx:76-78) — worst-first.
> Each alert CTA deep-links via `ALERT_ROUTE` (index.tsx:40-51); all 10 targets resolve to existing routes (queue, compliance, profile/setup, profile/licence/renew, prescriptions, claims, refills, follow-ups). PASS.

### Section E — Availability & Schedule Management (17/17)

| # | Entry | How covered | Status |
|---|-------|-------------|--------|
| E1 | Working days | reuses `availability.tsx` (lines 64-74) | PASS |
| E2 | Working hours | reuses `availability.tsx` | PASS |
| E3 | Break time | reuses `availability.tsx` | PASS |
| E4 | Consultation duration | reuses `availability.tsx` (lines 76-91, CONSULT_DURATION_OPTIONS) | PASS |
| E5 | Instant vs appointment-only | persisted `acceptsInstant` toggle in `availability.tsx:93-103`; nav-shim toggle in `schedule/settings.tsx:53` | PASS — see Major #2 (toggle that navigates) |
| E6 | Block unavailable date | screen `schedule/blocked-dates.tsx` (useBlockDate) | PASS |
| E7 | Vacation / unavailable mode | screen `schedule/vacation.tsx` (useSetVacation) | PASS |
| E8 | Emergency availability toggle | ToggleRow in `schedule/settings.tsx:56-65` (useToggleEmergency) | PASS |
| E9 | Reschedule appointment | sheet on `appointments/[id].tsx:181-193` (useRescheduleAppointment) | PASS |
| E10 | Cancel appointment | sheet on `appointments/[id].tsx:167-178` (useCancelAppointment) | PASS |
| E11 | Appointment reminder settings | screen `schedule/reminders.tsx` (useSaveReminderSettings) | PASS |
| E12 | Recurring availability setup | screen `schedule/recurring.tsx` (useSaveRecurringRule) | PASS |
| E13 | Timezone settings | screen `schedule/timezone.tsx` (useSetTimezone) | PASS |
| E14 | Overbooking warning | helper `checkOverbooking` exists + re-exported, **never called/rendered in any screen** | **FAIL — see Major #1** |
| E15 | Saved confirmation | mutation `isSuccess` inline rows (vacation/reminders/recurring/timezone); inconsistent elsewhere | PASS — see Minor #4 |
| E16 | Schedule settings hub | screen `schedule/settings.tsx` (useScheduleSettings) | PASS |
| E17 | Empty / error states | StateView loading/error/empty across all schedule screens | PASS |

### Section F — Appointment & Consultation Queue (18/18)

| # | Entry | How covered | Status |
|---|-------|-------------|--------|
| F1 | Appointment list | reuses `(tabs)/appointments.tsx` (AppointmentRow) | PASS |
| F2 | Appointment detail | `appointments/[id].tsx` (extended) | PASS |
| F3 | Pending request | screen `appointments/requests/index.tsx` (filter `status==='pending'`) | PASS |
| F4 | Request detail | screen `appointments/requests/[id].tsx` | PASS |
| F5 | Accept appointment | action/state on F4 (useAcceptAppointment, requests/[id].tsx:44,117) | PASS |
| F6 | Reject appointment | sheet on F4 with APPOINTMENT_REJECT_REASONS (requests/[id].tsx:135-152) | PASS |
| F7 | Reschedule request | sheet on F4 (useRequestReschedule, requests/[id].tsx:157-168) | PASS |
| F8 | Patient waiting room | screen `queue/waiting-room.tsx` (filter waiting + QueueItemRow) | PASS |
| F9 | Consultation queue | screen `queue/index.tsx` (QueueItemRow) | PASS |
| F10 | Priority queue | sort state of F9 by `QUEUE_PRIORITY_RANK` (queue/index.tsx:30) | PASS |
| F11 | HMO-covered detail | state of F2 (`billing==='hmo'`, appointments/[id].tsx:129-135) | PASS |
| F12 | Paid detail | state of F2 (`billing==='paid'`) | PASS |
| F13 | Free-follow-up detail | state of F2 (`billing==='free_follow_up'`, appointments/[id].tsx:138-142) | PASS |
| F14 | Missed / no-show | action on F2 (useMarkNoShow, appointments/[id].tsx:152) | PASS |
| F15 | Doctor-late warning | `computeConsultCountdown().isDoctorLate` via CountdownBanner | PASS |
| F16 | Consultation countdown | CountdownBanner on F2 (appointments/[id].tsx:116) | PASS |
| F17 | Start consultation | action on F2 (useStartConsultation, appointments/[id].tsx:146) | PASS |
| F18 | End consultation | action on F2 (useEndConsultation, appointments/[id].tsx:147) | PASS |

> Request detail renders all four `AppointmentRequestStatus` variants (pending→actions;
> accepted/rejected/reschedule_requested→resolved text, requests/[id].tsx:84,115,128).
> Billing variants on F2 derived from `appt.isHmo`/`feeKobo` (appointments/[id].tsx:94). All confirmed.

---

## 3. Per-check findings

### Check 1 — Spec coverage — **PASS (73/73)**
Every entry maps to a screen, a consolidated state/sheet, or documented reuse, matching the
ownership map's consolidation decisions. The only coverage shortfall is **E14** (helper exists
but is not surfaced anywhere in the UI — see Major #1). C13/C14 are intentionally merged into
one `pending` state (Minor #6). All other entries fully realised.

### Check 2 — Reuse vs duplication — **PASS (4/4 new components genuinely new)**
- **AlertCard** — PASS. Tinted icon + title + body + count badge + CTA; no existing component composes this. Used for all `DashboardAlert` kinds.
- **AnnouncementBanner** — PASS. Full-width dismissible banner with tone + CTA; distinct from AlertCard.
- **CountdownBanner** — PASS. Renders `ConsultCountdown` with soon/overdue/late tones; nothing else renders a time-to-slot countdown.
- **QueueItemRow** — PASS. `ConsultationQueueItem` row with priority + wait-time + billing; distinct from AppointmentRow (which keys off `DoctorAppointment` and lacks priority/wait/billing). Reuses `DoctorAvatar` + `StatusBadge`.

All four are exported from the component barrel (index.ts:39-42). Screens reuse
StateView / StatCard / SectionCard / InfoRow / ToggleRow / StatusBadge / WizardProgress /
UploadField / ChipMultiSelect / EditableListCard / AppointmentRow throughout.
**The vet wizard genuinely reuses Section B primitives (WizardProgress, UploadField,
EditableListCard, ChipMultiSelect)** — not copies. Two consolidation nits (Minor #1, #2).

### Check 3 — Design-token compliance — **PASS (no raw hex / raw fontSize in screens or the 4 components)**
- The 4 components and all screens use `Colors` / `Typography` / `Radius` / `Spacing` tokens.
- The only literal colors are exempt **rgba overlays** (modal backdrops): `appointments/[id].tsx:213`, `appointments/requests/[id].tsx:189`, `schedule/blocked-dates.tsx:119`, `schedule/recurring.tsx:130` — all `rgba(11,28,48,0.4)`, allowed.
- The hex literals in `constants/batch1.ts` (PRESENCE_TONES, DASHBOARD_ALERT_SEVERITY_TONES, QUEUE_PRIORITY_TONES, etc.) are **data maps**, not stylesheet values, and are an established prior-phase pattern; the components map them through token-based `StatusTone` where they consume them. Acceptable.
- Minor micro-spacing literals (`gap:2`, `gap:4`, `paddingHorizontal:6`, `paddingHorizontal:3`, `width:40`) — see Minor #8. No `fontSize` literals anywhere.

### Check 4 — Screen states — **PASS**
Full screens implement loading / error(+retry) / empty consistently via `StateView`.
Spot-checks confirmed:
- Billing variants render on `appointments/[id]` (HMO 129-135, free 138-142, paid via fee row).
- Verification states render distinctly on `vet/profile/verification` (approved/rejected/pending branch 101-107).
- Countdown tones render in CountdownBanner (late/overdue/soon/idle).
- Alert severity sorting on dashboard (index.tsx:76-78), worst-first.

### Check 5 — Navigation — **PASS (0 orphans, 0 dead links, 0 collisions)**
- **Orphans:** all 24 Batch 1 routes registered in `_layout.tsx` have ≥1 caller (verified by grep across `app/(doctor)`).
- **Dead links:** every `router.push`/`replace` target in `app/(doctor)` resolves to an existing file (vet wizard chain, schedule hub fan-out, queue→detail, requests list→detail, dashboard alert CTAs).
- **Coexistence:** new `appointments/[id]` and the older `patient/[id]` flow coexist without conflict (different route segments).
- **Collisions:** `appointments/[id].tsx` + `appointments/requests/{index,[id]}.tsx` is valid Expo Router (no `appointments/index` collision). PASS.
- **Vet builder chain connects:** index→preview/(personal→specialty→species→licence-number→licence-upload→certificates→affiliations→experience→pricing→preview)→verification→published. Confirmed.

### Check 6 — Accessibility — **PASS-WITH-NOTES**
Icon-only Pressables are labelled across the batch (dashboard bell, sheet close buttons,
quick-stats, add buttons, radio rows with `accessibilityRole`/`accessibilityState`).
`numberOfLines` is applied on list rows. Gaps: detail-screen hero text lacks `numberOfLines`
(Minor #3); touch targets generally ≥44 (sheet dismiss 24×24 uses `hitSlop`).

### Check 7 — Contract adherence — **PASS**
- **Hooks-only:** no screen imports a **mutation** from `@/api/doctor.batch1.api`. The only direct api imports are the whitelisted pure helpers `formatKobo` (pricing/preview/appointments/[id]/requests/[id]) and `computeConsultCountdown` (appointments/[id]). Compliant.
- **Mutations** omit `idempotencyKey` at call sites and use `isPending`/`mutateAsync`; **all hooks inject `generateIdempotencyKey()`** (verified in useVetProfile/useDashboard/useSchedule/useQueue). Compliant.
- **Money** is integer kobo formatted with `formatKobo`; pricing converts naira→kobo with integer math (`*100`), no floats. Compliant.

### Check 8 — Typecheck — **PASS**
`npx tsc --noEmit` (tsc 5.9.3) → **0 errors**, exit 0. Doctor-module grep is empty.
fx.mock.ts external error: not present in the current type-check (see §1).

### Check 9 — Ownership / no new deps — **PASS**
- Frontend changes confined to `app/(doctor)/**` and `src/features/doctor/components/**`.
- Backend additive: new `doctor.batch1.ts` / `doctor.batch1.api.ts` / `constants/batch1.ts` / four hooks; barrels edited additively only (hooks/index.ts:26-29, constants/index.ts:148).
- `mobile-app/reactnative/package.json` **unchanged** — no new dependencies. (The git-visible package.json changes are in `frontend-admin/` and a deleted `banking/` subdir, unrelated to Batch 1.)

---

## 4. Prioritized defect list

### MAJOR

**M1 — E14 overbooking warning is never surfaced in the UI** *(spec-level coverage miss)*
`checkOverbooking` is defined (`src/api/doctor.batch1.api.ts:336`) and re-exported from the
hooks barrel (`src/features/doctor/hooks/useSchedule.ts:36`), but a full grep finds **zero
call sites** in any screen (`grep -rn checkOverbooking "app/(doctor)"` → none). The spec
(E14) requires an inline `OverbookingCheck` warning on schedule edits.
**Recommended fix:** wire `checkOverbooking` into the add-sheet of `schedule/recurring.tsx`
(and/or `schedule/blocked-dates.tsx`), rendering an inline warning row when `!safe`. No
backend change needed — the helper and type already exist.

**M2 — E5 "Appointment-only" toggle navigates instead of toggling** *(UX correctness)*
`schedule/settings.tsx:53` renders a `ToggleRow` whose `onValueChange` calls
`router.push('/(doctor)/availability')` rather than persisting `appointmentOnly`. A switch
that doesn't switch is misleading; the persisted instant/appointment control actually lives
as `acceptsInstant` in `availability.tsx:93-103`.
**Recommended fix:** either make the settings toggle persist `ScheduleSettings.appointmentOnly`
(there is no dedicated mutation in the contract for it — would need a hook, so prefer the
alternative), or convert it from a `ToggleRow` to a plain nav row (ProfileMenuItem) so the
control isn't presented as a live switch. De-duplicate the framing against `availability.tsx`.

### MINOR

**m1 — `vet/profile/setup/species.tsx:69-87` re-implements a chip multi-select inline**
instead of reusing `ChipMultiSelect` (which `specialty.tsx` uses for the same UX).
*Fix:* replace the hand-rolled chip grid with `ChipMultiSelect` for consistency.

**m2 — `vet/profile/setup/personal.tsx:70-87` builds the personal-info form inline** from
shared primitives rather than reusing a Section B personal-info field group (if one exists).
*Fix:* extract/reuse a shared personal-info field block if available; otherwise acceptable.

**m3 — Detail-screen hero text lacks `numberOfLines`** — `appointments/requests/[id].tsx:92`
(patient `name`, `resolvedText`, `note`). Long names could overflow.
*Fix:* add `numberOfLines={1}` on the hero name and `numberOfLines` on note/resolved text.

**m4 — E15 saved-confirmation pattern is inconsistent.** vacation/reminders/recurring/timezone
show an inline `isSuccess` row; `schedule/blocked-dates.tsx` shows no positive feedback
(only `Alert` on failure, line 36) and `availability.tsx:35` uses `Alert.alert('Saved')`.
*Fix:* standardise on the inline success-row pattern across all schedule mutations.

**m5 — `appointments/requests/index.tsx:42-62` hand-rolls the request card** (avatar + meta +
chevron) rather than a shared row component, duplicating the F4 hero layout. Acceptable
(request shape differs) but a consolidation candidate.
*Fix:* optionally extract a shared `RequestRow` component.

**m6 — C13 (submitted) and C14 (pending) collapse into one `pending` state.**
`verification.tsx:17-22` has no distinct "submitted" UI because `VerificationStatus`
(`@/types/doctor.batch1`) has no `submitted` member. If the spec requires visually distinct
just-submitted vs pending screens, this is unmet; if they are the same backend state, it is
correct-by-design.
*Fix:* reconcile with spec — if distinct, add a transient just-submitted confirmation state
(e.g. via `submittedAt` recency) on `vet/profile/verification.tsx`.

**m7 — D14 presence rendered as a binary Go online/offline toggle, not a presence-picker
sheet.** The ownership map listed "header control + SHEET" and the `DoctorPresence` union has
four values (online/busy/away/offline); the UI only toggles online↔offline
(`(tabs)/index.tsx:80-84,154-162`). Functional but doesn't expose busy/away.
*Fix:* optionally add a presence sheet to select all four `DoctorPresence` values via `useSetPresence`.

**m8 — Minor micro-spacing literals bypass `Spacing` tokens** — e.g.
`(tabs)/appointments.tsx:96` (`paddingHorizontal:3`, `fontWeight:'700'`), AlertCard.tsx:75
(`paddingHorizontal:6`), `gap:2`/`gap:4` in the four components. Low severity; no raw hex or
fontSize involved.
*Fix:* prefer `Spacing.*` where a matching token exists; leave sub-token nudges as-is.

---

## 5. Notes for the next phase (non-defects)
- File pickers in `vet/profile/setup/licence-upload.tsx` and `vet/profile/licence/renew.tsx`
  are Phase-A stubs (no real file selection) — by design for the demo-data phase.
- All reads ship `DEMO_*` `placeholderData`, so first paint always has content (matches the
  documented loading convention).
- The pre-existing `src/features/fx/api/fx.mock.ts` is unrelated to this batch and currently
  type-checks clean.

---

## Post-review fixes applied (both Majors resolved)

Doctor-tsc grep still empty (clean); no raw hex.

1. **M1 (E14 overbooking helper never called) — FIXED.** `schedule/recurring.tsx`
   now calls `checkOverbooking(...)` inline in the add-pattern sheet: it derives
   daily capacity from the doctor's working-day hours and slot length
   (`consultDurationMins + bufferMins`), computes the requested slots from the
   chosen window, and renders an error-toned warning banner with
   `overbooking.message` when `!safe`. `checkOverbooking` imported from the hooks
   barrel (contract-compliant).
2. **M2 (appointment-only switch that navigates) — FIXED.** `schedule/settings.tsx`
   replaced the misleading no-op `ToggleRow` with a `ProfileMenuItem` nav row
   (label reflects current instant/appointment-only state) that routes to
   `availability`, where `acceptsInstant` is the real persisted control. Emergency
   availability remains a real persisted toggle.

Remaining 8 minors (inline chip re-impl in vet species step, inconsistent E15 save
feedback, a couple missing numberOfLines, D14 presence sheet depth, micro-spacing
literals) left as noted — non-blocking polish.
