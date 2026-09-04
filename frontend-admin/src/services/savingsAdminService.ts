// ── Admin — Paymax Savings (Goal Vaults + Ajo/Esusu) ops control-plane service ─
// Mock by default (mirrors stays / connect / insurance admin services). Flip with
// NEXT_PUBLIC_SAVINGS_USE_MOCK=false to hit the live Go backend at /api/savings/admin/*.
// RBAC: savings.admin.* gates wired on the sidebar.
// Money is BIGINT kobo (minor units) throughout. Surfaces NL-2 (no yield),
// NL-7 (Ajo peer rotation — Paymax is ledger/escrow only), NL-8 (ledger),
// NL-12 (immutable audit on every state change).

import { env } from '@/config/env';
import { operationKey } from './idempotency';
import type {
  SavingsDashboard,
  VaultRecord,
  ForceUnlockResult,
  FloatRecon,
  AjoCircleSummary,
  AjoCircleDetail,
  DefaultRecord,
  DefaultAction,
  DefaultActionResult,
} from '@/types/savingsAdmin';

const USE_MOCK = (process.env.NEXT_PUBLIC_SAVINGS_USE_MOCK ?? 'true').toLowerCase() !== 'false';

function adminBase(): string {
  return env.apiBaseUrl.replace(/\/api\/v1\/?$/, '/api/savings/admin');
}
function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
const delay = (ms = 240) => new Promise((r) => setTimeout(r, ms));

// Verified against backend/internal/savings (Handler.Register): the only
// admin route registered is GET /circles/:id. No force-unlock or default-
// handling mutation exists anywhere in the module — grepped for "ForceUnlock"/
// "force-unlock"/"/defaults", zero hits; VaultService only has Deposit/
// Withdraw/EarlyBreak/TransitionState, none exposed admin-side.
const NO_BACKEND_YET =
  'has no backend yet (see the comment on the live-mode call below). ' +
  'This console cannot perform this action until that endpoint is built.';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${adminBase()}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}
async function sendJson<T>(method: 'POST' | 'PATCH' | 'PUT', path: string, body: unknown): Promise<T> {
  // Idempotency-Key per the house iron rule — keyed on method+path (the operation
  // identity) so a retried savings mutation dedupes at the backend. See services/idempotency.ts.
  const res = await fetch(`${adminBase()}${path}`, {
    method,
    headers: { ...authHeaders(), 'Idempotency-Key': operationKey(method, path) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const j = await res.json();
  return (j?.data ?? j) as T;
}

// ── Display helper: kobo → ₦ ─────────────────────────────────────────────────
export function formatNaira(kobo: number): string {
  const naira = (kobo ?? 0) / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const dateStr = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
const dateAhead = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

// ════════════════════════════════════════════════════════════════════════════
// A · Dashboard
// ════════════════════════════════════════════════════════════════════════════
const DASHBOARD: SavingsDashboard = {
  total_float_liability_kobo: 4_812_400_000_00,
  ledger_balance_kobo: 4_812_400_000_00,
  unreconciled_delta_kobo: 18_500_00,
  vaults_total: 14_820,
  vaults_locked: 9_140,
  vaults_flex: 5_680,
  vault_balance_kobo: 3_104_900_000_00,
  circles_total: 1_240,
  circles_active: 884,
  circle_collections_30d_kobo: 612_300_000_00,
  payout_queue_count: 37,
  payout_queue_value_kobo: 41_800_000_00,
  targets_total: 2_610,
  target_balance_kobo: 1_095_700_000_00,
  defaults_open: 52,
  default_exposure_kobo: 6_240_000_00,
  force_unlocks_30d: 11,
  auto_save_runs_today: 8_412,
  auto_save_failures_today: 23,
  product_mix: [
    { product: 'vault', count: 14_820, balance_kobo: 3_104_900_000_00, share_pct: 0.645 },
    { product: 'circle', count: 1_240, balance_kobo: 611_800_000_00, share_pct: 0.127 },
    { product: 'target', count: 2_610, balance_kobo: 1_095_700_000_00, share_pct: 0.228 },
  ],
  float_trend: Array.from({ length: 14 }).map((_, i) => ({
    date: dateStr(13 - i),
    float_kobo: (44_000_000 + i * 380_000 + Math.round(Math.sin(i / 2) * 1_200_000)) * 100 * 100,
  })),
  activity: [
    { id: 'ev1', kind: 'force_unlock', label: 'Force-unlock approved — locked vault released early (hardship case)', ref: 'vlt_30221', created_at: iso(0.4) },
    { id: 'ev2', kind: 'member_defaulted', label: 'Ajo member defaulted — cycle 4 contribution missed (grace expired)', ref: 'cir_5012', created_at: iso(0.9) },
    { id: 'ev3', kind: 'ajo_payout', label: 'Ajo payout released to scheduled beneficiary — ₦480,000.00', ref: 'cir_4980', created_at: iso(1.6) },
    { id: 'ev4', kind: 'recon_break', label: 'Float reconciliation delta flagged on circle custody batch', ref: 'rec_8841', created_at: iso(2.4) },
    { id: 'ev5', kind: 'vault_matured', label: 'Locked vault matured — funds returned to wallet (NL-2: zero yield)', ref: 'vlt_29980', created_at: iso(5) },
    { id: 'ev6', kind: 'auto_save_run', label: 'Auto-save batch executed — 8,412 idempotent debits posted', ref: 'job_2207', created_at: iso(7) },
  ],
};
export async function getSavingsDashboard(): Promise<SavingsDashboard> {
  if (USE_MOCK) { await delay(); return { ...DASHBOARD, product_mix: [...DASHBOARD.product_mix], float_trend: [...DASHBOARD.float_trend], activity: [...DASHBOARD.activity] }; }
  return getJson<SavingsDashboard>('/dashboard');
}

// ════════════════════════════════════════════════════════════════════════════
// B · Vaults
// ════════════════════════════════════════════════════════════════════════════
const VAULTS: VaultRecord[] = [
  { id: 'vlt_30221', owner_masked: 'Chioma A•••', name: 'Rent 2026', lock_type: 'LOCKED', status: 'locked', balance_kobo: 1_240_000_00, target_kobo: 1_800_000_00, yield_kobo: 0, auto_save_enabled: true, auto_save_amount_kobo: 25_000_00, auto_save_frequency: 'weekly', locked_until: dateAhead(120), early_break_requested: true, created_at: dateStr(210), matured_at: null },
  { id: 'vlt_30188', owner_masked: 'Tunde B•••', name: 'Japa Fund', lock_type: 'LOCKED', status: 'locked', balance_kobo: 4_820_000_00, target_kobo: 12_000_000_00, yield_kobo: 0, auto_save_enabled: true, auto_save_amount_kobo: 100_000_00, auto_save_frequency: 'monthly', locked_until: dateAhead(310), early_break_requested: false, created_at: dateStr(140), matured_at: null },
  { id: 'vlt_30140', owner_masked: 'Aisha M•••', name: 'Sallah savings', lock_type: 'FLEX', status: 'flex', balance_kobo: 312_500_00, target_kobo: 500_000_00, yield_kobo: 0, auto_save_enabled: false, auto_save_amount_kobo: 0, auto_save_frequency: null, locked_until: null, early_break_requested: false, created_at: dateStr(60), matured_at: null },
  { id: 'vlt_29980', owner_masked: 'Emeka O•••', name: 'Detty December', lock_type: 'LOCKED', status: 'matured', balance_kobo: 0, target_kobo: 600_000_00, yield_kobo: 0, auto_save_enabled: false, auto_save_amount_kobo: 0, auto_save_frequency: null, locked_until: dateStr(5), early_break_requested: false, created_at: dateStr(200), matured_at: iso(120) },
  { id: 'vlt_29871', owner_masked: 'Ngozi U•••', name: 'School fees', lock_type: 'FLEX', status: 'open', balance_kobo: 980_000_00, target_kobo: 1_500_000_00, yield_kobo: 0, auto_save_enabled: true, auto_save_amount_kobo: 15_000_00, auto_save_frequency: 'weekly', locked_until: null, early_break_requested: false, created_at: dateStr(95), matured_at: null },
];
export async function listVaults(opts?: { status?: string; q?: string }): Promise<VaultRecord[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...VAULTS];
    if (opts?.status) rows = rows.filter((v) => v.status === opts.status);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((v) => v.name.toLowerCase().includes(q) || v.owner_masked.toLowerCase().includes(q) || v.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<VaultRecord[]>(`/vaults${qs.toString() ? `?${qs}` : ''}`);
}
export async function forceUnlock(vaultId: string, reason: string): Promise<ForceUnlockResult> {
  // No backend at all — see the comment above. The OLD fixture message here
  // also fabricated a compliance claim ("Action recorded to immutable
  // audit") — exactly the pattern docs/audit/ADMIN_SIMULATED_WRITES.md calls
  // "the most dangerous strings in this codebase", missed by the checker's
  // claim-pattern regex only because of a lowercase "recorded" vs its
  // capitalized "Recorded". Removed regardless.
  if (USE_MOCK) throw new Error(`Force-unlocking a vault ${NO_BACKEND_YET}`);
  return sendJson<ForceUnlockResult>('POST', `/vaults/${vaultId}/force-unlock`, { reason });
}

// ════════════════════════════════════════════════════════════════════════════
// C · Float reconciliation
// ════════════════════════════════════════════════════════════════════════════
const FLOAT_RECON: FloatRecon = {
  generated_at: iso(0.2),
  total_ledger_kobo: 4_812_400_000_00,
  total_custody_kobo: 4_812_418_500_00,
  total_delta_kobo: 18_500_00,
  lines: [
    { id: 'rec_v', product: 'vault', ledger_balance_kobo: 3_104_900_000_00, custody_balance_kobo: 3_104_900_000_00, delta_kobo: 0, status: 'balanced', as_of: iso(0.2) },
    { id: 'rec_c', product: 'circle', ledger_balance_kobo: 611_800_000_00, custody_balance_kobo: 611_818_500_00, delta_kobo: 18_500_00, status: 'flagged', as_of: iso(0.2) },
    { id: 'rec_t', product: 'target', ledger_balance_kobo: 1_095_700_000_00, custody_balance_kobo: 1_095_700_000_00, delta_kobo: 0, status: 'balanced', as_of: iso(0.2) },
  ],
};
export async function getFloatRecon(): Promise<FloatRecon> {
  if (USE_MOCK) { await delay(); return { ...FLOAT_RECON, lines: [...FLOAT_RECON.lines] }; }
  return getJson<FloatRecon>('/float-recon');
}

// ════════════════════════════════════════════════════════════════════════════
// D · Ajo / Esusu circles
// ════════════════════════════════════════════════════════════════════════════
const CIRCLES: AjoCircleSummary[] = [
  { id: 'cir_5012', name: 'Market Women Esusu', status: 'active', contribution_kobo: 20_000_00, frequency: 'weekly', members_count: 10, cycle_index: 4, total_cycles: 10, collected_this_cycle_kobo: 180_000_00, expected_this_cycle_kobo: 200_000_00, health: 'at_risk', defaults_count: 1, next_payout_member_masked: 'Funke A•••', next_payout_kobo: 200_000_00, next_payout_date: dateAhead(3), created_at: dateStr(28) },
  { id: 'cir_4980', name: 'Tech Bros Ajo', status: 'active', contribution_kobo: 60_000_00, frequency: 'monthly', members_count: 8, cycle_index: 6, total_cycles: 8, collected_this_cycle_kobo: 480_000_00, expected_this_cycle_kobo: 480_000_00, health: 'healthy', defaults_count: 0, next_payout_member_masked: 'Seun K•••', next_payout_kobo: 480_000_00, next_payout_date: dateAhead(12), created_at: dateStr(170) },
  { id: 'cir_4901', name: 'Campus Squad', status: 'forming', contribution_kobo: 5_000_00, frequency: 'weekly', members_count: 4, cycle_index: 0, total_cycles: 6, collected_this_cycle_kobo: 0, expected_this_cycle_kobo: 30_000_00, health: 'healthy', defaults_count: 0, next_payout_member_masked: null, next_payout_kobo: 0, next_payout_date: null, created_at: dateStr(3) },
  { id: 'cir_4720', name: 'Family Welfare Circle', status: 'completed', contribution_kobo: 50_000_00, frequency: 'monthly', members_count: 12, cycle_index: 12, total_cycles: 12, collected_this_cycle_kobo: 600_000_00, expected_this_cycle_kobo: 600_000_00, health: 'healthy', defaults_count: 0, next_payout_member_masked: null, next_payout_kobo: 0, next_payout_date: null, created_at: dateStr(400) },
];
export async function listAjoCircles(opts?: { status?: string; health?: string; q?: string }): Promise<AjoCircleSummary[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...CIRCLES];
    if (opts?.status) rows = rows.filter((c) => c.status === opts.status);
    if (opts?.health) rows = rows.filter((c) => c.health === opts.health);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((c) => c.name.toLowerCase().includes(q) || c.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.health) qs.set('health', opts.health);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<AjoCircleSummary[]>(`/ajo${qs.toString() ? `?${qs}` : ''}`);
}

const CIRCLE_DETAIL: Record<string, AjoCircleDetail> = {
  cir_5012: {
    ...CIRCLES[0],
    payout_order_locked: true,
    escrow_held_kobo: 180_000_00,
    members: [
      { id: 'm1', masked_name: 'Funke A•••', status: 'active', payout_position: 4, paid_cycles: 3, missed_cycles: 0, has_received_payout: false, contributed_kobo: 60_000_00, joined_at: dateStr(28) },
      { id: 'm2', masked_name: 'Bola T•••', status: 'active', payout_position: 1, paid_cycles: 4, missed_cycles: 0, has_received_payout: true, contributed_kobo: 80_000_00, joined_at: dateStr(28) },
      { id: 'm3', masked_name: 'Risi O•••', status: 'defaulted', payout_position: 7, paid_cycles: 2, missed_cycles: 2, has_received_payout: false, contributed_kobo: 40_000_00, joined_at: dateStr(28) },
      { id: 'm4', masked_name: 'Kemi D•••', status: 'active', payout_position: 2, paid_cycles: 4, missed_cycles: 0, has_received_payout: true, contributed_kobo: 80_000_00, joined_at: dateStr(28) },
      { id: 'm5', masked_name: 'Ada N•••', status: 'invited', payout_position: 10, paid_cycles: 0, missed_cycles: 0, has_received_payout: false, contributed_kobo: 0, joined_at: dateStr(1) },
    ],
    cycles: [
      { cycle_index: 1, beneficiary_masked: 'Bola T•••', payout_kobo: 200_000_00, status: 'completed', collected_kobo: 200_000_00, expected_kobo: 200_000_00, payout_date: dateStr(21) },
      { cycle_index: 2, beneficiary_masked: 'Kemi D•••', payout_kobo: 200_000_00, status: 'completed', collected_kobo: 200_000_00, expected_kobo: 200_000_00, payout_date: dateStr(14) },
      { cycle_index: 3, beneficiary_masked: 'Chika E•••', payout_kobo: 200_000_00, status: 'completed', collected_kobo: 200_000_00, expected_kobo: 200_000_00, payout_date: dateStr(7) },
      { cycle_index: 4, beneficiary_masked: 'Funke A•••', payout_kobo: 200_000_00, status: 'collecting', collected_kobo: 180_000_00, expected_kobo: 200_000_00, payout_date: dateAhead(3) },
      { cycle_index: 5, beneficiary_masked: 'Yemi S•••', payout_kobo: 200_000_00, status: 'scheduled', collected_kobo: 0, expected_kobo: 200_000_00, payout_date: dateAhead(10) },
    ],
  },
};
export async function getAjoCircle(id: string): Promise<AjoCircleDetail> {
  if (USE_MOCK) {
    await delay();
    const d = CIRCLE_DETAIL[id];
    if (d) return { ...d, members: [...d.members], cycles: [...d.cycles] };
    // synthesise a minimal detail for any other id so the page renders
    const base = CIRCLES.find((c) => c.id === id) ?? CIRCLES[1];
    return { ...base, id, payout_order_locked: base.status !== 'forming', escrow_held_kobo: base.collected_this_cycle_kobo, members: [], cycles: [] };
  }
  return getJson<AjoCircleDetail>(`/ajo/${id}`);
}

// ════════════════════════════════════════════════════════════════════════════
// E · Defaults queue + default handling
// ════════════════════════════════════════════════════════════════════════════
const DEFAULTS: DefaultRecord[] = [
  { id: 'def_881', circle_id: 'cir_5012', circle_name: 'Market Women Esusu', member_masked: 'Risi O•••', cycle_index: 4, amount_due_kobo: 20_000_00, days_overdue: 5, status: 'defaulted', policy: 'make_good', created_at: iso(120) },
  { id: 'def_874', circle_id: 'cir_5101', circle_name: 'Traders Weekly', member_masked: 'Musa I•••', cycle_index: 2, amount_due_kobo: 10_000_00, days_overdue: 2, status: 'grace', policy: 'grace', created_at: iso(48) },
  { id: 'def_860', circle_id: 'cir_4980', circle_name: 'Tech Bros Ajo', member_masked: 'Dapo F•••', cycle_index: 5, amount_due_kobo: 60_000_00, days_overdue: 8, status: 'open', policy: 'remove', created_at: iso(192) },
  { id: 'def_842', circle_id: 'cir_4655', circle_name: 'Salon Owners', member_masked: 'Grace E•••', cycle_index: 7, amount_due_kobo: 15_000_00, days_overdue: 0, status: 'recovered', policy: 'make_good', created_at: iso(300) },
];
export async function listDefaults(opts?: { status?: string; q?: string }): Promise<DefaultRecord[]> {
  if (USE_MOCK) {
    await delay();
    let rows = [...DEFAULTS];
    if (opts?.status) rows = rows.filter((d) => d.status === opts.status);
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      rows = rows.filter((d) => d.circle_name.toLowerCase().includes(q) || d.member_masked.toLowerCase().includes(q) || d.id.includes(q));
    }
    return rows;
  }
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.q) qs.set('q', opts.q);
  return getJson<DefaultRecord[]>(`/defaults${qs.toString() ? `?${qs}` : ''}`);
}
export async function handleDefault(id: string, action: DefaultAction, note?: string): Promise<DefaultActionResult> {
  // No admin action exists for any of the 5 values: AjoService has a private
  // markDefault invoked automatically by the cycle scheduler (not admin-
  // triggerable), and the closest real capability — MakeGood
  // (POST /savings/circles/:id/make-good) — is a MEMBER self-service route
  // keyed on the caller's own session, not an admin action on someone else's
  // behalf. None of grace/make_good/remove/recover/dismiss has a usable
  // backend verb today.
  if (USE_MOCK) throw new Error(`Handling a savings default ${NO_BACKEND_YET}`);
  return sendJson<DefaultActionResult>('POST', `/defaults/${id}/handle`, { action, note });
}
