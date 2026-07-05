// ── Crowdfunding — Investment (Section L) data layer ─────────────────────────
// Mock-backed. Money in kobo. The module entry is gated by INVESTMENT_ENABLED.

import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  InvestmentOffer,
  InvestorProfile,
  EducationModule,
  QuizQuestion,
  InvestmentSubscriptionInput,
  InvestmentCertificate,
  PortfolioHolding,
  InvestorRiskProfile,
} from '../types/investment.types';

const USE_MOCK = process.env.EXPO_PUBLIC_CF_USE_MOCK !== 'false';
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));

// Mutable in mock mode so onboarding progress persists within a session.
const PROFILE: InvestorProfile = {
  onboarded: false,
  kycComplete: false,
  educationComplete: false,
  quizPassed: false,
  riskProfile: null,
  annualLimitKobo: 1_000_000_000,      // ₦10,000,000 regulatory cap (illustrative)
  investedThisYearKobo: 0,
};

const OFFERS: InvestmentOffer[] = [
  {
    id: 'io1', title: 'AgriGrow Outgrower Expansion', issuerName: 'AgriGrow Ltd', issuerVerified: true,
    model: 'REVENUE_SHARE', summary: 'Fund 200 hectares of cassava outgrower farms for a 18-month revenue-share.',
    coverImage: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&q=80',
    targetKobo: 5_000_000_000, raisedKobo: 3_100_000_000, minTicketKobo: 5_000_000, investorCount: 184,
    status: 'OPEN', closesAt: '2026-08-30T23:59:59Z', projectedReturnPct: 22, termMonths: 18,
    riskLevel: 'HIGH', lockInMonths: 12, coolingOffDays: 2, sector: 'Agriculture', location: 'Oyo, Nigeria',
    offerDocumentLabel: 'Offer memorandum (PDF)',
    riskWarnings: [
      'Your capital is at risk. Returns are projected, not guaranteed.',
      'Agricultural yields depend on weather and market prices.',
      'Investments may be illiquid until the term ends (12-month lock-in).',
    ],
    useOfProceeds: [
      { label: 'Inputs & seedlings', amountKobo: 2_500_000_000 },
      { label: 'Mechanisation', amountKobo: 1_500_000_000 },
      { label: 'Logistics & working capital', amountKobo: 1_000_000_000 },
    ],
  },
  {
    id: 'io2', title: 'SolarLite Off-Grid Notes', issuerName: 'SolarLite Energy', issuerVerified: true,
    model: 'DEBT', summary: 'Fixed-rate notes funding solar home systems across rural communities.',
    coverImage: 'https://images.unsplash.com/photo-1509391366360-2e959784a276?w=800&q=80',
    targetKobo: 8_000_000_000, raisedKobo: 7_400_000_000, minTicketKobo: 10_000_000, investorCount: 312,
    status: 'CLOSING_SOON', closesAt: '2026-07-05T23:59:59Z', projectedReturnPct: 14, termMonths: 24,
    riskLevel: 'MEDIUM', lockInMonths: 24, coolingOffDays: 2, sector: 'Clean energy', location: 'Kaduna, Nigeria',
    offerDocumentLabel: 'Note terms & conditions (PDF)',
    riskWarnings: [
      'Fixed returns depend on the issuer’s ability to repay.',
      'Notes are held to maturity; early exit is not guaranteed.',
    ],
    useOfProceeds: [
      { label: 'Solar inventory', amountKobo: 6_000_000_000 },
      { label: 'Installation network', amountKobo: 2_000_000_000 },
    ],
  },
];

const EDUCATION: EducationModule[] = [
  { id: 'e1', title: 'What is investment crowdfunding?', minutes: 3, body: 'Investment crowdfunding lets you invest in early-stage businesses in exchange for equity, debt notes, or a share of revenue. Unlike donations, you expect a financial return — but you can also lose your money.' },
  { id: 'e2', title: 'Understanding the risks', minutes: 4, body: 'Most startups and projects fail. Your capital is at risk and returns are never guaranteed. Investments are often illiquid, meaning you cannot easily sell or withdraw before the term ends.' },
  { id: 'e3', title: 'Diversification & limits', minutes: 3, body: 'Never invest more than you can afford to lose. Spread your investments across several offers. Regulatory limits cap how much you can invest per year based on your profile.' },
  { id: 'e4', title: 'Your protections', minutes: 2, body: 'Issuers are verified, funds are held by a custodian/escrow, and there is a short cooling-off period after you invest. Read every offer document before committing.' },
];

const QUIZ: QuizQuestion[] = [
  { id: 'q1', question: 'Are investment returns guaranteed?', options: ['Yes, always', 'No — your capital is at risk', 'Only for debt notes'], correctIndex: 1 },
  { id: 'q2', question: 'What does "illiquid" mean for your investment?', options: ['You earn interest daily', 'You may not be able to sell or withdraw early', 'It is insured by the government'], correctIndex: 1 },
  { id: 'q3', question: 'How much should you invest?', options: ['Everything you have', 'Only what you can afford to lose', 'Borrow to maximise returns'], correctIndex: 1 },
];

let MOCK_PORTFOLIO: PortfolioHolding[] = [];

// ─── API ──────────────────────────────────────────────────────────────────────

export async function getInvestorProfile(): Promise<InvestorProfile> {
  if (USE_MOCK) { await delay(160); return { ...PROFILE }; }
  const res = await api.get('/api/v1/crowdfunding/investment/profile');
  return res.data?.data ?? res.data;
}

export async function completeOnboardingStep(step: 'kyc' | 'education' | 'quiz' | 'risk', riskProfile?: InvestorRiskProfile): Promise<void> {
  if (USE_MOCK) {
    await delay(250);
    if (step === 'kyc') PROFILE.kycComplete = true;
    if (step === 'education') PROFILE.educationComplete = true;
    if (step === 'quiz') PROFILE.quizPassed = true;
    if (step === 'risk' && riskProfile) PROFILE.riskProfile = riskProfile;
    PROFILE.onboarded = PROFILE.kycComplete && PROFILE.educationComplete && PROFILE.quizPassed && !!PROFILE.riskProfile;
    return;
  }
  await api.post('/api/v1/crowdfunding/investment/onboarding', { step, riskProfile });
}

export async function getOffers(): Promise<InvestmentOffer[]> {
  if (USE_MOCK) { await delay(); return OFFERS; }
  const res = await api.get('/api/v1/crowdfunding/investment/offers');
  return res.data?.data ?? res.data;
}

export async function getOffer(id: string): Promise<InvestmentOffer> {
  if (USE_MOCK) {
    await delay();
    const o = OFFERS.find((x) => x.id === id);
    if (!o) throw new Error('Offer not found');
    return o;
  }
  const res = await api.get(`/api/v1/crowdfunding/investment/offers/${id}`);
  return res.data?.data ?? res.data;
}

export async function getEducation(): Promise<EducationModule[]> {
  if (USE_MOCK) { await delay(120); return EDUCATION; }
  const res = await api.get('/api/v1/crowdfunding/investment/education');
  return res.data?.data ?? res.data;
}

export async function getQuiz(): Promise<QuizQuestion[]> {
  if (USE_MOCK) { await delay(120); return QUIZ; }
  const res = await api.get('/api/v1/crowdfunding/investment/quiz');
  return res.data?.data ?? res.data;
}

export async function subscribe(input: InvestmentSubscriptionInput): Promise<InvestmentCertificate> {
  if (USE_MOCK) {
    await delay(900);
    const offer = OFFERS.find((o) => o.id === input.offerId)!;
    PROFILE.investedThisYearKobo += input.amountKobo;
    const cert: InvestmentCertificate = {
      id: `cert-${Date.now()}`, reference: `SPL-INV-${Date.now()}`, offerTitle: offer.title, issuerName: offer.issuerName,
      amountKobo: input.amountKobo, model: offer.model,
      unitsOrPct: offer.model === 'EQUITY' ? `${((input.amountKobo / offer.targetKobo) * 100).toFixed(2)}% equity` : offer.model === 'DEBT' ? `₦${(input.amountKobo / 100).toLocaleString('en-NG')} note @ ${offer.projectedReturnPct}%` : `${offer.projectedReturnPct}% revenue-share`,
      issuedAt: new Date().toISOString(), lockInUntil: new Date(Date.now() + offer.lockInMonths * 30 * 86_400_000).toISOString(),
    };
    MOCK_PORTFOLIO = [
      { id: cert.id, offerId: offer.id, offerTitle: offer.title, issuerName: offer.issuerName, model: offer.model, investedKobo: input.amountKobo, currentValueKobo: input.amountKobo, status: 'ACTIVE', investedAt: cert.issuedAt },
      ...MOCK_PORTFOLIO,
    ];
    return cert;
  }
  const res = await api.post('/api/v1/crowdfunding/investment/subscribe', input, { headers: { 'Idempotency-Key': generateIdempotencyKey() } });
  return res.data?.data ?? res.data;
}

export async function getPortfolio(): Promise<PortfolioHolding[]> {
  if (USE_MOCK) { await delay(); return MOCK_PORTFOLIO; }
  const res = await api.get('/api/v1/crowdfunding/investment/portfolio');
  return res.data?.data ?? res.data;
}
