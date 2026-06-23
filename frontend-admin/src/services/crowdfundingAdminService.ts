// ── Admin — Crowdfunding service ─────────────────────────────────────────────
// Mock-backed for now (no backend endpoints yet). Mirrors fintechService shape:
// flip USE_MOCK to false and the fetch branches hit /api/crowdfunding/admin/...
// All money is integer kobo.

import { env } from '@/config/env';
import type {
  CfReviewCampaign,
  CfReviewDecision,
  CfPlatformStats,
  CfWithdrawal,
  CfFraudAlert,
  CfRefundRequest,
  CfSettlementBatch,
  CfFinanceSummary,
  CfDispute,
  CfDisputeResolution,
  CfCategoryConfig,
  CfFeeConfig,
  CfFeatureFlag,
  CfKycCase,
  CfAuditLog,
  CfDataRequest,
  CfComplianceSummary,
  CfUser,
} from '@/types/crowdfunding';

// Mock is the default. Set NEXT_PUBLIC_CF_USE_MOCK=false to hit the live Go backend
// at /api/crowdfunding/admin/* (campaign review queue, decision, stats).
const USE_MOCK = process.env.NEXT_PUBLIC_CF_USE_MOCK !== 'false';

function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/crowdfunding/admin');
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}
const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// ─── Mock dataset ─────────────────────────────────────────────────────────────

const MOCK_CAMPAIGNS: CfReviewCampaign[] = [
  {
    id: 'rv1',
    title: 'Help Baby Zara Get Open-Heart Surgery',
    summary: 'Zara was born with a congenital heart defect needing surgery within 8 weeks.',
    story: 'Zara is 14 months old and was born with Tetralogy of Fallot…',
    type: 'DONATION', status: 'PENDING_REVIEW', category: 'Medical',
    coverImage: 'https://images.unsplash.com/photo-1576765608535-5f04d1e3f289?w=600&q=80',
    goalKobo: 1_850_000_000, raisedKobo: 0, contributorCount: 0,
    createdAt: '2026-06-17T09:00:00Z', submittedAt: '2026-06-18T11:30:00Z',
    creatorName: 'Aisha Bello', creatorType: 'Individual', creatorVerification: 'KYC', creatorEmail: 'aisha.bello@example.com',
    beneficiaryName: 'Zara Bello', beneficiaryRelationship: 'Daughter', bankLabel: 'GTBank ••• 4821',
    location: 'Lagos, Nigeria', disbursementModel: 'Milestone-based',
    refundPolicy: 'Refundable before any milestone is released.',
    budget: [
      { id: 'b1', label: 'Surgical procedure & hospital', amountKobo: 1_200_000_000 },
      { id: 'b2', label: 'Flights (2 adults + infant)', amountKobo: 250_000_000 },
      { id: 'b3', label: 'Post-op care', amountKobo: 300_000_000 },
      { id: 'b4', label: 'Visas & reports', amountKobo: 100_000_000 },
    ],
    documents: [
      { id: 'd1', label: 'Hospital referral letter', type: 'pdf', verified: true },
      { id: 'd2', label: 'Surgery cost estimate', type: 'pdf', verified: true },
    ],
    riskLevel: 'LOW', riskScore: 18,
    riskSignals: [{ id: 's1', label: 'Verified creator with matching bank details', severity: 'LOW' }],
    adminNote: null,
  },
  {
    id: 'rv2',
    title: 'Cryptocurrency Doubling Scheme — Guaranteed 2x',
    summary: 'Invest and double your money in 30 days, guaranteed returns.',
    story: 'Send funds and we double them, risk-free…',
    type: 'SME', status: 'PENDING_REVIEW', category: 'SME',
    coverImage: null,
    goalKobo: 500_000_000, raisedKobo: 0, contributorCount: 0,
    createdAt: '2026-06-18T08:00:00Z', submittedAt: '2026-06-18T20:15:00Z',
    creatorName: 'John Doe', creatorType: 'Individual', creatorVerification: 'EMAIL', creatorEmail: 'jd1990@example.com',
    beneficiaryName: 'John Doe', beneficiaryRelationship: 'Myself', bankLabel: 'Access ••• 0012',
    location: 'Unknown', disbursementModel: 'Immediate',
    refundPolicy: 'No refunds.',
    budget: [{ id: 'b1', label: 'Trading capital', amountKobo: 500_000_000 }],
    documents: [],
    riskLevel: 'HIGH', riskScore: 92,
    riskSignals: [
      { id: 's1', label: 'Guaranteed-returns language (prohibited)', severity: 'HIGH' },
      { id: 's2', label: 'Unverified creator (email only)', severity: 'HIGH' },
      { id: 's3', label: 'No supporting documents', severity: 'MEDIUM' },
      { id: 's4', label: 'Bank account linked to 3 other campaigns', severity: 'HIGH' },
    ],
    adminNote: null,
  },
  {
    id: 'rv3',
    title: 'Annual Coding Bootcamp Scholarships',
    summary: '20 scholarships for young developers in Enugu.',
    story: 'We run a free coding bootcamp each year…',
    type: 'COMMUNITY', status: 'CHANGES_REQUESTED', category: 'Education',
    coverImage: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=600&q=80',
    goalKobo: 150_000_000, raisedKobo: 0, contributorCount: 0,
    createdAt: '2026-06-12T08:00:00Z', submittedAt: '2026-06-14T10:00:00Z',
    creatorName: 'Adaeze Okonkwo', creatorType: 'NGO', creatorVerification: 'KYB', creatorEmail: 'hello@enugucodes.org',
    beneficiaryName: 'Enugu Codes Initiative', beneficiaryRelationship: 'Organisation', bankLabel: 'Zenith ••• 7740',
    location: 'Enugu, Nigeria', disbursementModel: 'Flexible funding',
    refundPolicy: 'Refundable before disbursement.',
    budget: [
      { id: 'b1', label: 'Tuition & materials', amountKobo: 100_000_000 },
      { id: 'b2', label: 'Stipends', amountKobo: 50_000_000 },
    ],
    documents: [{ id: 'd1', label: 'CAC registration', type: 'pdf', verified: true }],
    riskLevel: 'LOW', riskScore: 24,
    riskSignals: [{ id: 's1', label: 'Budget detail requested by reviewer', severity: 'LOW' }],
    adminNote: 'Please add a clearer per-scholarship budget breakdown.',
  },
  {
    id: 'rv4',
    title: 'Flood Relief for Bayelsa Families',
    summary: 'Emergency food and shelter for displaced families.',
    story: 'Severe flooding has displaced hundreds of families…',
    type: 'DONATION', status: 'PENDING_REVIEW', category: 'Emergency',
    coverImage: 'https://images.unsplash.com/photo-1547683905-f686c993aae5?w=600&q=80',
    goalKobo: 300_000_000, raisedKobo: 0, contributorCount: 0,
    createdAt: '2026-06-18T06:00:00Z', submittedAt: '2026-06-19T07:45:00Z',
    creatorName: 'Niger Delta Relief Org', creatorType: 'NGO', creatorVerification: 'FULL', creatorEmail: 'ops@ndrelief.org',
    beneficiaryName: 'Bayelsa flood victims', beneficiaryRelationship: 'Community', bankLabel: 'UBA ••• 3318',
    location: 'Bayelsa, Nigeria', disbursementModel: 'Milestone-based',
    refundPolicy: 'Non-refundable once relief is dispatched.',
    budget: [
      { id: 'b1', label: 'Food packs', amountKobo: 150_000_000 },
      { id: 'b2', label: 'Temporary shelter', amountKobo: 100_000_000 },
      { id: 'b3', label: 'Logistics', amountKobo: 50_000_000 },
    ],
    documents: [
      { id: 'd1', label: 'NGO registration', type: 'pdf', verified: true },
      { id: 'd2', label: 'Field assessment report', type: 'pdf', verified: false },
    ],
    riskLevel: 'MEDIUM', riskScore: 46,
    riskSignals: [
      { id: 's1', label: 'One document pending verification', severity: 'MEDIUM' },
      { id: 's2', label: 'Time-sensitive emergency category', severity: 'LOW' },
    ],
    adminNote: null,
  },
];

const MOCK_WITHDRAWALS: CfWithdrawal[] = [
  { id: 'wd1', reference: 'SPL-WD-3003', campaignTitle: 'New Borehole for Amaeze Community', creatorName: 'Adaeze Okonkwo', creatorVerification: 'KYB', amountKobo: 120_000_000, availableKobo: 168_300_000, bankLabel: 'GTBank ••• 4821', status: 'PENDING', requestedAt: '2026-06-19T09:05:00Z', riskLevel: 'LOW', note: null },
  { id: 'wd2', reference: 'SPL-WD-3004', campaignTitle: 'Restock My Tailoring Shop After Fire', creatorName: 'Adaeze Okonkwo', creatorVerification: 'KYC', amountKobo: 18_000_000, availableKobo: 41_200_000, bankLabel: 'Access ••• 9930', status: 'PENDING', requestedAt: '2026-06-19T08:20:00Z', riskLevel: 'LOW', note: null },
  { id: 'wd3', reference: 'SPL-WD-3005', campaignTitle: 'Emergency Medical Fund', creatorName: 'Unverified User', creatorVerification: 'EMAIL', amountKobo: 54_000_000, availableKobo: 54_000_000, bankLabel: 'Kuda ••• 1180', status: 'PENDING', requestedAt: '2026-06-19T07:10:00Z', riskLevel: 'HIGH', note: 'Rapid withdrawal request shortly after funding spike.' },
  { id: 'wd4', reference: 'SPL-WD-3002', campaignTitle: 'Christmas Food Drive 2025', creatorName: 'Adaeze Okonkwo', creatorVerification: 'KYB', amountKobo: 30_000_000, availableKobo: 127_800_000, bankLabel: 'Zenith ••• 7740', status: 'PROCESSING', requestedAt: '2026-06-17T14:20:00Z', riskLevel: 'LOW', note: null },
];

const MOCK_FRAUD: CfFraudAlert[] = [
  { id: 'fa1', campaignId: 'rv2', campaignTitle: 'Cryptocurrency Doubling Scheme', creatorName: 'John Doe', riskLevel: 'HIGH', status: 'OPEN', signals: ['Guaranteed-returns language', 'Bank account on 3 other campaigns', 'Unverified creator'], raisedKobo: 0, createdAt: '2026-06-18T20:30:00Z' },
  { id: 'fa2', campaignId: 'my7', campaignTitle: 'Emergency Medical Fund', creatorName: 'Unverified User', riskLevel: 'HIGH', status: 'FROZEN', signals: ['Rapid withdrawal after funding', 'Mismatched KYC/bank name'], raisedKobo: 54_000_000, createdAt: '2026-06-19T07:15:00Z' },
  { id: 'fa3', campaignId: 'rv4', campaignTitle: 'Flood Relief for Bayelsa Families', creatorName: 'Niger Delta Relief Org', riskLevel: 'MEDIUM', status: 'INVESTIGATING', signals: ['Document pending verification'], raisedKobo: 0, createdAt: '2026-06-19T08:00:00Z' },
];

// ─── API ──────────────────────────────────────────────────────────────────────

export async function getPlatformStats(): Promise<CfPlatformStats> {
  if (USE_MOCK) {
    await delay();
    return {
      totalCampaigns: 1_847,
      activeCampaigns: 1_204,
      pendingReview: MOCK_CAMPAIGNS.filter((c) => c.status === 'PENDING_REVIEW').length,
      rejectedCampaigns: 86,
      totalRaisedKobo: 4_812_400_000_00,
      platformRevenueKobo: 120_310_000_00,
      escrowKobo: 642_000_000_00,
      withdrawalsPending: MOCK_WITHDRAWALS.filter((w) => w.status === 'PENDING').length,
      withdrawalsPendingKobo: MOCK_WITHDRAWALS.filter((w) => w.status === 'PENDING').reduce((s, w) => s + w.amountKobo, 0),
      refundRequests: 14,
      fraudAlerts: MOCK_FRAUD.filter((f) => f.status === 'OPEN' || f.status === 'INVESTIGATING').length,
      openTickets: 23,
      paymentSuccessRate: 97.4,
      categoryBreakdown: [
        { category: 'Medical', count: 312, raisedKobo: 1_240_000_000_00 },
        { category: 'Community', count: 142, raisedKobo: 620_000_000_00 },
        { category: 'Education', count: 248, raisedKobo: 540_000_000_00 },
        { category: 'Emergency', count: 64, raisedKobo: 410_000_000_00 },
        { category: 'SME', count: 134, raisedKobo: 380_000_000_00 },
        { category: 'NGO', count: 98, raisedKobo: 360_000_000_00 },
      ],
    };
  }
  const res = await fetch(`${adminBase()}/stats`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Stats failed: ${res.status}`);
  return res.json();
}

export async function listReviewCampaigns(status?: string): Promise<CfReviewCampaign[]> {
  if (USE_MOCK) {
    await delay();
    return status ? MOCK_CAMPAIGNS.filter((c) => c.status === status) : MOCK_CAMPAIGNS;
  }
  const res = await fetch(`${adminBase()}/campaigns?status=${status ?? ''}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Review list failed: ${res.status}`);
  return (await res.json()).campaigns ?? [];
}

export async function getReviewCampaign(id: string): Promise<CfReviewCampaign> {
  if (USE_MOCK) {
    await delay();
    const found = MOCK_CAMPAIGNS.find((c) => c.id === id);
    if (!found) throw new Error('Campaign not found');
    return found;
  }
  const res = await fetch(`${adminBase()}/campaigns/${encodeURIComponent(id)}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Campaign fetch failed: ${res.status}`);
  return res.json();
}

export async function decideCampaign(id: string, decision: CfReviewDecision, note: string): Promise<void> {
  if (USE_MOCK) {
    await delay(500);
    const c = MOCK_CAMPAIGNS.find((x) => x.id === id);
    if (c) {
      c.status =
        decision === 'APPROVE' ? 'ACTIVE'
        : decision === 'REJECT' ? 'REJECTED'
        : decision === 'REQUEST_CHANGES' ? 'CHANGES_REQUESTED'
        : decision === 'FREEZE' ? 'FROZEN'
        : 'ACTIVE';
      c.adminNote = note || c.adminNote;
    }
    return;
  }
  const res = await fetch(`${adminBase()}/campaigns/${encodeURIComponent(id)}/decision`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ decision, note }),
  });
  if (!res.ok) throw new Error(`Decision failed: ${res.status}`);
}

export async function listWithdrawals(status?: string): Promise<CfWithdrawal[]> {
  if (USE_MOCK) {
    await delay();
    return status ? MOCK_WITHDRAWALS.filter((w) => w.status === status) : MOCK_WITHDRAWALS;
  }
  const res = await fetch(`${adminBase()}/withdrawals?status=${status ?? ''}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Withdrawals failed: ${res.status}`);
  return (await res.json()).withdrawals ?? [];
}

export async function decideWithdrawal(id: string, approve: boolean, note: string): Promise<void> {
  if (USE_MOCK) {
    await delay(500);
    const w = MOCK_WITHDRAWALS.find((x) => x.id === id);
    if (w) { w.status = approve ? 'APPROVED' : 'REJECTED'; w.note = note || w.note; }
    return;
  }
  const res = await fetch(`${adminBase()}/withdrawals/${encodeURIComponent(id)}/${approve ? 'approve' : 'reject'}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ note }),
  });
  if (!res.ok) throw new Error(`Withdrawal decision failed: ${res.status}`);
}

export async function listFraudAlerts(): Promise<CfFraudAlert[]> {
  if (USE_MOCK) { await delay(); return MOCK_FRAUD; }
  const res = await fetch(`${adminBase()}/fraud-alerts`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Fraud alerts failed: ${res.status}`);
  return (await res.json()).alerts ?? [];
}

export async function setCampaignFreeze(campaignId: string, freeze: boolean, note: string): Promise<void> {
  if (USE_MOCK) {
    await delay(400);
    const f = MOCK_FRAUD.find((x) => x.campaignId === campaignId);
    if (f) f.status = freeze ? 'FROZEN' : 'INVESTIGATING';
    return;
  }
  const res = await fetch(`${adminBase()}/campaigns/${encodeURIComponent(campaignId)}/${freeze ? 'freeze' : 'unfreeze'}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ note }),
  });
  if (!res.ok) throw new Error(`Freeze failed: ${res.status}`);
}

// ─── Finance ──────────────────────────────────────────────────────────────────

const MOCK_REFUNDS: CfRefundRequest[] = [
  { id: 're1', reference: 'SPL-RF-7001', campaignTitle: 'Flood Relief for Bayelsa Families', contributorName: 'Anonymous', amountKobo: 2_000_000, reason: 'Concerns about how funds are used', status: 'REQUESTED', requestedAt: '2026-06-19T07:30:00Z', refundEligible: true },
  { id: 're2', reference: 'SPL-RF-7002', campaignTitle: 'Àdìre Documentary', contributorName: 'Tunde Bakare', amountKobo: 500_000, reason: 'Contributed by mistake', status: 'REQUESTED', requestedAt: '2026-06-18T22:10:00Z', refundEligible: true },
  { id: 're3', reference: 'SPL-RF-6990', campaignTitle: 'Cryptocurrency Doubling Scheme', contributorName: 'Bola Ighodalo', amountKobo: 5_000_000, reason: 'Campaign turned out to be misleading', status: 'APPROVED', requestedAt: '2026-06-17T14:00:00Z', refundEligible: true },
];

const MOCK_SETTLEMENTS: CfSettlementBatch[] = [
  { id: 'sb1', reference: 'SPL-STL-2026-06-19', payoutCount: 18, grossKobo: 240_000_000, feeKobo: 6_000_000, netKobo: 234_000_000, status: 'PROCESSING', createdAt: '2026-06-19T06:00:00Z' },
  { id: 'sb2', reference: 'SPL-STL-2026-06-18', payoutCount: 31, grossKobo: 412_000_000, feeKobo: 10_300_000, netKobo: 401_700_000, status: 'SETTLED', createdAt: '2026-06-18T06:00:00Z' },
  { id: 'sb3', reference: 'SPL-STL-2026-06-17', payoutCount: 12, grossKobo: 88_000_000, feeKobo: 2_200_000, netKobo: 85_800_000, status: 'SETTLED', createdAt: '2026-06-17T06:00:00Z' },
];

export async function getFinanceSummary(): Promise<CfFinanceSummary> {
  if (USE_MOCK) {
    await delay();
    return {
      gmvKobo: 4_812_400_000_00,
      platformRevenueKobo: 120_310_000_00,
      refundsPendingKobo: MOCK_REFUNDS.filter((r) => r.status === 'REQUESTED').reduce((s, r) => s + r.amountKobo, 0),
      refundsPendingCount: MOCK_REFUNDS.filter((r) => r.status === 'REQUESTED').length,
      chargebacksKobo: 3_400_000,
      chargebacksCount: 2,
      escrowKobo: 642_000_000_00,
      settledThisMonthKobo: 1_204_000_000_00,
      reconciliationMismatches: 1,
    };
  }
  const res = await fetch(`${adminBase()}/finance/summary`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Finance summary failed: ${res.status}`);
  return res.json();
}

export async function listRefunds(status?: string): Promise<CfRefundRequest[]> {
  if (USE_MOCK) { await delay(); return status ? MOCK_REFUNDS.filter((r) => r.status === status) : MOCK_REFUNDS; }
  const res = await fetch(`${adminBase()}/refunds?status=${status ?? ''}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Refunds failed: ${res.status}`);
  return (await res.json()).refunds ?? [];
}

export async function decideRefund(id: string, approve: boolean, note: string): Promise<void> {
  if (USE_MOCK) {
    await delay(500);
    const r = MOCK_REFUNDS.find((x) => x.id === id);
    if (r) r.status = approve ? 'APPROVED' : 'REJECTED';
    return;
  }
  const res = await fetch(`${adminBase()}/refunds/${encodeURIComponent(id)}/${approve ? 'approve' : 'reject'}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ note }),
  });
  if (!res.ok) throw new Error(`Refund decision failed: ${res.status}`);
}

export async function listSettlements(): Promise<CfSettlementBatch[]> {
  if (USE_MOCK) { await delay(); return MOCK_SETTLEMENTS; }
  const res = await fetch(`${adminBase()}/settlements`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Settlements failed: ${res.status}`);
  return (await res.json()).batches ?? [];
}

// ─── Support & disputes ───────────────────────────────────────────────────────

const MOCK_DISPUTES: CfDispute[] = [
  { id: 'dp1', reference: 'SPL-DS-9001', type: 'FAKE_CAMPAIGN', status: 'OPEN', campaignTitle: 'Cryptocurrency Doubling Scheme', campaignId: 'rv2', raisedBy: 'Community report', description: 'Multiple users report this as a guaranteed-returns scam.', createdAt: '2026-06-18T21:00:00Z', slaHoursLeft: 4, resolution: null, adminNote: null },
  { id: 'dp2', reference: 'SPL-DS-9002', type: 'REWARD', status: 'INVESTIGATING', campaignTitle: 'Àdìre Documentary', campaignId: 'cf3', raisedBy: 'Fatima Sani', description: 'Producer-credit reward not delivered 3 weeks after the estimated date.', createdAt: '2026-06-17T10:00:00Z', slaHoursLeft: 20, resolution: null, adminNote: 'Contacted creator for shipping update.' },
  { id: 'dp3', reference: 'SPL-DS-8990', type: 'REFUND', status: 'RESOLVED', campaignTitle: 'Flood Relief for Bayelsa Families', campaignId: 'rv4', raisedBy: 'Anonymous', description: 'Requested refund denied by creator.', createdAt: '2026-06-15T09:00:00Z', slaHoursLeft: 0, resolution: 'REFUND', adminNote: 'Refund issued per campaign policy.' },
];

export async function listDisputes(status?: string): Promise<CfDispute[]> {
  if (USE_MOCK) { await delay(); return status ? MOCK_DISPUTES.filter((d) => d.status === status) : MOCK_DISPUTES; }
  const res = await fetch(`${adminBase()}/disputes?status=${status ?? ''}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Disputes failed: ${res.status}`);
  return (await res.json()).disputes ?? [];
}

export async function resolveDispute(id: string, resolution: CfDisputeResolution, note: string): Promise<void> {
  if (USE_MOCK) {
    await delay(500);
    const d = MOCK_DISPUTES.find((x) => x.id === id);
    if (d) { d.status = 'RESOLVED'; d.resolution = resolution; d.adminNote = note; }
    return;
  }
  const res = await fetch(`${adminBase()}/disputes/${encodeURIComponent(id)}/resolve`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ resolution, note }),
  });
  if (!res.ok) throw new Error(`Resolve failed: ${res.status}`);
}

// ─── Platform configuration ───────────────────────────────────────────────────

const MOCK_CATEGORIES: CfCategoryConfig[] = [
  { id: 'c1', label: 'Medical', slug: 'medical', enabled: true, requiresEnhancedReview: true, campaignCount: 312 },
  { id: 'c2', label: 'Education', slug: 'education', enabled: true, requiresEnhancedReview: false, campaignCount: 248 },
  { id: 'c3', label: 'Community', slug: 'community', enabled: true, requiresEnhancedReview: false, campaignCount: 142 },
  { id: 'c4', label: 'Emergency', slug: 'emergency', enabled: true, requiresEnhancedReview: true, campaignCount: 64 },
  { id: 'c5', label: 'SME', slug: 'sme', enabled: true, requiresEnhancedReview: true, campaignCount: 134 },
  { id: 'c6', label: 'Religious', slug: 'religious', enabled: true, requiresEnhancedReview: false, campaignCount: 87 },
  { id: 'c7', label: 'Investment', slug: 'investment', enabled: false, requiresEnhancedReview: true, campaignCount: 0 },
];

const MOCK_FEES: CfFeeConfig = {
  platformFeeBps: 250, paymentFeeBps: 150, paymentFeeFlatKobo: 10_000,
  minContributionKobo: 10_000, maxContributionKobo: 500_000_000,
};

const MOCK_FLAGS: CfFeatureFlag[] = [
  { key: 'crowdfunding', label: 'Crowdfunding module', description: 'Master switch for the whole module.', enabled: true, locked: false },
  { key: 'reward_campaigns', label: 'Reward-based campaigns', description: 'Allow creators to offer backer rewards.', enabled: true, locked: false },
  { key: 'milestone_funding', label: 'Milestone funding', description: 'Release funds per verified milestone.', enabled: true, locked: false },
  { key: 'corporate_csr', label: 'Corporate CSR / matching', description: 'Sponsor matching donations.', enabled: false, locked: false },
  { key: 'investment', label: 'Investment crowdfunding', description: 'Equity/debt. Requires regulatory licence.', enabled: false, locked: true },
];

export async function getCategories(): Promise<CfCategoryConfig[]> {
  if (USE_MOCK) { await delay(); return MOCK_CATEGORIES; }
  const res = await fetch(`${adminBase()}/config/categories`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Categories failed: ${res.status}`);
  return (await res.json()).categories ?? [];
}

export async function toggleCategory(id: string, field: 'enabled' | 'requiresEnhancedReview', value: boolean): Promise<void> {
  if (USE_MOCK) { await delay(250); const c = MOCK_CATEGORIES.find((x) => x.id === id); if (c) c[field] = value; return; }
  const res = await fetch(`${adminBase()}/config/categories/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ [field]: value }),
  });
  if (!res.ok) throw new Error(`Category update failed: ${res.status}`);
}

export async function getFees(): Promise<CfFeeConfig> {
  if (USE_MOCK) { await delay(); return { ...MOCK_FEES }; }
  const res = await fetch(`${adminBase()}/config/fees`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Fees failed: ${res.status}`);
  return res.json();
}

export async function updateFees(fees: CfFeeConfig): Promise<void> {
  if (USE_MOCK) { await delay(400); Object.assign(MOCK_FEES, fees); return; }
  const res = await fetch(`${adminBase()}/config/fees`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(fees) });
  if (!res.ok) throw new Error(`Fee update failed: ${res.status}`);
}

export async function getFeatureFlags(): Promise<CfFeatureFlag[]> {
  if (USE_MOCK) { await delay(); return MOCK_FLAGS; }
  const res = await fetch(`${adminBase()}/config/flags`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Flags failed: ${res.status}`);
  return (await res.json()).flags ?? [];
}

export async function toggleFeatureFlag(key: string, enabled: boolean): Promise<void> {
  if (USE_MOCK) { await delay(250); const f = MOCK_FLAGS.find((x) => x.key === key); if (f && !f.locked) f.enabled = enabled; return; }
  const res = await fetch(`${adminBase()}/config/flags/${encodeURIComponent(key)}`, {
    method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(`Flag update failed: ${res.status}`);
}

// ─── KYC / KYB ────────────────────────────────────────────────────────────────

const MOCK_KYC: CfKycCase[] = [
  {
    id: 'kc1', kind: 'KYC', status: 'PENDING', applicantName: 'Aisha Bello', applicantType: 'Individual',
    email: 'aisha.bello@example.com', idLabel: 'NIN ••• 4821', bankLabel: 'GTBank ••• 4821',
    submittedAt: '2026-06-18T11:00:00Z', duplicateIdentity: false, duplicateBank: false, riskLevel: 'LOW',
    documents: [
      { id: 'd1', label: 'Government ID (NIN)', type: 'image', verified: true },
      { id: 'd2', label: 'Selfie verification', type: 'image', verified: true },
    ],
  },
  {
    id: 'kc2', kind: 'KYC', status: 'PENDING', applicantName: 'John Doe', applicantType: 'Individual',
    email: 'jd1990@example.com', idLabel: 'NIN ••• 0012', bankLabel: 'Access ••• 0012',
    submittedAt: '2026-06-18T20:30:00Z', duplicateIdentity: true, duplicateBank: true, riskLevel: 'HIGH',
    documents: [{ id: 'd1', label: 'Government ID (NIN)', type: 'image', verified: false }],
  },
  {
    id: 'kc3', kind: 'KYB', status: 'PENDING', applicantName: 'Enugu Codes Initiative', applicantType: 'NGO',
    email: 'hello@enugucodes.org', idLabel: 'RC 1456782', bankLabel: 'Zenith ••• 7740',
    submittedAt: '2026-06-17T09:00:00Z', duplicateIdentity: false, duplicateBank: false, riskLevel: 'LOW',
    documents: [
      { id: 'd1', label: 'CAC registration', type: 'pdf', verified: true },
      { id: 'd2', label: 'Board authorisation letter', type: 'pdf', verified: true },
      { id: 'd3', label: 'Tax document (TIN)', type: 'pdf', verified: false },
    ],
  },
  {
    id: 'kc4', kind: 'KYB', status: 'APPROVED', applicantName: 'Niger Delta Relief Org', applicantType: 'NGO',
    email: 'ops@ndrelief.org', idLabel: 'RC 998120', bankLabel: 'UBA ••• 3318',
    submittedAt: '2026-06-15T10:00:00Z', duplicateIdentity: false, duplicateBank: false, riskLevel: 'LOW',
    documents: [{ id: 'd1', label: 'CAC registration', type: 'pdf', verified: true }],
  },
];

export async function listKycCases(kind?: string, status?: string): Promise<CfKycCase[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_KYC.filter((k) => (!kind || k.kind === kind) && (!status || k.status === status));
  }
  const res = await fetch(`${adminBase()}/kyc?kind=${kind ?? ''}&status=${status ?? ''}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`KYC list failed: ${res.status}`);
  return (await res.json()).cases ?? [];
}

export async function decideKyc(id: string, approve: boolean, note: string): Promise<void> {
  if (USE_MOCK) {
    await delay(500);
    const k = MOCK_KYC.find((x) => x.id === id);
    if (k) k.status = approve ? 'APPROVED' : 'REJECTED';
    return;
  }
  const res = await fetch(`${adminBase()}/kyc/${encodeURIComponent(id)}/${approve ? 'approve' : 'reject'}`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ note }),
  });
  if (!res.ok) throw new Error(`KYC decision failed: ${res.status}`);
}

// ─── Compliance ───────────────────────────────────────────────────────────────

const MOCK_AUDIT: CfAuditLog[] = [
  { id: 'a1', actor: 'admin@spotlight.ng', action: 'campaign.approve', target: 'rv1 · Help Baby Zara', createdAt: '2026-06-19T09:10:00Z', ip: '102.89.x.x' },
  { id: 'a2', actor: 'risk@spotlight.ng', action: 'campaign.freeze', target: 'my7 · Emergency Medical Fund', createdAt: '2026-06-19T07:16:00Z', ip: '102.89.x.x' },
  { id: 'a3', actor: 'finance@spotlight.ng', action: 'withdrawal.approve', target: 'SPL-WD-3001', createdAt: '2026-06-19T06:40:00Z', ip: '197.210.x.x' },
  { id: 'a4', actor: 'admin@spotlight.ng', action: 'campaign.reject', target: 'rv2 · Crypto Doubling Scheme', createdAt: '2026-06-18T21:05:00Z', ip: '102.89.x.x' },
  { id: 'a5', actor: 'compliance@spotlight.ng', action: 'config.fees.update', target: 'platformFeeBps 250→250', createdAt: '2026-06-18T15:00:00Z', ip: '105.112.x.x' },
];

const MOCK_DATA_REQUESTS: CfDataRequest[] = [
  { id: 'dr1', type: 'EXPORT', userName: 'Chidi Okafor', email: 'chidi@example.com', status: 'PENDING', requestedAt: '2026-06-19T08:00:00Z', dueBy: '2026-06-21T08:00:00Z' },
  { id: 'dr2', type: 'DELETION', userName: 'Bola Ighodalo', email: 'bola@example.com', status: 'IN_PROGRESS', requestedAt: '2026-06-17T10:00:00Z', dueBy: '2026-07-17T10:00:00Z' },
  { id: 'dr3', type: 'EXPORT', userName: 'Ngozi Adeyemi', email: 'ngozi@example.com', status: 'COMPLETED', requestedAt: '2026-06-12T12:00:00Z', dueBy: '2026-06-14T12:00:00Z' },
];

export async function getComplianceSummary(): Promise<CfComplianceSummary> {
  if (USE_MOCK) {
    await delay();
    return {
      pendingKyc: MOCK_KYC.filter((k) => k.kind === 'KYC' && k.status === 'PENDING').length,
      pendingKyb: MOCK_KYC.filter((k) => k.kind === 'KYB' && k.status === 'PENDING').length,
      openDataRequests: MOCK_DATA_REQUESTS.filter((d) => d.status !== 'COMPLETED').length,
      investmentEnabled: MOCK_FLAGS.find((f) => f.key === 'investment')?.enabled ?? false,
      retentionPolicyDays: 2555,
      lastRegulatoryExport: '2026-05-31T00:00:00Z',
      auditEventsToday: MOCK_AUDIT.filter((a) => a.createdAt.startsWith('2026-06-19')).length,
    };
  }
  const res = await fetch(`${adminBase()}/compliance/summary`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Compliance summary failed: ${res.status}`);
  return res.json();
}

export async function listAuditLogs(): Promise<CfAuditLog[]> {
  if (USE_MOCK) { await delay(); return MOCK_AUDIT; }
  const res = await fetch(`${adminBase()}/compliance/audit-logs`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Audit logs failed: ${res.status}`);
  return (await res.json()).logs ?? [];
}

export async function listDataRequests(): Promise<CfDataRequest[]> {
  if (USE_MOCK) { await delay(); return MOCK_DATA_REQUESTS; }
  const res = await fetch(`${adminBase()}/compliance/data-requests`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Data requests failed: ${res.status}`);
  return (await res.json()).requests ?? [];
}

export async function fulfilDataRequest(id: string): Promise<void> {
  if (USE_MOCK) { await delay(400); const d = MOCK_DATA_REQUESTS.find((x) => x.id === id); if (d) d.status = 'COMPLETED'; return; }
  const res = await fetch(`${adminBase()}/compliance/data-requests/${encodeURIComponent(id)}/fulfil`, { method: 'POST', headers: authHeaders() });
  if (!res.ok) throw new Error(`Fulfil failed: ${res.status}`);
}

// ─── User & Creator management ────────────────────────────────────────────────

const MOCK_USERS: CfUser[] = [
  {
    id: 'u1', name: 'Aisha Bello', email: 'aisha.bello@example.com', role: 'CREATOR', type: 'Individual',
    verification: 'FULL', status: 'ACTIVE', riskLevel: 'LOW', campaignsCreated: 1, totalRaisedKobo: 1_213_400_000,
    totalContributedKobo: 50_000_000, joinedAt: '2025-01-12T00:00:00Z', lastActiveAt: '2026-06-19T08:00:00Z',
    activity: [
      { id: 'a1', action: 'campaign.create', detail: 'Help Baby Zara Get Open-Heart Surgery', createdAt: '2026-05-20T09:00:00Z' },
      { id: 'a2', action: 'withdrawal.request', detail: 'SPL-WD-3001 · ₦400,000', createdAt: '2026-06-10T10:00:00Z' },
    ],
  },
  {
    id: 'u2', name: 'Adaeze Okonkwo', email: 'adaeze@example.com', role: 'CREATOR', type: 'Individual',
    verification: 'KYC', status: 'ACTIVE', riskLevel: 'LOW', campaignsCreated: 5, totalRaisedKobo: 487_500_000,
    totalContributedKobo: 12_000_000, joinedAt: '2025-03-04T00:00:00Z', lastActiveAt: '2026-06-19T09:30:00Z',
    activity: [
      { id: 'a1', action: 'campaign.create', detail: 'New Borehole for Amaeze Community', createdAt: '2026-04-10T00:00:00Z' },
      { id: 'a2', action: 'campaign.submit', detail: 'Coding Bootcamp Scholarships', createdAt: '2026-06-14T10:00:00Z' },
    ],
  },
  {
    id: 'u3', name: 'John Doe', email: 'jd1990@example.com', role: 'CREATOR', type: 'Individual',
    verification: 'EMAIL', status: 'SUSPENDED', riskLevel: 'HIGH', campaignsCreated: 4, totalRaisedKobo: 0,
    totalContributedKobo: 0, joinedAt: '2026-06-01T00:00:00Z', lastActiveAt: '2026-06-18T20:30:00Z',
    activity: [
      { id: 'a1', action: 'campaign.reject', detail: 'Cryptocurrency Doubling Scheme — policy violation', createdAt: '2026-06-18T21:05:00Z' },
      { id: 'a2', action: 'account.suspend', detail: 'Multiple high-risk campaigns', createdAt: '2026-06-18T21:10:00Z' },
    ],
  },
  {
    id: 'u4', name: 'Niger Delta Relief Org', email: 'ops@ndrelief.org', role: 'ORGANISATION', type: 'NGO',
    verification: 'KYB', status: 'ACTIVE', riskLevel: 'LOW', campaignsCreated: 8, totalRaisedKobo: 2_140_000_000,
    totalContributedKobo: 0, joinedAt: '2024-11-02T00:00:00Z', lastActiveAt: '2026-06-19T07:45:00Z',
    activity: [{ id: 'a1', action: 'campaign.create', detail: 'Flood Relief for Bayelsa Families', createdAt: '2026-06-18T06:00:00Z' }],
  },
  {
    id: 'u5', name: 'Chidi Okafor', email: 'chidi@example.com', role: 'CONTRIBUTOR', type: 'Individual',
    verification: 'KYC', status: 'ACTIVE', riskLevel: 'LOW', campaignsCreated: 0, totalRaisedKobo: 0,
    totalContributedKobo: 8_400_000, joinedAt: '2025-09-18T00:00:00Z', lastActiveAt: '2026-06-19T08:10:00Z',
    activity: [{ id: 'a1', action: 'contribution.create', detail: '₦5,000 to Help Baby Zara', createdAt: '2026-06-19T08:10:00Z' }],
  },
];

export async function listUsers(role?: string, status?: string, search?: string): Promise<CfUser[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_USERS.filter((u) =>
      (!role || u.role === role) &&
      (!status || u.status === status) &&
      (!search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())),
    );
  }
  const res = await fetch(`${adminBase()}/users?role=${role ?? ''}&status=${status ?? ''}&search=${encodeURIComponent(search ?? '')}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(`Users failed: ${res.status}`);
  return (await res.json()).users ?? [];
}

export async function setUserStatus(id: string, status: 'ACTIVE' | 'SUSPENDED' | 'RESTRICTED', note: string): Promise<void> {
  if (USE_MOCK) {
    await delay(500);
    const u = MOCK_USERS.find((x) => x.id === id);
    if (u) {
      u.status = status;
      u.activity = [{ id: `a${Date.now()}`, action: status === 'SUSPENDED' ? 'account.suspend' : status === 'ACTIVE' ? 'account.restore' : 'account.restrict', detail: note || '—', createdAt: new Date().toISOString() }, ...u.activity];
    }
    return;
  }
  const res = await fetch(`${adminBase()}/users/${encodeURIComponent(id)}/status`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ status, note }) });
  if (!res.ok) throw new Error(`Status update failed: ${res.status}`);
}
