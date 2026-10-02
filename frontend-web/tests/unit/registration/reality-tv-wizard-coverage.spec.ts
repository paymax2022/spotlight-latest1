import { describe, it, expect } from 'vitest';
import { buildRegistrationSteps } from '@/src/features/registration/config';
import type { RegistrationDraft } from '@/src/features/registration/types';
import { formToFlat, flatToForm } from '../../../components/forms/RealityTvShowApplicationWizard';
import type { FormData } from '../../../components/forms/RealityTvShowApplicationWizard';

// A fully-completed adult applicant — every wizard control filled.
const COMPLETE_ADULT: FormData = {
  personal_firstName: 'Chisom', personal_lastName: 'Obi', personal_stageName: 'Chi-Chi',
  personal_dateOfBirth: '1995-06-15', personal_gender: 'Female', personal_stateOfOrigin: 'Anambra',
  personal_stateOfResidence: 'Lagos', personal_city: 'Ikeja', personal_primaryPhone: '+2348012345678',
  personal_address: '12 Adeola St', contest_entryMode: 'Individual',
  media_profilePhoto: null, media_profilePhotoPreview: '',
  media_profilePhotoRef: { storageKey: 'registration/u/abc.jpg', previewUrl: '/api/registration/uploads/x' },
  identity_idType: 'National ID', identity_idUpload: null, identity_idUploadName: 'id.pdf',
  identity_idUploadRef: { storageKey: 'registration/u/def.pdf', previewUrl: '/api/registration/uploads/y' },

  talent_primarySkill: ['Singing'], talent_experienceYears: '5', talent_skillLevel: 'Advanced',
  talent_strengths: 'Stage presence', talent_careerGoal: 'Global artist', talent_uniqueStory: 'Church choir',

  category_uniqueStory: 'Authentic and entertaining',
  social_instagram: '@chi', social_tiktok: '', social_youtube: '', social_totalFollowers: '1200',
  media_performanceLink: 'https://youtube.com/x', media_rightsConfirmed: true,
  publicProfile_publicVotingConsent: true,

  bootcamp_availableFullPeriod: 'Fully available', bootcamp_canTravel: true,
  category_housemateReadiness: true, category_dailyFilmingConsent: true,
  bootcamp_personalConsiderations: '', audition_format: 'Live virtual audition',
  medical_generalHealthStatus: ['Generally healthy'], medical_emergencyTreatmentConsent: true,
  emergency_fullName: 'Ngozi Obi', emergency_relationship: 'Parent',
  emergency_phone: '+2348098765432', emergency_altPhone: '',
  emergency_state: 'Lagos', emergency_city: 'Ikeja',

  guardian_fullName: '', guardian_relationship: '', guardian_phone: '',
  guardian_email: '', guardian_address: '', guardian_digitalSignature: '',
  guardian_consentGranted: false,

  legal_accuracyDeclaration: true, legal_termsConsent: true, legal_privacyConsent: true,
  legal_mediaRelease: true, legal_publicVotingConsent: true,
  legal_sponsorActivationConsent: true, legal_productionRulesConsent: true,
  legal_disqualificationAcknowledgment: true, legal_ageGuardianConfirmation: true,
  legal_communicationConsent: true,
  compliance_codeOfConductAgreement: true, compliance_backgroundCheckAgreement: true,
  compliance_truthDeclaration: true, review_confirmSubmit: true,
};

// Always ~16 regardless of when the test runs.
const MINOR_DOB = new Date(Date.now() - 16 * 365.25 * 86400000).toISOString().split('T')[0];

const COMPLETE_MINOR: FormData = {
  ...COMPLETE_ADULT,
  personal_dateOfBirth: MINOR_DOB,
  guardian_fullName: 'Adewale Obi', guardian_relationship: 'Father',
  guardian_phone: '+2348011112222', guardian_email: 'guardian@example.com',
  guardian_address: '12 Adeola St', guardian_digitalSignature: 'Adewale Obi',
  guardian_consentGranted: true,
};

function draft(formData: Record<string, unknown>): RegistrationDraft {
  return {
    id: 'x', reference: 'R', contestSlug: 'reality-tv-show', status: 'draft', role: 'public_user',
    createdAt: '', updatedAt: '', formData, completionPercent: 0, fraudFlags: [],
  };
}

function requiredKeys(d: RegistrationDraft): string[] {
  return buildRegistrationSteps(d)
    .flatMap((step) => step.fields)
    .filter((field) => field.required)
    .map((field) => field.key);
}

// Stamped by the server (contest lock / payment fulfilment), never by the wizard.
const SERVER_STAMPED = new Set(['contest.title', 'payment.feeAmount']);

describe('AUD-FE-009: reality-TV wizard persists every server-required field', () => {
  it('emits every required schema key for an adult applicant', () => {
    const adultDraft = draft({ 'personal.dateOfBirth': '1995-06-15', 'derived.age': 30 });
    const missing = requiredKeys(adultDraft).filter(
      (key) => !SERVER_STAMPED.has(key) && !(key in formToFlat(COMPLETE_ADULT)),
    );
    expect(missing).toEqual([]);
  });

  it('emits every required schema key for a minor (guardian block included)', () => {
    const minorDraft = draft({ 'personal.dateOfBirth': MINOR_DOB, 'derived.age': 16 });
    const missing = requiredKeys(minorDraft).filter(
      (key) => !SERVER_STAMPED.has(key) && !(key in formToFlat(COMPLETE_MINOR)),
    );
    expect(missing).toEqual([]);
  });

  it('emits schema-compatible value types', () => {
    const flat = formToFlat(COMPLETE_ADULT);
    // talent.experienceYears is a `number` field server-side — no '5+ years' strings.
    expect(flat['talent.experienceYears']).toBe(5);
    expect(typeof flat['talent.experienceYears']).toBe('number');
    // gender select options are exactly Female/Male server-side.
    expect(['Female', 'Male']).toContain(flat['personal.gender']);
    // upload fields carry the persisted upload object the file validator accepts.
    expect(flat['media.profilePhoto']).toMatchObject({ storageKey: 'registration/u/abc.jpg' });
    expect(flat['identity.idUpload']).toMatchObject({ storageKey: 'registration/u/def.pdf' });
    // multi_select arrays pass through intact.
    expect(flat['medical.generalHealthStatus']).toEqual(['Generally healthy']);
  });

  it('round-trips persisted upload refs and consent flags through flatToForm', () => {
    const hydrated = flatToForm(formToFlat(COMPLETE_ADULT));
    expect(hydrated.media_profilePhotoRef).toMatchObject({ storageKey: 'registration/u/abc.jpg' });
    expect(hydrated.identity_idUploadRef).toMatchObject({ storageKey: 'registration/u/def.pdf' });
    expect(hydrated.legal_privacyConsent).toBe(true);
    expect(hydrated.compliance_truthDeclaration).toBe(true);
    expect(hydrated.medical_generalHealthStatus).toEqual(['Generally healthy']);
    expect(hydrated.emergency_state).toBe('Lagos');
    expect(hydrated.audition_format).toBe('Live virtual audition');
  });
});
