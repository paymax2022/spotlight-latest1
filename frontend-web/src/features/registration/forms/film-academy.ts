// ─────────────────────────────────────────────────────────────────────────────
// Spotlight Film Academy — registration form (slug: film-academy)
//
// SELF-CONTAINED. Editing anything here affects ONLY the Film Academy form.
//
// Contest shape: paid (₦7,500), residential bootcamp/reality cohort, requires
// medical + bootcamp readiness and audition scheduling. Does NOT support public
// voting (so no public-voting profile step). Focused on film-craft roles and
// portfolio work.
// ─────────────────────────────────────────────────────────────────────────────
import { NIGERIA_STATES, MEDICAL_CONDITION_OPTIONS, ALLERGY_OPTIONS, HEALTH_STATUS_OPTIONS } from '../reference-data';
import type { RegistrationDraft, RegistrationField, RegistrationStep } from '../types';

const LEGAL_ADULT_AGE = 18;

function isMinor(draft: RegistrationDraft): boolean {
  const age = Number(draft.formData['derived.age'] || 0);
  return age > 0 && age < LEGAL_ADULT_AGE;
}

const contestSelectionFields: RegistrationField[] = [
  { key: 'contest.title', label: 'Contest title', type: 'text', required: true, readOnly: true, helpText: 'This contest is locked from the application route and cannot be changed here.' },
  { key: 'contest.entryMode', label: 'Individual or group entry', type: 'select', options: ['Individual', 'Group'], required: true },
];

const personalInformationFields: RegistrationField[] = [
  { key: 'personal.firstName', label: 'First name', type: 'text', required: true },
  { key: 'personal.middleName', label: 'Middle name', type: 'text' },
  { key: 'personal.lastName', label: 'Last name', type: 'text', required: true },
  { key: 'personal.dateOfBirth', label: 'Date of birth', type: 'date', required: true },
  { key: 'personal.gender', label: 'Gender', type: 'select', options: ['Female', 'Male'], required: true },
  { key: 'personal.nationality', label: 'Nationality', type: 'select', required: true, options: ['Nigerian'] },
  { key: 'personal.stateOfOrigin', label: 'State of origin', type: 'select', required: true, options: [...NIGERIA_STATES] },
  { key: 'personal.stateOfResidence', label: 'State of residence', type: 'select', required: true, options: [...NIGERIA_STATES] },
  { key: 'personal.city', label: 'City / town', type: 'select', required: true, options: [] },
  { key: 'personal.address', label: 'Residential address', type: 'textarea', required: true },
  { key: 'personal.primaryPhone', label: 'Primary phone number', type: 'tel', required: true },
];

const craftFields: RegistrationField[] = [
  { key: 'talent.filmExperience', label: 'Film / production experience', type: 'textarea', required: true },
  { key: 'talent.careerGoal', label: 'Career goal in film', type: 'textarea', required: true },
];

const guardianConsentFields: RegistrationField[] = [
  { key: 'guardian.fullName', label: 'Parent/guardian full name', type: 'text', required: true },
  { key: 'guardian.relationship', label: 'Relationship to applicant', type: 'text', required: true },
  { key: 'guardian.phone', label: 'Parent/guardian phone number', type: 'tel', required: true },
  { key: 'guardian.email', label: 'Parent/guardian email', type: 'email', required: true },
  { key: 'guardian.address', label: 'Parent/guardian address', type: 'textarea', required: true },
  { key: 'guardian.digitalSignature', label: 'Digital signature (typed name)', type: 'text', required: true },
  { key: 'guardian.consentGranted', label: 'I authorize this applicant to attend the Film Academy bootcamp', type: 'checkbox', required: true },
];

const identityFields: RegistrationField[] = [
  { key: 'identity.idType', label: 'Government-issued ID type', type: 'select', options: ['National ID', 'International passport', 'Voter card', 'Driver’s license', 'Other approved ID'], required: true },
  { key: 'identity.idNumber', label: 'ID number', type: 'text' },
  { key: 'identity.idUpload', label: 'ID upload', type: 'file', required: true, accept: '.jpg,.jpeg,.png,.pdf' },
];

const filmRoleFields: RegistrationField[] = [
  { key: 'category.filmRole', label: 'Area of film interest', type: 'select', options: ['Screenwriter', 'Director', 'Cinematographer', 'Editor', 'Sound recordist', 'Production designer', 'Makeup artist', 'Costume designer', 'Script supervisor', 'Producer', 'Lighting assistant', 'Camera assistant', 'Production assistant', 'Other'], required: true },
  { key: 'category.productionExperience', label: 'Previous production experience', type: 'textarea' },
  { key: 'category.portfolioLink', label: 'Portfolio / showreel link', type: 'url' },
  { key: 'category.sampleUpload', label: 'Upload sample work', type: 'file', accept: '.mp4,.mov,.pdf' },
  { key: 'category.longHoursConsent', label: 'Comfortable working long production hours?', type: 'checkbox', required: true },
];

const mediaFields: RegistrationField[] = [
  { key: 'media.profilePhoto', label: 'Profile photo', type: 'file', required: true, accept: '.jpg,.jpeg,.png,.webp' },
  { key: 'media.rightsConfirmed', label: 'I confirm I have rights to uploaded materials', type: 'checkbox', required: true },
];

const socialFields: RegistrationField[] = [
  { key: 'social.instagram', label: 'Instagram handle', type: 'text' },
  { key: 'social.youtube', label: 'YouTube / Vimeo channel', type: 'text' },
  { key: 'social.website', label: 'Website / portfolio', type: 'url' },
];

const bootcampFields: RegistrationField[] = [
  { key: 'bootcamp.availableFullPeriod', label: 'Available for the full academy cohort period?', type: 'select', options: ['Fully available', 'Available with notice', 'Partially available', 'Not available'], required: true },
  { key: 'bootcamp.canTravel', label: 'Can travel to the academy location?', type: 'checkbox', required: true },
  { key: 'bootcamp.travelRestrictions', label: 'Any travel restrictions?', type: 'textarea' },
  { key: 'bootcamp.comfortLivingWithContestants', label: 'Comfortable living with other participants?', type: 'checkbox' },
  { key: 'bootcamp.personalConsiderations', label: 'Religious, cultural, dietary, or personal considerations', type: 'textarea' },
];

const medicalFields: RegistrationField[] = [
  { key: 'medical.generalHealthStatus', label: 'General health status', type: 'multi_select', required: true, options: [...HEALTH_STATUS_OPTIONS] },
  { key: 'medical.knownConditions', label: 'Known medical conditions', type: 'multi_select', options: [...MEDICAL_CONDITION_OPTIONS] },
  { key: 'medical.allergies', label: 'Allergies', type: 'multi_select', options: [...ALLERGY_OPTIONS] },
  { key: 'medical.currentMedication', label: 'Medication currently used', type: 'textarea' },
  { key: 'medical.physicalLimitations', label: 'Physical limitations relevant to production work', type: 'textarea' },
  { key: 'medical.emergencyTreatmentConsent', label: 'I consent to emergency medical support where necessary', type: 'checkbox', required: true },
];

const emergencyFields: RegistrationField[] = [
  { key: 'emergency.fullName', label: 'Emergency contact full name', type: 'text', required: true },
  { key: 'emergency.relationship', label: 'Relationship', type: 'select', required: true, options: ['Parent', 'Sibling', 'Spouse', 'Guardian', 'Relative', 'Friend', 'Other'] },
  { key: 'emergency.phone', label: 'Phone number', type: 'tel', required: true },
  { key: 'emergency.state', label: 'State', type: 'select', required: true, options: [...NIGERIA_STATES] },
  { key: 'emergency.city', label: 'City', type: 'select', required: true, options: [] },
];

const complianceFields: RegistrationField[] = [
  { key: 'compliance.exclusiveContract', label: 'Currently under exclusive talent/agency contract?', type: 'checkbox' },
  { key: 'compliance.legalRestriction', label: 'Any legal restriction preventing participation?', type: 'checkbox' },
  { key: 'compliance.codeOfConductAgreement', label: 'I agree to Spotlight code of conduct', type: 'checkbox', required: true },
  { key: 'compliance.backgroundCheckAgreement', label: 'I agree to additional background checks if selected', type: 'checkbox', required: true },
  { key: 'compliance.truthDeclaration', label: 'I confirm submitted information is true', type: 'checkbox', required: true },
];

const paymentFields: RegistrationField[] = [
  { key: 'payment.feeAmount', label: 'Registration fee amount', type: 'number', required: true, readOnly: true, helpText: 'This amount is configured by admin and cannot be edited.' },
  { key: 'payment.method', label: 'Payment method', type: 'select', options: ['Card', 'Bank Transfer', 'USSD', 'Wallet'], required: true },
  { key: 'payment.transactionReference', label: 'Transaction reference', type: 'text' },
];

const auditionFields: RegistrationField[] = [
  { key: 'audition.format', label: 'Preferred selection interview format', type: 'select', options: ['Online video submission', 'Live virtual interview', 'Physical interview', 'Portfolio review'], required: true },
  { key: 'audition.onlineLink', label: 'Interview / showreel link', type: 'url' },
];

const legalFields: RegistrationField[] = [
  { key: 'legal.accuracyDeclaration', label: 'I confirm all information submitted is true, complete, and accurate', type: 'checkbox', required: true },
  { key: 'legal.termsConsent', label: 'I agree to official rules, terms, and eligibility requirements', type: 'checkbox', required: true },
  { key: 'legal.privacyConsent', label: 'I consent to personal data processing for registration and programme administration', type: 'checkbox', required: true },
  { key: 'legal.mediaRelease', label: 'I grant Spotlight media recording and promotional usage rights', type: 'checkbox', required: true },
  { key: 'legal.productionRulesConsent', label: 'I agree to production, safety, and code-of-conduct rules', type: 'checkbox', required: true },
  { key: 'legal.disqualificationAcknowledgment', label: 'I understand misconduct/fraud may lead to disqualification', type: 'checkbox', required: true },
  { key: 'legal.ageGuardianConfirmation', label: 'I meet age requirements or have valid guardian consent', type: 'checkbox', required: true },
  { key: 'legal.communicationConsent', label: 'I agree to receive updates via email/SMS/WhatsApp/in-app notifications', type: 'checkbox', required: true },
];

const reviewFields: RegistrationField[] = [
  { key: 'review.confirmSubmit', label: 'I have reviewed my application and I am ready to submit', type: 'checkbox', required: true },
];

export function buildFilmAcademySteps(draft: RegistrationDraft): RegistrationStep[] {
  const personalStepFields = [
    ...personalInformationFields,
    ...craftFields,
    ...(isMinor(draft) ? guardianConsentFields : []),
  ];

  const contestRequirementFields = [
    ...identityFields,
    ...filmRoleFields,
    ...mediaFields,
    ...socialFields,
    ...complianceFields,
    ...bootcampFields,
    ...medicalFields,
    ...emergencyFields,
    ...paymentFields,
    ...auditionFields,
  ];

  return [
    { key: 'contest_selection', title: 'Contest Selection', description: 'Confirm your Film Academy entry type.', fields: contestSelectionFields },
    { key: 'personal_information', title: 'Applicant & Craft Details', description: 'Tell us about you and your film experience.', fields: personalStepFields },
    { key: 'category_specific', title: 'Academy Requirements', description: 'Complete the craft, welfare, bootcamp, and payment requirements.', fields: contestRequirementFields },
    { key: 'review_submit', title: 'Consent and Submit', description: 'Confirm declarations and submit your Film Academy application.', fields: [...legalFields, ...reviewFields] },
  ];
}
