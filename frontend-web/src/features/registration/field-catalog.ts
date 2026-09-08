// ─────────────────────────────────────────────────────────────────────────────
// Registration field catalog.
//
// This is the curated palette of inputs an admin can map onto a contest. Every
// entry has a known, validated key so downstream validation, admin review and
// analytics keep working. Admins toggle entries on/off and mark them required
// (see the admin "Form builder"); the contestant then sees EXACTLY the enabled
// entries (plus any custom questions and the fixed platform steps below).
//
// Only the `personal_information` and `category_specific` steps are configurable.
// Account login, contest selection, and the legal/consent + submit steps are
// fixed by the platform and defined here as `buildFixed*Step`.
// ─────────────────────────────────────────────────────────────────────────────
import { NIGERIA_STATES, TALENT_SKILL_OPTIONS, MEDICAL_CONDITION_OPTIONS, ALLERGY_OPTIONS, HEALTH_STATUS_OPTIONS } from './reference-data';
import type {
  ConfigurableStepKey,
  ContestCategory,
  ContestCustomField,
  ContestFormSchema,
  FieldType,
  RegistrationField,
  RegistrationStep,
} from './types';

export interface CatalogField {
  key: string;
  label: string;
  type: FieldType;
  step: ConfigurableStepKey;
  group: string;
  options?: string[];
  accept?: string;
  readOnly?: boolean;
  helpText?: string;
  defaultRequired?: boolean;
  minorOnly?: boolean; // guardian-consent fields: only rendered for applicants under legal adult age
}

// Ordered so the admin UI and the wizard render groups in a sensible sequence.
export const FIELD_CATALOG: CatalogField[] = [
  // ── personal_information ──────────────────────────────────────────────────
  { key: 'personal.firstName', label: 'First name', type: 'text', step: 'personal_information', group: 'Personal details', defaultRequired: true },
  { key: 'personal.middleName', label: 'Middle name', type: 'text', step: 'personal_information', group: 'Personal details' },
  { key: 'personal.lastName', label: 'Last name', type: 'text', step: 'personal_information', group: 'Personal details', defaultRequired: true },
  { key: 'personal.stageName', label: 'Stage name / team name', type: 'text', step: 'personal_information', group: 'Personal details' },
  { key: 'personal.dateOfBirth', label: 'Date of birth', type: 'date', step: 'personal_information', group: 'Personal details', defaultRequired: true, helpText: 'Used to compute age and trigger guardian consent for minors.' },
  { key: 'personal.gender', label: 'Gender', type: 'select', step: 'personal_information', group: 'Personal details', options: ['Female', 'Male'], defaultRequired: true },
  { key: 'personal.nationality', label: 'Nationality', type: 'select', step: 'personal_information', group: 'Personal details', options: ['Nigerian'], defaultRequired: true },
  { key: 'personal.stateOfOrigin', label: 'State of origin', type: 'select', step: 'personal_information', group: 'Personal details', options: [...NIGERIA_STATES] },
  { key: 'personal.stateOfResidence', label: 'State of residence', type: 'select', step: 'personal_information', group: 'Personal details', options: [...NIGERIA_STATES], defaultRequired: true },
  { key: 'personal.city', label: 'City / town', type: 'select', step: 'personal_information', group: 'Personal details', options: [], defaultRequired: true, helpText: 'Populated from the selected state of residence.' },
  { key: 'personal.address', label: 'Residential address', type: 'textarea', step: 'personal_information', group: 'Personal details' },
  { key: 'personal.primaryPhone', label: 'Primary phone number', type: 'tel', step: 'personal_information', group: 'Personal details', defaultRequired: true },
  { key: 'personal.whatsapp', label: 'WhatsApp number', type: 'tel', step: 'personal_information', group: 'Personal details' },
  { key: 'personal.educationLevel', label: 'Current education level', type: 'select', step: 'personal_information', group: 'Personal details', options: ['Primary', 'Secondary', 'Undergraduate', 'Graduate', 'Postgraduate', 'Not in school'] },

  { key: 'talent.primarySkill', label: 'Primary talent / skill', type: 'multi_select', step: 'personal_information', group: 'Talent & profile', options: [...TALENT_SKILL_OPTIONS] },
  { key: 'talent.experienceYears', label: 'Years of experience', type: 'number', step: 'personal_information', group: 'Talent & profile' },
  { key: 'talent.skillLevel', label: 'Skill level', type: 'select', step: 'personal_information', group: 'Talent & profile', options: ['Beginner', 'Emerging', 'Intermediate', 'Advanced', 'Professional', 'Self-taught'] },
  { key: 'talent.previousCompetitions', label: 'Previous competitions', type: 'textarea', step: 'personal_information', group: 'Talent & profile' },
  { key: 'talent.strengths', label: 'Strengths', type: 'textarea', step: 'personal_information', group: 'Talent & profile' },
  { key: 'talent.careerGoal', label: 'Career goal', type: 'textarea', step: 'personal_information', group: 'Talent & profile' },
  { key: 'talent.uniqueStory', label: 'What makes your story unique?', type: 'textarea', step: 'personal_information', group: 'Talent & profile' },
  { key: 'talent.filmExperience', label: 'Film / production experience', type: 'textarea', step: 'personal_information', group: 'Talent & profile' },

  { key: 'academic.schoolName', label: 'School / institution name', type: 'text', step: 'personal_information', group: 'Academic' },
  { key: 'academic.fieldOfStudy', label: 'Field of study / discipline', type: 'text', step: 'personal_information', group: 'Academic' },
  { key: 'academic.teamMembers', label: 'Team members (group entry)', type: 'textarea', step: 'personal_information', group: 'Academic' },

  { key: 'founder.roleInBusiness', label: 'Role in the business', type: 'select', step: 'personal_information', group: 'Founder', options: ['Founder', 'Co-founder', 'CEO', 'Managing partner', 'Team lead', 'Other'] },
  { key: 'founder.yearsRunning', label: 'Years running the business', type: 'number', step: 'personal_information', group: 'Founder' },

  { key: 'guardian.fullName', label: 'Parent/guardian full name', type: 'text', step: 'personal_information', group: 'Guardian consent (minors)', minorOnly: true, defaultRequired: true },
  { key: 'guardian.relationship', label: 'Relationship to applicant', type: 'text', step: 'personal_information', group: 'Guardian consent (minors)', minorOnly: true, defaultRequired: true },
  { key: 'guardian.phone', label: 'Parent/guardian phone number', type: 'tel', step: 'personal_information', group: 'Guardian consent (minors)', minorOnly: true, defaultRequired: true },
  { key: 'guardian.email', label: 'Parent/guardian email', type: 'email', step: 'personal_information', group: 'Guardian consent (minors)', minorOnly: true },
  { key: 'guardian.address', label: 'Parent/guardian address', type: 'textarea', step: 'personal_information', group: 'Guardian consent (minors)', minorOnly: true },
  { key: 'guardian.idUpload', label: 'Parent/guardian government ID upload', type: 'file', step: 'personal_information', group: 'Guardian consent (minors)', minorOnly: true, accept: '.jpg,.jpeg,.png,.pdf' },
  { key: 'guardian.digitalSignature', label: 'Guardian digital signature (typed name)', type: 'text', step: 'personal_information', group: 'Guardian consent (minors)', minorOnly: true, defaultRequired: true },
  { key: 'guardian.consentGranted', label: 'Guardian authorizes participation', type: 'checkbox', step: 'personal_information', group: 'Guardian consent (minors)', minorOnly: true, defaultRequired: true },

  // ── category_specific ─────────────────────────────────────────────────────
  { key: 'identity.idType', label: 'Government-issued ID type', type: 'select', step: 'category_specific', group: 'Identity', options: ['National ID', 'International passport', 'Voter card', 'Driver’s license', 'School ID', 'Birth certificate', 'Other approved ID'], defaultRequired: true },
  { key: 'identity.idNumber', label: 'ID number', type: 'text', step: 'category_specific', group: 'Identity' },
  { key: 'identity.idUpload', label: 'ID upload', type: 'file', step: 'category_specific', group: 'Identity', accept: '.jpg,.jpeg,.png,.pdf', defaultRequired: true },
  { key: 'identity.schoolId', label: 'School ID (student category)', type: 'file', step: 'category_specific', group: 'Identity', accept: '.jpg,.jpeg,.png,.pdf' },
  { key: 'identity.cacDocument', label: 'CAC / business registration', type: 'file', step: 'category_specific', group: 'Identity', accept: '.jpg,.jpeg,.png,.pdf' },

  { key: 'media.profilePhoto', label: 'Profile photo', type: 'file', step: 'category_specific', group: 'Media uploads', accept: '.jpg,.jpeg,.png,.webp', defaultRequired: true },
  { key: 'media.introVideo', label: 'Short intro / audition video', type: 'file', step: 'category_specific', group: 'Media uploads', accept: '.mp4,.mov' },
  { key: 'media.audioFile', label: 'Audio file', type: 'file', step: 'category_specific', group: 'Media uploads', accept: '.mp3,.wav,.m4a' },
  { key: 'media.sampleUpload', label: 'Sample work upload', type: 'file', step: 'category_specific', group: 'Media uploads', accept: '.mp4,.mov,.pdf' },
  { key: 'media.rightsConfirmed', label: 'I confirm I have rights to uploaded materials', type: 'checkbox', step: 'category_specific', group: 'Media uploads' },

  { key: 'category.innovationCategory', label: 'Innovation category', type: 'select', step: 'category_specific', group: 'Project / STEM', options: ['AI', 'Robotics', 'Renewable energy', 'Agritech', 'Healthtech', 'Fintech', 'Edtech', 'Climate innovation', 'Hardware', 'Software', 'Engineering', 'Science research', 'Social innovation', 'Other'] },
  { key: 'category.projectTitle', label: 'Project title', type: 'text', step: 'category_specific', group: 'Project / STEM' },
  { key: 'category.problemStatement', label: 'Problem being solved', type: 'textarea', step: 'category_specific', group: 'Project / STEM' },
  { key: 'category.solutionSummary', label: 'Your solution (summary)', type: 'textarea', step: 'category_specific', group: 'Project / STEM' },
  { key: 'category.currentStage', label: 'Current stage', type: 'select', step: 'category_specific', group: 'Project / STEM', options: ['Idea', 'Research', 'Prototype', 'MVP', 'Pilot', 'Revenue-generating', 'Scaling'] },
  { key: 'category.pitchDeckUpload', label: 'Pitch deck upload', type: 'file', step: 'category_specific', group: 'Project / STEM', accept: '.pdf,.ppt,.pptx' },
  { key: 'category.prototypeVideo', label: 'Prototype / demo video', type: 'file', step: 'category_specific', group: 'Project / STEM', accept: '.mp4,.mov' },
  { key: 'category.projectRepoLink', label: 'Project / repo / portfolio link', type: 'url', step: 'category_specific', group: 'Project / STEM' },
  { key: 'category.openToInvestorReview', label: 'Open to investor / mentor review?', type: 'checkbox', step: 'category_specific', group: 'Project / STEM' },

  { key: 'category.businessName', label: 'Business name', type: 'text', step: 'category_specific', group: 'Business / SME' },
  { key: 'category.businessSector', label: 'Business sector', type: 'select', step: 'category_specific', group: 'Business / SME', options: ['Agriculture / Agribusiness', 'Beauty / Personal Care', 'Creative / Media', 'Education / Training', 'Energy / Clean Tech', 'Fashion / Apparel', 'Financial Services / Fintech', 'Food / Beverage', 'Health / Wellness', 'Hospitality / Tourism', 'Logistics / Transportation', 'Manufacturing', 'Retail / E-commerce', 'Social Enterprise', 'Technology / SaaS', 'Other'] },
  { key: 'category.businessStage', label: 'Business stage', type: 'select', step: 'category_specific', group: 'Business / SME', options: ['Idea stage', 'Startup', 'Early revenue', 'Growing business', 'Community business', 'Student business', 'Women-led business', 'Social enterprise'] },
  { key: 'category.productDescription', label: 'Product / service description', type: 'textarea', step: 'category_specific', group: 'Business / SME' },
  { key: 'category.problemSolved', label: 'Problem your business solves', type: 'textarea', step: 'category_specific', group: 'Business / SME' },
  { key: 'category.revenueModel', label: 'Revenue model', type: 'textarea', step: 'category_specific', group: 'Business / SME' },
  { key: 'category.tractionMetrics', label: 'Traction so far', type: 'textarea', step: 'category_specific', group: 'Business / SME' },
  { key: 'category.fundingNeeded', label: 'Funding / support sought', type: 'textarea', step: 'category_specific', group: 'Business / SME' },
  { key: 'category.pitchDeck', label: 'Pitch deck upload', type: 'file', step: 'category_specific', group: 'Business / SME', accept: '.pdf,.ppt,.pptx' },

  { key: 'category.performanceType', label: 'Performance type', type: 'select', step: 'category_specific', group: 'Performance', options: ['Singing', 'Rap', 'Spoken Word', 'Comedy', 'Instrumental', 'Other'] },
  { key: 'category.genre', label: 'Genre / style', type: 'text', step: 'category_specific', group: 'Performance' },
  { key: 'category.durationMinutes', label: 'Performance length (minutes)', type: 'number', step: 'category_specific', group: 'Performance' },
  { key: 'category.audioUpload', label: 'Audition audio upload', type: 'file', step: 'category_specific', group: 'Performance', accept: '.mp3,.wav,.m4a' },
  { key: 'category.sampleLink', label: 'Performance sample link', type: 'url', step: 'category_specific', group: 'Performance' },
  { key: 'category.ownsRights', label: 'I own / have rights to my material', type: 'checkbox', step: 'category_specific', group: 'Performance' },

  { key: 'category.filmRole', label: 'Area of film interest', type: 'select', step: 'category_specific', group: 'Film craft', options: ['Screenwriter', 'Director', 'Cinematographer', 'Editor', 'Sound recordist', 'Production designer', 'Makeup artist', 'Costume designer', 'Script supervisor', 'Producer', 'Lighting assistant', 'Camera assistant', 'Production assistant', 'Other'] },
  { key: 'category.productionExperience', label: 'Previous production experience', type: 'textarea', step: 'category_specific', group: 'Film craft' },
  { key: 'category.portfolioLink', label: 'Portfolio / showreel link', type: 'url', step: 'category_specific', group: 'Film craft' },
  { key: 'category.longHoursConsent', label: 'Comfortable working long production hours?', type: 'checkbox', step: 'category_specific', group: 'Film craft' },

  { key: 'category.housemateReadiness', label: 'Comfortable living with other contestants?', type: 'checkbox', step: 'category_specific', group: 'Reality show' },
  { key: 'category.dailyFilmingConsent', label: 'Comfortable being filmed daily?', type: 'checkbox', step: 'category_specific', group: 'Reality show' },
  { key: 'category.uniqueStory', label: 'What makes your story compelling for TV?', type: 'textarea', step: 'category_specific', group: 'Reality show' },

  { key: 'social.instagram', label: 'Instagram handle', type: 'text', step: 'category_specific', group: 'Social & fanbase' },
  { key: 'social.tiktok', label: 'TikTok handle', type: 'text', step: 'category_specific', group: 'Social & fanbase' },
  { key: 'social.youtube', label: 'YouTube channel', type: 'text', step: 'category_specific', group: 'Social & fanbase' },
  { key: 'social.facebook', label: 'Facebook page', type: 'text', step: 'category_specific', group: 'Social & fanbase' },
  { key: 'social.x', label: 'X / Twitter handle', type: 'text', step: 'category_specific', group: 'Social & fanbase' },
  { key: 'social.linkedin', label: 'LinkedIn profile', type: 'url', step: 'category_specific', group: 'Social & fanbase' },
  { key: 'social.website', label: 'Website / portfolio', type: 'url', step: 'category_specific', group: 'Social & fanbase' },
  { key: 'social.totalFollowers', label: 'Total estimated followers', type: 'number', step: 'category_specific', group: 'Social & fanbase' },
  { key: 'social.willingToInviteVoting', label: 'Willing to invite fans to vote?', type: 'checkbox', step: 'category_specific', group: 'Social & fanbase' },

  { key: 'bootcamp.availableFullPeriod', label: 'Available for full bootcamp period?', type: 'select', step: 'category_specific', group: 'Bootcamp readiness', options: ['Fully available', 'Available with notice', 'Partially available', 'Not available'] },
  { key: 'bootcamp.canTravel', label: 'Can travel to bootcamp location?', type: 'checkbox', step: 'category_specific', group: 'Bootcamp readiness' },
  { key: 'bootcamp.travelRestrictions', label: 'Any travel restrictions?', type: 'textarea', step: 'category_specific', group: 'Bootcamp readiness' },
  { key: 'bootcamp.comfortLivingWithContestants', label: 'Comfortable living with other participants?', type: 'checkbox', step: 'category_specific', group: 'Bootcamp readiness' },
  { key: 'bootcamp.comfortPublicVoting', label: 'Comfortable with public voting / eviction?', type: 'checkbox', step: 'category_specific', group: 'Bootcamp readiness' },
  { key: 'bootcamp.personalConsiderations', label: 'Religious / cultural / dietary considerations', type: 'textarea', step: 'category_specific', group: 'Bootcamp readiness' },

  { key: 'medical.generalHealthStatus', label: 'General health status', type: 'multi_select', step: 'category_specific', group: 'Medical & welfare', options: [...HEALTH_STATUS_OPTIONS] },
  { key: 'medical.knownConditions', label: 'Known medical conditions', type: 'multi_select', step: 'category_specific', group: 'Medical & welfare', options: [...MEDICAL_CONDITION_OPTIONS] },
  { key: 'medical.allergies', label: 'Allergies', type: 'multi_select', step: 'category_specific', group: 'Medical & welfare', options: [...ALLERGY_OPTIONS] },
  { key: 'medical.currentMedication', label: 'Medication currently used', type: 'textarea', step: 'category_specific', group: 'Medical & welfare' },
  { key: 'medical.dietaryRestrictions', label: 'Dietary restrictions', type: 'textarea', step: 'category_specific', group: 'Medical & welfare' },
  { key: 'medical.physicalLimitations', label: 'Physical limitations', type: 'textarea', step: 'category_specific', group: 'Medical & welfare' },
  { key: 'medical.emergencyTreatmentConsent', label: 'I consent to emergency medical support', type: 'checkbox', step: 'category_specific', group: 'Medical & welfare' },

  { key: 'emergency.fullName', label: 'Emergency contact full name', type: 'text', step: 'category_specific', group: 'Emergency contact' },
  { key: 'emergency.relationship', label: 'Emergency contact relationship', type: 'select', step: 'category_specific', group: 'Emergency contact', options: ['Parent', 'Sibling', 'Spouse', 'Guardian', 'Relative', 'Friend', 'Other'] },
  { key: 'emergency.phone', label: 'Emergency contact phone', type: 'tel', step: 'category_specific', group: 'Emergency contact' },
  { key: 'emergency.altPhone', label: 'Emergency alternative phone', type: 'tel', step: 'category_specific', group: 'Emergency contact' },
  { key: 'emergency.state', label: 'Emergency contact state', type: 'select', step: 'category_specific', group: 'Emergency contact', options: [...NIGERIA_STATES] },
  { key: 'emergency.city', label: 'Emergency contact city', type: 'select', step: 'category_specific', group: 'Emergency contact', options: [], helpText: 'Populated from the selected emergency state.' },

  { key: 'compliance.previouslyInRealityShow', label: 'Previously in a reality show?', type: 'checkbox', step: 'category_specific', group: 'Compliance' },
  { key: 'compliance.exclusiveContract', label: 'Under exclusive talent contract?', type: 'checkbox', step: 'category_specific', group: 'Compliance' },
  { key: 'compliance.legalRestriction', label: 'Any legal restriction to participation?', type: 'checkbox', step: 'category_specific', group: 'Compliance' },
  { key: 'compliance.ownWork', label: 'I confirm this entry is my original work', type: 'checkbox', step: 'category_specific', group: 'Compliance' },
  { key: 'compliance.registeredBusiness', label: 'Business is formally registered (CAC)', type: 'checkbox', step: 'category_specific', group: 'Compliance' },
  { key: 'compliance.codeOfConductAgreement', label: 'I agree to the code of conduct', type: 'checkbox', step: 'category_specific', group: 'Compliance' },
  { key: 'compliance.backgroundCheckAgreement', label: 'I agree to background checks if selected', type: 'checkbox', step: 'category_specific', group: 'Compliance' },

  { key: 'payment.feeAmount', label: 'Registration fee amount', type: 'number', step: 'category_specific', group: 'Payment', readOnly: true, helpText: 'Set from the contest fee; contestant cannot edit.', defaultRequired: true },
  { key: 'payment.method', label: 'Payment method', type: 'select', step: 'category_specific', group: 'Payment', options: ['Card', 'Bank Transfer', 'USSD', 'Wallet', 'Waiver'], defaultRequired: false },
  { key: 'payment.transactionReference', label: 'Transaction reference', type: 'text', step: 'category_specific', group: 'Payment' },

  { key: 'audition.format', label: 'Preferred audition format', type: 'select', step: 'category_specific', group: 'Audition', options: ['Online video submission', 'Live virtual audition', 'Physical audition', 'Regional audition', 'Callback audition', 'Portfolio review'], defaultRequired: true },
  { key: 'audition.onlineLink', label: 'Online audition / showreel link', type: 'url', step: 'category_specific', group: 'Audition' },

  { key: 'publicProfile.profilePhoto', label: 'Public profile photo', type: 'file', step: 'category_specific', group: 'Public voting profile', accept: '.jpg,.jpeg,.png,.webp' },
  { key: 'publicProfile.talentSummary', label: 'Public talent summary', type: 'textarea', step: 'category_specific', group: 'Public voting profile' },
  { key: 'publicProfile.publicVotingConsent', label: 'I consent to public voting visibility', type: 'checkbox', step: 'category_specific', group: 'Public voting profile' },
];

const CATALOG_BY_KEY: Record<string, CatalogField> = FIELD_CATALOG.reduce((acc, field) => {
  acc[field.key] = field;
  return acc;
}, {} as Record<string, CatalogField>);

export function getCatalogField(key: string): CatalogField | undefined {
  return CATALOG_BY_KEY[key];
}

export function getCatalogFieldsForStep(step: ConfigurableStepKey): CatalogField[] {
  return FIELD_CATALOG.filter((field) => field.step === step);
}

// Group order used by the admin UI (groups not listed fall to the end).
export const CATALOG_GROUP_ORDER: string[] = [
  'Personal details',
  'Talent & profile',
  'Academic',
  'Founder',
  'Guardian consent (minors)',
  'Identity',
  'Media uploads',
  'Project / STEM',
  'Business / SME',
  'Performance',
  'Film craft',
  'Reality show',
  'Social & fanbase',
  'Bootcamp readiness',
  'Medical & welfare',
  'Emergency contact',
  'Compliance',
  'Payment',
  'Audition',
  'Public voting profile',
];

// Sensible starting selection when an admin creates a contest of a given
// category. They can freely add/remove afterwards. Keys must exist in the catalog.
export const CATEGORY_FIELD_PRESETS: Record<string, string[]> = {
  general_reality_show: [
    'personal.firstName', 'personal.lastName', 'personal.dateOfBirth', 'personal.gender', 'personal.stateOfResidence', 'personal.city', 'personal.primaryPhone',
    'talent.primarySkill', 'talent.strengths', 'talent.uniqueStory',
    'identity.idType', 'identity.idUpload', 'media.profilePhoto',
    'category.housemateReadiness', 'category.dailyFilmingConsent', 'category.uniqueStory',
    'social.instagram', 'social.willingToInviteVoting',
    'bootcamp.availableFullPeriod', 'bootcamp.canTravel',
    'medical.generalHealthStatus', 'medical.emergencyTreatmentConsent',
    'emergency.fullName', 'emergency.phone', 'emergency.state', 'emergency.city',
    'compliance.codeOfConductAgreement',
    'payment.feeAmount', 'payment.method',
    'audition.format', 'publicProfile.publicVotingConsent',
  ],
  stem_innovation: [
    'personal.firstName', 'personal.lastName', 'personal.dateOfBirth', 'personal.gender', 'personal.stateOfResidence', 'personal.city', 'personal.primaryPhone', 'personal.educationLevel',
    'academic.schoolName', 'academic.fieldOfStudy', 'academic.teamMembers',
    'identity.idType', 'identity.idUpload', 'identity.schoolId',
    'category.innovationCategory', 'category.projectTitle', 'category.problemStatement', 'category.solutionSummary', 'category.currentStage', 'category.pitchDeckUpload', 'category.prototypeVideo', 'category.projectRepoLink', 'category.openToInvestorReview',
    'social.linkedin', 'social.website',
    'compliance.ownWork', 'compliance.codeOfConductAgreement',
    'publicProfile.publicVotingConsent',
  ],
  sme_pitch: [
    'personal.firstName', 'personal.lastName', 'personal.dateOfBirth', 'personal.gender', 'personal.stateOfResidence', 'personal.city', 'personal.primaryPhone',
    'founder.roleInBusiness', 'founder.yearsRunning',
    'identity.idType', 'identity.idUpload', 'identity.cacDocument',
    'category.businessName', 'category.businessSector', 'category.businessStage', 'category.productDescription', 'category.problemSolved', 'category.revenueModel', 'category.tractionMetrics', 'category.fundingNeeded', 'category.pitchDeck',
    'social.website', 'social.instagram', 'social.linkedin',
    'compliance.registeredBusiness', 'compliance.ownWork', 'compliance.codeOfConductAgreement',
    'audition.format', 'publicProfile.publicVotingConsent',
  ],
  open_mic: [
    'personal.firstName', 'personal.lastName', 'personal.stageName', 'personal.dateOfBirth', 'personal.gender', 'personal.stateOfResidence', 'personal.city', 'personal.primaryPhone',
    'talent.primarySkill', 'talent.strengths',
    'identity.idType', 'identity.idUpload', 'media.profilePhoto',
    'category.performanceType', 'category.genre', 'category.durationMinutes', 'category.audioUpload', 'category.sampleLink', 'category.ownsRights',
    'social.instagram', 'social.tiktok', 'social.willingToInviteVoting',
    'compliance.codeOfConductAgreement',
    'payment.feeAmount', 'payment.method',
    'audition.format', 'publicProfile.publicVotingConsent',
  ],
  film_production: [
    'personal.firstName', 'personal.lastName', 'personal.dateOfBirth', 'personal.gender', 'personal.stateOfResidence', 'personal.city', 'personal.primaryPhone',
    'talent.filmExperience', 'talent.careerGoal',
    'identity.idType', 'identity.idUpload', 'media.profilePhoto', 'media.sampleUpload',
    'category.filmRole', 'category.productionExperience', 'category.portfolioLink', 'category.longHoursConsent',
    'social.instagram', 'social.website',
    'bootcamp.availableFullPeriod', 'bootcamp.canTravel',
    'medical.generalHealthStatus', 'medical.emergencyTreatmentConsent',
    'emergency.fullName', 'emergency.phone', 'emergency.state', 'emergency.city',
    'compliance.codeOfConductAgreement', 'compliance.backgroundCheckAgreement',
    'payment.feeAmount', 'payment.method',
    'audition.format',
  ],
};

const GENERAL_PRESET: string[] = [
  'personal.firstName', 'personal.lastName', 'personal.dateOfBirth', 'personal.gender', 'personal.stateOfResidence', 'personal.city', 'personal.primaryPhone',
  'identity.idType', 'identity.idUpload', 'media.profilePhoto',
  'social.instagram',
  'compliance.codeOfConductAgreement',
  'publicProfile.publicVotingConsent',
];

export function getCategoryFieldPreset(category: ContestCategory | string): string[] {
  return CATEGORY_FIELD_PRESETS[String(category)] || GENERAL_PRESET;
}

// ── Fixed platform steps (not admin-configurable) ────────────────────────────

const fixedLegalFields: RegistrationField[] = [
  { key: 'legal.accuracyDeclaration', label: 'I confirm all information submitted is true, complete, and accurate', type: 'checkbox', required: true },
  { key: 'legal.termsConsent', label: 'I agree to official rules, terms, and eligibility requirements', type: 'checkbox', required: true },
  { key: 'legal.privacyConsent', label: 'I consent to personal data processing for registration and programme administration', type: 'checkbox', required: true },
  { key: 'legal.communicationConsent', label: 'I agree to receive updates via email/SMS/WhatsApp/in-app notifications', type: 'checkbox', required: true },
  { key: 'review.confirmSubmit', label: 'I have reviewed my application and I am ready to submit', type: 'checkbox', required: true },
];

export function buildFixedContestSelectionStep(): RegistrationStep {
  return {
    key: 'contest_selection',
    title: 'Contest Selection',
    description: 'Confirm the contest you are applying to.',
    fields: [
      { key: 'contest.title', label: 'Contest title', type: 'text', required: true, readOnly: true, helpText: 'This contest is locked from the application route and cannot be changed here.' },
      { key: 'contest.entryMode', label: 'Individual or group entry', type: 'select', options: ['Individual', 'Group'], required: true },
    ],
  };
}

export function buildFixedReviewSubmitStep(): RegistrationStep {
  return { key: 'review_submit', title: 'Consent and Submit', description: 'Confirm legal declarations and submit your application.', fields: fixedLegalFields };
}

// ── Schema sanitisation (server-side, used by the admin contest API) ─────────

const ALLOWED_CUSTOM_FIELD_TYPES: FieldType[] = [
  'text', 'textarea', 'email', 'tel', 'url', 'number', 'date', 'select', 'multi_select', 'checkbox', 'file',
];

const CONFIGURABLE_STEPS: ConfigurableStepKey[] = ['personal_information', 'category_specific'];

function slugifyCustomKey(label: string, index: number): string {
  const base = String(label || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 40);
  return `custom.${base || `question_${index + 1}`}`;
}

/**
 * Validate and normalise an untrusted form-schema payload from the admin API.
 * Returns `undefined` when the payload doesn't describe a real schema (in which
 * case the contest falls back to its code template). Guarantees every included
 * field is a real catalog key and every custom field is well-formed.
 */
export function sanitizeContestFormSchema(raw: unknown): ContestFormSchema | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const input = raw as Record<string, unknown>;

  const includedFields = Array.isArray(input.includedFields)
    ? Array.from(
        new Set(
          input.includedFields
            .map((item) => String(item))
            .filter((key) => Boolean(CATALOG_BY_KEY[key])),
        ),
      )
    : [];

  const requiredOverrides: Record<string, boolean> = {};
  if (input.requiredOverrides && typeof input.requiredOverrides === 'object') {
    for (const [key, value] of Object.entries(input.requiredOverrides as Record<string, unknown>)) {
      if (CATALOG_BY_KEY[key] && typeof value === 'boolean') {
        requiredOverrides[key] = value;
      }
    }
  }

  const customFields: ContestCustomField[] = [];
  const usedKeys = new Set<string>();
  if (Array.isArray(input.customFields)) {
    input.customFields.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      const cf = item as Record<string, unknown>;
      const label = String(cf.label || '').trim();
      const type = String(cf.type || '') as FieldType;
      const step = String(cf.step || '') as ConfigurableStepKey;
      if (!label) return;
      if (!ALLOWED_CUSTOM_FIELD_TYPES.includes(type)) return;
      if (!CONFIGURABLE_STEPS.includes(step)) return;

      let key = String(cf.key || '').trim();
      if (!key.startsWith('custom.')) key = slugifyCustomKey(label, index);
      while (usedKeys.has(key)) key = `${key}_${index}`;
      usedKeys.add(key);

      const options = Array.isArray(cf.options)
        ? cf.options.map((opt) => String(opt).trim()).filter(Boolean)
        : undefined;

      customFields.push({
        key,
        label,
        type,
        step,
        required: Boolean(cf.required),
        options: options && options.length > 0 ? options : undefined,
        accept: typeof cf.accept === 'string' ? cf.accept : undefined,
        helpText: typeof cf.helpText === 'string' && cf.helpText.trim() ? cf.helpText.trim() : undefined,
      });
    });
  }

  if (includedFields.length === 0 && customFields.length === 0) return undefined;

  return { version: 1, includedFields, requiredOverrides, customFields };
}

// Turn a catalog entry (+ optional admin required override) into a wizard field.
export function catalogFieldToRegistrationField(entry: CatalogField, requiredOverride?: boolean): RegistrationField {
  return {
    key: entry.key,
    label: entry.label,
    type: entry.type,
    required: typeof requiredOverride === 'boolean' ? requiredOverride : Boolean(entry.defaultRequired),
    readOnly: entry.readOnly,
    helpText: entry.helpText,
    options: entry.options ? [...entry.options] : undefined,
    accept: entry.accept,
  };
}
