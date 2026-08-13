import { api } from '@/api/client';
import * as envelope from './envelope';
import { USE_MOCK, API_BASE } from './constants/savings.constants';
import type {
  Vault,
  CreateVaultInput,
  EarlyWithdrawQuote,
  AjoCircle,
  CreateCircleInput,
  GroupTarget,
  CreateGroupTargetInput,
  SavingsSummary,
  ContributionResult,
} from './types';

const delay = (ms = 280) => new Promise((r) => setTimeout(r, ms));

// Backend wraps success payloads as { success: true, [key]: value } or { data: T }.
// unwrap() returns that ENVELOPE — not the entity inside it. Mutation callers
// below rely on that, because they read `balance_kobo` directly off the
// envelope (`{ success, balance_kobo }`).
//
// Entity/list reads must therefore go through the `envelope.*` helpers to pull
// their payload out by key. Calling unwrap() alone for a list yields the
// envelope object, `Array.isArray()` is false, and the read silently degrades
// to `[]` — an empty screen with no error. See ./envelope.ts.
function unwrap<T>(res: { data: unknown }): T {
  return envelope.body(res) as T;
}

// Convert snake_case Go response to camelCase TypeScript types.
// Go returns: { id, owner_user_id, target_kobo, created_at, matures_at, ... }
// TS expects: { id, ownerUserId, targetKobo, createdAtISO, maturesAtISO, ... }
function vaultFromBackend(raw: any): Vault {
  if (!raw) return raw;
  return {
    id: raw.id,
    name: raw.name,
    emoji: raw.emoji,
    status: raw.state?.toUpperCase() === 'LOCK' ? 'LOCKED' : raw.state || 'OPEN',
    balanceKobo: raw.balance_kobo ?? 0,
    targetKobo: raw.target_kobo ?? null,
    maturesAtISO: raw.matures_at ?? null,
    createdAtISO: raw.created_at,
    autoSave: raw.autosave ? {
      enabled: raw.autosave.enabled ?? true,
      amountKobo: raw.autosave.amount_kobo ?? 0,
      frequency: (raw.autosave.interval_secs === 86400 ? 'daily' : raw.autosave.interval_secs === 604800 ? 'weekly' : 'monthly') as any,
      nextRunISO: raw.autosave.next_run ?? null,
      source: 'wallet',
    } : null,
    streak: raw.streak ?? 0,
    interestKobo: 0,
  } as Vault;
}

function circleFromBackend(raw: any): AjoCircle {
  if (!raw) return raw;
  return {
    id: raw.id,
    name: raw.name,
    status: raw.state || 'FORMING',
    contributionKobo: raw.contribution_kobo ?? 0,
    frequency: (raw.interval_secs === 86400 ? 'daily' : raw.interval_secs === 604800 ? 'weekly' : 'monthly') as any,
    memberCount: raw.member_count ?? 0,
    members: (raw.members ?? []).map((m: any) => ({
      id: m.id,
      name: m.name,
      handle: m.handle,
      avatarColor: m.avatar_color,
      status: m.state,
      payoutOrder: m.payout_order ?? 1,
      paidThisCycle: m.paid_this_cycle ?? false,
    })),
    cycles: (raw.cycles ?? []).map((c: any) => ({
      index: c.cycle_number ?? 1,
      status: c.state,
      dueISO: c.due_date ?? new Date().toISOString(),
      beneficiaryId: c.beneficiary_id,
      collectedKobo: c.collected_kobo ?? 0,
      potKobo: (raw.contribution_kobo ?? 0) * (raw.member_count ?? 1),
    })),
    currentCycle: raw.current_cycle ?? 0,
    paymaxGuarantees: false,
  } as AjoCircle;
}

function targetFromBackend(raw: any): GroupTarget {
  if (!raw) return raw;
  return {
    id: raw.id,
    name: raw.name,
    targetKobo: raw.target_kobo ?? 0,
    savedKobo: raw.saved_kobo ?? 0,
    deadlineISO: raw.target_date ?? raw.deadline,
    withdrawalRule: raw.withdrawal_rule === 'majority' ? 'majority-approval' : 'on-date',
    contributors: (raw.contributors ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      handle: c.handle,
      avatarColor: c.avatar_color,
      pledgedKobo: c.pledged_kobo ?? 0,
      savedKobo: c.saved_kobo ?? 0,
    })),
    interestKobo: 0,
  } as GroupTarget;
}

// Every money mutation carries an Idempotency-Key (NL-9).
function idempotencyKey(): string {
  return `sav-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const daysAgo     = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

// ── Mock fixtures (vaults across OPEN / LOCKED / FLEX / MATURED) ──────────────
const MOCK_VAULTS: Vault[] = [
  {
    id: 'v_open', name: 'Rainy Day', emoji: '☔️', status: 'OPEN',
    balanceKobo: 4_500_000, targetKobo: 20_000_000, maturesAtISO: null,
    createdAtISO: daysAgo(40), streak: 6, interestKobo: 0,
    autoSave: { enabled: true, amountKobo: 500_000, frequency: 'weekly', nextRunISO: daysFromNow(3), source: 'wallet' },
  },
  {
    id: 'v_locked', name: 'New Car', emoji: '🚗', status: 'LOCKED',
    balanceKobo: 32_000_000, targetKobo: 80_000_000, maturesAtISO: daysFromNow(120),
    createdAtISO: daysAgo(90), streak: 12, interestKobo: 0,
    autoSave: { enabled: true, amountKobo: 2_000_000, frequency: 'monthly', nextRunISO: daysFromNow(12), source: 'wallet' },
  },
  {
    id: 'v_flex', name: 'Holiday', emoji: '🏖️', status: 'FLEX',
    balanceKobo: 12_750_000, targetKobo: 50_000_000, maturesAtISO: null,
    createdAtISO: daysAgo(20), streak: 3, interestKobo: 0, autoSave: null,
  },
  {
    id: 'v_matured', name: 'School Fees', emoji: '🎓', status: 'MATURED',
    balanceKobo: 60_000_000, targetKobo: 60_000_000, maturesAtISO: daysAgo(2),
    createdAtISO: daysAgo(200), streak: 24, interestKobo: 0, autoSave: null,
  },
];

const MOCK_CIRCLES: AjoCircle[] = [
  {
    id: 'c_active', name: 'Office Ajo', status: 'ACTIVE',
    contributionKobo: 5_000_000, frequency: 'monthly', memberCount: 5, currentCycle: 2,
    paymaxGuarantees: false,
    members: [
      { id: 'm1', name: 'You',     handle: '@you',    avatarColor: '#340075', status: 'ACTIVE',    payoutOrder: 1, paidThisCycle: true },
      { id: 'm2', name: 'Bisi A.', handle: '@bisi',   avatarColor: '#0051D5', status: 'ACTIVE',    payoutOrder: 2, paidThisCycle: true },
      { id: 'm3', name: 'Tunde O.',handle: '@tunde',  avatarColor: '#48B8AC', status: 'DEFAULTED', payoutOrder: 3, paidThisCycle: false },
      { id: 'm4', name: 'Chidi N.',handle: '@chidi',  avatarColor: '#EAB308', status: 'ACTIVE',    payoutOrder: 4, paidThisCycle: true },
      { id: 'm5', name: 'Ada E.',  handle: '@ada',     avatarColor: '#16A34A', status: 'ACTIVE',    payoutOrder: 5, paidThisCycle: false },
    ],
    cycles: [
      { index: 1, status: 'PAID',       dueISO: daysAgo(30), beneficiaryId: 'm1', collectedKobo: 25_000_000, potKobo: 25_000_000 },
      { index: 2, status: 'COLLECTING', dueISO: daysFromNow(5), beneficiaryId: 'm2', collectedKobo: 15_000_000, potKobo: 25_000_000 },
      { index: 3, status: 'UPCOMING',   dueISO: daysFromNow(35), beneficiaryId: 'm3', collectedKobo: 0, potKobo: 25_000_000 },
      { index: 4, status: 'UPCOMING',   dueISO: daysFromNow(65), beneficiaryId: 'm4', collectedKobo: 0, potKobo: 25_000_000 },
      { index: 5, status: 'UPCOMING',   dueISO: daysFromNow(95), beneficiaryId: 'm5', collectedKobo: 0, potKobo: 25_000_000 },
    ],
  },
  {
    id: 'c_forming', name: 'Family Esusu', status: 'FORMING',
    contributionKobo: 10_000_000, frequency: 'monthly', memberCount: 6, currentCycle: 0,
    paymaxGuarantees: false,
    members: [
      { id: 'm1', name: 'You',     handle: '@you',  avatarColor: '#340075', status: 'ACTIVE',  payoutOrder: 1, paidThisCycle: false },
      { id: 'm2', name: 'Mum',     handle: '@mum',   avatarColor: '#0051D5', status: 'INVITED', payoutOrder: 2, paidThisCycle: false },
      { id: 'm3', name: 'Sis',     handle: '@sis',   avatarColor: '#48B8AC', status: 'INVITED', payoutOrder: 3, paidThisCycle: false },
    ],
    cycles: [],
  },
];

const MOCK_TARGETS: GroupTarget[] = [
  {
    id: 't_trip', name: 'Detty December Trip', targetKobo: 150_000_000, savedKobo: 92_000_000,
    deadlineISO: daysFromNow(60), withdrawalRule: 'on-date', interestKobo: 0,
    contributors: [
      { id: 'g1', name: 'You',     handle: '@you',   avatarColor: '#340075', pledgedKobo: 30_000_000, savedKobo: 30_000_000 },
      { id: 'g2', name: 'Femi',    handle: '@femi',  avatarColor: '#0051D5', pledgedKobo: 30_000_000, savedKobo: 22_000_000 },
      { id: 'g3', name: 'Kemi',    handle: '@kemi',  avatarColor: '#48B8AC', pledgedKobo: 30_000_000, savedKobo: 25_000_000 },
      { id: 'g4', name: 'Ola',     handle: '@ola',    avatarColor: '#EAB308', pledgedKobo: 30_000_000, savedKobo: 15_000_000 },
      { id: 'g5', name: 'Zik',     handle: '@zik',    avatarColor: '#16A34A', pledgedKobo: 30_000_000, savedKobo: 0 },
    ],
  },
];

// ── Reads ────────────────────────────────────────────────────────────────────
// GET /summary → { success, summary: { vault_count, vault_balance_kobo,
// circle_count, target_count, target_balance_kobo, total_saved_kobo } }.
// Deriving this client-side from the lists cannot work: list rows carry no
// balances, so every total would be 0. The Go aggregate is ledger-derived
// (member_reads.go BuildSummary, "never a cached column — NL-8").
export async function getSummary(): Promise<SavingsSummary> {
  if (USE_MOCK) {
    await delay();
    return {
      totalSavedKobo: MOCK_VAULTS.reduce((s, v) => s + v.balanceKobo, 0),
      vaultCount: MOCK_VAULTS.length,
      circleCount: MOCK_CIRCLES.length,
      targetCount: MOCK_TARGETS.length,
    };
  }
  return envelope.summary(await api.get(`${API_BASE}/summary`));
}

export async function listVaults(): Promise<Vault[]> {
  if (USE_MOCK) { await delay(); return MOCK_VAULTS; }
  // NOTE: the list endpoint's Vault rows carry NO balance (the Go struct has no
  // balance field), so every vault here has balanceKobo 0. Only GET /vaults/:id
  // returns a balance — see getVault.
  return envelope.list(await api.get(`${API_BASE}/vaults`), 'vaults').map(vaultFromBackend);
}

export async function getVault(id: string): Promise<Vault> {
  if (USE_MOCK) {
    await delay();
    const v = MOCK_VAULTS.find((x) => x.id === id);
    if (!v) throw new Error('Vault not found');
    return v;
  }
  // GET /vaults/:id → { success, vault, balance_kobo }. This route is the ONLY
  // source of a vault's balance; the list endpoint cannot supply one.
  return vaultFromBackend(envelope.vaultDetail(await api.get(`${API_BASE}/vaults/${id}`)));
}

// NOTE: POST /vaults/:id/early-withdraw DOES exist (handler.go:432) and returns
// { success, balance_kobo, penalty_kobo}. What is missing is a QUOTE route
// (GET /vaults/:id/early-withdraw/quote), so the penalty shown before
// confirming is a client-side estimate and may differ from what the server
// actually charges.
export async function getEarlyWithdrawQuote(id: string): Promise<EarlyWithdrawQuote> {
  if (USE_MOCK) {
    await delay();
    const v = MOCK_VAULTS.find((x) => x.id === id);
    const balanceKobo = v?.balanceKobo ?? 0;
    const locked = v?.status === 'LOCKED';
    const penaltyKobo = locked ? Math.round(balanceKobo * 0.05) : 0;
    return { vaultId: id, balanceKobo, penaltyKobo, netKobo: balanceKobo - penaltyKobo, allowed: true };
  }
  const v = await getVault(id);
  const locked = v.status === 'LOCKED';
  const penaltyKobo = locked ? Math.round(v.balanceKobo * 0.05) : 0;
  return { vaultId: id, balanceKobo: v.balanceKobo, penaltyKobo, netKobo: v.balanceKobo - penaltyKobo, allowed: true };
}

export async function listCircles(): Promise<AjoCircle[]> {
  if (USE_MOCK) { await delay(); return MOCK_CIRCLES; }
  // GET /circles exists (handler.go:435) and returns { success, circles }.
  return envelope.list(await api.get(`${API_BASE}/circles`), 'circles').map(circleFromBackend);
}

// GET /circles/discover exists (handler.go:436) — forming circles open to join.
export async function discoverCircles(): Promise<AjoCircle[]> {
  if (USE_MOCK) { await delay(); return MOCK_CIRCLES.filter((c) => c.status === 'FORMING'); }
  return envelope.list(await api.get(`${API_BASE}/circles/discover`), 'circles').map(circleFromBackend);
}

export async function getCircle(id: string): Promise<AjoCircle> {
  if (USE_MOCK) {
    await delay();
    const c = MOCK_CIRCLES.find((x) => x.id === id);
    if (!c) throw new Error('Circle not found');
    return c;
  }
  // { success, circle, members } — members live BESIDE the circle on the
  // envelope, so they must be folded in for circleFromBackend to see them.
  return circleFromBackend(envelope.circleDetail(await api.get(`${API_BASE}/circles/${id}`)));
}

// GET /targets exists (handler.go:444) and returns { success, targets }.
export async function listTargets(): Promise<GroupTarget[]> {
  if (USE_MOCK) { await delay(); return MOCK_TARGETS; }
  return envelope.list(await api.get(`${API_BASE}/targets`), 'targets').map(targetFromBackend);
}

// GET /targets/:id exists (handler.go:446). Contributor rows are thin, though:
// GroupTargetMember is { id, target_id, user_id, approved, joined_at } — no
// names or per-contributor amounts, so those render blank/0 until the Go side
// widens the row.
// Only /targets/:id/balance exists today.
export async function getTarget(id: string): Promise<GroupTarget> {
  if (USE_MOCK) {
    await delay();
    const t = MOCK_TARGETS.find((x) => x.id === id);
    if (!t) throw new Error('Target not found');
    return t;
  }
  // { success, target, members, balance_kobo } — the Go GroupTarget struct has
  // no saved_kobo, so the envelope's balance_kobo IS the saved amount.
  return targetFromBackend(envelope.targetDetail(await api.get(`${API_BASE}/targets/${id}`)));
}

// ── Mutations (each carries an Idempotency-Key) ──────────────────────────────
export async function createVault(input: CreateVaultInput): Promise<Vault> {
  if (USE_MOCK) {
    await delay();
    return {
      id: `v_${Date.now()}`, name: input.name, status: input.lock,
      balanceKobo: input.initialKobo ?? 0, targetKobo: input.targetKobo,
      maturesAtISO: input.maturesAtISO ?? null, createdAtISO: new Date().toISOString(),
      streak: 0, interestKobo: 0, autoSave: null,
    };
  }
  const raw = envelope.entity(await api.post(
    `${API_BASE}/vaults`,
    { name: input.name, kind: input.lock, target_kobo: input.targetKobo, matures_at: input.maturesAtISO ?? null, initial_kobo: input.initialKobo },
    { headers: { 'Idempotency-Key': idempotencyKey() } },
  ), 'vault');
  return vaultFromBackend(raw);
}

export async function fundVault(id: string, amountKobo: number): Promise<ContributionResult> {
  if (USE_MOCK) {
    await delay();
    const v = MOCK_VAULTS.find((x) => x.id === id);
    return { ok: true, newBalanceKobo: (v?.balanceKobo ?? 0) + amountKobo };
  }
  const res = await unwrap<any>(
    await api.post(`${API_BASE}/vaults/${id}/deposit`, { amount_kobo: amountKobo }, { headers: { 'Idempotency-Key': idempotencyKey() } }),
  );
  return { ok: true, newBalanceKobo: res?.balance_kobo ?? res?.balanceKobo ?? 0 };
}

export async function setAutoSave(
  id: string,
  plan: { enabled: boolean; amountKobo: number; frequency: string },
): Promise<{ ok: boolean }> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  // Backend route is POST /vaults/:id/autosave, taking amount_kobo + interval_secs
  // (no PUT, no `enabled`/`frequency` toggle — disabling auto-save has no route yet).
  const intervalSecsByFrequency: Record<string, number> = {
    daily: 86_400, weekly: 7 * 86_400, monthly: 30 * 86_400,
  };
  await api.post(
    `${API_BASE}/vaults/${id}/autosave`,
    { amount_kobo: plan.amountKobo, interval_secs: intervalSecsByFrequency[plan.frequency] ?? 7 * 86_400 },
    { headers: { 'Idempotency-Key': idempotencyKey() } },
  );
  return { ok: true };
}

export async function earlyWithdraw(id: string): Promise<ContributionResult> {
  if (USE_MOCK) { await delay(); return { ok: true, newBalanceKobo: 0 }; }
  // Attempt to use the dedicated early-withdraw route; fall back to standard withdraw.
  // Penalty enforcement is a MISSING backend feature; the quote above is client-side only.
  const v = await getVault(id);
  const quote = await getEarlyWithdrawQuote(id);
  try {
    // Try dedicated endpoint with penalty parameter
    const res = await unwrap<any>(
      await api.post(`${API_BASE}/vaults/${id}/early-withdraw`, { amount_kobo: v.balanceKobo, penalty_bps: Math.round((quote.penaltyKobo / v.balanceKobo) * 10000) }, { headers: { 'Idempotency-Key': idempotencyKey() } }),
    );
    return { ok: true, newBalanceKobo: res?.balance_kobo ?? res?.balanceKobo ?? 0 };
  } catch {
    // Fall back to standard withdraw endpoint
    const res = await unwrap<any>(
      await api.post(`${API_BASE}/vaults/${id}/withdraw`, { amount_kobo: v.balanceKobo }, { headers: { 'Idempotency-Key': idempotencyKey() } }),
    );
    return { ok: true, newBalanceKobo: res?.balance_kobo ?? res?.balanceKobo ?? 0 };
  }
}

export async function createCircle(input: CreateCircleInput): Promise<AjoCircle> {
  if (USE_MOCK) {
    await delay();
    return {
      id: `c_${Date.now()}`, name: input.name, status: 'FORMING',
      contributionKobo: input.contributionKobo, frequency: input.frequency,
      memberCount: input.memberCount, currentCycle: 0, paymaxGuarantees: false,
      members: [{ id: 'm1', name: 'You', handle: '@you', avatarColor: '#340075', status: 'ACTIVE', payoutOrder: 1, paidThisCycle: false }],
      cycles: [],
    };
  }
  const intervalSecsByFrequency: Record<string, number> = {
    daily: 86_400, weekly: 7 * 86_400, monthly: 30 * 86_400,
  };
  const raw = envelope.entity(await api.post(
    `${API_BASE}/circles`,
    { name: input.name, contribution_kobo: input.contributionKobo, interval_secs: intervalSecsByFrequency[input.frequency] ?? 30 * 86_400, member_count: input.memberCount },
    { headers: { 'Idempotency-Key': idempotencyKey() } },
  ), 'circle');
  return circleFromBackend(raw);
}

// POST /circles/:id/contribute exists (handler.go:441); /circles/:id/make-good
// (:442) covers defaults separately.
export async function contributeToCircle(id: string, amountKobo: number): Promise<ContributionResult> {
  if (USE_MOCK) { await delay(); return { ok: true, newBalanceKobo: amountKobo }; }
  const res = await unwrap<any>(await api.post(`${API_BASE}/circles/${id}/contribute`, { amount_kobo: amountKobo }, { headers: { 'Idempotency-Key': idempotencyKey() } }));
  return { ok: true, newBalanceKobo: res?.balance_kobo ?? res?.balanceKobo ?? amountKobo };
}

export async function joinCircle(id: string): Promise<{ ok: boolean }> {
  if (USE_MOCK) { await delay(); return { ok: true }; }
  await api.post(`${API_BASE}/circles/${id}/join`, {}, { headers: { 'Idempotency-Key': idempotencyKey() } });
  return { ok: true };
}

export async function createGroupTarget(input: CreateGroupTargetInput): Promise<GroupTarget> {
  if (USE_MOCK) {
    await delay();
    return {
      id: `t_${Date.now()}`, name: input.name, targetKobo: input.targetKobo, savedKobo: 0,
      deadlineISO: input.deadlineISO, withdrawalRule: input.withdrawalRule, interestKobo: 0,
      contributors: [{ id: 'g1', name: 'You', handle: '@you', avatarColor: '#340075', pledgedKobo: 0, savedKobo: 0 }],
    };
  }
  const raw = envelope.entity(await api.post(
    `${API_BASE}/targets`,
    { name: input.name, target_kobo: input.targetKobo, withdrawal_rule: input.withdrawalRule, target_date: input.deadlineISO },
    { headers: { 'Idempotency-Key': idempotencyKey() } },
  ), 'target');
  return targetFromBackend(raw);
}

export async function contributeToTarget(id: string, amountKobo: number): Promise<ContributionResult> {
  if (USE_MOCK) {
    await delay();
    const t = MOCK_TARGETS.find((x) => x.id === id);
    return { ok: true, newBalanceKobo: (t?.savedKobo ?? 0) + amountKobo };
  }
  const res = await unwrap<any>(
    await api.post(`${API_BASE}/targets/${id}/contribute`, { amount_kobo: amountKobo }, { headers: { 'Idempotency-Key': idempotencyKey() } }),
  );
  return { ok: true, newBalanceKobo: res?.balance_kobo ?? res?.balanceKobo ?? amountKobo };
}
