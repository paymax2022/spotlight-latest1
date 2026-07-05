import { describe, it, expect } from 'vitest';
import { buildRegistrationSteps } from '@/src/features/registration/config';
import type { RegistrationDraft } from '@/src/features/registration/types';

function draft(formData: Record<string, unknown>, contestSlug = 'reality-tv-show'): RegistrationDraft {
  return {
    id: 'x', reference: 'R', contestSlug, status: 'draft', role: 'public_user',
    createdAt: '', updatedAt: '', formData, completionPercent: 0, fraudFlags: [],
  };
}

describe('buildRegistrationSteps does not throw for realistic drafts', () => {
  it('reality-tv with formSchema null (as the store writes it)', () => {
    expect(() => buildRegistrationSteps(draft({ 'derived.formSchema': null, 'derived.age': 20 }))).not.toThrow();
  });

  it('schema-driven with custom fields + object file values', () => {
    const d = draft({
      'derived.age': 15,
      'derived.legalAdultAge': 18,
      'derived.formSchema': {
        version: 1,
        includedFields: ['personal.firstName', 'identity.idUpload', 'guardian.fullName'],
        requiredOverrides: { 'identity.idUpload': true },
        customFields: [{ key: 'custom.q', label: 'Q', type: 'select', step: 'category_specific', options: ['a', 'b'] }],
      },
      'identity.idUpload': { previewUrl: '/x', fileName: 'a.png', storageKey: 'k' },
    }, 'some-admin-contest');
    expect(() => buildRegistrationSteps(d)).not.toThrow();
  });

  it('unknown slug + empty formData', () => {
    expect(() => buildRegistrationSteps(draft({}, 'nope'))).not.toThrow();
  });

  it('formSchema present but malformed (includedFields not array)', () => {
    expect(() => buildRegistrationSteps(draft({ 'derived.formSchema': { version: 1 } }, 'stem-contest'))).not.toThrow();
  });
});
