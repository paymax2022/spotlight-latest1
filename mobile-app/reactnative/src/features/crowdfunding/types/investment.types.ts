// ── Crowdfunding — Investment (Section L) types ──────────────────────────────
// Regulated module: feature-flagged OFF until licensed (INVESTMENT_ENABLED).
// All monetary amounts are integers in minor units (kobo).

export type InvestmentModel = 'EQUITY' | 'DEBT' | 'REVENUE_SHARE';

export type InvestorRiskProfile = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';

export type OfferStatus = 'OPEN' | 'CLOSING_SOON' | 'CLOSED' | 'FUNDED';

export interface InvestmentOffer {
  id: string;
  title: string;
  issuerName: string;
  issuerVerified: boolean;
  model: InvestmentModel;
  summary: string;
  coverImage: string | null;
  targetKobo: number;
  raisedKobo: number;
  minTicketKobo: number;
  investorCount: number;
  status: OfferStatus;
  closesAt: string;
  // Terms
  projectedReturnPct: number;      // indicative, not guaranteed
  termMonths: number;
  riskLevel: 'MEDIUM' | 'HIGH';
  lockInMonths: number;
  coolingOffDays: number;
  sector: string;
  location: string;
  offerDocumentLabel: string;      // e.g. 'Offer memorandum (PDF)'
  riskWarnings: string[];
  useOfProceeds: { label: string; amountKobo: number }[];
}

export interface InvestorProfile {
  onboarded: boolean;
  kycComplete: boolean;
  educationComplete: boolean;
  quizPassed: boolean;
  riskProfile: InvestorRiskProfile | null;
  annualLimitKobo: number;         // regulatory cap
  investedThisYearKobo: number;
}

export interface EducationModule {
  id: string;
  title: string;
  body: string;
  minutes: number;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
}

export interface InvestmentSubscriptionInput {
  offerId: string;
  amountKobo: number;
  acceptedRisk: boolean;
  acceptedAgreement: boolean;
}

export interface InvestmentCertificate {
  id: string;
  reference: string;
  offerTitle: string;
  issuerName: string;
  amountKobo: number;
  model: InvestmentModel;
  unitsOrPct: string;              // '0.8% equity' | '₦500,000 note @ 14%'
  issuedAt: string;
  lockInUntil: string;
}

export interface PortfolioHolding {
  id: string;
  offerId: string;
  offerTitle: string;
  issuerName: string;
  model: InvestmentModel;
  investedKobo: number;
  currentValueKobo: number;
  status: 'ACTIVE' | 'EXITED' | 'DEFAULTED';
  investedAt: string;
}
