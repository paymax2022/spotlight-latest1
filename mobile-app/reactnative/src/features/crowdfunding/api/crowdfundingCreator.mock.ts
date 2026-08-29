// ── Crowdfunding — Creator mock dataset ──────────────────────────────────────
// "My" campaigns across all lifecycle statuses + dashboard stats, withdrawals,
// notifications and per-campaign analytics. All money in kobo.

import type {
  Campaign,
  CreatorStats,
  CreatorContribution,
  CreatorWithdrawal,
  CreatorNotification,
  CampaignAnalytics,
} from '../types/crowdfunding.types';

const me = {
  id: 'me',
  name: 'Adaeze Okonkwo',
  type: 'INDIVIDUAL' as const,
  avatarUrl: null,
  verification: 'KYC' as const,
  location: 'Enugu, Nigeria',
  campaignsCreated: 5,
  totalRaisedKobo: 487_500_000,
  bio: 'Community organiser and small-business owner.',
  joinedAt: '2025-03-04T00:00:00Z',
};

const base = (over: Partial<Campaign> & Pick<Campaign, 'id' | 'title' | 'status'>): Campaign => ({
  summary: '',
  story: '',
  type: 'DONATION',
  category: 'community',
  categoryLabel: 'Community',
  coverImage: null,
  media: [],
  goalKobo: 100_000_000,
  raisedKobo: 0,
  currency: 'NGN',
  contributorCount: 0,
  deadline: null,
  createdAt: '2026-05-01T00:00:00Z',
  creator: me,
  beneficiary: null,
  disbursementModel: 'IMMEDIATE',
  refundPolicy: 'Standard refund policy applies.',
  riskDisclosure: null,
  verified: false,
  featured: false,
  trending: false,
  urgent: false,
  saved: false,
  paused: false,
  budget: [],
  milestones: [],
  updates: [],
  rewardTiers: [],
  documents: [],
  faqs: [],
  tags: [],
  location: 'Enugu, Nigeria',
  ...over,
});

export const MOCK_MY_CAMPAIGNS: Campaign[] = [
  base({
    id: 'my1', title: 'New Borehole for Amaeze Community', status: 'ACTIVE',
    summary: 'Clean water for 400 households in Amaeze.', categoryLabel: 'Community', category: 'community',
    coverImage: 'https://images.unsplash.com/photo-1538300342682-cf57afb97285?w=800&q=80',
    goalKobo: 250_000_000, raisedKobo: 168_300_000, contributorCount: 412, deadline: '2026-09-01T23:59:59Z',
    verified: true, featured: true,
  }),
  base({
    id: 'my2', title: 'Restock My Tailoring Shop After Fire', status: 'ACTIVE',
    summary: 'Rebuilding my livelihood after a market fire.', categoryLabel: 'SME', category: 'sme', type: 'SME',
    coverImage: 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=800&q=80',
    goalKobo: 80_000_000, raisedKobo: 41_200_000, contributorCount: 96, deadline: '2026-07-20T23:59:59Z',
    // ACTIVE *and* paused — the orthogonal case the status union cannot express.
    paused: true,
  }),
  base({
    id: 'my3', title: 'Annual Coding Bootcamp Scholarships', status: 'PENDING_REVIEW',
    summary: '20 scholarships for young developers in Enugu.', categoryLabel: 'Education', category: 'education',
    coverImage: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&q=80',
    goalKobo: 150_000_000, raisedKobo: 0, contributorCount: 0,
  }),
  base({
    id: 'my4', title: 'Christmas Food Drive 2025', status: 'COMPLETED',
    summary: 'Fed 1,200 families last December.', categoryLabel: 'NGO', category: 'ngo', type: 'COMMUNITY',
    coverImage: 'https://images.unsplash.com/photo-1593113598332-cd288d649433?w=800&q=80',
    goalKobo: 120_000_000, raisedKobo: 127_800_000, contributorCount: 631, deadline: '2025-12-20T23:59:59Z',
    verified: true,
  }),
  base({
    id: 'my5', title: 'Community Hall Roof Repair', status: 'DRAFT',
    summary: 'Draft — not yet submitted.', categoryLabel: 'Community', category: 'community',
    goalKobo: 60_000_000, raisedKobo: 0, contributorCount: 0,
  }),
  base({
    id: 'my6', title: 'Cryptocurrency Doubling Scheme', status: 'REJECTED',
    summary: 'Rejected for policy violation.', categoryLabel: 'SME', category: 'sme',
    goalKobo: 500_000_000, raisedKobo: 0, contributorCount: 0,
    riskDisclosure: 'Rejected: prohibited campaign category (guaranteed returns).',
  }),
  base({
    id: 'my7', title: 'Emergency Medical Fund (Under Review)', status: 'FROZEN',
    summary: 'Temporarily frozen pending document verification.', categoryLabel: 'Medical', category: 'medical',
    coverImage: 'https://images.unsplash.com/photo-1631815588090-d4bfec5b1ccb?w=800&q=80',
    goalKobo: 200_000_000, raisedKobo: 54_000_000, contributorCount: 143,
  }),
];

export const MOCK_CREATOR_STATS: CreatorStats = {
  totalRaisedKobo: 391_300_000,
  contributorCount: 1_282,
  activeCampaigns: 2,
  totalCampaigns: MOCK_MY_CAMPAIGNS.length,
  availableBalanceKobo: 96_400_000,
  pendingBalanceKobo: 22_800_000,
  escrowBalanceKobo: 54_000_000,
  viewsThisWeek: 8_412,
  conversionRate: 6.4,
};

export const MOCK_CREATOR_CONTRIBUTIONS: CreatorContribution[] = [
  { id: 'rc1', contributorName: 'Chidi Okafor', campaignTitle: 'New Borehole for Amaeze Community', amountKobo: 500_000, createdAt: '2026-06-19T08:10:00Z', anonymous: false },
  { id: 'rc2', contributorName: 'Anonymous', campaignTitle: 'New Borehole for Amaeze Community', amountKobo: 2_000_000, createdAt: '2026-06-19T06:42:00Z', anonymous: true },
  { id: 'rc3', contributorName: 'Ngozi Adeyemi', campaignTitle: 'Restock My Tailoring Shop After Fire', amountKobo: 250_000, createdAt: '2026-06-18T21:15:00Z', anonymous: false },
  { id: 'rc4', contributorName: 'Tunde Bakare', campaignTitle: 'New Borehole for Amaeze Community', amountKobo: 1_000_000, createdAt: '2026-06-18T18:03:00Z', anonymous: false },
  { id: 'rc5', contributorName: 'Anonymous', campaignTitle: 'Restock My Tailoring Shop After Fire', amountKobo: 750_000, createdAt: '2026-06-18T12:30:00Z', anonymous: true },
];

export const MOCK_CREATOR_WITHDRAWALS: CreatorWithdrawal[] = [
  { id: 'w1', reference: 'SPL-WD-3001', campaignTitle: 'New Borehole for Amaeze Community', amountKobo: 40_000_000, status: 'COMPLETED', bankLabel: 'GTBank ••• 4821', requestedAt: '2026-06-10T10:00:00Z', note: null },
  { id: 'w2', reference: 'SPL-WD-3002', campaignTitle: 'Restock My Tailoring Shop After Fire', amountKobo: 18_000_000, status: 'PROCESSING', bankLabel: 'Access ••• 9930', requestedAt: '2026-06-17T14:20:00Z', note: null },
  { id: 'w3', reference: 'SPL-WD-3003', campaignTitle: 'New Borehole for Amaeze Community', amountKobo: 12_000_000, status: 'PENDING', bankLabel: 'GTBank ••• 4821', requestedAt: '2026-06-19T09:05:00Z', note: 'Awaiting admin approval' },
  { id: 'w4', reference: 'SPL-WD-2990', campaignTitle: 'Christmas Food Drive 2025', amountKobo: 30_000_000, status: 'REJECTED', bankLabel: 'Zenith ••• 1102', requestedAt: '2025-12-22T11:00:00Z', note: 'Mismatched account name — please re-verify bank details.' },
];

export const MOCK_CREATOR_NOTIFICATIONS: CreatorNotification[] = [
  { id: 'n1', type: 'CONTRIBUTION', title: 'New contribution', body: 'Chidi Okafor gave ₦5,000 to “New Borehole for Amaeze Community”.', createdAt: '2026-06-19T08:10:00Z', read: false },
  { id: 'n2', type: 'GOAL_MILESTONE', title: '50% funded! 🎉', body: '“New Borehole” has passed half of its ₦2,500,000 goal.', createdAt: '2026-06-18T20:00:00Z', read: false },
  { id: 'n3', type: 'WITHDRAWAL', title: 'Withdrawal processing', body: 'Your ₦180,000 withdrawal is being processed to Access ••• 9930.', createdAt: '2026-06-17T14:25:00Z', read: true },
  { id: 'n4', type: 'CHANGES_REQUESTED', title: 'Changes requested', body: 'Admin asked for clearer budget details on “Coding Bootcamp Scholarships”.', createdAt: '2026-06-16T09:30:00Z', read: true },
  { id: 'n5', type: 'CAMPAIGN_REJECTED', title: 'Campaign rejected', body: '“Cryptocurrency Doubling Scheme” was rejected for a policy violation.', createdAt: '2026-06-14T15:00:00Z', read: true },
  { id: 'n6', type: 'CAMPAIGN_APPROVED', title: 'Campaign approved', body: '“New Borehole for Amaeze Community” is now live!', createdAt: '2026-05-20T10:00:00Z', read: true },
];

export function buildAnalytics(campaign: Campaign): CampaignAnalytics {
  const seed = campaign.id.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const days = Array.from({ length: 7 }).map((_, i) => {
    const date = new Date(Date.now() - (6 - i) * 86_400_000);
    const raised = Math.round((campaign.raisedKobo / 7) * (0.6 + ((seed + i) % 5) / 6));
    return { date: date.toISOString(), raisedKobo: raised };
  });
  return {
    campaignId: campaign.id,
    views: 1200 + (seed % 9) * 640,
    shares: 80 + (seed % 7) * 22,
    conversionRate: Number((4 + (seed % 5)).toFixed(1)),
    averageContributionKobo: campaign.contributorCount > 0 ? Math.round(campaign.raisedKobo / campaign.contributorCount) : 0,
    dailyRaised: days,
    trafficSources: [
      { source: 'WhatsApp', visits: 1840 + (seed % 6) * 120, contributions: 142 },
      { source: 'Direct link', visits: 980, contributions: 88 },
      { source: 'Facebook', visits: 620, contributions: 41 },
      { source: 'X (Twitter)', visits: 410, contributions: 26 },
      { source: 'Spotlight feed', visits: 320, contributions: 35 },
    ],
  };
}
