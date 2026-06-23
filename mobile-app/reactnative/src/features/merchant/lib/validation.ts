// ── Merchant Onboarding — pure form-schema validation ────────────────────────
// Dependency-free (type-only imports). Mirrors the server validator so the
// wizard validates client-side against the SAME rules (FR-12). Unit-tested.

import type { ApplicationData, FormField, FormStep, StepValidationResult } from '@/types/merchant';

/** Whether a field is currently visible given the data (conditional logic FR-10). */
export function isFieldVisible(field: FormField, data: ApplicationData): boolean {
  if (!field.visibleWhen) return true;
  return data[field.visibleWhen.field] === field.visibleWhen.equals;
}

export function isEmpty(v: unknown): boolean {
  return (
    v === null || v === undefined || v === '' ||
    (Array.isArray(v) && v.length === 0)
  );
}

export function validateStep(step: FormStep, data: ApplicationData): StepValidationResult {
  const errors: Record<string, string> = {};
  for (const field of step.fields) {
    if (!isFieldVisible(field, data)) continue;
    const value = data[field.key];

    if (field.required && isEmpty(value)) {
      errors[field.key] = `${field.label} is required`;
      continue;
    }
    if (isEmpty(value)) continue;

    switch (field.type) {
      case 'number':
      case 'currency': {
        const n = typeof value === 'number' ? value : Number(value);
        if (Number.isNaN(n)) errors[field.key] = `${field.label} must be a number`;
        else if (field.min != null && n < field.min) errors[field.key] = `${field.label} must be at least ${field.min}`;
        else if (field.max != null && n > field.max) errors[field.key] = `${field.label} must be at most ${field.max}`;
        break;
      }
      case 'email':
        if (typeof value === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
          errors[field.key] = 'Enter a valid email';
        break;
      case 'phone':
        if (typeof value === 'string' && value.replace(/\D/g, '').length < 10)
          errors[field.key] = 'Enter a valid phone number';
        break;
      case 'multiselect':
        if (Array.isArray(value) && field.maxSelections && value.length > field.maxSelections)
          errors[field.key] = `Choose at most ${field.maxSelections}`;
        break;
      default:
        break;
    }
  }
  return { ok: Object.keys(errors).length === 0, errors };
}
