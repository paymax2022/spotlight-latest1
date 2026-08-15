import type { RegistrationField, RegistrationStep } from '../types/registration.types';

const EMAIL_RE = /.+@.+\..+/;
const E164_RE = /^\+?[0-9][0-9\-\s]{6,}$/;

function getString(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function hasUploadValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    return Boolean(
      (typeof v.previewUrl === 'string' && v.previewUrl.trim()) ||
      (typeof v.signedPreviewUrl === 'string' && v.signedPreviewUrl.trim()) ||
      (typeof v.storageKey === 'string' && v.storageKey.trim()) ||
      (typeof v.storagePath === 'string' && v.storagePath.trim()) ||
      (typeof v.url === 'string' && v.url.trim())
    );
  }
  return false;
}

export function validateField(field: RegistrationField, value: unknown): string | null {
  if (field.type === 'checkbox') {
    if (field.required && value !== true) {
      return `${field.label} is required.`;
    }
    return null;
  }

  if (field.type === 'multi_select') {
    const arr = Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
    if (field.required && arr.length === 0) {
      return `${field.label} is required.`;
    }
    if (arr.length > 0 && Array.isArray(field.options) && field.options.length > 0) {
      for (const item of arr) {
        if (!field.options.includes(item)) {
          return `Please select valid options for ${field.label}.`;
        }
      }
    }
    return null;
  }

  if (field.type === 'number') {
    if (field.required && (value === null || value === undefined || value === '')) {
      return `${field.label} is required.`;
    }
    if (value === null || value === undefined || value === '') return null;
    const num = typeof value === 'number' ? value : Number(String(value).trim());
    if (Number.isNaN(num)) {
      return `${field.label} must be a number.`;
    }
    return null;
  }

  if (field.type === 'file') {
    if (field.required && !hasUploadValue(value)) {
      return `${field.label} is required.`;
    }
    return null;
  }

  const text = getString(value);
  if (field.required && !text) {
    return `${field.label} is required.`;
  }
  if (!text) return null;

  if (field.type === 'email' && !EMAIL_RE.test(text)) {
    return `Please enter a valid email for ${field.label}.`;
  }
  if (field.type === 'tel' && !E164_RE.test(text)) {
    return `Please enter a valid phone number for ${field.label}.`;
  }
  if (field.type === 'url') {
    try {
      const u = new URL(text);
      if (!u.protocol.startsWith('http')) return `Please enter a valid URL for ${field.label}.`;
    } catch {
      return `Please enter a valid URL for ${field.label}.`;
    }
  }
  if (field.type === 'date') {
    const d = new Date(text);
    if (Number.isNaN(d.getTime())) {
      return `${field.label} must be a valid date.`;
    }
  }
  if (field.type === 'select' && Array.isArray(field.options) && field.options.length > 0) {
    if (!field.options.includes(text)) {
      return `Please select a valid option for ${field.label}.`;
    }
  }

  return null;
}

export function validateStep(step: RegistrationStep, formData: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of step.fields) {
    const error = validateField(field, formData[field.key]);
    if (error) {
      errors[field.key] = error;
    }
  }

  return errors;
}

export function validateRequiredFields(
  step: RegistrationStep,
  formData: Record<string, unknown>,
  edits: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const mergedData = { ...formData, ...edits };

  for (const field of step.fields) {
    if (!field.required || field.readOnly) continue;

    const value = mergedData[field.key];
    const error = validateField(field, value);
    if (error) {
      errors[field.key] = error;
    }
  }

  return errors;
}

export function areAllRequiredFieldsFilled(
  step: RegistrationStep,
  formData: Record<string, unknown>,
  edits: Record<string, unknown>,
): boolean {
  const mergedData = { ...formData, ...edits };
  const errors = validateRequiredFields(step, formData, edits);
  return Object.keys(errors).length === 0;
}

export function getRequiredFieldsForStep(
  step: RegistrationStep,
): Array<{ key: string; label: string }> {
  return step.fields
    .filter((f) => f.required && !f.readOnly)
    .map((f) => ({ key: f.key, label: f.label }));
}
