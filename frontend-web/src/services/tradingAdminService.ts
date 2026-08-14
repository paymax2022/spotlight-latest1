import { env } from '@/config/env';
import type {
  TradingKycRecord, TradingKycStatus, TradingKycEvent, TradingKycBypassRequest, TradingBypassEntry,
  StrategyPromotion, PromotionEvent, PromoteRequest, ReadinessRequest, DemoteRequest, TradingStage,
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

// ── §12 Promotion ladder ──────────────────────────────────────────────────────
// Routes: /v1/trading/admin/promotions*. Each mutating route is RBAC-guarded and the
// two-person + Risk/legal rules are enforced by the backend ladder gate — the UI
// only proposes. Fixtures are mutated in place so the mock flow feels real.

let FIXTURE_STRATEGIES: StrategyPromotion[] = [
  { StrategyID: 'trend-btc-v1',  Stage: 'live',   ValidationPassed: true,  TrackRecordDays: 140, CircuitTripped: false, Version: 6, UpdatedAt: iso(60) },
  { StrategyID: 'meanrev-eth-v2', Stage: 'canary', ValidationPassed: true,  TrackRecordDays: 72,  CircuitTripped: false, Version: 4, UpdatedAt: iso(180) },
  { StrategyID: 'breakout-fx-v1', Stage: 'shadow', ValidationPassed: true,  TrackRecordDays: 41,  CircuitTripped: false, Version: 2, UpdatedAt: iso(600) },
  { StrategyID: 'carry-basket-v1', Stage: 'paper',  ValidationPassed: false, TrackRecordDays: 12,  CircuitTripped: false, Version: 1, UpdatedAt: iso(1440) },
  { StrategyID: 'vol-scalp-x',    Stage: 'halted', ValidationPassed: true,  TrackRecordDays: 88,  CircuitTripped: true,  Version: 9, UpdatedAt: iso(30) },
];
const FIXTURE_PROMO_EVENTS: Record<string, PromotionEvent[]> = {
  'meanrev-eth-v2': [
    { StrategyID: 'meanrev-eth-v2', EventType: 'register', OldStage: '', NewStage: 'not_promoted', MakerID: null, CheckerID: null, RiskSignedOff: null, LegalSignedOff: null, Reason: '', CreatedAt: iso(9000) },
    { StrategyID: 'meanrev-eth-v2', EventType: 'promote', OldStage: 'not_promoted', NewStage: 'paper', MakerID: 'adm_maker', CheckerID: 'adm_checker', RiskSignedOff: false, LegalSignedOff: false, Reason: 'promote not_promoted→paper', CreatedAt: iso(8000) },
    { StrategyID: 'meanrev-eth-v2', EventType: 'readiness', OldStage: '', NewStage: '', MakerID: null, CheckerID: 'adm_risk', RiskSignedOff: null, LegalSignedOff: null, Reason: 'readiness update', CreatedAt: iso(4000) },
    { StrategyID: 'meanrev-eth-v2', EventType: 'promote', OldStage: 'shadow', NewStage: 'canary', MakerID: 'adm_maker', CheckerID: 'adm_checker', RiskSignedOff: false, LegalSignedOff: false, Reason: 'promote shadow→canary', CreatedAt: iso(180) },
  ],
};

export async function listPromotions(): Promise<StrategyPromotion[]> {
  if (USE_FIXTURES) return delay(FIXTURE_STRATEGIES.map((s) => ({ ...s })));
  const res = await fetch(`${tradingAdminBase()}/promotions`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErr(res, 'Promotions fetch failed'));
  const d = await res.json(); return Array.isArray(d) ? d : d.data ?? [];
}

export async function getPromotion(id: string): Promise<{ strategy: StrategyPromotion; events: PromotionEvent[] }> {
  if (USE_FIXTURES) {
    const strategy = FIXTURE_STRATEGIES.find((s) => s.StrategyID === id) ?? FIXTURE_STRATEGIES[0];
    return delay({ strategy: { ...strategy }, events: FIXTURE_PROMO_EVENTS[id] ?? [] });
  }
  const res = await fetch(`${tradingAdminBase()}/promotions/${encodeURIComponent(id)}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErr(res, 'Strategy fetch failed'));
  return res.json();
}

export async function registerStrategy(id: string): Promise<void> {
  if (!id.trim()) throw new Error('A strategy id is required.');
  if (USE_FIXTURES) {
    if (!FIXTURE_STRATEGIES.some((s) => s.StrategyID === id)) {
      FIXTURE_STRATEGIES = [...FIXTURE_STRATEGIES, { StrategyID: id, Stage: 'not_promoted', ValidationPassed: false, TrackRecordDays: 0, CircuitTripped: false, Version: 0, UpdatedAt: new Date().toISOString() }];
    }
    return delay(undefined);
  }
  const res = await fetch(`${tradingAdminBase()}/promotions/${encodeURIComponent(id)}/register`, { method: 'POST', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErr(res, 'Register failed'));
}

export async function setReadiness(id: string, input: ReadinessRequest): Promise<StrategyPromotion> {
  if (USE_FIXTURES) {
    FIXTURE_STRATEGIES = FIXTURE_STRATEGIES.map((s) => s.StrategyID === id ? { ...s, ValidationPassed: input.validation_passed, TrackRecordDays: input.track_record_days, CircuitTripped: input.circuit_tripped, Version: s.Version + 1, UpdatedAt: new Date().toISOString() } : s);
    return delay(FIXTURE_STRATEGIES.find((s) => s.StrategyID === id)!);
  }
  const res = await fetch(`${tradingAdminBase()}/promotions/${encodeURIComponent(id)}/readiness`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(input) });
  if (!res.ok) throw new Error(await parseErr(res, 'Readiness update failed'));
  const d = await res.json(); return d.strategy ?? d;
}

// promote — the acting admin is the CHECKER; maker_id must differ. Risk+legal are
// required for canary→live; the backend gate is authoritative.
export async function promoteStrategy(id: string, input: PromoteRequest): Promise<TradingStage> {
  if (!input.maker_id.trim()) throw new Error('A proposing admin (maker) is required, and must differ from you.');
  if (input.to_stage === 'live' && (!input.risk_signed_off || !input.legal_signed_off)) throw new Error('Canary → Live requires both Risk and legal sign-off.');
  if (USE_FIXTURES) {
    FIXTURE_STRATEGIES = FIXTURE_STRATEGIES.map((s) => s.StrategyID === id ? { ...s, Stage: input.to_stage, Version: s.Version + 1, UpdatedAt: new Date().toISOString() } : s);
    return delay(input.to_stage);
  }
  const res = await fetch(`${tradingAdminBase()}/promotions/${encodeURIComponent(id)}/promote`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(input) });
  if (!res.ok) throw new Error(await parseErr(res, 'Promotion denied'));
  const d = await res.json(); return d.stage;
}

export async function demoteStrategy(id: string, input: DemoteRequest): Promise<TradingStage> {
  if (!input.reason.trim()) throw new Error('A reason is required to de-risk.');
  if (USE_FIXTURES) {
    FIXTURE_STRATEGIES = FIXTURE_STRATEGIES.map((s) => s.StrategyID === id ? { ...s, Stage: input.to_stage, Version: s.Version + 1, UpdatedAt: new Date().toISOString() } : s);
    return delay(input.to_stage);
  }
  const res = await fetch(`${tradingAdminBase()}/promotions/${encodeURIComponent(id)}/demote`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(input) });
  if (!res.ok) throw new Error(await parseErr(res, 'Demotion failed'));
  const d = await res.json(); return d.stage;
}

export async function haltStrategy(id: string, reason: string): Promise<TradingStage> {
  if (!reason.trim()) throw new Error('A reason is required to halt.');
  if (USE_FIXTURES) {
    FIXTURE_STRATEGIES = FIXTURE_STRATEGIES.map((s) => s.StrategyID === id ? { ...s, Stage: 'halted', Version: s.Version + 1, UpdatedAt: new Date().toISOString() } : s);
    return delay('halted');
  }
  const res = await fetch(`${tradingAdminBase()}/promotions/${encodeURIComponent(id)}/halt`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ reason }) });
  if (!res.ok) throw new Error(await parseErr(res, 'Halt failed'));
  const d = await res.json(); return d.stage;
}

export type { TradingKycStatus };
