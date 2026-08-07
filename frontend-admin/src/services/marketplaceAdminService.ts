import { env } from '@/config/env';
import type {
  MktListing,
  MktFlag,
  MktFlagActionRequest,
  MktAdminAuditLogEntry,
  MktBoost,
} from '@/types/marketplaceAdmin';

// Paymax Marketplace admin console — service layer.
// Backend: Go/Gin, per docs/prd/marketplace/SWARM_INTEGRATION_CONTRACT.md. Unlike
// most other modules (placement/arena/etc.), RegisterMarketplace groups routes
// directly off the raw *gin.Engine at "/v1/marketplace" — there is NO "/api"
// prefix for this module. Admin routes: /v1/marketplace/admin/*, each mutating
// route requires reason_code in the body and RBAC guard("marketplace.admin.<perm>").
// Escrow/orders/disputes were REMOVED from the backend per ADR-023 — this console
// only covers moderation, flags, boosts, and the audit log.
//
// env.apiBaseUrl looks like http://localhost:8080/api/v1 → strip the /api/v1
// suffix entirely to reach the engine root, then append /v1/marketplace/admin.
export function marketplaceAdminBase(): string {
  return `${env.apiBaseUrl.replace(/\/api\/v1\/?$/, '')}/v1/marketplace/admin`;
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  if (!token) return { 'Content-Type': 'application/json' };
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export function formatKobo(kobo: number | null | undefined): string {
  if (kobo == null) return '—';
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), 120));
}

// Backend / feature flag (FEATURE_MARKETPLACE_ENABLED) may not be live yet —
// default to deterministic fixtures unless explicitly disabled, so every screen
// renders. Mirrors arenaAdminService / featuredPlacementAdminService.
const USE_FIXTURES =
  (process.env.NEXT_PUBLIC_MARKETPLACE_ADMIN_USE_MOCK ?? 'true').toLowerCase() !== 'false';

async function parseErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return body?.error?.message ? `${body.error.message}${body.error.code ? ` (${body.error.code})` : ''}` : `${fallback}: ${res.status}`;
  } catch {
    return `${fallback}: ${res.status}`;
  }
}

const now = Date.now();
const iso = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();

// ─── Fixtures ────────────────────────────────────────────────────────────────

const FIXTURE_MODERATION_QUEUE: MktListing[] = [
  {
    id: 'lst_a1b2', market_id: 'NG', seller_id: 'usr_7f2a', category_id: 'cat_phones', category_name: 'Phones & Tablets',
    title: 'iPhone 13 Pro Max 256GB — mint condition', description: 'Barely used iPhone 13 Pro Max, 256GB, no scratches, comes with box and charger.',
    price_kobo: 65_000_000, currency: 'NGN', condition: 'used', status: 'pending_review', quality_score: 0.71,
    escrow_eligible: true, state: 'Lagos', lga: 'Ikeja', view_count: 12, save_count: 2, moderation_reason_code: null,
    created_at: iso(45), updated_at: iso(45), expires_at: iso(-60 * 24 * 60),
    seller: { id: 'usr_7f2a', trust_score: 0.62, verified_id_badge: true, verified_business_badge: false, tenure_label: '4 months', response_time_minutes: 18 },
    media: [{ id: 'med_1', url_thumb: 'https://picsum.photos/seed/iphone1/200', url_card: 'https://picsum.photos/seed/iphone1/400', url_full: 'https://picsum.photos/seed/iphone1/1200', sort_order: 0 }],
    fair_price_band: { p25_kobo: 58_000_000, p50_kobo: 63_000_000, p75_kobo: 69_000_000 },
  },
  {
    id: 'lst_c3d4', market_id: 'NG', seller_id: 'usr_2b9e', category_id: 'cat_vehicles', category_name: 'Vehicles',
    title: '2015 Toyota Camry — full option, clean papers', description: 'Foreign used Toyota Camry 2015, full option, tokunbo, first body, clean papers ready to go.',
    price_kobo: 850_000_000, currency: 'NGN', condition: 'foreign_used', status: 'pending_review', quality_score: 0.44,
    escrow_eligible: true, state: 'Abuja', lga: 'Wuse', view_count: 34, save_count: 6, moderation_reason_code: null,
    created_at: iso(210), updated_at: iso(210), expires_at: iso(-60 * 24 * 60),
    seller: { id: 'usr_2b9e', trust_score: 0.31, verified_id_badge: false, verified_business_badge: false, tenure_label: '2 weeks', response_time_minutes: null },
    media: [
      { id: 'med_2', url_thumb: 'https://picsum.photos/seed/camry1/200', url_card: 'https://picsum.photos/seed/camry1/400', url_full: 'https://picsum.photos/seed/camry1/1200', sort_order: 0 },
      { id: 'med_3', url_thumb: 'https://picsum.photos/seed/camry2/200', url_card: 'https://picsum.photos/seed/camry2/400', url_full: 'https://picsum.photos/seed/camry2/1200', sort_order: 1 },
    ],
    fair_price_band: { p25_kobo: 720_000_000, p50_kobo: 810_000_000, p75_kobo: 920_000_000 },
  },
  {
    id: 'lst_e5f6', market_id: 'NG', seller_id: 'usr_9a1c', category_id: 'cat_fashion', category_name: 'Fashion',
    title: 'Designer wristwatch (assorted)', description: 'Quality wristwatch bulk stock, wholesale price, fast movers, DM for full catalog and price list.',
    price_kobo: 4_500_000, currency: 'NGN', condition: 'new', status: 'pending_review', quality_score: 0.22,
    escrow_eligible: false, state: 'Lagos', lga: 'Alaba', view_count: 3, save_count: 0, moderation_reason_code: null,
    created_at: iso(15), updated_at: iso(15), expires_at: iso(-60 * 24 * 60),
    seller: { id: 'usr_9a1c', trust_score: 0.18, verified_id_badge: false, verified_business_badge: false, tenure_label: '3 days', response_time_minutes: null },
    media: [{ id: 'med_4', url_thumb: 'https://picsum.photos/seed/watch1/200', url_card: 'https://picsum.photos/seed/watch1/400', url_full: 'https://picsum.photos/seed/watch1/1200', sort_order: 0 }],
    fair_price_band: null,
  },
];

const FIXTURE_FLAGS: MktFlag[] = [
  { id: 'flg_1', target_type: 'listing', target_id: 'lst_e5f6', reporter_id: 'usr_8899', reason_code: 'suspected_wholesale_spam', notes: 'Bulk listing posing as retail, likely a reseller violating single-item policy.', status: 'open', reviewed_by: null, created_at: iso(300), reviewed_at: null },
  { id: 'flg_2', target_type: 'user', target_id: 'usr_2b9e', reporter_id: 'usr_4d8e', reason_code: 'suspected_fraud', notes: 'Buyer reports vehicle history does not match listing claims.', status: 'open', reviewed_by: null, created_at: iso(180), reviewed_at: null },
  { id: 'flg_3', target_type: 'chat_message', target_id: 'msg_9012', reporter_id: 'usr_3344', reason_code: 'off_platform_payment_request', notes: 'Seller asked buyer to pay via bank transfer outside escrow.', status: 'open', reviewed_by: null, created_at: iso(90), reviewed_at: null },
];

const FIXTURE_AUDIT_LOG: MktAdminAuditLogEntry[] = [
  { id: 1042, admin_id: 'adm_ops1', admin_role: 'marketplace-fraud-ops', action: 'listing.reject', target_type: 'listing', target_id: 'lst_z9y8', reason_code: 'PROHIBITED_ITEM', before_state: { status: 'pending_review' }, after_state: { status: 'removed_policy' }, created_at: iso(600) },
  { id: 1041, admin_id: 'adm_ops2', admin_role: 'marketplace-fraud-ops', action: 'flags.action', target_type: 'flag', target_id: 'flg_9', reason_code: 'CONFIRMED_FRAUD', before_state: { status: 'open' }, after_state: { status: 'actioned' }, created_at: iso(720) },
  { id: 1040, admin_id: 'adm_ops1', admin_role: 'marketplace-fraud-ops', action: 'listing.approve', target_type: 'listing', target_id: 'lst_w1v2', reason_code: '', before_state: { status: 'pending_review' }, after_state: { status: 'active' }, created_at: iso(900) },
  { id: 1039, admin_id: 'adm_super', admin_role: 'super-admin', action: 'boost.reject', target_type: 'boost', target_id: 'bst_889', reason_code: 'POLICY_VIOLATION', before_state: { status: 'active' }, after_state: { status: 'rejected_with_reason' }, created_at: iso(1_400) },
];

const FIXTURE_BOOSTS: MktBoost[] = [
  { id: 'bst_1', listing_id: 'lst_a1b2', seller_id: 'usr_7f2a', tier: 'vip', duration_days: 7, price_kobo: 500_000, ledger_charge_ref: 'ldg_chg_44', status: 'active', starts_at: iso(1_200), ends_at: iso(-8_880), listing_title: 'iPhone 13 Pro Max 256GB — mint condition' },
  { id: 'bst_2', listing_id: 'lst_c3d4', seller_id: 'usr_2b9e', tier: 'diamond', duration_days: 14, price_kobo: 1_500_000, ledger_charge_ref: 'ldg_chg_45', status: 'purchased', starts_at: null, ends_at: null, listing_title: '2015 Toyota Camry — full option, clean papers' },
];

// ─── M1 — Moderation queue ───────────────────────────────────────────────────

export async function listModerationQueue(): Promise<MktListing[]> {
  if (USE_FIXTURES) return delay([...FIXTURE_MODERATION_QUEUE]);
  const res = await fetch(`${marketplaceAdminBase()}/moderation/queue`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Moderation queue fetch failed'));
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? [];
}

export async function getModerationListing(id: string): Promise<MktListing> {
  if (USE_FIXTURES) {
    const found = FIXTURE_MODERATION_QUEUE.find((l) => l.id === id);
    if (!found) throw new Error(`Listing ${id} not found`);
    return delay(found);
  }
  // No dedicated admin GET-by-id in the frozen route list; the queue already
  // returns full listing objects, so the detail page is hydrated from the
  // cached queue result and falls back to the public listing GET if needed.
  const res = await fetch(`${env.apiBaseUrl.replace(/\/api\/v1\/?$/, '')}/v1/marketplace/listings/${encodeURIComponent(id)}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Listing fetch failed'));
  return res.json();
}

export async function approveListing(id: string, reasonCode?: string): Promise<MktListing> {
  if (USE_FIXTURES) {
    const found = FIXTURE_MODERATION_QUEUE.find((l) => l.id === id);
    if (!found) throw new Error(`Listing ${id} not found`);
    return delay({ ...found, status: 'active' });
  }
  const res = await fetch(`${marketplaceAdminBase()}/listings/${encodeURIComponent(id)}/approve`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(reasonCode ? { reason_code: reasonCode } : {}),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Approve failed'));
  return res.json();
}

// reason_code is MANDATORY — the seller sees it verbatim. Enforced client-side
// (blocks submit) AND the backend still validates (400 if missing).
export async function rejectListing(id: string, reasonCode: string): Promise<MktListing> {
  if (!reasonCode || !reasonCode.trim()) throw new Error('reason_code is required to reject a listing.');
  if (USE_FIXTURES) {
    const found = FIXTURE_MODERATION_QUEUE.find((l) => l.id === id);
    if (!found) throw new Error(`Listing ${id} not found`);
    return delay({ ...found, status: 'removed_policy', moderation_reason_code: reasonCode });
  }
  const res = await fetch(`${marketplaceAdminBase()}/listings/${encodeURIComponent(id)}/reject`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ reason_code: reasonCode }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Reject failed'));
  return res.json();
}

// ─── Flags queue ─────────────────────────────────────────────────────────────

export async function listFlags(status?: 'open' | 'actioned' | 'dismissed'): Promise<MktFlag[]> {
  if (USE_FIXTURES) return delay(status ? FIXTURE_FLAGS.filter((f) => f.status === status) : [...FIXTURE_FLAGS]);
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await fetch(`${marketplaceAdminBase()}/flags${qs}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Flags fetch failed'));
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? [];
}

export async function actionFlag(id: string, input: MktFlagActionRequest): Promise<MktFlag> {
  if (!input.reason_code || !input.reason_code.trim()) throw new Error('reason_code is required to action a flag.');
  if (USE_FIXTURES) {
    const found = FIXTURE_FLAGS.find((f) => f.id === id);
    if (!found) throw new Error(`Flag ${id} not found`);
    return delay({ ...found, status: input.action, reviewed_by: 'adm_current', reviewed_at: new Date().toISOString() });
  }
  const res = await fetch(`${marketplaceAdminBase()}/flags/${encodeURIComponent(id)}/action`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Flag action failed'));
  return res.json();
}

// ─── Audit log (read-only, append-only) ─────────────────────────────────────

export async function listAuditLog(filters?: { target_type?: string; target_id?: string; admin_id?: string }): Promise<MktAdminAuditLogEntry[]> {
  if (USE_FIXTURES) return delay([...FIXTURE_AUDIT_LOG]);
  const qs = new URLSearchParams();
  if (filters?.target_type) qs.set('target_type', filters.target_type);
  if (filters?.target_id) qs.set('target_id', filters.target_id);
  if (filters?.admin_id) qs.set('admin_id', filters.admin_id);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await fetch(`${marketplaceAdminBase()}/audit-log${suffix}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Audit log fetch failed'));
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? [];
}

// ─── Boosts admin (list + reject-with-reason) ───────────────────────────────

export async function listBoosts(): Promise<MktBoost[]> {
  if (USE_FIXTURES) return delay([...FIXTURE_BOOSTS]);
  // GET /v1/marketplace/admin/boosts → { data: [ Boost ] } (RBAC
  // marketplace.admin.moderation). Reject uses POST /admin/boosts/:id/reject.
  const res = await fetch(`${marketplaceAdminBase()}/boosts`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Boosts fetch failed'));
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? [];
}

export async function rejectBoost(id: string, reasonCode: string): Promise<MktBoost> {
  if (!reasonCode || !reasonCode.trim()) throw new Error('reason_code is required to reject a boost.');
  if (USE_FIXTURES) {
    const found = FIXTURE_BOOSTS.find((b) => b.id === id);
    if (!found) throw new Error(`Boost ${id} not found`);
    return delay({ ...found, status: 'rejected_with_reason', rejection_reason_code: reasonCode });
  }
  const res = await fetch(`${marketplaceAdminBase()}/boosts/${encodeURIComponent(id)}/reject`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ reason_code: reasonCode }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Boost reject failed'));
  return res.json();
}
