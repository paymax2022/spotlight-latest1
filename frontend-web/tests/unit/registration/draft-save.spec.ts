import { describe, it, expect } from 'vitest';
import {
  DRAFT_CHECKPOINT_STEP_KEY,
  buildDraftSaveBody,
  draftSaveSucceeded,
} from '@/src/features/registration/draft-save';
import { buildRealityTvShowSteps } from '@/src/features/registration/forms/reality-tv-show';
import type { RegistrationDraft } from '@/src/features/registration/types';

describe('registration draft-save contract (PATCH /api/registration/applications/[id])', () => {
  it('sends the { stepKey, values } body the PATCH handler requires', () => {
    const body = buildDraftSaveBody({ 'personal.firstName': 'Ada' });
    expect(body).toEqual({
      stepKey: 'contest_selection',
      values: { 'personal.firstName': 'Ada' },
    });
    // The route 400s without both keys.
    expect(body.stepKey).toBeTruthy();
    expect(typeof body.values).toBe('object');
  });

  it('checkpoint step exists on every reality-tv draft shape', () => {
    const draft = {
      id: 'x', reference: 'R', contestSlug: 'reality-tv-show', status: 'draft',
      role: 'public_user', createdAt: '', updatedAt: '',
      formData: { 'derived.age': 20 }, completionPercent: 0, fraudFlags: [],
    } as RegistrationDraft;
    const keys = buildRealityTvShowSteps(draft).map((s) => s.key);
    expect(keys).toContain(DRAFT_CHECKPOINT_STEP_KEY);
  });

  it('treats a 200 with validation.isValid === false as NOT persisted', () => {
    // saveRegistrationStep returns the merged draft without writing when the
    // named step fails validation — this shape must not count as saved.
    expect(draftSaveSucceeded({ success: true, validation: { isValid: false } })).toBe(false);
  });

  it('accepts a successful, validated save', () => {
    expect(draftSaveSucceeded({ success: true, validation: { isValid: true } })).toBe(true);
    expect(draftSaveSucceeded({ success: true })).toBe(true);
  });

  it('rejects error shapes', () => {
    expect(draftSaveSucceeded({ success: false })).toBe(false);
    expect(draftSaveSucceeded({})).toBe(false);
    expect(draftSaveSucceeded(null)).toBe(false);
    expect(draftSaveSucceeded(undefined)).toBe(false);
  });
});
