// ── Admin — Paymax Stays (hotel booking) ops console types ───────────────────
// Field names mirror the Go JSON (snake_case) from /api/stays/admin/*.
// Money is BIGINT kobo (minor units) throughout. Supplier/source-rail and FX are
// always disclosed (PRD §5 dual-rail, §12 money/recon).

export type SourceRail = 'BEDBANK' | 'DIRECT';
export type SupplierCode = 'ratehawk' | 'zentrumhub' | 'direct';
export type Currency = 'NGN' | 'USD' | 'EUR' | 'GBP';

// ── Dashboard (§19 overview) ─────────────────────────────────────────────────
export interface StaysDashboardActivity {
  id: string;
  kind: string; // booking_confirmed | book_failed | refund_issued | reconciliation_break | mapping_conflict | payout_sent …
  label: string;
  ref?: string | null;
  created_at: string;
}
export interface SupplierMix {
  supplier: SupplierCode;
  rail: SourceRail;
  bookings: number;
  gmv_kobo: number;
  share_pct: number; // 0..1
}
export interface StaysDashboard {
  gmv_today_kobo: number;
  gmv_30d_kobo: number;
  bookings_today: number;
  bookings_30d: number;
  take_rate: number; // 0..1 — net revenue / GMV
  conversion: number; // 0..1 — search→book
  net_revenue_30d_kobo: number;
  commission_30d_kobo: number;
  reconciliation_breaks_open: number;
  reconciliation_break_value_kobo: number;
  refunds_pending: number;
  paid_unconfirmed: number; // the #1 invariant watch — paid-but-unconfirmed
  mapping_conflicts_open: number;
  moderation_pending: number;
  avg_booking_value_kobo: number;
  supplier_mix: SupplierMix[];
  gmv_trend: { date: string; gmv_kobo: number; net_kobo: number }[];
  activity: StaysDashboardActivity[];
}

// ── Suppliers / connectivity (Rail A adapters) ───────────────────────────────
export interface Supplier {
  supplier_code: SupplierCode;
  display_name: string;
  rail: SourceRail;
  status: 'healthy' | 'degraded' | 'down';
  base_url: string;
  api_key_masked: string;
  webhook_secret_masked: string;
  sandbox: boolean;
  uptime_pct: number;
  search_p95_ms: number;
  prebook_success_pct: number; // 0..1
  book_success_pct: number; // 0..1
  properties_live: number;
  open_breaks: number;
  currencies: Currency[];
  updated_at: string;
}

// ── Mapping / dedup queue (§5) ───────────────────────────────────────────────
export type MappingStatus = 'pending' | 'merged' | 'split' | 'ignored';
export interface MappingCandidate {
  supplier_code: SupplierCode;
  rail: SourceRail;
  supplier_property_ref: string;
  name: string;
  address: string;
  star_rating: number;
  lowest_total_kobo: number;
  currency: Currency;
}
export interface MappingRecord {
  id: string;
  city: string;
  confidence: number; // 0..1 match confidence
  status: MappingStatus;
  candidates: MappingCandidate[];
  conflict_reason: string;
  created_at: string;
}
export interface MappingResolution {
  id: string;
  status: MappingStatus;
  resolved_at: string;
}

// ── Property moderation / approval (direct hotels) ───────────────────────────
export type ModerationStatus = 'pending_review' | 'approved' | 'rejected' | 'needs_changes';
export interface ModerationItem {
  id: string;
  property_name: string;
  hotelier_masked: string;
  city: string;
  star_rating: number;
  rooms: number;
  status: ModerationStatus;
  photos_count: number;
  flags: string[];
  submitted_at: string;
}
export interface ModerationDecision {
  id: string;
  status: ModerationStatus;
  decided_at: string;
}

// ── Content / photo QA ───────────────────────────────────────────────────────
export type ContentQaStatus = 'pending' | 'passed' | 'failed';
export interface ContentQaItem {
  id: string;
  property_name: string;
  rail: SourceRail;
  supplier_code: SupplierCode;
  issue_type: string; // low_res_photo | missing_amenities | duplicate_image | watermark | description_thin
  severity: 'low' | 'medium' | 'high';
  status: ContentQaStatus;
  detail: string;
  flagged_at: string;
}

// ── Inventory coverage ───────────────────────────────────────────────────────
export interface CoverageRow {
  city: string;
  state: string;
  bedbank_properties: number;
  direct_properties: number;
  total_properties: number;
  demand_index: number; // 0..100 search demand
  gap_score: number; // 0..100 supply gap (high = under-supplied)
  bookings_30d: number;
}

// ── Reservations / support (§19 B) ───────────────────────────────────────────
export type ReservationState =
  | 'OFFER_SELECTED' | 'PREBOOK_OK' | 'PAYMENT_HELD' | 'BOOKING' | 'CONFIRMED'
  | 'COMPLETED' | 'CANCELLED_BY_GUEST' | 'CANCELLED_BY_HOTEL' | 'NO_SHOW'
  | 'BOOK_FAILED' | 'PAYMENT_FAILED' | 'VOID';
export interface ReservationSummary {
  id: string;
  supplier_ref: string;
  rail: SourceRail;
  supplier_code: SupplierCode;
  property_name: string;
  city: string;
  guest_masked: string;
  state: ReservationState;
  check_in: string;
  check_out: string;
  rooms: number;
  gross_amount_kobo: number;
  currency: Currency;
  created_at: string;
}
export interface ReservationTimelineEntry {
  at: string;
  state: string;
  actor: string;
  note?: string;
}
export interface ReservationLedgerRef {
  id: string;
  kind: 'HOLD' | 'CHARGE' | 'RELEASE' | 'REFUND' | 'COMMISSION' | 'PAYOUT';
  amount_kobo: number;
  ledger_ref: string;
  status: 'pending' | 'settled' | 'reversed';
  created_at: string;
}
export interface ReservationDetail extends ReservationSummary {
  room_type: string;
  rate_plan: string;
  board: string;
  occupancy: string;
  refundable: boolean;
  cancellation_policy: string;
  net_rate_kobo: number;
  markup_kobo: number;
  tax_amount_kobo: number;
  fx_rate?: number | null; // supplier-currency → NGN if cross-currency
  fx_supplier_currency?: Currency | null;
  payment_method: string;
  idempotency_key: string;
  book_token_ref: string;
  guest_email_masked: string;
  guest_phone_masked: string;
  consent_version: string;
  timeline: ReservationTimelineEntry[];
  ledger: ReservationLedgerRef[];
}

// ── Manual actions ───────────────────────────────────────────────────────────
export type ManualActionType = 'confirm' | 'force_cancel' | 'rebook' | 'release_hold';
export interface ManualActionResult {
  reservation_id: string;
  action: ManualActionType;
  new_state: ReservationState;
  ledger_ref?: string | null;
  performed_at: string;
}

// ── Refunds & disputes (§12 paid-but-unconfirmed fast-path) ──────────────────
export type RefundStatus = 'pending' | 'approved' | 'paid' | 'rejected';
export interface RefundRequest {
  id: string;
  reference: string;
  reservation_id: string;
  rail: SourceRail;
  supplier_code: SupplierCode;
  reason: string; // paid_unconfirmed | book_failed | guest_cancel | hotel_cancel | dispute | no_show_waiver
  fast_path: boolean; // paid-but-unconfirmed → auto-fast-path
  amount_kobo: number;
  currency: Currency;
  status: RefundStatus;
  guest_masked: string;
  requested_at: string;
}
export interface RefundDecision {
  id: string;
  status: RefundStatus;
  decided_at: string;
}

// ── No-show / overbooking ────────────────────────────────────────────────────
export type OverbookingStatus = 'open' | 'rebooked' | 'refunded' | 'resolved';
export interface OverbookingCase {
  id: string;
  reservation_id: string;
  property_name: string;
  rail: SourceRail;
  case_type: 'overbooking' | 'no_show';
  status: OverbookingStatus;
  guest_masked: string;
  check_in: string;
  amount_kobo: number;
  currency: Currency;
  detail: string;
  created_at: string;
}

// ── Reconciliation workbench (§12) ───────────────────────────────────────────
export type BreakStatus = 'open' | 'investigating' | 'resolved';
export interface ReconciliationBreak {
  id: string;
  supplier_code: SupplierCode;
  rail: SourceRail;
  break_type: 'net_rate' | 'commission' | 'refund' | 'payout' | 'missing_statement';
  reservation_id: string | null;
  paymax_amount_kobo: number;
  supplier_amount_kobo: number;
  delta_kobo: number;
  currency: Currency;
  status: BreakStatus;
  age_hours: number;
  sla_breached: boolean;
  detail: string;
  created_at: string;
}
export interface BreakResolution {
  id: string;
  status: BreakStatus;
  resolved_at: string;
}
export interface ReconciliationSummary {
  open_breaks: number;
  break_value_kobo: number;
  sla_breached: number;
  matched_30d: number;
  unmatched_statement_lines: number;
  breaks: ReconciliationBreak[];
}

// ── Hotel payouts (direct rail, Naira) ───────────────────────────────────────
export type PayoutStatus = 'scheduled' | 'pending' | 'paid' | 'failed' | 'held';
export interface HotelPayout {
  id: string;
  reference: string;
  hotelier_masked: string;
  property_name: string;
  bookings_count: number;
  gross_kobo: number;
  commission_kobo: number;
  net_payable_kobo: number; // always NGN to the hotel
  status: PayoutStatus;
  bank_masked: string;
  scheduled_for: string;
  paid_at: string | null;
}

// ── Markup / commission rules engine ─────────────────────────────────────────
export interface MarkupRule {
  id: string;
  scope: 'supplier' | 'destination' | 'tier' | 'season' | 'global';
  match: string; // e.g. "ratehawk" | "Lagos" | "tier_gold" | "Dec 15–Jan 5"
  markup_pct: number; // applied over net rate
  commission_pct: number; // direct-rail commission take
  rail: SourceRail | 'ALL';
  priority: number;
  enabled: boolean;
  updated_at: string;
}

// ── FX & currency config ─────────────────────────────────────────────────────
export interface FxRate {
  pair: string; // USD/NGN
  base: Currency;
  quote: Currency;
  mid_rate: number;
  buy_spread_pct: number;
  sell_spread_pct: number;
  applied_rate: number; // mid * (1 + sell_spread)
  source: string; // provider feed
  updated_at: string;
}
export interface FxConfig {
  base_currency: Currency;
  display_currency: Currency;
  auto_update: boolean;
  rate_ttl_minutes: number;
  rates: FxRate[];
}

// ── Commission ledger / revenue ──────────────────────────────────────────────
export interface CommissionEntry {
  id: string;
  reservation_id: string;
  rail: SourceRail;
  supplier_code: SupplierCode;
  source: 'markup' | 'direct_commission' | 'net_rate_margin';
  amount_kobo: number;
  basis: string;
  revenue_ledger_ref: string;
  reconciled: boolean;
  reversed: boolean;
  created_at: string;
}

// ── Loyalty config ───────────────────────────────────────────────────────────
export interface LoyaltyTier {
  tier: string;
  threshold_nights: number;
  earn_rate_pct: number; // points per ₦ spent
  perks: string[];
}
export interface LoyaltyConfig {
  enabled: boolean;
  program_name: string;
  point_value_kobo: number; // ₦ value of 1 point
  expiry_months: number;
  members: number;
  points_outstanding: number;
  liability_kobo: number;
  tiers: LoyaltyTier[];
}

// ── Promotions / campaigns ───────────────────────────────────────────────────
export type PromotionStatus = 'draft' | 'active' | 'scheduled' | 'expired' | 'paused';
export interface Promotion {
  id: string;
  code: string;
  name: string;
  type: 'percent_off' | 'amount_off' | 'free_night' | 'cashback';
  value: number;
  scope: string;
  status: PromotionStatus;
  redemptions: number;
  budget_kobo: number;
  spent_kobo: number;
  starts_at: string;
  ends_at: string;
}

// ── Reviews moderation ───────────────────────────────────────────────────────
export type ReviewStatus = 'pending' | 'published' | 'rejected' | 'flagged';
export interface Review {
  id: string;
  property_name: string;
  reservation_id: string;
  author_masked: string;
  rating: number; // 1..5
  title: string;
  body: string;
  status: ReviewStatus;
  flags: string[];
  has_response: boolean;
  created_at: string;
}
export interface ReviewModeration {
  id: string;
  status: ReviewStatus;
  decided_at: string;
}

// ── CMS (cities / landmarks / SEO) ───────────────────────────────────────────
export type CmsStatus = 'published' | 'draft';
export interface CmsEntry {
  id: string;
  type: 'city' | 'landmark' | 'guide' | 'seo_page';
  title: string;
  slug: string;
  status: CmsStatus;
  meta_description: string;
  properties_linked: number;
  updated_at: string;
}

// ── Merchandising / featured slots ───────────────────────────────────────────
export interface MerchandisingSlot {
  id: string;
  placement: string; // home_hero | city_top | deal_strip | app_banner
  property_name: string;
  rail: SourceRail;
  position: number;
  status: 'active' | 'scheduled' | 'ended';
  starts_at: string;
  ends_at: string;
  impressions: number;
  clicks: number;
}

// ── Fraud / risk console ─────────────────────────────────────────────────────
export type FraudStatus = 'open' | 'reviewing' | 'cleared' | 'blocked';
export interface FraudCase {
  id: string;
  reservation_id: string;
  rail: SourceRail;
  guest_masked: string;
  risk_score: number; // 0..100
  signals: string[];
  amount_kobo: number;
  currency: Currency;
  status: FraudStatus;
  detail: string;
  created_at: string;
}

// ── Hotelier reliability scoring ─────────────────────────────────────────────
export interface ReliabilityScore {
  hotelier_id: string;
  hotelier_masked: string;
  property_name: string;
  score: number; // 0..100
  grade: 'A' | 'B' | 'C' | 'D';
  confirm_rate: number; // 0..1
  cancel_rate: number; // 0..1
  overbook_incidents: number;
  avg_response_minutes: number;
  reviews_avg: number;
  bookings_90d: number;
}

// ── Agent management & commissions ───────────────────────────────────────────
export interface Agent {
  id: string;
  name_masked: string;
  agent_code: string;
  status: 'active' | 'suspended' | 'pending';
  bookings_30d: number;
  gmv_30d_kobo: number;
  commission_rate_pct: number;
  commission_earned_kobo: number;
  commission_unpaid_kobo: number;
  tier: string;
}

// ── Hotelier KYC / verification ──────────────────────────────────────────────
export type KycStatus = 'pending' | 'approved' | 'rejected' | 'needs_info';
export interface KycCase {
  id: string;
  hotelier_masked: string;
  business_name: string;
  city: string;
  doc_types: string[];
  cac_number_masked: string;
  bank_verified: boolean;
  status: KycStatus;
  risk_flags: string[];
  submitted_at: string;
}
export interface KycDecision {
  id: string;
  status: KycStatus;
  decided_at: string;
}

// ── Platform — RBAC / audit / config / templates ─────────────────────────────
export interface AdminUserRole {
  id: string;
  user_masked: string;
  email_masked: string;
  roles: string[];
  permissions: string[];
  last_active: string;
  status: 'active' | 'disabled';
}
export interface AuditEntry {
  id: string;
  actor_masked: string;
  action: string;
  entity: string;
  entity_id: string;
  rail?: SourceRail | null;
  ip_masked: string;
  created_at: string;
}
export interface AuditLog {
  exports: { id: string; name: string; range: string; format: string; generated_at: string | null }[];
  entries: AuditEntry[];
}
export interface FeatureFlag {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  scope: 'global' | 'rail' | 'city';
  updated_at: string;
}
export interface PlatformConfig {
  flags: FeatureFlag[];
  settings: { key: string; label: string; value: string; type: 'bool' | 'number' | 'string' }[];
}
export interface NotificationTemplate {
  id: string;
  key: string;
  name: string;
  channel: 'email' | 'sms' | 'push' | 'whatsapp';
  trigger: string; // booking_confirmed | book_failed | refund_issued | payout_sent …
  enabled: boolean;
  locale: string;
  updated_at: string;
}
