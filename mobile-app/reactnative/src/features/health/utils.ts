// Intake validation lives here so the renderer screen + verticals share one
// implementation of field-level validation (HEALTH-BUILD: map field errors).

import type {
  IntakeSchema,
  IntakeField,
  IntakeValue,
  IntakeResponseValues,
  IntakeErrors,
  IntakeStep,
  IntakeStepCondition,
  PreConsultIntakeSchema,
} from './types';

function isEmpty(value: IntakeValue, fieldType?: IntakeField['type']): boolean {
  if (value == null) return true;
  if (typeof value === 'string') {
    if (value.trim() === '') return true;
    // A med_list value can be a non-empty JSON string that is still "blank"
    // (e.g. one or more rows the user added but never filled in) — formatMedList
    // already drops rows with no name and no dose.
    if (fieldType === 'med_list') return formatMedList(value).length === 0;
    return false;
  }
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Format a `med_list` value (JSON string of {name, dose}) into readable lines.
 * Tolerates a legacy plain-text value (newline- or comma-separated). Returns an
 * array of "Name — dose" strings (dose omitted when blank).
 */
export function formatMedList(value: IntakeValue): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const arr = JSON.parse(value);
    if (Array.isArray(arr)) {
      return arr
        .map((m) => [String(m?.name ?? '').trim(), String(m?.dose ?? '').trim()].filter(Boolean).join(' — '))
        .filter(Boolean);
    }
  } catch { /* legacy free text */ }
  return value.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
}

/**
 * One answer as it is read back — the wizard's review screen and the doctor
 * console both use this, so the wording cannot drift apart between the patient
 * who typed it and the clinician who acts on it. An empty "select any that
 * apply" is the answer None, not a blank we failed to record; "—" told the
 * doctor the patient never reached the question.
 */
export function formatIntakeValue(field: IntakeField, value: IntakeValue): string {
  if (Array.isArray(value) && value.length === 0) return field.type === 'multi_select' ? 'None' : '—';
  if (value == null || value === '') return field.type === 'attachment' ? 'Not available' : '—';
  if (field.type === 'boolean') return value ? 'Yes' : 'No';
  if (field.type === 'med_list') {
    const lines = formatMedList(value);
    return lines.length ? lines.join(', ') : '—';
  }
  if (Array.isArray(value)) {
    return value.map((v) => field.options?.find((o) => o.value === v)?.label ?? String(v)).join(', ');
  }
  if (field.options) return field.options.find((o) => o.value === value)?.label ?? String(value);
  return String(value);
}

function validateField(field: IntakeField, value: IntakeValue): string | null {
  if (field.required && isEmpty(value, field.type)) {
    return 'This field is required';
  }
  if (isEmpty(value, field.type)) return null;

  if (field.type === 'number' && typeof value === 'number') {
    if (Number.isNaN(value)) return 'Enter a valid number';
    if (field.min != null && value < field.min) return `Must be at least ${field.min}`;
    if (field.max != null && value > field.max) return `Must be at most ${field.max}`;
  }

  if (field.type === 'date' && typeof value === 'string') {
    if (Number.isNaN(new Date(value).getTime())) return 'Enter a valid date (YYYY-MM-DD)';
  }

  return null;
}

/** Validate every field in a schema; returns a field-id → message map. */
export function validateIntake(schema: IntakeSchema, values: IntakeResponseValues): IntakeErrors {
  const errors: IntakeErrors = {};
  for (const section of schema.sections) {
    for (const field of section.fields) {
      const message = validateField(field, values[field.id] ?? null);
      if (message) errors[field.id] = message;
    }
  }
  return errors;
}

/** First field id that has an error, for scroll-to-error behaviour. */
export function firstErrorFieldId(errors: IntakeErrors): string | undefined {
  return Object.keys(errors)[0];
}

/**
 * A step's fields with the ones answered away by their gate removed. Kept out of
 * `visibleSteps` because that is the step list (progress, review, jump-to-step);
 * this is the field list inside one step.
 */
export function stepFields(step: IntakeStep, values: IntakeResponseValues): IntakeField[] {
  return step.fields.filter((f) => !isGatedOff(f.id, values));
}

/**
 * Applying a gate answer: switching to "No" drops the detail it had unlocked, so
 * a draft can never carry both `conditions_none: false` and a condition list.
 * Answers written by older drafts are reconciled here on the way in.
 */
export function applyGateAnswer(values: IntakeResponseValues, fieldId: string): IntakeResponseValues {
  const details = gatedDetailFields(fieldId);
  if (!details.length || values[fieldId] !== false) return values;
  const next: IntakeResponseValues = { ...values };
  for (const detailId of details) delete next[detailId];
  return next;
}

/** Drop every detail whose gate says "No" — used when loading a stored draft. */
export function reconcileGates(values: IntakeResponseValues): IntakeResponseValues {
  return Object.values(LIST_GATES)
    .filter((gateId, i, all) => all.indexOf(gateId) === i)
    .reduce((acc, gateId) => applyGateAnswer(acc, gateId), values);
}

/** Whether a step's `when` predicate is satisfied by the current answers. */
export function isStepVisible(step: IntakeStep, values: IntakeResponseValues): boolean {
  if (!step.when) return true;
  return matchCondition(step.when, values);
}

function matchCondition(cond: IntakeStepCondition, values: IntakeResponseValues): boolean {
  const v = values[cond.fieldId];
  if ('truthy' in cond) return Boolean(v);
  if ('equals' in cond) return v === cond.equals;
  if ('includes' in cond) return Array.isArray(v) && v.includes(cond.includes);
  return true;
}

/** The ordered subset of steps that should render for the current answers. */
export function visibleSteps(
  schema: PreConsultIntakeSchema,
  values: IntakeResponseValues,
): IntakeStep[] {
  return schema.steps.filter((s) => isStepVisible(s, values));
}

/**
 * The safety-critical list questions pair a boolean ("do you take/have any…?")
 * with the detail it unlocks. `meds_none`/`allergies_none`/`conditions_none` are
 * the ANSWER-YES flags (the names are legacy), so `true` makes the detail
 * required and `false` must make it impossible to hold a value — otherwise the
 * doctor reads "No ongoing conditions" above "Asthma, Hypertension".
 */
const LIST_GATES: Record<string, string> = {
  medications_list: 'meds_none',
  allergies_list: 'allergies_none',
  allergies_other: 'allergies_none',
  conditions_list: 'conditions_none',
  conditions_other: 'conditions_none',
};

/**
 * The subset of gated details the doctor must always read when the gate says
 * yes. The free-text "other" fields are optional enrichments — gating them for
 * requiredness would block the wizard while the list itself is already answered.
 */
const REQUIRED_DETAIL_GATES: Record<string, string> = {
  medications_list: 'meds_none',
  allergies_list: 'allergies_none',
  conditions_list: 'conditions_none',
};

/** Detail fields that belong to a boolean gate, e.g. 'conditions_none' → its list + other. */
export function gatedDetailFields(gateId: string): string[] {
  return Object.keys(LIST_GATES).filter((detailId) => LIST_GATES[detailId] === gateId);
}

/** Whether a detail field is currently answered away by its gate ("No" → hidden, value cleared). */
export function isGatedOff(fieldId: string, values: IntakeResponseValues): boolean {
  const gateId = LIST_GATES[fieldId];
  return gateId != null && values[gateId] === false;
}

/**
 * Pre-Consult field validation. Honours the conditional "none" toggles for the
 * safety-critical med/allergy/condition list fields: if the patient says they
 * DO take meds / DO have allergies, the detail field becomes required.
 */
function validatePreConsultField(
  field: IntakeField,
  value: IntakeValue,
  values: IntakeResponseValues,
): string | null {
  // Conditional requiredness driven by the matching boolean toggle.
  const toggleId = REQUIRED_DETAIL_GATES[field.id];
  if (toggleId && values[toggleId] === true && isEmpty(value, field.type)) {
    return 'Please add at least one, or change your answer above';
  }

  if (field.required && isEmpty(value, field.type)) return 'This field is required';
  if (isEmpty(value, field.type)) return null;

  if (field.type === 'scale' && typeof value === 'number') {
    const min = field.min ?? 1;
    const max = field.max ?? 10;
    if (value < min || value > max) return `Choose a value from ${min} to ${max}`;
  }
  if (field.type === 'number' && typeof value === 'number') {
    // An optional field with a stray NaN (e.g. cleared vitals) must not block.
    if (Number.isNaN(value)) return field.required ? 'Enter a valid number' : null;
    if (field.min != null && value < field.min) return `Must be at least ${field.min}`;
    if (field.max != null && value > field.max) return `Must be at most ${field.max}`;
  }
  if (field.type === 'date' && typeof value === 'string') {
    if (Number.isNaN(new Date(value).getTime())) return 'Enter a valid date (YYYY-MM-DD)';
  }
  return null;
}

/** Validate only the fields in the steps that are currently visible. */
export function validatePreConsult(
  schema: PreConsultIntakeSchema,
  values: IntakeResponseValues,
): IntakeErrors {
  const errors: IntakeErrors = {};
  for (const step of visibleSteps(schema, values)) {
    for (const field of stepFields(step, values)) {
      const message = validatePreConsultField(field, values[field.id] ?? null, values);
      if (message) errors[field.id] = message;
    }
  }
  return errors;
}

/** Validate a single step (used on Next). */
export function validateStep(step: IntakeStep, values: IntakeResponseValues): IntakeErrors {
  const errors: IntakeErrors = {};
  for (const field of stepFields(step, values)) {
    const message = validatePreConsultField(field, values[field.id] ?? null, values);
    if (message) errors[field.id] = message;
  }
  return errors;
}

/**
 * Index (within the visible steps) of the first step that has a validation
 * error — used by M3 "resume draft" to jump to the next unanswered step.
 */
export function firstUnansweredStepIndex(
  schema: PreConsultIntakeSchema,
  values: IntakeResponseValues,
): number {
  const steps = visibleSteps(schema, values);
  for (let i = 0; i < steps.length; i++) {
    if (Object.keys(validateStep(steps[i], values)).length > 0) return i;
  }
  return 0;
}
