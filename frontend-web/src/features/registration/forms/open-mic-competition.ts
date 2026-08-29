// ─────────────────────────────────────────────────────────────────────────────
// Spotlight Open Mic Competition — registration form (slug: open-mic-competition)
//
// SELF-CONTAINED. Editing anything here affects ONLY the Open Mic form.
//
// Contest shape: paid (₦2,000), regional public-voting performance contest.
// Lower legal-adult age (16) so guardian consent triggers under 16. Supports
// audition scheduling and public voting. NO medical, NO bootcamp. Focused on
// live performance (audio sample, performance type, genre).
// ─────────────────────────────────────────────────────────────────────────────
import { NIGERIA_STATES } from '../reference-data';
import type { RegistrationDraft, RegistrationField, RegistrationStep } from '../types';

const LEGAL_ADULT_AGE = 16;
const PERFORMANCE_SKILLS = ['Singing', 'Rapping', 'Spoken Word', 'Comedy', 'Instrumentalist'];
const PERFORMANCE_GENRES = [
  'Afrobeats', 'Hip-Hop', 'R&B', 'Gospel', 'Highlife', 'Fuji', 'Amapiano',
  'Jazz', 'Pop', 'Reggae / Dancehall', 'Folk / Traditional', 'Spoken Word / Poetry', 'Other',
];

function isMinor(draft: RegistrationDraft): boolean {
  const age = Number(draft.formData['derived.age'] || 0);
  return age > 0 && age < LEGAL_ADULT_AGE;
}

const contestSelectionFields: RegistrationField[] = [
  { key: 'contest.title', label: 'Contest title', type: 'text', required: true, readOnly: true, helpText: 'This contest is locked from the application route and cannot be changed here.' },
  { key: 'contest.entryMode', label: 'Solo or group performance', type: 'select', options: ['Individual', 'Group'], required: true },
];

const personalInformationFields: RegistrationField[] = [
  { key: 'personal.firstName', label: 'First name', type: 'text', required: true },
  { key: 'personal.lastName', label: 'Last name', type: 'text', required: true },
  { key: 'personal.stageName', label: 'Stage name', type: 'text' },
  { key: 'personal.dateOfBirth', label: 'Date of birth', type: 'date', required: true },
  { key: 'personal.gender', label: 'Gender', type: 'select', options: ['Female', 'Male'], required: true },
  { key: 'personal.stateOfResidence', label: 'State of residence', type: 'select', required: true, options: [...NIGERIA_STATES] },
  { key: 'personal.city', label: 'City / town', type: 'select', required: true, options: [] },
  { key: 'personal.primaryPhone', label: 'Primary phone number', type: 'tel', required: true },
];

const performerFields: RegistrationField[] = [
  { key: 'talent.primarySkill', label: 'Primary performance skill', type: 'multi_select', required: true, options: [...PERFORMANCE_SKILLS] },
  { key: 'talent.experienceYears', label: 'Years performing', type: 'number' },
  { key: 'talent.strengths', label: 'What makes your performance stand out?', type: 'textarea', required: true },
];

const guardianConsentFields: RegistrationField[] = [
  { key: 'guardian.fullName', label: 'Parent/guardian full name', type: 'text', required: true },
  { key: 'guardian.relationship', label: 'Relationship to applicant', type: 'text', required: true },
  { key: 'guardian.phone', label: 'Parent/guardian phone number', type: 'tel', required: true },
  { key: 'guardian.digitalSignature', label: 'Digital signature (typed name)', type: 'text', required: true },
  { key: 'guardian.consentGranted', label: 'I authorize this applicant to perform in the Open Mic Competition', type: 'checkbox', required: true },
];

const performanceFields: RegistrationField[] = [
  { key: 'category.performanceType', label: 'Performance type', type: 'select', options: ['Singing', 'Rap', 'Spoken Word', 'Comedy', 'Instrumental', 'Other'], required: true },
  { key: 'category.genre', label: 'Genre / style', type: 'select', options: [...PERFORMANCE_GENRES], required: true },
  { key: 'category.durationMinutes', label: 'Planned performance length (minutes)', type: 'number' },
  { key: 'category.audioUpload', label: 'Upload audition audio', type: 'file', accept: '.mp3,.wav,.m4a' },
  { key: 'category.sampleLink', label: 'Performance sample link', type: 'url' },
  { key: 'category.ownsRights', label: 'I own or have rights to the material I will perform', type: 'checkbox', required: true },
];

const mediaFields: RegistrationField[] = [
  { key: 'media.profilePhoto', label: 'Profile photo', type: 'file', required: true, accept: '.jpg,.jpeg,.png,.webp' },
];

const socialFields: RegistrationField[] = [
  { key: 'social.instagram', label: 'Instagram handle', type: 'text' },
  { key: 'social.tiktok', label: 'TikTok handle', type: 'text' },
  { key: 'social.willingToInviteVoting', label: 'Willing to invite fans to vote?', type: 'checkbox' },
];

const complianceFields: RegistrationField[] = [
  { key: 'compliance.codeOfConductAgreement', label: 'I agree to Spotlight code of conduct', type: 'checkbox', required: true },
  { key: 'compliance.truthDeclaration', label: 'I confirm submitted information is true', type: 'checkbox', required: true },
];

const paymentFields: RegistrationField[] = [
  { key: 'payment.feeAmount', label: 'Registration fee amount', type: 'number', required: true, readOnly: true, helpText: 'This amount is configured by admin and cannot be edited.' },
  { key: 'payment.method', label: 'Payment method', type: 'select', options: ['Card', 'Bank Transfer', 'USSD', 'Wallet'] },  // deliberately not required at wizard time — written by the payment flow; enforced in validation.ts
  { key: 'payment.transactionReference', label: 'Transaction reference', type: 'text' },
];

const auditionFields: RegistrationField[] = [
  { key: 'audition.format', label: 'Preferred audition format', type: 'select', options: ['Online video submission', 'Live virtual audition', 'Physical audition', 'Regional audition'], required: true },
  { key: 'audition.onlineLink', label: 'Online audition link', type: 'url' },
];

const publicProfileFields: RegistrationField[] = [
  { key: 'publicProfile.talentSummary', label: 'Talent summary', type: 'textarea' },
  { key: 'publicProfile.publicVotingConsent', label: 'I consent to public voting profile visibility', type: 'checkbox', required: true },
];

const legalFields: RegistrationField[] = [
  { key: 'legal.accuracyDeclaration', label: 'I confirm all information submitted is true, complete, and accurate', type: 'checkbox', required: true },
  { key: 'legal.termsConsent', label: 'I agree to official rules, terms, and eligibility requirements', type: 'checkbox', required: true },
  { key: 'legal.privacyConsent', label: 'I consent to personal data processing for registration and programme administration', type: 'checkbox', required: true },
  { key: 'legal.mediaRelease', label: 'I grant Spotlight media recording and promotional usage rights', type: 'checkbox', required: true },
  { key: 'legal.publicVotingConsent', label: 'I understand approved profile may be displayed publicly and may be voted on', type: 'checkbox', required: true },
  { key: 'legal.ageGuardianConfirmation', label: 'I meet age requirements or have valid guardian consent', type: 'checkbox', required: true },
  { key: 'legal.communicationConsent', label: 'I agree to receive updates via email/SMS/WhatsApp/in-app notifications', type: 'checkbox', required: true },
];

const reviewFields: RegistrationField[] = [
  { key: 'review.confirmSubmit', label: 'I have reviewed my application and I am ready to submit', type: 'checkbox', required: true },
];

export function buildOpenMicCompetitionSteps(draft: RegistrationDraft): RegistrationStep[] {
  const personalStepFields = [
    ...personalInformationFields,
    ...performerFields,
    ...(isMinor(draft) ? guardianConsentFields : []),
  ];

  const contestRequirementFields = [
    ...performanceFields,
    ...mediaFields,
    ...socialFields,
    ...complianceFields,
    ...paymentFields,
    ...auditionFields,
    ...publicProfileFields,
  ];

  return [
    { key: 'contest_selection', title: 'Contest Selection', description: 'Confirm your Open Mic entry type.', fields: contestSelectionFields },
    { key: 'personal_information', title: 'Performer Profile', description: 'Tell us about you and your performance.', fields: personalStepFields },
    { key: 'category_specific', title: 'Performance & Payment', description: 'Set up your performance details and pay the entry fee.', fields: contestRequirementFields },
    { key: 'review_submit', title: 'Consent and Submit', description: 'Confirm declarations and submit your Open Mic entry.', fields: [...legalFields, ...reviewFields] },
  ];
}
