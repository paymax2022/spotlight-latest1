/**
 * Unit tests for the admin-configurable registration form schema.
 * Verifies that when a contest carries a `formSchema`, the contestant sees
 * exactly the mapped inputs — and that contests without a schema fall back to
 * their tailored per-contest template.
 */
import { describe, it, expect } from 'vitest';
import { buildRegistrationSteps } from '@/src/features/registration/config';
import type { RegistrationDraft } from '@/src/features/registration/types';

function makeDraft(overrides: Partial<RegistrationDraft> = {}): RegistrationDraft {
  return {
    id: 'app-1',
    reference: 'REF-1',
    contestSlug: 'custom-contest',
    status: 'draft',
    role: 'public_user',
    createdAt: '2026-07-04T00:00:00Z',
    updatedAt: '2026-07-04T00:00:00Z',
    formData: {},
    completionPercent: 0,
    fraudFlags: [],
    ...overrides,
  };
}

function stepFieldKeys(steps: ReturnType<typeof buildRegistrationSteps>, key: string) {
  return steps.find((s) => s.key === key)?.fields.map((f) => f.key) ?? [];
}

describe('schema-driven registration form', () => {
  it('shows only the admin-selected catalog fields plus fixed steps', () => {
    const draft = makeDraft({
      formData: {
        'derived.formSchema': {
          version: 1,
          includedFields: ['personal.firstName', 'personal.lastName', 'identity.idType', 'identity.idUpload'],
          requiredOverrides: { 'identity.idType': false },
          customFields: [
            { key: 'custom.instrument', label: 'Instrument', type: 'text', step: 'category_specific', required: true },
          ],
        },
      },
    });

    const steps = buildRegistrationSteps(draft);
    // Account registration step is intentionally absent — the applicant is
    // already an authenticated Paymax user before reaching this form.
    expect(steps.map((s) => s.key)).toEqual([
      'contest_selection',
      'personal_information',
      'category_specific',
      'review_submit',
    ]);
    expect(steps.some((s) => s.key === 'account_gate')).toBe(false);

    // Personal step: only the two selected personal fields, nothing else (no talent.*)
    expect(stepFieldKeys(steps, 'personal_information')).toEqual(['personal.firstName', 'personal.lastName']);

    // Requirements step: selected identity fields + the custom question, in order
    expect(stepFieldKeys(steps, 'category_specific')).toEqual([
      'identity.idType',
      'identity.idUpload',
      'custom.instrument',
    ]);

    // Fixed legal step is always present
    expect(stepFieldKeys(steps, 'review_submit')).toContain('legal.termsConsent');
    expect(stepFieldKeys(steps, 'review_submit')).toContain('review.confirmSubmit');
  });

  it('honors required overrides and custom-field required flag', () => {
    const draft = makeDraft({
      formData: {
        'derived.formSchema': {
          version: 1,
          includedFields: ['identity.idType'],
          requiredOverrides: { 'identity.idType': false },
          customFields: [{ key: 'custom.q1', label: 'Q1', type: 'text', step: 'category_specific', required: true }],
        },
      },
    });
    const cat = buildRegistrationSteps(draft).find((s) => s.key === 'category_specific')!;
    expect(cat.fields.find((f) => f.key === 'identity.idType')?.required).toBe(false);
    expect(cat.fields.find((f) => f.key === 'custom.q1')?.required).toBe(true);
  });

  it('renders guardian catalog fields only for minors', () => {
    const base = {
      'derived.formSchema': {
        version: 1,
        includedFields: ['personal.firstName', 'guardian.fullName'],
      },
      'derived.legalAdultAge': 18,
    };

    const adult = buildRegistrationSteps(makeDraft({ formData: { ...base, 'derived.age': 25 } }));
    expect(stepFieldKeys(adult, 'personal_information')).toEqual(['personal.firstName']);

    const minor = buildRegistrationSteps(makeDraft({ formData: { ...base, 'derived.age': 15 } }));
    expect(stepFieldKeys(minor, 'personal_information')).toEqual(['personal.firstName', 'guardian.fullName']);
  });

  it('falls back to the tailored template when no schema is present', () => {
    const stem = buildRegistrationSteps(makeDraft({ contestSlug: 'stem-contest', formData: {} }));
    expect(stepFieldKeys(stem, 'category_specific')).toContain('category.projectTitle');

    const unknown = buildRegistrationSteps(makeDraft({ contestSlug: 'nope', formData: {} }));
    // default builder still yields the 5 canonical steps
    expect(unknown.map((s) => s.key)).toContain('category_specific');
  });
});
