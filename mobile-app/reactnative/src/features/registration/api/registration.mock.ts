// ── Registration — mock data (used when EXPO_PUBLIC_REGISTRATION_USE_MOCK !== 'false') ─
// Mirrors the backend's schema-driven shape: a draft carries ordered `steps`,
// each with `fields[]`. The mock builds a representative subset of the catalog
// and the steps the server's buildRegistrationSteps would emit, so the wizard
// renders end-to-end with no backend.

import type {
  ContestRegistrationDefinition,
  RegistrationStep,
  RegistrationField,
} from '../types/registration.types';

export const MOCK_NIGERIA_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT Abuja', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos',
  'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
  'Taraba', 'Yobe', 'Zamfara',
];

export const MOCK_CONTESTS: ContestRegistrationDefinition[] = [
  {
    slug: 'reality-tv-show',
    title: 'Spotlight Reality TV Show',
    contestCategory: 'general_reality_show',
    contestType: 'housemate_reality_show',
    seasonOrEdition: 'Season 1',
    regionScope: 'national',
    isPaid: true,
    registrationFeeNgn: 5000,
    requiresGuardianConsentForMinors: true,
    legalAdultAge: 18,
    requiresMedical: true,
    requiresBootcampReadiness: true,
    supportsVoting: true,
    supportsAuditionScheduling: true,
    supportsSchoolEntry: false,
    supportsGroupEntry: false,
    auditionStates: [...MOCK_NIGERIA_STATES],
    applicantCategories: ['General Reality Show', 'Music', 'Acting', 'Dance', 'Comedy', 'Content Creation'],
    categoryQuestionSet: 'general_reality_show',
  },
  {
    slug: 'stem-contest',
    title: 'Spotlight STEM Contest',
    contestCategory: 'stem_innovation',
    contestType: 'hybrid_contest',
    seasonOrEdition: '2026',
    regionScope: 'national',
    isPaid: false,
    requiresGuardianConsentForMinors: true,
    legalAdultAge: 18,
    requiresMedical: false,
    requiresBootcampReadiness: false,
    supportsVoting: true,
    supportsAuditionScheduling: false,
    supportsSchoolEntry: true,
    supportsGroupEntry: true,
    auditionStates: [...MOCK_NIGERIA_STATES],
    applicantCategories: ['STEM / Innovation', 'School Talent', 'Campus Talent'],
    categoryQuestionSet: 'stem_innovation',
  },
  {
    slug: 'open-mic-competition',
    title: 'Spotlight Open Mic Competition',
    contestCategory: 'open_mic',
    contestType: 'public_voting_contest',
    seasonOrEdition: '2026',
    regionScope: 'regional',
    isPaid: true,
    registrationFeeNgn: 2000,
    requiresGuardianConsentForMinors: true,
    legalAdultAge: 16,
    requiresMedical: false,
    requiresBootcampReadiness: false,
    supportsVoting: true,
    supportsAuditionScheduling: true,
    supportsSchoolEntry: false,
    supportsGroupEntry: true,
    auditionStates: [...MOCK_NIGERIA_STATES],
    applicantCategories: ['Open Mic', 'Music', 'Spoken Word'],
    categoryQuestionSet: 'open_mic',
  },
];

// ── Mock step schema ──────────────────────────────────────────────────────────
// Approximates buildRegistrationSteps for an open-mic (paid, voting, audition)
// contest: account_gate is satisfied by app auth, so the wizard renders the
// remaining steps. Kept intentionally compact but covers every FieldType.

const contestSelectionFields: RegistrationField[] = [
  { key: 'contest.title', label: 'Contest title', type: 'text', required: true, readOnly: true, helpText: 'Locked from your selected contest.' },
  { key: 'contest.entryMode', label: 'Individual or group entry', type: 'select', options: ['Individual', 'Group'], required: true },
  { key: 'contest.schoolEntry', label: 'School / institution entry', type: 'checkbox' },
];

const personalFields: RegistrationField[] = [
  { key: 'personal.firstName', label: 'First name', type: 'text', required: true },
  { key: 'personal.lastName', label: 'Last name', type: 'text', required: true },
  { key: 'personal.stageName', label: 'Stage name / team name', type: 'text' },
  { key: 'personal.dateOfBirth', label: 'Date of birth', type: 'date', required: true },
  { key: 'personal.gender', label: 'Gender', type: 'select', options: ['Female', 'Male'], required: true },
  { key: 'personal.stateOfResidence', label: 'State of residence', type: 'select', required: true, options: [...MOCK_NIGERIA_STATES] },
  { key: 'personal.address', label: 'Residential address', type: 'textarea', required: true },
  { key: 'personal.primaryPhone', label: 'Primary phone number', type: 'tel', required: true },
  { key: 'personal.whatsapp', label: 'WhatsApp number', type: 'tel' },
  // talent profile (merged server-side into personal_information)
  { key: 'talent.primarySkill', label: 'Primary talent / skill', type: 'multi_select', required: true, options: ['Singing', 'Rapping', 'Spoken Word', 'Comedy', 'Instrumentalist'] },
  { key: 'talent.experienceYears', label: 'Years of experience', type: 'number', required: true },
  { key: 'talent.careerGoal', label: 'Career goal', type: 'textarea', required: true },
];

const requirementFields: RegistrationField[] = [
  // ── Media ──────────────────────────────────────────────────────────────────
  { key: 'media.profilePhoto',     label: 'Profile photo',                                    type: 'file',         required: true,  accept: '.jpg,.jpeg,.png,.webp' },
  { key: 'media.rightsConfirmed',  label: 'I confirm I have rights to uploaded materials',    type: 'checkbox',     required: true },

  // ── Talent / category ──────────────────────────────────────────────────────
  { key: 'category.performanceType', label: 'Performance type', type: 'select', required: true,
    options: ['Singing', 'Rap', 'Spoken Word', 'Comedy', 'Instrumental', 'Dance', 'Acting', 'Content Creation', 'Other'] },
  { key: 'category.genre', label: 'Genre / style (select all that apply)', type: 'multi_select', required: true,
    options: ['Afrobeats', 'Afropop', 'Pop', 'R&B / Soul', 'Hip-Hop', 'Rap', 'Gospel', 'Reggae / Dancehall',
              'Jazz / Blues', 'Classical / Traditional', 'Comedy / Skit', 'Drama / Acting',
              'Dance', 'Content Creation', 'Spoken Word', 'Other'] },
  { key: 'category.sampleLink',   label: 'Performance sample link (YouTube / Instagram / TikTok)', type: 'url' },

  // ── Social ─────────────────────────────────────────────────────────────────
  { key: 'social.instagram',              label: 'Instagram handle',              type: 'text' },
  { key: 'social.willingToInviteVoting',  label: 'Willing to invite fans to vote?', type: 'checkbox' },

  // ── Compliance ─────────────────────────────────────────────────────────────
  { key: 'compliance.codeOfConductAgreement', label: 'I agree to Spotlight code of conduct', type: 'checkbox', required: true },
  { key: 'compliance.truthDeclaration',        label: 'I confirm submitted information is true', type: 'checkbox', required: true },

  // ── Audition ───────────────────────────────────────────────────────────────
  { key: 'audition.format',     label: 'Preferred audition format',          type: 'select', required: true,
    options: ['Online video submission', 'Live virtual audition', 'Physical audition'] },
  { key: 'audition.venueState', label: 'Preferred audition venue / state',   type: 'select', required: true,
    options: [...MOCK_NIGERIA_STATES],
    helpText: 'Select the state where you would like to attend your audition.' },

  // ── Public profile ─────────────────────────────────────────────────────────
  { key: 'publicProfile.publicVotingConsent', label: 'I consent to public voting profile visibility', type: 'checkbox', required: true },
];

const reviewFields: RegistrationField[] = [
  { key: 'legal.accuracyDeclaration', label: 'I confirm all information submitted is true, complete, and accurate', type: 'checkbox', required: true },
  { key: 'legal.termsConsent', label: 'I agree to official rules, terms, and eligibility requirements', type: 'checkbox', required: true },
  { key: 'legal.privacyConsent', label: 'I consent to personal data processing for registration', type: 'checkbox', required: true },
  { key: 'legal.mediaRelease', label: 'I grant Spotlight media recording and promotional usage rights', type: 'checkbox', required: true },
  { key: 'review.confirmSubmit', label: 'I have reviewed my application and I am ready to submit', type: 'checkbox', required: true },
];

export function buildMockSteps(contestTitle: string, feeNgn: number): RegistrationStep[] {
  return [
    {
      key: 'contest_selection',
      title: 'Contest Selection',
      description: 'Select active contest and applicant route.',
      fields: contestSelectionFields.map((f) =>
        f.key === 'contest.title' ? { ...f } : f,
      ),
    },
    {
      key: 'personal_information',
      title: 'Profile Information',
      description: 'Provide core identity and talent details.',
      fields: personalFields,
    },
    {
      key: 'category_specific',
      title: 'Contest Requirements',
      description: 'Complete requirements that apply to your selected contest.',
      fields: requirementFields.map((f) =>
        f.key === 'payment.feeAmount' ? { ...f, helpText: `₦${feeNgn.toLocaleString('en-NG')} — configured by admin.` } : f,
      ),
    },
    {
      key: 'review_submit',
      title: 'Consent and Submit',
      description: 'Confirm legal declarations and submit your application.',
      fields: reviewFields,
    },
  ];
}
