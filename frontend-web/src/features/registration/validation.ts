import type { RegistrationDraft, RegistrationField, RegistrationStep } from './types';
import { NIGERIA_CITIES_BY_STATE } from './config';

const EMAIL_RE = /.+@.+\..+/;
const E164ish_RE = /^\+?[0-9][0-9\-\s]{6,}$/;

function getString(value: unknown) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

// A `file` field's value differs by client: the web wizard stores the preview
// URL as a plain string, while the mobile app stores an object
// ({ previewUrl, fileName, storageKey }). Treat either shape as "a file is
// present" so a required upload doesn't spuriously fail validation.
function hasUploadValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    return Boolean(
      (typeof v.previewUrl === 'string' && v.previewUrl.trim()) ||
      (typeof v.signedPreviewUrl === 'string' && v.signedPreviewUrl.trim()) ||
      (typeof v.storageKey === 'string' && v.storageKey.trim()) ||
      (typeof v.storagePath === 'string' && v.storagePath.trim()) ||
      (typeof v.url === 'string' && v.url.trim()),
    );
  }
  return false;
}

function validateField(field: RegistrationField, value: unknown): string | null {
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
  if (field.type === 'tel' && !E164ish_RE.test(text)) {
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

export function validateStepData(step: RegistrationStep, formData: Record<string, unknown>) {
  const errors: Record<string, string> = {};

  for (const field of step.fields) {
    const error = validateField(field, formData[field.key]);
    if (error) {
      errors[field.key] = error;
    }
  }

  if (step.key === 'account_gate') {
    const password = getString(formData['account.password']);
    const confirm = getString(formData['account.confirmPassword']);
    if (password && password.length < 8) {
      errors['account.password'] = 'Password must contain at least 8 characters.';
    }
    if (password !== confirm) {
      errors['account.confirmPassword'] = 'Password confirmation does not match.';
    }
  }

  if (step.key === 'emergency_contact') {
    const applicantPhone = getString(formData['personal.primaryPhone']);
    const emergencyPhone = getString(formData['emergency.phone']);
    if (applicantPhone && emergencyPhone && applicantPhone === emergencyPhone) {
      errors['emergency.phone'] = 'Emergency contact phone should be different from applicant phone.';
    }
  }

  if (step.key === 'contest_selection') {
    const contestTitle = getString(formData['contest.title']);
    const contestTitles = Array.isArray(formData['derived.availableContestTitles'])
      ? (formData['derived.availableContestTitles'] as string[])
      : [];
    if (!contestTitle || (contestTitles.length > 0 && !contestTitles.includes(contestTitle))) {
      errors['contest.title'] = 'Please select a valid contest title from active contests.';
    }
    const region = getString(formData['contest.region']);
    const auditionStates = Array.isArray(formData['derived.auditionStates'])
      ? (formData['derived.auditionStates'] as string[])
      : [];
    if (auditionStates.length > 0 && region && !auditionStates.includes(region)) {
      errors['contest.region'] = 'Please select a valid audition state.';
    }

    const applicantCategory = getString(formData['contest.applicantCategory']);
    const categories = Array.isArray(formData['derived.applicantCategories'])
      ? (formData['derived.applicantCategories'] as string[])
      : [];
    if (categories.length > 0 && applicantCategory && !categories.includes(applicantCategory)) {
      errors['contest.applicantCategory'] = 'Please select a valid applicant category.';
    }
  }

  const stateCityPairs: Array<{ stateKey: string; cityKey: string; label: string }> = [
    { stateKey: 'account.state', cityKey: 'account.city', label: 'account city' },
    { stateKey: 'personal.stateOfResidence', cityKey: 'personal.city', label: 'city / town' },
    { stateKey: 'emergency.state', cityKey: 'emergency.city', label: 'emergency city' },
    { stateKey: 'contest.region', cityKey: 'contest.preferredAuditionCity', label: 'preferred audition city' },
    { stateKey: 'audition.state', cityKey: 'audition.city', label: 'audition city' },
  ];

  for (const pair of stateCityPairs) {
    const state = getString(formData[pair.stateKey]);
    const city = getString(formData[pair.cityKey]);
    if (!state || !city) continue;
    const allowedCities = NIGERIA_CITIES_BY_STATE[state] || [];
    if (allowedCities.length > 0 && !allowedCities.includes(city)) {
      errors[pair.cityKey] = `Please select a valid ${pair.label} for the selected state.`;
    }
  }

  if (step.key === 'payment') {
    const status = getString(formData['payment.paymentStatus']);
    const tx = getString(formData['payment.transactionReference']);
    if (status === 'paid' && !tx) {
      errors['payment.transactionReference'] = 'Transaction reference is required for paid status.';
    }
  }

  // payment.method is enforced HERE — at payment time — rather than by being a
  // required field on the wizard step that happens to contain it.
  //
  // It was `required: true`, and the only writer of the value is the
  // payment-success path (applyRegistrationPaymentSuccess), which runs AFTER the
  // wizard. The step therefore gated on a value that could not exist yet. On web
  // the wizard renders the select and the applicant picks one, which hid the
  // circularity; the mobile wizard deliberately omits payment fields (it has a
  // dedicated payment screen), so there the step was impossible to pass — Save &
  // continue looked inert, because validation failed on a field never rendered.
  //
  // Keyed off the field's presence rather than a step key: it lives on
  // `category_specific` in the shipped forms, while the `step.key === 'payment'`
  // branch above only fires for form shapes that have a dedicated payment step.
  if (step.fields.some((field) => field.key === 'payment.method')) {
    const paymentStatus = getString(formData['payment.paymentStatus']);
    if (paymentStatus === 'paid' && !getString(formData['payment.method'])) {
      errors['payment.method'] = 'Payment method is required once payment is recorded.';
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export function calculateCompletionPercent(steps: RegistrationStep[], formData: Record<string, unknown>) {
  const requiredKeys = steps.flatMap((step) => step.fields.filter((field) => field.required).map((field) => field.key));
  if (requiredKeys.length === 0) return 0;

  let completed = 0;
  for (const key of requiredKeys) {
    const value = formData[key];
    if (typeof value === 'boolean') {
      if (value) completed += 1;
      continue;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      completed += 1;
      continue;
    }
    if (typeof value === 'number' && !Number.isNaN(value)) {
      completed += 1;
      continue;
    }
    if (Array.isArray(value) && value.length > 0) {
      completed += 1;
      continue;
    }
    // Object-shaped uploaded file (mobile client stores { previewUrl, ... }).
    if (value && typeof value === 'object' && hasUploadValue(value)) {
      completed += 1;
    }
  }

  return Math.min(100, Math.round((completed / requiredKeys.length) * 100));
}

export function deriveAge(dateOfBirth: unknown) {
  const dob = getString(dateOfBirth);
  if (!dob) return null;
  const date = new Date(dob);
  if (Number.isNaN(date.getTime())) return null;

  const now = new Date();
  let age = now.getFullYear() - date.getFullYear();
  const monthDiff = now.getMonth() - date.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < date.getDate())) {
    age -= 1;
  }

  if (age < 0 || age > 120) return null;
  return age;
}

export function runBasicFraudChecks(draft: RegistrationDraft) {
  const flags: string[] = [];
  const formData = draft.formData;

  const idNumber = getString(formData['identity.idNumber']);
  const phone = getString(formData['personal.primaryPhone']);
  const email = getString(formData['personal.email'] || formData['account.email']);

  if (!email) flags.push('missing_email');
  if (!phone) flags.push('missing_phone');
  if (!idNumber) flags.push('missing_id_number');

  const consentGranted = formData['guardian.consentGranted'] === true;
  const age = Number(formData['derived.age'] || 0);
  const threshold = Number(formData['derived.legalAdultAge'] || 18);
  if (age > 0 && age < threshold && !consentGranted) {
    flags.push('underage_without_guardian_consent');
  }

  return flags;
}
