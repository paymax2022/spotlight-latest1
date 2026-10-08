// AUD-FE-009 — proves the bespoke RealityTvShowApplicationWizard's field map
// produces every key the server-side schema requires, with values the REAL
// validator (validateStepData — the same function submitRegistrationApplication
// re-runs on every step) accepts. This is the regression net for both halves
// of the original bug: missing fields AND rendered-but-invalid values
// ('Prefer not to say' gender, '5+ years' experience, 'Mentor' relationship,
// publicVotingConsent under the wrong namespace).
import { describe, it, expect } from 'vitest';
import { buildRealityTvShowSteps } from '@/src/features/registration/forms/reality-tv-show';
import {
  REALITY_TV_WIZARD_INITIAL,
  REALITY_TV_WIZARD_STEP_SAVE_KEY,
  flatErrorKeyToFormKey,
  realityTvWizardFormToFlat,
  realityTvWizardHydrate,
  realityTvWizardSchemaErrors,
  validateRealityTvWizardStep,
  type RealityTvWizardForm,
} from '@/src/features/registration/reality-tv-show-wizard-map';
import type { RegistrationDraft } from '@/src/features/registration/types';

function draftForAge(age: number): RegistrationDraft {
  return {
    id: 'd1', reference: 'R1', contestSlug: 'reality-tv-show', status: 'draft',
    role: 'public_user', createdAt: '', updatedAt: '',
    formData: { 'derived.age': age },
    completionPercent: 0, fraudFlags: [],
  };
}

function dobForAge(age: number): string {
  // Mid-January keeps the birthday check deterministic for ages we pick far
  // from the 18 boundary in either direction.
  return `${new Date().getFullYear() - age}-01-15`;
}

// Values server-side saveRegistrationStep stamps before validating (contest
// lock, fee quote) — the wizard is not expected to emit them.
const SERVER_STAMPED = new Set(['contest.title', 'payment.feeAmount']);

function completeAdultForm(): RealityTvWizardForm {
  return {
    ...REALITY_TV_WIZARD_INITIAL,
    personal_firstName: 'Ada',
    personal_lastName: 'Obi',
    personal_dateOfBirth: dobForAge(30),
    personal_gender: 'Female',
    personal_nationality: 'Nigerian',
    personal_stateOfOrigin: 'Lagos',
    personal_stateOfResidence: 'Lagos',
    personal_city: 'Ikeja',
    personal_primaryPhone: '+2348012345678',
    personal_address: '12 Bourdillon Rd, Ikoyi',
    media_profilePhotoUrl: '/api/registration/uploads/cGhvdG8',
    media_profilePhotoName: 'photo.jpg',

    talent_primarySkill: ['Singing'],
    talent_experienceYears: '3',
    talent_skillLevel: 'Intermediate',
    talent_strengths: 'Stage presence and crowd work',
    talent_careerGoal: 'Become a household name',
    talent_uniqueStory: 'Self-taught from church choir',

    category_uniqueStory: 'Authentic, watchable, unfiltered',
    identity_idType: 'National ID',
    identity_idUploadUrl: '/api/registration/uploads/aWR1cGxvYWQ',
    identity_idUploadName: 'id.png',
    media_rightsConfirmed: true,
    audition_format: 'Online video submission',
    publicProfile_publicVotingConsent: true,

    bootcamp_availableFullPeriod: 'Fully available',
    bootcamp_canTravel: true,
    category_housemateReadiness: true,
    category_dailyFilmingConsent: true,
    medical_generalHealthStatus: ['Generally healthy'],
    medical_emergencyTreatmentConsent: true,
    emergency_fullName: 'Ngozi Obi',
    emergency_relationship: 'Parent',
    emergency_phone: '+2348098765432',
    emergency_state: 'Lagos',
    emergency_city: 'Ikeja',
    compliance_codeOfConductAgreement: true,
    compliance_backgroundCheckAgreement: true,
    compliance_truthDeclaration: true,

    legal_accuracyDeclaration: true,
    legal_termsConsent: true,
    legal_privacyConsent: true,
    legal_mediaRelease: true,
    legal_publicVotingConsent: true,
    legal_sponsorActivationConsent: true,
    legal_productionRulesConsent: true,
    legal_disqualificationAcknowledgment: true,
    legal_ageGuardianConfirmation: true,
    legal_communicationConsent: true,
    review_confirmSubmit: true,
  };
}

function requiredKeysForAge(age: number): string[] {
  return buildRealityTvShowSteps(draftForAge(age))
    .flatMap((step) => step.fields.filter((f) => f.required).map((f) => f.key));
}

describe('reality-tv-show wizard field map (AUD-FE-009)', () => {
  it('emits every schema-required key for an adult applicant', () => {
    const flat = realityTvWizardFormToFlat(completeAdultForm());
    const required = requiredKeysForAge(30).filter((key) => !SERVER_STAMPED.has(key));
    for (const key of required) {
      expect(flat, `missing required key ${key}`).toHaveProperty(key);
      const value = flat[key];
      if (typeof value === 'boolean') expect(value, key).toBe(true);
      else if (Array.isArray(value)) expect(value.length, key).toBeGreaterThan(0);
      else if (typeof value === 'number') expect(Number.isNaN(value), key).toBe(false);
      else expect(String(value).trim().length, key).toBeGreaterThan(0);
    }
  });

  it('complete adult application passes the real schema validator on every step', () => {
    const form = completeAdultForm();
    expect(realityTvWizardSchemaErrors(form)).toEqual({});
    for (let step = 1; step <= 5; step += 1) {
      expect(validateRealityTvWizardStep(step, form), `step ${step}`).toEqual({});
    }
  });

  it('requires all guardian.* fields only when the applicant is a minor', () => {
    const minorForm = { ...completeAdultForm(), personal_dateOfBirth: dobForAge(16) };
    const errors = realityTvWizardSchemaErrors(minorForm);
    for (const key of [
      'guardian.fullName',
      'guardian.relationship',
      'guardian.phone',
      'guardian.email',
      'guardian.address',
      'guardian.digitalSignature',
      'guardian.consentGranted',
    ]) {
      expect(errors, `expected ${key} error`).toHaveProperty(key);
    }

    const withGuardian: RealityTvWizardForm = {
      ...minorForm,
      guardian_fullName: 'Ngozi Obi',
      guardian_relationship: 'Mother',
      guardian_phone: '+2348076543210',
      guardian_email: 'ngozi@example.com',
      guardian_address: '12 Bourdillon Rd, Ikoyi',
      guardian_digitalSignature: 'Ngozi Obi',
      guardian_consentGranted: true,
    };
    expect(realityTvWizardSchemaErrors(withGuardian)).toEqual({});
  });

  it('select and multi_select values always stay inside schema options', () => {
    const flat = realityTvWizardFormToFlat(completeAdultForm());
    for (const step of buildRealityTvShowSteps(draftForAge(30))) {
      for (const field of step.fields) {
        if (!field.options?.length) continue;
        const value = flat[field.key];
        if (field.type === 'select' && typeof value === 'string' && value) {
          expect(field.options, `${field.key}=${value}`).toContain(value);
        }
        if (field.type === 'multi_select' && Array.isArray(value)) {
          for (const item of value) {
            expect(field.options, `${field.key} contains ${item}`).toContain(item);
          }
        }
      }
    }
  });

  it('emits talent.experienceYears as a number, not a label like "5+ years"', () => {
    const flat = realityTvWizardFormToFlat({ ...completeAdultForm(), talent_experienceYears: '7' });
    expect(flat['talent.experienceYears']).toBe(7);
    expect(typeof flat['talent.experienceYears']).toBe('number');
  });

  it('emits BOTH the publicProfile and legal voting-consent keys (past key-mismatch bug)', () => {
    const flat = realityTvWizardFormToFlat(completeAdultForm());
    expect(flat['publicProfile.publicVotingConsent']).toBe(true);
    expect(flat['legal.publicVotingConsent']).toBe(true);
  });

  it('flags a value outside schema options (e.g. the old Mentor relationship)', () => {
    const bad = { ...completeAdultForm(), emergency_relationship: 'Mentor' };
    expect(realityTvWizardSchemaErrors(bad)).toHaveProperty('emergency.relationship');
  });

  it('flags a non-numeric experienceYears', () => {
    const bad = { ...completeAdultForm(), talent_experienceYears: '5+ years' };
    expect(realityTvWizardSchemaErrors(bad)).toHaveProperty('talent.experienceYears');
  });

  it('maps every wizard step to a real schema step key for the per-step PATCH', () => {
    const schemaKeys = new Set(buildRealityTvShowSteps(draftForAge(30)).map((s) => s.key));
    expect(Object.keys(REALITY_TV_WIZARD_STEP_SAVE_KEY).map(Number).sort()).toEqual([1, 2, 3, 4, 5]);
    for (const key of Object.values(REALITY_TV_WIZARD_STEP_SAVE_KEY)) {
      expect(schemaKeys.has(key), key).toBe(true);
    }
    // The mid-collection steps still fall back to the always-valid checkpoint.
    expect(REALITY_TV_WIZARD_STEP_SAVE_KEY[1]).toBe('contest_selection');
    expect(REALITY_TV_WIZARD_STEP_SAVE_KEY[3]).toBe('contest_selection');
  });

  it('hydrate round-trips a saved flat payload (including upload meta)', () => {
    const original = completeAdultForm();
    const flat = realityTvWizardFormToFlat(original, {
      'identity.idUpload': { fileName: 'passport.png', storageKey: 'registration/u/1.png' },
    });
    const { form, uploadMeta } = realityTvWizardHydrate(flat);
    expect(form.personal_firstName).toBe('Ada');
    expect(form.identity_idUploadUrl).toBe('/api/registration/uploads/aWR1cGxvYWQ');
    expect(form.identity_idUploadName).toBe('passport.png');
    expect(form.publicProfile_publicVotingConsent).toBe(true);
    expect(uploadMeta['identity.idUpload']?.fileName).toBe('passport.png');
    expect(flatErrorKeyToFormKey('identity.idType')).toBe('identity_idType');
  });
});
