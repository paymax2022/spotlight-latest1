// ─────────────────────────────────────────────────────────────────────────────
// Spotlight SME Pitch Contest — registration form (slug: sme-pitch-contest)
//
// SELF-CONTAINED. Editing anything here affects ONLY the SME Pitch form.
//
// Contest shape: free entry, business/startup focused, supports group entry,
// public voting and pitch audition scheduling. NO medical, NO bootcamp, NO
// payment. Collects business, product, revenue and CAC details.
// ─────────────────────────────────────────────────────────────────────────────
import { NIGERIA_STATES } from '../reference-data';
import type { RegistrationDraft, RegistrationField, RegistrationStep } from '../types';

const contestSelectionFields: RegistrationField[] = [
  { key: 'contest.title', label: 'Contest title', type: 'text', required: true, readOnly: true, helpText: 'This contest is locked from the application route and cannot be changed here.' },
  { key: 'contest.entryMode', label: 'Solo founder or team entry', type: 'select', options: ['Individual', 'Group'], required: true },
];

const founderFields: RegistrationField[] = [
  { key: 'personal.firstName', label: 'First name', type: 'text', required: true },
  { key: 'personal.lastName', label: 'Last name', type: 'text', required: true },
  { key: 'personal.dateOfBirth', label: 'Date of birth', type: 'date', required: true },
  { key: 'personal.gender', label: 'Gender', type: 'select', options: ['Female', 'Male'], required: true },
  { key: 'personal.nationality', label: 'Nationality', type: 'select', required: true, options: ['Nigerian'] },
  { key: 'personal.stateOfResidence', label: 'State of residence', type: 'select', required: true, options: [...NIGERIA_STATES] },
  { key: 'personal.city', label: 'City / town', type: 'select', required: true, options: [] },
  { key: 'personal.primaryPhone', label: 'Primary phone number', type: 'tel', required: true },
  { key: 'founder.roleInBusiness', label: 'Your role in the business', type: 'select', options: ['Founder', 'Co-founder', 'CEO', 'Managing partner', 'Team lead', 'Other'], required: true },
  { key: 'founder.yearsRunning', label: 'Years running the business', type: 'number' },
];

const identityFields: RegistrationField[] = [
  { key: 'identity.idType', label: 'Government-issued ID type', type: 'select', options: ['National ID', 'International passport', 'Voter card', 'Driver’s license', 'Other approved ID'], required: true },
  { key: 'identity.idUpload', label: 'ID upload', type: 'file', required: true, accept: '.jpg,.jpeg,.png,.pdf' },
  { key: 'identity.cacDocument', label: 'CAC / business registration document', type: 'file', accept: '.jpg,.jpeg,.png,.pdf' },
];

const businessFields: RegistrationField[] = [
  { key: 'category.businessName', label: 'Business name', type: 'text', required: true },
  {
    key: 'category.businessSector',
    label: 'Business sector',
    type: 'select',
    options: [
      'Agriculture / Agribusiness',
      'Beauty / Personal Care',
      'Creative / Media',
      'Education / Training',
      'Energy / Clean Tech',
      'Fashion / Apparel',
      'Financial Services / Fintech',
      'Food / Beverage',
      'Health / Wellness',
      'Hospitality / Tourism',
      'Logistics / Transportation',
      'Manufacturing',
      'Retail / E-commerce',
      'Social Enterprise',
      'Technology / SaaS',
      'Other',
    ],
    required: true,
  },
  { key: 'category.businessStage', label: 'Business stage', type: 'select', options: ['Idea stage', 'Startup', 'Early revenue', 'Growing business', 'Community business', 'Student business', 'Women-led business', 'Social enterprise'], required: true },
  { key: 'category.productDescription', label: 'Product / service description', type: 'textarea', required: true },
  { key: 'category.problemSolved', label: 'Problem your business solves', type: 'textarea', required: true },
  { key: 'category.revenueModel', label: 'Revenue model', type: 'textarea', required: true },
  { key: 'category.tractionMetrics', label: 'Traction so far (customers, revenue, growth)', type: 'textarea' },
  { key: 'category.fundingNeeded', label: 'Funding / support you are seeking', type: 'textarea' },
  { key: 'category.pitchDeck', label: 'Pitch deck upload', type: 'file', required: true, accept: '.pdf,.ppt,.pptx' },
];

const socialFields: RegistrationField[] = [
  { key: 'social.website', label: 'Business website', type: 'url' },
  { key: 'social.instagram', label: 'Business Instagram', type: 'text' },
  { key: 'social.linkedin', label: 'LinkedIn page', type: 'url' },
];

const complianceFields: RegistrationField[] = [
  { key: 'compliance.registeredBusiness', label: 'Is the business formally registered (CAC)?', type: 'checkbox' },
  { key: 'compliance.ownWork', label: 'I confirm this business/pitch is genuinely mine', type: 'checkbox', required: true },
  { key: 'compliance.codeOfConductAgreement', label: 'I agree to Spotlight code of conduct', type: 'checkbox', required: true },
  { key: 'compliance.truthDeclaration', label: 'I confirm submitted information is true', type: 'checkbox', required: true },
];

const auditionFields: RegistrationField[] = [
  { key: 'audition.format', label: 'Preferred pitch format', type: 'select', options: ['Online video pitch', 'Live virtual pitch', 'Physical pitch event', 'Regional pitch'], required: true },
  { key: 'audition.onlineLink', label: 'Pitch video link (optional)', type: 'url' },
];

const publicProfileFields: RegistrationField[] = [
  { key: 'publicProfile.businessSummary', label: 'Public business summary', type: 'textarea' },
  { key: 'publicProfile.publicVotingConsent', label: 'I consent to my business profile being displayed publicly and voted on', type: 'checkbox', required: true },
];

const legalFields: RegistrationField[] = [
  { key: 'legal.accuracyDeclaration', label: 'I confirm all information submitted is true, complete, and accurate', type: 'checkbox', required: true },
  { key: 'legal.termsConsent', label: 'I agree to official rules, terms, and eligibility requirements', type: 'checkbox', required: true },
  { key: 'legal.privacyConsent', label: 'I consent to personal data processing for registration and programme administration', type: 'checkbox', required: true },
  { key: 'legal.intellectualPropertyConsent', label: 'I understand my business IP remains mine, with a licence for Spotlight to showcase it', type: 'checkbox', required: true },
  { key: 'legal.publicVotingConsent', label: 'I understand approved pitches may be displayed publicly and may be voted on', type: 'checkbox', required: true },
  { key: 'legal.communicationConsent', label: 'I agree to receive updates via email/SMS/WhatsApp/in-app notifications', type: 'checkbox', required: true },
];

const reviewFields: RegistrationField[] = [
  { key: 'review.confirmSubmit', label: 'I have reviewed my application and I am ready to submit', type: 'checkbox', required: true },
];

export function buildSmePitchContestSteps(_draft: RegistrationDraft): RegistrationStep[] {
  const contestRequirementFields = [
    ...identityFields,
    ...businessFields,
    ...socialFields,
    ...complianceFields,
    ...auditionFields,
    ...publicProfileFields,
  ];

  return [
    { key: 'contest_selection', title: 'Contest Selection', description: 'Confirm your entry type for the SME Pitch Contest.', fields: contestSelectionFields },
    { key: 'personal_information', title: 'Founder Details', description: 'Tell us about you as the founder / lead.', fields: founderFields },
    { key: 'category_specific', title: 'Business & Pitch', description: 'Describe your business and upload your pitch.', fields: contestRequirementFields },
    { key: 'review_submit', title: 'Consent and Submit', description: 'Confirm declarations and submit your pitch.', fields: [...legalFields, ...reviewFields] },
  ];
}
