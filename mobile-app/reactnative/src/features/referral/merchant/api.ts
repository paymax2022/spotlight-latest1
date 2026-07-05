// ── Referral Merchant Zone (lite) API (M-MER-01..03) ─────────────────────────
// Mock-first (USE_MOCK). Money is ALWAYS integer kobo.
//
// BACKEND GAP (confirmed): merchant.Register is wired ONLY onto the referral
// ADMIN router group, not the member group — see
// backend/internal/app/referral_econ_routes.go:58 (`merchant.Register(admin,
// merchantSvc, rbac)`, single group arg) and
// backend/internal/referral/merchant/handlers.go:23-37, all routes RBAC-gated
// on `referral.merchant.*` under /api/referral/admin/merchants/*:
//   GET  /api/referral/admin/merchants                       (List)
//   POST /api/referral/admin/merchants                       (Create)
//   GET  /api/referral/admin/merchants/:id                   (Get)
//   GET  /api/referral/admin/merchants/:id/campaigns         (ListCampaigns)
//   POST /api/referral/admin/merchants/campaigns             (CreateCampaign)
//   POST /api/referral/admin/merchants/campaigns/:mcid/fund  (Fund — money mutation)
//   POST /api/referral/admin/merchants/campaigns/:mcid/settle(Settle)
//   GET  /api/referral/admin/merchants/:id/keys               (ListKeys)
//   POST /api/referral/admin/merchants/keys                   (IssueKey)
//   POST /api/referral/admin/merchants/keys/:keyid/revoke     (RevokeKey)
// There is NO member-role merchant endpoint at all. The frontend-web
// /api/v1/referral proxy (singular, member group) has nothing to forward to
// for merchant — only the admin console (frontend-admin, not in scope here)
// could reach these. This whole feature is kept mock-only on mobile; do NOT
// fabricate a live branch that calls a path the member JWT cannot access.

import { USE_MOCK } from '../constants/referral.constants';
import type {
  MerchantDashboard,
  CreateCampaignInput,
  FundCampaignResult,
  MerchantPerformance,
} from './types';

const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));

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
  // TODO(referral phase3): member merchant zone has no backend yet (merchant
  // routes are admin-only under /api/referral/admin/merchants/*). Return an empty
  // dashboard so the screen renders a clean "no campaigns" state instead of 404.
  return {
    walletBalanceKobo: 0,
    totalSpentKobo: 0,
    totalConversions: 0,
    activeCampaigns: 0,
    campaigns: [],
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
  // TODO(referral phase3): no member merchant performance endpoint yet.
  return {
    campaignId,
    campaignName: '',
    budgetKobo: 0,
    spentKobo: 0,
    conversions: 0,
    costPerConversionKobo: 0,
    roas: 0,
    series: [],
  };
}
