// ── Crowdfunding — API wrapper ───────────────────────────────────────────────
// Typed data layer the screens code against. Mirrors voting.api.ts: mock-flagged,
// flip USE_MOCK to false once the real /crowdfunding endpoints land.
// IRON RULE: all monetary amounts are integers in minor units (kobo).

import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';
import type {
  Campaign,
  CampaignSummary,
  CampaignCategory,
  CampaignQuery,
  Contribution,
  ContributionDraft,
  InitiateContributionResult,
  Contributor,
  CreatorStats,
  CreatorContribution,
  CreatorWithdrawal,
  CreatorNotification,
  CampaignAnalytics,
  CampaignDraftInput,
  SubmitCampaignResult,
} from '../types/crowdfunding.types';
import {
  MOCK_MY_CAMPAIGNS,
  MOCK_CREATOR_STATS,
  MOCK_CREATOR_CONTRIBUTIONS,
  MOCK_CREATOR_WITHDRAWALS,
  MOCK_CREATOR_NOTIFICATIONS,
  buildAnalytics,
} from './crowdfundingCreator.mock';
import { CAMPAIGN_CATEGORIES, INVESTMENT_ENABLED } from '../constants/crowdfunding.constants';
import {
  MOCK_CAMPAIGNS,
  MOCK_CONTRIBUTIONS,
  MOCK_RECENTLY_VIEWED,
} from './crowdfunding.mock';

// ─── Feature flag ─────────────────────────────────────────────────────────────
// Mock is the default. Set EXPO_PUBLIC_CF_USE_MOCK=false to hit the live backend
// (Next.js proxy at /api/v1/crowdfunding/* → Go /api/finance/crowdfunding/*).
const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_CF_USE_MOCK, true);

// Base path of the crowdfunding proxy on the frontend-web Next.js server.
const LIVE = '/api/v1/crowdfunding';

/** Simulated network latency so loading states render in mock mode. */
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));

// ─── Mapping helpers ──────────────────────────────────────────────────────────

function toSummary(c: Campaign): CampaignSummary {
  return {
    id: c.id,
    title: c.title,
    summary: c.summary,
    type: c.type,
    status: c.status,
    category: c.category,
    categoryLabel: c.categoryLabel,
    coverImage: c.coverImage,
    goalKobo: c.goalKobo,
    raisedKobo: c.raisedKobo,
    currency: c.currency,
    contributorCount: c.contributorCount,
    deadline: c.deadline,
    verified: c.verified,
    featured: c.featured,
    trending: c.trending,
    urgent: c.urgent,
    saved: c.saved,
    location: c.location,
    creatorName: c.creator.name,
    creatorType: c.creator.type,
    creatorVerification: c.creator.verification,
  };
}

function sortCampaigns(list: Campaign[], sort?: CampaignQuery['sort']): Campaign[] {
  const out = [...list];
  switch (sort) {
    case 'newest':
      return out.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    case 'ending_soon':
      return out.sort((a, b) => {
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return +new Date(a.deadline) - +new Date(b.deadline);
      });
    case 'most_funded':
      return out.sort((a, b) => b.raisedKobo - a.raisedKobo);
    case 'least_funded':
      return out.sort((a, b) => a.raisedKobo / a.goalKobo - b.raisedKobo / b.goalKobo);
    case 'trending':
      return out.sort((a, b) => Number(b.trending) - Number(a.trending) || b.contributorCount - a.contributorCount);
    case 'recommended':
    default:
      return out.sort(
        (a, b) =>
          Number(b.verified) - Number(a.verified) ||
          Number(b.featured) - Number(a.featured) ||
          b.contributorCount - a.contributorCount,
      );
  }
}

function applyQuery(list: Campaign[], q?: CampaignQuery): Campaign[] {
  let out = [...list];

  // Investment campaigns are hidden until the feature flag is licensed on.
  if (!INVESTMENT_ENABLED) out = out.filter((c) => c.type !== 'INVESTMENT');

  if (q?.collection === 'featured') out = out.filter((c) => c.featured);
  if (q?.collection === 'trending') out = out.filter((c) => c.trending);
  if (q?.collection === 'urgent')   out = out.filter((c) => c.urgent);
  if (q?.collection === 'verified') out = out.filter((c) => c.verified);
  if (q?.collection === 'recent')   out = out.filter((c) => c.status === 'ACTIVE');

  if (q?.category)     out = out.filter((c) => c.category === q.category);
  if (q?.type)         out = out.filter((c) => c.type === q.type);
  if (q?.verifiedOnly) out = out.filter((c) => c.verified);
  if (q?.urgentOnly)   out = out.filter((c) => c.urgent);
  if (q?.status)       out = out.filter((c) => c.status === q.status);
  if (q?.location)     out = out.filter((c) => (c.location ?? '').toLowerCase().includes(q.location!.toLowerCase()));
  if (typeof q?.minProgress === 'number') {
    out = out.filter((c) => (c.goalKobo > 0 ? (c.raisedKobo / c.goalKobo) * 100 : 0) >= q.minProgress!);
  }

  if (q?.search) {
    const term = q.search.toLowerCase().trim();
    out = out.filter(
      (c) =>
        c.title.toLowerCase().includes(term) ||
        c.summary.toLowerCase().includes(term) ||
        c.categoryLabel.toLowerCase().includes(term) ||
        c.creator.name.toLowerCase().includes(term) ||
        (c.location ?? '').toLowerCase().includes(term) ||
        c.tags.some((t) => t.toLowerCase().includes(term)),
    );
  }

  return sortCampaigns(out, q?.sort);
}

// ─── Categories ────────────────────────────────────────────────────────────────

export async function getCategories(): Promise<CampaignCategory[]> {
  if (USE_MOCK) {
    await delay(120);
    return INVESTMENT_ENABLED
      ? CAMPAIGN_CATEGORIES
      : CAMPAIGN_CATEGORIES.filter((c) => c.slug !== 'investment');
  }
  const res = await api.get(`${LIVE}/categories`);
  return (res.data?.data ?? res.data) as CampaignCategory[];
}

// ─── Discovery / list ────────────────────────────────────────────────────────

export async function getCampaigns(query?: CampaignQuery): Promise<CampaignSummary[]> {
  if (USE_MOCK) {
    await delay();
    return applyQuery(MOCK_CAMPAIGNS, query).map(toSummary);
  }
  const res = await api.get(`${LIVE}/campaigns`, { params: query });
  return (res.data?.data ?? res.data) as CampaignSummary[];
}

export async function getCampaign(id: string): Promise<Campaign> {
  if (USE_MOCK) {
    await delay();
    const found = MOCK_CAMPAIGNS.find((c) => c.id === id);
    if (!found) throw new Error('Campaign not found');
    return found;
  }
  const res = await api.get(`${LIVE}/campaigns/${id}`);
  return (res.data?.data ?? res.data) as Campaign;
}

export async function getSavedCampaigns(): Promise<CampaignSummary[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_CAMPAIGNS.filter((c) => c.saved).map(toSummary);
  }
  const res = await api.get('/api/v1/crowdfunding/saved-campaigns');
  return (res.data?.data ?? res.data) as CampaignSummary[];
}

export async function getRecentlyViewed(): Promise<CampaignSummary[]> {
  if (USE_MOCK) {
    await delay(160);
    return MOCK_RECENTLY_VIEWED
      .map((id) => MOCK_CAMPAIGNS.find((c) => c.id === id))
      .filter((c): c is Campaign => Boolean(c))
      .map(toSummary);
  }
  const res = await api.get('/api/v1/crowdfunding/recently-viewed');
  return (res.data?.data ?? res.data) as CampaignSummary[];
}

/** Optimistic toggle in mock mode; real impl POST/DELETE /saves. */
/**
 * Record a VIEW or SHARE against a campaign.
 *
 * These events are what make the creator performance screen's Views, Shares,
 * Conversion and traffic-source figures real — before this existed the backend
 * derived them from a hash of the campaign id.
 *
 * Deliberately FIRE-AND-FORGET: analytics must never break or delay what the
 * user actually asked for, so the promise always resolves and failures are
 * swallowed rather than surfaced. It is also skipped entirely in mock mode so a
 * mock session never writes to a real analytics table.
 */
export async function recordCampaignEvent(
  id: string,
  type: 'VIEW' | 'SHARE',
  source = 'direct',
): Promise<void> {
  if (USE_MOCK || !id) return;
  try {
    await api.post(`/api/v1/crowdfunding/campaigns/${id}/events`, { type, source });
  } catch {
    // Analytics is best-effort — never surface this to the user.
  }
}

export async function toggleSaveCampaign(id: string, saved: boolean): Promise<{ id: string; saved: boolean }> {
  if (USE_MOCK) {
    await delay(120);
    const found = MOCK_CAMPAIGNS.find((c) => c.id === id);
    if (found) found.saved = saved;
    return { id, saved };
  }
  const res = saved
    ? await api.post(`/api/v1/crowdfunding/campaigns/${id}/save`)
    : await api.delete(`/api/v1/crowdfunding/campaigns/${id}/save`);
  return res.data?.data ?? res.data;
}

// ─── Contributors (per campaign) ──────────────────────────────────────────────

const SAMPLE_NAMES = [
  'Chidi Okafor', 'Ngozi Adeyemi', 'Tunde Bakare', 'Fatima Sani', 'Emeka Nwosu',
  'Bola Ighodalo', 'Yusuf Lawal', 'Amaka Eze', 'Seyi Ogunleye', 'Halima Bello',
  'Ifeoma Nnaji', 'Gbenga Falana', 'Zainab Musa', 'Obinna Uche', 'Kemi Alabi',
];
const SAMPLE_MESSAGES = [
  'Praying for a speedy recovery 🙏', 'God bless this cause.', null, 'Happy to support!',
  'Wishing you all the best.', null, 'Every little helps. Stay strong.', null,
  'Sharing with my friends too.', 'Proud to be a backer of this.',
];

/** Deterministic mock contributor list seeded from the campaign id. */
export async function getCampaignContributors(id: string): Promise<Contributor[]> {
  if (USE_MOCK) {
    await delay();
    const campaign = MOCK_CAMPAIGNS.find((c) => c.id === id);
    const total = Math.min(12, campaign?.contributorCount ?? 8);
    const seed = id.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
    return Array.from({ length: total }).map((_, i) => {
      const idx = (seed + i * 7) % SAMPLE_NAMES.length;
      const anonymous = (seed + i) % 5 === 0;
      const amounts = [50_000, 100_000, 200_000, 500_000, 1_000_000, 2_500_000];
      return {
        id: `${id}-c${i}`,
        displayName: SAMPLE_NAMES[idx],
        avatarUrl: null,
        amountKobo: amounts[(seed + i * 3) % amounts.length],
        message: SAMPLE_MESSAGES[(seed + i * 2) % SAMPLE_MESSAGES.length],
        anonymous,
        createdAt: new Date(Date.now() - i * 5_400_000).toISOString(),
      };
    });
  }
  const res = await api.get(`/api/v1/crowdfunding/campaigns/${id}/contributors`);
  return (res.data?.data ?? res.data) as Contributor[];
}

// ─── Contributions ────────────────────────────────────────────────────────────

export async function getContributions(params?: { status?: string }): Promise<Contribution[]> {
  if (USE_MOCK) {
    await delay();
    let list = [...MOCK_CONTRIBUTIONS];
    if (params?.status) list = list.filter((c) => c.status === params.status);
    return list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  const res = await api.get('/api/v1/crowdfunding/contributions', { params });
  return (res.data?.data ?? res.data) as Contribution[];
}

export async function getContribution(id: string): Promise<Contribution> {
  if (USE_MOCK) {
    await delay();
    const found = MOCK_CONTRIBUTIONS.find((c) => c.id === id || c.reference === id);
    if (!found) throw new Error('Contribution not found');
    return found;
  }
  const res = await api.get(`/api/v1/crowdfunding/contributions/${id}`);
  return (res.data?.data ?? res.data) as Contribution;
}

/**
 * Initiate a contribution. Every money mutation requires an Idempotency-Key
 * (iron rule). In mock mode we simulate the provider handshake.
 */
export async function initiateContribution(
  draft: ContributionDraft,
  idempotencyKey: string,
): Promise<InitiateContributionResult> {
  if (USE_MOCK) {
    await delay(900);
    return {
      reference: `SPL-CF-${Date.now()}`,
      status: draft.paymentMethod === 'BANK_TRANSFER' || draft.paymentMethod === 'USSD' ? 'PENDING' : 'PROCESSING',
      authorizationUrl: draft.paymentMethod === 'CARD' ? 'https://checkout.paystack.com/mock' : undefined,
    };
  }
  // Live: contribute against the campaign's escrow endpoint (Go: campaigns/:id/contribute).
  const res = await api.post(
    `${LIVE}/campaigns/${draft.campaignId}/contribute`,
    { amount_kobo: draft.amountKobo, idempotency_key: idempotencyKey },
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
  return res.data?.data ?? res.data;
}

export async function verifyContribution(reference: string): Promise<Contribution> {
  if (USE_MOCK) {
    await delay(700);
    return {
      id: reference,
      reference,
      campaignId: 'cf1',
      campaignTitle: 'Help Baby Zara Get Open-Heart Surgery',
      campaignCover: null,
      amountKobo: 500_000,
      feeKobo: 12_500,
      totalKobo: 512_500,
      currency: 'NGN',
      status: 'SUCCESSFUL',
      paymentMethod: 'WALLET',
      anonymous: false,
      message: null,
      rewardTierTitle: null,
      createdAt: new Date().toISOString(),
      refundEligible: true,
    };
  }
  const res = await api.post('/api/v1/crowdfunding/contributions/verify', { reference });
  return res.data?.data ?? res.data;
}

export async function requestRefund(contributionId: string, reason: string): Promise<{ status: string }> {
  if (USE_MOCK) {
    await delay(500);
    const found = MOCK_CONTRIBUTIONS.find((c) => c.id === contributionId);
    if (found) found.status = 'REFUND_REQUESTED';
    return { status: 'REFUND_REQUESTED' };
  }
  const res = await api.post(`/api/v1/crowdfunding/contributions/${contributionId}/refund-request`, { reason });
  return res.data?.data ?? res.data;
}

// ─── Creator dashboard (Section F) ────────────────────────────────────────────

export async function getCreatorStats(): Promise<CreatorStats> {
  if (USE_MOCK) { await delay(200); return MOCK_CREATOR_STATS; }
  const res = await api.get('/api/v1/crowdfunding/creator/stats');
  return (res.data?.data ?? res.data) as CreatorStats;
}

export async function getMyCampaigns(status?: string): Promise<Campaign[]> {
  if (USE_MOCK) {
    await delay();
    return status ? MOCK_MY_CAMPAIGNS.filter((c) => c.status === status) : MOCK_MY_CAMPAIGNS;
  }
  const res = await api.get('/api/v1/crowdfunding/creator/campaigns', { params: { status } });
  return (res.data?.data ?? res.data) as Campaign[];
}

export async function getCreatorContributions(): Promise<CreatorContribution[]> {
  if (USE_MOCK) { await delay(220); return MOCK_CREATOR_CONTRIBUTIONS; }
  const res = await api.get('/api/v1/crowdfunding/creator/contributions');
  return (res.data?.data ?? res.data) as CreatorContribution[];
}

export async function getCreatorWithdrawals(): Promise<CreatorWithdrawal[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_CREATOR_WITHDRAWALS].sort((a, b) => +new Date(b.requestedAt) - +new Date(a.requestedAt));
  }
  const res = await api.get('/api/v1/crowdfunding/creator/withdrawals');
  return (res.data?.data ?? res.data) as CreatorWithdrawal[];
}

export async function getCreatorNotifications(): Promise<CreatorNotification[]> {
  if (USE_MOCK) { await delay(200); return MOCK_CREATOR_NOTIFICATIONS; }
  const res = await api.get('/api/v1/crowdfunding/creator/notifications');
  return (res.data?.data ?? res.data) as CreatorNotification[];
}

export async function getCampaignAnalytics(id: string): Promise<CampaignAnalytics> {
  if (USE_MOCK) {
    await delay();
    const campaign = MOCK_MY_CAMPAIGNS.find((c) => c.id === id) ?? MOCK_MY_CAMPAIGNS[0];
    return buildAnalytics(campaign);
  }
  const res = await api.get(`/api/v1/crowdfunding/creator/campaigns/${id}/analytics`);
  return (res.data?.data ?? res.data) as CampaignAnalytics;
}

// ─── Campaign creation (Section G) ────────────────────────────────────────────

/**
 * Submit (or save as draft) a campaign assembled by the creation wizard.
 * `submitForReview=false` keeps it as a DRAFT; true sends to admin review.
 */
export async function submitCampaign(
  draft: CampaignDraftInput,
  submitForReview: boolean,
  idempotencyKey: string,
): Promise<SubmitCampaignResult> {
  if (USE_MOCK) {
    await delay(900);
    const id = `my-${Date.now()}`;
    const status = submitForReview ? 'PENDING_REVIEW' : 'DRAFT';
    const categoryMeta = CAMPAIGN_CATEGORIES.find((c) => c.slug === draft.category);
    const now = new Date().toISOString();

    // Insert the new campaign so it appears immediately in My Campaigns
    // (Draft / In review tabs). Real backend persists this server-side.
    const newCampaign: Campaign = {
      id,
      title: draft.title || 'Untitled campaign',
      summary: draft.summary,
      story: draft.story,
      type: draft.type ?? 'DONATION',
      status,
      category: draft.category ?? 'community',
      categoryLabel: categoryMeta?.label ?? 'Community',
      coverImage: draft.coverImageUri,
      media: draft.coverImageUri ? [{ id: `${id}-m0`, type: 'image', url: draft.coverImageUri, thumbnailUrl: null }] : [],
      goalKobo: draft.goalKobo,
      raisedKobo: 0,
      currency: 'NGN',
      contributorCount: 0,
      deadline: draft.deadline,
      createdAt: now,
      creator: {
        id: 'me', name: 'Adaeze Okonkwo', type: 'INDIVIDUAL', avatarUrl: null,
        verification: 'KYC', location: draft.location || 'Nigeria', campaignsCreated: 1,
        totalRaisedKobo: 0, bio: null, joinedAt: '2025-03-04T00:00:00Z', followed: false,
      },
      beneficiary: draft.beneficiaryName
        ? { id: `${id}-b`, name: draft.beneficiaryName, relationship: draft.beneficiaryRelationship, description: null, verified: false }
        : null,
      disbursementModel: draft.disbursementModel ?? 'IMMEDIATE',
      refundPolicy: draft.refundPolicy,
      riskDisclosure: null,
      verified: false,
      featured: false,
      trending: false,
      urgent: false,
      saved: false,
      budget: draft.budget.map((b) => ({ id: b.id, label: b.label, amountKobo: b.amountKobo, note: null })),
      milestones: draft.milestones.map((m, i) => ({ id: m.id, title: m.title, targetKobo: m.targetKobo, status: i === 0 ? 'ACTIVE' : 'LOCKED', dueAt: null, evidenceCount: 0 })),
      updates: [],
      rewardTiers: draft.rewardTiers.map((r) => ({ id: r.id, title: r.title, amountKobo: r.amountKobo, description: r.description, estimatedDelivery: null, claimed: 0, limit: null, requiresShipping: r.requiresShipping })),
      documents: draft.documentLabels.map((label, i) => ({ id: `${id}-d${i}`, label, type: 'pdf', sizeLabel: '—', verified: false })),
      faqs: [],
      tags: [],
      location: draft.location || null,
    };
    MOCK_MY_CAMPAIGNS.unshift(newCampaign);

    return { campaignId: id, status, reference: `SPL-CFNEW-${Date.now()}` };
  }
  // Map explicitly onto the Go SubmitCampaignRequest DTO. Spreading the raw
  // draft looked equivalent but was not: the server field is `coverImageUrl`
  // while the draft carries `coverImageUri`, so every cover image was silently
  // dropped, and the spread hid that the DTO accepts none of the wizard's
  // budget/milestone/reward/document/beneficiary data either — the wizard
  // collects all of it and the server discards it. Keep this list explicit so
  // the next field that stops being persisted is visible in review.
  const res = await api.post(
    `${LIVE}/campaigns`,
    {
      type: draft.type,
      category: draft.category,
      title: draft.title,
      summary: draft.summary,
      story: draft.story,
      goalKobo: draft.goalKobo,
      deadline: draft.deadline,
      location: draft.location,
      refundPolicy: draft.refundPolicy,
      disbursementModel: draft.disbursementModel,
      // Only a remotely-resolvable URL may be persisted. The media step stores
      // the raw picker URI (file:// on native, blob: on web) and there is NO
      // upload step yet, so sending it would replace a silently-dropped cover
      // with a stored path that renders broken for every other viewer. Send it
      // only once it is an http(s) URL — which is what an R2 upload will yield.
      coverImageUrl: /^https?:\/\//i.test(draft.coverImageUri ?? '') ? draft.coverImageUri : null,
      submitForReview,
    },
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
  return res.data?.data ?? res.data;
}
