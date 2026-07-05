// ── Paymax · Admin Console — API wrapper ─────────────────────────────────────
// Typed data layer the admin screens code against. Mirrors crypto.api.ts:
// mock-flagged via EXPO_PUBLIC_ADMIN_USE_MOCK (default true). Flip to false once
// the real Go admin endpoints under /api/v1/admin/* are live.
//
// RULES honoured here:
//  • all money is integer minor units;
//  • the selected admin Role is attached to every LIVE request as the
//    `X-Admin-Role` header (set via setAdminRole / the AdminRole context);
//  • the backend returns `{ type, code, message }` on errors — `toAdminError`
//    normalises that into an Error carrying `message` + `adminType`/`adminCode`.

import { api } from '@/api/client';
import {
  MOCK_ADMINS,
  MOCK_APPROVALS,
  MOCK_ASSET_CONTROLS,
  MOCK_AUDIT,
  MOCK_DASHBOARD,
  MOCK_FEES,
  MOCK_FLAGS,
  MOCK_KYC,
  MOCK_PROVIDERS,
  MOCK_RECON,
  MOCK_RISK_LIMITS,
  MOCK_USERS,
  MOCK_USER_DETAILS,
  MOCK_WITHDRAWALS,
} from './admin.mock';
import type {
  AdminOrder,
  AdminUser,
  Approval,
  AssetControl,
  AssetControlPatch,
  AuditEntry,
  Dashboard,
  FeatureFlag,
  FeeConfigItem,
  KycCase,
  KycDecision,
  OrderFilter,
  ProviderHealth,
  ReconReport,
  RiskLimit,
  Role,
  UserDetail,
  UserSummary,
  WithdrawalDecision,
  WithdrawalReviewItem,
} from '../types/admin.types';

// ─── Feature flag: flip to false once real endpoints are ready ────────────────
const USE_MOCK = (process.env.EXPO_PUBLIC_ADMIN_USE_MOCK ?? 'true').toLowerCase() !== 'false';

/** Simulated network latency so loading states render in mock mode. */
const delay = (ms = 320) => new Promise((r) => setTimeout(r, ms));
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;

// ─── Current admin role (attached as X-Admin-Role on live requests) ────────────
// Module-level holder; the AdminRole context calls setAdminRole on every change.

let currentRole: Role = 'SuperAdmin';

/** Set the role attached to subsequent live admin requests. */
export function setAdminRole(role: Role): void {
  currentRole = role;
}

/** Read the role currently being attached to live requests. */
export function getAdminRole(): Role {
  return currentRole;
}

/** Request config carrying the selected admin role header (live mode). */
function roleHeaders() {
  return { headers: { 'X-Admin-Role': currentRole } };
}

/**
 * Normalise a thrown axios error into an Error carrying the Go backend's real
 * `{ type, code, message }`. Surfaces `message` to the screens and preserves
 * `type`/`code` on the Error so callers can special-case (e.g. 'forbidden').
 */
export function toAdminError(err: unknown): Error {
  const e = err as {
    response?: { data?: { type?: string; code?: string; message?: string } };
    message?: string;
  };
  const data = e?.response?.data;
  const msg = data?.message ?? e?.message ?? 'Something went wrong. Please try again.';
  const out = new Error(msg) as Error & { adminType?: string; adminCode?: string };
  if (data?.type) out.adminType = data.type;
  if (data?.code) out.adminCode = data.code;
  return out;
}

/** Run a live request, normalising any error through toAdminError. */
async function live<T>(fn: () => Promise<{ data: { data?: T } & T }>): Promise<T> {
  try {
    return unwrap<T>(await fn());
  } catch (err) {
    throw toAdminError(err);
  }
}

// ─── Dashboard ──────────────────────────────────────────────────────────────--

export async function getDashboard(): Promise<Dashboard> {
  if (USE_MOCK) { await delay(280); return MOCK_DASHBOARD; }
  return live<Dashboard>(() => api.get('/api/v1/admin/dashboard', roleHeaders()));
}

// ─── Users ──────────────────────────────────────────────────────────────────--

export async function getUsers(): Promise<UserSummary[]> {
  if (USE_MOCK) { await delay(); return [...MOCK_USERS]; }
  return live<UserSummary[]>(() => api.get('/api/v1/admin/users', roleHeaders()));
}

export async function getUser(id: string): Promise<UserDetail> {
  if (USE_MOCK) {
    await delay(220);
    const detail = MOCK_USER_DETAILS[id];
    if (detail) return detail;
    const summary = MOCK_USERS.find((u) => u.id === id);
    if (!summary) throw new Error('User not found');
    // Synthesise a minimal detail for users without a hand-written record.
    return {
      ...summary,
      phone: '+234 800 000 0000', country: 'Nigeria', kycStatus: 'approved',
      walletBalance: { amount: 0, currency: 'NGN' },
      lifetimeVolume: { amount: 0, currency: 'NGN' },
      lastActiveAt: summary.createdAt, flags: [],
    };
  }
  return live<UserDetail>(() => api.get(`/api/v1/admin/users/${id}`, roleHeaders()));
}

// ─── KYC ────────────────────────────────────────────────────────────────────--

export async function getKycQueue(): Promise<KycCase[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_KYC].sort((a, b) => +new Date(a.submittedAt) - +new Date(b.submittedAt));
  }
  return live<KycCase[]>(() => api.get('/api/v1/admin/kyc', roleHeaders()));
}

export async function reviewKyc(id: string, decision: KycDecision, reason: string): Promise<KycCase> {
  if (USE_MOCK) {
    await delay(600);
    const found = MOCK_KYC.find((k) => k.id === id);
    if (!found) throw new Error('KYC case not found');
    found.status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'escalated';
    return found;
  }
  return live<KycCase>(() =>
    api.post(`/api/v1/admin/kyc/${id}/review`, { decision, reason }, roleHeaders()),
  );
}

// ─── Asset controls ────────────────────────────────────────────────────────--

export async function getAssetControls(): Promise<AssetControl[]> {
  if (USE_MOCK) { await delay(); return [...MOCK_ASSET_CONTROLS]; }
  return live<AssetControl[]>(() => api.get('/api/v1/admin/assets', roleHeaders()));
}

export async function updateAssetControl(id: string, patch: AssetControlPatch): Promise<AssetControl> {
  if (USE_MOCK) {
    await delay(400);
    const found = MOCK_ASSET_CONTROLS.find((a) => a.id === id);
    if (!found) throw new Error('Asset not found');
    Object.assign(found, patch);
    return found;
  }
  return live<AssetControl>(() => api.patch(`/api/v1/admin/assets/${id}`, patch, roleHeaders()));
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export async function getOrders(filter: OrderFilter = 'all'): Promise<AdminOrder[]> {
  if (USE_MOCK) {
    await delay();
    const { MOCK_ORDERS } = await import('./admin.mock');
    let list = [...MOCK_ORDERS];
    if (filter === 'failed') list = list.filter((o) => o.status === 'Failed');
    else if (filter === 'pending') list = list.filter((o) => o.status === 'Pending' || o.status === 'Processing');
    else if (filter === 'crypto' || filter === 'stock') list = list.filter((o) => o.kind === filter);
    return list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  return live<AdminOrder[]>(() => api.get('/api/v1/admin/orders', { ...roleHeaders(), params: { filter } }));
}

// ─── Withdrawal review ─────────────────────────────────────────────────────--

export async function getWithdrawalQueue(): Promise<WithdrawalReviewItem[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_WITHDRAWALS].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  }
  return live<WithdrawalReviewItem[]>(() => api.get('/api/v1/admin/withdrawals', roleHeaders()));
}

export async function reviewWithdrawal(
  ref: string,
  decision: WithdrawalDecision,
  reason: string,
): Promise<WithdrawalReviewItem> {
  if (USE_MOCK) {
    await delay(700);
    const found = MOCK_WITHDRAWALS.find((w) => w.reference === ref);
    if (!found) throw new Error('Withdrawal not found');
    found.status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'escalated';
    return found;
  }
  return live<WithdrawalReviewItem>(() =>
    api.post(`/api/v1/admin/withdrawals/${ref}/review`, { decision, reason }, roleHeaders()),
  );
}

// ─── Reconciliation ───────────────────────────────────────────────────────────

export async function getReconciliation(): Promise<ReconReport> {
  if (USE_MOCK) { await delay(300); return MOCK_RECON; }
  return live<ReconReport>(() => api.get('/api/v1/admin/reconciliation', roleHeaders()));
}

// ─── Providers ─────────────────────────────────────────────────────────────--

export async function getProviders(): Promise<ProviderHealth[]> {
  if (USE_MOCK) { await delay(); return [...MOCK_PROVIDERS]; }
  return live<ProviderHealth[]>(() => api.get('/api/v1/admin/providers', roleHeaders()));
}

// ─── Risk limits ──────────────────────────────────────────────────────────────

export async function getRiskLimits(): Promise<RiskLimit[]> {
  if (USE_MOCK) { await delay(); return [...MOCK_RISK_LIMITS]; }
  return live<RiskLimit[]>(() => api.get('/api/v1/admin/risk-limits', roleHeaders()));
}

export async function updateRiskLimit(id: string, valueMinor: number): Promise<RiskLimit> {
  if (USE_MOCK) {
    await delay(400);
    const found = MOCK_RISK_LIMITS.find((r) => r.id === id);
    if (!found) throw new Error('Risk limit not found');
    found.valueMinor = valueMinor;
    return found;
  }
  return live<RiskLimit>(() => api.patch(`/api/v1/admin/risk-limits/${id}`, { valueMinor }, roleHeaders()));
}

// ─── Fees ─────────────────────────────────────────────────────────────────────

export async function getFees(): Promise<FeeConfigItem[]> {
  if (USE_MOCK) { await delay(); return [...MOCK_FEES]; }
  return live<FeeConfigItem[]>(() => api.get('/api/v1/admin/fees', roleHeaders()));
}

export async function updateFee(id: string, bps: number): Promise<FeeConfigItem> {
  if (USE_MOCK) {
    await delay(400);
    const found = MOCK_FEES.find((f) => f.id === id);
    if (!found) throw new Error('Fee not found');
    found.bps = bps;
    return found;
  }
  return live<FeeConfigItem>(() => api.patch(`/api/v1/admin/fees/${id}`, { bps }, roleHeaders()));
}

// ─── Feature flags ─────────────────────────────────────────────────────────--

export async function getFeatureFlags(): Promise<FeatureFlag[]> {
  if (USE_MOCK) { await delay(); return [...MOCK_FLAGS]; }
  return live<FeatureFlag[]>(() => api.get('/api/v1/admin/feature-flags', roleHeaders()));
}

export async function setFeatureFlag(key: string, enabled: boolean): Promise<FeatureFlag> {
  if (USE_MOCK) {
    await delay(300);
    const found = MOCK_FLAGS.find((f) => f.key === key);
    if (!found) throw new Error('Flag not found');
    found.enabled = enabled;
    return found;
  }
  return live<FeatureFlag>(() => api.patch(`/api/v1/admin/feature-flags/${key}`, { enabled }, roleHeaders()));
}

// ─── Approvals (maker-checker) ─────────────────────────────────────────────--

export async function getApprovals(): Promise<Approval[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_APPROVALS].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }
  return live<Approval[]>(() => api.get('/api/v1/admin/approvals', roleHeaders()));
}

export async function approve(id: string): Promise<Approval> {
  if (USE_MOCK) {
    await delay(500);
    const found = MOCK_APPROVALS.find((a) => a.id === id);
    if (!found) throw new Error('Approval not found');
    found.status = 'approved';
    found.checker = 'you@paymax.co';
    return found;
  }
  return live<Approval>(() => api.post(`/api/v1/admin/approvals/${id}/approve`, {}, roleHeaders()));
}

export async function rejectApproval(id: string, reason: string): Promise<Approval> {
  if (USE_MOCK) {
    await delay(500);
    const found = MOCK_APPROVALS.find((a) => a.id === id);
    if (!found) throw new Error('Approval not found');
    found.status = 'rejected';
    found.checker = 'you@paymax.co';
    return found;
  }
  return live<Approval>(() => api.post(`/api/v1/admin/approvals/${id}/reject`, { reason }, roleHeaders()));
}

// ─── Audit log ─────────────────────────────────────────────────────────────--

export async function getAudit(): Promise<AuditEntry[]> {
  if (USE_MOCK) {
    await delay();
    return [...MOCK_AUDIT].sort((a, b) => +new Date(b.at) - +new Date(a.at));
  }
  return live<AuditEntry[]>(() => api.get('/api/v1/admin/audit', roleHeaders()));
}

// ─── Admin directory ─────────────────────────────────────────────────────────-

export async function getAdmins(): Promise<AdminUser[]> {
  if (USE_MOCK) { await delay(); return [...MOCK_ADMINS]; }
  return live<AdminUser[]>(() => api.get('/api/v1/admin/admins', roleHeaders()));
}
