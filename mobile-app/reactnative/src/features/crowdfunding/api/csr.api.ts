// ── Crowdfunding — Corporate CSR (Section M) data layer ──────────────────────
// Mock-backed. Money in kobo. Module entry gated by CSR_ENABLED.

import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  CsrProfile,
  MatchableCampaign,
  CsrMatch,
  MatchSetupInput,
  CsrInvoice,
  CsrImpactSummary,
  EmployeeGivingCampaign,
} from '../types/csr.types';

const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_CF_USE_MOCK, true);
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));

const PROFILE: CsrProfile = {
  companyName: 'Paymax Foundation',
  verified: true,
  annualBudgetKobo: 5_000_000_000,
  committedKobo: 1_850_000_000,
  matchedKobo: 1_240_000_000,
  campaignsSupported: 14,
  employeesGiving: 86,
};

const CAMPAIGNS: MatchableCampaign[] = [
  { id: 'cf1', title: 'Help Baby Zara Get Open-Heart Surgery', category: 'Medical', coverImage: 'https://images.unsplash.com/photo-1576765608535-5f04d1e3f289?w=600&q=80', raisedKobo: 1_213_400_000, goalKobo: 1_850_000_000, contributorCount: 1842, verified: true, impactTag: 'Health' },
  { id: 'cf2', title: 'STEM Labs for 5 Rural Schools', category: 'Education', coverImage: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=600&q=80', raisedKobo: 420_000_000, goalKobo: 900_000_000, contributorCount: 312, verified: true, impactTag: 'Education' },
  { id: 'cf4', title: 'Flood Relief for Bayelsa Families', category: 'Emergency', coverImage: 'https://images.unsplash.com/photo-1547683905-f686c993aae5?w=600&q=80', raisedKobo: 180_000_000, goalKobo: 300_000_000, contributorCount: 540, verified: true, impactTag: 'Relief' },
  { id: 'cf7', title: 'Mangrove Replanting — Niger Delta', category: 'Community', coverImage: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=600&q=80', raisedKobo: 96_000_000, goalKobo: 250_000_000, contributorCount: 210, verified: true, impactTag: 'Environment' },
];

let MATCHES: CsrMatch[] = [
  { id: 'm1', campaignId: 'cf1', campaignTitle: 'Help Baby Zara Get Open-Heart Surgery', ratio: '1:1', capKobo: 500_000_000, matchedKobo: 312_000_000, status: 'ACTIVE', startedAt: '2026-06-10T00:00:00Z', visibility: 'PUBLIC' },
  { id: 'm2', campaignId: 'cf2', campaignTitle: 'STEM Labs for 5 Rural Schools', ratio: '2:1', capKobo: 300_000_000, matchedKobo: 300_000_000, status: 'COMPLETED', startedAt: '2026-05-20T00:00:00Z', visibility: 'PUBLIC' },
  { id: 'm3', campaignId: 'cf4', campaignTitle: 'Flood Relief for Bayelsa Families', ratio: '1:1', capKobo: 200_000_000, matchedKobo: 0, status: 'PENDING_APPROVAL', startedAt: '2026-06-19T00:00:00Z', visibility: 'ANONYMOUS' },
];

const INVOICES: CsrInvoice[] = [
  { id: 'iv1', reference: 'SPL-CSR-INV-2025', description: 'CSR matching — STEM Labs', amountKobo: 300_000_000, vatKobo: 22_500_000, totalKobo: 322_500_000, status: 'PAID', issuedAt: '2026-05-31T00:00:00Z' },
  { id: 'iv2', reference: 'SPL-CSR-INV-2026', description: 'CSR matching — Baby Zara', amountKobo: 312_000_000, vatKobo: 23_400_000, totalKobo: 335_400_000, status: 'DUE', issuedAt: '2026-06-15T00:00:00Z' },
];

const EMPLOYEE_GIVING: EmployeeGivingCampaign = {
  id: 'eg1', title: 'Paymax Staff Giving Drive 2026', goalKobo: 200_000_000, raisedKobo: 134_000_000, participants: 86, endsAt: '2026-08-31T23:59:59Z', companyMatchRatio: '1:1',
};

// ─── API ──────────────────────────────────────────────────────────────────────

export async function getCsrProfile(): Promise<CsrProfile> {
  if (USE_MOCK) { await delay(180); return { ...PROFILE }; }
  const res = await api.get('/api/v1/crowdfunding/csr/profile');
  return res.data?.data ?? res.data;
}

export async function getMatchableCampaigns(): Promise<MatchableCampaign[]> {
  if (USE_MOCK) { await delay(); return CAMPAIGNS; }
  const res = await api.get('/api/v1/crowdfunding/csr/campaigns');
  return res.data?.data ?? res.data;
}

export async function getMatchableCampaign(id: string): Promise<MatchableCampaign> {
  if (USE_MOCK) {
    await delay();
    const c = CAMPAIGNS.find((x) => x.id === id);
    if (!c) throw new Error('Campaign not found');
    return c;
  }
  const res = await api.get(`/api/v1/crowdfunding/csr/campaigns/${id}`);
  return res.data?.data ?? res.data;
}

export async function getMatches(): Promise<CsrMatch[]> {
  if (USE_MOCK) { await delay(); return [...MATCHES].sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt)); }
  const res = await api.get('/api/v1/crowdfunding/csr/matches');
  return res.data?.data ?? res.data;
}

export async function setupMatch(input: MatchSetupInput): Promise<CsrMatch> {
  if (USE_MOCK) {
    await delay(700);
    const campaign = CAMPAIGNS.find((c) => c.id === input.campaignId)!;
    const match: CsrMatch = {
      id: `m${Date.now()}`, campaignId: input.campaignId, campaignTitle: campaign.title, ratio: input.ratio,
      capKobo: input.capKobo, matchedKobo: 0, status: 'PENDING_APPROVAL', startedAt: new Date().toISOString(), visibility: input.visibility,
    };
    MATCHES = [match, ...MATCHES];
    return match;
  }
  const res = await api.post('/api/v1/crowdfunding/csr/matches', input, { headers: { 'Idempotency-Key': generateIdempotencyKey() } });
  return res.data?.data ?? res.data;
}

export async function approveMatch(matchId: string): Promise<void> {
  if (USE_MOCK) { await delay(500); const m = MATCHES.find((x) => x.id === matchId); if (m) m.status = 'ACTIVE'; return; }
  await api.post(`/api/v1/crowdfunding/csr/matches/${matchId}/approve`);
}

export async function getInvoices(): Promise<CsrInvoice[]> {
  if (USE_MOCK) { await delay(); return INVOICES; }
  const res = await api.get('/api/v1/crowdfunding/csr/invoices');
  return res.data?.data ?? res.data;
}

export async function getImpactSummary(): Promise<CsrImpactSummary> {
  if (USE_MOCK) {
    await delay();
    return {
      totalMatchedKobo: PROFILE.matchedKobo,
      livesImpacted: 12_400,
      campaignsSupported: PROFILE.campaignsSupported,
      topCategory: 'Health',
      byCategory: [
        { category: 'Health', matchedKobo: 612_000_000 },
        { category: 'Education', matchedKobo: 300_000_000 },
        { category: 'Relief', matchedKobo: 220_000_000 },
        { category: 'Environment', matchedKobo: 108_000_000 },
      ],
      monthly: [
        { month: 'Feb', matchedKobo: 80_000_000 },
        { month: 'Mar', matchedKobo: 140_000_000 },
        { month: 'Apr', matchedKobo: 220_000_000 },
        { month: 'May', matchedKobo: 380_000_000 },
        { month: 'Jun', matchedKobo: 420_000_000 },
      ],
    };
  }
  const res = await api.get('/api/v1/crowdfunding/csr/impact');
  return res.data?.data ?? res.data;
}

export async function getEmployeeGiving(): Promise<EmployeeGivingCampaign> {
  if (USE_MOCK) { await delay(); return EMPLOYEE_GIVING; }
  const res = await api.get('/api/v1/crowdfunding/csr/employee-giving');
  return res.data?.data ?? res.data;
}
