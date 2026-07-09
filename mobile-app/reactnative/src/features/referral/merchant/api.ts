// ── Referral Merchant Zone (lite) API (M-MER-01..03) ─────────────────────────
// Mock-first (USE_MOCK). Money is ALWAYS integer kobo.
//
// READ-ONLY member self-view is now live: GET /api/finance/referral/merchant/
// {dashboard, campaigns/:id/performance} (scoped to the caller's owned merchant
// via referral_merchants.owner_user_id). Campaign FUNDING remains an admin/back-
// office money mutation (/api/referral/admin/merchants/*) — createAndFundCampaign
// stays unavailable to the member JWT and throws rather than fabricating.

import { api } from '@/api/client';
import { USE_MOCK, REFERRAL_API_BASE } from '../constants/referral.constants';
import type {
  MerchantDashboard,
  CreateCampaignInput,
  FundCampaignResult,
  MerchantPerformance,
} from './types';

const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));

function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}

const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();

const MOCK_DASHBOARD: MerchantDashboard = {
  walletBalanceKobo: 8_500_000,
  totalSpentKobo: 3_200_000,
  totalConversions: 164,
  activeCampaigns: 2,
  campaigns: [
    { id: 'mc1', name: 'New-customer cashback', status: 'active', budgetKobo: 2_000_000, spentKobo: 1_240_000, conversions: 62, startedAt: daysAgo(18) },
    { id: 'mc2', name: 'Weekend order boost', status: 'active', budgetKobo: 1_500_000, spentKobo: 980_000, conversions: 49, startedAt: daysAgo(9) },
    { id: 'mc3', name: 'Holiday promo', status: 'out_of_budget', budgetKobo: 1_000_000, spentKobo: 1_000_000, conversions: 53, startedAt: daysAgo(40) },
    { id: 'mc4', name: 'Draft: loyalty push', status: 'draft', budgetKobo: 0, spentKobo: 0, conversions: 0, startedAt: null },
  ],
};

const MOCK_PERFORMANCE: Record<string, MerchantPerformance> = {
  mc1: {
    campaignId: 'mc1',
    campaignName: 'New-customer cashback',
    budgetKobo: 2_000_000,
    spentKobo: 1_240_000,
    conversions: 62,
    costPerConversionKobo: Math.round(1_240_000 / 62),
    roas: 3.4,
    series: [
      { label: 'Wk 1', conversions: 12, spendKobo: 240_000 },
      { label: 'Wk 2', conversions: 18, spendKobo: 360_000 },
      { label: 'Wk 3', conversions: 16, spendKobo: 320_000 },
      { label: 'Wk 4', conversions: 16, spendKobo: 320_000 },
    ],
  },
  mc2: {
    campaignId: 'mc2',
    campaignName: 'Weekend order boost',
    budgetKobo: 1_500_000,
    spentKobo: 980_000,
    conversions: 49,
    costPerConversionKobo: Math.round(980_000 / 49),
    roas: 2.8,
    series: [
      { label: 'Wk 1', conversions: 22, spendKobo: 440_000 },
      { label: 'Wk 2', conversions: 27, spendKobo: 540_000 },
    ],
  },
};

export async function getMerchantDashboard(): Promise<MerchantDashboard> {
  if (USE_MOCK) {
    await delay();
    return { ...MOCK_DASHBOARD, campaigns: MOCK_DASHBOARD.campaigns.map((c) => ({ ...c })) };
  }
  // Live: read-only member merchant dashboard (owner-scoped).
  const res = await api.get(`${REFERRAL_API_BASE}/merchant/dashboard`);
  const b = unwrap<{
    wallet_balance_kobo?: number;
    total_spent_kobo?: number;
    total_conversions?: number;
    active_campaigns?: number;
    campaigns?: Array<{
      id: string; name: string; status: string;
      budget_kobo: number; spent_kobo: number; conversions: number; started_at: string;
    }>;
  }>(res);
  return {
    walletBalanceKobo: Math.trunc(b.wallet_balance_kobo ?? 0),
    totalSpentKobo: Math.trunc(b.total_spent_kobo ?? 0),
    totalConversions: b.total_conversions ?? 0,
    activeCampaigns: b.active_campaigns ?? 0,
    campaigns: (b.campaigns ?? []).map((mc) => ({
      id: mc.id,
      name: mc.name,
      status: mc.status as MerchantDashboard['campaigns'][number]['status'],
      budgetKobo: Math.trunc(mc.budget_kobo ?? 0),
      spentKobo: Math.trunc(mc.spent_kobo ?? 0),
      conversions: mc.conversions ?? 0,
      startedAt: mc.started_at ?? null,
    })),
  };
}

// Money mutation: debits wallet to fund the campaign. Idempotency-Key on live.
export async function createAndFundCampaign(input: CreateCampaignInput): Promise<FundCampaignResult> {
  if (USE_MOCK) {
    await delay(460);
    if (input.budgetKobo <= 0 || input.rewardPerConversionKobo <= 0) {
      return { ok: false, campaignId: '', fundedKobo: 0, newWalletBalanceKobo: MOCK_DASHBOARD.walletBalanceKobo, reference: '', error: 'invalid_amount' };
    }
    if (input.budgetKobo > MOCK_DASHBOARD.walletBalanceKobo) {
      return { ok: false, campaignId: '', fundedKobo: 0, newWalletBalanceKobo: MOCK_DASHBOARD.walletBalanceKobo, reference: '', error: 'insufficient_funds' };
    }
    return {
      ok: true,
      campaignId: `mc-${Math.floor(Math.random() * 9000 + 1000)}`,
      fundedKobo: input.budgetKobo,
      newWalletBalanceKobo: MOCK_DASHBOARD.walletBalanceKobo - input.budgetKobo,
      reference: `MER-FUND-${Math.floor(Math.random() * 900000 + 100000)}`,
    };
  }
  // TODO(referral phase3): no member merchant funding endpoint. This is a money
  // mutation (debits the merchant wallet) — do NOT fabricate a funded campaign.
  throw new Error('Merchant campaign funding is not available yet.');
}

export async function getMerchantPerformance(campaignId: string): Promise<MerchantPerformance> {
  if (USE_MOCK) {
    await delay(240);
    const p = MOCK_PERFORMANCE[campaignId] ?? MOCK_PERFORMANCE.mc1;
    return { ...p, series: p.series.map((s) => ({ ...s })) };
  }
  // Live: owner-scoped campaign performance.
  const res = await api.get(`${REFERRAL_API_BASE}/merchant/campaigns/${encodeURIComponent(campaignId)}/performance`);
  const b = unwrap<{
    campaign_id?: string; campaign_name?: string; budget_kobo?: number; spent_kobo?: number;
    conversions?: number; cost_per_conversion_kobo?: number; roas?: number;
    series?: Array<{ label: string; conversions: number; spendKobo: number }>;
  }>(res);
  return {
    campaignId: b.campaign_id ?? campaignId,
    campaignName: b.campaign_name ?? '',
    budgetKobo: Math.trunc(b.budget_kobo ?? 0),
    spentKobo: Math.trunc(b.spent_kobo ?? 0),
    conversions: b.conversions ?? 0,
    costPerConversionKobo: Math.trunc(b.cost_per_conversion_kobo ?? 0),
    roas: b.roas ?? 0,
    series: b.series ?? [],
  };
}
