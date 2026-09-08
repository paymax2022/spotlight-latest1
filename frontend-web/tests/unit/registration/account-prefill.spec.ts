/**
 * The applicant gave their details at sign-up. This module decides which of them
 * a registration form may stop asking for — so its edge cases are the difference
 * between "the form is shorter" and "the form is unfinishable".
 */
import { describe, it, expect } from 'vitest';
import {
  ACCOUNT_PROVIDED_KEYS,
  buildAccountPrefill,
  markAccountProvidedFields,
} from '@/src/features/registration/account-prefill';
import type { RegistrationDraft, RegistrationStep } from '@/src/features/registration/types';

function draftWith(formData: Record<string, unknown>): RegistrationDraft {
  return {
    id: 'draft-1',
    reference: 'REF-1',
    contestSlug: 'open-mic-competition',
    status: 'draft',
    role: 'public_user',
    userId: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    formData,
    completionPercent: 0,
    currentStep: 'personal_information',
    fraudFlags: [],
  } as unknown as RegistrationDraft;
}

const personalStep = (): RegistrationStep[] => [
  {
    key: 'personal_information',
    title: 'Personal information',
    fields: [
      { key: 'personal.firstName', label: 'First name', type: 'text', required: true },
      { key: 'personal.lastName', label: 'Last name', type: 'text', required: true },
      { key: 'personal.primaryPhone', label: 'Primary phone number', type: 'tel', required: true },
      { key: 'personal.stateOfResidence', label: 'State of residence', type: 'select', required: true },
    ],
  } as RegistrationStep,
];

describe('buildAccountPrefill', () => {
  it('splits a stored full name into first and last', () => {
    const { values, providedKeys } = buildAccountPrefill({ displayName: 'Ada Chi Okafor' });
    expect(values['personal.firstName']).toBe('Ada');
    expect(values['personal.lastName']).toBe('Chi Okafor');
    expect(providedKeys).toContain('personal.lastName');
  });

  it('does not invent a surname from a one-word name', () => {
    const { values, providedKeys } = buildAccountPrefill({ displayName: 'Patrick' });
    expect(values['personal.firstName']).toBe('Patrick');
    // Guessing "Patrick Patrick" would put a wrong answer on the application
    // and — because the field is locked — leave no way to correct it.
    expect(values['personal.lastName']).toBeUndefined();
    expect(providedKeys).not.toContain('personal.lastName');
  });

  it('ignores a display name that is just the account email', () => {
    const { values } = buildAccountPrefill({
      email: 'ada@example.com',
      displayName: 'ada@example.com',
    });
    expect(values['personal.firstName']).toBeUndefined();
    expect(values['account.email']).toBe('ada@example.com');
  });

  it('prefers explicit first/last columns over the stored full name', () => {
    const { values } = buildAccountPrefill({
      firstName: 'Ada',
      lastName: 'Okafor',
      displayName: 'Someone Else',
    });
    expect(values['personal.firstName']).toBe('Ada');
    expect(values['personal.lastName']).toBe('Okafor');
  });

  it('drops blank profile columns instead of reporting them as answered', () => {
    const { values, providedKeys } = buildAccountPrefill({ phone: '   ', address: '' });
    expect(values['personal.primaryPhone']).toBeUndefined();
    expect(providedKeys).toEqual([]);
  });

  it('only uses a gender the Gender select can display', () => {
    expect(buildAccountPrefill({ gender: 'female' }).values['personal.gender']).toBe('Female');
    // A free-text value the option list has no entry for would render blank in a
    // select, so it is not treated as an answer at all.
    expect(buildAccountPrefill({ gender: 'Non-binary' }).values['personal.gender']).toBeUndefined();
  });

  it('only uses a state the State select can offer', () => {
    expect(buildAccountPrefill({ state: 'lagos' }).values['personal.stateOfResidence']).toBe('Lagos');
    // "Lagos State" is not one of the options, and a select cannot show what it
    // does not have — leaving it unset makes the applicant pick, visibly.
    expect(buildAccountPrefill({ state: 'Lagos State' }).values['personal.stateOfResidence'])
      .toBeUndefined();
  });

  it('never pre-fills the city', () => {
    // City options come from the chosen state, so a stored city is routinely
    // absent from the list shown — it would submit an answer nobody saw.
    // `city` is not even part of PrefillProfile any more — passed here to pin
    // that a stored city cannot reach the form by any route.
    const profile = { state: 'Lagos', city: 'Ikeja' } as Record<string, string>;
    const { values } = buildAccountPrefill(profile);
    expect(values['personal.city']).toBeUndefined();
  });

  it('fills the email under both keys the engine reads', () => {
    // runBasicFraudChecks reads personal.email OR account.email, and no contest
    // form collects one — every registration used to be flagged missing_email.
    const { values } = buildAccountPrefill({ email: 'ada@example.com' });
    expect(values['account.email']).toBe('ada@example.com');
    expect(values['personal.email']).toBe('ada@example.com');
  });

  it('returns nothing for a missing profile', () => {
    expect(buildAccountPrefill(null)).toEqual({ values: {}, providedKeys: [] });
  });
});

describe('markAccountProvidedFields', () => {
  it('locks the identity fields the account supplied', () => {
    const draft = draftWith({
      'personal.firstName': 'Ada',
      'personal.primaryPhone': '08012345678',
      [ACCOUNT_PROVIDED_KEYS]: ['personal.firstName', 'personal.primaryPhone'],
    });
    const fields = markAccountProvidedFields(personalStep(), draft)[0].fields;

    expect(fields.find((f) => f.key === 'personal.firstName')?.readOnly).toBe(true);
    expect(fields.find((f) => f.key === 'personal.primaryPhone')?.readOnly).toBe(true);
    // Never asked for again, but the applicant must still see why it is locked.
    expect(fields.find((f) => f.key === 'personal.firstName')?.helpText).toMatch(/your account/i);
  });

  it('leaves fields the account did not supply editable', () => {
    const draft = draftWith({
      'personal.firstName': 'Ada',
      [ACCOUNT_PROVIDED_KEYS]: ['personal.firstName'],
    });
    const fields = markAccountProvidedFields(personalStep(), draft)[0].fields;
    expect(fields.find((f) => f.key === 'personal.lastName')?.readOnly).toBeUndefined();
  });

  it('never locks a field the applicant may still need to answer', () => {
    // Claimed as provided, but the value is gone — locking it here would leave a
    // required field empty and un-editable, i.e. a form that cannot be submitted.
    const draft = draftWith({
      'personal.firstName': '',
      [ACCOUNT_PROVIDED_KEYS]: ['personal.firstName'],
    });
    const fields = markAccountProvidedFields(personalStep(), draft)[0].fields;
    expect(fields.find((f) => f.key === 'personal.firstName')?.readOnly).toBeUndefined();
  });

  it('does not lock per-application answers, only account facts', () => {
    const draft = draftWith({
      'personal.stateOfResidence': 'Lagos',
      [ACCOUNT_PROVIDED_KEYS]: ['personal.stateOfResidence'],
    });
    const fields = markAccountProvidedFields(personalStep(), draft)[0].fields;
    // Pre-filled for convenience, but a state is a thing an applicant may restate.
    expect(fields.find((f) => f.key === 'personal.stateOfResidence')?.readOnly).toBeUndefined();
  });

  it('leaves steps untouched for a draft with no account prefill', () => {
    const steps = personalStep();
    expect(markAccountProvidedFields(steps, draftWith({}))).toBe(steps);
  });
});
