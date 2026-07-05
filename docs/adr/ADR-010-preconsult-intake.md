# ADR-010 — Telemedicine Pre-Consultation Health Intake

**Date:** 2026-06-29
**Status:** Accepted
**Deciders:** Platform / Backend, with Mobile + Admin + Clinical Safety + Security + QA

## Context

The Telemedicine module needs a **required intake step** so the doctor walks in
informed. It is a *guarded prerequisite on the appointment*, not a new booking
flow: the patient books as normal, is prompted to complete intake, and the
**consultation cannot start until intake is `SUBMITTED`**. Intake is **sensitive
health data** (PII/PHI), so access is restricted to the assigned doctor + patient
and every doctor access is audit-logged. A **red-flag triage** runs at submit and
must route emergencies and self-harm/crisis cases appropriately — a product-safety
gate, not a form field.

A recon found the shared **health platform already has the building blocks**:
`health/intake` (versioned, schema-driven `health_intake_schemas` +
validated-on-submit `health_intake_responses`), `health/consult` (the
`SCHEDULED→IN_PROGRESS→COMPLETED` state machine that is the literal "enter the
room" gate), `health/consent` (versioned consent), `health/records` (longitudinal
vault + access log), and `health/triage` (a deterministic `RedFlagEngine` with a
"never lower urgency" rule). So this is an **extension of the existing platform**,
not a new module.

## Decisions

### 1. Reuse the schema-driven intake engine; add a `PRE_CONSULT` kind
The form is a new versioned schema (`health_intake_schemas.kind = 'PRE_CONSULT'`),
authored/edited by admins (Form Builder, A1) with **no code change**. Submissions
are validated against the exact pinned `schema_version` (required-vs-optional
enforced) and stored in `health_intake_responses`. We do **not** widen
`menu_items`-style host rows; a new link entity ties a response to an appointment.

### 2. The gate is structural, in the consult state machine
Two additive states — `INTAKE_PENDING`, `READY_FOR_CONSULT` — are inserted into
`health_consults`: `SCHEDULED → INTAKE_PENDING → READY_FOR_CONSULT → IN_PROGRESS`.
`Consult.Start` already guards on `canTransition`, so **`IN_PROGRESS` is
unreachable until intake submit flips the consult to `READY_FOR_CONSULT`** —
illegal "consult on an empty intake" is structurally impossible. The CHECK
constraint is widened by a **new additive migration** (the platform migration is
never edited).

### 3. `ConsultIntake` link entity
`health_preconsult_intake` is one row per appointment: it references the
appointment, the consult, the patient, the provider, the `health_intake_responses`
row, the accepted `consent_version`, the captured red-flag outcome, attachments,
and a `status` (`DRAFT → SUBMITTED`). The intake request/state is separate from the
response payload and from the consult — one row never does two jobs.

### 4. Privacy: assigned-doctor-only + audit every access
Object-level access reuses the consult provider-owner join
(`provider.owner_user_id == caller`, else patient). Every doctor read of an intake
writes a row to `health_intake_access_log` (who/when/what) **and** the platform
`audit_logs` — **ids only, never answer bodies**. Consent is captured at first
intake against a versioned `health_consent_version`; the accepted version is pinned
on the intake row.

### 5. Red-flag triage at submit — reuse the engine, make rules configurable, route crisis safely
On submit, intake answers are converted to triage `Evidence` and evaluated by the
existing `RedFlagEngine` (the deterministic base safety net always runs; configurable
`health_redflag_rule` rows can only *raise* urgency, never lower it). A hit does
**not** silently queue a routine consult — it surfaces urgent-care/crisis guidance
and routes per the rule. **Self-harm / suicidal ideation** is a seeded rule that
routes to supportive crisis guidance (admin-editable copy, A2/A7). The guidance is
*supportive and resource-oriented* — it offers help and (admin-configured) crisis
lines, does **not** perform safety-assessment questioning, and makes no categorical
confidentiality claims. Intake is **decision-support, not diagnosis**; AI-structured
complaints are always labelled *patient-reported*.

### 6. Allergies + current meds are first-class safety data
Captured every intake, **highlighted** at the top of the doctor summary, and
carried into any e-prescribing step as an allergy/interaction flag — a safety
feature, not a free-text note.

### 7. Low-friction, offline-first
Draft auto-saves (locally via secure storage + server draft), pre-fills from the
patient's profile and last intake (never re-asks known profile data), renders only
conditional steps that apply, and works offline then syncs.

### 8. Doctor summary
At consult start the doctor sees one ordered, expandable screen: chief complaint →
symptom detail → **allergies & current meds (highlighted)** → chronic conditions →
pregnancy → vitals → attachments. Section order is admin-configurable (A6).

### 9. Admin console (A1–A13) drives the live config
Form Builder (schema), Red-flag Rules, Clinical Vocabularies, Consent Versions,
Reminder Settings, Summary Template, Content/Localization, plus Operations
(Monitoring, Record Viewer [access-controlled], Access/Audit Log, Red-flag Queue)
and Analytics (Completion, Clinical Insights — de-identified/aggregated). All
role-gated (`health.admin.intake`) and audit-logged.

## Consequences
- Consult-on-empty-intake is impossible at the schema level, not just in code.
- New questions/rules/consent ship as data, not deploys.
- PHI access is least-privilege and fully auditable.
- Crisis routing is built in and configurable, following responsible-care practice.
- Feature-flagged (`FEATURE_HEALTH_INTAKE_ENABLED`, default off — no flag, no merge).

## Open knobs (defaults shipped)
Schema field set/order; red-flag trigger conditions + guidance/routing copy;
clinical vocab contents; consent text; reminder cadence; doctor-summary section
order; crisis-line numbers per locale; whether AI symptom-checker pre-fill is on.
