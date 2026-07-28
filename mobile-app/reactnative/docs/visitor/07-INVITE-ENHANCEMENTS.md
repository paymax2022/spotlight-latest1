# Invite Flow Enhancements — Contacts, Guests, Usage Mode & Live Attendance

Enhances the "Invite a visitor" flow and connects it to live gate tracking, per request.

## What changed (resident-facing)

**Create screen (`app/visitor/create.tsx`)**
- **Visitor name from phonebook** — a "Choose from contacts" button opens `ContactPickerModal` (searchable bottom sheet) and fills name + phone. Typing still works. Backed by a simulated phonebook (`seedContacts`); production swaps in `expo-contacts` behind the same `onSelect` contract.
- **Number of guests** — a stepper (1–20) sets how many people the code admits (`partySize`).
- **How the code is used** — a selector for **Entry & Exit** (visitor may leave and return within validity) vs **One-time** (single entry). Reusable code types default to Entry & Exit; casual ones to One-time.

**Generated code screen (`app/visitor/code/[id].tsx`)**
- Shows **guests** and **usage mode** in the details.
- New **live attendance** card (`AttendanceStatus`) that updates as the gate acts: *Not arrived → At the gate → Inside (checked in HH:MM) → Checked out (HH:MM)*. Polls every 5s while open.

## What changed (guard-facing)

**Confirm screen (`app/guard/confirm/[code].tsx`)**
- On query, **records an arrival** (`recordArrival`) → the resident gets a "Visitor at the gate" notification and the code screen flips to *At the gate*. (VM-161)
- Shows **party size + usage mode + live attendance**.
- **Entry & Exit:** if the visitor is currently inside, the primary action becomes **Check out** (`recordExit`); otherwise **Approve entry** (`approveEntry`). Re-entry is allowed within validity.
- **One-time:** admitting consumes the code (`status = used`). A one-time code can still be **checked out** while the visitor is inside, but cannot re-enter afterwards.
- New success state: **Checked out**.

## Data model

`AccessCode` / `CreateAccessCodeInput` gained `usageMode: 'entry_exit' | 'one_time'` and `partySize: number`.
New `CodeAttendance` (derived live from `VisitEvent`s) + api `getCodeAttendance`, `recordArrival`, `recordExit`, `listPhonebookContacts`; hooks `useCodeAttendance(poll)`, `useRecordArrival`, `useRecordExit`, `usePhonebookContacts`.
`approveEntry` now marks `used` only for one-time codes; entry+exit codes stay active. `lookupCode` permits a consumed one-time code to be presented for check-out while its visitor is still inside.

## New components (reused across screens)
- `ContactPickerModal` — phonebook picker (mirrors the `SelectField` sheet pattern).
- `AttendanceStatus` — live check-in/out status block, used on both the resident code screen and the guard confirm screen.

## QA
Independent review of the change set: one must-fix found (an `AccessCode` literal in `createEventGuestCodes` missing the new required fields) — **fixed**; no other crash/typecheck issues. Static checks: no hardcoded colors except the modal scrim (matches the existing `SelectField` convention); all lucide icons verified; all routes resolve. The data model now flows end-to-end: invite → code with guests/usage → guard query notifies resident → check-in/out reflected live on both sides.
