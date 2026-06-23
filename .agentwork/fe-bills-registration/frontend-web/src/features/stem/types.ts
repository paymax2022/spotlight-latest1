export type StemContestStatus =
  | 'draft'
  | 'scheduled'
  | 'published'
  | 'open_for_registration'
  | 'registration_closed'
  | 'under_review'
  | 'shortlisting'
  | 'voting_live'
  | 'demo_day_scheduled'
  | 'bootcamp_stage'
  | 'finalist_stage'
  | 'completed'
  | 'archived'
  | 'suspended'
  | 'cancelled';

export type StemContestVisibility =
  | 'public'
  | 'private_invite_only'
  | 'school_only'
  | 'state_only'
  | 'sponsor_only'
  | 'regional_only'
  | 'internal_test'
  | 'hidden';

export type StemParticipationTrack =
  | 'school_student'
  | 'independent_innovator'
  | 'mixed'
  | 'team_only'
  | 'individual_only'
  | 'school_vs_school'
  | 'campus'
  | 'regional'
  | 'national'
  | 'sponsor_specific'
  | 'public_voting'
  | 'judge_only'
  | 'hybrid_judge_public';

export type StemApplicantType =
  | 'school_admin'
  | 'student'
  | 'independent_innovator'
  | 'team_lead';

export type StemApplicationStatus =
  | 'draft'
  | 'awaiting_school_approval'
  | 'awaiting_guardian_consent'
  | 'awaiting_payment'
  | 'payment_failed'
  | 'submitted'
  | 'identity_verification_pending'
  | 'under_review'
  | 'more_information_requested'
  | 'shortlisted'
  | 'approved'
  | 'rejected'
  | 'waitlisted'
  | 'selected_for_showcase'
  | 'selected_for_bootcamp'
  | 'selected_for_finals'
  | 'public_profile_live'
  | 'voting_live'
  | 'eliminated'
  | 'winner'
  | 'disqualified'
  | 'withdrawn';

export type StemSchoolStatus =
  | 'draft'
  | 'submitted'
  | 'under_verification'
  | 'more_information_required'
  | 'verified'
  | 'rejected'
  | 'suspended'
  | 'archived';

export type StemProjectStage =
  | 'idea'
  | 'research'
  | 'concept_design'
  | 'prototype'
  | 'working_model'
  | 'mvp'
  | 'pilot_tested'
  | 'already_in_use'
  | 'revenue_generating'
  | 'scaling';

export type StemFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'email'
  | 'phone'
  | 'date'
  | 'checkbox'
  | 'select'
  | 'multi_select'
  | 'file'
  | 'url';

export type StemFormField = {
  key: string;
  label: string;
  type: StemFieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  helpText?: string;
  accept?: string;
  adminConfigurable?: boolean;
};

export type StemTrackRules = {
  schoolsMustRegisterFirst: boolean;
  schoolVerificationRequiredBeforeStudentApply: boolean;
  studentNeedsSchoolApproval: boolean;
  studentNeedsTeacherValidation: boolean;
  studentCanApplyIndividually: boolean;
  studentCanApplyAsTeam: boolean;
  independentInnovatorsCanApply: boolean;
  innovatorNeedsIdVerification: boolean;
  innovatorCanApplyAsTeam: boolean;
  applicantsCanEnterMultipleContests: boolean;
  oneApplicantCanSubmitMultipleProjects: boolean;
  oneStudentCanJoinMultipleTeams: boolean;
  publicVotingEnabled: boolean;
  judgesDetermineWinners: boolean;
  publicVotesDetermineFinalistsOnly: boolean;
  adminOverrideAllowed: boolean;
};

export type StemContestCategory = {
  id: string;
  contestId: string;
  name: string;
  description?: string;
  icon?: string;
  banner?: string;
  eligibleTracks: StemParticipationTrack[];
  eligibleAgeRange?: { min?: number; max?: number };
  eligibleSchoolLevels?: string[];
  eligibleProjectStages?: StemProjectStage[];
  requiredUploads: string[];
  requiredQuestions: StemFormField[];
  judgingCriteria: Array<{ key: string; label: string; weight: number }>;
  scoreWeightPercent?: number;
  sponsorAssigned?: string;
  prizeAssigned?: string;
  registrationFeeCategoryId?: string;
  votingFeeCategoryId?: string;
  maxApplicants?: number;
  maxFinalists?: number;
  publicProfileVisible: boolean;
  safetyRequirements?: string;
  rules?: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
};

export type StemPriceCategory = {
  id: string;
  contestId: string;
  name: string;
  description?: string;
  appliesToTracks: StemParticipationTrack[];
  appliesToApplicantTypes: StemApplicantType[];
  appliesToSchoolTypes: string[];
  appliesToCategoryIds: string[];
  appliesToStates: string[];
  currency: string;
  amount: number;
  earlyBirdAmount?: number;
  lateFeeAmount?: number;
  startDate?: string;
  endDate?: string;
  paymentRequiredBeforeSubmission: boolean;
  paymentRequiredAfterShortlisting: boolean;
  paymentRequiredBeforeDemoDay: boolean;
  refundPolicy?: string;
  discountCodeEnabled: boolean;
  waiverCodeEnabled: boolean;
  sponsorCodeEnabled: boolean;
  maxApplicants?: number;
  visiblePublicly: boolean;
  adminOnly: boolean;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
};

export type StemPrizeCategory = {
  id: string;
  contestId: string;
  title: string;
  description?: string;
  prizeType: string;
  prizeValue?: string;
  cashPrizeAmount?: number;
  nonCashPrizeDescription?: string;
  sponsor?: string;
  eligibleCategoryIds: string[];
  eligibleTracks: StemParticipationTrack[];
  numberOfWinners: number;
  selectionCriteria?: string;
  publiclyVisible: boolean;
  terms?: string;
  disbursementCondition?: string;
  verificationRequiredBeforeAward: boolean;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
};

export type StemContest = {
  id: string;
  slug: string;
  title: string;
  season: string;
  subtitle?: string;
  description: string;
  objective?: string;
  bannerImage?: string;
  logo?: string;
  sponsorLogo?: string;
  organizer?: string;
  partnerSponsor?: string;
  supportContact?: string;
  faq?: string;
  termsAndConditions?: string;
  privacyNote?: string;
  status: StemContestStatus;
  visibility: StemContestVisibility;
  tracksAllowed: StemParticipationTrack[];
  trackRules: StemTrackRules;
  applicantAgeMin?: number;
  applicantAgeMax?: number;
  schoolTypeEligibility: string[];
  innovatorEligibility: string[];
  stateEligibility: string[];
  requiredDocuments: string[];
  requiredMediaUploads: string[];
  requiredProjectFields: StemFormField[];
  teamSizeMin?: number;
  teamSizeMax?: number;
  judgingCriteriaDefault: Array<{ key: string; label: string; weight: number }>;
  votingEnabled: boolean;
  votingFeePerVote?: number;
  votingStartDate?: string;
  votingEndDate?: string;
  registrationOpenDate?: string;
  registrationCloseDate?: string;
  demoDayEnabled: boolean;
  demoLocations: string[];
  sponsorBackedCategories: string[];
  freeEntryEnabled: boolean;
  paidEntryEnabled: boolean;
  couponEnabled: boolean;
  waiverEnabled: boolean;
  schoolBulkRegistrationEnabled: boolean;
  publicProfileEnabled: boolean;
  finalistSelectionProcess?: string;
  winnerSelectionRules?: string;
  reportingRequirements?: string;
  categories: StemContestCategory[];
  priceCategories: StemPriceCategory[];
  prizeCategories: StemPrizeCategory[];
  createdBy?: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type StemSchool = {
  id: string;
  schoolName: string;
  schoolType: string;
  ownershipType?: string;
  schoolCategory?: string;
  registrationNumber?: string;
  yearEstablished?: number;
  officialEmail?: string;
  officialPhone?: string;
  website?: string;
  address?: string;
  country?: string;
  state?: string;
  lga?: string;
  city?: string;
  nearestLandmark?: string;
  schoolLogo?: string;
  campusPhoto?: string;
  schoolDescription?: string;
  adminContact: {
    fullName: string;
    designation?: string;
    email: string;
    phone: string;
    whatsapp?: string;
    preferredContactMethod?: string;
  };
  verificationDocuments: string[];
  status: StemSchoolStatus;
  reviewedBy?: string;
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
};

export type StemSchoolJoinRequest = {
  id: string;
  schoolId: string;
  studentUserId?: string;
  fullName: string;
  email?: string;
  phone?: string;
  studentId?: string;
  classLevel?: string;
  department?: string;
  studentIdUpload?: string;
  admissionLetterUpload?: string;
  mentorName?: string;
  note?: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
};

export type StemApplication = {
  id: string;
  reference: string;
  contestId: string;
  contestSlug: string;
  track: StemParticipationTrack;
  applicantType: StemApplicantType;
  status: StemApplicationStatus;
  schoolId?: string;
  schoolJoinRequestId?: string;
  applicantUserId?: string;
  applicantEmail?: string;
  applicantPhone?: string;
  applicantName?: string;
  categoryId?: string;
  priceCategoryId?: string;
  paymentStatus: 'not_required' | 'pending' | 'paid' | 'failed' | 'waived';
  completionPercent: number;
  formData: Record<string, unknown>;
  projectData: Record<string, unknown>;
  uploadData: Record<string, unknown>;
  fraudFlags: string[];
  safetyFlags: string[];
  submittedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type StemStatusEvent = {
  id: string;
  applicationId: string;
  oldStatus?: StemApplicationStatus;
  newStatus: StemApplicationStatus;
  actorRole: 'applicant' | 'school_admin' | 'admin' | 'system';
  note?: string;
  createdAt: string;
};

export type StemApplicationFilter = {
  contestId?: string;
  contestSlug?: string;
  applicantUserId?: string;
  status?: StemApplicationStatus;
  applicantType?: StemApplicantType;
  track?: StemParticipationTrack;
  schoolId?: string;
  paymentStatus?: StemApplication['paymentStatus'];
  state?: string;
  query?: string;
};

export type StemAdminApplicationReviewInput = {
  status: StemApplicationStatus;
  note?: string;
  score?: number;
  fraudFlags?: string[];
  safetyFlags?: string[];
};

export type StemStartApplicationInput = {
  contestSlug: string;
  track: StemParticipationTrack;
  applicantType: StemApplicantType;
  schoolId?: string;
  schoolJoinRequestId?: string;
  applicantUserId?: string;
  applicantName?: string;
  applicantEmail?: string;
  applicantPhone?: string;
};
