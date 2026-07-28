// Paymax Marketplace admin console — domain types.
// snake_case mirrors the Go backend / contracts/openapi.yaml (Marketplace* schemas,
// tag MarketplaceAdmin). Admin routes are mounted at Gin engine root /v1/marketplace/admin
// (NOT under /api — marketplace_routes.go groups directly off *gin.Engine, per
// docs/prd/marketplace/SWARM_INTEGRATION_CONTRACT.md "Base API path: /v1/marketplace").
// Backend RBAC (guard("marketplace.admin.<perm>")) is authoritative — the UI's
// permission gates here are UX-only.
//
// Money: every *_kobo field is an integer (kobo). NEVER do math on these in
// floats — format-only via formatKobo() in the service layer.

export type MktListingStatus =
  | 'draft'
  | 'pending_review'
  | 'active'
  | 'paused'
  | 'expired'
  | 'sold'
  | 'removed_policy'
  | 'removed_user';

export type MktOrderStatus =
  | 'initiated'
  | 'funded'
  | 'seller_accepted'
  | 'in_delivery'
  | 'delivered'
  | 'inspection_window'
  | 'released'
  | 'cancelled'
  | 'disputed'
  | 'refunded'
  | 'split_settled';

export type MktDisputeStatus =
  | 'opened'
  | 'evidence_window'
  | 'under_review'
  | 'decided'
  | 'executed'
  | 'closed'
  | 'appealed';

export type MktBoostStatus =
  | 'purchased'
  | 'active'
  | 'completed'
  | 'rejected_with_reason'
  | 'auto_refunded';

export interface MktMedia {
  id: string;
  url_thumb: string;
  url_card: string;
  url_full: string;
  blurhash?: string;
  sort_order?: number;
}

export interface MktSellerSummary {
  id: string;
  trust_score: number;
  verified_id_badge: boolean;
  verified_business_badge: boolean;
  tenure_label: string;
  response_time_minutes: number | null;
}

export interface MktFairPriceBand {
  p25_kobo: number;
  p50_kobo: number;
  p75_kobo: number;
}

// GET /admin/moderation/queue item + GET listing detail — the queue page needs
// enough context (media, price-band) to review without navigating away, but the
// detail page fetches the fuller MktListingDetail-shaped record.
export interface MktListing {
  id: string;
  market_id: string;
  seller_id: string;
  category_id: string;
  category_name?: string;
  title: string;
  description: string;
  price_kobo: number;
  currency?: string;
  condition: 'new' | 'used' | 'foreign_used' | 'local_used' | 'refurbished';
  attrs?: Record<string, unknown>;
  status: MktListingStatus;
  quality_score?: number;
  escrow_eligible: boolean;
  state?: string;
  lga?: string | null;
  view_count?: number;
  save_count?: number;
  moderation_reason_code?: string | null;
  created_at: string;
  updated_at: string;
  expires_at?: string;
  // detail-only, present when returned by the moderation queue/detail endpoint
  seller?: MktSellerSummary;
  media?: MktMedia[];
  fair_price_band?: MktFairPriceBand | null;
}

export interface MktAdminReasonCodeRequest {
  reason_code?: string;
}

export interface MktOrder {
  id: string;
  market_id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  offer_id?: string | null;
  amount_kobo: number;
  escrow_fee_kobo: number;
  delivery_fee_kobo: number;
  status: MktOrderStatus;
  ledger_fund_ref?: string | null;
  ledger_release_ref?: string | null;
  delivery_ref?: string | null;
  inspection_deadline?: string | null;
  created_at: string;
  updated_at: string;
  funded_at?: string | null;
  delivered_at?: string | null;
  released_at?: string | null;
  cancelled_at?: string | null;
  // orders-aging convenience fields (server may include for the dashboard)
  listing_title?: string;
  age_hours?: number;
}

export type MktDisputeReasonCode =
  | 'item_not_as_described'
  | 'item_not_received'
  | 'item_damaged'
  | 'counterfeit'
  | 'other';

export type MktDisputeDecision = 'refund_buyer' | 'release_seller' | 'split';

export interface MktEvidenceItem {
  type: 'photo' | 'chat_excerpt' | 'document';
  url_or_text: string;
  submitted_by?: string;
  created_at?: string;
}

// GET /admin/disputes/:id — side-by-side evidence view. Server may enrich the
// base MktDispute schema with order + party context for the workbench.
export interface MktDispute {
  id: string;
  order_id: string;
  opened_by: string;
  reason_code: string;
  status: MktDisputeStatus;
  decision: MktDisputeDecision | null;
  decision_notes?: string | null;
  decided_by?: string | null;
  requires_dual_approval: boolean;
  second_approver_id?: string | null;
  evidence_deadline: string;
  created_at: string;
  decided_at?: string | null;
  executed_at?: string | null;
  // enrichment for the workbench (order + evidence context)
  order?: MktOrder;
  buyer_evidence?: MktEvidenceItem[];
  seller_evidence?: MktEvidenceItem[];
  evidence?: MktEvidenceItem[];
  listing_title?: string;
}

export interface MktDisputeDecideRequest {
  decision: MktDisputeDecision;
  reason_code: string;
  notes?: string;
}

export type MktFlagTargetType = 'listing' | 'user' | 'review' | 'chat_message';
export type MktFlagStatus = 'open' | 'actioned' | 'dismissed';

export interface MktFlag {
  id: string;
  target_type: MktFlagTargetType;
  target_id: string;
  reporter_id: string;
  reason_code: string;
  notes?: string | null;
  status: MktFlagStatus;
  reviewed_by?: string | null;
  created_at: string;
  reviewed_at?: string | null;
}

export interface MktFlagActionRequest {
  action: 'actioned' | 'dismissed';
  reason_code: string;
}

export interface MktAdminAuditLogEntry {
  id: number;
  admin_id: string;
  admin_role?: string;
  action: string;
  target_type: string;
  target_id: string;
  reason_code: string;
  before_state?: Record<string, unknown> | null;
  after_state?: Record<string, unknown> | null;
  created_at: string;
}

export type MktBoostTierName = 'start' | 'vip' | 'vip_gold' | 'diamond' | 'enterprise';

export interface MktBoost {
  id: string;
  listing_id: string;
  seller_id: string;
  tier: MktBoostTierName;
  duration_days: number;
  price_kobo: number;
  ledger_charge_ref?: string;
  status: MktBoostStatus;
  rejection_reason_code?: string | null;
  refund_ref?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  listing_title?: string;
}

export interface MktPageResult<T> {
  data: T[];
  next_cursor: string | null;
}

// Marketplace uniform error shape (SWARM_INTEGRATION_CONTRACT.md — distinct from
// the legacy { success, error } shape used elsewhere in this admin console).
export interface MarketplaceErrorBody {
  error: {
    code: string;
    message: string;
    field?: string | null;
    request_id?: string | null;
  };
}

// ── Taxonomy (categories + attribute schema) ─────────────────────────────────
// A category's attribute_schema is the draft-07 SUBSET the backend enforces at
// listing write-time (internal/marketplace/attrs_validation.go): required[],
// per-property type/enum/minimum/maximum, additionalProperties. Authoring it here
// is the source that seller listings are validated against.

export type MktAttributeType = 'string' | 'number' | 'integer' | 'boolean';

export interface MktAttributeProp {
  type?: MktAttributeType;
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
}

export interface MktAttributeSchema {
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<string, MktAttributeProp>;
}

export interface MktCategory {
  id: string;
  market_id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  attribute_schema: MktAttributeSchema;
  risk_tier: number; // 0..3; 0 = auto-approve eligible for trusted sellers
  commission_bps: number; // platform take-rate in basis points
  is_active: boolean;
  listing_count?: number; // active listings under this category (EC-007 delete guard)
  created_at?: string;
  updated_at?: string;
}

export interface MktCategoryInput {
  name: string;
  slug: string;
  parent_id?: string | null;
  risk_tier: number;
  commission_bps: number;
  is_active: boolean;
  attribute_schema: MktAttributeSchema;
  reason_code?: string; // audited config change (ADM-001)
}

// ── Analytics (GMV / DAU / conversion) — ADM-005 ─────────────────────────────

export interface MktAnalyticsPoint {
  date: string; // ISO date (day granularity)
  gmv_kobo: number; // transaction value facilitated that day
  deals: number; // deals closed (chat → agreed) that day
}

export interface MktCategoryStat {
  category_id: string;
  name: string;
  gmv_kobo: number;
  active_listings: number;
}

// ── Appeals (moderation reversal, maker-checker) — MOD-009 ───────────────────

export type MktAppealStatus = 'opened' | 'under_review' | 'decided' | 'executed' | 'closed';
export type MktAppealTargetType = 'listing' | 'boost' | 'user';
export type MktAppealDecision = 'upheld' | 'overturned'; // uphold = deny appeal; overturn = reverse the original action

export interface MktAppeal {
  id: string;
  target_type: MktAppealTargetType;
  target_id: string;
  appellant_id: string;
  original_action: string; // e.g. 'removed_policy', 'rejected_with_reason', 'suspended'
  original_reason_code: string;
  appellant_note: string;
  status: MktAppealStatus;
  decision?: MktAppealDecision | null;
  decision_notes?: string | null;
  decided_by?: string | null;
  second_approver_id?: string | null;
  requires_dual_approval?: boolean; // overturning a policy action needs a second approver
  created_at: string;
  decided_at?: string | null;
  executed_at?: string | null;
}

export interface MktAppealDecideRequest {
  decision: 'uphold' | 'overturn';
  reason_code: string;
  notes?: string;
}

export interface MktAnalytics {
  range_days: number;
  gmv_kobo: number; // value facilitated over the window
  gmv_prev_kobo: number; // same-length preceding window (for delta)
  revenue_kobo: number; // platform take: commission + boost ad revenue
  dau: number; // daily active users (avg over window)
  active_listings: number;
  new_listings: number;
  // Discovery → contact → deal funnel counts over the window.
  funnel: { views: number; contacts: number; deals: number };
  gmv_series: MktAnalyticsPoint[];
  top_categories: MktCategoryStat[];
}

// ── Users, Trust & Safety, Fraud — TS-12 (USR-001…008) ───────────────────────

export type MktUserStatus = 'active' | 'suspended' | 'banned';
export type MktKycTier = 'tier0_browse' | 'tier1_buy' | 'tier2_sell' | 'tier3_business';
export type MktUserAction = 'suspend' | 'ban' | 'reinstate';

// PII is masked at the API layer (USR-001). The admin sees enough to act, not
// enough to leak: email/phone are partially redacted server-side.
export interface MktUserAdmin {
  id: string;
  display_name: string;
  email_masked: string; // e.g. "t***@gmail.com"
  phone_masked: string; // e.g. "+234 80****1234"
  status: MktUserStatus;
  kyc_tier: MktKycTier;
  kyc_pending: boolean; // a KYC upgrade is awaiting review (USR-003)
  trust_score: number; // 0..1
  verified_id_badge: boolean;
  verified_business_badge: boolean;
  active_listings: number;
  completed_deals: number;
  open_flags: number;
  fraud_score: number; // 0..1 aggregate risk (USR-004)
  suspension_reason_code?: string | null;
  // dual-approval fields (a BAN is maker-checker, USR-007)
  pending_action?: MktUserAction | null;
  pending_action_by?: string | null;
  requires_dual_approval?: boolean;
  created_at: string;
  last_active_at?: string | null;
}

export interface MktUserActionRequest {
  action: MktUserAction;
  reason_code: string;
}

export interface MktKycReviewRequest {
  decision: 'approve' | 'reject';
  reason_code: string;
  // the tier being granted on approve (server validates the requested tier)
  grant_tier?: MktKycTier;
}

export type MktBlacklistType = 'device' | 'phone' | 'ip' | 'email';
export interface MktBlacklistRequest {
  type: MktBlacklistType;
  value: string;
  reason_code: string;
}

// A fraud/scam signal surfaced for triage (USR-004). Not an action — a lead.
export type MktFraudSignalKind =
  | 'velocity' // too many listings/messages in a short window
  | 'duplicate_device' // one device across many accounts
  | 'shared_ip' // account ring on one IP
  | 'payment_evasion' // repeated off-platform-payment language
  | 'multiple_flags' // many buyer flags in a window
  | 'blacklist_hit'; // matched a blacklisted identifier

export interface MktFraudSignal {
  id: string;
  kind: MktFraudSignalKind;
  user_id: string;
  user_display_name: string;
  severity: 'low' | 'medium' | 'high';
  detail: string;
  related_user_ids: string[]; // the ring, for duplicate_device/shared_ip (USR-006)
  created_at: string;
}
