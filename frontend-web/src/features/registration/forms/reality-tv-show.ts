// ─────────────────────────────────────────────────────────────────────────────
// Spotlight Reality TV Show — registration form (slug: reality-tv-show)
//
// SELF-CONTAINED. Every field/step for this contest is defined in this file.
// Editing anything here affects ONLY the Reality TV Show application form and
// no other contest. See ./README-forms note in index.ts for the pattern.
//
// Contest shape: paid (₦5,000), housemate reality show, requires medical +
// bootcamp readiness, supports public voting and audition scheduling.
// ─────────────────────────────────────────────────────────────────────────────
import { NIGERIA_STATES, TALENT_SKILL_OPTIONS, MEDICAL_CONDITION_OPTIONS, ALLERGY_OPTIONS, HEALTH_STATUS_OPTIONS } from '../reference-data';
import type { RegistrationDraft, RegistrationField, RegistrationStep } from '../types';

const LEGAL_ADULT_AGE = 18;

function isMinor(draft: RegistrationDraft): boolean {
  const age = Number(draft.formData['derived.age'] || 0);
  return age > 0 && age < LEGAL_ADULT_AGE;
}

const contestSelectionFields: RegistrationField[] = [
  { key: 'contest.title', label: 'Contest title', type: 'text', required: true, readOnly: true, helpText: 'This contest is locked from the application route and cannot be changed here.' },
];

const personalInformationFields: RegistrationField[] = [
  { key: 'personal.firstName', label: 'First name', type: 'text', required: true },
  { key: 'personal.middleName', label: 'Middle name', type: 'text' },
  { key: 'personal.lastName', label: 'Last name', type: 'text', required: true },
  { key: 'personal.stageName', label: 'Stage name', type: 'text' },
  { key: 'personal.dateOfBirth', label: 'Date of birth', type: 'date', required: true },
  { key: 'personal.gender', label: 'Gender', type: 'select', options: ['Female', 'Male'], required: true },
  { key: 'personal.nationality', label: 'Nationality', type: 'select', required: true, options: ['Nigerian'] },
  { key: 'personal.stateOfOrigin', label: 'State of origin', type: 'select', required: true, options: [...NIGERIA_STATES] },
  { key: 'personal.stateOfResidence', label: 'State of residence', type: 'select', required: true, options: [...NIGERIA_STATES] },
  { key: 'personal.city', label: 'City / town', type: 'select', required: true, options: [] },
  { key: 'personal.address', label: 'Residential address', type: 'textarea', required: true },
  { key: 'personal.primaryPhone', label: 'Primary phone number', type: 'tel', required: true },
  { key: 'personal.whatsapp', label: 'WhatsApp number', type: 'tel' },
];

const talentProfileFields: RegistrationField[] = [
  { key: 'talent.primarySkill', label: 'Primary talent / skill', type: 'multi_select', required: true, options: [...TALENT_SKILL_OPTIONS] },
  { key: 'talent.experienceYears', label: 'Years of experience', type: 'number', required: true },
  { key: 'talent.skillLevel', label: 'Skill level', type: 'select', options: ['Beginner', 'Emerging', 'Intermediate', 'Advanced', 'Professional', 'Self-taught'], required: true },
  { key: 'talent.previousCompetitions', label: 'Previous competitions', type: 'textarea' },
  { key: 'talent.strengths', label: 'Strengths', type: 'textarea', required: true },
  { key: 'talent.careerGoal', label: 'Career goal', type: 'textarea', required: true },
  { key: 'talent.uniqueStory', label: 'What makes your story unique?', type: 'textarea', required: true },
];

const guardianConsentFields: RegistrationField[] = [
  { key: 'guardian.fullName', label: 'Parent/guardian full name', type: 'text', required: true },
  { key: 'guardian.relationship', label: 'Relationship to applicant', type: 'text', required: true },
  { key: 'guardian.phone', label: 'Parent/guardian phone number', type: 'tel', required: true },
  { key: 'guardian.email', label: 'Parent/guardian email', type: 'email', required: true },
  { key: 'guardian.address', label: 'Parent/guardian address', type: 'textarea', required: true },
  { key: 'guardian.idUpload', label: 'Parent/guardian government ID upload', type: 'file', accept: '.jpg,.jpeg,.png,.pdf' },
  { key: 'guardian.digitalSignature', label: 'Digital signature (typed name)', type: 'text', required: true },
  { key: 'guardian.consentGranted', label: 'I authorize this applicant to participate in Spotlight programme activities', type: 'checkbox', required: true },
];

const identityFields: RegistrationField[] = [
  { key: 'identity.idType', label: 'Government-issued ID type', type: 'select', options: ['National ID', 'International passport', 'Voter card', 'Driver’s license', 'Other approved ID'], required: true },
  { key: 'identity.idNumber', label: 'ID number', type: 'text' },
  { key: 'identity.idUpload', label: 'ID upload', type: 'file', required: true, accept: '.jpg,.jpeg,.png,.pdf' },
];

const mediaFields: RegistrationField[] = [
  { key: 'media.profilePhoto', label: 'Profile photo', type: 'file', required: true, accept: '.jpg,.jpeg,.png,.webp' },
  { key: 'media.introVideo', label: 'Short intro / audition video', type: 'file', accept: '.mp4,.mov' },
  { key: 'media.rightsConfirmed', label: 'I confirm I have rights to uploaded materials', type: 'checkbox', required: true },
];

const categoryFields: RegistrationField[] = [
  { key: 'category.housemateReadiness', label: 'Comfortable living with other contestants?', type: 'checkbox', required: true },
  { key: 'category.dailyFilmingConsent', label: 'Comfortable being filmed daily?', type: 'checkbox', required: true },
  { key: 'category.uniqueStory', label: 'What makes your story compelling for TV?', type: 'textarea', required: true },
];

const socialFields: RegistrationField[] = [
  { key: 'social.instagram', label: 'Instagram handle', type: 'text' },
  { key: 'social.tiktok', label: 'TikTok handle', type: 'text' },
  { key: 'social.youtube', label: 'YouTube channel', type: 'text' },
  { key: 'social.x', label: 'X/Twitter handle', type: 'text' },
  { key: 'social.totalFollowers', label: 'Total estimated followers', type: 'number' },
  { key: 'social.willingToInviteVoting', label: 'Willing to invite fans to vote?', type: 'checkbox' },
];

const bootcampFields: RegistrationField[] = [
  { key: 'bootcamp.availableFullPeriod', label: 'Available for full bootcamp period?', type: 'select', options: ['Fully available', 'Available with notice', 'Partially available', 'Not available'], required: true },
  { key: 'bootcamp.canTravel', label: 'Can travel to bootcamp location?', type: 'checkbox', required: true },
  { key: 'bootcamp.travelRestrictions', label: 'Any travel restrictions?', type: 'textarea' },
  { key: 'bootcamp.comfortPublicVoting', label: 'Comfortable with public voting and possible eviction?', type: 'checkbox' },
  { key: 'bootcamp.personalConsiderations', label: 'Religious, cultural, dietary, or personal considerations', type: 'textarea' },
];

const medicalFields: RegistrationField[] = [
  { key: 'medical.generalHealthStatus', label: 'General health status', type: 'multi_select', required: true, options: [...HEALTH_STATUS_OPTIONS] },
  { key: 'medical.knownConditions', label: 'Known medical conditions', type: 'multi_select', options: [...MEDICAL_CONDITION_OPTIONS] },
  { key: 'medical.allergies', label: 'Allergies', type: 'multi_select', options: [...ALLERGY_OPTIONS] },
  { key: 'medical.currentMedication', label: 'Medication currently used', type: 'textarea' },
  { key: 'medical.dietaryRestrictions', label: 'Dietary restrictions', type: 'textarea' },
  { key: 'medical.emergencyTreatmentConsent', label: 'I consent to emergency medical support where necessary', type: 'checkbox', required: true },
];

const emergencyFields: RegistrationField[] = [
  { key: 'emergency.fullName', label: 'Emergency contact full name', type: 'text', required: true },
  { key: 'emergency.relationship', label: 'Relationship', type: 'select', required: true, options: ['Parent', 'Sibling', 'Spouse', 'Guardian', 'Relative', 'Friend', 'Other'] },
  { key: 'emergency.phone', label: 'Phone number', type: 'tel', required: true },
  { key: 'emergency.altPhone', label: 'Alternative phone number', type: 'tel' },
  { key: 'emergency.state', label: 'State', type: 'select', required: true, options: [...NIGERIA_STATES] },
  { key: 'emergency.city', label: 'City', type: 'select', required: true, options: [] },
];

const complianceFields: RegistrationField[] = [
  { key: 'compliance.previouslyInRealityShow', label: 'Previously participated in a reality show?', type: 'checkbox' },
  { key: 'compliance.exclusiveContract', label: 'Currently under exclusive talent contract?', type: 'checkbox' },
  { key: 'compliance.legalRestriction', label: 'Any legal restriction preventing participation?', type: 'checkbox' },
  { key: 'compliance.codeOfConductAgreement', label: 'I agree to Spotlight code of conduct', type: 'checkbox', required: true },
  { key: 'compliance.backgroundCheckAgreement', label: 'I agree to additional background checks if selected', type: 'checkbox', required: true },
  { key: 'compliance.truthDeclaration', label: 'I confirm submitted information is true', type: 'checkbox', required: true },
];

const paymentFields: RegistrationField[] = [
  { key: 'payment.feeAmount', label: 'Registration fee amount', type: 'number', required: true, readOnly: true, helpText: 'This amount is configured by admin and cannot be edited.' },
  { key: 'payment.method', label: 'Payment method', type: 'select', options: ['Card', 'Bank Transfer', 'USSD', 'Wallet'] },  // deliberately not required at wizard time — written by the payment flow; enforced in validation.ts
  { key: 'payment.transactionReference', label: 'Transaction reference', type: 'text' },
];

const auditionFields: RegistrationField[] = [
  { key: 'audition.format', label: 'Preferred audition format', type: 'select', options: ['Online video submission', 'Live virtual audition', 'Physical audition', 'Regional audition', 'Callback audition'], required: true },
  { key: 'audition.onlineLink', label: 'Online audition link', type: 'url' },
];

const publicProfileFields: RegistrationField[] = [
  { key: 'publicProfile.profilePhoto', label: 'Profile photo', type: 'file', accept: '.jpg,.jpeg,.png,.webp' },
  { key: 'publicProfile.talentSummary', label: 'Talent summary', type: 'textarea' },
  { key: 'publicProfile.publicVotingConsent', label: 'I consent to public voting profile visibility', type: 'checkbox', required: true },
];

const legalFields: RegistrationField[] = [
  { key: 'legal.accuracyDeclaration', label: 'I confirm all information submitted is true, complete, and accurate', type: 'checkbox', required: true },
  { key: 'legal.termsConsent', label: 'I agree to official rules, terms, and eligibility requirements', type: 'checkbox', required: true },
  { key: 'legal.privacyConsent', label: 'I consent to personal data processing for registration and programme administration', type: 'checkbox', required: true },
  { key: 'legal.mediaRelease', label: 'I grant Spotlight media recording and promotional usage rights', type: 'checkbox', required: true },
  { key: 'legal.publicVotingConsent', label: 'I understand approved profile may be displayed publicly and may be voted on', type: 'checkbox', required: true },
  { key: 'legal.productionRulesConsent', label: 'I agree to production, safety, and code-of-conduct rules', type: 'checkbox', required: true },
  { key: 'legal.disqualificationAcknowledgment', label: 'I understand misconduct/fraud may lead to disqualification', type: 'checkbox', required: true },
  { key: 'legal.ageGuardianConfirmation', label: 'I meet age requirements or have valid guardian consent', type: 'checkbox', required: true },
  { key: 'legal.communicationConsent', label: 'I agree to receive updates via email/SMS/WhatsApp/in-app notifications', type: 'checkbox', required: true },
];

const reviewFields: RegistrationField[] = [
  { key: 'review.confirmSubmit', label: 'I have reviewed my application and I am ready to submit', type: 'checkbox', required: true },
];

export function buildRealityTvShowSteps(draft: RegistrationDraft): RegistrationStep[] {
  const personalStepFields = [
    ...personalInformationFields,
    ...talentProfileFields,
    ...(isMinor(draft) ? guardianConsentFields : []),
  ];

  const contestRequirementFields = [
    ...identityFields,
    ...mediaFields,
    ...categoryFields,
    ...socialFields,
    ...complianceFields,
    ...bootcampFields,
    ...medicalFields,
    ...emergencyFields,
    ...paymentFields,
    ...auditionFields,
    ...publicProfileFields,
  ];

  return [
    { key: 'contest_selection', title: 'Contest Selection', description: 'Confirm the contest you are applying to.', fields: contestSelectionFields },
    { key: 'personal_information', title: 'Profile Information', description: 'Provide core identity and talent details.', fields: personalStepFields },
    { key: 'category_specific', title: 'Reality Show Requirements', description: 'Complete the housemate, welfare, and payment requirements for the Reality TV Show.', fields: contestRequirementFields },
    { key: 'review_submit', title: 'Consent and Submit', description: 'Confirm legal declarations and submit your application.', fields: [...legalFields, ...reviewFields] },
  ];
}
