import { env } from '@/config/env';
import type {
  TradingKycRecord, TradingKycStatus, TradingKycEvent, TradingKycBypassRequest, TradingBypassEntry,
} from '@/types/tradingAdmin';

// Trading admin console — service layer. Backend routes hang off /v1/trading/admin
// (Go/Gin, RBAC guard("trading.*"); reason_code mandatory on decisions; bypass is
// two-person maker≠checker). Fixture-backed until the routes are live (USE_FIXTURES),
// mirroring the marketplace admin service.
export function tradingAdminBase(): string {
  return `${env.apiBaseUrl.replace(/\/api\/v1\/?$/, '')}/v1/trading/admin`;
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

export function formatKobo(kobo: number | null | undefined): string {
  if (kobo == null) return '—';
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

const USE_FIXTURES = (process.env.NEXT_PUBLIC_TRADING_ADMIN_USE_MOCK ?? 'true').toLowerCase() !== 'false';
const delay = <T,>(v: T): Promise<T> => new Promise((r) => setTimeout(() => r(v), 120));
const now = Date.now();
const iso = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();

async function parseErr(res: Response, fallback: string): Promise<string> {
  try { const b = await res.json(); return b?.error?.message ? `${b.error.message}${b.error.code ? ` (${b.error.code})` : ''}` : `${fallback}: ${res.status}`; }
  catch { return `${fallback}: ${res.status}`; }
}

// Max bypass window (§16B.1 recommends ≤ 30 days) — surfaced so the UI can bound input.
export const MAX_BYPASS_DAYS = 30;

const FIXTURE_QUEUE: TradingKycRecord[] = [
  { user_id: 'usr_7f2a', display_name: 'Tunde Balogun', email_masked: 't***e@gmail.com', status: 'SUBMITTED', submitted_at: iso(90), reviewed_at: null, reviewer_id: null, reason_code: null, bypass_expires_at: null, exposure_cap_kobo: null, sanctions_hit: false, pep_hit: false, source_of_funds: 'Salary', risk_flags: [] },
  { user_id: 'usr_2b9e', display_name: 'Amara Okafor', email_masked: 'a***a@yahoo.com', status: 'UNDER_REVIEW', submitted_at: iso(240), reviewed_at: null, reviewer_id: 'adm_rev', reason_code: null, bypass_expires_at: null, exposure_cap_kobo: null, sanctions_hit: false, pep_hit: true, source_of_funds: 'Business', risk_flags: ['pep'] },
  { user_id: 'usr_9a1c', display_name: 'Chidi Eze', email_masked: 'c***i@outlook.com', status: 'SUBMITTED', submitted_at: iso(30), reviewed_at: null, reviewer_id: null, reason_code: null, bypass_expires_at: null, exposure_cap_kobo: null, sanctions_hit: true, pep_hit: false, source_of_funds: 'Crypto', risk_flags: ['sanctions_review'] },
];

const FIXTURE_BYPASS: TradingBypassEntry[] = [
  { id: 'byp_1', user_id: 'usr_5566', display_name: 'Ada Nwosu', maker_id: 'adm_maker', checker_id: 'adm_compliance', reason: 'Institutional client — manual docs verified offline', exposure_cap_kobo: 5_000_000_00, granted_at: iso(60 * 24 * 3), expires_at: iso(-60 * 24 * 20), revoked_at: null, active: true },
  { id: 'byp_2', user_id: 'usr_3344', display_name: 'Ibrahim Sani', maker_id: 'adm_maker2', checker_id: 'adm_compliance', reason: 'Pilot cohort — full KYC in progress', exposure_cap_kobo: 1_000_000_00, granted_at: iso(60 * 24 * 40), expires_at: iso(60 * 24 * 5), revoked_at: iso(60 * 24 * 10), active: false },
];

const FIXTURE_EVENTS: Record<string, TradingKycEvent[]> = {
  usr_2b9e: [
    { event_type: 'submit', old_status: 'NOT_STARTED', new_status: 'SUBMITTED', actor_id: 'usr_2b9e', reason: null, created_at: iso(300) },
    { event_type: 'start_review', old_status: 'SUBMITTED', new_status: 'UNDER_REVIEW', actor_id: 'adm_rev', reason: null, created_at: iso(240) },
  ],
};

export async function listReviewQueue(): Promise<TradingKycRecord[]> {
  if (USE_FIXTURES) return delay([...FIXTURE_QUEUE]);
  const res = await fetch(`${tradingAdminBase()}/kyc/queue`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErr(res, 'KYC queue fetch failed'));
  const d = await res.json(); return Array.isArray(d) ? d : d.data ?? [];
}

export async function getKycCase(userId: string): Promise<{ record: TradingKycRecord; events: TradingKycEvent[] }> {
  if (USE_FIXTURES) {
    const record = FIXTURE_QUEUE.find((r) => r.user_id === userId) ?? FIXTURE_QUEUE[0];
    return delay({ record, events: FIXTURE_EVENTS[userId] ?? [] });
  }
  const res = await fetch(`${tradingAdminBase()}/kyc/${encodeURIComponent(userId)}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErr(res, 'KYC case fetch failed'));
  return res.json();
}

export async function startReview(userId: string): Promise<TradingKycRecord> {
  if (USE_FIXTURES) { const r = FIXTURE_QUEUE.find((x) => x.user_id === userId)!; return delay({ ...r, status: 'UNDER_REVIEW', reviewer_id: 'adm_current' }); }
  const res = await fetch(`${tradingAdminBase()}/kyc/${encodeURIComponent(userId)}/review`, { method: 'POST', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErr(res, 'Start review failed'));
  return res.json();
}

export async function approveKyc(userId: string, reason: string): Promise<TradingKycRecord> {
  if (USE_FIXTURES) { const r = FIXTURE_QUEUE.find((x) => x.user_id === userId)!; return delay({ ...r, status: 'APPROVED', reviewed_at: new Date().toISOString(), reason_code: reason || null }); }
  const res = await fetch(`${tradingAdminBase()}/kyc/${encodeURIComponent(userId)}/approve`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ reason_code: reason }) });
  if (!res.ok) throw new Error(await parseErr(res, 'Approve failed'));
  return res.json();
}

export async function rejectKyc(userId: string, reasonCode: string): Promise<TradingKycRecord> {
  if (!reasonCode.trim()) throw new Error('reason_code is required to reject.');
  if (USE_FIXTURES) { const r = FIXTURE_QUEUE.find((x) => x.user_id === userId)!; return delay({ ...r, status: 'REJECTED', reviewed_at: new Date().toISOString(), reason_code: reasonCode }); }
  const res = await fetch(`${tradingAdminBase()}/kyc/${encodeURIComponent(userId)}/reject`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ reason_code: reasonCode }) });
  if (!res.ok) throw new Error(await parseErr(res, 'Reject failed'));
  return res.json();
}

// bypassKyc — the current admin is the MAKER; checker_id must differ (two-person).
export async function bypassKyc(userId: string, input: TradingKycBypassRequest): Promise<TradingKycRecord> {
  if (!input.reason.trim()) throw new Error('A written justification is required to bypass.');
  if (!input.checker_id.trim()) throw new Error('A second approver (checker) is required.');
  if (input.ttl_days <= 0 || input.ttl_days > MAX_BYPASS_DAYS) throw new Error(`Bypass window must be 1–${MAX_BYPASS_DAYS} days.`);
  if (USE_FIXTURES) {
    const r = FIXTURE_QUEUE.find((x) => x.user_id === userId) ?? FIXTURE_QUEUE[0];
    const exp = new Date(Date.now() + input.ttl_days * 86400_000).toISOString();
    return delay({ ...r, status: 'BYPASSED', bypass_expires_at: exp, exposure_cap_kobo: input.exposure_cap_kobo ?? null, reason_code: input.reason });
  }
  const res = await fetch(`${tradingAdminBase()}/kyc/${encodeURIComponent(userId)}/bypass`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(input) });
  if (!res.ok) throw new Error(await parseErr(res, 'Bypass failed'));
  return res.json();
}

export async function listBypassRegister(): Promise<TradingBypassEntry[]> {
  if (USE_FIXTURES) return delay([...FIXTURE_BYPASS]);
  const res = await fetch(`${tradingAdminBase()}/kyc/bypass-register`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErr(res, 'Bypass register fetch failed'));
  const d = await res.json(); return Array.isArray(d) ? d : d.data ?? [];
}

export type { TradingKycStatus };
