// ── Referral Campaigns API (M-CMP-01..03) ────────────────────────────────────
// Mock-first (USE_MOCK). Live path hits `${REFERRAL_API_BASE}/...`. Money is
// ALWAYS integer kobo. Rewards tie to a referred friend's verified activity (§7).

import { api } from '@/api/client';
import { USE_MOCK, REFERRAL_API_BASE } from '../constants/referral.constants';
import type { CampaignSummary, CampaignDetail, CampaignStatus, CampaignReward } from './types';

// ── Backend (bare gin.H) Campaign shape ──────────────────────────────────────
interface BackendCampaign {
  id: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
  reward_model: string;
  reward_config?: Record<string, unknown> | null;
  vesting_schedule_id?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  funding_source?: string | null;
  merchant_campaign_id?: string | null;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

// Map a backend status string → frontend CampaignStatus (safe fallback 'active').
function mapCampaignStatus(status: string): CampaignStatus {
  switch (status) {
    case 'active':
    case 'ending_soon':
    case 'upcoming':
    case 'ended':
      return status;
    case 'paused':
    case 'draft':
      return 'upcoming';
    default:
      return 'active';
  }
}

// Map backend reward_model → frontend reward type (safe fallback 'flat').
function mapRewardType(model: string): CampaignReward['type'] {
  switch (model) {
    case 'flat':
    case 'dynamic':
    case 'ltv_priced':
      return model;
    default:
      return 'flat';
  }
}

// Pull an integer-kobo value out of reward_config by candidate keys (no float math).
function koboFrom(cfg: Record<string, unknown> | null | undefined, keys: string[]): number {
  if (!cfg) return 0;
  for (const k of keys) {
    const v = cfg[k];
    if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  }
  return 0;
}

function nullableKoboFrom(cfg: Record<string, unknown> | null | undefined, keys: string[]): number | null {
  if (!cfg) return null;
  for (const k of keys) {
    const v = cfg[k];
    if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  }
  return null;
}

function mapCampaignSummary(c: BackendCampaign): CampaignSummary {
  const cfg = c.reward_config ?? null;
  const referrerKobo = koboFrom(cfg, ['referrer_kobo', 'referrerKobo', 'amount_kobo', 'reward_kobo']);
  const refereeKobo = nullableKoboFrom(cfg, ['referee_kobo', 'refereeKobo', 'welcome_kobo']);
  const headline = (typeof cfg?.['headline'] === 'string' ? (cfg['headline'] as string) : '') || c.name;
  return {
    id: c.id,
    title: c.name,
    blurb: c.description ?? '',
    icon: 'Store', // TODO(referral phase3): no backend field
    vertical: 'general', // TODO(referral phase3): no backend field
    status: mapCampaignStatus(c.status),
    reward: {
      type: mapRewardType(c.reward_model),
      headline,
      referrerKobo,
      refereeKobo,
    },
    endsAt: c.ends_at ?? null,
    featured: false, // TODO(referral phase3): no backend field
  };
}

function mapCampaignDetail(c: BackendCampaign): CampaignDetail {
  const summary = mapCampaignSummary(c);
  return {
    ...summary,
    explanation: '', // TODO(referral phase3): no backend field
    eligibility: [], // TODO(referral phase3): no backend field
    qualifyingActions: [], // TODO(referral phase3): no backend field
    vesting: [], // TODO(referral phase3): no backend field (vesting_schedule_id only)
    capKobo: null, // TODO(referral phase3): no backend field
    terms: [], // TODO(referral phase3): no backend field
  };
}

const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));

function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}

const daysFromNow = (d: number) => new Date(Date.now() + d * 86400_000).toISOString();

const MOCK_CAMPAIGNS: CampaignSummary[] = [
  {
    id: 'cmp1',
    title: 'Property power-up',
    blurb: 'Refer a friend who lists or buys on the property module.',
    icon: 'Store',
    vertical: 'property',
    status: 'active',
    reward: { type: 'ltv_priced', headline: 'Up to ₦5,000 per verified friend', referrerKobo: 500_000, refereeKobo: 100_000 },
    endsAt: daysFromNow(20),
    featured: true,
  },
  {
    id: 'cmp2',
    title: 'Bills bonanza',
    blurb: 'Earn when a friend pays their first 3 bills on Paymax.',
    icon: 'ReceiptText',
    vertical: 'bills',
    status: 'active',
    reward: { type: 'flat', headline: '₦2,000 per verified friend', referrerKobo: 200_000, refereeKobo: 50_000 },
    endsAt: daysFromNow(8),
    featured: false,
  },
  {
    id: 'cmp3',
    title: 'Savings starter',
    blurb: 'A friend opens and funds a savings goal.',
    icon: 'Wallet',
    vertical: 'savings',
    status: 'ending_soon',
    reward: { type: 'dynamic', headline: 'Up to ₦3,000 per verified friend', referrerKobo: 300_000, refereeKobo: null },
    endsAt: daysFromNow(2),
    featured: false,
  },
  {
    id: 'cmp4',
    title: 'World Cup festival',
    blurb: 'Seasonal sport-themed referral boost.',
    icon: 'Trophy',
    vertical: 'sport',
    status: 'active',
    reward: { type: 'flat', headline: '₦1,500 + bonus points per friend', referrerKobo: 150_000, refereeKobo: 50_000 },
    endsAt: daysFromNow(14),
    featured: true,
  },
  {
    id: 'cmp5',
    title: 'New-year welcome',
    blurb: 'Closed seasonal campaign.',
    icon: 'PartyPopper',
    vertical: 'festive',
    status: 'ended',
    reward: { type: 'flat', headline: '₦1,000 per friend (ended)', referrerKobo: 100_000, refereeKobo: null },
    endsAt: daysFromNow(-10),
    featured: false,
  },
];

function buildDetail(c: CampaignSummary): CampaignDetail {
  return {
    ...c,
    reward: { ...c.reward },
    explanation:
      'You earn only when the friend you refer genuinely uses Paymax — completing KYC and the qualifying ' +
      'actions below. Rewards vest as your friend proves real activity, and are capped per campaign. ' +
      'No reward is paid for signups or recruitment alone.',
    eligibility: [
      'Open to all verified referrers',
      'Friend must be a brand-new Paymax user (no prior KYC identity)',
      'Self-referrals and duplicate identities are blocked',
    ],
    qualifyingActions: [
      'Friend completes KYC (BVN/NIN)',
      c.vertical === 'property' ? 'Friend lists or transacts on property' : c.vertical === 'bills' ? 'Friend pays a real bill' : 'Friend makes a first genuine transaction',
      'Friend stays active for 30 days (final tranche)',
    ],
    vesting: [
      { label: 'On KYC', amountKobo: Math.round(c.reward.referrerKobo * 0.3), condition: 'Friend completes identity verification' },
      { label: 'On qualifying action', amountKobo: Math.round(c.reward.referrerKobo * 0.3), condition: 'Friend completes the qualifying transaction' },
      { label: 'Retained 30 days', amountKobo: c.reward.referrerKobo - Math.round(c.reward.referrerKobo * 0.3) * 2, condition: 'Friend stays active for 30 days' },
    ],
    capKobo: c.reward.referrerKobo * 20,
    terms: [
      'Rewards are tied to verified activity, never to recruitment.',
      'Per-referrer caps apply; fraud leads to clawbacks.',
      'Campaign may auto-pause if budget or fraud thresholds are hit.',
    ],
  };
}

export async function getCampaigns(): Promise<CampaignSummary[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_CAMPAIGNS.filter((c) => c.status !== 'ended').map((c) => ({ ...c, reward: { ...c.reward } }));
  }
  const res = await api.get(`${REFERRAL_API_BASE}/campaigns`);
  const body = unwrap<{ campaigns?: BackendCampaign[] }>(res);
  return (body.campaigns ?? []).map(mapCampaignSummary);
}

export async function getFeaturedCampaigns(): Promise<CampaignSummary[]> {
  if (USE_MOCK) {
    await delay(240);
    return MOCK_CAMPAIGNS.filter((c) => c.featured && c.status !== 'ended').map((c) => ({ ...c, reward: { ...c.reward } }));
  }
  // TODO(referral phase3): no backend endpoint yet (/campaigns/featured). Derive
  // "featured" client-side from the main /campaigns list: take active campaigns.
  const res = await api.get(`${REFERRAL_API_BASE}/campaigns`);
  const body = unwrap<{ campaigns?: BackendCampaign[] }>(res);
  return (body.campaigns ?? [])
    .filter((c) => c.status === 'active')
    .slice(0, 5)
    .map(mapCampaignSummary);
}

export async function getCampaignDetail(id: string): Promise<CampaignDetail> {
  if (USE_MOCK) {
    await delay(220);
    const c = MOCK_CAMPAIGNS.find((x) => x.id === id);
    if (!c) throw new Error('Campaign not found');
    return buildDetail(c);
  }
  const res = await api.get(`${REFERRAL_API_BASE}/campaigns/${id}`);
  const c = unwrap<BackendCampaign>(res); // bare Campaign, no {campaigns} wrapper
  return mapCampaignDetail(c);
}
