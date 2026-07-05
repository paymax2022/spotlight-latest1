# Paymax Telemedicine — Pre-Consultation Health Intake

**Adds to:** existing Telemedicine module
**What:** a required intake step that captures the patient's key health details before the consultation begins, so the doctor walks in informed.
**Status:** build-ready spec — **v2** (adds full mobile + admin screen inventories)

> **v2 update.** Adds a comprehensive mobile app screen list (§7) and admin management console (§8), and extends the DoD to cover both. Core intake logic (§1–§6) unchanged.

---

## 1. Where it sits

Intake is a **guarded prerequisite on the appointment**, not a new booking flow. The patient books as normal, is prompted to complete intake immediately after, and **the consultation cannot start until intake is `SUBMITTED`.**

```
BOOKED ──prompt intake──► INTAKE_PENDING ──submit──► READY_FOR_CONSULT ──► IN_CONSULT
INTAKE_PENDING: draft auto-saved; reminder sent if still incomplete near appointment time.
```

Reuse the existing appointment state machine — add `INTAKE_PENDING` / `READY_FOR_CONSULT` as guarded states; `IN_CONSULT` is unreachable while intake is incomplete (illegal state structurally blocked).

---

## 2. Reuse vs net-new

| Reuse | Net-new |
|---|---|
| SSO/identity (name, age, sex — **don't re-ask** what the profile holds) | `ConsultIntake` entity + submit state |
| Telemedicine appointment + its state machine | Intake form (schema-driven, §3) |
| AI symptom checker (optional pre-fill of complaint) | Red-flag triage check (§5) |
| Notifications (intake reminder) | Doctor-facing intake summary (§6) |
| Mobile design system; audit infra | Pre-fill from the patient's last intake |

---

## 3. What the patient provides

Schema-driven so it can change without code. Required (R) vs optional (O):

- **Reason for visit (R)** — short free-text chief complaint + optional category.
- **Symptom detail (R if symptomatic)** — onset/duration, severity (1–10), what makes it better/worse.
- **Current medications (R, may be "none")** — name + dose; pre-filled from last intake.
- **Allergies (R, may be "none")** — drug/food; **safety-critical, see §5.**
- **Chronic conditions (R, may be "none")** — diabetes, hypertension, asthma, etc. (multi-select + other).
- **Pregnancy / breastfeeding (R if applicable)** — affects prescribing.
- **Lifestyle (O)** — smoking, alcohol.
- **Self-reported vitals (O)** — temp, BP, weight/height (→ BMI), pulse, if the patient has them.
- **Attachments (O)** — photos (e.g. rash), prior lab results / prescriptions.

Low-friction by design: draft auto-saves, pre-fills from the prior intake, works offline and syncs (offline-first), and asks only what the profile doesn't already know.

---

## 4. Privacy & consent

- Intake is **sensitive health data**: visible only to the **assigned doctor** for this appointment (object-level access), plus the patient.
- Explicit consent at first intake: "shared with your doctor to provide care."
- Every doctor access to an intake is **audit-logged** (who, when).
- Stored against the patient's longitudinal record so future consults pre-fill — but never exposed beyond the care relationship.

---

## 5. Safety rules (non-negotiable)

1. **Red-flag triage runs at submit.** If the patient reports emergency symptoms (e.g. chest pain, breathing difficulty, stroke signs, severe bleeding) or **any indication of self-harm/suicidal ideation**, do **not** silently queue a routine consult — surface urgent-care / crisis guidance and route appropriately. This is a product-safety gate, not a form field.
2. **Allergies + current medications are surfaced prominently to the doctor** and carried into any e-prescribing step — an allergy/interaction flag is a safety feature, not a note.
3. Intake is **decision-support for the clinician, not a diagnosis.** Label any AI-structured complaint as patient-reported, not assessed.
4. Intake completeness gates `IN_CONSULT`; the consult cannot start on an empty intake.

---

## 6. Doctor-facing view

At consult start the doctor sees a one-screen structured summary, ordered for clinical use: chief complaint → symptom detail → **allergies & current meds (highlighted)** → chronic conditions → pregnancy status → vitals → attachments. Patient-reported throughout; one tap to expand any section.

---

## 7. Mobile app screens (patient)

The intake is a save-as-you-go wizard. Conditional screens render only when relevant.

**Entry & consent**

| # | Screen | Purpose |
|---|---|---|
| M1 | Intake prompt (post-booking) | CTA after booking + status badge on the appointment card: "Add your health details." |
| M2 | Consent | First-time consent to share intake with the assigned doctor; records consent version. |
| M3 | Resume draft | Returning to an incomplete intake; shows progress and jumps to the next unanswered step. |

**Intake wizard**

| # | Screen | Purpose |
|---|---|---|
| M4 | Reason for visit | Chief complaint free-text + optional category; optional AI symptom-checker assist. |
| M5 | Symptom detail | Onset/duration, severity slider, better/worse. |
| M6 | Current medications | Add/list with dose; pre-filled from last intake; "none" toggle. |
| M7 | Allergies | Drug/food allergies; "none" toggle (safety-critical). |
| M8 | Chronic conditions | Multi-select (diabetes, hypertension, asthma…) + "other". |
| M9 | Pregnancy / breastfeeding | Conditional; affects prescribing. |
| M10 | Lifestyle | Optional smoking/alcohol. |
| M11 | Self-reported vitals | Optional temp, BP, weight/height (→ BMI), pulse. |
| M12 | Attachments | Upload photos / lab results / prior prescriptions. |

**Safety & completion**

| # | Screen | Purpose |
|---|---|---|
| M13 | Red-flag interstitial | Conditional — emergency/crisis answers surface urgent-care or crisis guidance and routing (§5). |
| M14 | Review & submit | Full summary for the patient to confirm before submitting. |
| M15 | Submission confirmation | "Your details are ready for Dr. X" + what happens next. |
| M16 | Edit intake (pre-consult) | View/update a submitted intake any time before the consult starts. |
| M17 | My Health Profile | Persistent record of conditions/meds/allergies that pre-fills future intakes. |

Supporting: reminder push/notification deep-links straight to M3/M14.

---

## 8. Admin management console

Grouped by function. All access is role-gated and audit-logged.

**Configuration**

| # | Screen | Purpose |
|---|---|---|
| A1 | Intake Form Builder | Manage the schema — questions, required/optional, ordering, conditional logic — without code. |
| A2 | Red-flag Rules | Define which answers trigger the triage gate and the guidance/routing each produces. |
| A3 | Clinical Vocabularies | Maintain condition lists, allergen vocabulary, and the medication lookup source. |
| A4 | Consent Versions | Author/version consent text; track which version each patient accepted. |
| A5 | Reminder Settings | Timing/cadence of intake-completion reminders. |
| A6 | Doctor Summary Template | Configure the ordering/sections of the clinician-facing summary (§6). |
| A7 | Content & Localization | Question text, translations, and urgent-care/crisis guidance copy. |

**Operations & records**

| # | Screen | Purpose |
|---|---|---|
| A8 | Intake Monitoring | Appointments with intake status (pending/submitted), incomplete-near-appointment alerts. |
| A9 | Intake Record Viewer | View a specific intake for support/clinical-admin — access-controlled + audit-logged. |
| A10 | Access & Audit Log | Who accessed which intake, when; consent + red-flag event trail. |
| A11 | Red-flag Queue | Live view of triggered red-flag cases and their routing/disposition. |

**Analytics**

| # | Screen | Purpose |
|---|---|---|
| A12 | Completion Analytics | Completion rate, per-step drop-off, average time-to-complete. |
| A13 | Clinical Insights | Most common complaints/conditions, red-flag trigger rate, trends (de-identified/aggregated). |

---

## 9. Definition of done

- [ ] `IN_CONSULT` unreachable until intake `SUBMITTED` (guarded, structural)
- [ ] Schema-driven form; required vs optional enforced; draft auto-saves; offline-capable
- [ ] Pre-fills from profile + last intake; never re-asks known profile data
- [ ] Allergies & current meds captured and highlighted to the doctor + carried to prescribing
- [ ] Red-flag triage at submit routes emergencies / crisis cases appropriately
- [ ] Intake visible only to the assigned doctor; every access audit-logged; consent captured
- [ ] Doctor summary screen renders the ordered, expandable view
- [ ] All mobile screens (M1–M17) built on the design system; conditional screens render correctly
- [ ] Admin console (A1–A13) role-gated; Form Builder drives the live schema; red-flag rules editable
- [ ] Tests cover the intake gate, required-field validation, red-flag routing, access control, and schema-builder changes
