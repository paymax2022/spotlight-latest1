import { env } from '@/config/env';
import type {
  MktListing,
  MktOrder,
  MktDispute,
  MktDisputeDecideRequest,
  MktDisputeDecision,
  MktDisputeStatus,
  MktFlag,
  MktFlagActionRequest,
  MktAdminAuditLogEntry,
  MktBoost,
  MktCategory,
  MktCategoryInput,
  MktAnalytics,
  MktAppeal,
  MktAppealStatus,
  MktAppealDecideRequest,
  MktUserAdmin,
  MktUserStatus,
  MktUserActionRequest,
  MktKycReviewRequest,
  MktBlacklistRequest,
  MktFraudSignal,
  MktBoostPackage,
  MktCommissionConfig,
  MktDiscountCode,
  MktDiscountCodeInput,
  MktFeaturedSlotConfig,
  MktBanner,
  MktBannerStatus,
  MktBannerInput,
  MktCategoryContent,
  MktCategoryContentInput,
} from '@/types/marketplaceAdmin';

// Paymax Marketplace admin console — service layer.
// Backend: Go/Gin, per docs/prd/marketplace/SWARM_INTEGRATION_CONTRACT.md. Unlike
// most other modules (placement/arena/etc.), RegisterMarketplace groups routes
// directly off the raw *gin.Engine at "/v1/marketplace" — there is NO "/api"
// prefix for this module. Admin routes: /v1/marketplace/admin/*, each mutating
// route requires reason_code in the body and RBAC guard("marketplace.admin.<perm>").
// Dual-approval: dispute decisions on orders > NGN 500,000 (50_000_000 kobo)
// return 202 { status: 'awaiting_second_approval', ... } instead of executing.
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

// Dual-approval threshold per §2.2/§2.3/§6.3 of the build contract: NGN 500,000
// in kobo. Kept here (not just server-side) so the UI can pre-render the
// "will require second approval" hint before submission.
export const DUAL_APPROVAL_THRESHOLD_KOBO = 500_000 * 100;

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

const FIXTURE_ORDERS: Record<string, MktOrder> = {
  ord_x1: {
    id: 'ord_x1', market_id: 'NG', listing_id: 'lst_c3d4', buyer_id: 'usr_4d8e', seller_id: 'usr_2b9e', offer_id: null,
    amount_kobo: 850_000_000, escrow_fee_kobo: 8_500_000, delivery_fee_kobo: 2_000_000, status: 'disputed',
    ledger_fund_ref: 'ldg_fund_9911', ledger_release_ref: null, delivery_ref: 'dlv_2234',
    inspection_deadline: iso(-48 * 60), created_at: iso(4_000), updated_at: iso(120), funded_at: iso(3_900),
    delivered_at: iso(200), released_at: null, cancelled_at: null, listing_title: '2015 Toyota Camry — full option, clean papers',
  },
  ord_x2: {
    id: 'ord_x2', market_id: 'NG', listing_id: 'lst_a1b2', buyer_id: 'usr_1122', seller_id: 'usr_7f2a', offer_id: null,
    amount_kobo: 65_000_000, escrow_fee_kobo: 650_000, delivery_fee_kobo: 300_000, status: 'disputed',
    ledger_fund_ref: 'ldg_fund_7712', ledger_release_ref: null, delivery_ref: 'dlv_5567',
    inspection_deadline: iso(-10 * 60), created_at: iso(2_500), updated_at: iso(60), funded_at: iso(2_400),
    delivered_at: iso(150), released_at: null, cancelled_at: null, listing_title: 'iPhone 13 Pro Max 256GB — mint condition',
  },
  ord_x3: {
    id: 'ord_x3', market_id: 'NG', listing_id: 'lst_g7h8', buyer_id: 'usr_3344', seller_id: 'usr_5566', offer_id: null,
    amount_kobo: 12_000_000, escrow_fee_kobo: 120_000, delivery_fee_kobo: 250_000, status: 'in_delivery',
    ledger_fund_ref: 'ldg_fund_1200', ledger_release_ref: null, delivery_ref: 'dlv_9981',
    inspection_deadline: null, created_at: iso(6_500), updated_at: iso(4_400), funded_at: iso(6_400),
    delivered_at: null, released_at: null, cancelled_at: null, listing_title: 'Samsung Galaxy Tab S8',
  },
};

const FIXTURE_DISPUTES: MktDispute[] = [
  {
    id: 'dsp_1001', order_id: 'ord_x1', opened_by: 'usr_4d8e', reason_code: 'item_not_as_described', status: 'under_review',
    decision: null, decision_notes: null, decided_by: null, requires_dual_approval: false, second_approver_id: null,
    evidence_deadline: iso(-100), created_at: iso(4_200), decided_at: null, executed_at: null,
    order: FIXTURE_ORDERS.ord_x1, listing_title: FIXTURE_ORDERS.ord_x1.listing_title,
    buyer_evidence: [
      { type: 'photo', url_or_text: 'https://picsum.photos/seed/dmg1/500', submitted_by: 'buyer', created_at: iso(3_800) },
      { type: 'chat_excerpt', url_or_text: '"Seller confirmed no accident history but chassis shows repaint."', submitted_by: 'buyer', created_at: iso(3_780) },
    ],
    seller_evidence: [
      { type: 'document', url_or_text: 'Vehicle inspection report (pre-sale).pdf', submitted_by: 'seller', created_at: iso(3_600) },
    ],
  },
  {
    id: 'dsp_1002', order_id: 'ord_x2', opened_by: 'usr_1122', reason_code: 'item_damaged', status: 'under_review',
    decision: null, decision_notes: null, decided_by: null, requires_dual_approval: false, second_approver_id: null,
    evidence_deadline: iso(-20), created_at: iso(2_600), decided_at: null, executed_at: null,
    order: FIXTURE_ORDERS.ord_x2, listing_title: FIXTURE_ORDERS.ord_x2.listing_title,
    buyer_evidence: [
      { type: 'photo', url_or_text: 'https://picsum.photos/seed/crack1/500', submitted_by: 'buyer', created_at: iso(200) },
    ],
    seller_evidence: [],
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
  { id: 1039, admin_id: 'adm_super', admin_role: 'super-admin', action: 'dispute.decide', target_type: 'dispute', target_id: 'dsp_889', reason_code: 'EVIDENCE_SUPPORTS_BUYER', before_state: { status: 'under_review' }, after_state: { status: 'decided', decision: 'refund_buyer' }, created_at: iso(1_400) },
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

// ─── M4 — Dispute workbench ──────────────────────────────────────────────────

export async function listDisputesQueue(status?: MktDisputeStatus): Promise<MktDispute[]> {
  if (USE_FIXTURES) return delay(status ? FIXTURE_DISPUTES.filter((d) => d.status === status) : [...FIXTURE_DISPUTES]);
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await fetch(`${marketplaceAdminBase()}/disputes/queue${qs}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Dispute queue fetch failed'));
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? [];
}

export async function getDispute(id: string): Promise<MktDispute> {
  if (USE_FIXTURES) {
    const found = FIXTURE_DISPUTES.find((d) => d.id === id);
    if (!found) throw new Error(`Dispute ${id} not found`);
    return delay(found);
  }
  const res = await fetch(`${marketplaceAdminBase()}/disputes/${encodeURIComponent(id)}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Dispute fetch failed'));
  return res.json();
}

// POST /admin/disputes/:id/decide — reason_code MANDATORY. If the underlying
// order.amount_kobo > NGN 500k the API returns 202 with
// status: 'awaiting_second_approval' (still resolved here as a normal MktDispute
// response so the caller can inspect .status / .requires_dual_approval).
export async function decideDispute(id: string, input: MktDisputeDecideRequest): Promise<MktDispute> {
  if (!input.reason_code || !input.reason_code.trim()) throw new Error('reason_code is required to decide a dispute.');
  if (USE_FIXTURES) {
    const found = FIXTURE_DISPUTES.find((d) => d.id === id);
    if (!found) throw new Error(`Dispute ${id} not found`);
    const amount = found.order?.amount_kobo ?? 0;
    const dual = amount > DUAL_APPROVAL_THRESHOLD_KOBO;
    return delay({
      ...found,
      decision: input.decision,
      decision_notes: input.notes ?? null,
      decided_by: 'adm_current',
      requires_dual_approval: dual,
      status: dual ? 'decided' : 'executed',
      decided_at: new Date().toISOString(),
      executed_at: dual ? null : new Date().toISOString(),
    });
  }
  const res = await fetch(`${marketplaceAdminBase()}/disputes/${encodeURIComponent(id)}/decide`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(input),
  });
  if (!res.ok && res.status !== 202) throw new Error(await parseErrorMessage(res, 'Dispute decision failed'));
  return res.json();
}

// POST /admin/disputes/:id/approve — second-approver sign-off for dual-approval
// disputes (order amount > NGN 500k). Backend enforces the approver must differ
// from the original decider (409 SAME_APPROVER_NOT_ALLOWED otherwise).
export async function approveDisputeSecondSign(id: string, reasonCode?: string): Promise<MktDispute> {
  if (USE_FIXTURES) {
    const found = FIXTURE_DISPUTES.find((d) => d.id === id);
    if (!found) throw new Error(`Dispute ${id} not found`);
    return delay({ ...found, status: 'executed', second_approver_id: 'adm_second', executed_at: new Date().toISOString() });
  }
  const res = await fetch(`${marketplaceAdminBase()}/disputes/${encodeURIComponent(id)}/approve`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(reasonCode ? { reason_code: reasonCode } : {}),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Second approval failed'));
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

// ─── Orders aging dashboard ──────────────────────────────────────────────────

export async function listOrdersAging(minAgeHours = 72): Promise<MktOrder[]> {
  if (USE_FIXTURES) return delay(Object.values(FIXTURE_ORDERS));
  const res = await fetch(`${marketplaceAdminBase()}/orders/aging?min_age_hours=${minAgeHours}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Orders aging fetch failed'));
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? [];
}

// ─── Boosts admin (scaffold — reject-with-reason wired) ─────────────────────

export async function listBoosts(): Promise<MktBoost[]> {
  if (USE_FIXTURES) return delay([...FIXTURE_BOOSTS]);
  // No dedicated GET /admin/boosts list route is frozen in the integration
  // contract yet — scaffolded against the member GET boosts/:id pattern; wire
  // to the real admin list endpoint once Agent A exposes one.
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

// ─── Taxonomy (categories + attribute schema) ────────────────────────────────

const FIXTURE_CATEGORIES: MktCategory[] = [
  {
    id: 'cat_vehicles', market_id: 'NG', parent_id: null, slug: 'vehicles', name: 'Vehicles',
    risk_tier: 2, commission_bps: 250, is_active: true, listing_count: 1842,
    attribute_schema: {
      required: ['make', 'year'], additionalProperties: false,
      properties: {
        make: { type: 'string', enum: ['toyota', 'honda', 'lexus', 'mercedes', 'other'] },
        year: { type: 'integer', minimum: 1990, maximum: 2026 },
        transmission: { type: 'string', enum: ['automatic', 'manual'] },
      },
    },
    created_at: iso(60 * 24 * 90), updated_at: iso(60 * 24 * 5),
  },
  {
    id: 'cat_phones', market_id: 'NG', parent_id: null, slug: 'phones-tablets', name: 'Phones & Tablets',
    risk_tier: 0, commission_bps: 500, is_active: true, listing_count: 5310,
    attribute_schema: {
      required: ['brand'], additionalProperties: false,
      properties: {
        brand: { type: 'string', enum: ['apple', 'samsung', 'tecno', 'infinix', 'other'] },
        storage_gb: { type: 'integer', minimum: 8, maximum: 2048 },
      },
    },
    created_at: iso(60 * 24 * 90), updated_at: iso(60 * 24 * 12),
  },
  {
    id: 'cat_fashion', market_id: 'NG', parent_id: null, slug: 'fashion', name: 'Fashion',
    risk_tier: 1, commission_bps: 700, is_active: true, listing_count: 2205,
    attribute_schema: { properties: {} },
    created_at: iso(60 * 24 * 90), updated_at: iso(60 * 24 * 40),
  },
  {
    id: 'cat_phones_iphone', market_id: 'NG', parent_id: 'cat_phones', slug: 'iphone', name: 'iPhone',
    risk_tier: 0, commission_bps: 500, is_active: true, listing_count: 1290,
    attribute_schema: {
      required: ['model'], additionalProperties: false,
      properties: { model: { type: 'string', enum: ['13', '14', '15', '16', 'other'] } },
    },
    created_at: iso(60 * 24 * 80), updated_at: iso(60 * 24 * 8),
  },
  {
    id: 'cat_gift_cards', market_id: 'NG', parent_id: null, slug: 'gift-cards', name: 'Gift Cards (legacy)',
    risk_tier: 3, commission_bps: 0, is_active: false, listing_count: 0,
    attribute_schema: { properties: {} },
    created_at: iso(60 * 24 * 120), updated_at: iso(60 * 24 * 60),
  },
];

export async function listCategories(): Promise<MktCategory[]> {
  if (USE_FIXTURES) return delay([...FIXTURE_CATEGORIES]);
  const res = await fetch(`${marketplaceAdminBase()}/categories`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Categories fetch failed'));
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? [];
}

export async function getCategory(id: string): Promise<MktCategory> {
  if (USE_FIXTURES) {
    const found = FIXTURE_CATEGORIES.find((c) => c.id === id);
    if (!found) throw new Error(`Category ${id} not found`);
    return delay({ ...found });
  }
  const res = await fetch(`${marketplaceAdminBase()}/categories/${encodeURIComponent(id)}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Category fetch failed'));
  return res.json();
}

function validateCategoryInput(input: MktCategoryInput): void {
  if (!input.name.trim()) throw new Error('name is required.');
  if (!/^[a-z0-9-]+$/.test(input.slug)) throw new Error('slug must be lowercase letters, digits, and hyphens only.');
  if (input.risk_tier < 0 || input.risk_tier > 3) throw new Error('risk_tier must be 0–3.');
  if (input.commission_bps < 0 || input.commission_bps > 10_000) throw new Error('commission_bps must be 0–10000.');
}

export async function createCategory(input: MktCategoryInput): Promise<MktCategory> {
  validateCategoryInput(input);
  if (USE_FIXTURES) {
    return delay({
      id: `cat_${input.slug}`, market_id: 'NG', parent_id: input.parent_id ?? null, slug: input.slug, name: input.name,
      risk_tier: input.risk_tier, commission_bps: input.commission_bps, is_active: input.is_active,
      attribute_schema: input.attribute_schema, listing_count: 0,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
  }
  const res = await fetch(`${marketplaceAdminBase()}/categories`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(input) });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Category create failed'));
  return res.json();
}

export async function updateCategory(id: string, input: MktCategoryInput): Promise<MktCategory> {
  validateCategoryInput(input);
  if (USE_FIXTURES) {
    const found = FIXTURE_CATEGORIES.find((c) => c.id === id);
    if (!found) throw new Error(`Category ${id} not found`);
    return delay({ ...found, ...input, id, parent_id: input.parent_id ?? null, updated_at: new Date().toISOString() });
  }
  const res = await fetch(`${marketplaceAdminBase()}/categories/${encodeURIComponent(id)}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(input) });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Category update failed'));
  return res.json();
}

// setCategoryActive disables/enables a category. Disabling requires a reason_code
// (audited) and — per EC-007 — the backend must reject disabling a category that
// still has active listings; the UI surfaces listing_count as a pre-check.
export async function setCategoryActive(id: string, isActive: boolean, reasonCode: string): Promise<MktCategory> {
  if (!reasonCode || !reasonCode.trim()) throw new Error('reason_code is required to enable/disable a category.');
  if (USE_FIXTURES) {
    const found = FIXTURE_CATEGORIES.find((c) => c.id === id);
    if (!found) throw new Error(`Category ${id} not found`);
    if (!isActive && (found.listing_count ?? 0) > 0) {
      throw new Error(`Cannot disable a category with ${found.listing_count} active listing(s) (CATEGORY_HAS_LISTINGS). Reassign or expire them first.`);
    }
    return delay({ ...found, is_active: isActive, updated_at: new Date().toISOString() });
  }
  const res = await fetch(`${marketplaceAdminBase()}/categories/${encodeURIComponent(id)}/active`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ is_active: isActive, reason_code: reasonCode }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Category status change failed'));
  return res.json();
}

// ─── Appeals (moderation reversal, maker-checker) — MOD-009 ──────────────────

const FIXTURE_APPEALS: MktAppeal[] = [
  {
    id: 'apl_1', target_type: 'listing', target_id: 'lst_e5f6', appellant_id: 'usr_9a1c',
    original_action: 'removed_policy', original_reason_code: 'counterfeit_suspected',
    appellant_note: 'These are genuine ex-UK watches with receipts. I can provide proof of purchase and serials.',
    status: 'opened', decision: null, requires_dual_approval: false, created_at: iso(30),
  },
  {
    id: 'apl_2', target_type: 'boost', target_id: 'bst_77', appellant_id: 'usr_7f2a',
    original_action: 'rejected_with_reason', original_reason_code: 'listing_policy_removed',
    appellant_note: 'The underlying listing was reinstated on appeal, so the boost rejection should be reversed and re-run.',
    status: 'decided', decision: 'overturned', decided_by: 'adm_kemi', requires_dual_approval: true,
    decision_notes: 'Listing reinstated; boost rejection no longer valid. Overturn + re-run boost.',
    created_at: iso(220), decided_at: iso(40),
  },
  {
    id: 'apl_3', target_type: 'user', target_id: 'usr_2b9e', appellant_id: 'usr_2b9e',
    original_action: 'suspended', original_reason_code: 'multiple_fraud_flags',
    appellant_note: 'My account was suspended by mistake — the flags were from a buyer I had a dispute with.',
    status: 'executed', decision: 'upheld', decided_by: 'adm_tunde',
    decision_notes: 'Fraud flags corroborated by device fingerprint. Suspension stands.',
    created_at: iso(60 * 30), decided_at: iso(60 * 28), executed_at: iso(60 * 28),
  },
];

export async function listAppeals(status?: MktAppealStatus): Promise<MktAppeal[]> {
  if (USE_FIXTURES) return delay(status ? FIXTURE_APPEALS.filter((a) => a.status === status) : [...FIXTURE_APPEALS]);
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await fetch(`${marketplaceAdminBase()}/appeals${qs}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Appeals fetch failed'));
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? [];
}

export async function getAppeal(id: string): Promise<MktAppeal> {
  if (USE_FIXTURES) {
    const found = FIXTURE_APPEALS.find((a) => a.id === id);
    if (!found) throw new Error(`Appeal ${id} not found`);
    return delay({ ...found });
  }
  const res = await fetch(`${marketplaceAdminBase()}/appeals/${encodeURIComponent(id)}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Appeal fetch failed'));
  return res.json();
}

// decideAppeal: uphold (deny appeal → original action stands) executes immediately;
// overturn (reverse a policy removal/suspension) is high-trust → returns a
// dual-approval-pending appeal that a DIFFERENT admin must second-sign.
export async function decideAppeal(id: string, input: MktAppealDecideRequest): Promise<MktAppeal> {
  if (!input.reason_code || !input.reason_code.trim()) throw new Error('reason_code is required to decide an appeal.');
  if (USE_FIXTURES) {
    const found = FIXTURE_APPEALS.find((a) => a.id === id);
    if (!found) throw new Error(`Appeal ${id} not found`);
    const overturn = input.decision === 'overturn';
    return delay({
      ...found,
      decision: overturn ? 'overturned' : 'upheld',
      decision_notes: input.notes ?? null,
      decided_by: 'adm_current',
      requires_dual_approval: overturn,
      status: overturn ? 'decided' : 'executed',
      decided_at: new Date().toISOString(),
      executed_at: overturn ? null : new Date().toISOString(),
    });
  }
  const res = await fetch(`${marketplaceAdminBase()}/appeals/${encodeURIComponent(id)}/decide`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(input),
  });
  if (!res.ok && res.status !== 202) throw new Error(await parseErrorMessage(res, 'Appeal decision failed'));
  return res.json();
}

// approveAppealSecondSign: second-approver sign-off that executes an overturn. The
// backend enforces the approver differs from the decider (409 SAME_APPROVER_NOT_ALLOWED).
export async function approveAppealSecondSign(id: string, reasonCode?: string): Promise<MktAppeal> {
  if (USE_FIXTURES) {
    const found = FIXTURE_APPEALS.find((a) => a.id === id);
    if (!found) throw new Error(`Appeal ${id} not found`);
    return delay({ ...found, status: 'executed', second_approver_id: 'adm_second', executed_at: new Date().toISOString() });
  }
  const res = await fetch(`${marketplaceAdminBase()}/appeals/${encodeURIComponent(id)}/approve`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(reasonCode ? { reason_code: reasonCode } : {}),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Second approval failed'));
  return res.json();
}

// ─── Analytics (GMV / DAU / conversion) — ADM-005 ────────────────────────────

function buildGmvSeries(days: number): { date: string; gmv_kobo: number; deals: number }[] {
  const out: { date: string; gmv_kobo: number; deals: number }[] = [];
  // Deterministic pseudo-series (no Math.random) so fixtures render stably.
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60_000);
    const wobble = 1 + 0.35 * Math.sin(i / 2) + (i % 7 === 0 ? 0.4 : 0); // weekly spikes
    out.push({
      date: d.toISOString().slice(0, 10),
      gmv_kobo: Math.round(42_000_000 * wobble),
      deals: Math.round(18 * wobble),
    });
  }
  return out;
}

export async function getMarketplaceAnalytics(rangeDays: 7 | 30 | 90 = 30): Promise<MktAnalytics> {
  if (USE_FIXTURES) {
    const series = buildGmvSeries(rangeDays);
    const gmv = series.reduce((s, p) => s + p.gmv_kobo, 0);
    return delay({
      range_days: rangeDays,
      gmv_kobo: gmv,
      gmv_prev_kobo: Math.round(gmv * 0.86),
      revenue_kobo: Math.round(gmv * 0.031),
      dau: 8_420,
      active_listings: 214_530,
      new_listings: series.length * 640,
      funnel: { views: 4_120_000, contacts: 286_400, deals: series.reduce((s, p) => s + p.deals, 0) },
      gmv_series: series,
      top_categories: [
        { category_id: 'cat_vehicles', name: 'Vehicles', gmv_kobo: Math.round(gmv * 0.34), active_listings: 18_420 },
        { category_id: 'cat_phones', name: 'Phones & Tablets', gmv_kobo: Math.round(gmv * 0.22), active_listings: 53_100 },
        { category_id: 'cat_property', name: 'Property', gmv_kobo: Math.round(gmv * 0.19), active_listings: 9_240 },
        { category_id: 'cat_electronics', name: 'Electronics', gmv_kobo: Math.round(gmv * 0.13), active_listings: 41_880 },
        { category_id: 'cat_fashion', name: 'Fashion', gmv_kobo: Math.round(gmv * 0.07), active_listings: 22_050 },
      ],
    });
  }
  const res = await fetch(`${marketplaceAdminBase()}/analytics?range_days=${rangeDays}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Analytics fetch failed'));
  return res.json();
}

// ─── Users, Trust & Safety, Fraud — TS-12 (USR-001…008) ──────────────────────

const FIXTURE_USERS: MktUserAdmin[] = [
  {
    id: 'usr_7f2a', display_name: 'Tunde Electronics', email_masked: 't***e@gmail.com', phone_masked: '+234 80****1234',
    status: 'active', kyc_tier: 'tier2_sell', kyc_pending: false, trust_score: 0.86, verified_id_badge: true, verified_business_badge: false,
    active_listings: 42, completed_deals: 118, open_flags: 0, fraud_score: 0.08,
    created_at: iso(60 * 24 * 220), last_active_at: iso(35),
  },
  {
    id: 'usr_2b9e', display_name: 'Lagos Auto Hub', email_masked: 'l***b@yahoo.com', phone_masked: '+234 70****5566',
    status: 'active', kyc_tier: 'tier1_buy', kyc_pending: true, trust_score: 0.31, verified_id_badge: false, verified_business_badge: false,
    active_listings: 12, completed_deals: 3, open_flags: 4, fraud_score: 0.71,
    created_at: iso(60 * 24 * 14), last_active_at: iso(90),
  },
  {
    id: 'usr_9a1c', display_name: 'QuickDeals NG', email_masked: 'q***s@gmail.com', phone_masked: '+234 81****9090',
    status: 'suspended', kyc_tier: 'tier0_browse', kyc_pending: false, trust_score: 0.18, verified_id_badge: false, verified_business_badge: false,
    active_listings: 0, completed_deals: 0, open_flags: 7, fraud_score: 0.88, suspension_reason_code: 'counterfeit_repeat',
    created_at: iso(60 * 24 * 3), last_active_at: iso(60 * 20),
  },
  {
    id: 'usr_5566', display_name: 'Ada Stores', email_masked: 'a***a@outlook.com', phone_masked: '+234 90****4321',
    status: 'active', kyc_tier: 'tier3_business', kyc_pending: false, trust_score: 0.92, verified_id_badge: true, verified_business_badge: true,
    active_listings: 210, completed_deals: 540, open_flags: 0, fraud_score: 0.04,
    created_at: iso(60 * 24 * 400), last_active_at: iso(12),
  },
];

const FIXTURE_FRAUD_SIGNALS: MktFraudSignal[] = [
  { id: 'frd_1', kind: 'duplicate_device', user_id: 'usr_2b9e', user_display_name: 'Lagos Auto Hub', severity: 'high', detail: 'Device fingerprint shared across 4 accounts created within 48h.', related_user_ids: ['usr_2b9e', 'usr_9a1c', 'usr_dd01', 'usr_dd02'], created_at: iso(120) },
  { id: 'frd_2', kind: 'payment_evasion', user_id: 'usr_9a1c', user_display_name: 'QuickDeals NG', severity: 'high', detail: 'Repeated "pay outside the platform" language across 6 chats.', related_user_ids: ['usr_9a1c'], created_at: iso(240) },
  { id: 'frd_3', kind: 'velocity', user_id: 'usr_2b9e', user_display_name: 'Lagos Auto Hub', severity: 'medium', detail: '18 listings created in 30 minutes.', related_user_ids: ['usr_2b9e'], created_at: iso(300) },
  { id: 'frd_4', kind: 'multiple_flags', user_id: 'usr_9a1c', user_display_name: 'QuickDeals NG', severity: 'medium', detail: '7 buyer flags in the last 7 days.', related_user_ids: ['usr_9a1c'], created_at: iso(60 * 10) },
];

export async function searchUsers(params?: { q?: string; status?: MktUserStatus; minFraud?: number }): Promise<MktUserAdmin[]> {
  if (USE_FIXTURES) {
    let out = [...FIXTURE_USERS];
    if (params?.status) out = out.filter((u) => u.status === params.status);
    if (params?.minFraud != null) out = out.filter((u) => u.fraud_score >= (params.minFraud as number));
    if (params?.q?.trim()) {
      const n = params.q.trim().toLowerCase();
      out = out.filter((u) => u.display_name.toLowerCase().includes(n) || u.id.toLowerCase().includes(n) || u.email_masked.toLowerCase().includes(n));
    }
    return delay(out);
  }
  const qs = new URLSearchParams();
  if (params?.q) qs.set('q', params.q);
  if (params?.status) qs.set('status', params.status);
  if (params?.minFraud != null) qs.set('min_fraud', String(params.minFraud));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await fetch(`${marketplaceAdminBase()}/users${suffix}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'User search failed'));
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? [];
}

// ─── Pricing & Monetisation config — ADM-001/002, MO-002/011/016 ─────────────

const FIXTURE_BOOST_PACKAGES: MktBoostPackage[] = [
  { tier: 'start', label: 'Start', duration_days: 7, price_kobo: 50_000, weight: 1.0, is_active: true },
  { tier: 'vip', label: 'VIP', duration_days: 14, price_kobo: 200_000, weight: 2.0, is_active: true },
  { tier: 'vip_gold', label: 'VIP Gold', duration_days: 30, price_kobo: 500_000, weight: 3.0, is_active: true },
  { tier: 'diamond', label: 'Diamond', duration_days: 30, price_kobo: 1_500_000, weight: 5.0, is_active: true },
  { tier: 'enterprise', label: 'Enterprise', duration_days: 60, price_kobo: 5_000_000, weight: 8.0, is_active: false },
];

let fixtureCommission: MktCommissionConfig = { default_bps: 500, boost_revenue_bps: 10_000, updated_at: iso(60 * 24 * 9), updated_by: 'adm_tunde' };

const FIXTURE_DISCOUNTS: MktDiscountCode[] = [
  { id: 'dsc_1', code: 'BOOST50', kind: 'percent', value: 50, applies_to: 'boost', max_redemptions: 1000, redeemed_count: 640, valid_from: iso(60 * 24 * 20), valid_until: iso(-60 * 24 * 10), is_active: true, created_at: iso(60 * 24 * 20) },
  { id: 'dsc_2', code: 'NEWSELLER', kind: 'fixed', value: 20_000, applies_to: 'boost', max_redemptions: null, redeemed_count: 2130, valid_from: iso(60 * 24 * 60), valid_until: null, is_active: true, created_at: iso(60 * 24 * 60) },
  { id: 'dsc_3', code: 'XMAS2025', kind: 'percent', value: 30, applies_to: 'boost', max_redemptions: 500, redeemed_count: 500, valid_from: iso(60 * 24 * 90), valid_until: iso(60 * 24 * 30), is_active: false, created_at: iso(60 * 24 * 90) },
];

const FIXTURE_FEATURED_SLOTS: MktFeaturedSlotConfig[] = [
  { surface: 'home_hero', label: 'Home — hero carousel', max_slots: 6, filled_slots: 6 },
  { surface: 'category_top', label: 'Category — top strip', max_slots: 4, filled_slots: 3 },
  { surface: 'search_top', label: 'Search — sponsored row', max_slots: 3, filled_slots: 2 },
];

export async function listBoostPackages(): Promise<MktBoostPackage[]> {
  if (USE_FIXTURES) return delay([...FIXTURE_BOOST_PACKAGES]);
  const res = await fetch(`${marketplaceAdminBase()}/boost-packages`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Boost packages fetch failed'));
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? [];
}

export async function getUserAdmin(id: string): Promise<MktUserAdmin> {
  if (USE_FIXTURES) {
    const found = FIXTURE_USERS.find((u) => u.id === id);
    if (!found) throw new Error(`User ${id} not found`);
    return delay({ ...found });
  }
  const res = await fetch(`${marketplaceAdminBase()}/users/${encodeURIComponent(id)}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'User fetch failed'));
  return res.json();
}

// setUserStatus: suspend/reinstate execute immediately; BAN (most destructive,
// USR-007) returns a dual-approval-pending user a DIFFERENT admin must second-sign.
export async function setUserStatus(id: string, input: MktUserActionRequest): Promise<MktUserAdmin> {
  if (!input.reason_code || !input.reason_code.trim()) throw new Error('reason_code is required to change a user’s status.');
  if (USE_FIXTURES) {
    const found = FIXTURE_USERS.find((u) => u.id === id);
    if (!found) throw new Error(`User ${id} not found`);
    if (input.action === 'ban') {
      return delay({ ...found, pending_action: 'ban', pending_action_by: 'adm_current', requires_dual_approval: true, suspension_reason_code: input.reason_code });
    }
    return delay({
      ...found,
      status: input.action === 'suspend' ? 'suspended' : 'active',
      suspension_reason_code: input.action === 'suspend' ? input.reason_code : null,
      pending_action: null, requires_dual_approval: false,
    });
  }
  const res = await fetch(`${marketplaceAdminBase()}/users/${encodeURIComponent(id)}/status`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(input),
  });
  if (!res.ok && res.status !== 202) throw new Error(await parseErrorMessage(res, 'User status change failed'));
  return res.json();
}

// approveUserActionSecondSign: executes a pending BAN; backend enforces a different
// approver than the initiator (409 SAME_APPROVER_NOT_ALLOWED).
export async function approveUserActionSecondSign(id: string, reasonCode?: string): Promise<MktUserAdmin> {
  if (USE_FIXTURES) {
    const found = FIXTURE_USERS.find((u) => u.id === id);
    if (!found) throw new Error(`User ${id} not found`);
    return delay({ ...found, status: 'banned', pending_action: null, requires_dual_approval: false });
  }
  const res = await fetch(`${marketplaceAdminBase()}/users/${encodeURIComponent(id)}/status/approve`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(reasonCode ? { reason_code: reasonCode } : {}),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Second approval failed'));
  return res.json();
}

export async function reviewKyc(id: string, input: MktKycReviewRequest): Promise<MktUserAdmin> {
  if (!input.reason_code || !input.reason_code.trim()) throw new Error('reason_code is required to review KYC.');
  if (USE_FIXTURES) {
    const found = FIXTURE_USERS.find((u) => u.id === id);
    if (!found) throw new Error(`User ${id} not found`);
    return delay({ ...found, kyc_pending: false, kyc_tier: input.decision === 'approve' ? (input.grant_tier ?? found.kyc_tier) : found.kyc_tier, verified_id_badge: input.decision === 'approve' ? true : found.verified_id_badge });
  }
  const res = await fetch(`${marketplaceAdminBase()}/users/${encodeURIComponent(id)}/kyc`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'KYC review failed'));
  return res.json();
}

export async function blacklistIdentifier(userId: string, input: MktBlacklistRequest): Promise<{ ok: boolean }> {
  if (!input.value.trim() || !input.reason_code.trim()) throw new Error('value and reason_code are required to blacklist.');
  if (USE_FIXTURES) return delay({ ok: true });
  const res = await fetch(`${marketplaceAdminBase()}/users/${encodeURIComponent(userId)}/blacklist`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Blacklist failed'));
  return res.json();
}

// logViewAs records an audited "view as user" access (USR-008). No impersonation
// is performed client-side; this only writes the audit trail the backend requires
// before a support view is granted.
export async function logViewAs(userId: string, reasonCode: string): Promise<{ ok: boolean }> {
  if (!reasonCode.trim()) throw new Error('reason_code is required to view as a user.');
  if (USE_FIXTURES) return delay({ ok: true });
  const res = await fetch(`${marketplaceAdminBase()}/users/${encodeURIComponent(userId)}/view-as`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ reason_code: reasonCode }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'View-as failed'));
  return res.json();
}

export async function listFraudSignals(severity?: 'low' | 'medium' | 'high'): Promise<MktFraudSignal[]> {
  if (USE_FIXTURES) return delay(severity ? FIXTURE_FRAUD_SIGNALS.filter((s) => s.severity === severity) : [...FIXTURE_FRAUD_SIGNALS]);
  const qs = severity ? `?severity=${encodeURIComponent(severity)}` : '';
  const res = await fetch(`${marketplaceAdminBase()}/fraud-signals${qs}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Fraud signals fetch failed'));
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? [];
}

// upsertBoostPackage: price/duration/weight/active for a tier. Applies to NEW
// purchases only (ADM-001). reason_code mandatory (audited).
export async function upsertBoostPackage(pkg: MktBoostPackage, reasonCode: string): Promise<MktBoostPackage> {
  if (!reasonCode.trim()) throw new Error('reason_code is required to change a boost package.');
  if (pkg.price_kobo < 0 || pkg.duration_days <= 0 || pkg.weight < 0) throw new Error('price, duration, and weight must be non-negative (duration > 0).');
  if (USE_FIXTURES) return delay({ ...pkg });
  const res = await fetch(`${marketplaceAdminBase()}/boost-packages/${encodeURIComponent(pkg.tier)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify({ ...pkg, reason_code: reasonCode }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Boost package update failed'));
  return res.json();
}

export async function getCommissionConfig(): Promise<MktCommissionConfig> {
  if (USE_FIXTURES) return delay({ ...fixtureCommission });
  const res = await fetch(`${marketplaceAdminBase()}/commission`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Commission fetch failed'));
  return res.json();
}

// setCommissionConfig: the platform default take-rate. Per-category overrides live
// in Taxonomy (category.commission_bps). Applies to NEW purchases only; audited.
export async function setCommissionConfig(defaultBps: number, reasonCode: string): Promise<MktCommissionConfig> {
  if (!reasonCode.trim()) throw new Error('reason_code is required to change commission.');
  if (defaultBps < 0 || defaultBps > 10_000) throw new Error('default_bps must be 0–10000.');
  if (USE_FIXTURES) {
    fixtureCommission = { ...fixtureCommission, default_bps: defaultBps, updated_at: new Date().toISOString(), updated_by: 'adm_current' };
    return delay({ ...fixtureCommission });
  }
  const res = await fetch(`${marketplaceAdminBase()}/commission`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify({ default_bps: defaultBps, reason_code: reasonCode }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Commission update failed'));
  return res.json();
}

export async function listDiscountCodes(): Promise<MktDiscountCode[]> {
  if (USE_FIXTURES) return delay([...FIXTURE_DISCOUNTS]);
  const res = await fetch(`${marketplaceAdminBase()}/discount-codes`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Discount codes fetch failed'));
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? [];
}

export async function createDiscountCode(input: MktDiscountCodeInput): Promise<MktDiscountCode> {
  if (!input.reason_code.trim()) throw new Error('reason_code is required to create a discount code.');
  if (!/^[A-Z0-9_-]{3,24}$/.test(input.code)) throw new Error('code must be 3–24 chars: A–Z, 0–9, dash, underscore.');
  if (input.kind === 'percent' && (input.value <= 0 || input.value > 100)) throw new Error('percent value must be 1–100.');
  if (input.kind === 'fixed' && input.value <= 0) throw new Error('fixed value (kobo) must be positive.');
  if (USE_FIXTURES) {
    return delay({
      id: `dsc_${Date.now()}`, code: input.code, kind: input.kind, value: input.value, applies_to: input.applies_to,
      max_redemptions: input.max_redemptions ?? null, redeemed_count: 0, valid_from: new Date().toISOString(),
      valid_until: input.valid_until ?? null, is_active: true, created_at: new Date().toISOString(),
    });
  }
  const res = await fetch(`${marketplaceAdminBase()}/discount-codes`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(input) });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Discount code create failed'));
  return res.json();
}

export async function setDiscountCodeActive(id: string, isActive: boolean, reasonCode: string): Promise<MktDiscountCode> {
  if (!reasonCode.trim()) throw new Error('reason_code is required to enable/disable a discount code.');
  if (USE_FIXTURES) {
    const found = FIXTURE_DISCOUNTS.find((d) => d.id === id);
    if (!found) throw new Error(`Discount code ${id} not found`);
    return delay({ ...found, is_active: isActive });
  }
  const res = await fetch(`${marketplaceAdminBase()}/discount-codes/${encodeURIComponent(id)}/active`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ is_active: isActive, reason_code: reasonCode }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Discount code status change failed'));
  return res.json();
}

export async function listFeaturedSlots(): Promise<MktFeaturedSlotConfig[]> {
  if (USE_FIXTURES) return delay([...FIXTURE_FEATURED_SLOTS]);
  const res = await fetch(`${marketplaceAdminBase()}/featured-slots`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Featured slots fetch failed'));
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? [];
}

export async function setFeaturedSlotCap(surface: string, maxSlots: number, reasonCode: string): Promise<MktFeaturedSlotConfig> {
  if (!reasonCode.trim()) throw new Error('reason_code is required to change slot inventory.');
  if (maxSlots < 0) throw new Error('max_slots must be non-negative.');
  if (USE_FIXTURES) {
    const found = FIXTURE_FEATURED_SLOTS.find((s) => s.surface === surface);
    if (!found) throw new Error(`Surface ${surface} not found`);
    return delay({ ...found, max_slots: maxSlots });
  }
  const res = await fetch(`${marketplaceAdminBase()}/featured-slots/${encodeURIComponent(surface)}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify({ max_slots: maxSlots, reason_code: reasonCode }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Slot inventory change failed'));
  return res.json();
}

// ─── CMS: home banners + category content — ADM-003/004 ──────────────────────

const FIXTURE_BANNERS: MktBanner[] = [
  { id: 'ban_1', slot: 'home_hero', title: 'Detty December Deals', subtitle: 'Up to 40% off on phones & electronics', image_url: 'https://picsum.photos/seed/banner1/1200/400', cta_label: 'Shop phones', cta_type: 'category', cta_value: 'cat_phones', status: 'live', start_at: iso(60 * 24 * 5), end_at: iso(-60 * 24 * 20), sort_order: 0, created_at: iso(60 * 24 * 6) },
  { id: 'ban_2', slot: 'home_hero', title: 'Sell your car in 24h', subtitle: 'List free, reach thousands of buyers', image_url: 'https://picsum.photos/seed/banner2/1200/400', cta_label: 'Post a listing', cta_type: 'search', cta_value: 'vehicles', status: 'live', start_at: iso(60 * 24 * 2), end_at: null, sort_order: 1, created_at: iso(60 * 24 * 3) },
  { id: 'ban_3', slot: 'home_strip', title: 'New Year clearance', subtitle: 'Fashion & home from ₦1,000', image_url: 'https://picsum.photos/seed/banner3/1200/240', cta_label: 'Browse deals', cta_type: 'search', cta_value: 'clearance', status: 'scheduled', start_at: iso(-60 * 24 * 5), end_at: iso(-60 * 24 * 40), sort_order: 0, created_at: iso(30) },
  { id: 'ban_4', slot: 'home_hero', title: 'Black Friday (ended)', subtitle: 'Thanks for shopping', image_url: 'https://picsum.photos/seed/banner4/1200/400', cta_label: 'See more', cta_type: 'none', cta_value: '', status: 'archived', start_at: iso(60 * 24 * 60), end_at: iso(60 * 24 * 40), sort_order: 2, created_at: iso(60 * 24 * 65) },
];

const fixtureCategoryContent: Record<string, MktCategoryContent> = {
  cat_vehicles: { category_id: 'cat_vehicles', category_name: 'Vehicles', hero_heading: 'Find your next ride', intro_copy: 'Browse thousands of cars, buses, and bikes from verified sellers across Nigeria.', seo_title: 'Buy & Sell Cars in Nigeria | Paymax Marketplace', seo_description: 'Foreign-used and Nigerian-used cars, clean papers, best prices. Buy and sell vehicles safely on Paymax.', updated_at: iso(60 * 24 * 8), updated_by: 'adm_ada' },
  cat_phones: { category_id: 'cat_phones', category_name: 'Phones & Tablets', hero_heading: 'Latest phones, honest prices', intro_copy: 'iPhones, Samsung, Tecno and more — new and clean-used, with fair-price guidance.', seo_title: 'Phones & Tablets for Sale in Nigeria | Paymax', seo_description: 'Buy new and used phones and tablets at fair prices from trusted sellers on Paymax Marketplace.', updated_at: iso(60 * 24 * 30), updated_by: 'adm_tunde' },
};

export async function listBanners(status?: MktBannerStatus): Promise<MktBanner[]> {
  if (USE_FIXTURES) return delay(status ? FIXTURE_BANNERS.filter((b) => b.status === status) : [...FIXTURE_BANNERS]);
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await fetch(`${marketplaceAdminBase()}/banners${qs}`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Banners fetch failed'));
  const data = await res.json();
  return Array.isArray(data) ? data : data.data ?? [];
}

function validateBanner(input: MktBannerInput): void {
  if (!input.title.trim()) throw new Error('title is required.');
  if (!input.reason_code.trim()) throw new Error('reason_code is required (audited).');
  if (input.cta_type !== 'none' && !input.cta_value.trim()) throw new Error('a CTA target is required for this CTA type.');
  if (input.cta_type === 'external' && !/^https?:\/\//.test(input.cta_value.trim())) throw new Error('external CTA must be an http(s) URL.');
  if (input.start_at && input.end_at && new Date(input.end_at) <= new Date(input.start_at)) throw new Error('end must be after start.');
}

// deriveBannerStatus computes a display status from the schedule window (unless
// the banner is a draft/archived, which are explicit).
function deriveBannerStatus(startAt: string | null, endAt: string | null): MktBannerStatus {
  const t = Date.now();
  if (endAt && new Date(endAt).getTime() < t) return 'expired';
  if (startAt && new Date(startAt).getTime() > t) return 'scheduled';
  return 'live';
}

export async function createBanner(input: MktBannerInput): Promise<MktBanner> {
  validateBanner(input);
  if (USE_FIXTURES) {
    return delay({
      id: `ban_${Date.now()}`, slot: input.slot, title: input.title, subtitle: input.subtitle, image_url: input.image_url,
      cta_label: input.cta_label, cta_type: input.cta_type, cta_value: input.cta_value,
      status: deriveBannerStatus(input.start_at ?? null, input.end_at ?? null),
      start_at: input.start_at ?? null, end_at: input.end_at ?? null, sort_order: input.sort_order ?? 0,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
  }
  const res = await fetch(`${marketplaceAdminBase()}/banners`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(input) });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Banner create failed'));
  return res.json();
}

export async function updateBanner(id: string, input: MktBannerInput): Promise<MktBanner> {
  validateBanner(input);
  if (USE_FIXTURES) {
    const found = FIXTURE_BANNERS.find((b) => b.id === id);
    if (!found) throw new Error(`Banner ${id} not found`);
    return delay({
      ...found, ...input, id,
      start_at: input.start_at ?? null, end_at: input.end_at ?? null, sort_order: input.sort_order ?? found.sort_order,
      status: found.status === 'archived' ? 'archived' : deriveBannerStatus(input.start_at ?? null, input.end_at ?? null),
      updated_at: new Date().toISOString(),
    });
  }
  const res = await fetch(`${marketplaceAdminBase()}/banners/${encodeURIComponent(id)}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(input) });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Banner update failed'));
  return res.json();
}

// setBannerStatus: archive (retire) or restore a banner. reason_code mandatory.
export async function setBannerStatus(id: string, status: 'archived' | 'draft', reasonCode: string): Promise<MktBanner> {
  if (!reasonCode.trim()) throw new Error('reason_code is required to change a banner’s status.');
  if (USE_FIXTURES) {
    const found = FIXTURE_BANNERS.find((b) => b.id === id);
    if (!found) throw new Error(`Banner ${id} not found`);
    return delay({ ...found, status: status === 'draft' ? deriveBannerStatus(found.start_at, found.end_at) : 'archived', updated_at: new Date().toISOString() });
  }
  const res = await fetch(`${marketplaceAdminBase()}/banners/${encodeURIComponent(id)}/status`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ status, reason_code: reasonCode }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Banner status change failed'));
  return res.json();
}

export async function getCategoryContent(categoryId: string): Promise<MktCategoryContent> {
  if (USE_FIXTURES) {
    return delay(fixtureCategoryContent[categoryId] ?? { category_id: categoryId, category_name: categoryId, hero_heading: '', intro_copy: '', seo_title: '', seo_description: '', updated_at: null, updated_by: null });
  }
  const res = await fetch(`${marketplaceAdminBase()}/categories/${encodeURIComponent(categoryId)}/content`, { cache: 'no-store', headers: authHeaders() });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Category content fetch failed'));
  return res.json();
}

export async function upsertCategoryContent(categoryId: string, input: MktCategoryContentInput): Promise<MktCategoryContent> {
  if (!input.reason_code.trim()) throw new Error('reason_code is required (audited).');
  if (input.seo_description.length > 320) throw new Error('SEO description should be ≤ 320 characters.');
  if (USE_FIXTURES) {
    const prev = fixtureCategoryContent[categoryId];
    return delay({ category_id: categoryId, category_name: prev?.category_name ?? categoryId, hero_heading: input.hero_heading, intro_copy: input.intro_copy, seo_title: input.seo_title, seo_description: input.seo_description, updated_at: new Date().toISOString(), updated_by: 'adm_current' });
  }
  const res = await fetch(`${marketplaceAdminBase()}/categories/${encodeURIComponent(categoryId)}/content`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(input) });
  if (!res.ok) throw new Error(await parseErrorMessage(res, 'Category content update failed'));
  return res.json();
}

export type { MktDisputeDecision };
