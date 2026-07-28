// ── Fractional Real Estate — Mock data ───────────────────────────────────────
// Realistic kobo data so the app runs with no backend (USE_MOCK default true).
// 6+ offerings across income_property / development_debt / land, plus holdings,
// payouts, market listings, statements, documents, goals.

import { getSecureItem, setSecureItem } from '@/lib/secureStorage';
import type {
  OfferingDetail, OfferingSummary, InvestorProfile, PortfolioOverview, Holding,
  HoldingDetail, Payout, Statement, MarketListing, MarketOrder, AutoInvestPlan,
  VaultDocument, InvestGoal, Certificate, Beneficiary, BeneficiaryInput, Referrals,
} from './types';

const DAY = 86_400_000;
const now = Date.now();
const iso = (offsetDays: number) => new Date(now + offsetDays * DAY).toISOString();

const IMG = (seed: string) => `https://picsum.photos/seed/${seed}/800/500`;

const baseDocs = (seed: string): OfferingDetail['documents'] => [
  { id: `${seed}-deed`, label: 'Certificate of Occupancy', kind: 'title_deed', url: 'https://example.com/doc/deed.pdf', sizeKb: 880 },
  { id: `${seed}-survey`, label: 'Registered Survey Plan', kind: 'survey', url: 'https://example.com/doc/survey.pdf', sizeKb: 540 },
  { id: `${seed}-val`, label: 'Independent Valuation Report', kind: 'valuation', url: 'https://example.com/doc/valuation.pdf', sizeKb: 1320 },
  { id: `${seed}-memo`, label: 'Offer Memorandum', kind: 'offer_memo', url: 'https://example.com/doc/memo.pdf', sizeKb: 2100 },
  { id: `${seed}-spv`, label: 'SPV Constitution', kind: 'spv', url: 'https://example.com/doc/spv.pdf', sizeKb: 760 },
];

const baseFaq = (): OfferingDetail['faq'] => [
  { q: 'How are payouts made?', a: 'Net income is distributed to your Paymax wallet on the stated schedule after costs and fees.' },
  { q: 'Can I sell early?', a: 'You may list your fraction on the secondary market, subject to a buyer being available at your price.' },
  { q: 'Who holds the asset?', a: 'The asset is held by a special purpose vehicle (SPV). You hold fractional units in that SPV.' },
  { q: 'Are returns guaranteed?', a: 'No. Projected yields are estimates and your capital is at risk.' },
];

export const MOCK_OFFERINGS: OfferingDetail[] = [
  {
    id: 'off-lekki-towers', kind: 'income_property', title: 'Lekki Phase 1 Serviced Apartments',
    location: 'Lekki, Lagos', coverImageUrl: IMG('lekkitowers'), riskBand: 'balanced',
    projectedYieldBps: 1450, tenorMonths: 36, unitPriceKobo: 50_000_00, minUnits: 1,
    raisedKobo: 312_500_000_00, targetKobo: 500_000_000_00, status: 'funding',
    titleVerified: true, closesAt: iso(9), payoutFrequency: 'quarterly', watched: false,
    summary: 'A block of 24 fully serviced apartments generating short-let and long-let rental income in the heart of Lekki Phase 1.',
    sponsor: 'Paymax Realty Partners', spvName: 'Lekki Towers SPV Ltd', assetDescription: '24-unit serviced apartment block, 90% occupancy, professional facility management.',
    lat: 6.4426, lng: 3.4715, riskFactors: ['Occupancy may fall below projections.', 'Short-let demand is seasonal.', 'Service charges may rise.'],
    capTable: [{ label: 'Investors', pct: 70 }, { label: 'Sponsor', pct: 20 }, { label: 'Reserve', pct: 10 }],
    documents: baseDocs('lekki'), faq: baseFaq(), platformFeeBps: 150, offerRiskAckId: null,
  },
  {
    id: 'off-ikoyi-grade-a', kind: 'income_property', title: 'Ikoyi Grade-A Office Floor',
    location: 'Ikoyi, Lagos', coverImageUrl: IMG('ikoyioffice'), riskBand: 'conservative',
    projectedYieldBps: 1100, tenorMonths: 60, unitPriceKobo: 100_000_00, minUnits: 1,
    raisedKobo: 680_000_000_00, targetKobo: 800_000_000_00, status: 'open',
    titleVerified: true, closesAt: iso(21), payoutFrequency: 'monthly', watched: true,
    summary: 'A single Grade-A office floor let to a blue-chip multinational on a five-year lease with annual escalations.',
    sponsor: 'Anchor Asset Managers', spvName: 'Ikoyi Office SPV Ltd', assetDescription: 'Whole floor, 1,200 sqm, single-tenant lease, 5-year term, 7% annual rent escalation.',
    lat: 6.4541, lng: 3.4350, riskFactors: ['Single-tenant concentration risk.', 'Lease renewal not guaranteed.'],
    capTable: [{ label: 'Investors', pct: 80 }, { label: 'Sponsor', pct: 15 }, { label: 'Reserve', pct: 5 }],
    documents: baseDocs('ikoyi'), faq: baseFaq(), platformFeeBps: 125, offerRiskAckId: null,
  },
  {
    id: 'off-abuja-mall', kind: 'income_property', title: 'Abuja Retail Mall Anchor Units',
    location: 'Central Area, Abuja', coverImageUrl: IMG('abujamall'), riskBand: 'balanced',
    projectedYieldBps: 1600, tenorMonths: 48, unitPriceKobo: 25_000_00, minUnits: 2,
    raisedKobo: 145_000_000_00, targetKobo: 350_000_000_00, status: 'funding',
    titleVerified: true, closesAt: iso(4), payoutFrequency: 'quarterly', watched: false,
    summary: 'Anchor retail units in an established Abuja shopping mall with diversified tenancy.',
    sponsor: 'Capital Retail SPV', spvName: 'Abuja Mall Anchor SPV Ltd', assetDescription: '6 anchor units, multi-tenant, footfall-linked turnover rent component.',
    lat: 9.0579, lng: 7.4951, riskFactors: ['Retail footfall sensitive to economy.', 'Tenant turnover risk.'],
    capTable: [{ label: 'Investors', pct: 65 }, { label: 'Sponsor', pct: 25 }, { label: 'Reserve', pct: 10 }],
    documents: baseDocs('abuja'), faq: baseFaq(), platformFeeBps: 150, offerRiskAckId: null,
  },
  {
    id: 'off-epe-estate-debt', kind: 'development_debt', title: 'Epe Gardens Estate — Construction Loan',
    location: 'Epe, Lagos', coverImageUrl: IMG('epeestate'), riskBand: 'growth',
    projectedYieldBps: 2200, tenorMonths: 18, unitPriceKobo: 20_000_00, minUnits: 5,
    raisedKobo: 98_000_000_00, targetKobo: 200_000_000_00, status: 'funding',
    titleVerified: true, closesAt: iso(12), payoutFrequency: 'biannual', watched: false,
    summary: 'Senior secured construction loan financing 40 terraced homes, repaid from off-plan sales.',
    sponsor: 'Greenfield Developers', spvName: 'Epe Gardens Debt SPV Ltd', assetDescription: 'Secured against land + works; 18-month bullet with semi-annual interest.',
    lat: 6.5840, lng: 3.9836, riskFactors: ['Construction delay risk.', 'Borrower default risk.', 'Off-plan sales velocity risk.'],
    capTable: [{ label: 'Senior debt (you)', pct: 60 }, { label: 'Sponsor equity', pct: 40 }],
    documents: baseDocs('epe'), faq: baseFaq(), platformFeeBps: 175, offerRiskAckId: null,
  },
  {
    id: 'off-ph-bridge-debt', kind: 'development_debt', title: 'Port Harcourt Logistics Hub — Bridge Debt',
    location: 'Port Harcourt, Rivers', coverImageUrl: IMG('phlogistics'), riskBand: 'growth',
    projectedYieldBps: 2000, tenorMonths: 12, unitPriceKobo: 50_000_00, minUnits: 2,
    raisedKobo: 250_000_000_00, targetKobo: 250_000_000_00, status: 'funded',
    titleVerified: true, closesAt: iso(-2), payoutFrequency: 'on_exit', watched: false,
    summary: 'Short-term bridge facility for a warehousing development, repaid on refinancing.',
    sponsor: 'Delta Industrial', spvName: 'PH Logistics Debt SPV Ltd', assetDescription: 'First-lien bridge, 12-month, repaid on take-out financing.',
    lat: 4.8156, lng: 7.0498, riskFactors: ['Refinancing risk.', 'Single-asset security.'],
    capTable: [{ label: 'Senior debt (you)', pct: 70 }, { label: 'Mezzanine', pct: 30 }],
    documents: baseDocs('phlog'), faq: baseFaq(), platformFeeBps: 175, offerRiskAckId: null,
  },
  {
    id: 'off-ibeju-land', kind: 'land', title: 'Ibeju-Lekki Banked Land — Phase 2',
    location: 'Ibeju-Lekki, Lagos', coverImageUrl: IMG('ibejuland'), riskBand: 'speculative',
    projectedYieldBps: 2800, tenorMonths: 60, unitPriceKobo: 10_000_00, minUnits: 10,
    raisedKobo: 42_000_000_00, targetKobo: 120_000_000_00, status: 'open',
    titleVerified: true, closesAt: iso(45), payoutFrequency: 'on_exit', watched: false,
    summary: 'Land banking in a high-growth corridor near the Lekki Free Trade Zone. Returns realised on appreciation and sale.',
    sponsor: 'Coastal Land Co', spvName: 'Ibeju Land SPV Ltd', assetDescription: '12 acres registered title; held for capital appreciation over the corridor build-out.',
    lat: 6.4280, lng: 3.9920, riskFactors: ['Land is illiquid and long-dated.', 'No income until exit.', 'Valuation depends on corridor development.'],
    capTable: [{ label: 'Investors', pct: 85 }, { label: 'Sponsor', pct: 15 }],
    documents: baseDocs('ibeju'), faq: baseFaq(), platformFeeBps: 200, offerRiskAckId: null,
  },
  {
    id: 'off-kano-land', kind: 'land', title: 'Kano Industrial Land Parcel',
    location: 'Bompai, Kano', coverImageUrl: IMG('kanoland'), riskBand: 'growth',
    projectedYieldBps: 1900, tenorMonths: 48, unitPriceKobo: 15_000_00, minUnits: 5,
    raisedKobo: 60_000_000_00, targetKobo: 90_000_000_00, status: 'closing',
    titleVerified: false, closesAt: iso(2), payoutFrequency: 'on_exit', watched: false,
    summary: 'Industrial-zoned land parcel in Kano with planning approval pending re-zoning upside.',
    sponsor: 'Northern Estates', spvName: 'Kano Land SPV Ltd', assetDescription: '8 acres, industrial zoning, title verification in progress.',
    lat: 12.0022, lng: 8.5920, riskFactors: ['Title verification pending.', 'Zoning change not guaranteed.', 'Illiquid asset.'],
    capTable: [{ label: 'Investors', pct: 80 }, { label: 'Sponsor', pct: 20 }],
    documents: baseDocs('kano'), faq: baseFaq(), platformFeeBps: 200, offerRiskAckId: null,
  },
];

export const MOCK_OFFERING_SUMMARIES: OfferingSummary[] = MOCK_OFFERINGS.map(({
  summary: _s, sponsor: _sp, spvName: _spv, assetDescription: _ad, lat: _lat, lng: _lng,
  riskFactors: _rf, capTable: _ct, documents: _d, faq: _f, platformFeeBps: _p, offerRiskAckId: _o,
  ...rest
}) => rest);

export const MOCK_PROFILE: InvestorProfile = {
  id: 'inv-mock', status: 'active', classification: 'retail', riskProfile: 'balanced',
  remainingAllowanceKobo: 6_200_000_00, annualLimitKobo: 10_000_000_00,
  kycVerified: true, suitabilityComplete: true, masterRiskAckId: 'ack-master-mock',
  createdAt: iso(-120),
};

export const MOCK_HOLDINGS: Holding[] = [
  {
    id: 'hold-1', offeringId: 'off-ikoyi-grade-a', title: 'Ikoyi Grade-A Office Floor', kind: 'income_property',
    coverImageUrl: IMG('ikoyioffice'), units: 12, investedKobo: 1_200_000_00, currentValueKobo: 1_284_000_00,
    payoutsToDateKobo: 66_000_00, projectedYieldBps: 1100, status: 'active', maturesAt: iso(540), acquiredAt: iso(-90),
  },
  {
    id: 'hold-2', offeringId: 'off-lekki-towers', title: 'Lekki Phase 1 Serviced Apartments', kind: 'income_property',
    coverImageUrl: IMG('lekkitowers'), units: 8, investedKobo: 400_000_00, currentValueKobo: 432_000_00,
    payoutsToDateKobo: 21_500_00, projectedYieldBps: 1450, status: 'active', maturesAt: iso(900), acquiredAt: iso(-60),
  },
  {
    id: 'hold-3', offeringId: 'off-ibeju-land', title: 'Ibeju-Lekki Banked Land — Phase 2', kind: 'land',
    coverImageUrl: IMG('ibejuland'), units: 30, investedKobo: 300_000_00, currentValueKobo: 348_000_00,
    payoutsToDateKobo: 0, projectedYieldBps: 2800, status: 'active', maturesAt: iso(1700), acquiredAt: iso(-200),
  },
];

export const MOCK_PAYOUTS: Payout[] = [
  { id: 'pay-1', holdingId: 'hold-1', offeringTitle: 'Ikoyi Grade-A Office Floor', amountKobo: 11_000_00, status: 'paid', paidAt: iso(-30), dueAt: iso(-30), kind: 'rent' },
  { id: 'pay-2', holdingId: 'hold-1', offeringTitle: 'Ikoyi Grade-A Office Floor', amountKobo: 11_000_00, status: 'paid', paidAt: iso(-60), dueAt: iso(-60), kind: 'rent' },
  { id: 'pay-3', holdingId: 'hold-2', offeringTitle: 'Lekki Phase 1 Serviced Apartments', amountKobo: 14_500_00, status: 'paid', paidAt: iso(-15), dueAt: iso(-15), kind: 'rent' },
  { id: 'pay-4', holdingId: 'hold-1', offeringTitle: 'Ikoyi Grade-A Office Floor', amountKobo: 11_000_00, status: 'scheduled', paidAt: null, dueAt: iso(5), kind: 'rent' },
  { id: 'pay-5', holdingId: 'hold-2', offeringTitle: 'Lekki Phase 1 Serviced Apartments', amountKobo: 14_500_00, status: 'scheduled', paidAt: null, dueAt: iso(75), kind: 'rent' },
];

export const MOCK_HOLDING_DETAIL: Record<string, HoldingDetail> = MOCK_HOLDINGS.reduce((acc, h) => {
  acc[h.id] = {
    ...h,
    navPerUnitKobo: Math.round(h.currentValueKobo / h.units),
    performance: Array.from({ length: 6 }, (_, i) => ({
      t: iso(-(6 - i) * 30),
      valueKobo: Math.round(h.investedKobo * (1 + (i * (h.currentValueKobo / h.investedKobo - 1)) / 5)),
    })),
    payouts: MOCK_PAYOUTS.filter((p) => p.holdingId === h.id),
    updates: [
      { id: `${h.id}-u1`, date: iso(-20), title: 'Quarterly performance update', body: 'Occupancy held steady; net income in line with projections.' },
      { id: `${h.id}-u2`, date: iso(-80), title: 'Asset onboarded', body: 'The SPV completed acquisition and your units were allocated.' },
    ],
    documents: [
      { id: `${h.id}-cert`, label: 'Investment Certificate', kind: 'certificate', url: 'https://example.com/cert.pdf', sizeKb: 320 },
      { id: `${h.id}-stmt`, label: 'Latest Statement', kind: 'statement', url: 'https://example.com/stmt.pdf', sizeKb: 210 },
    ],
  };
  return acc;
}, {} as Record<string, HoldingDetail>);

export const MOCK_PORTFOLIO: PortfolioOverview = {
  totalValueKobo: 2_064_000_00,
  investedKobo: 1_900_000_00,
  totalReturnsKobo: 87_500_00,
  unrealisedGainKobo: 164_000_00,
  walletBalanceKobo: 540_000_00,
  nextPayout: { dueAt: iso(5), amountKobo: 11_000_00 },
  holdingsCount: 3,
  allocation: [
    { kind: 'income_property', label: 'Income Property', valueKobo: 1_716_000_00, pct: 83 },
    { kind: 'land', label: 'Land', valueKobo: 348_000_00, pct: 17 },
    { kind: 'development_debt', label: 'Development Debt', valueKobo: 0, pct: 0 },
  ],
};

export const MOCK_STATEMENTS: Statement[] = [
  { id: 'st-1', period: '2026-Q1', label: 'Q1 2026 Investor Statement', url: 'https://example.com/stmt-q1.pdf', issuedAt: iso(-85) },
  { id: 'st-2', period: '2025-Q4', label: 'Q4 2025 Investor Statement', url: 'https://example.com/stmt-q4.pdf', issuedAt: iso(-175) },
  { id: 'st-3', period: '2025', label: '2025 Annual Tax Summary', url: 'https://example.com/tax-2025.pdf', issuedAt: iso(-160) },
];

export const MOCK_MARKET_LISTINGS: MarketListing[] = [
  { id: 'mkt-1', holdingId: 'x', offeringId: 'off-lekki-towers', offeringTitle: 'Lekki Phase 1 Serviced Apartments', kind: 'income_property', units: 6, pricePerUnitKobo: 52_500_00, navPerUnitKobo: 54_000_00, totalKobo: 315_000_00, status: 'open', listedAt: iso(-3), sellerMasked: 'Investor ***18' },
  { id: 'mkt-2', holdingId: 'x', offeringId: 'off-ikoyi-grade-a', offeringTitle: 'Ikoyi Grade-A Office Floor', kind: 'income_property', units: 4, pricePerUnitKobo: 104_000_00, navPerUnitKobo: 107_000_00, totalKobo: 416_000_00, status: 'open', listedAt: iso(-1), sellerMasked: 'Investor ***42' },
  { id: 'mkt-3', holdingId: 'x', offeringId: 'off-ibeju-land', offeringTitle: 'Ibeju-Lekki Banked Land — Phase 2', kind: 'land', units: 20, pricePerUnitKobo: 11_200_00, navPerUnitKobo: 11_600_00, totalKobo: 224_000_00, status: 'open', listedAt: iso(-5), sellerMasked: 'Investor ***07' },
];

export const MOCK_MARKET_ORDERS: MarketOrder[] = [
  { id: 'ord-1', listingId: 'mkt-9', offeringTitle: 'Lekki Phase 1 Serviced Apartments', side: 'buy', units: 3, amountKobo: 157_500_00, status: 'filled', createdAt: iso(-40) },
  { id: 'ord-2', listingId: 'mkt-10', offeringTitle: 'Ikoyi Grade-A Office Floor', side: 'sell', units: 2, amountKobo: 208_000_00, status: 'open', createdAt: iso(-2) },
];

export const MOCK_AUTO_INVEST: AutoInvestPlan[] = [
  { id: 'ai-1', amountKobo: 100_000_00, frequency: 'monthly', riskBand: 'balanced', kinds: ['income_property', 'development_debt'], status: 'active', nextRunAt: iso(12), totalInvestedKobo: 300_000_00 },
];

export const MOCK_VAULT_DOCS: VaultDocument[] = [
  { id: 'v-1', label: 'Investment Certificate — Ikoyi', kind: 'certificate', offeringTitle: 'Ikoyi Grade-A Office Floor', url: 'https://example.com/cert1.pdf', sizeKb: 320, issuedAt: iso(-90) },
  { id: 'v-2', label: 'Investment Certificate — Lekki', kind: 'certificate', offeringTitle: 'Lekki Phase 1 Serviced Apartments', url: 'https://example.com/cert2.pdf', sizeKb: 318, issuedAt: iso(-60) },
  { id: 'v-3', label: 'Q1 2026 Statement', kind: 'statement', offeringTitle: 'Portfolio', url: 'https://example.com/stmt-q1.pdf', sizeKb: 210, issuedAt: iso(-85) },
  { id: 'v-4', label: 'Master Risk Disclosure (signed)', kind: 'other', offeringTitle: 'Account', url: 'https://example.com/risk-ack.pdf', sizeKb: 90, issuedAt: iso(-120) },
];

export const MOCK_GOALS: InvestGoal[] = [
  { id: 'g-1', name: 'Property down-payment', targetKobo: 5_000_000_00, savedKobo: 1_640_000_00, targetDate: iso(720), kind: 'income_property' },
];

// ── Beneficiaries (mutable mock state, persisted to secure storage) ──────────
// Module-level in-memory list like the rest of the mock layer, but ALSO written
// through to secure storage so beneficiaries survive dev reloads (the reported
// P0: the screen previously lost everything on unmount).

const BENEFICIARIES_STORAGE_KEY = 'fre_beneficiaries_mock_v1';

let mockBeneficiaries: Beneficiary[] | null = null; // null = not hydrated yet

async function hydrateBeneficiaries(): Promise<Beneficiary[]> {
  if (mockBeneficiaries) return mockBeneficiaries;
  try {
    const raw = await getSecureItem(BENEFICIARIES_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    mockBeneficiaries = Array.isArray(parsed) ? (parsed as Beneficiary[]) : [];
  } catch {
    mockBeneficiaries = [];
  }
  return mockBeneficiaries;
}

async function persistBeneficiaries(list: Beneficiary[]): Promise<void> {
  mockBeneficiaries = list;
  try {
    await setSecureItem(BENEFICIARIES_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // In-memory copy still holds the truth for this session.
  }
}

export async function mockGetBeneficiaries(): Promise<Beneficiary[]> {
  return [...(await hydrateBeneficiaries())];
}

/** Mirrors the server's 422 rules so mock and live behave identically. */
export async function mockAddBeneficiary(input: BeneficiaryInput): Promise<Beneficiary> {
  const list = await hydrateBeneficiaries();
  const name = input.name.trim();
  const relationship = input.relationship.trim();
  const share = input.share_pct;
  if (name.length < 2 || name.length > 80) throw new Error('Name must be 2–80 characters.');
  if (relationship.length < 2 || relationship.length > 40) throw new Error('Relationship must be 2–40 characters.');
  if (!Number.isInteger(share) || share < 1 || share > 100) throw new Error('Share must be a whole number between 1 and 100.');
  if (list.length >= 10) throw new Error('You can add at most 10 beneficiaries.');
  const allocated = list.reduce((sum, b) => sum + b.share_pct, 0);
  if (allocated + share > 100) throw new Error(`Total share cannot exceed 100%. Only ${100 - allocated}% remains.`);
  const beneficiary: Beneficiary = { id: `ben-${Date.now()}`, name, relationship, share_pct: share };
  await persistBeneficiaries([...list, beneficiary]);
  return beneficiary;
}

export async function mockRemoveBeneficiary(id: string): Promise<void> {
  const list = await hydrateBeneficiaries();
  await persistBeneficiaries(list.filter((b) => b.id !== id));
}

// ── Referrals ────────────────────────────────────────────────────────────────

export const MOCK_REFERRALS: Referrals = {
  enabled: true,
  code: 'PAYMAX-RE-4821',
  invited: 7,
  joined: 3,
  earned_kobo: 45_000_00,
};

export function buildMockCertificate(offeringId: string, units: number, amountKobo: number): Certificate {
  const off = MOCK_OFFERINGS.find((o) => o.id === offeringId) ?? MOCK_OFFERINGS[0];
  return {
    investmentId: `inv-${Date.now()}`,
    certificateNo: `FRE-${new Date().getFullYear()}-${Math.floor(Math.random() * 90000 + 10000)}`,
    offeringTitle: off.title,
    units,
    amountKobo,
    issuedAt: new Date().toISOString(),
    spvName: off.spvName,
    documentUrl: 'https://example.com/certificate.pdf',
  };
}
