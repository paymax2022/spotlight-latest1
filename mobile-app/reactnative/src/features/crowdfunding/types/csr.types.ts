// ── Crowdfunding — Corporate CSR (Section M) types ───────────────────────────
// Feature-flagged OFF until corporate partner onboarding (CSR_ENABLED).
// All monetary amounts are integers in minor units (kobo).

export interface CsrProfile {
  companyName: string;
  verified: boolean;
  annualBudgetKobo: number;
  committedKobo: number;
  matchedKobo: number;
  campaignsSupported: number;
  employeesGiving: number;
}

export type MatchRatio = '1:1' | '2:1' | '0.5:1';

export interface MatchableCampaign {
  id: string;
  title: string;
  category: string;
  coverImage: string | null;
  raisedKobo: number;
  goalKobo: number;
  contributorCount: number;
  verified: boolean;
  impactTag: string;            // 'Health' | 'Education' | 'Environment' ...
}

export type CsrMatchStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'ACTIVE' | 'COMPLETED' | 'PAUSED';

export interface CsrMatch {
  id: string;
  campaignId: string;
  campaignTitle: string;
  ratio: MatchRatio;
  capKobo: number;
  matchedKobo: number;
  status: CsrMatchStatus;
  startedAt: string;
  visibility: 'PUBLIC' | 'ANONYMOUS';
}

export interface MatchSetupInput {
  campaignId: string;
  ratio: MatchRatio;
  capKobo: number;
  visibility: 'PUBLIC' | 'ANONYMOUS';
  message: string;
}

export interface CsrInvoice {
  id: string;
  reference: string;
  description: string;
  amountKobo: number;
  vatKobo: number;
  totalKobo: number;
  status: 'PAID' | 'DUE';
  issuedAt: string;
}

export interface CsrImpactSummary {
  totalMatchedKobo: number;
  livesImpacted: number;
  campaignsSupported: number;
  topCategory: string;
  byCategory: { category: string; matchedKobo: number }[];
  monthly: { month: string; matchedKobo: number }[];
}

export interface EmployeeGivingCampaign {
  id: string;
  title: string;
  goalKobo: number;
  raisedKobo: number;
  participants: number;
  endsAt: string;
  companyMatchRatio: MatchRatio;
}
