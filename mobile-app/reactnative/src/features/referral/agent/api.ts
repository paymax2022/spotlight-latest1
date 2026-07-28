// ── Referral Agent / Team Zone API (M-AGT-01..07) ────────────────────────────
// Mock-first (USE_MOCK). Live path hits `${REFERRAL_API_BASE}/...`. Money is
// ALWAYS integer kobo.
//
// COMPLIANCE (PRD §7, §10): every override here is a CAPPED % of members'
// VERIFIED ACTIVITY/REVENUE — never a recruitment bounty. The override rate,
// the verified-activity basis, and the cap travel together in the data.

import { api } from '@/api/client';
import { USE_MOCK, REFERRAL_API_BASE } from '../constants/referral.constants';
import type {
  TeamDashboard,
  TeamInvite,
  OnboardResult,
  TeamMember,
  MemberStatus,
  MemberDetail,
  OverrideLedger,
  TeamLeaderboard,
  TrainingResource,
  AgentDisclosure,
} from './types';

const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));

function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}

// ── Backend wire shapes (bare snake_case JSON from Go /api/v1/referral) ───────
// These mirror the network/override endpoints that actually exist today.
interface BackendNetwork {
  id: string;
  lead_user_id: string;
  name: string;
  network_type: string;
  status: string;
  created_at: string;
}
interface BackendNetworkMember {
  id: string;
  network_id: string;
  member_user_id: string;
  is_house_attributed: boolean;
  status: string;
  joined_at: string;
}
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

// Map a backend member's status string to the frontend MemberStatus union.
function toMemberStatus(status: string): MemberStatus {
  if (status === 'active') return 'active';
  if (status === 'onboarding' || status === 'pending' || status === 'invited') return 'onboarding';
  return 'inactive';
}

// Map a backend network member → frontend TeamMember. Several member-level
// fields (name, per-member activity/override, verified referral counts) are not
// carried by the members endpoint yet.
function toTeamMember(m: BackendNetworkMember): TeamMember {
  return {
    id: m.id,
    // TODO(referral phase3): members endpoint returns member_user_id, not a
    // display name — no name source until a profile join lands.
    name: m.member_user_id,
    status: toMemberStatus(m.status),
    joinedAt: m.joined_at,
    // TODO(referral phase3): per-member verified activity not exposed by
    // /network/teams/:id/members (override attribution is per-source elsewhere).
    activityKobo: 0,
    // TODO(referral phase3): per-member override total not exposed here.
    overrideKobo: 0,
    // TODO(referral phase3): verified referral count not exposed here.
    verifiedReferrals: 0,
  };
}

// Fetch the primary (first) network, or null when the caller leads none.
async function fetchPrimaryNetwork(): Promise<BackendNetwork | null> {
  const res = await api.get(`${REFERRAL_API_BASE}/network/teams`);
  const { networks } = unwrap<{ networks: BackendNetwork[] }>(res) ?? { networks: [] };
  return networks && networks.length > 0 ? networks[0] : null;
}

async function fetchNetworkMembers(networkId: string): Promise<BackendNetworkMember[]> {
  const res = await api.get(`${REFERRAL_API_BASE}/network/teams/${networkId}/members`);
  const { members } = unwrap<{ members: BackendNetworkMember[] }>(res) ?? { members: [] };
  return members ?? [];
}

async function fetchOverrides(): Promise<BackendOverride[]> {
  const res = await api.get(`${REFERRAL_API_BASE}/network/overrides`);
  const { overrides } = unwrap<{ overrides: BackendOverride[] }>(res) ?? { overrides: [] };
  return overrides ?? [];
}

const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();
const daysFromNow = (d: number) => new Date(Date.now() + d * 86400_000).toISOString();

// Override policy (display): 5% of verified activity, capped per period.
const OVERRIDE_RATE = 0.05;
const OVERRIDE_CAP_KOBO = 5_000_000; // ₦50,000 cap per period

const MOCK_DASHBOARD: TeamDashboard = {
  teamName: 'Lagos Mainland Crew',
  memberCount: 14,
  activeMemberCount: 9,
  overrideEarnedKobo: 1_840_000,
  networkActivityKobo: 36_800_000,
  overrideRate: OVERRIDE_RATE,
  overrideCapKobo: OVERRIDE_CAP_KOBO,
  capUsedKobo: 1_840_000,
};

const MOCK_INVITES: TeamInvite[] = [
  { id: 'i1', name: 'Yetunde A.', contact: '0803••••212', state: 'accepted', sentAt: daysAgo(12) },
  { id: 'i2', name: 'Sola M.', contact: 'sola@mail.com', state: 'pending', sentAt: daysAgo(2) },
  { id: 'i3', name: 'Ibrahim K.', contact: '0810••••904', state: 'declined', sentAt: daysAgo(6) },
];

const MOCK_MEMBERS: TeamMember[] = [
  { id: 'mb1', name: 'Yetunde Ade', status: 'active', joinedAt: daysAgo(40), activityKobo: 12_400_000, overrideKobo: 620_000, verifiedReferrals: 18 },
  { id: 'mb2', name: 'Chuka Eze', status: 'active', joinedAt: daysAgo(30), activityKobo: 9_200_000, overrideKobo: 460_000, verifiedReferrals: 11 },
  { id: 'mb3', name: 'Halima Bello', status: 'active', joinedAt: daysAgo(20), activityKobo: 6_800_000, overrideKobo: 340_000, verifiedReferrals: 9 },
  { id: 'mb4', name: 'Peter Obi', status: 'onboarding', joinedAt: daysAgo(5), activityKobo: 800_000, overrideKobo: 40_000, verifiedReferrals: 2 },
  { id: 'mb5', name: 'Grace N.', status: 'inactive', joinedAt: daysAgo(90), activityKobo: 0, overrideKobo: 0, verifiedReferrals: 0 },
];

function buildMemberDetail(m: TeamMember): MemberDetail {
  return {
    ...m,
    activityBasis:
      `Your override from ${m.name} is ${(OVERRIDE_RATE * 100).toFixed(0)}% of their VERIFIED activity ` +
      `(real transactions and revenue from the people they personally refer who actually use Paymax). ` +
      `It is NOT a payment for recruiting ${m.name} or anyone else, and it is capped per period.`,
    rows: m.activityKobo > 0
      ? [
          { id: 'ar1', label: 'Verified bill payments (network)', at: daysAgo(3), activityKobo: Math.round(m.activityKobo * 0.4), overrideKobo: Math.round(m.activityKobo * 0.4 * OVERRIDE_RATE) },
          { id: 'ar2', label: 'Verified transfers (network)', at: daysAgo(7), activityKobo: Math.round(m.activityKobo * 0.35), overrideKobo: Math.round(m.activityKobo * 0.35 * OVERRIDE_RATE) },
          { id: 'ar3', label: 'Verified property activity', at: daysAgo(12), activityKobo: Math.round(m.activityKobo * 0.25), overrideKobo: Math.round(m.activityKobo * 0.25 * OVERRIDE_RATE) },
        ]
      : [],
  };
}

const MOCK_LEDGER: OverrideLedger = {
  rate: OVERRIDE_RATE,
  capKobo: OVERRIDE_CAP_KOBO,
  capUsedKobo: 1_840_000,
  totalOverrideKobo: 1_840_000,
  totalActivityKobo: 36_800_000,
  rows: [
    { id: 'ol1', memberName: 'Yetunde Ade', activityKobo: 12_400_000, rate: OVERRIDE_RATE, overrideKobo: 620_000, capped: false, at: daysAgo(2) },
    { id: 'ol2', memberName: 'Chuka Eze', activityKobo: 9_200_000, rate: OVERRIDE_RATE, overrideKobo: 460_000, capped: false, at: daysAgo(4) },
    { id: 'ol3', memberName: 'Halima Bello', activityKobo: 6_800_000, rate: OVERRIDE_RATE, overrideKobo: 340_000, capped: false, at: daysAgo(6) },
    { id: 'ol4', memberName: 'Yetunde Ade', activityKobo: 8_400_000, rate: OVERRIDE_RATE, overrideKobo: 380_000, capped: true, at: daysAgo(9) },
    { id: 'ol5', memberName: 'Peter Obi', activityKobo: 800_000, rate: OVERRIDE_RATE, overrideKobo: 40_000, capped: false, at: daysAgo(11) },
  ],
};

const MOCK_LEADERBOARD: TeamLeaderboard = {
  resetAt: daysFromNow(11),
  rows: [
    { rank: 1, name: 'Yetunde Ade', activityKobo: 12_400_000, verifiedReferrals: 18, isYou: false },
    { rank: 2, name: 'Chuka Eze', activityKobo: 9_200_000, verifiedReferrals: 11, isYou: false },
    { rank: 3, name: 'Halima Bello', activityKobo: 6_800_000, verifiedReferrals: 9, isYou: false },
    { rank: 4, name: 'Peter Obi', activityKobo: 800_000, verifiedReferrals: 2, isYou: false },
  ],
  targets: [
    { label: 'Active members', current: 9, target: 12, unit: 'members' },
    { label: 'Verified network referrals', current: 40, target: 60, unit: 'referrals' },
  ],
};

const MOCK_TRAINING: TrainingResource[] = [
  { id: 't1', title: 'Compliant pitch script', type: 'script', blurb: 'Talk about real value — never promise income for "joining".', compliance: true, icon: 'ScrollText' },
  { id: 't2', title: 'What you must NOT say', type: 'policy', blurb: 'No guaranteed earnings, no recruitment promises, no exaggerated claims.', compliance: true, icon: 'ShieldCheck' },
  { id: 't3', title: 'Onboarding a new member', type: 'guide', blurb: 'Step-by-step: invite, verify, support genuine activity.', compliance: false, icon: 'UserPlus' },
  { id: 't4', title: 'Helping members activate', type: 'video', blurb: 'Coach members to drive real transactions, not signups.', compliance: false, icon: 'GraduationCap' },
];

const MOCK_DISCLOSURE: AgentDisclosure = {
  overrideRate: OVERRIDE_RATE,
  capKobo: OVERRIDE_CAP_KOBO,
  maxDepth: 1,
  version: 'agent-disclosure-v1.2',
  accepted: false,
  points: [
    `Overrides are ${(OVERRIDE_RATE * 100).toFixed(0)}% of your network members' VERIFIED activity and revenue — never a payment for recruiting people.`,
    'There is no reward for signing people up. If a member never genuinely uses Paymax, you earn nothing from them.',
    `Overrides are capped at ${'₦' + (OVERRIDE_CAP_KOBO / 100).toLocaleString('en-NG')} per period; we do not pay uncapped multi-level downline bonuses.`,
    'Override depth is limited by policy (single level) — this is not a multi-tier MLM.',
    'You must never promise guaranteed income or exaggerate earnings to recruits.',
    'Fraud, fake accounts, or self-referral in your network leads to clawbacks and review.',
  ],
};

export async function getTeamDashboard(): Promise<TeamDashboard> {
  if (USE_MOCK) {
    await delay();
    return { ...MOCK_DASHBOARD };
  }
  const network = await fetchPrimaryNetwork();
  if (!network) {
    // No network led by this user → empty team, no override accrual.
    return {
      teamName: '',
      memberCount: 0,
      activeMemberCount: 0,
      overrideEarnedKobo: 0,
      networkActivityKobo: 0,
      // TODO(referral phase3): no per-network policy rate/cap endpoint yet;
      // display-only defaults from module policy.
      overrideRate: OVERRIDE_RATE,
      overrideCapKobo: OVERRIDE_CAP_KOBO,
      capUsedKobo: 0,
    };
  }

  const [members, overrides] = await Promise.all([
    fetchNetworkMembers(network.id),
    fetchOverrides(),
  ]);

  const overrideEarnedKobo = overrides.reduce((sum, o) => sum + o.amount_kobo, 0);
  const networkActivityKobo = overrides.reduce((sum, o) => sum + o.activity_base_kobo, 0);

  return {
    teamName: network.name,
    memberCount: members.length,
    activeMemberCount: members.filter((m) => m.status === 'active').length,
    overrideEarnedKobo,
    networkActivityKobo,
    // TODO(referral phase3): no per-network policy rate/cap endpoint yet;
    // display-only defaults from module policy.
    overrideRate: OVERRIDE_RATE,
    overrideCapKobo: OVERRIDE_CAP_KOBO,
    // Cap usage tracks accrued overrides against the display cap.
    capUsedKobo: overrideEarnedKobo,
  };
}

export async function getTeamInvites(): Promise<TeamInvite[]> {
  if (USE_MOCK) {
    await delay(220);
    return MOCK_INVITES.map((i) => ({ ...i }));
  }
  // TODO(referral phase3): no backend endpoint yet.
  return [];
}

export async function onboardSubReferrer(input: { name: string; contact: string }): Promise<OnboardResult> {
  if (USE_MOCK) {
    await delay(380);
    return { ok: true, inviteId: `inv-${Math.floor(Math.random() * 9000 + 1000)}` };
  }
  // TODO(referral phase3): no backend endpoint yet — do not fabricate a
  // persisted invite. Surface a clear "not available" error to the UI.
  throw new Error('Team onboarding is not available yet.');
}

export async function getTeamMembers(): Promise<TeamMember[]> {
  if (USE_MOCK) {
    await delay(240);
    return MOCK_MEMBERS.map((m) => ({ ...m }));
  }
  const network = await fetchPrimaryNetwork();
  if (!network) return [];
  const members = await fetchNetworkMembers(network.id);
  return members.map(toTeamMember);
}

export async function getMemberDetail(id: string): Promise<MemberDetail> {
  if (USE_MOCK) {
    await delay(220);
    const m = MOCK_MEMBERS.find((x) => x.id === id);
    if (!m) throw new Error('Member not found');
    return buildMemberDetail(m);
  }
  // No member-detail endpoint — fetch the network's members and find by id.
  const network = await fetchPrimaryNetwork();
  const members = network ? await fetchNetworkMembers(network.id) : [];
  const found = members.find((m) => m.id === id);
  if (!found) throw new Error('Member not found');
  const base = toTeamMember(found);
  return {
    ...base,
    // TODO(referral phase3): no per-member activity breakdown endpoint yet;
    // activityBasis copy is compliance boilerplate, rows are empty until the
    // override attribution is exposed per member.
    activityBasis:
      `Your override from this member is a capped percentage of their VERIFIED activity ` +
      `(real transactions and revenue from the people they personally refer who actually use Paymax). ` +
      `It is NOT a payment for recruiting them or anyone else, and it is capped per period.`,
    rows: [],
  };
}

export async function getOverrideLedger(): Promise<OverrideLedger> {
  if (USE_MOCK) {
    await delay(240);
    return { ...MOCK_LEDGER, rows: MOCK_LEDGER.rows.map((r) => ({ ...r })) };
  }
  const overrides = await fetchOverrides();
  const rows = overrides.map((o) => ({
    id: o.id,
    // TODO(referral phase3): overrides carry source_user_id, not a display
    // name — use it as a stand-in until a profile join lands.
    memberName: o.source_user_id ?? '',
    activityKobo: o.activity_base_kobo,
    // override_bps is basis points (1/100 of a percent); convert to a 0..1 rate.
    rate: o.override_bps / 10_000,
    overrideKobo: o.amount_kobo,
    capped: o.cap_applied_kobo > 0,
    at: o.created_at,
  }));
  const totalOverrideKobo = rows.reduce((sum, r) => sum + r.overrideKobo, 0);
  const totalActivityKobo = rows.reduce((sum, r) => sum + r.activityKobo, 0);
  return {
    // TODO(referral phase3): no aggregate policy rate/cap endpoint yet — derive
    // the representative rate from the first row, fall back to module default.
    rate: rows.length > 0 ? rows[0].rate : OVERRIDE_RATE,
    capKobo: OVERRIDE_CAP_KOBO,
    capUsedKobo: totalOverrideKobo,
    totalOverrideKobo,
    totalActivityKobo,
    rows,
  };
}

export async function getTeamLeaderboard(): Promise<TeamLeaderboard> {
  if (USE_MOCK) {
    await delay(220);
    return {
      ...MOCK_LEADERBOARD,
      rows: MOCK_LEADERBOARD.rows.map((r) => ({ ...r })),
      targets: MOCK_LEADERBOARD.targets.map((t) => ({ ...t })),
    };
  }
  // TODO(referral phase3): no backend endpoint yet.
  return { resetAt: null, rows: [], targets: [] };
}

export async function getTraining(): Promise<TrainingResource[]> {
  if (USE_MOCK) {
    await delay(220);
    return MOCK_TRAINING.map((t) => ({ ...t }));
  }
  // TODO(referral phase3): no backend endpoint yet.
  return [];
}

export async function getAgentDisclosure(): Promise<AgentDisclosure> {
  if (USE_MOCK) {
    await delay(200);
    return { ...MOCK_DISCLOSURE, points: [...MOCK_DISCLOSURE.points] };
  }
  // TODO(referral phase3): no backend endpoint yet — return the module's
  // display-only disclosure (compliance copy is load-bearing, unaccepted).
  return { ...MOCK_DISCLOSURE, points: [...MOCK_DISCLOSURE.points] };
}

export async function acceptAgentDisclosure(version: string): Promise<{ ok: boolean }> {
  if (USE_MOCK) {
    await delay(300);
    return { ok: true };
  }
  // TODO(referral phase3): no backend endpoint yet — no-op success so the UI
  // can proceed; server-side acceptance persistence lands later.
  return { ok: true };
}
