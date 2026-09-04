// ── Admin — Fractional Real Estate control-plane service ─────────────────────
// Mock by default (mirrors estateAdminService / investAdminService). Flip with
// NEXT_PUBLIC_FRACTIONALRE_ADMIN_USE_MOCK=false to hit the live Go backend.
// All money is integer minor units (kobo). Live admin base:
//   /api/finance/fractionalre/admin/...  (env.apiBaseUrl strips its /api/v1 suffix)
// RBAC: gated by fractionalre.* permission slugs server-side.

import { env } from '@/config/env';
import type {
  FractionalReDashboard, AdminAsset, CreateAssetInput, AssetPatch, TitleVerification,
  TitleVerifyInput, AssetTransitionInput, AdminRound, CreateRoundInput, ExtendRoundInput,
  MakerCheckerResult, CapTable, TransferUnitsInput, AdminInvestorSummary, AdminInvestorDetail,
  InvestorLimit, LimitOverrideInput, ClassifyInvestorInput, KycQueueItem, KycDecisionInput,
  ComplianceDashboard, AdminDistribution, ScheduleDistributionInput, DistributionPreview,
  DistributionDecisionInput, SecondaryListing, MarketControls, AdminSponsor, CreateSponsorInput,
  EscrowAccount, FeeRevenue, RefundResult, DocumentRecord, PresignResult, AuditEntry,
} from '@/types/fractionalreAdmin';

const USE_MOCK = (process.env.NEXT_PUBLIC_FRACTIONALRE_ADMIN_USE_MOCK ?? 'true').toLowerCase() !== 'false';

// env.apiBaseUrl ends with /api/v1 — strip it and target /api/finance.
function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/finance/fractionalre/admin');
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(extra || {}) };
  if (typeof window === 'undefined') return headers;
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// Money POSTs require an Idempotency-Key. Generate a stable-per-call key.
function idemKey(): string {
  return (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));

// Every write below has a real, RBAC-gated live endpoint (verified against
// backend/internal/fractionalre/routes.go — the admin control plane is fully
// built), so fixture mode has nothing to add and refuses loudly instead of
// reporting a write it did not perform. See docs/audit/ADMIN_SIMULATED_WRITES.md.
const NOT_IN_FIXTURE_MODE =
  'is unavailable in fixture mode: this console will not report a write it did not perform. ' +
  'Set NEXT_PUBLIC_FRACTIONALRE_ADMIN_USE_MOCK=false to make this change against the live backend.';

async function req<T>(path: string, init?: RequestInit & { money?: boolean }): Promise<T> {
  const extra = init?.money ? { 'Idempotency-Key': idemKey() } : undefined;
  const res = await fetch(adminBase() + path, { ...init, headers: authHeaders(extra), cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return (body?.data ?? body) as T;
}

const hrs = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();
const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const fut = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

// ─── Mock datasets ────────────────────────────────────────────────────────────
const DASHBOARD: FractionalReDashboard = {
  kpis: {
    aumKobo: 2_450_000_000_00,
    totalRaisedKobo: 1_820_000_000_00,
    activeInvestors: 1_284,
    liveRounds: 3,
    payoutsDueKobo: 48_500_000_00,
    pipelineValueKobo: 920_000_000_00,
  },
  alerts: [
    { id: 'al1', kind: 'limit_breach', severity: 'high', message: 'Investor Tunde Bakare exceeded 10% annual cap', ref: 'inv-2', at: hrs(2) },
    { id: 'al2', kind: 'failing_round', severity: 'critical', message: 'Lekki Pearl round below min threshold with 3 days left', ref: 'rnd-2', at: hrs(5) },
    { id: 'al3', kind: 'kyc_backlog', severity: 'medium', message: '14 KYC reviews approaching SLA breach', at: hrs(1) },
    { id: 'al4', kind: 'expiring_doc', severity: 'low', message: 'Insurance policy for Ikoyi Heights expires in 7 days', ref: 'ast-1', at: hrs(8) },
    { id: 'al5', kind: 'price_anomaly', severity: 'medium', message: 'Secondary listing 22% above NAV flagged', ref: 'lst-3', at: days(1) },
  ],
};

const ASSETS: AdminAsset[] = [
  {
    id: 'ast-1', name: 'Ikoyi Heights Tower B', type: 'residential', location: 'Ikoyi, Lagos',
    geoPin: { lat: 6.4474, lng: 3.4361 }, status: 'Operational', totalValueKobo: 1_200_000_000_00,
    unitPriceKobo: 500_000_00, totalUnits: 2400, unitsSold: 2400, sponsorId: 'spn-1', sponsorName: 'Primewater Developments',
    titleVerified: true,
    returnsModel: { targetYieldBps: 1200, tenorMonths: 36, distributionFrequency: 'quarterly', capitalAppreciationBps: 800 },
    mediaUrls: ['https://example.com/ikoyi-1.jpg'], documents: [
      { id: 'd1', kind: 'title', name: 'C of O - Ikoyi Heights.pdf', version: 2, uploadedAt: days(120) },
      { id: 'd2', kind: 'valuation', name: 'Valuation Report Q1.pdf', version: 1, uploadedAt: days(90) },
    ],
    createdAt: days(200), updatedAt: days(10),
  },
  {
    id: 'ast-2', name: 'Lekki Pearl Estate Plots', type: 'land', location: 'Lekki Phase 2, Lagos',
    status: 'FundingOpen', totalValueKobo: 600_000_000_00, unitPriceKobo: 250_000_00,
    totalUnits: 2400, unitsSold: 980, sponsorId: 'spn-2', sponsorName: 'Coastline Estates Ltd', titleVerified: true,
    returnsModel: { targetYieldBps: 0, tenorMonths: 24, distributionFrequency: 'on_exit', capitalAppreciationBps: 2500 },
    mediaUrls: [], documents: [{ id: 'd3', kind: 'survey', name: 'Survey Plan.pdf', version: 1, uploadedAt: days(40) }],
    createdAt: days(60), updatedAt: hrs(6),
  },
  {
    id: 'ast-3', name: 'Abuja Central Mall', type: 'commercial', location: 'Central Business District, Abuja',
    status: 'TitleVerification', totalValueKobo: 850_000_000_00, unitPriceKobo: 1_000_000_00,
    totalUnits: 850, unitsSold: 0, sponsorId: 'spn-1', sponsorName: 'Primewater Developments', titleVerified: false,
    returnsModel: { targetYieldBps: 1500, tenorMonths: 48, distributionFrequency: 'quarterly' },
    mediaUrls: [], documents: [{ id: 'd4', kind: 'deed', name: 'Deed of Assignment.pdf', version: 1, uploadedAt: days(15) }],
    createdAt: days(30), updatedAt: days(2),
  },
  {
    id: 'ast-4', name: 'Enugu Agro Land Bank', type: 'agricultural', location: 'Nsukka, Enugu',
    status: 'Draft', totalValueKobo: 320_000_000_00, unitPriceKobo: 100_000_00,
    totalUnits: 3200, unitsSold: 0, titleVerified: false,
    returnsModel: { targetYieldBps: 1800, tenorMonths: 60, distributionFrequency: 'biannual' },
    mediaUrls: [], documents: [], createdAt: days(5), updatedAt: days(1),
  },
];

const TITLE: TitleVerification = {
  assetId: 'ast-3',
  checklist: [
    { key: 'cofo', label: 'C of O / Deed', passed: true },
    { key: 'consent', label: "Governor's consent", passed: true },
    { key: 'encumbrance', label: 'Encumbrance / charge search', passed: false, note: 'Awaiting registry response' },
    { key: 'survey', label: 'Survey plan', passed: true },
    { key: 'chain', label: 'Ownership chain', passed: false },
  ],
  registryCheckRef: 'REG-ABJ-2026-0091',
};

const ROUNDS: AdminRound[] = [
  {
    id: 'rnd-1', assetId: 'ast-1', assetName: 'Ikoyi Heights Tower B', status: 'Allocated',
    targetKobo: 1_200_000_000_00, minThresholdKobo: 800_000_000_00, unitPriceKobo: 500_000_00,
    ticketMinKobo: 500_000_00, ticketMaxKobo: 120_000_000_00, raisedKobo: 1_200_000_000_00,
    investorCount: 642, watchers: 1200, escrowAccountRef: 'ESC-IKOYI-01',
    opensAt: days(210), closesAt: days(150), extensionsUsed: 0, createdAt: days(215),
  },
  {
    id: 'rnd-2', assetId: 'ast-2', assetName: 'Lekki Pearl Estate Plots', status: 'Open',
    targetKobo: 600_000_000_00, minThresholdKobo: 400_000_000_00, unitPriceKobo: 250_000_00,
    ticketMinKobo: 250_000_00, ticketMaxKobo: 60_000_000_00, raisedKobo: 245_000_000_00,
    investorCount: 312, watchers: 890, escrowAccountRef: 'ESC-LEKKI-02',
    opensAt: days(40), closesAt: fut(3), extensionsUsed: 0, createdAt: days(42),
  },
  {
    id: 'rnd-3', assetId: 'ast-3', assetName: 'Abuja Central Mall', status: 'Draft',
    targetKobo: 850_000_000_00, minThresholdKobo: 600_000_000_00, unitPriceKobo: 1_000_000_00,
    ticketMinKobo: 1_000_000_00, ticketMaxKobo: 85_000_000_00, raisedKobo: 0,
    investorCount: 0, watchers: 0, escrowAccountRef: 'ESC-ABUJA-03',
    opensAt: fut(7), closesAt: fut(45), extensionsUsed: 0, createdAt: days(2),
  },
];

const CAP_TABLE: CapTable = {
  assetId: 'ast-1', assetName: 'Ikoyi Heights Tower B', totalUnits: 2400, unitsAllocated: 2400,
  entries: [
    { id: 'ct1', investorId: 'inv-1', investorName: 'Ngozi Umeh', units: 240, ownershipPct: 10, acquisitionDate: days(150), source: 'primary', certificateRef: 'CERT-001' },
    { id: 'ct2', investorId: 'inv-2', investorName: 'Tunde Bakare', units: 120, ownershipPct: 5, acquisitionDate: days(150), source: 'primary', certificateRef: 'CERT-002' },
    { id: 'ct3', investorId: 'inv-3', investorName: 'Aisha Bello', units: 480, ownershipPct: 20, acquisitionDate: days(120), source: 'primary', certificateRef: 'CERT-003' },
    { id: 'ct4', investorId: 'inv-4', investorName: 'Chidi Eze', units: 60, ownershipPct: 2.5, acquisitionDate: days(30), source: 'secondary', certificateRef: 'CERT-004' },
  ],
};

const INVESTORS: AdminInvestorSummary[] = [
  { id: 'inv-1', name: 'Ngozi Umeh', email: 'ngozi@example.com', kycStatus: 'verified', classification: 'hni', aumKobo: 320_000_000_00, holdingsCount: 4, joinedAt: days(420) },
  { id: 'inv-2', name: 'Tunde Bakare', email: 'tunde@example.com', kycStatus: 'verified', classification: 'retail', aumKobo: 18_000_000_00, holdingsCount: 2, joinedAt: days(180) },
  { id: 'inv-3', name: 'Aisha Bello', email: 'aisha@example.com', kycStatus: 'verified', classification: 'qualified', aumKobo: 240_000_000_00, holdingsCount: 3, joinedAt: days(300) },
  { id: 'inv-4', name: 'Chidi Eze', email: 'chidi@example.com', kycStatus: 'pending', classification: 'retail', aumKobo: 6_000_000_00, holdingsCount: 1, joinedAt: days(30) },
];

function investorDetail(id: string): AdminInvestorDetail {
  const s = INVESTORS.find((i) => i.id === id) ?? INVESTORS[0];
  const annualCap = s.classification === 'retail' ? 5_000_000_00 : 100_000_000_00;
  const invested = id === 'inv-2' ? 6_000_000_00 : 1_500_000_00;
  return {
    ...s, phone: '0803 000 0000', incomeOnFileKobo: 24_000_000_00, riskProfile: 'balanced',
    limit: {
      investorId: id, classification: s.classification, annualCapKobo: annualCap,
      investedThisYearKobo: invested, remainingAllowanceKobo: Math.max(0, annualCap - invested),
      capPct: 10, breached: invested > annualCap, overrideActive: false,
    },
    holdings: CAP_TABLE.entries.filter((e) => e.investorId === id),
  };
}

const KYC_QUEUE: KycQueueItem[] = [
  { userId: 'inv-4', name: 'Chidi Eze', submittedAt: hrs(20), classification: 'retail', slaHoursRemaining: 4, amlFlags: [], documents: [{ kind: 'id', name: 'NIN.pdf' }, { kind: 'proof_of_address', name: 'Utility.pdf' }] },
  { userId: 'inv-9', name: 'Bola Hassan', submittedAt: hrs(40), classification: 'hni', slaHoursRemaining: -2, amlFlags: ['PEP match (low confidence)'], documents: [{ kind: 'id', name: 'Passport.pdf' }, { kind: 'income', name: 'Bank statement.pdf' }] },
  { userId: 'inv-12', name: 'Sani Aliyu', submittedAt: hrs(6), classification: 'retail', slaHoursRemaining: 18, amlFlags: [], documents: [{ kind: 'id', name: 'Driver licence.pdf' }] },
];

const COMPLIANCE: ComplianceDashboard = {
  openKycCount: 3, amlOpenCases: 1, activeBreaches: 1, activeOverrides: 0, expiringDocsCount: 2,
  breaches: [{ investorId: 'inv-2', investorName: 'Tunde Bakare', detail: 'Exceeded 10% annual cap by ₦1,000,000', at: hrs(2) }],
  overrides: [],
};

const DISTRIBUTIONS: AdminDistribution[] = [
  { id: 'dst-1', assetId: 'ast-1', assetName: 'Ikoyi Heights Tower B', period: '2026-Q1', grossAmountKobo: 36_000_000_00, source: 'rental_income', status: 'Completed', maker: 'finance.maker', checker: 'dist.approver', createdAt: days(80), approvedAt: days(78) },
  { id: 'dst-2', assetId: 'ast-1', assetName: 'Ikoyi Heights Tower B', period: '2026-Q2', grossAmountKobo: 38_500_000_00, source: 'rental_income', status: 'PendingApproval', maker: 'finance.maker', createdAt: hrs(12) },
];

function distributionPreview(id: string): DistributionPreview {
  const lineItems = CAP_TABLE.entries.map((e) => {
    const gross = Math.round(38_500_000_00 * (e.ownershipPct / 100));
    const fee = Math.round(gross * 0.02);
    const wht = Math.round(gross * 0.10);
    return { investorId: e.investorId, investorName: e.investorName, units: e.units, ownershipPct: e.ownershipPct, grossKobo: gross, feeKobo: fee, withholdingTaxKobo: wht, netKobo: gross - fee - wht };
  });
  const exceptions = [{ investorId: 'inv-4', investorName: 'Chidi Eze', units: 60, ownershipPct: 2.5, grossKobo: 962_500_00, feeKobo: 19_250_00, withholdingTaxKobo: 96_250_00, netKobo: 847_000_00, exception: 'KYC pending — payout held' }];
  return {
    distributionId: id, grossAmountKobo: 38_500_000_00,
    totalFeesKobo: lineItems.reduce((a, x) => a + x.feeKobo, 0),
    totalWithholdingKobo: lineItems.reduce((a, x) => a + x.withholdingTaxKobo, 0),
    totalNetKobo: lineItems.reduce((a, x) => a + x.netKobo, 0),
    lineItems, exceptions,
  };
}

const LISTINGS: SecondaryListing[] = [
  { id: 'lst-1', assetId: 'ast-1', assetName: 'Ikoyi Heights Tower B', sellerId: 'inv-2', sellerName: 'Tunde Bakare', units: 50, askPriceKobo: 520_000_00, navPriceKobo: 510_000_00, pricePremiumPct: 2, status: 'active', listedAt: hrs(10) },
  { id: 'lst-3', assetId: 'ast-1', assetName: 'Ikoyi Heights Tower B', sellerId: 'inv-4', sellerName: 'Chidi Eze', units: 20, askPriceKobo: 622_000_00, navPriceKobo: 510_000_00, pricePremiumPct: 22, status: 'active', listedAt: days(1) },
];

const MARKET_CONTROLS: MarketControls = { secondaryFeeBps: 100, priceBandPct: 15, tradingPaused: false, pausedAssetIds: [] };

const SPONSORS: AdminSponsor[] = [
  { id: 'spn-1', entityName: 'Primewater Developments', rcNumber: 'RC-882134', contactName: 'Femi Adeniyi', contactEmail: 'femi@primewater.ng', kybStatus: 'verified', trackRecord: '12 completed projects, ₦8B GDV', assetsSubmitted: 2, totalRaisedKobo: 1_200_000_000_00, submittedAt: days(400) },
  { id: 'spn-2', entityName: 'Coastline Estates Ltd', rcNumber: 'RC-771209', contactName: 'Grace Okonkwo', contactEmail: 'grace@coastline.ng', kybStatus: 'verified', trackRecord: '5 land bank schemes', assetsSubmitted: 1, totalRaisedKobo: 245_000_000_00, submittedAt: days(120) },
  { id: 'spn-3', entityName: 'NorthBridge Realty', rcNumber: 'RC-990451', contactName: 'Yakubu Musa', contactEmail: 'yakubu@northbridge.ng', kybStatus: 'pending', trackRecord: 'New sponsor', assetsSubmitted: 0, totalRaisedKobo: 0, submittedAt: hrs(30) },
];

const ESCROWS: EscrowAccount[] = [
  { roundId: 'rnd-1', assetName: 'Ikoyi Heights Tower B', escrowAccountRef: 'ESC-IKOYI-01', inflowsKobo: 1_200_000_000_00, outflowsKobo: 1_200_000_000_00, balanceKobo: 0, reconciled: true, asOf: hrs(1) },
  { roundId: 'rnd-2', assetName: 'Lekki Pearl Estate Plots', escrowAccountRef: 'ESC-LEKKI-02', inflowsKobo: 245_000_000_00, outflowsKobo: 0, balanceKobo: 245_000_000_00, reconciled: true, asOf: hrs(1) },
];

const FEES: FeeRevenue = {
  totalFeesKobo: 62_400_000_00, managementFeesKobo: 34_000_000_00, listingFeesKobo: 8_000_000_00,
  secondaryFeesKobo: 4_400_000_00, performanceFeesKobo: 14_000_000_00, fxFeesKobo: 2_000_000_00, period: '2026-YTD',
};

const DOCUMENTS: DocumentRecord[] = [
  { id: 'doc-1', kind: 'title', name: 'C of O - Ikoyi Heights.pdf', assetId: 'ast-1', version: 2, signed: false, uploadedAt: days(120) },
  { id: 'doc-2', kind: 'agreement', name: 'Subscription Agreement - signed (642).pdf', assetId: 'ast-1', version: 1, signed: true, uploadedAt: days(150) },
  { id: 'doc-t1', kind: 'template', name: 'Subscription Agreement Template v3', version: 3, signed: false, uploadedAt: days(60) },
  { id: 'doc-t2', kind: 'template', name: 'Unit Certificate Template v2', version: 2, signed: false, uploadedAt: days(90) },
];

const AUDIT: AuditEntry[] = [
  { id: 'au-1', actorId: 'u-admin-1', actorName: 'A. Compliance', action: 'distribution.approve', entityType: 'distribution', entityId: 'dst-1', reason: 'Q1 rental verified', before: { status: 'PendingApproval' }, after: { status: 'Approved' }, at: days(78) },
  { id: 'au-2', actorId: 'u-admin-2', actorName: 'T. Verifier', action: 'asset.title_verify', entityType: 'asset', entityId: 'ast-1', reason: 'All checks clear', before: { titleVerified: false }, after: { titleVerified: true } as Record<string, unknown>, at: days(140) },
  { id: 'au-3', actorId: 'u-admin-3', actorName: 'M. Asset', action: 'asset.transition', entityType: 'asset', entityId: 'ast-2', reason: 'Round opened', before: { status: 'Approved' }, after: { status: 'FundingOpen' }, at: days(40) },
];

// ─── API ──────────────────────────────────────────────────────────────────────
export async function getDashboard(): Promise<FractionalReDashboard> {
  if (USE_MOCK) { await delay(); return JSON.parse(JSON.stringify(DASHBOARD)); }
  return req<FractionalReDashboard>('/dashboard');
}

// Assets (9.B)
export async function listAssets(status?: string): Promise<AdminAsset[]> {
  if (USE_MOCK) { await delay(); return status ? ASSETS.filter((a) => a.status === status) : [...ASSETS]; }
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return req<AdminAsset[]>(`/assets${qs}`);
}
export async function createAsset(input: CreateAssetInput): Promise<AdminAsset> {
  if (USE_MOCK) throw new Error(`Creating an asset ${NOT_IN_FIXTURE_MODE}`);
  return req<AdminAsset>('/assets', { method: 'POST', body: JSON.stringify(input) });
}
export async function getAsset(id: string): Promise<AdminAsset> {
  if (USE_MOCK) { await delay(); return ASSETS.find((a) => a.id === id) ?? ASSETS[0]; }
  return req<AdminAsset>(`/assets/${id}`);
}
export async function patchAsset(id: string, patch: AssetPatch): Promise<AdminAsset> {
  if (USE_MOCK) throw new Error(`Updating an asset ${NOT_IN_FIXTURE_MODE}`);
  return req<AdminAsset>(`/assets/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}
export async function titleVerify(id: string, input: TitleVerifyInput): Promise<TitleVerification> {
  if (USE_MOCK) throw new Error(`Recording title verification ${NOT_IN_FIXTURE_MODE}`);
  return req<TitleVerification>(`/assets/${id}/title-verify`, { method: 'POST', body: JSON.stringify(input) });
}
export async function getTitleVerification(id: string): Promise<TitleVerification> {
  if (USE_MOCK) { await delay(); return { ...TITLE, assetId: id }; }
  return req<TitleVerification>(`/assets/${id}/title-verify`);
}
export async function transitionAsset(id: string, input: AssetTransitionInput): Promise<AdminAsset> {
  if (USE_MOCK) throw new Error(`Transitioning an asset ${NOT_IN_FIXTURE_MODE}`);
  return req<AdminAsset>(`/assets/${id}/transition`, { method: 'POST', body: JSON.stringify(input) });
}

// Rounds (9.C) — close/refund are money/maker-checker
export async function createRound(assetId: string, input: CreateRoundInput): Promise<AdminRound> {
  if (USE_MOCK) throw new Error(`Creating a round ${NOT_IN_FIXTURE_MODE}`);
  return req<AdminRound>(`/assets/${assetId}/rounds`, { method: 'POST', body: JSON.stringify(input) });
}
export async function listRounds(status?: string): Promise<AdminRound[]> {
  if (USE_MOCK) { await delay(); return status ? ROUNDS.filter((r) => r.status === status) : [...ROUNDS]; }
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return req<AdminRound[]>(`/rounds${qs}`);
}
export async function getRound(id: string): Promise<AdminRound> {
  if (USE_MOCK) { await delay(); return ROUNDS.find((r) => r.id === id) ?? ROUNDS[0]; }
  return req<AdminRound>(`/rounds/${id}`);
}
export async function extendRound(id: string, input: ExtendRoundInput): Promise<AdminRound> {
  if (USE_MOCK) throw new Error(`Extending a round ${NOT_IN_FIXTURE_MODE}`);
  return req<AdminRound>(`/rounds/${id}/extend`, { method: 'POST', body: JSON.stringify(input) });
}
export async function closeRound(id: string, reason: string): Promise<MakerCheckerResult> {
  if (USE_MOCK) throw new Error(`Closing a round ${NOT_IN_FIXTURE_MODE}`);
  return req<MakerCheckerResult>(`/rounds/${id}/close`, { method: 'POST', money: true, body: JSON.stringify({ reason }) });
}
export async function refundRound(id: string, reason: string): Promise<MakerCheckerResult> {
  if (USE_MOCK) throw new Error(`Refunding a round ${NOT_IN_FIXTURE_MODE}`);
  return req<MakerCheckerResult>(`/rounds/${id}/refund`, { method: 'POST', money: true, body: JSON.stringify({ reason }) });
}
export async function allocateRound(id: string): Promise<MakerCheckerResult> {
  if (USE_MOCK) throw new Error(`Allocating a round ${NOT_IN_FIXTURE_MODE}`);
  return req<MakerCheckerResult>(`/rounds/${id}/allocate`, { method: 'POST', money: true, body: JSON.stringify({}) });
}

// Cap table (9.D)
export async function getCapTable(assetId: string): Promise<CapTable> {
  if (USE_MOCK) { await delay(); return { ...CAP_TABLE, assetId }; }
  return req<CapTable>(`/assets/${assetId}/cap-table`);
}
export async function transferUnits(input: TransferUnitsInput): Promise<MakerCheckerResult> {
  if (USE_MOCK) throw new Error(`Transferring units ${NOT_IN_FIXTURE_MODE}`);
  return req<MakerCheckerResult>('/cap-table/transfer', { method: 'POST', money: true, body: JSON.stringify(input) });
}

// Investors (9.E)
export async function listInvestors(query?: string): Promise<AdminInvestorSummary[]> {
  if (USE_MOCK) { await delay(); return query ? INVESTORS.filter((i) => i.name.toLowerCase().includes(query.toLowerCase())) : [...INVESTORS]; }
  const qs = query ? `?q=${encodeURIComponent(query)}` : '';
  return req<AdminInvestorSummary[]>(`/investors${qs}`);
}
export async function getInvestor(id: string): Promise<AdminInvestorDetail> {
  if (USE_MOCK) { await delay(); return investorDetail(id); }
  return req<AdminInvestorDetail>(`/investors/${id}`);
}
export async function getInvestorLimit(id: string): Promise<InvestorLimit> {
  if (USE_MOCK) { await delay(); return investorDetail(id).limit; }
  return req<InvestorLimit>(`/investors/${id}/limit`);
}
export async function overrideLimit(id: string, input: LimitOverrideInput): Promise<InvestorLimit> {
  if (USE_MOCK) throw new Error(`Overriding an investor limit ${NOT_IN_FIXTURE_MODE}`);
  return req<InvestorLimit>(`/investors/${id}/limit-override`, { method: 'POST', body: JSON.stringify(input) });
}
export async function classifyInvestor(id: string, input: ClassifyInvestorInput): Promise<AdminInvestorDetail> {
  if (USE_MOCK) throw new Error(`Classifying an investor ${NOT_IN_FIXTURE_MODE}`);
  return req<AdminInvestorDetail>(`/investors/${id}/classify`, { method: 'POST', body: JSON.stringify(input) });
}

// KYC & Compliance (9.F)
export async function listKycQueue(): Promise<KycQueueItem[]> {
  if (USE_MOCK) { await delay(); return [...KYC_QUEUE]; }
  return req<KycQueueItem[]>('/kyc/queue');
}
export async function decideKyc(userId: string, input: KycDecisionInput): Promise<{ userId: string; decision: string }> {
  if (USE_MOCK) throw new Error(`Deciding a KYC review ${NOT_IN_FIXTURE_MODE}`);
  return req<{ userId: string; decision: string }>(`/kyc/${userId}/decision`, { method: 'POST', body: JSON.stringify(input) });
}
export async function getComplianceDashboard(): Promise<ComplianceDashboard> {
  if (USE_MOCK) { await delay(); return JSON.parse(JSON.stringify(COMPLIANCE)); }
  return req<ComplianceDashboard>('/compliance/dashboard');
}

// Distributions (9.G)
export async function scheduleDistribution(input: ScheduleDistributionInput): Promise<AdminDistribution> {
  if (USE_MOCK) throw new Error(`Scheduling a distribution ${NOT_IN_FIXTURE_MODE}`);
  return req<AdminDistribution>('/distributions', { method: 'POST', money: true, body: JSON.stringify(input) });
}
export async function listDistributions(): Promise<AdminDistribution[]> {
  if (USE_MOCK) { await delay(); return [...DISTRIBUTIONS]; }
  return req<AdminDistribution[]>('/distributions');
}
export async function previewDistribution(id: string): Promise<DistributionPreview> {
  if (USE_MOCK) { await delay(); return distributionPreview(id); }
  return req<DistributionPreview>(`/distributions/${id}/preview`);
}
export async function submitDistribution(id: string, input: DistributionDecisionInput): Promise<AdminDistribution> {
  if (USE_MOCK) throw new Error(`Submitting a distribution ${NOT_IN_FIXTURE_MODE}`);
  return req<AdminDistribution>(`/distributions/${id}/submit`, { method: 'POST', money: true, body: JSON.stringify(input) });
}
export async function approveDistribution(id: string, input: DistributionDecisionInput): Promise<AdminDistribution> {
  if (USE_MOCK) throw new Error(`Approving a distribution ${NOT_IN_FIXTURE_MODE}`);
  return req<AdminDistribution>(`/distributions/${id}/approve`, { method: 'POST', money: true, body: JSON.stringify(input) });
}

// Secondary market (9.H)
export async function listMarketListings(): Promise<SecondaryListing[]> {
  if (USE_MOCK) { await delay(); return [...LISTINGS]; }
  return req<SecondaryListing[]>('/market/listings');
}
export async function haltListing(id: string, reason: string): Promise<{ id: string; status: string }> {
  if (USE_MOCK) throw new Error(`Halting a listing ${NOT_IN_FIXTURE_MODE}`);
  return req<{ id: string; status: string }>(`/market/listings/${id}/halt`, { method: 'POST', body: JSON.stringify({ reason }) });
}
export async function setMarketControls(controls: MarketControls): Promise<MarketControls> {
  if (USE_MOCK) throw new Error(`Updating market controls ${NOT_IN_FIXTURE_MODE}`);
  return req<MarketControls>('/market/controls', { method: 'PUT', body: JSON.stringify(controls) });
}
export async function getMarketControls(): Promise<MarketControls> {
  if (USE_MOCK) { await delay(); return { ...MARKET_CONTROLS }; }
  return req<MarketControls>('/market/controls');
}

// Sponsors (9.I)
export async function listSponsors(): Promise<AdminSponsor[]> {
  if (USE_MOCK) { await delay(); return [...SPONSORS]; }
  return req<AdminSponsor[]>('/sponsors');
}
export async function createSponsor(input: CreateSponsorInput): Promise<AdminSponsor> {
  if (USE_MOCK) throw new Error(`Creating a sponsor ${NOT_IN_FIXTURE_MODE}`);
  return req<AdminSponsor>('/sponsors', { method: 'POST', body: JSON.stringify(input) });
}

// Finance / Treasury (9.J)
export async function getEscrow(): Promise<EscrowAccount[]> {
  if (USE_MOCK) { await delay(); return [...ESCROWS]; }
  return req<EscrowAccount[]>('/finance/escrow');
}
export async function refund(roundId: string, reason: string): Promise<RefundResult> {
  if (USE_MOCK) throw new Error(`Issuing a refund ${NOT_IN_FIXTURE_MODE}`);
  return req<RefundResult>(`/finance/refunds/${roundId}`, { method: 'POST', money: true, body: JSON.stringify({ reason }) });
}
export async function getFees(): Promise<FeeRevenue> {
  if (USE_MOCK) { await delay(); return { ...FEES }; }
  return req<FeeRevenue>('/finance/fees');
}

// Documents (9.K)
export async function listDocuments(): Promise<DocumentRecord[]> {
  if (USE_MOCK) { await delay(); return [...DOCUMENTS]; }
  return req<DocumentRecord[]>('/documents');
}
export async function presignDocument(name: string, kind: string): Promise<PresignResult> {
  if (USE_MOCK) throw new Error(`Presigning a document upload ${NOT_IN_FIXTURE_MODE}`);
  return req<PresignResult>('/documents/presign', { method: 'POST', body: JSON.stringify({ name, kind }) });
}

// Audit (9.O.1)
export async function getAudit(filter?: { action?: string; entityType?: string }): Promise<AuditEntry[]> {
  if (USE_MOCK) {
    await delay();
    return AUDIT.filter((a) =>
      (!filter?.action || a.action.includes(filter.action)) &&
      (!filter?.entityType || a.entityType === filter.entityType));
  }
  const params = new URLSearchParams();
  if (filter?.action) params.set('action', filter.action);
  if (filter?.entityType) params.set('entity_type', filter.entityType);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return req<AuditEntry[]>(`/audit${qs}`);
}
