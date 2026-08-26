// ─────────────────────────────────────────────────────────────────────────────
// Account prefill for the registration engine.
//
// The applicant already gave these details when they created their account, so
// no registration form should ask for them a second time. This module is the
// single place that maps a Spotlight user profile onto registration field keys
// and records which of those keys the ACCOUNT supplied.
//
// Two rules keep it safe:
//
//   1. Only NON-EMPTY profile values are treated as supplied. A blank column is
//      not an answer, so its field stays asked-for and editable.
//   2. A value that must match a fixed option list (gender, state) is only used
//      when it actually matches. A select cannot display an option it does not
//      have, so an unmatched value would sit invisibly in the draft and be
//      submitted as an answer the applicant never saw — worse than a blank.
//
// Free-text identity — the applicant's own name and phone — is rendered
// read-only, because the account is where those are changed. Everything else is
// pre-filled but still editable: state, city and date of birth are per-
// application answers a user may reasonably restate.
// ─────────────────────────────────────────────────────────────────────────────
import { NIGERIA_STATES } from './reference-data';
import type { RegistrationDraft, RegistrationStep } from './types';

/**
 * Where the list of account-supplied field keys is parked on the draft, so
 * `buildRegistrationSteps` can mark exactly those fields read-only without
 * needing the profile again.
 */
export const ACCOUNT_PROVIDED_KEYS = 'derived.accountProvidedKeys';

/** Shown on every field the account filled in, so the applicant knows why it is locked. */
export const ACCOUNT_FIELD_HELP = 'From your account. Update it in your profile if it has changed.';

/**
 * The fields the account OWNS: pre-filled and locked. Everything else this
 * module pre-fills stays editable.
 *
 * `personal.stageName` is deliberately absent — a stage name is a per-contest
 * choice, not an account fact.
 */
const LOCKED_KEYS = new Set([
  'personal.firstName',
  'personal.lastName',
  'personal.primaryPhone',
  'personal.whatsapp',
  'personal.email',
  'account.email',
]);

/** The profile shape this module needs. Kept structural so tests can pass a literal. */
export interface PrefillProfile {
  email?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  phone?: string;
  whatsapp?: string;
  gender?: string;
  dateOfBirth?: string;
  state?: string;
  address?: string;
  country?: string;
}

function clean(value?: string | null) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Split a single stored name into first/last.
 *
 * A one-word name yields ONLY a first name: guessing that "Patrick" is also the
 * surname would put a wrong answer on the application and lock it in.
 */
function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/**
 * Everything the account can answer on a registration form, plus the keys that
 * came from it. Empty values are dropped, so a caller can spread `values`
 * without blanking anything.
 */
export function buildAccountPrefill(profile: PrefillProfile | null | undefined): {
  values: Record<string, unknown>;
  providedKeys: string[];
} {
  if (!profile) return { values: {}, providedKeys: [] };

  const email = clean(profile.email);
  const explicitFirst = clean(profile.firstName);
  const explicitLast = clean(profile.lastName);
  const stored = clean(profile.displayName);
  // Sign-up records the email as the display name when none was given. That is
  // not a name, so it must not be split into first/last.
  const usableStored = stored && stored.toLowerCase() !== email.toLowerCase() ? stored : '';
  const split = splitName(usableStored);

  const candidates: Record<string, string> = {
    'personal.firstName': explicitFirst || split.firstName,
    'personal.lastName': explicitLast || split.lastName,
    'personal.primaryPhone': clean(profile.phone),
    'personal.whatsapp': clean(profile.whatsapp),
    'personal.dateOfBirth': clean(profile.dateOfBirth),
    'personal.stateOfResidence': matchState(clean(profile.state)),
    // City is deliberately NOT pre-filled: its options are derived from the
    // chosen state, so a stored city is very often absent from the list the
    // applicant is shown — see rule 2 above.
    'personal.address': clean(profile.address),
    // Both keys: `runBasicFraudChecks` reads either, and no contest form collects
    // an email — so before this every registration carried a `missing_email`
    // fraud flag for a detail the account had all along.
    'account.email': email,
    'personal.email': email,
    // Only a value the Gender select can actually display — see the header note.
    'personal.gender': matchGender(clean(profile.gender)),
  };

  const values: Record<string, unknown> = {};
  const providedKeys: string[] = [];
  for (const [key, value] of Object.entries(candidates)) {
    if (!value) continue;
    values[key] = value;
    providedKeys.push(key);
  }

  return { values, providedKeys };
}

/** A state the State of residence select can actually offer. */
function matchState(value: string): string {
  if (!value) return '';
  const lowered = value.toLowerCase();
  return NIGERIA_STATES.find((s) => s.toLowerCase() === lowered) || '';
}

/** The catalog's Gender options, case-insensitively. Anything else is not usable. */
function matchGender(value: string): string {
  const lowered = value.toLowerCase();
  if (lowered === 'female' || lowered === 'f') return 'Female';
  if (lowered === 'male' || lowered === 'm') return 'Male';
  return '';
}

function providedKeysOf(draft: RegistrationDraft): Set<string> {
  const raw = draft.formData?.[ACCOUNT_PROVIDED_KEYS];
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((key): key is string => typeof key === 'string'));
}

/**
 * Lock the fields the account supplied so the form does not ask for them again.
 *
 * Only keys in LOCKED_KEYS are locked; the rest of the prefill stays editable.
 * A field whose value went missing from the draft is left editable too — a
 * locked empty required field would be an unfinishable form.
 */
export function markAccountProvidedFields(
  steps: RegistrationStep[],
  draft: RegistrationDraft,
): RegistrationStep[] {
  const provided = providedKeysOf(draft);
  if (provided.size === 0) return steps;

  return steps.map((step) => ({
    ...step,
    fields: step.fields.map((field) => {
      if (!provided.has(field.key) || !LOCKED_KEYS.has(field.key)) return field;
      const value = draft.formData?.[field.key];
      if (value === undefined || value === null || String(value).trim() === '') return field;
      return { ...field, readOnly: true, helpText: field.helpText || ACCOUNT_FIELD_HELP };
    }),
  }));
}
