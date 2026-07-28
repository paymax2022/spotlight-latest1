// ── Fractional Real Estate — typed API layer ─────────────────────────────────
// Mock-flagged. Flip with EXPO_PUBLIC_FRACTIONALRE_USE_MOCK=false to hit the Go
// backend via the frontend-web proxy /api/v1/fractionalre → Go
// /api/finance/fractionalre (canonical investor base).
//
// IRON RULES honoured: money is integer kobo; every subscribe / market-buy
// mutation carries an Idempotency-Key header AND a `pin` in the body; the client
// never computes fees, limits or allowances itself — the server is authoritative.

import { api } from '@/api/client';
import type {
  OfferingSummary, OfferingDetail, InvestorProfile, SuitabilityInput, SuitabilityResult,
  LimitCheckResult, SubscribeRequest, SubscribeResult, PortfolioOverview, Holding,
  HoldingDetail, Payout, Statement, MarketListing, MarketOrder, ListFractionInput,
  BuyListingRequest, AutoInvestPlan, AutoInvestInput, VaultDocument, InvestGoal,
  CreateGoalInput, Certificate, Beneficiary, BeneficiaryInput, Referrals,
} from './types';
import {
  MOCK_OFFERINGS, MOCK_OFFERING_SUMMARIES, MOCK_PROFILE, MOCK_PORTFOLIO, MOCK_HOLDINGS,
  MOCK_HOLDING_DETAIL, MOCK_PAYOUTS, MOCK_STATEMENTS, MOCK_MARKET_LISTINGS, MOCK_MARKET_ORDERS,
  MOCK_AUTO_INVEST, MOCK_VAULT_DOCS, MOCK_GOALS, MOCK_REFERRALS, buildMockCertificate,
  mockGetBeneficiaries, mockAddBeneficiary, mockRemoveBeneficiary,
} from './mock';

export const USE_MOCK =
  (process.env.EXPO_PUBLIC_FRACTIONALRE_USE_MOCK ?? 'true') !== 'false';

// The Next.js gateway rewrites /api/finance/:path* verbatim to the Go backend
// (frontend-web/next.config.mjs); the Go fractionalre investor surface is
// registered at /api/finance/fractionalre (backend/internal/fractionalre/routes.go).
// Previously this pointed at '/api/v1/fractionalre', which has no Next.js route
// handler and no rewrite — every live call would 404.
const BASE = '/api/finance/fractionalre';

const waitMock = <T>(value: T, ms = 320): Promise<T> =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

function unwrap<T>(res: { data?: unknown }): T {
  const body = res.data as { data?: unknown } | undefined;
  return ((body && typeof body === 'object' && 'data' in body ? body.data : body) ?? body) as T;
}

async function get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const res = await api.get(BASE + path, { params });
  return unwrap<T>(res);
}
async function post<T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined;
  const res = await api.post(BASE + path, body ?? {}, { headers });
  return unwrap<T>(res);
}
async function del<T>(path: string): Promise<T> {
  const res = await api.delete(BASE + path);
  return unwrap<T>(res);
}

// ── Account / onboarding ─────────────────────────────────────────────────────

export async function activate(): Promise<InvestorProfile> {
  if (USE_MOCK) return waitMock({ ...MOCK_PROFILE, status: 'pending_suitability' });
  return post<InvestorProfile>('/activate');
}

export async function getInvestorProfile(): Promise<InvestorProfile> {
  if (USE_MOCK) return waitMock(MOCK_PROFILE);
  return get<InvestorProfile>('/me');
}

export async function submitSuitability(input: SuitabilityInput): Promise<SuitabilityResult> {
  if (USE_MOCK) {
    const riskProfile = input.riskTolerance === 'high' ? 'growth' : input.riskTolerance === 'low' ? 'conservative' : 'balanced';
    const classification = input.netWorthKobo >= 50_000_000_00 ? 'hni' : 'retail';
    return waitMock({
      riskProfile, classification,
      annualLimitKobo: classification === 'hni' ? 100_000_000_00 : 10_000_000_00,
      eligibleKinds: classification === 'hni'
        ? ['income_property', 'development_debt', 'land']
        : ['income_property', 'development_debt', 'land'],
    });
  }
  return post<SuitabilityResult>('/suitability', input);
}

export async function acknowledgeRisk(scope: 'master' | string): Promise<{ riskAckId: string }> {
  if (USE_MOCK) return waitMock({ riskAckId: scope === 'master' ? 'ack-master-mock' : `ack-${scope}-mock` });
  return post<{ riskAckId: string }>('/risk-ack', { scope });
}

// ── Offerings (marketplace) ──────────────────────────────────────────────────

export async function getOfferings(params?: { kind?: string; risk?: string; q?: string }): Promise<OfferingSummary[]> {
  if (USE_MOCK) {
    let list = MOCK_OFFERING_SUMMARIES;
    if (params?.kind) list = list.filter((o) => o.kind === params.kind);
    if (params?.risk) list = list.filter((o) => o.riskBand === params.risk);
    if (params?.q) {
      const ql = params.q.toLowerCase();
      list = list.filter((o) => o.title.toLowerCase().includes(ql) || o.location.toLowerCase().includes(ql));
    }
    return waitMock(list);
  }
  return get<OfferingSummary[]>('/offerings', params);
}

export async function getOffering(id: string): Promise<OfferingDetail> {
  if (USE_MOCK) return waitMock(MOCK_OFFERINGS.find((o) => o.id === id) ?? MOCK_OFFERINGS[0]);
  return get<OfferingDetail>(`/offerings/${id}`);
}

export async function watchOffering(id: string): Promise<void> {
  if (USE_MOCK) return waitMock(undefined);
  await post(`/offerings/${id}/watch`);
}
export async function unwatchOffering(id: string): Promise<void> {
  if (USE_MOCK) return waitMock(undefined);
  await del(`/offerings/${id}/watch`);
}
export async function getWatchlist(): Promise<OfferingSummary[]> {
  if (USE_MOCK) return waitMock(MOCK_OFFERING_SUMMARIES.filter((o) => o.watched));
  return get<OfferingSummary[]>('/watchlist');
}

// ── Limit check (server-authoritative) ───────────────────────────────────────

export async function limitCheck(offeringId: string, amountKobo: number): Promise<LimitCheckResult> {
  if (USE_MOCK) {
    const remaining = MOCK_PROFILE.remainingAllowanceKobo;
    if (amountKobo > remaining) {
      return waitMock({ status: 'block', remainingKobo: remaining, message: 'This exceeds your remaining annual allowance.' }, 200);
    }
    if (amountKobo > remaining * 0.7) {
      return waitMock({ status: 'warn', remainingKobo: remaining - amountKobo, message: 'This will use most of your remaining allowance.' }, 200);
    }
    return waitMock({ status: 'pass', remainingKobo: remaining - amountKobo }, 200);
  }
  return post<LimitCheckResult>(`/offerings/${offeringId}/limit-check`, { amountKobo });
}

// ── Subscription ─────────────────────────────────────────────────────────────

export async function subscribe(offeringId: string, req: SubscribeRequest): Promise<SubscribeResult> {
  if (USE_MOCK) {
    const off = MOCK_OFFERINGS.find((o) => o.id === offeringId) ?? MOCK_OFFERINGS[0];
    const units = req.units ?? Math.max(1, Math.floor((req.amountKobo ?? 0) / off.unitPriceKobo));
    const amountKobo = req.amountKobo ?? units * off.unitPriceKobo;
    const cert = buildMockCertificate(offeringId, units, amountKobo);
    return waitMock({ investmentId: cert.investmentId, status: 'confirmed', certificate: cert }, 600);
  }
  // pin + idempotencyKey + offerRiskAckId all travel in the request per the contract.
  return post<SubscribeResult>(`/offerings/${offeringId}/subscribe`, req, req.idempotencyKey);
}

export async function getCertificate(investmentId: string): Promise<Certificate> {
  if (USE_MOCK) return waitMock(buildMockCertificate(MOCK_OFFERINGS[0].id, 1, MOCK_OFFERINGS[0].unitPriceKobo));
  return get<Certificate>(`/certificates/${investmentId}`);
}

// ── Portfolio ────────────────────────────────────────────────────────────────

export async function getPortfolio(): Promise<PortfolioOverview> {
  if (USE_MOCK) return waitMock(MOCK_PORTFOLIO);
  return get<PortfolioOverview>('/portfolio');
}
export async function getHoldings(): Promise<Holding[]> {
  if (USE_MOCK) return waitMock(MOCK_HOLDINGS);
  return get<Holding[]>('/portfolio/holdings');
}
export async function getHolding(id: string): Promise<HoldingDetail> {
  if (USE_MOCK) return waitMock(MOCK_HOLDING_DETAIL[id] ?? Object.values(MOCK_HOLDING_DETAIL)[0]);
  return get<HoldingDetail>(`/portfolio/holdings/${id}`);
}
export async function getPayouts(): Promise<Payout[]> {
  if (USE_MOCK) return waitMock(MOCK_PAYOUTS);
  return get<Payout[]>('/portfolio/payouts');
}
export async function getStatements(): Promise<Statement[]> {
  if (USE_MOCK) return waitMock(MOCK_STATEMENTS);
  return get<Statement[]>('/portfolio/statements');
}

// ── Auto-invest ──────────────────────────────────────────────────────────────

export async function getAutoInvest(): Promise<AutoInvestPlan[]> {
  if (USE_MOCK) return waitMock(MOCK_AUTO_INVEST);
  return get<AutoInvestPlan[]>('/auto-invest');
}
export async function createAutoInvest(input: AutoInvestInput, idempotencyKey: string): Promise<AutoInvestPlan> {
  if (USE_MOCK) {
    return waitMock({
      id: `ai-${Date.now()}`, ...input, status: 'active',
      nextRunAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), totalInvestedKobo: 0,
    });
  }
  return post<AutoInvestPlan>('/auto-invest', input, idempotencyKey);
}
export async function pauseAutoInvest(id: string): Promise<AutoInvestPlan> {
  if (USE_MOCK) return waitMock({ ...MOCK_AUTO_INVEST[0], id, status: 'paused' });
  return post<AutoInvestPlan>(`/auto-invest/${id}/pause`);
}

// ── Secondary market ─────────────────────────────────────────────────────────

export async function getMarket(): Promise<MarketListing[]> {
  if (USE_MOCK) return waitMock(MOCK_MARKET_LISTINGS);
  return get<MarketListing[]>('/market');
}
export async function listFraction(input: ListFractionInput, idempotencyKey: string): Promise<MarketListing> {
  if (USE_MOCK) {
    return waitMock({
      id: `mkt-${Date.now()}`, holdingId: input.holdingId, offeringId: 'off-mock',
      offeringTitle: 'Your listing', kind: 'income_property', units: input.units,
      pricePerUnitKobo: input.pricePerUnitKobo, navPerUnitKobo: input.pricePerUnitKobo,
      totalKobo: input.units * input.pricePerUnitKobo, status: 'open',
      listedAt: new Date().toISOString(), sellerMasked: 'You',
    });
  }
  return post<MarketListing>('/market/list', input, idempotencyKey);
}
export async function buyListing(listingId: string, req: BuyListingRequest): Promise<MarketOrder> {
  if (USE_MOCK) {
    const l = MOCK_MARKET_LISTINGS.find((x) => x.id === listingId) ?? MOCK_MARKET_LISTINGS[0];
    return waitMock({
      id: `ord-${Date.now()}`, listingId, offeringTitle: l.offeringTitle, side: 'buy',
      units: req.units, amountKobo: req.units * l.pricePerUnitKobo, status: 'filled',
      createdAt: new Date().toISOString(),
    }, 600);
  }
  return post<MarketOrder>(`/market/listings/${listingId}/buy`, req, req.idempotencyKey);
}
export async function getMarketOrders(): Promise<MarketOrder[]> {
  if (USE_MOCK) return waitMock(MOCK_MARKET_ORDERS);
  return get<MarketOrder[]>('/market/orders');
}

// ── Documents / certificates vault ───────────────────────────────────────────

export async function getDocuments(): Promise<VaultDocument[]> {
  if (USE_MOCK) return waitMock(MOCK_VAULT_DOCS);
  return get<VaultDocument[]>('/documents');
}

// ── Beneficiaries ────────────────────────────────────────────────────────────
// Wire format is snake_case ({ id, name, relationship, share_pct }) per the
// backend contract. Server enforces Σ share_pct ≤ 100, max 10 rows; violations
// come back as 422 with a message. Mock mirrors those rules and persists.

export async function getBeneficiaries(): Promise<Beneficiary[]> {
  if (USE_MOCK) return waitMock(await mockGetBeneficiaries(), 200);
  const list = await get<Beneficiary[] | null>('/beneficiaries');
  return Array.isArray(list) ? list : [];
}

export async function addBeneficiary(input: BeneficiaryInput): Promise<Beneficiary> {
  if (USE_MOCK) return waitMock(await mockAddBeneficiary(input), 250);
  return post<Beneficiary>('/beneficiaries', input);
}

export async function removeBeneficiary(id: string): Promise<void> {
  if (USE_MOCK) {
    await mockRemoveBeneficiary(id);
    return waitMock(undefined, 200);
  }
  await del(`/beneficiaries/${id}`);
}

// ── Referrals ────────────────────────────────────────────────────────────────

export async function getReferrals(): Promise<Referrals> {
  if (USE_MOCK) return waitMock(MOCK_REFERRALS);
  const res = await get<Referrals | null>('/referrals');
  // Defensive: a missing/blank payload or one without a code means the
  // programme is not enabled for this user yet.
  if (!res || typeof res !== 'object') return { enabled: false };
  if ('enabled' in res && res.enabled === false) return res;
  return 'code' in res && typeof res.code === 'string' && res.code.length > 0
    ? res
    : { enabled: false };
}

// ── Goals ────────────────────────────────────────────────────────────────────

export async function getGoals(): Promise<InvestGoal[]> {
  if (USE_MOCK) return waitMock(MOCK_GOALS);
  return get<InvestGoal[]>('/goals');
}
export async function createGoal(input: CreateGoalInput): Promise<InvestGoal> {
  if (USE_MOCK) return waitMock({ id: `g-${Date.now()}`, savedKobo: 0, ...input });
  return post<InvestGoal>('/goals', input);
}
