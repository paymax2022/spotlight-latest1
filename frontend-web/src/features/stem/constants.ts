import type { StemFieldType, StemTrackRules } from './types';

export const stemDefaultTrackRules: StemTrackRules = {
  schoolsMustRegisterFirst: true,
  schoolVerificationRequiredBeforeStudentApply: true,
  studentNeedsSchoolApproval: true,
  studentNeedsTeacherValidation: false,
  studentCanApplyIndividually: true,
  studentCanApplyAsTeam: true,
  independentInnovatorsCanApply: true,
  innovatorNeedsIdVerification: true,
  innovatorCanApplyAsTeam: true,
  applicantsCanEnterMultipleContests: false,
  oneApplicantCanSubmitMultipleProjects: false,
  oneStudentCanJoinMultipleTeams: false,
  publicVotingEnabled: false,
  judgesDetermineWinners: true,
  publicVotesDetermineFinalistsOnly: false,
  adminOverrideAllowed: true,
};

export const stemDefaultScoringCriteria = [
  { key: 'problem_relevance', label: 'Problem relevance', weight: 15 },
  { key: 'innovation_creativity', label: 'Innovation and creativity', weight: 15 },
  { key: 'technical_feasibility', label: 'Technical feasibility', weight: 15 },
  { key: 'prototype_evidence', label: 'Prototype/project evidence', weight: 15 },
  { key: 'impact_potential', label: 'Impact potential', weight: 15 },
  { key: 'presentation_clarity', label: 'Presentation clarity', weight: 10 },
  { key: 'scalability', label: 'Scalability', weight: 10 },
  { key: 'team_readiness', label: 'Team capability/readiness', weight: 5 },
];

export const stemDefaultProjectFields: Array<{
  key: string;
  label: string;
  type: StemFieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  helpText?: string;
}> = [
  { key: 'project.title', label: 'Project title', type: 'text', required: true },
  { key: 'project.oneLineSummary', label: 'One-line summary', type: 'text', required: true },
  { key: 'project.description', label: 'Full project description', type: 'textarea', required: true },
  { key: 'project.problemStatement', label: 'Problem statement', type: 'textarea', required: true },
  { key: 'project.proposedSolution', label: 'Proposed solution', type: 'textarea', required: true },
  { key: 'project.targetUsers', label: 'Target users/beneficiaries', type: 'textarea', required: true },
  { key: 'project.technologyUsed', label: 'Technology/method used', type: 'textarea', required: true },
  {
    key: 'project.stage',
    label: 'Project stage',
    type: 'select',
    required: true,
    options: ['idea', 'research', 'concept_design', 'prototype', 'working_model', 'mvp', 'pilot_tested', 'already_in_use', 'revenue_generating', 'scaling'],
  },
  { key: 'project.prototypeAvailable', label: 'Prototype available?', type: 'checkbox' },
  { key: 'project.demoAvailable', label: 'Demo available?', type: 'checkbox' },
  { key: 'project.estimatedCost', label: 'Estimated project cost', type: 'number' },
  { key: 'project.fundingRequired', label: 'Funding required', type: 'number' },
  { key: 'project.ipStatus', label: 'Intellectual property status', type: 'text' },
  { key: 'project.publicSummary', label: 'Public summary', type: 'textarea', required: true },
];

export const stemDefaultUploads = [
  'project_image',
  'demo_video',
  'pitch_video',
  'pitch_deck',
  'technical_document',
  'prototype_photo',
  'source_code_link',
];

export const stemDefaultSafetyQuestions = [
  'Does your project involve electricity or high voltage?',
  'Does it involve chemicals?',
  'Does it involve fire, heat, or pressure?',
  'Does it involve drones or moving machines?',
  'Does it involve medical or health claims?',
  'Does it involve human testing?',
  'Does it collect personal data?',
  'Does it pose any public safety risk?',
];
