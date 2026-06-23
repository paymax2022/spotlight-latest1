export type QuickLink = {
  label: string;
  href: string;
  desc: string;
  stemAccess?: 'read' | 'manage';
};

export const quickLinks: QuickLink[] = [
  { label: 'Analytics', href: '/admin/analytics', desc: 'Performance and trends overview' },
  { label: 'Competitions', href: '/admin/competitions', desc: 'Active contests and entry metrics' },
  { label: 'Chat Sessions', href: '/admin/chatbot', desc: 'Review assistant conversations' },
  { label: 'Leads Queue', href: '/admin/leads', desc: 'Manage applicant and sponsor leads' },
  { label: 'Handoff Queue', href: '/admin/handoffs', desc: 'Track callback and escalation requests' },
  { label: 'STEM Overview', href: '/admin/stem/overview', desc: 'School and emerging STEM program metrics', stemAccess: 'read' },
  { label: 'STEM Contests', href: '/admin/stem/contests', desc: 'Contest configuration and eligibility controls', stemAccess: 'manage' },
  { label: 'STEM Leaderboard', href: '/admin/stem/leaderboard', desc: 'Ranking board and score breakdowns', stemAccess: 'read' },
  { label: 'STEM Voting', href: '/admin/stem/voting', desc: 'Free/paid voting rules and package controls', stemAccess: 'manage' },
  { label: 'STEM Bootcamp', href: '/admin/stem/bootcamp', desc: 'Cohort planning and reality-show readiness operations', stemAccess: 'manage' },
  { label: 'STEM Reports', href: '/admin/stem/reports', desc: 'Participation, votes, sponsors, and awards summary', stemAccess: 'read' },
  { label: 'STEM Sponsors/Awards', href: '/admin/stem/sponsors-awards', desc: 'Sponsor, certificate, and badge operations', stemAccess: 'manage' },
  { label: 'STEM Submissions', href: '/admin/stem/submissions', desc: 'Submission queue and status workflow', stemAccess: 'read' },
  { label: 'STEM Judging', href: '/admin/stem/judging', desc: 'Judge scoring records and review actions', stemAccess: 'read' },
  { label: 'STEM Rubrics', href: '/admin/stem/rubrics', desc: 'Rubric templates and judge assignment controls', stemAccess: 'manage' },
  { label: 'Schools', href: '/admin/schools', desc: 'School channel onboarding and participation snapshot', stemAccess: 'read' },
  { label: 'School Profiles', href: '/admin/school-profiles', desc: 'School-linked admins, coaches, and students', stemAccess: 'read' },
  { label: 'School Teams', href: '/admin/school-teams', desc: 'Track school team setup and project readiness', stemAccess: 'read' },
  { label: 'Emerging Innovators', href: '/admin/emerging-innovators', desc: 'Independent innovator channel snapshot', stemAccess: 'read' },
  { label: 'Emerging Teams', href: '/admin/emerging-teams', desc: 'Team entities under emerging innovator channel', stemAccess: 'read' },
  { label: 'Emerging Projects', href: '/admin/emerging-projects', desc: 'Project entities under emerging innovator channel', stemAccess: 'read' },
  { label: 'Reality TV', href: '/admin/reality-tv/dashboard', desc: 'Legacy bridge while migrating Reality TV module' },
  { label: 'Film Academy', href: '/admin/film-academy', desc: 'Legacy bridge while migrating Film Academy module' },
  { label: 'Users & Services', href: '/admin/users-services', desc: 'Legacy bridge for user/service admin tools' },
];
