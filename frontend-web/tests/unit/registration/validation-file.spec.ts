/**
 * Required `file` fields must accept BOTH client shapes:
 *  - web wizard stores the preview URL as a plain string
 *  - mobile app stores an object { previewUrl, fileName, storageKey }
 * Regression guard for uploads that succeeded but blocked submission.
 */
import { describe, it, expect } from 'vitest';
import { validateStepData } from '@/src/features/registration/validation';
import type { RegistrationStep } from '@/src/features/registration/types';

const step: RegistrationStep = {
  key: 'category_specific',
  title: 'Requirements',
  description: '',
  fields: [
    { key: 'media.profilePhoto', label: 'Profile photo', type: 'file', required: true },
    { key: 'media.introVideo', label: 'Intro video', type: 'file' },
  ],
};

describe('file field validation', () => {
  it('accepts an object-shaped uploaded value (mobile client)', () => {
    const res = validateStepData(step, {
      'media.profilePhoto': { previewUrl: '/api/registration/uploads/abc', fileName: 'id.png', storageKey: 'registration/u/1.png' },
    });
    expect(res.isValid).toBe(true);
    expect(res.errors['media.profilePhoto']).toBeUndefined();
  });

  it('accepts a string URL value (web client)', () => {
    const res = validateStepData(step, { 'media.profilePhoto': '/api/registration/uploads/abc' });
    expect(res.isValid).toBe(true);
  });

  it('flags a missing required file', () => {
    const res = validateStepData(step, {});
    expect(res.isValid).toBe(false);
    expect(res.errors['media.profilePhoto']).toContain('required');
  });

  it('does not flag an optional file left empty', () => {
    const res = validateStepData(step, { 'media.profilePhoto': 'x' });
    expect(res.errors['media.introVideo']).toBeUndefined();
  });
});
