// ── Admin — Paymax Loyalty (Points, Tiers, Catalog) ops console types ─────────
// Field names mirror the Go JSON (snake_case) from /api/loyalty/admin/*.
// Points are an append-only ledger — NON-CASH. They are NOT money in kobo; they
// are integer point balances. Any cash figure (catalog cost, liability valuation)
// is BIGINT kobo and rendered via formatNaira (kobo → ₦).
// Invariants surfaced in the UI:
//   NL-4  — points are NOT cash: redeem only to airtime / bill credit / discount /
//           perk; never to bank cash-out. Liability is a *valuation*, not cash owed.
//   NL-8  — points are a ledger; balances are projections of append-only entries.
//   NL-12 — immutable audit on every config change (earn-rule, tier, catalog).

export type EarnRuleStatus = 'active' | 'draft' | 'disabled';
export type LoyaltyModule = 'payments' | 'savings' | 'tickets' | 'cashless' | 'referral' | 'social';
export type RedemptionKind = 'airtime' | 'bill_credit' | 'ticket_discount' | 'perk';
export type RedemptionStatus = 'completed' | 'pending' | 'reversed' | 'flagged' | 'failed';
export type CatalogStatus = 'active' | 'draft' | 'disabled';

// ════════════════════════════════════════════════════════════════════════════
// A · Dashboard — points liability + tier distribution
// ════════════════════════════════════════════════════════════════════════════
export interface LoyaltyDashboardActivity {
  id: string;
  kind: string; // earn_rule_updated | tier_changed | catalog_published | redemption | liability_alert | fraud_flag …
  label: string;
  ref?: string | null;
  created_at: string;
}
export interface LoyaltyDashboard {
  // points liability (NON-CASH valuation — NL-4)
  points_outstanding: number;             // total unredeemed points across all members
  points_liability_kobo: number;          // valuation of outstanding points (₦), NOT cash owed
  points_redemption_value_kobo: number;   // per-point redemption value basis used for valuation
  points_earned_30d: number;
  points_redeemed_30d: number;
  points_expiring_30d: number;            // points set to expire in the next 30d
  breakage_rate: number;                  // expected unredeemed (expiry) share
  // members / tiers
  members_total: number;
  tier_distribution: { tier: string; members: number; share_pct: number }[];
  // ops
  earn_rules_active: number;
  catalog_items_active: number;
  redemptions_today: number;
  redemption_fraud_open: number;
  // trend
  points_trend: { date: string; earned: number; redeemed: number }[];
  activity: LoyaltyDashboardActivity[];
}

// ════════════════════════════════════════════════════════════════════════════
// B · Earn rules — by action/module, versioned
// ════════════════════════════════════════════════════════════════════════════
export interface EarnRule {
  id: string;
  module: LoyaltyModule;
  action: string;             // e.g. 'ticket_purchase', 'auto_save', 'referral_signup'
  points_per_naira: number;   // points earned per ₦ spent/saved (0 for flat)
  flat_points: number;        // flat bonus on the action (0 if pts-per-₦)
  cap_points_per_day: number; // anti-abuse cap (0 = uncapped)
  status: EarnRuleStatus;
  config_version: number;     // versioned config (NL-12)
  updated_at: string;
}
export interface EarnRuleUpdate {
  points_per_naira?: number;
  flat_points?: number;
  cap_points_per_day?: number;
  status?: EarnRuleStatus;
}
export interface EarnRuleResult {
  id: string;
  config_version: number;
  audit_id: string;     // immutable audit entry id (NL-12)
  message: string;
}

// ════════════════════════════════════════════════════════════════════════════
// C · Tiers — thresholds + benefits, config
// ════════════════════════════════════════════════════════════════════════════
export interface TierConfig {
  id: string;
  name: string;               // Tier 1 / Tier 2 / Tier 3 (Black added Phase 3)
  rank: number;
  threshold_points: number;   // lifetime points to reach this tier
  members: number;
  benefits: string[];
  earn_multiplier: number;    // bonus multiplier on earns at this tier
  status: 'active' | 'draft';
  config_version: number;
  updated_at: string;
}
export interface TierUpdate {
  threshold_points?: number;
  earn_multiplier?: number;
  benefits?: string[];
  status?: 'active' | 'draft';
}
export interface TierResult {
  id: string;
  config_version: number;
  audit_id: string;
  message: string;
}

// ════════════════════════════════════════════════════════════════════════════
// D · Rewards catalog — CRUD
// ════════════════════════════════════════════════════════════════════════════
export interface CatalogItem {
  id: string;
  name: string;
  kind: RedemptionKind;
  cost_points: number;        // points to redeem
  cash_value_kobo: number;    // ₦ value delivered (airtime/bill/discount) — NL-4
  stock: number;              // -1 = unlimited
  redeemed: number;
  status: CatalogStatus;
  updated_at: string;
}
export interface CatalogUpsert {
  id?: string;
  name: string;
  kind: RedemptionKind;
  cost_points: number;
  cash_value_kobo: number;
  stock: number;
  status: CatalogStatus;
}
export interface CatalogResult {
  id: string;
  audit_id: string;
  message: string;
}

// ════════════════════════════════════════════════════════════════════════════
// E · Redemptions log + fraud
// ════════════════════════════════════════════════════════════════════════════
export interface RedemptionRecord {
  id: string;
  member_masked: string;
  item_name: string;
  kind: RedemptionKind;
  cost_points: number;
  cash_value_kobo: number;
  status: RedemptionStatus;
  fraud_flag: boolean;        // anomaly: velocity / self-deal / reversal abuse
  fraud_reason: string | null;
  created_at: string;
}

// ════════════════════════════════════════════════════════════════════════════
// F · Liability + expiry dashboard (NL-4)
// ════════════════════════════════════════════════════════════════════════════
export interface PointsLiabilityBucket {
  bucket: string;             // e.g. '0-30d', '31-90d', '91-180d', '180d+'
  points: number;
  valuation_kobo: number;
  expiring: boolean;
}
export interface PointsLiability {
  generated_at: string;
  points_outstanding: number;
  total_valuation_kobo: number;       // NON-CASH valuation (NL-4)
  redemption_value_kobo: number;      // per-point basis
  breakage_rate: number;
  ledger_points: number;              // append-only ledger projection (NL-8)
  projected_points: number;           // running balance projection
  delta_points: number;               // ledger vs projection (0 == balanced)
  buckets: PointsLiabilityBucket[];
}
