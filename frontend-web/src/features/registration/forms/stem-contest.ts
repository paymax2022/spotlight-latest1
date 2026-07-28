// ─────────────────────────────────────────────────────────────────────────────
// Spotlight STEM Contest — registration form (slug: stem-contest)
//
// SELF-CONTAINED. Editing anything here affects ONLY the STEM Contest form.
//
// Contest shape: free entry, innovation/project focused, supports school &
// group entry and public voting. NO medical, NO bootcamp, NO payment, NO
// audition scheduling. The form deliberately omits performing-arts talent
// fields and instead collects project + innovation details.
// ─────────────────────────────────────────────────────────────────────────────
import { NIGERIA_STATES } from '../reference-data';
import type { RegistrationDraft, RegistrationField, RegistrationStep } from '../types';

const LEGAL_ADULT_AGE = 18;

function isMinor(draft: RegistrationDraft): boolean {
  const age = Number(draft.formData['derived.age'] || 0);
  return age > 0 && age < LEGAL_ADULT_AGE;
}

const contestSelectionFields: RegistrationField[] = [
  { key: 'contest.title', label: 'Contest title', type: 'text', required: true, readOnly: true, helpText: 'This contest is locked from the application route and cannot be changed here.' },
  { key: 'contest.entryMode', label: 'Individual or group entry', type: 'select', options: ['Individual', 'Group'], required: true },
  { key: 'contest.schoolEntry', label: 'This is a school / institution entry', type: 'checkbox' },
];

const personalInformationFields: RegistrationField[] = [
  { key: 'personal.firstName', label: 'First name', type: 'text', required: true },
  { key: 'personal.middleName', label: 'Middle name', type: 'text' },
  { key: 'personal.lastName', label: 'Last name', type: 'text', required: true },
  { key: 'personal.dateOfBirth', label: 'Date of birth', type: 'date', required: true },
  { key: 'personal.gender', label: 'Gender', type: 'select', options: ['Female', 'Male'], required: true },
  { key: 'personal.nationality', label: 'Nationality', type: 'select', required: true, options: ['Nigerian'] },
  { key: 'personal.stateOfResidence', label: 'State of residence', type: 'select', required: true, options: [...NIGERIA_STATES] },
  { key: 'personal.city', label: 'City / town', type: 'select', required: true, options: [] },
  { key: 'personal.primaryPhone', label: 'Primary phone number', type: 'tel', required: true },
  { key: 'personal.educationLevel', label: 'Current education level', type: 'select', options: ['Primary', 'Secondary', 'Undergraduate', 'Graduate', 'Postgraduate', 'Not in school'], required: true },
];

const academicFields: RegistrationField[] = [
  { key: 'academic.schoolName', label: 'School / institution name', type: 'text', required: true },
  { key: 'academic.fieldOfStudy', label: 'Field of study / discipline', type: 'text' },
  { key: 'academic.teamMembers', label: 'Team members (if group entry)', type: 'textarea' },
];

const guardianConsentFields: RegistrationField[] = [
  { key: 'guardian.fullName', label: 'Parent/guardian full name', type: 'text', required: true },
  { key: 'guardian.relationship', label: 'Relationship to applicant', type: 'text', required: true },
  { key: 'guardian.phone', label: 'Parent/guardian phone number', type: 'tel', required: true },
  { key: 'guardian.email', label: 'Parent/guardian email', type: 'email', required: true },
  { key: 'guardian.digitalSignature', label: 'Digital signature (typed name)', type: 'text', required: true },
  { key: 'guardian.consentGranted', label: 'I authorize this applicant to participate in the STEM Contest', type: 'checkbox', required: true },
];

const identityFields: RegistrationField[] = [
  { key: 'identity.idType', label: 'ID type', type: 'select', options: ['National ID', 'School ID', 'International passport', 'Birth certificate', 'Other approved ID'], required: true },
  { key: 'identity.idUpload', label: 'ID upload', type: 'file', required: true, accept: '.jpg,.jpeg,.png,.pdf' },
  { key: 'identity.schoolId', label: 'School ID (student category)', type: 'file', accept: '.jpg,.jpeg,.png,.pdf' },
];

const projectFields: RegistrationField[] = [
  { key: 'category.innovationCategory', label: 'Innovation category', type: 'select', options: ['AI', 'Robotics', 'Renewable energy', 'Agritech', 'Healthtech', 'Fintech', 'Edtech', 'Climate innovation', 'Hardware', 'Software', 'Engineering', 'Science research', 'Social innovation', 'Other'], required: true },
  { key: 'category.projectTitle', label: 'Project title', type: 'text', required: true },
  { key: 'category.problemStatement', label: 'Problem being solved', type: 'textarea', required: true },
  { key: 'category.solutionSummary', label: 'Your solution (summary)', type: 'textarea', required: true },
  { key: 'category.currentStage', label: 'Current stage', type: 'select', options: ['Idea', 'Research', 'Prototype', 'MVP', 'Pilot', 'Revenue-generating', 'Scaling'], required: true },
  { key: 'category.pitchDeckUpload', label: 'Upload pitch deck', type: 'file', accept: '.pdf,.ppt,.pptx' },
  { key: 'category.prototypeVideo', label: 'Upload prototype / demo video', type: 'file', accept: '.mp4,.mov' },
  { key: 'category.projectRepoLink', label: 'Project / repo / portfolio link', type: 'url' },
  { key: 'category.openToInvestorReview', label: 'Open to investor / mentor review?', type: 'checkbox' },
];

const socialFields: RegistrationField[] = [
  { key: 'social.linkedin', label: 'LinkedIn profile', type: 'url' },
  { key: 'social.website', label: 'Project website / portfolio', type: 'url' },
];

const complianceFields: RegistrationField[] = [
  { key: 'compliance.ownWork', label: 'I confirm this project is my / my team’s original work', type: 'checkbox', required: true },
  { key: 'compliance.codeOfConductAgreement', label: 'I agree to Spotlight code of conduct', type: 'checkbox', required: true },
  { key: 'compliance.truthDeclaration', label: 'I confirm submitted information is true', type: 'checkbox', required: true },
];

const publicProfileFields: RegistrationField[] = [
  { key: 'publicProfile.projectSummary', label: 'Public project summary', type: 'textarea' },
  { key: 'publicProfile.publicVotingConsent', label: 'I consent to my project being displayed publicly and voted on', type: 'checkbox', required: true },
];

const legalFields: RegistrationField[] = [
  { key: 'legal.accuracyDeclaration', label: 'I confirm all information submitted is true, complete, and accurate', type: 'checkbox', required: true },
  { key: 'legal.termsConsent', label: 'I agree to official rules, terms, and eligibility requirements', type: 'checkbox', required: true },
  { key: 'legal.privacyConsent', label: 'I consent to personal data processing for registration and programme administration', type: 'checkbox', required: true },
  { key: 'legal.intellectualPropertyConsent', label: 'I understand submitted project IP remains mine, with a licence for Spotlight to showcase it', type: 'checkbox', required: true },
  { key: 'legal.publicVotingConsent', label: 'I understand approved projects may be displayed publicly and may be voted on', type: 'checkbox', required: true },
  { key: 'legal.ageGuardianConfirmation', label: 'I meet age requirements or have valid guardian consent', type: 'checkbox', required: true },
  { key: 'legal.communicationConsent', label: 'I agree to receive updates via email/SMS/WhatsApp/in-app notifications', type: 'checkbox', required: true },
];

const reviewFields: RegistrationField[] = [
  { key: 'review.confirmSubmit', label: 'I have reviewed my application and I am ready to submit', type: 'checkbox', required: true },
];

export function buildStemContestSteps(draft: RegistrationDraft): RegistrationStep[] {
  const personalStepFields = [
    ...personalInformationFields,
    ...academicFields,
    ...(isMinor(draft) ? guardianConsentFields : []),
  ];

  const contestRequirementFields = [
    ...identityFields,
    ...projectFields,
    ...socialFields,
    ...complianceFields,
    ...publicProfileFields,
  ];

  return [
    { key: 'contest_selection', title: 'Contest Selection', description: 'Confirm your entry type for the STEM Contest.', fields: contestSelectionFields },
    { key: 'personal_information', title: 'Applicant & Academic Details', description: 'Tell us about you and your school / institution.', fields: personalStepFields },
    { key: 'category_specific', title: 'Project & Innovation', description: 'Describe the project or innovation you are entering.', fields: contestRequirementFields },
    { key: 'review_submit', title: 'Consent and Submit', description: 'Confirm declarations and submit your STEM entry.', fields: [...legalFields, ...reviewFields] },
  ];
}
