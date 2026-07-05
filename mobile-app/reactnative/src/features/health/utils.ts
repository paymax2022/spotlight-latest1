// ── Paymax Health — Shared utilities ─────────────────────────────────────────
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

function isEmpty(value: IntakeValue): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
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

function validateField(field: IntakeField, value: IntakeValue): string | null {
  if (field.required && isEmpty(value)) {
    return 'This field is required';
  }
  if (isEmpty(value)) return null;

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

// ── Pre-Consult wizard: conditional steps + step-scoped validation ────────────

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
  const conditionalRequired: Record<string, string> = {
    medications_list: 'meds_none',
    allergies_list: 'allergies_none',
    conditions_list: 'conditions_none',
  };
  const toggleId = conditionalRequired[field.id];
  if (toggleId && values[toggleId] === true && isEmpty(value)) {
    return 'Please add at least one, or change your answer above';
  }

  if (field.required && isEmpty(value)) return 'This field is required';
  if (isEmpty(value)) return null;

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
    for (const field of step.fields) {
      const message = validatePreConsultField(field, values[field.id] ?? null, values);
      if (message) errors[field.id] = message;
    }
  }
  return errors;
}

/** Validate a single step (used on Next). */
export function validateStep(step: IntakeStep, values: IntakeResponseValues): IntakeErrors {
  const errors: IntakeErrors = {};
  for (const field of step.fields) {
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
