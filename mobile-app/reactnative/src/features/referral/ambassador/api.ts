// ── Referral Ambassador Zone API (M-AMB-01..06) ──────────────────────────────
// Mock-first (USE_MOCK). Live path hits `${REFERRAL_API_BASE}/...`. Money is
// ALWAYS integer kobo. The payout mutation attaches an Idempotency-Key on the
// live path (money mutation). Earnings tie to verified activity (§7).

import { api } from '@/api/client';
import { USE_MOCK, REFERRAL_API_BASE } from '../constants/referral.constants';
import { generateIdempotencyKey } from '@/utils/idempotency';
import type {
  AmbassadorDashboard,
  CreativeAsset,
  AudienceMember,
  AmbassadorAnalytics,
  AmbassadorPayouts,
  AmbassadorWithdrawResult,
  TierProgression,
  AmbassadorApplication,
  AmbassadorStatus,
  ApplyInput,
} from './types';

const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));

function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}

const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();

const MOCK_DASHBOARD: AmbassadorDashboard = {
  tier: 'Rising',
  earnedKobo: 1_240_000,
  pendingKobo: 320_000,
  eligibleKobo: 680_000,
  conversionRate: 0.18,
  funnel: [
    { key: 'clicks', label: 'Link clicks', value: 1820, conversion: null },
    { key: 'signups', label: 'Signups', value: 612, conversion: 612 / 1820 },
    { key: 'kyc', label: 'KYC completed', value: 430, conversion: 430 / 612 },
    { key: 'activated', label: 'Activated', value: 328, conversion: 328 / 430 },
    { key: 'retained', label: 'Retained 30d', value: 214, conversion: 214 / 328 },
  ],
};

const MOCK_ASSETS: CreativeAsset[] = [
  { id: 'a1', kind: 'banner', title: 'Hero banner — "Earn with friends"', content: null, approved: true, icon: 'Image' },
  { id: 'a2', kind: 'caption', title: 'Instagram caption', content: 'Join me on Paymax — real rewards for real activity, not sign-up gimmicks. Use my link 👇', approved: true, icon: 'MessageSquare' },
  { id: 'a3', kind: 'vanity_link', title: 'Your vanity link', content: 'https://pmx.ng/r/ada-amb', approved: true, icon: 'Link' },
  { id: 'a4', kind: 'caption', title: 'WhatsApp status', content: 'Earn when your friends actually use Paymax. Tap my link to start.', approved: true, icon: 'MessageSquare' },
  { id: 'a5', kind: 'video', title: '15s explainer reel', content: null, approved: false, icon: 'Megaphone' },
];

const MOCK_AUDIENCE: AudienceMember[] = [
  { id: 'au1', name: 'Amara Eze', status: 'retained', channel: 'WhatsApp', joinedAt: daysAgo(40), earnedKobo: 100_000 },
  { id: 'au2', name: 'Bola Adeyemi', status: 'activated', channel: 'Instagram', joinedAt: daysAgo(20), earnedKobo: 60_000 },
  { id: 'au3', name: 'Ngozi Okoro', status: 'kyc', channel: 'WhatsApp', joinedAt: daysAgo(8), earnedKobo: 30_000 },
  { id: 'au4', name: 'Tunde Bakare', status: 'signed_up', channel: 'X / Twitter', joinedAt: daysAgo(3), earnedKobo: 0 },
  { id: 'au5', name: 'Pending invitee', status: 'invited', channel: 'SMS', joinedAt: daysAgo(1), earnedKobo: 0 },
  { id: 'au6', name: 'Emeka Obi', status: 'churned', channel: 'Instagram', joinedAt: daysAgo(70), earnedKobo: 100_000 },
];

const MOCK_ANALYTICS: AmbassadorAnalytics = {
  trend: [
    { label: 'Wk 1', clicks: 320, activations: 41 },
    { label: 'Wk 2', clicks: 410, activations: 58 },
    { label: 'Wk 3', clicks: 380, activations: 62 },
    { label: 'Wk 4', clicks: 520, activations: 89 },
    { label: 'Wk 5', clicks: 190, activations: 78 },
  ],
  channels: [
    { channel: 'WhatsApp', clicks: 820, activations: 168, rate: 168 / 820 },
    { channel: 'Instagram', clicks: 540, activations: 92, rate: 92 / 540 },
    { channel: 'X / Twitter', clicks: 280, activations: 41, rate: 41 / 280 },
    { channel: 'SMS', clicks: 180, activations: 27, rate: 27 / 180 },
  ],
  bestChannel: 'WhatsApp',
};

const MOCK_PAYOUTS: AmbassadorPayouts = {
  eligibleKobo: 680_000,
  pendingKobo: 320_000,
  vestingKobo: 150_000,
  minWithdrawKobo: 10_000,
  history: [
    { id: 'p1', amountKobo: 500_000, at: daysAgo(30), reference: 'AMB-WD-204113' },
    { id: 'p2', amountKobo: 300_000, at: daysAgo(60), reference: 'AMB-WD-118822' },
  ],
};

const MOCK_TIERS: TierProgression = {
  currentTier: 'Rising',
  nextTier: 'Established',
  activatedReferrals: 328,
  activatedToNext: 172,
  tiers: [
    { key: 'starter', name: 'Starter', activatedRequired: 0, perks: ['Vanity link', 'Basic toolkit'], rewardMultiplier: 1.0, reached: true, current: false },
    { key: 'rising', name: 'Rising', activatedRequired: 100, perks: ['Branded banners', 'Priority support'], rewardMultiplier: 1.15, reached: true, current: true },
    { key: 'established', name: 'Established', activatedRequired: 500, perks: ['Higher multiplier', 'Featured spotlight'], rewardMultiplier: 1.3, reached: false, current: false },
    { key: 'elite', name: 'Elite', activatedRequired: 2000, perks: ['Top multiplier', 'Co-marketing budget'], rewardMultiplier: 1.5, reached: false, current: false },
  ],
};

// Backend RB0 reward-ledger summary (GET /referral/my-rewards). Aggregates ALL
// reward kinds (including ambassador/agent 'override' rows) by state — this is
// the source of truth for the ambassador's eligible/paid/clawed-back balances.
interface BackendRewardSummary {
  beneficiary_id: string;
  total_earned_kobo: number;
  eligible_kobo: number;
  paid_kobo: number;
  clawed_back_kobo: number;
  by_state?: Record<string, number>;
}

// Backend network.Override row (GET /network/overrides) — individual override
// accruals; used to build payout history (each accrual references a reward
// ledger row via reward_ledger_id).
interface BackendOverride {
  id: string;
  beneficiary_id: string;
  network_id?: string;
  source_user_id?: string;
  campaign_id?: string;
  activity_base_kobo: number;
  override_bps: number;
  amount_kobo: number;
  cap_applied_kobo: number;
  reward_ledger_id?: string;
  created_at: string;
}

// Backend RB0 WithdrawResult (POST /referral/withdraw response).
interface BackendWithdrawResult {
  beneficiary_id: string;
  withdrawn_kobo: number;
  rewards_paid: number;
  remaining_eligible_kobo: number;
  currency: string;
}

export async function getDashboard(): Promise<AmbassadorDashboard> {
  if (USE_MOCK) {
    await delay();
    return { ...MOCK_DASHBOARD, funnel: MOCK_DASHBOARD.funnel.map((f) => ({ ...f })) };
  }
  const [ambRes, summaryRes] = await Promise.all([
    api.get(`${REFERRAL_API_BASE}/network/ambassador`),
    api.get(`${REFERRAL_API_BASE}/my-rewards`).catch(() => null),
  ]);
  const amb = unwrap<{ ambassador?: { tier?: string; status?: string } }>(ambRes).ambassador;
  const sum = summaryRes ? unwrap<BackendRewardSummary>(summaryRes) : null;
  return {
    tier: amb?.tier ?? 'starter',
    earnedKobo: sum?.total_earned_kobo ?? 0,
    pendingKobo: sum?.by_state?.['pending'] ?? 0,
    eligibleKobo: sum?.eligible_kobo ?? 0,
    conversionRate: 0, // TODO(referral phase3): no click/funnel tracking source yet
    funnel: [], // TODO(referral phase3): no backend funnel endpoint yet
  };
}

export async function getCreativeAssets(): Promise<CreativeAsset[]> {
  if (USE_MOCK) {
    await delay(240);
    return MOCK_ASSETS.map((a) => ({ ...a }));
  }
  // TODO(referral phase3): no backend endpoint yet
  return [];
}

export async function getAudience(): Promise<AudienceMember[]> {
  if (USE_MOCK) {
    await delay(240);
    return MOCK_AUDIENCE.map((m) => ({ ...m }));
  }
  // TODO(referral phase3): no backend endpoint yet
  return [];
}

export async function getAnalytics(): Promise<AmbassadorAnalytics> {
  if (USE_MOCK) {
    await delay(260);
    return {
      ...MOCK_ANALYTICS,
      trend: MOCK_ANALYTICS.trend.map((t) => ({ ...t })),
      channels: MOCK_ANALYTICS.channels.map((c) => ({ ...c })),
    };
  }
  // TODO(referral phase3): no backend endpoint yet
  return { trend: [], channels: [], bestChannel: '' };
}

export async function getPayouts(): Promise<AmbassadorPayouts> {
  if (USE_MOCK) {
    await delay(240);
    return { ...MOCK_PAYOUTS, history: MOCK_PAYOUTS.history.map((h) => ({ ...h })) };
  }
  // Live: RB0 reward-ledger summary (my-rewards) gives eligible/paid/clawed-back
  // aggregates across ALL reward kinds for this beneficiary (including
  // ambassador/agent overrides). Override rows (network/overrides) supply the
  // payout HISTORY (each override references a reward_ledger_id once paid).
  const [summaryRes, overridesRes] = await Promise.all([
    api.get(`${REFERRAL_API_BASE}/my-rewards`),
    api.get(`${REFERRAL_API_BASE}/network/overrides`).catch(() => null),
  ]);
  const sum = unwrap<BackendRewardSummary>(summaryRes);
  const overrides = overridesRes
    ? unwrap<{ overrides?: BackendOverride[] }>(overridesRes).overrides ?? []
    : [];
  const pendingKobo = sum.by_state?.['pending'] ?? 0; // TODO(referral phase3): earned/vesting split not separately exposed
  const vestingKobo = sum.by_state?.['vesting'] ?? 0;
  return {
    eligibleKobo: sum.eligible_kobo,
    pendingKobo,
    vestingKobo,
    minWithdrawKobo: 0, // TODO(referral phase3): no configured minimum on the backend; withdraw sweeps all eligible
    history: overrides
      .filter((o) => !!o.reward_ledger_id)
      .map((o) => ({
        id: o.id,
        amountKobo: o.amount_kobo,
        at: o.created_at,
        reference: o.reward_ledger_id ?? o.id,
      })),
  };
}

// Money mutation: attaches an Idempotency-Key on the live path (kobo). Sweeps
// ALL eligible RB0 reward-ledger rows (POST /referral/withdraw) — the backend
// has no partial-amount withdraw, so amountKobo is accepted for the mock/UI
// contract but the live call always sweeps the full eligible balance.
export async function withdrawPayout(amountKobo: number): Promise<AmbassadorWithdrawResult> {
  if (USE_MOCK) {
    await delay(420);
    if (amountKobo < MOCK_PAYOUTS.minWithdrawKobo) {
      return { ok: false, amountKobo, newEligibleKobo: MOCK_PAYOUTS.eligibleKobo, reference: '', error: 'below_min' };
    }
    if (amountKobo > MOCK_PAYOUTS.eligibleKobo) {
      return { ok: false, amountKobo, newEligibleKobo: MOCK_PAYOUTS.eligibleKobo, reference: '', error: 'insufficient' };
    }
    return { ok: true, amountKobo, newEligibleKobo: MOCK_PAYOUTS.eligibleKobo - amountKobo, reference: `AMB-WD-${Math.floor(Math.random() * 900000 + 100000)}` };
  }
  try {
    const res = await api.post(
      `${REFERRAL_API_BASE}/withdraw`,
      {},
      { headers: { 'Idempotency-Key': generateIdempotencyKey() } },
    );
    const r = unwrap<BackendWithdrawResult>(res);
    return {
      ok: true,
      amountKobo: r.withdrawn_kobo,
      newEligibleKobo: r.remaining_eligible_kobo,
      reference: `referral_withdraw:${r.beneficiary_id}`,
    };
  } catch (err) {
    // 403 ⇒ ErrKYCRequired (fail-closed KYC gate); surface as a typed error, no
    // fabricated success.
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 403) {
      return { ok: false, amountKobo, newEligibleKobo: 0, reference: '', error: 'kyc_required' };
    }
    return { ok: false, amountKobo, newEligibleKobo: 0, reference: '', error: 'insufficient' };
  }
}

export async function getTierProgression(): Promise<TierProgression> {
  if (USE_MOCK) {
    await delay(220);
    return { ...MOCK_TIERS, tiers: MOCK_TIERS.tiers.map((t) => ({ ...t, perks: [...t.perks] })) };
  }
  const res = await api.get(`${REFERRAL_API_BASE}/network/ambassador`);
  const amb = unwrap<{ ambassador?: { tier?: string } }>(res).ambassador;
  const currentTier = amb?.tier ?? 'starter';
  // TODO(referral phase3): backend has no tier ladder/thresholds or activated-referral
  // counts yet — surface only the current tier; thresholds and progress are unbacked.
  return {
    currentTier,
    nextTier: null,
    activatedReferrals: 0,
    activatedToNext: null,
    tiers: [
      {
        key: currentTier,
        name: currentTier,
        activatedRequired: 0,
        perks: [],
        rewardMultiplier: 1.0,
        reached: true,
        current: true,
      },
    ],
  };
}

// ── Application (M-AMB-00) ───────────────────────────────────────────────────

/**
 * The disclosure an applicant must accept, stored verbatim with the
 * application. Kept here (not only in the screen) so the exact text that was
 * accepted is what gets persisted — a disclosure record that does not match
 * what the user actually read is worse than none.
 */
export const AMBASSADOR_DISCLOSURE =
  'I understand that as a Spotlight ambassador I earn commission when people I ' +
  'refer complete verified activity. I agree to disclose this relationship ' +
  'clearly and honestly whenever I promote Spotlight, and not to misrepresent ' +
  'earnings, guarantee results, or pay anyone to sign up.';

interface BackendAmbassador {
  id: string;
  user_id: string;
  tier: string;
  status: string;
  disclosure_text?: string;
  disclosure_accepted_at?: string | null;
  applied_at: string;
  approved_at?: string | null;
}

function mapApplication(a: BackendAmbassador): AmbassadorApplication {
  return {
    id: a.id,
    tier: a.tier,
    status: (a.status as AmbassadorStatus) ?? 'applied',
    disclosureText: a.disclosure_text ?? '',
    disclosureAcceptedAt: a.disclosure_accepted_at ?? null,
    appliedAt: a.applied_at,
    approvedAt: a.approved_at ?? null,
  };
}

/**
 * The caller's ambassador record, or null when they have never applied.
 * GET /network/ambassador answers { ambassador: null } for a non-ambassador —
 * an expected state, not an error.
 */
export async function getMyApplication(): Promise<AmbassadorApplication | null> {
  if (USE_MOCK) {
    await delay(200);
    return null;
  }
  const res = await api.get(`${REFERRAL_API_BASE}/network/ambassador`);
  const amb = unwrap<{ ambassador?: BackendAmbassador | null }>(res)?.ambassador;
  return amb ? mapApplication(amb) : null;
}

/**
 * Submit (or re-submit) an ambassador application. Idempotent per user
 * server-side: applying again updates the existing row rather than creating a
 * second one, so a double tap cannot produce duplicate applications.
 */
export async function applyAsAmbassador(input: ApplyInput): Promise<AmbassadorApplication> {
  if (USE_MOCK) {
    await delay(400);
    return {
      id: `amb_${Date.now()}`,
      tier: input.tier,
      status: 'applied',
      disclosureText: AMBASSADOR_DISCLOSURE,
      disclosureAcceptedAt: new Date().toISOString(),
      appliedAt: new Date().toISOString(),
      approvedAt: null,
    };
  }
  const res = await api.post(
    `${REFERRAL_API_BASE}/network/ambassador/apply`,
    {
      tier: input.tier,
      // Send the exact text shown to the user, so the stored disclosure is the
      // one they actually accepted.
      disclosure_text: AMBASSADOR_DISCLOSURE,
      disclosure_accepted: input.disclosureAccepted,
    },
    { headers: { 'Idempotency-Key': generateIdempotencyKey() } },
  );
  return mapApplication(unwrap<BackendAmbassador>(res));
}
