export type Analytics = {
  sessionsTotal: number;
  messagesTotal: number;
  leadsTotal: number;
  byPage: Record<string, number>;
  byIntent: Record<string, number>;
  leadsByType: Record<string, number>;
};
export type HandoffRow = {
  id: string;
  session_id?: string;
  sessionId?: string;
  handoff_type?: string;
  destination?: string;
  status?: string;
  requested_at?: string;
  resolved_at?: string | null;
};
export type AuditFilters = {
  limit?: number;
  actorUser?: string;
  targetUser?: string;
  module?: string;
  action?: string;
  severity?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  email?: string;
};

export type GenericRow = Record<string, unknown>;
export type Lead = {
  id: string;
  sessionId: string;
  leadType: string;
  status: string;
  score: number;
  sourcePage: string;
  name: string;
  email: string;
  phone: string;
  notes: string;
  transcriptExcerpt: string;
  createdAt: string;
  updatedAt: string;
};
export type CompetitionOverview = {
  totalContests: number;
  realityTvContests: number;
  openMicContests: number;
  multiSkillContests: number;
};

export type OpenMicCompetition = {
  id: string;
  slug: string;
  name: string;
  status: string;
  start_date?: string | null;
  end_date?: string | null;
  is_featured?: boolean;
  created_at?: string | null;
};
export type RealityTVActiveSeason = {
  season_title: string;
  season_number: number;
  status: string;
} | null;

export type RealityTVDashboardMetrics = {
  totalSeasons: number;
  activeSeason: RealityTVActiveSeason;
  totalApplications: number;
  pendingApplications: number;
  totalContestants: number;
  activeVotingRounds: number;
  totalVotes: number;
  paidVotes: number;
  freeVotes: number;
  openTickets: number;
};
export type AdminUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  userType: string;
  status: string;
  profileCompleted: boolean;
  state: string;
  country: string;
  programId?: string;
  contestId?: string;
  schoolId?: string;
  createdAt: string;
};

export type AdminUserFilters = {
  role?: string;
  userType?: string;
  status?: string;
  state?: string;
  program?: string;
  search?: string;
  limit?: number;
};
export type Role = {
  id: string;
  name: string;
  slug: string;
  description?: string;
  roleType?: string;
  isSystemRole?: boolean;
  isActive?: boolean;
  createdAt?: string;
};

export type Permission = {
  id: string;
  name: string;
  slug: string;
  module?: string;
  resource?: string;
  action?: string;
  description?: string;
  isSystemPermission?: boolean;
};

export type PermissionMatrix = {
  permissionSlugs: string[];
  rows: Array<{
    roleId: string;
    roleName: string;
    roleSlug: string;
    permissions: Record<string, boolean>;
  }>;
};
export type ChatSession = {
  id: string;
  pageContext: string;
  status: string;
  startedAt: string;
};

export type ChatMessage = {
  id: string;
  role: string;
  message_text?: string;
  text?: string;
  intent?: string;
  confidence?: number;
  created_at?: string;
  createdAt?: string;
};

export type ChatEvent = {
  id?: string;
  event_name?: string;
  event?: string;
  event_payload?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  created_at?: string;
  createdAt?: string;
};

export type ChatSessionDetail = {
  session?: ChatSession | null;
  messages: ChatMessage[];
  events: ChatEvent[];
};
export type KycStatus = 'none' | 'pending' | 'submitted' | 'verified' | 'failed';

export interface KycProfile {
  user_id: string;
  kyc_tier: number;
  kyc_status: KycStatus;
  kyc_submitted_at: string | null;
  kyc_verified_at: string | null;
  phone_verified: boolean;
  document_type: string | null;
  requested_tier: number | null;
}

export interface WalletBalance {
  user_id: string;
  balance_kobo: number;
}

export interface LedgerEntry {
  id: string;
  account_id: string;
  type: 'CREDIT' | 'DEBIT' | 'REVERSAL_CREDIT' | 'REVERSAL_DEBIT';
  amount_kobo: number;
  reference: string;
  idempotency_key: string;
  created_at: string;
}

export interface TransactionsResponse {
  entries: LedgerEntry[];
  total: number;
}

export type DisputeStatus = 'open' | 'investigating' | 'resolved' | 'closed';
export type DisputeResolution = 'refund' | 'partial_refund' | 'no_action';

export interface Dispute {
  id: string;
  user_id: string;
  reference: string;
  module_type: string;
  type: string;
  description: string;
  status: DisputeStatus;
  resolution: DisputeResolution | null;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
}
// Merchant Onboarding admin types.
// Application JSON is camelCase, matching the backend admin endpoints.

export type OnboardingStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'NEEDS_MORE_INFO'
  | 'APPROVED'
  | 'REJECTED';

export type DocumentVerificationStatus =
  | 'pending'
  | 'verified'
  | 'rejected'
  | 'expired';

export type CheckStatus = 'pass' | 'fail' | 'pending' | 'manual';

export interface OnboardingDocument {
  type: string;
  label: string;
  fileName: string;
  expiryDate: string | null;
  verificationStatus: DocumentVerificationStatus;
}

export interface OnboardingCheck {
  key: string; // e.g. bvn, nin, credential
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface OnboardingApplication {
  id: string;
  userId: string;
  applicantName: string;
  merchantTypeId: string;
  merchantTypeName: string;
  moduleId: string;
  moduleName: string;
  formSchemaId: string;
  formSchemaVersion: string;
  status: OnboardingStatus;
  data: Record<string, unknown>;
  documents: OnboardingDocument[];
  checks: OnboardingCheck[];
  decisionReason: string | null;
  infoChecklist: string[];
  submittedAt: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Lighter row shape returned by the review queue list endpoint.
// Backend may return full applications; the queue page only relies on these fields.
export interface OnboardingQueueRow {
  id: string;
  applicantName: string;
  moduleId: string;
  moduleName: string;
  merchantTypeId: string;
  merchantTypeName: string;
  status: OnboardingStatus;
  riskLevel: 'low' | 'medium' | 'high' | null;
  submittedAt: string | null;
  createdAt: string;
}

export interface OnboardingQueueFilters {
  module?: string;
  type?: string;
  status?: string;
  age?: string; // e.g. '1d', '3d', '7d' age buckets
}
