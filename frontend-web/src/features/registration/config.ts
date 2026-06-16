import type {
  ContestRegistrationDefinition,
  RegistrationField,
  RegistrationStep,
  RegistrationStepKey,
  RegistrationDraft,
} from './types';

export const NIGERIA_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT Abuja', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos',
  'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
  'Taraba', 'Yobe', 'Zamfara',
];

export const NIGERIA_CITIES_BY_STATE: Record<string, string[]> = {
  Abia: ['Umuahia', 'Aba', 'Ohafia'],
  Adamawa: ['Yola', 'Mubi', 'Numan'],
  'Akwa Ibom': ['Uyo', 'Eket', 'Ikot Ekpene'],
  Anambra: ['Awka', 'Onitsha', 'Nnewi'],
  Bauchi: ['Bauchi', 'Azare', 'Misau'],
  Bayelsa: ['Yenagoa', 'Sagbama', 'Brass'],
  Benue: ['Makurdi', 'Gboko', 'Otukpo'],
  Borno: ['Maiduguri', 'Biu', 'Bama'],
  'Cross River': ['Calabar', 'Ikom', 'Ogoja'],
  Delta: ['Asaba', 'Warri', 'Sapele'],
  Ebonyi: ['Abakaliki', 'Afikpo', 'Onueke'],
  Edo: ['Benin City', 'Ekpoma', 'Auchi'],
  Ekiti: ['Ado Ekiti', 'Ikere Ekiti', 'Oye Ekiti'],
  Enugu: ['Enugu', 'Nsukka', 'Agbani'],
  'FCT Abuja': ['Abuja', 'Gwagwalada', 'Kubwa'],
  Gombe: ['Gombe', 'Kaltungo', 'Dukku'],
  Imo: ['Owerri', 'Orlu', 'Okigwe'],
  Jigawa: ['Dutse', 'Hadejia', 'Gumel'],
  Kaduna: ['Kaduna', 'Zaria', 'Kafanchan'],
  Kano: ['Kano', 'Wudil', 'Gwarzo'],
  Katsina: ['Katsina', 'Daura', 'Funtua'],
  Kebbi: ['Birnin Kebbi', 'Argungu', 'Yauri'],
  Kogi: ['Lokoja', 'Okene', 'Idah'],
  Kwara: ['Ilorin', 'Offa', 'Jebba'],
  Lagos: ['Ikeja', 'Lekki', 'Surulere'],
  Nasarawa: ['Lafia', 'Keffi', 'Akwanga'],
  Niger: ['Minna', 'Bida', 'Suleja'],
  Ogun: ['Abeokuta', 'Ijebu Ode', 'Sagamu'],
  Ondo: ['Akure', 'Ondo', 'Owo'],
  Osun: ['Osogbo', 'Ile-Ife', 'Ilesa'],
  Oyo: ['Ibadan', 'Ogbomosho', 'Oyo'],
  Plateau: ['Jos', 'Bukuru', 'Pankshin'],
  Rivers: ['Port Harcourt', 'Bonny', 'Omoku'],
  Sokoto: ['Sokoto', 'Tambuwal', 'Wurno'],
  Taraba: ['Jalingo', 'Wukari', 'Bali'],
  Yobe: ['Damaturu', 'Potiskum', 'Gashua'],
  Zamfara: ['Gusau', 'Kaura Namoda', 'Talata Mafara'],
};

export const DEFAULT_APPLICANT_CATEGORIES = [
  'Music',
  'Acting',
  'Comedy',
  'Dance',
  'Content Creation',
  'Film Production',
  'STEM / Innovation',
  'SME Pitch',
  'School Talent',
  'Campus Talent',
  'Open Mic',
  'General Reality Show',
  'Other',
];

export const TALENT_SKILL_OPTIONS = [
  'Singing',
  'Rapping',
  'Songwriting',
  'Music Production',
  'Acting',
  'Comedy',
  'Dance',
  'Content Creation',
  'Film Production',
  'STEM / Innovation',
  'SME Pitch',
  'Public Speaking',
  'Presenting',
  'Instrumentalist',
  'Spoken Word',
];

const CONTEST_CATEGORY_SKILL_MAP: Record<string, string[]> = {
  music: ['Singing', 'Rapping', 'Songwriting', 'Music Production', 'Instrumentalist'],
  acting: ['Acting', 'Presenting', 'Public Speaking', 'Content Creation'],
  comedy_content: ['Comedy', 'Content Creation', 'Public Speaking', 'Presenting'],
  dance: ['Dance', 'Content Creation'],
  film_production: ['Film Production', 'Acting', 'Content Creation'],
  stem_innovation: ['STEM / Innovation', 'Public Speaking'],
  sme_pitch: ['SME Pitch', 'Public Speaking', 'Presenting'],
  school_campus: ['STEM / Innovation', 'Content Creation', 'Public Speaking', 'Presenting'],
  open_mic: ['Singing', 'Rapping', 'Spoken Word', 'Comedy', 'Instrumentalist'],
  general_reality_show: ['Singing', 'Acting', 'Comedy', 'Dance', 'Content Creation', 'Public Speaking'],
  other: [...TALENT_SKILL_OPTIONS],
};

export function getTalentSkillsForContestCategory(categoryKey: string) {
  const allowed = CONTEST_CATEGORY_SKILL_MAP[categoryKey] || CONTEST_CATEGORY_SKILL_MAP.other;
  return TALENT_SKILL_OPTIONS.filter((option) => allowed.includes(option));
}

export const MEDICAL_CONDITION_OPTIONS = [
  'Asthma',
  'Hypertension',
  'Diabetes',
  'Epilepsy',
  'Sickle Cell',
  'Ulcer',
  'Migraine',
  'None',
];

export const ALLERGY_OPTIONS = [
  'Peanuts',
  'Seafood',
  'Dairy',
  'Egg',
  'Dust',
  'Pollen',
  'Medication',
  'None',
];

export const contestRegistrationCatalog: ContestRegistrationDefinition[] = [
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
    auditionStates: [...NIGERIA_STATES],
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
    auditionStates: [...NIGERIA_STATES],
    applicantCategories: ['STEM / Innovation', 'School Talent', 'Campus Talent'],
    categoryQuestionSet: 'stem_innovation',
  },
  {
    slug: 'sme-pitch-contest',
    title: 'Spotlight SME Pitch Contest',
    contestCategory: 'sme_pitch',
    contestType: 'pitch_competition',
    seasonOrEdition: '2026',
    regionScope: 'national',
    isPaid: false,
    requiresGuardianConsentForMinors: false,
    legalAdultAge: 18,
    requiresMedical: false,
    requiresBootcampReadiness: false,
    supportsVoting: true,
    supportsAuditionScheduling: true,
    supportsSchoolEntry: false,
    supportsGroupEntry: true,
    auditionStates: [...NIGERIA_STATES],
    applicantCategories: ['SME Pitch', 'Entrepreneur', 'Startup'],
    categoryQuestionSet: 'sme_pitch',
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
    auditionStates: [...NIGERIA_STATES],
    applicantCategories: ['Open Mic', 'Music', 'Spoken Word'],
    categoryQuestionSet: 'open_mic',
  },
  {
    slug: 'film-academy',
    title: 'Spotlight Film Academy',
    contestCategory: 'film_production',
    contestType: 'bootcamp_reality_show',
    seasonOrEdition: 'Cohort 2026',
    regionScope: 'national',
    isPaid: true,
    registrationFeeNgn: 7500,
    requiresGuardianConsentForMinors: true,
    legalAdultAge: 18,
    requiresMedical: true,
    requiresBootcampReadiness: true,
    supportsVoting: false,
    supportsAuditionScheduling: true,
    supportsSchoolEntry: false,
    supportsGroupEntry: true,
    auditionStates: [...NIGERIA_STATES],
    applicantCategories: ['Film Production', 'Acting', 'Content Creation'],
    categoryQuestionSet: 'film_production',
  },
];

const accountGateFields: RegistrationField[] = [
  { key: 'account.fullName', label: 'Full name', type: 'text', required: true },
  { key: 'account.email', label: 'Email address', type: 'email', required: true },
  { key: 'account.phone', label: 'Phone number with country code', type: 'tel', required: true },
  { key: 'account.password', label: 'Password', type: 'password', required: true },
  { key: 'account.confirmPassword', label: 'Confirm password', type: 'password', required: true },
  { key: 'account.country', label: 'Country', type: 'select', required: true, options: ['Nigeria'] },
  { key: 'account.state', label: 'State', type: 'select', required: true, options: [...NIGERIA_STATES] },
  { key: 'account.city', label: 'City', type: 'select', required: true, options: [] },
  { key: 'account.referralCode', label: 'Referral code', type: 'text' },
  {
    key: 'account.hearAboutSpotlight',
    label: 'How did you hear about Spotlight?',
    type: 'select',
    options: ['Instagram', 'TikTok', 'YouTube', 'TV/Radio', 'Friend', 'School', 'Community', 'Other'],
    required: true,
  },
  {
    key: 'account.allowUpdates',
    label: 'I consent to receive application updates',
    type: 'checkbox',
    required: true,
  },
];

const contestSelectionFields: RegistrationField[] = [
  {
    key: 'contest.title',
    label: 'Contest title',
    type: 'text',
    required: true,
    readOnly: true,
    helpText: 'This contest is locked from the application route and cannot be changed here.',
  },
  { key: 'contest.entryMode', label: 'Individual or group entry', type: 'select', options: ['Individual', 'Group'], required: true },
  { key: 'contest.schoolEntry', label: 'School / institution entry', type: 'checkbox' },
];

const personalInformationFields: RegistrationField[] = [
  { key: 'personal.firstName', label: 'First name', type: 'text', required: true },
  { key: 'personal.middleName', label: 'Middle name', type: 'text' },
  { key: 'personal.lastName', label: 'Last name', type: 'text', required: true },
  { key: 'personal.stageName', label: 'Stage name / team name', type: 'text' },
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
  { key: 'identity.idType', label: 'Government-issued ID type', type: 'select', options: ['National ID', 'International passport', 'Voter card', 'Driver’s license', 'School ID', 'Birth certificate', 'Other approved ID'], required: true },
  { key: 'identity.idNumber', label: 'ID number', type: 'text' },
  { key: 'identity.idUpload', label: 'ID upload', type: 'file', required: true, accept: '.jpg,.jpeg,.png,.pdf' },
  { key: 'identity.passportPhoto', label: 'Passport photograph', type: 'file', required: true, accept: '.jpg,.jpeg,.png' },
  { key: 'identity.nameOnId', label: 'Name on ID', type: 'text', required: true },
  { key: 'identity.schoolId', label: 'School ID (student category)', type: 'file', accept: '.jpg,.jpeg,.png,.pdf' },
  { key: 'identity.cacDocument', label: 'CAC/business registration (SME category)', type: 'file', accept: '.jpg,.jpeg,.png,.pdf' },
];

const talentProfileFields: RegistrationField[] = [
  { key: 'talent.primarySkill', label: 'Primary talent / skill', type: 'multi_select', required: true, options: [...TALENT_SKILL_OPTIONS] },
  { key: 'talent.experienceYears', label: 'Years of experience', type: 'number', required: true },
  { key: 'talent.skillLevel', label: 'Skill level', type: 'select', options: ['Beginner', 'Emerging', 'Intermediate', 'Advanced', 'Professional', 'Self-taught', 'Student', 'Freelancer', 'Entrepreneur'], required: true },
  { key: 'talent.previousCompetitions', label: 'Previous competitions', type: 'textarea' },
  { key: 'talent.awards', label: 'Awards or recognitions', type: 'textarea' },
  { key: 'talent.publicPerformanceExperience', label: 'Public performance experience', type: 'textarea' },
  { key: 'talent.strengths', label: 'Strengths', type: 'textarea', required: true },
  { key: 'talent.careerGoal', label: 'Career goal', type: 'textarea', required: true },
  { key: 'talent.uniqueStory', label: 'What makes your story unique?', type: 'textarea', required: true },
];

const categorySpecificFields: Record<string, RegistrationField[]> = {
  music: [
    { key: 'category.musicRole', label: 'Music role', type: 'select', options: ['Singer', 'Rapper', 'Songwriter', 'Music producer', 'Instrumentalist', 'DJ', 'Performer', 'Dancer', 'Vocalist', 'Backup singer', 'Band/group', 'Other'], required: true },
    { key: 'category.genre', label: 'Genre', type: 'text', required: true },
    { key: 'category.vocalRange', label: 'Vocal range', type: 'text' },
    { key: 'category.instruments', label: 'Instruments played', type: 'text' },
    { key: 'category.audioUpload', label: 'Upload audition audio', type: 'file', accept: '.mp3,.wav,.m4a' },
    { key: 'category.performanceVideo', label: 'Upload performance video', type: 'file', accept: '.mp4,.mov' },
    { key: 'category.ownsRights', label: 'I own rights to uploaded music', type: 'checkbox', required: true },
  ],
  acting: [
    { key: 'category.actingExperience', label: 'Acting experience', type: 'textarea', required: true },
    { key: 'category.preferredGenre', label: 'Preferred acting genre', type: 'text', required: true },
    { key: 'category.languages', label: 'Languages you can act in', type: 'text' },
    { key: 'category.monologueUpload', label: 'Monologue upload', type: 'file', accept: '.mp4,.mov' },
    { key: 'category.actingReelLink', label: 'Acting reel link', type: 'url' },
    { key: 'category.comfortImprovisation', label: 'Comfortable with improvisation?', type: 'checkbox' },
  ],
  comedy_content: [
    { key: 'category.creatorType', label: 'Creator type', type: 'select', options: ['Skit maker', 'Stand-up comedian', 'Digital storyteller', 'Influencer', 'Vlogger', 'Presenter', 'Podcast host', 'Social media actor', 'Lifestyle creator', 'Other'], required: true },
    { key: 'category.mainPlatform', label: 'Main platform', type: 'text', required: true },
    { key: 'category.followerCount', label: 'Follower count', type: 'number' },
    { key: 'category.uploadBestContent', label: 'Upload best skit/video', type: 'file', accept: '.mp4,.mov', required: true },
    { key: 'category.brandSafeContent', label: 'Comfortable creating sponsored content?', type: 'checkbox' },
  ],
  dance: [
    { key: 'category.danceStyle', label: 'Dance style', type: 'select', options: ['Afro dance', 'Hip-hop', 'Contemporary', 'Traditional', 'Ballet', 'Street dance', 'Cultural dance', 'Freestyle', 'Dancehall', 'Other'], required: true },
    { key: 'category.soloOrGroup', label: 'Solo or group', type: 'select', options: ['Solo', 'Group'], required: true },
    { key: 'category.performanceVideo', label: 'Performance video upload', type: 'file', accept: '.mp4,.mov', required: true },
    { key: 'category.physicalLimitations', label: 'Any physical limitations?', type: 'textarea' },
  ],
  film_production: [
    { key: 'category.filmRole', label: 'Area of film interest', type: 'select', options: ['Screenwriter', 'Director', 'Cinematographer', 'Editor', 'Sound recordist', 'Production designer', 'Makeup artist', 'Costume designer', 'Script supervisor', 'Producer', 'Lighting assistant', 'Camera assistant', 'Production assistant', 'Other'], required: true },
    { key: 'category.productionExperience', label: 'Previous production experience', type: 'textarea' },
    { key: 'category.portfolioLink', label: 'Portfolio link', type: 'url' },
    { key: 'category.sampleUpload', label: 'Upload sample work', type: 'file', accept: '.mp4,.mov,.pdf' },
    { key: 'category.longHoursConsent', label: 'Comfortable working long production hours?', type: 'checkbox' },
  ],
  stem_innovation: [
    { key: 'category.innovationCategory', label: 'Innovation category', type: 'select', options: ['AI', 'Robotics', 'Renewable energy', 'Agritech', 'Healthtech', 'Fintech', 'Edtech', 'Climate innovation', 'Hardware', 'Software', 'Engineering', 'Science research', 'Social innovation', 'Other'], required: true },
    { key: 'category.projectTitle', label: 'Project title', type: 'text', required: true },
    { key: 'category.problemStatement', label: 'Problem being solved', type: 'textarea', required: true },
    { key: 'category.currentStage', label: 'Current stage', type: 'select', options: ['Idea', 'Research', 'Prototype', 'MVP', 'Pilot', 'Revenue-generating', 'Scaling'], required: true },
    { key: 'category.pitchDeckUpload', label: 'Upload pitch deck', type: 'file', accept: '.pdf,.ppt,.pptx' },
    { key: 'category.prototypeVideo', label: 'Upload prototype video', type: 'file', accept: '.mp4,.mov' },
    { key: 'category.openToInvestorReview', label: 'Open to investor review?', type: 'checkbox' },
  ],
  sme_pitch: [
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
    { key: 'category.businessStage', label: 'Business stage', type: 'select', options: ['Idea stage', 'Startup', 'Early revenue', 'Growing business', 'Community business', 'Student business', 'Women-led business', 'Creative business', 'Social enterprise'], required: true },
    { key: 'category.productDescription', label: 'Product/service description', type: 'textarea', required: true },
    { key: 'category.revenueModel', label: 'Revenue model', type: 'textarea', required: true },
    { key: 'category.pitchDeck', label: 'Pitch deck upload', type: 'file', accept: '.pdf,.ppt,.pptx' },
    { key: 'category.cacDocument', label: 'CAC document upload', type: 'file', accept: '.pdf,.jpg,.png' },
  ],
  school_campus: [
    { key: 'category.schoolName', label: 'School name', type: 'text', required: true },
    { key: 'category.schoolType', label: 'School type', type: 'select', options: ['Primary school', 'Secondary school', 'University', 'Polytechnic', 'College of education', 'Vocational institute', 'Technical college', 'Other'], required: true },
    { key: 'category.schoolAddress', label: 'School address', type: 'textarea', required: true },
    { key: 'category.studentCategory', label: 'Student category', type: 'text', required: true },
    { key: 'category.teamMembers', label: 'Team members', type: 'textarea' },
    { key: 'category.schoolApprovalLetter', label: 'School approval letter upload', type: 'file', accept: '.pdf,.jpg,.png' },
  ],
  open_mic: [
    { key: 'category.performanceType', label: 'Performance type', type: 'select', options: ['Singing', 'Rap', 'Spoken Word', 'Comedy', 'Instrumental', 'Other'], required: true },
    { key: 'category.genre', label: 'Genre/style', type: 'text', required: true },
    { key: 'category.sampleLink', label: 'Performance sample link', type: 'url' },
  ],
  general_reality_show: [
    { key: 'category.housemateReadiness', label: 'Comfortable living with other contestants?', type: 'checkbox', required: true },
    { key: 'category.dailyFilmingConsent', label: 'Comfortable being filmed daily?', type: 'checkbox', required: true },
    { key: 'category.uniqueStory', label: 'What makes your story compelling for TV?', type: 'textarea', required: true },
  ],
  other: [
    { key: 'category.additionalNotes', label: 'Tell us about your category fit', type: 'textarea', required: true },
  ],
};

const mediaFields: RegistrationField[] = [
  { key: 'media.profilePhoto', label: 'Profile photo', type: 'file', required: true, accept: '.jpg,.jpeg,.png,.webp' },
  { key: 'media.performanceVideo', label: 'Performance video', type: 'file', accept: '.mp4,.mov' },
  { key: 'media.audioFile', label: 'Audio file', type: 'file', accept: '.mp3,.wav,.m4a' },
  { key: 'media.pitchDeck', label: 'Pitch deck', type: 'file', accept: '.pdf,.ppt,.pptx' },
  { key: 'media.businessDocument', label: 'Business document', type: 'file', accept: '.pdf,.doc,.docx' },
  { key: 'media.rightsConfirmed', label: 'I confirm I have rights to uploaded materials', type: 'checkbox', required: true },
];

const socialFields: RegistrationField[] = [
  { key: 'social.instagram', label: 'Instagram handle', type: 'text' },
  { key: 'social.tiktok', label: 'TikTok handle', type: 'text' },
  { key: 'social.youtube', label: 'YouTube channel', type: 'text' },
  { key: 'social.facebook', label: 'Facebook page', type: 'text' },
  { key: 'social.x', label: 'X/Twitter handle', type: 'text' },
  { key: 'social.website', label: 'Website/portfolio', type: 'url' },
  { key: 'social.totalFollowers', label: 'Total estimated followers', type: 'number' },
  { key: 'social.strongestPlatform', label: 'Strongest platform', type: 'text' },
  { key: 'social.willingToPromote', label: 'Willing to promote contest profile?', type: 'checkbox' },
  { key: 'social.willingToInviteVoting', label: 'Willing to invite fans to vote?', type: 'checkbox' },
];

const bootcampFields: RegistrationField[] = [
  { key: 'bootcamp.availableFullPeriod', label: 'Available for full bootcamp period?', type: 'select', options: ['Fully available', 'Available with notice', 'Partially available', 'Not available'], required: true },
  { key: 'bootcamp.canTravel', label: 'Can travel to bootcamp location?', type: 'checkbox', required: true },
  { key: 'bootcamp.travelRestrictions', label: 'Any travel restrictions?', type: 'textarea' },
  { key: 'bootcamp.comfortLivingWithContestants', label: 'Comfortable living with other contestants?', type: 'checkbox' },
  { key: 'bootcamp.comfortDailyFilming', label: 'Comfortable being filmed daily?', type: 'checkbox' },
  { key: 'bootcamp.comfortPublicVoting', label: 'Comfortable with public voting and possible eviction?', type: 'checkbox' },
  { key: 'bootcamp.personalConsiderations', label: 'Religious, cultural, dietary, or personal considerations', type: 'textarea' },
];

const medicalFields: RegistrationField[] = [
  { key: 'medical.generalHealthStatus', label: 'General health status', type: 'textarea', required: true },
  { key: 'medical.knownConditions', label: 'Known medical conditions', type: 'multi_select', options: [...MEDICAL_CONDITION_OPTIONS] },
  { key: 'medical.allergies', label: 'Allergies', type: 'multi_select', options: [...ALLERGY_OPTIONS] },
  { key: 'medical.currentMedication', label: 'Medication currently used', type: 'textarea' },
  { key: 'medical.dietaryRestrictions', label: 'Dietary restrictions', type: 'textarea' },
  { key: 'medical.physicalLimitations', label: 'Physical limitations', type: 'textarea' },
  { key: 'medical.mentalConsiderations', label: 'Mental/emotional health considerations', type: 'textarea' },
  { key: 'medical.specialAccommodation', label: 'Require special accommodation?', type: 'textarea' },
  { key: 'medical.emergencyTreatmentConsent', label: 'I consent to emergency medical support where necessary', type: 'checkbox', required: true },
];

const emergencyFields: RegistrationField[] = [
  { key: 'emergency.fullName', label: 'Emergency contact full name', type: 'text', required: true },
  { key: 'emergency.relationship', label: 'Relationship', type: 'select', required: true, options: ['Parent', 'Sibling', 'Spouse', 'Guardian', 'Relative', 'Friend', 'Teacher/Mentor', 'Other'] },
  { key: 'emergency.phone', label: 'Phone number', type: 'tel', required: true },
  { key: 'emergency.altPhone', label: 'Alternative phone number', type: 'tel' },
  { key: 'emergency.email', label: 'Email', type: 'email' },
  { key: 'emergency.address', label: 'Residential address', type: 'textarea' },
  { key: 'emergency.country', label: 'Country', type: 'select', required: true, options: ['Nigeria'] },
  { key: 'emergency.state', label: 'State', type: 'select', required: true, options: [...NIGERIA_STATES] },
  { key: 'emergency.city', label: 'City', type: 'select', required: true, options: [] },
  { key: 'emergency.confirmParticipation', label: 'Can this person confirm your participation?', type: 'checkbox' },
];

const complianceFields: RegistrationField[] = [
  { key: 'compliance.previouslyInRealityShow', label: 'Previously participated in a reality show?', type: 'checkbox' },
  { key: 'compliance.exclusiveContract', label: 'Currently under exclusive talent contract?', type: 'checkbox' },
  { key: 'compliance.agencyContract', label: 'Signed to agency/label/manager?', type: 'checkbox' },
  { key: 'compliance.legalRestriction', label: 'Any legal restriction preventing participation?', type: 'checkbox' },
  { key: 'compliance.disqualifiedBefore', label: 'Ever disqualified from a contest?', type: 'checkbox' },
  { key: 'compliance.platformBan', label: 'Ever banned from a public platform for serious misconduct?', type: 'checkbox' },
  { key: 'compliance.codeOfConductAgreement', label: 'I agree to Spotlight code of conduct', type: 'checkbox', required: true },
  { key: 'compliance.backgroundCheckAgreement', label: 'I agree to additional background checks if selected', type: 'checkbox', required: true },
  { key: 'compliance.truthDeclaration', label: 'I confirm submitted information is true', type: 'checkbox', required: true },
];

const paymentFields: RegistrationField[] = [
  { key: 'payment.feeAmount', label: 'Registration fee amount', type: 'number', required: true, readOnly: true, helpText: 'This amount is configured by admin and cannot be edited.' },
  { key: 'payment.method', label: 'Payment method', type: 'select', options: ['Card', 'Bank Transfer', 'USSD', 'Wallet', 'Waiver'], required: true },
  { key: 'payment.transactionReference', label: 'Transaction reference', type: 'text' },
];

const auditionFields: RegistrationField[] = [
  { key: 'audition.format', label: 'Preferred audition format', type: 'select', options: ['Online video submission', 'Live virtual audition', 'Physical audition', 'Campus audition', 'Regional audition', 'Invite-only audition', 'Callback audition'], required: true },
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
  { key: 'legal.sponsorActivationConsent', label: 'I understand programme activities may involve sponsors and partners', type: 'checkbox', required: true },
  { key: 'legal.productionRulesConsent', label: 'I agree to production, safety, and code-of-conduct rules', type: 'checkbox', required: true },
  { key: 'legal.disqualificationAcknowledgment', label: 'I understand misconduct/fraud may lead to disqualification', type: 'checkbox', required: true },
  { key: 'legal.ageGuardianConfirmation', label: 'I meet age requirements or have valid guardian consent', type: 'checkbox', required: true },
  { key: 'legal.communicationConsent', label: 'I agree to receive updates via email/SMS/WhatsApp/in-app notifications', type: 'checkbox', required: true },
];

const reviewFields: RegistrationField[] = [
  { key: 'review.confirmSubmit', label: 'I have reviewed my application and I am ready to submit', type: 'checkbox', required: true },
];

const baseSteps: RegistrationStep[] = [
  { key: 'account_gate', title: 'Account Login / Registration', description: 'Create account or login before applying.', fields: accountGateFields },
  { key: 'contest_selection', title: 'Contest Selection', description: 'Select active contest and applicant route.', fields: contestSelectionFields },
  { key: 'personal_information', title: 'Profile Information', description: 'Provide core identity and talent details.', fields: [] },
  { key: 'category_specific', title: 'Contest Requirements', description: 'Complete requirements that apply to your selected contest.', fields: [] },
  { key: 'review_submit', title: 'Consent and Submit', description: 'Confirm legal declarations and submit your application.', fields: [] },
];

export function resolveContestRegistration(slug: string) {
  return contestRegistrationCatalog.find((item) => item.slug === slug) || null;
}

export function resolveCategorySpecificFields(categoryKey: string): RegistrationField[] {
  return categorySpecificFields[categoryKey] || categorySpecificFields.other;
}

export function buildRegistrationSteps(draft: RegistrationDraft): RegistrationStep[] {
  const categoryKey = String(draft.formData['contest.categoryKey'] || 'other');
  const contestCategory = String(draft.formData['contest.category'] || categoryKey || 'other');
  const isStemContest = contestCategory === 'stem_innovation';
  const isSmeContest = contestCategory === 'sme_pitch';
  const isUnderAge =
    Number(draft.formData['derived.age'] || 0) > 0 &&
    Number(draft.formData['derived.age'] || 0) < Number(draft.formData['derived.legalAdultAge'] || 18);
  const requiresMedical = Boolean(draft.formData['derived.requiresMedical']);
  const requiresBootcamp = Boolean(draft.formData['derived.requiresBootcampReadiness']);
  const isPaidContest = Boolean(draft.formData['derived.isPaidContest']);
  const supportsAudition = Boolean(draft.formData['derived.supportsAuditionScheduling']);
  const supportsVoting = Boolean(draft.formData['derived.supportsVoting']);

  const filteredIdentityFields = identityFields.filter((field) => {
    if (field.key === 'identity.schoolId') return isStemContest;
    if (field.key === 'identity.cacDocument') return isSmeContest;
    return true;
  });

  const filteredMediaFields = mediaFields.filter((field) => {
    if (field.key === 'media.audioFile') return contestCategory === 'music' || contestCategory === 'open_mic';
    if (field.key === 'media.pitchDeck' || field.key === 'media.businessDocument') return isSmeContest || isStemContest;
    return true;
  });

  const personalStepFields = [
    ...personalInformationFields,
    ...talentProfileFields,
    ...(isUnderAge ? guardianConsentFields : []),
  ];

  const contestRequirementFields = [
    ...filteredIdentityFields,
    ...filteredMediaFields,
    ...resolveCategorySpecificFields(categoryKey),
    ...socialFields,
    ...complianceFields,
    ...(requiresBootcamp ? [...bootcampFields, ...medicalFields, ...emergencyFields] : []),
    ...(!requiresBootcamp && requiresMedical ? [...medicalFields, ...emergencyFields] : []),
    ...(isPaidContest ? paymentFields : []),
    ...(supportsAudition ? auditionFields : []),
    ...(supportsVoting ? publicProfileFields : []),
  ];

  const finalStepFields = [...legalFields, ...reviewFields];

  return baseSteps.map((step) => {
    if (step.key === 'personal_information') {
      return { ...step, fields: personalStepFields };
    }
    if (step.key === 'category_specific') {
      return { ...step, fields: contestRequirementFields };
    }
    if (step.key === 'review_submit') {
      return { ...step, fields: finalStepFields };
    }
    return step;
  });
}

export function getStepIndex(steps: RegistrationStep[], stepKey?: RegistrationStepKey) {
  if (!stepKey) return 0;
  const legacyStepMap: Partial<Record<RegistrationStepKey, RegistrationStepKey>> = {
    guardian_consent: 'personal_information',
    identity_verification: 'category_specific',
    bootcamp_housemate_readiness: 'category_specific',
    medical_welfare_safety: 'category_specific',
    character_compliance: 'category_specific',
    payment: 'category_specific',
    audition_scheduling: 'category_specific',
    public_profile_setup: 'category_specific',
    legal_consents: 'review_submit',
  };
  const normalizedStepKey = legacyStepMap[stepKey] || stepKey;
  const index = steps.findIndex((step) => step.key === normalizedStepKey);
  return index < 0 ? 0 : index;
}
