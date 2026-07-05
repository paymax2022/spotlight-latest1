// ── Referral Earnings & Rewards API ──────────────────────────────────────────
// Mock-first (USE_MOCK). withdraw/getWithdrawQuote hit the real RB0 endpoints
// under `${REFERRAL_API_BASE}` (my-rewards/withdraw-eligible/withdraw). The
// per-row ledger (getLedger/getRewardDetail/getStatement) has no RB0 member
// endpoint, so it is sourced from the Direct Rewards engine at
// `${REWARDS_ENGINE_BASE}` (= '/api/v1/referrals', plural — see home/api.ts).
// getVestingSchedule/getCurrencyOptions/setRewardCurrency/getCatalog/
// redeemCatalogItem/exportStatement/getClawbackNotice/appealClawback have NO
// backend endpoint at all (content-only or genuinely missing) — see the
// per-function TODOs. Money is ALWAYS integer kobo. The withdraw mutation
// attaches an Idempotency-Key on the live path (money mutation). Rewards tie
// to friends' verified activity (§7).

import { api } from '@/api/client';
import { generateIdempotencyKey } from '@/utils/idempotency';
import { USE_MOCK, REFERRAL_API_BASE } from '../constants/referral.constants';
import type {
  RewardLedgerRow,
  RewardDetail,
  VestingSchedule,
  WithdrawQuote,
  WithdrawResult,
  CurrencyOption,
  RewardCurrency,
  CatalogItem,
  RedeemResult,
  StatementSummary,
  StatementPeriod,
  StatementExport,
  ClawbackNotice,
  AppealInput,
  AppealResult,
} from './types';

const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));

function unwrap<T>(res: { data?: { data?: T } & T }): T {
  return (res.data?.data ?? res.data) as T;
}

// ── Direct Rewards engine (live source for the ledger list) ─────────────────
// RB0 (REFERRAL_API_BASE) has NO per-row member ledger endpoint — only the
// aggregate GET /my-rewards summary and GET /withdraw-eligible/POST /withdraw
// (see backend/internal/referral/ledger/handlers.go). The per-row ledger list
// (M-ERN-01) is sourced from the fully-live Direct Rewards engine instead, at
// GET /api/v1/referrals/me/earnings (backend/internal/finance/referrals/
// rewards_handler.go:106 GetEarnings), mirroring home/api.ts's getActivity().
const REWARDS_ENGINE_BASE = '/api/v1/referrals';

interface EngineEarning {
  id: string;
  referred_user_id: string;
  module: string;
  margin_kobo: number;
  applied_rate: number;
  reward_kobo: number;
  status: string; // 'PENDING' | 'CREDITED' | 'REVERSED' (rewards_model.go:16-18)
  created_at: string;
  credited_at?: string;
  reversed_at?: string;
}

// Map the engine's uppercase reward status → reward-ledger EarnStateKey.
// The engine is a simpler 3-state machine (PENDING/CREDITED/REVERSED) than the
// full §7 RB0 ledger (earned→pending→vesting→eligible→paid+clawed_back), so
// this is a best-fit projection, not a 1:1 mapping.
function mapEngineStatus(status: string): RewardLedgerRow['state'] {
  switch (status) {
    case 'PENDING':
      return 'pending';
    case 'CREDITED':
      return 'paid';
    case 'REVERSED':
      return 'clawed_back';
    default:
      return 'earned';
  }
}

function mapEngineEarningToRow(e: EngineEarning): RewardLedgerRow {
  return {
    id: e.id,
    state: mapEngineStatus(e.status),
    kind: 'referrer',
    amountKobo: Math.trunc(e.reward_kobo ?? 0),
    currency: 'NGN',
    // TODO(referral phase3): engine returns referred_user_id, not a display name.
    inviteeName: e.referred_user_id || null,
    // TODO(referral phase3): engine has no qualifying-action taxonomy; the
    // module name is the closest available signal — default to first_transaction.
    qualifyingAction: 'first_transaction',
    createdAt: e.created_at,
    updatedAt: e.reversed_at ?? e.credited_at ?? e.created_at,
    vestingScheduleId: null,
    clawbackId: e.status === 'REVERSED' ? e.id : null,
  };
}

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const daysFromNow = (d: number) => new Date(Date.now() + d * 86400_000).toISOString();

// ── Mock fixtures — a row across EVERY reward-ledger state (§7) ───────────────
const MOCK_LEDGER: RewardLedgerRow[] = [
  { id: 'r1', state: 'eligible', kind: 'referrer', amountKobo: 100_000, currency: 'NGN', inviteeName: 'Amara Eze', qualifyingAction: 'first_transaction', createdAt: minsAgo(20000), updatedAt: minsAgo(60) },
  { id: 'r2', state: 'eligible', kind: 'referrer', amountKobo: 50_000, currency: 'NGN', inviteeName: 'Bola Adeyemi', qualifyingAction: 'kyc_completed', createdAt: minsAgo(9000), updatedAt: minsAgo(1500) },
  { id: 'r3', state: 'vesting', kind: 'referrer', amountKobo: 100_000, currency: 'NGN', inviteeName: 'Ngozi Okoro', qualifyingAction: 'retained_30d', createdAt: minsAgo(7000), updatedAt: minsAgo(200), vestingScheduleId: 'vs1' },
  { id: 'r4', state: 'pending', kind: 'referee', amountKobo: 50_000, currency: 'NGN', inviteeName: 'Tunde Bakare', qualifyingAction: 'first_transaction', createdAt: minsAgo(140), updatedAt: minsAgo(140) },
  { id: 'r5', state: 'earned', kind: 'mission', amountKobo: 30_000, currency: 'NGN', inviteeName: null, qualifyingAction: 'mission_complete', createdAt: minsAgo(80), updatedAt: minsAgo(80) },
  { id: 'r6', state: 'paid', kind: 'referrer', amountKobo: 100_000, currency: 'NGN', inviteeName: 'Emeka Obi', qualifyingAction: 'first_transaction', createdAt: minsAgo(43200), updatedAt: minsAgo(4320) },
  { id: 'r7', state: 'paid', kind: 'referrer', amountKobo: 100_000, currency: 'NGN', inviteeName: 'Fatima Sule', qualifyingAction: 'retained_60d', createdAt: minsAgo(50000), updatedAt: minsAgo(7000) },
  { id: 'r8', state: 'clawed_back', kind: 'referrer', amountKobo: 50_000, currency: 'NGN', inviteeName: 'Unknown', qualifyingAction: 'kyc_completed', createdAt: minsAgo(60000), updatedAt: minsAgo(8640), clawbackId: 'cb1' },
];

const MOCK_DETAILS: Record<string, RewardDetail> = Object.fromEntries(
  MOCK_LEDGER.map((row) => {
    const detail: RewardDetail = {
      ...row,
      explanation:
        row.kind === 'mission'
          ? 'Earned for completing a referral mission. Mission rewards still require your invited friends to be genuine, verified users.'
          : `Tied to ${row.inviteeName ?? 'your friend'}'s real, verified activity (${humanAction(row.qualifyingAction)}). You earn because they actually use Paymax — not because they signed up.`,
      timeline: buildTimeline(row.state, row.createdAt, row.updatedAt),
    };
    return [row.id, detail];
  }),
);

function humanAction(a: RewardLedgerRow['qualifyingAction']): string {
  switch (a) {
    case 'kyc_completed': return 'completed KYC';
    case 'first_transaction': return 'made a first transaction';
    case 'retained_30d': return 'stayed active for 30 days';
    case 'retained_60d': return 'stayed active for 60 days';
    case 'retained_90d': return 'stayed active for 90 days';
    case 'mission_complete': return 'mission completed';
  }
}

function buildTimeline(state: RewardLedgerRow['state'], createdAt: string, updatedAt: string): RewardDetail['timeline'] {
  const order: { state: RewardDetail['timeline'][number]['state']; label: string }[] = [
    { state: 'earned', label: 'Reward earned' },
    { state: 'pending', label: 'Pending qualifying action' },
    { state: 'vesting', label: 'Vesting' },
    { state: 'eligible', label: 'Ready to withdraw' },
    { state: 'paid', label: 'Paid to wallet' },
  ];
  if (state === 'clawed_back') {
    return [
      { state: 'earned', label: 'Reward earned', at: createdAt, done: true },
      { state: 'clawed_back', label: 'Reversed (invalid referral)', at: updatedAt, done: true },
    ];
  }
  const idx = order.findIndex((o) => o.state === state);
  return order.map((o, i) => ({
    state: o.state,
    label: o.label,
    at: i === 0 ? createdAt : i === idx ? updatedAt : '',
    done: i <= idx,
  }));
}

const MOCK_VESTING: VestingSchedule = {
  id: 'vs1',
  rewardId: 'r3',
  inviteeName: 'Ngozi Okoro',
  totalKobo: 100_000,
  unlockedKobo: 30_000,
  currency: 'NGN',
  tranches: [
    { id: 'vt1', label: 'On KYC', amountKobo: 30_000, condition: 'kyc_completed', unlocksAt: minsAgo(200), unlocked: true },
    { id: 'vt2', label: 'On first transaction', amountKobo: 30_000, condition: 'first_transaction', unlocksAt: daysFromNow(2), unlocked: false },
    { id: 'vt3', label: 'Retained 30 days', amountKobo: 40_000, condition: 'retained_30d', unlocksAt: daysFromNow(24), unlocked: false },
  ],
};

const MOCK_QUOTE: WithdrawQuote = {
  eligibleKobo: 150_000,
  minWithdrawKobo: 10_000,
  feeKobo: 0,
  currency: 'NGN',
  withdrawable: true,
  blockedReason: null,
};

const MOCK_CURRENCIES: CurrencyOption[] = [
  { key: 'cash', label: 'Cash to wallet', icon: 'Wallet', blurb: 'Instant transfer to your Spotlight wallet.', active: true },
  { key: 'airtime_data', label: 'Airtime & data', icon: 'Smartphone', blurb: 'Top up any Nigerian network.', active: false },
  { key: 'points', label: 'Points', icon: 'Sparkles', blurb: 'Collect points to redeem in the catalog.', active: false },
  { key: 'discount', label: 'Discounts', icon: 'Percent', blurb: 'Apply to fees and partner offers.', active: false },
  { key: 'charity', label: 'Donate to charity', icon: 'Heart', blurb: 'Give your earnings to a verified cause.', active: false },
];

const MOCK_CATALOG: CatalogItem[] = [
  { id: 'cat1', name: 'MTN ₦500 airtime', category: 'airtime', costPoints: 500, icon: 'Smartphone', available: true },
  { id: 'cat2', name: '1GB data bundle', category: 'data', costPoints: 800, icon: 'Wifi', available: true },
  { id: 'cat3', name: '₦1,000 gift card', category: 'gift_card', costPoints: 1100, icon: 'Gift', available: true },
  { id: 'cat4', name: '10% fee discount', category: 'discount', costPoints: 300, icon: 'Percent', available: true },
  { id: 'cat5', name: 'Donate ₦500 to charity', category: 'charity', costPoints: 500, icon: 'Heart', available: false },
];

const MOCK_STATEMENTS: Record<StatementPeriod, StatementSummary> = {
  '30d': { period: '30d', fromIso: minsAgo(43200), toIso: new Date().toISOString(), earnedKobo: 230_000, paidKobo: 100_000, clawedBackKobo: 0, rows: 5, currency: 'NGN' },
  '90d': { period: '90d', fromIso: minsAgo(129600), toIso: new Date().toISOString(), earnedKobo: 480_000, paidKobo: 200_000, clawedBackKobo: 50_000, rows: 8, currency: 'NGN' },
  'ytd': { period: 'ytd', fromIso: minsAgo(259200), toIso: new Date().toISOString(), earnedKobo: 500_000, paidKobo: 200_000, clawedBackKobo: 50_000, rows: 8, currency: 'NGN' },
  'all': { period: 'all', fromIso: minsAgo(525600), toIso: new Date().toISOString(), earnedKobo: 500_000, paidKobo: 200_000, clawedBackKobo: 50_000, rows: 8, currency: 'NGN' },
};

const MOCK_CLAWBACK: ClawbackNotice = {
  id: 'cb1',
  rewardId: 'r8',
  inviteeName: 'Unknown',
  amountKobo: 50_000,
  currency: 'NGN',
  reason: 'duplicate_kyc',
  reasonLabel: 'Duplicate identity',
  explanation:
    'This reward was reversed because the referred account shared a verified identity (KYC) with an existing user. ' +
    'Rewards are paid only on genuine new users with real activity, so this referral did not qualify. ' +
    'If you believe this is a mistake, you can appeal with evidence.',
  reversedAt: minsAgo(8640),
  appealable: true,
  appealDeadline: hoursFromNow(14 * 24),
  appealStatus: 'none',
};

// ── Calls ─────────────────────────────────────────────────────────────────────
export async function getLedger(): Promise<RewardLedgerRow[]> {
  if (USE_MOCK) {
    await delay();
    return MOCK_LEDGER.map((r) => ({ ...r }));
  }
  // Live: no RB0 per-row member endpoint exists (only the aggregate my-rewards
  // summary). Source the ledger list from the Direct Rewards engine instead.
  const res = await api.get(`${REWARDS_ENGINE_BASE}/me/earnings?limit=50&offset=0`);
  const body = unwrap<{ earnings: EngineEarning[] }>(res);
  const earnings = body?.earnings ?? [];
  return earnings.map(mapEngineEarningToRow);
}

export async function getRewardDetail(id: string): Promise<RewardDetail> {
  if (USE_MOCK) {
    await delay(220);
    const d = MOCK_DETAILS[id];
    if (!d) throw new Error('Reward not found');
    return { ...d, timeline: d.timeline.map((t) => ({ ...t })) };
  }
  // Live: no dedicated reward-detail endpoint (RB0 or engine). Derive detail
  // from the same engine earnings list used by getLedger() and build a
  // minimal timeline/explanation client-side (no fabricated backend fields).
  const res = await api.get(`${REWARDS_ENGINE_BASE}/me/earnings?limit=50&offset=0`);
  const body = unwrap<{ earnings: EngineEarning[] }>(res);
  const found = (body?.earnings ?? []).find((e) => e.id === id);
  if (!found) throw new Error('Reward not found');
  const row = mapEngineEarningToRow(found);
  return {
    ...row,
    explanation:
      row.kind === 'mission'
        ? 'Earned for completing a referral mission.'
        : `Tied to your friend's real, verified activity on the ${found.module} module. ` +
          'You earn because they actually use Paymax — not because they signed up.',
    timeline: buildTimeline(row.state, row.createdAt, row.updatedAt),
  };
}

// No backend endpoint exists for a per-reward vesting schedule (RB0 has no
// vesting sub-resource; the engine has no vesting concept at all — it is a
// flat PENDING→CREDITED/REVERSED state machine, see rewards_model.go). Kept
// mock-only; do not fabricate a live call against a non-existent path.
export async function getVestingSchedule(scheduleId?: string): Promise<VestingSchedule> {
  if (USE_MOCK) {
    await delay(240);
    return { ...MOCK_VESTING, tranches: MOCK_VESTING.tranches.map((t) => ({ ...t })) };
  }
  // TODO(referral phase3, backend gap): no vesting-schedule endpoint on RB0 or
  // the Direct Rewards engine. Return the mock shape shaped as "no schedule"
  // rather than hitting a path that would 404.
  void scheduleId;
  return { ...MOCK_VESTING, id: '', rewardId: '', totalKobo: 0, unlockedKobo: 0, tranches: [] };
}

export async function getWithdrawQuote(): Promise<WithdrawQuote> {
  if (USE_MOCK) {
    await delay(220);
    return { ...MOCK_QUOTE };
  }
  // Live: GET /withdraw-eligible → { beneficiary_id, eligible_kobo, currency }
  // (RB0 reward-ledger summary). The KYC gate + all-or-nothing sweep is enforced
  // server-side on POST /withdraw, so the quote reflects only the eligible total.
  const res = await api.get(`${REFERRAL_API_BASE}/withdraw-eligible`);
  const body = unwrap<{ eligible_kobo?: number; currency?: string }>(res);
  const eligibleKobo = Math.trunc(body.eligible_kobo ?? 0);
  return {
    eligibleKobo,
    // TODO(referral phase3): backend enforces no minimum / no fee on this sweep.
    minWithdrawKobo: 0,
    feeKobo: 0,
    currency: body.currency ?? 'NGN',
    // KYC is checked at withdraw time (403 if below tier); optimistic here.
    withdrawable: eligibleKobo > 0,
    blockedReason: null,
  };
}

// Money mutation: attaches an Idempotency-Key on the live path (kobo).
export async function withdraw(amountKobo: number): Promise<WithdrawResult> {
  if (USE_MOCK) {
    await delay(420);
    if (amountKobo < MOCK_QUOTE.minWithdrawKobo) {
      return { ok: false, amountKobo, newEligibleKobo: MOCK_QUOTE.eligibleKobo, walletBalanceKobo: 0, reference: '', error: 'below_min' };
    }
    if (amountKobo > MOCK_QUOTE.eligibleKobo) {
      return { ok: false, amountKobo, newEligibleKobo: MOCK_QUOTE.eligibleKobo, walletBalanceKobo: 0, reference: '', error: 'insufficient' };
    }
    return {
      ok: true,
      amountKobo,
      newEligibleKobo: MOCK_QUOTE.eligibleKobo - amountKobo,
      walletBalanceKobo: 500_000 + amountKobo,
      reference: `RWD-WD-${Math.floor(Math.random() * 900000 + 100000)}`,
    };
  }
  // Live: POST /withdraw sweeps ALL eligible reward rows → wallet (balanced
  // double-entry per row, server-side). The endpoint is all-or-nothing and does
  // not read a body/amount; `amountKobo` here is informational only. Requires an
  // Idempotency-Key (money mutation). 403 ⇒ KYC tier below the withdrawal floor.
  try {
    const res = await api.post(
      `${REFERRAL_API_BASE}/withdraw`,
      {},
      { headers: { 'Idempotency-Key': generateIdempotencyKey() } },
    );
    const body = unwrap<{
      withdrawn_kobo?: number;
      remaining_eligible_kobo?: number;
      beneficiary_id?: string;
    }>(res);
    const withdrawn = Math.trunc(body.withdrawn_kobo ?? 0);
    return {
      ok: true,
      amountKobo: withdrawn,
      newEligibleKobo: Math.trunc(body.remaining_eligible_kobo ?? 0),
      // TODO(referral phase3): backend does not return the post-credit wallet
      // balance; fetch it from the wallet endpoint if the screen needs it.
      walletBalanceKobo: 0,
      reference: body.beneficiary_id ? `RWD-WD-${body.beneficiary_id.slice(0, 8)}` : '',
    };
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    return {
      ok: false,
      amountKobo,
      newEligibleKobo: 0,
      walletBalanceKobo: 0,
      reference: '',
      error: status === 403 ? 'kyc_required' : 'failed',
    };
  }
}

// No backend endpoint exists for reward-payout currency selection (RB0's
// withdraw sweep always pays NGN into the Spotlight wallet; there is no
// airtime/points/discount/charity payout rail). Content/FX-only feature —
// kept mock-only; do not fabricate a live call.
export async function getCurrencyOptions(): Promise<CurrencyOption[]> {
  if (USE_MOCK) {
    await delay(200);
    return MOCK_CURRENCIES.map((c) => ({ ...c }));
  }
  // TODO(referral phase3, backend gap): no GET /earnings/currencies endpoint.
  // Return only the always-true 'cash' rail (the one real payout path).
  return MOCK_CURRENCIES.map((c) => ({ ...c, active: c.key === 'cash' }));
}

export async function setRewardCurrency(key: RewardCurrency): Promise<CurrencyOption[]> {
  if (USE_MOCK) {
    await delay(220);
    return MOCK_CURRENCIES.map((c) => ({ ...c, active: c.key === key }));
  }
  // TODO(referral phase3, backend gap): no POST /earnings/currencies endpoint.
  // Non-cash payout rails are not implemented server-side; only 'cash' is real.
  throw new Error('Only cash payouts to your wallet are available right now.');
}

// No backend endpoint exists for a rewards catalog / points system (RB0 and
// the Direct Rewards engine both pay cash-kobo only; there is no points
// ledger). Content/points-only feature — kept mock-only.
export async function getCatalog(): Promise<{ items: CatalogItem[]; pointsBalance: number }> {
  if (USE_MOCK) {
    await delay(260);
    return { items: MOCK_CATALOG.map((i) => ({ ...i })), pointsBalance: 1250 };
  }
  // TODO(referral phase3, backend gap): no GET /earnings/catalog endpoint.
  return { items: [], pointsBalance: 0 };
}

export async function redeemCatalogItem(id: string): Promise<RedeemResult> {
  if (USE_MOCK) {
    await delay(360);
    const item = MOCK_CATALOG.find((i) => i.id === id);
    if (!item) return { ok: false, item: '', remainingPoints: 1250, reference: '', error: 'out_of_stock' };
    if (!item.available) return { ok: false, item: item.name, remainingPoints: 1250, reference: '', error: 'out_of_stock' };
    if (item.costPoints > 1250) return { ok: false, item: item.name, remainingPoints: 1250, reference: '', error: 'insufficient_points' };
    return { ok: true, item: item.name, remainingPoints: 1250 - item.costPoints, reference: `RDM-${Math.floor(Math.random() * 900000 + 100000)}` };
  }
  // TODO(referral phase3, backend gap): no POST /earnings/catalog/:id/redeem
  // endpoint — there is no points ledger to debit. Do not fabricate a redemption.
  void id;
  throw new Error('Reward catalog redemption is not available yet.');
}

// No backend endpoint exists for a statement summary (RB0 exposes only the
// live aggregate my-rewards summary and the engine's raw earnings list — no
// period-bounded rollup). Derive a best-effort statement client-side from the
// engine earnings list rather than fabricating a /statement call.
export async function getStatement(period: StatementPeriod): Promise<StatementSummary> {
  if (USE_MOCK) {
    await delay(240);
    return { ...MOCK_STATEMENTS[period] };
  }
  const now = new Date();
  const days = period === '30d' ? 30 : period === '90d' ? 90 : period === 'ytd' ? Math.ceil((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400_000) : 36500;
  const fromIso = new Date(now.getTime() - days * 86400_000).toISOString();
  const res = await api.get(`${REWARDS_ENGINE_BASE}/me/earnings?limit=500&offset=0`);
  const body = unwrap<{ earnings: EngineEarning[] }>(res);
  const rows = (body?.earnings ?? []).filter((e) => e.created_at >= fromIso);
  let earnedKobo = 0;
  let paidKobo = 0;
  let clawedBackKobo = 0;
  for (const r of rows) {
    const amt = Math.trunc(r.reward_kobo ?? 0);
    if (r.status === 'REVERSED') clawedBackKobo += amt;
    else earnedKobo += amt;
    if (r.status === 'CREDITED') paidKobo += amt;
  }
  return {
    period,
    fromIso,
    toIso: now.toISOString(),
    earnedKobo,
    paidKobo,
    clawedBackKobo,
    rows: rows.length,
    currency: 'NGN',
  };
}

// No backend endpoint exists to render a PDF/CSV export file. Content-only /
// genuinely missing — kept mock-only.
export async function exportStatement(period: StatementPeriod, format: 'pdf' | 'csv'): Promise<StatementExport> {
  if (USE_MOCK) {
    await delay(400);
    return { ok: true, url: `https://spotlight.ng/statements/${period}.${format}`, format };
  }
  // TODO(referral phase3, backend gap): no POST /earnings/statement/export
  // endpoint (no file-generation service). Do not fabricate a download URL.
  void period;
  void format;
  return { ok: false, url: null, format };
}

// No backend endpoint exists for a clawback-notice detail (RB0's ledger has no
// per-row detail or reason taxonomy for the member; REVERSED rows on the
// engine carry no reason field either — see rewards_model.go). Kept mock-only.
export async function getClawbackNotice(id?: string): Promise<ClawbackNotice> {
  if (USE_MOCK) {
    await delay(220);
    return { ...MOCK_CLAWBACK };
  }
  // TODO(referral phase3, backend gap): no GET /earnings/clawbacks/:id
  // endpoint and no reason/appeal fields on the backend reward row.
  void id;
  throw new Error('Clawback detail is not available yet.');
}

// No backend endpoint exists to file a clawback appeal (no case-management
// resource on RB0 or the engine). Kept mock-only; do not fabricate a case id.
export async function appealClawback(input: AppealInput): Promise<AppealResult> {
  if (USE_MOCK) {
    await delay(420);
    return { ok: true, caseId: `APL-${Math.floor(Math.random() * 9000 + 1000)}` };
  }
  // TODO(referral phase3, backend gap): no POST /earnings/clawbacks/:id/appeal
  // endpoint.
  void input;
  throw new Error('Clawback appeals are not available yet.');
}
