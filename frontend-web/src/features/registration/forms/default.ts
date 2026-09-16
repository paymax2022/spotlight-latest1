// ─────────────────────────────────────────────────────────────────────────────
// Default / fallback registration form.
//
// Used ONLY for contest slugs that don't have their own dedicated form module
// (e.g. a brand-new contest created via the admin before a bespoke form exists).
// It reads the contest's `derived.*` capability flags from the draft to decide
// which optional sections to include, so it degrades gracefully.
//
// Named contests (reality-tv-show, stem-contest, sme-pitch-contest,
// open-mic-competition, film-academy) each have their own self-contained file
// and never touch this one.
// ─────────────────────────────────────────────────────────────────────────────
import { NIGERIA_STATES, TALENT_SKILL_OPTIONS, MEDICAL_CONDITION_OPTIONS, ALLERGY_OPTIONS, HEALTH_STATUS_OPTIONS } from '../reference-data';
import type { RegistrationDraft, RegistrationField, RegistrationStep } from '../types';

function flag(draft: RegistrationDraft, key: string): boolean {
  return Boolean(draft.formData[key]);
}

const contestSelectionFields: RegistrationField[] = [
  { key: 'contest.title', label: 'Contest title', type: 'text', required: true, readOnly: true, helpText: 'This contest is locked from the application route and cannot be changed here.' },
  { key: 'contest.entryMode', label: 'Individual or group entry', type: 'select', options: ['Individual', 'Group'], required: true },
];

const personalInformationFields: RegistrationField[] = [
  { key: 'personal.firstName', label: 'First name', type: 'text', required: true },
  { key: 'personal.lastName', label: 'Last name', type: 'text', required: true },
  { key: 'personal.dateOfBirth', label: 'Date of birth', type: 'date', required: true },
  { key: 'personal.gender', label: 'Gender', type: 'select', options: ['Female', 'Male'], required: true },
  { key: 'personal.stateOfResidence', label: 'State of residence', type: 'select', required: true, options: [...NIGERIA_STATES] },
  { key: 'personal.city', label: 'City / town', type: 'select', required: true, options: [] },
  { key: 'personal.primaryPhone', label: 'Primary phone number', type: 'tel', required: true },
];

const talentProfileFields: RegistrationField[] = [
  { key: 'talent.primarySkill', label: 'Primary talent / skill', type: 'multi_select', required: true, options: [...TALENT_SKILL_OPTIONS] },
  { key: 'talent.strengths', label: 'Strengths', type: 'textarea', required: true },
  { key: 'talent.careerGoal', label: 'Career goal', type: 'textarea', required: true },
];

const identityFields: RegistrationField[] = [
  { key: 'identity.idType', label: 'Government-issued ID type', type: 'select', options: ['National ID', 'International passport', 'Voter card', 'Driver’s license', 'School ID', 'Birth certificate', 'Other approved ID'], required: true },
  { key: 'identity.idUpload', label: 'ID upload', type: 'file', required: true, accept: '.jpg,.jpeg,.png,.pdf' },
];

const mediaFields: RegistrationField[] = [
  { key: 'media.profilePhoto', label: 'Profile photo', type: 'file', required: true, accept: '.jpg,.jpeg,.png,.webp' },
  { key: 'media.rightsConfirmed', label: 'I confirm I have rights to uploaded materials', type: 'checkbox', required: true },
];

const socialFields: RegistrationField[] = [
  { key: 'social.instagram', label: 'Instagram handle', type: 'text' },
  { key: 'social.tiktok', label: 'TikTok handle', type: 'text' },
  { key: 'social.website', label: 'Website / portfolio', type: 'url' },
];

const complianceFields: RegistrationField[] = [
  { key: 'compliance.codeOfConductAgreement', label: 'I agree to Spotlight code of conduct', type: 'checkbox', required: true },
  { key: 'compliance.truthDeclaration', label: 'I confirm submitted information is true', type: 'checkbox', required: true },
];

const medicalFields: RegistrationField[] = [
  { key: 'medical.generalHealthStatus', label: 'General health status', type: 'multi_select', required: true, options: [...HEALTH_STATUS_OPTIONS] },
  { key: 'medical.knownConditions', label: 'Known medical conditions', type: 'multi_select', options: [...MEDICAL_CONDITION_OPTIONS] },
  { key: 'medical.allergies', label: 'Allergies', type: 'multi_select', options: [...ALLERGY_OPTIONS] },
  { key: 'medical.emergencyTreatmentConsent', label: 'I consent to emergency medical support where necessary', type: 'checkbox', required: true },
];

const paymentFields: RegistrationField[] = [
  { key: 'payment.feeAmount', label: 'Registration fee amount', type: 'number', required: true, readOnly: true, helpText: 'This amount is configured by admin and cannot be edited.' },
  { key: 'payment.method', label: 'Payment method', type: 'select', options: ['Card', 'Bank Transfer', 'USSD', 'Wallet', 'Waiver'] },  // deliberately not required at wizard time — written by the payment flow; enforced in validation.ts
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
  { key: 'legal.communicationConsent', label: 'I agree to receive updates via email/SMS/WhatsApp/in-app notifications', type: 'checkbox', required: true },
];

const reviewFields: RegistrationField[] = [
  { key: 'review.confirmSubmit', label: 'I have reviewed my application and I am ready to submit', type: 'checkbox', required: true },
];

export function buildDefaultSteps(draft: RegistrationDraft): RegistrationStep[] {
  const requiresMedical = flag(draft, 'derived.requiresMedical');
  const isPaid = flag(draft, 'derived.isPaidContest');
  const supportsAudition = flag(draft, 'derived.supportsAuditionScheduling');
  const supportsVoting = flag(draft, 'derived.supportsVoting');

  const contestRequirementFields = [
    ...identityFields,
    ...mediaFields,
    ...socialFields,
    ...complianceFields,
    ...(requiresMedical ? medicalFields : []),
    ...(isPaid ? paymentFields : []),
    ...(supportsAudition ? auditionFields : []),
    ...(supportsVoting ? publicProfileFields : []),
  ];

  return [
    { key: 'contest_selection', title: 'Contest Selection', description: 'Confirm the contest and applicant route.', fields: contestSelectionFields },
    { key: 'personal_information', title: 'Profile Information', description: 'Provide core identity and talent details.', fields: [...personalInformationFields, ...talentProfileFields] },
    { key: 'category_specific', title: 'Contest Requirements', description: 'Complete requirements that apply to your selected contest.', fields: contestRequirementFields },
    { key: 'review_submit', title: 'Consent and Submit', description: 'Confirm legal declarations and submit your application.', fields: [...legalFields, ...reviewFields] },
  ];
}
