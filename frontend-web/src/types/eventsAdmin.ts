// ── Admin — Paymax Events (Ticketing + Cashless event wallet) ops console types ─
// Field names mirror the Go JSON (snake_case) from /api/events/admin/*.
// Money is BIGINT kobo (minor units) throughout — display via formatNaira (kobo → ₦).
// Invariants surfaced in the UI:
//   NL-3  — closed-loop value: event wallet (cashless) spendable only inside the
//           ecosystem; residual MUST be refunded to the funding wallet at close.
//   NL-10 — KYC gates & AML: vendor/organiser payouts require the right KYC tier;
//           payout is gated fail-closed until KYC clears.
//   NL-12 — immutable audit on every state change (approval, payout, settlement,
//           refund, fraud action).

// ── Event state machine: DRAFT → SUBMITTED → APPROVED → LIVE → CLOSED | SUSPENDED
export type EventStatus = 'draft' | 'submitted' | 'approved' | 'live' | 'closed' | 'suspended';
export type EventApprovalDecision = 'approve' | 'reject' | 'request_changes' | 'suspend';
export type TicketTierStatus = 'on_sale' | 'sold_out' | 'paused' | 'scheduled' | 'ended';
export type EventWalletStatus = 'open' | 'spending' | 'closed';
export type VendorKycTier = 'tier0' | 'tier1' | 'tier2' | 'tier3';
export type VendorPayoutStatus = 'pending' | 'kyc_hold' | 'approved' | 'paid' | 'rejected';
export type SettlementBreakStatus = 'open' | 'investigating' | 'resolved' | 'reconciled';
export type FraudStatus = 'open' | 'investigating' | 'cleared' | 'blocked';

// ════════════════════════════════════════════════════════════════════════════
// A · Dashboard
// ════════════════════════════════════════════════════════════════════════════
export interface EventsDashboardActivity {
  id: string;
  kind: string; // event_approved | ticket_sale | cashless_topup | vendor_payout | settlement_break | residual_refund | fraud_flag …
  label: string;
  ref?: string | null;
  created_at: string;
}
export interface EventsDashboard {
  // GMV / sales
  gmv_today_kobo: number;
  gmv_30d_kobo: number;
  tickets_sold_today: number;
  tickets_sold_30d: number;
  take_rate: number;           // platform net ÷ GMV
  net_revenue_30d_kobo: number;
  avg_ticket_price_kobo: number;
  // cashless (closed-loop — NL-3)
  cashless_float_kobo: number;       // total customer money loaded on event wallets
  cashless_liability_kobo: number;   // unspent balance owed back to customers
  residual_refund_pending_kobo: number; // residual not yet refunded at event close
  vendor_float_kobo: number;         // vendor collected balances awaiting settlement
  // ops
  events_live: number;
  events_pending_approval: number;
  vendors_active: number;
  vendor_payouts_kyc_hold: number;   // NL-10 — payouts blocked on KYC
  settlement_breaks_open: number;
  settlement_break_value_kobo: number;
  fraud_open: number;
  // mix + trend
  ticket_mix: { tier: string; sold: number; gmv_kobo: number; share_pct: number }[];
  gmv_trend: { date: string; gmv_kobo: number; net_kobo: number }[];
  activity: EventsDashboardActivity[];
}

// ════════════════════════════════════════════════════════════════════════════
// B · Event approval / CMS queue
// ════════════════════════════════════════════════════════════════════════════
export interface EventApprovalItem {
  id: string;
  title: string;
  organiser_masked: string;
  category: string;
  city: string;
  status: EventStatus;
  starts_at: string;
  capacity: number;
  tiers_count: number;
  cashless_enabled: boolean;
  submitted_at: string | null;
  cms_complete: boolean;        // banner, description, venue map present
  flagged_terms: boolean;       // content/policy flags from screening
  created_at: string;
}
export interface EventDecisionResult {
  id: string;
  status: EventStatus;
  audit_id: string;     // immutable audit entry id (NL-12)
  message: string;
}

// ════════════════════════════════════════════════════════════════════════════
// C · Event catalog + detail
// ════════════════════════════════════════════════════════════════════════════
export interface EventSummary {
  id: string;
  title: string;
  organiser_masked: string;
  category: string;
  city: string;
  status: EventStatus;
  starts_at: string;
  capacity: number;
  tickets_sold: number;
  gmv_kobo: number;
  cashless_enabled: boolean;
  created_at: string;
}
export interface EventTimelineEntry {
  id: string;
  status: EventStatus | string;
  label: string;
  actor_masked: string | null;
  audit_id: string | null;
  at: string;
}
export interface EventDetail extends EventSummary {
  description: string;
  venue: string;
  capacity_sold_pct: number;
  net_revenue_kobo: number;
  cashless_float_kobo: number;
  cashless_liability_kobo: number;
  tiers: TicketTier[];
  timeline: EventTimelineEntry[];
}

// ════════════════════════════════════════════════════════════════════════════
// D · Ticket inventory / tiers / promo
// ════════════════════════════════════════════════════════════════════════════
export interface TicketTier {
  id: string;
  event_id: string;
  event_title: string;
  name: string;
  price_kobo: number;
  quantity: number;
  sold: number;
  held: number;             // in-cart / reserved
  status: TicketTierStatus;
  config_version: number;   // versioned config (PRD §1)
  promo_codes: PromoCode[];
}
export interface PromoCode {
  code: string;
  discount_pct: number;
  max_redemptions: number;
  redeemed: number;
  active: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// E · Cashless — closed-loop float & liability + residual refunds (NL-3)
// ════════════════════════════════════════════════════════════════════════════
export interface CashlessEventLine {
  event_id: string;
  event_title: string;
  wallet_status: EventWalletStatus;
  loaded_kobo: number;          // total topped up
  spent_kobo: number;           // spent at vendors
  liability_kobo: number;       // unspent balance owed to customers (loaded − spent)
  residual_refunded_kobo: number;   // residual already pushed back at close
  residual_pending_kobo: number;    // residual awaiting refund (NL-3 watch)
  closed_at: string | null;
}
export interface CashlessFloat {
  generated_at: string;
  total_loaded_kobo: number;
  total_spent_kobo: number;
  total_liability_kobo: number;     // closed-loop outstanding
  total_residual_pending_kobo: number;
  ledger_balance_kobo: number;      // ledger projection of the float (NL-8)
  custody_balance_kobo: number;     // bank/VA custody backing the float
  delta_kobo: number;               // custody − ledger (0 == balanced)
  lines: CashlessEventLine[];
}

// ════════════════════════════════════════════════════════════════════════════
// F · Vendors + KYC payout gate (NL-10)
// ════════════════════════════════════════════════════════════════════════════
export interface VendorRecord {
  id: string;
  name_masked: string;
  event_id: string;
  event_title: string;
  kyc_tier: VendorKycTier;
  kyc_verified: boolean;
  collected_kobo: number;        // total tap-charges collected (vendor float)
  fees_kobo: number;             // platform fees net of settlement
  net_payable_kobo: number;      // collected − fees, owed to vendor
  payout_status: VendorPayoutStatus;
  active: boolean;
  created_at: string;
}
export interface VendorPayoutResult {
  id: string;
  payout_status: VendorPayoutStatus;
  audit_id: string;     // immutable audit entry id (NL-12)
  message: string;
}

// ════════════════════════════════════════════════════════════════════════════
// G · Settlement + reconciliation
// ════════════════════════════════════════════════════════════════════════════
export interface SettlementLine {
  id: string;
  event_id: string;
  event_title: string;
  gross_kobo: number;        // total ticket + cashless gross
  fees_kobo: number;         // platform fees
  vendor_payouts_kobo: number;
  organiser_net_kobo: number;
  residual_refunds_kobo: number;
  status: SettlementBreakStatus | 'settled';
  break_kobo: number;        // unreconciled delta (0 == clean)
  settled_at: string | null;
}
export interface Settlement {
  generated_at: string;
  total_gross_kobo: number;
  total_fees_kobo: number;
  total_organiser_net_kobo: number;
  total_vendor_payouts_kobo: number;
  total_break_kobo: number;
  breaks_open: number;
  lines: SettlementLine[];
}
export interface SettlementResolveResult {
  id: string;
  status: SettlementBreakStatus;
  audit_id: string;
  message: string;
}

// ════════════════════════════════════════════════════════════════════════════
// H · Fraud — dup-scan / abnormal top-up
// ════════════════════════════════════════════════════════════════════════════
export interface EventFraudSignal {
  id: string;
  event_id: string;
  event_title: string;
  kind: 'dup_scan' | 'abnormal_topup' | 'rapid_refund' | 'vendor_self_charge';
  subject_masked: string;
  detail: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  amount_kobo: number;
  status: FraudStatus;
  created_at: string;
}
export type EventFraudAction = 'investigate' | 'clear' | 'block';
export interface EventFraudActionResult {
  id: string;
  status: FraudStatus;
  audit_id: string;
  message: string;
}
