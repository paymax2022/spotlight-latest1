// ── Admin — Paymax Black (premium tier, perks, partners, settlement) types ─────
// Field names mirror the Go JSON (snake_case) from /api/loyalty/admin/black*.
// Money is BIGINT kobo (minor units) throughout — display via formatNaira (kobo → ₦).
// Invariants surfaced in the UI:
//   NL-3  — Closed-loop value: perks redeem inside the ecosystem (early tickets,
//           lounge) via single-use credential; never an open-loop cash instrument.
//   NL-4  — Points/perks are not cash — never redeem to a cash withdrawal.
//   NL-12 — immutable audit on every perk/partner/config change & settlement run.

export type PerkKind = 'early_ticket' | 'lounge_access' | 'discount' | 'priority_support' | 'partner_offer' | 'free_delivery';
export type PerkStatus = 'active' | 'paused' | 'draft' | 'expired';
export type RedemptionStatus = 'issued' | 'redeemed' | 'expired' | 'revoked';
export type PartnerStatus = 'active' | 'pending' | 'suspended';
export type SettlementStatus = 'open' | 'investigating' | 'settled' | 'reconciled';

// ── A · Dashboard ─────────────────────────────────────────────────────────────
export interface BlackDashboardActivity {
  id: string;
  kind: string; // member_upgraded | perk_redeemed | partner_added | settlement_run | perk_revoked …
  label: string;
  ref?: string | null;
  created_at: string;
}
export interface BlackDashboard {
  members_total: number;
  members_active: number;
  members_new_30d: number;
  churn_30d: number;
  membership_revenue_30d_kobo: number;
  perk_redemptions_30d: number;
  perk_cost_30d_kobo: number;       // platform-borne perk cost / liability
  partner_offers_active: number;
  partners_active: number;
  partner_settlement_due_kobo: number;
  settlement_breaks_open: number;
  redemption_mix: { kind: PerkKind; count: number; cost_kobo: number }[];
  members_trend: { date: string; members: number; redemptions: number }[];
  activity: BlackDashboardActivity[];
}

// ── B · Perk config ───────────────────────────────────────────────────────────
export interface BlackPerk {
  id: string;
  name: string;
  kind: PerkKind;
  status: PerkStatus;
  description: string;
  partner_id: string | null;
  partner_name: string | null;
  value_kobo: number;             // perk face value / discount value
  monthly_cap_per_member: number; // single-use credential cap per cycle
  total_redeemed_30d: number;
  cost_30d_kobo: number;
  starts_at: string | null;
  ends_at: string | null;
  updated_by_masked: string;
  updated_at: string;
}
export interface BlackPerkUpsertResult {
  perk: BlackPerk;
  audit_id: string;
  message: string;
}

// ── C · Partner-offer management ──────────────────────────────────────────────
export interface BlackPartner {
  id: string;
  name: string;
  category: string;               // dining | retail | travel | events …
  status: PartnerStatus;
  contact_masked: string;
  offers_count: number;
  redemptions_30d: number;
  settlement_model: 'platform_funded' | 'partner_funded' | 'shared';
  partner_share_bps: number;      // partner-funded portion in basis points
  outstanding_settlement_kobo: number;
  onboarded_at: string;
  created_at: string;
}

// ── D · Partner settlement ────────────────────────────────────────────────────
export interface BlackSettlementLine {
  id: string;
  partner_id: string;
  partner_name: string;
  period: string;                 // e.g. 2026-06
  redemptions: number;
  gross_perk_value_kobo: number;
  platform_funded_kobo: number;
  partner_funded_kobo: number;
  net_due_to_partner_kobo: number;
  status: SettlementStatus;
  break_kobo: number;
  settled_at: string | null;
}
export interface BlackSettlement {
  generated_at: string;
  total_gross_kobo: number;
  total_platform_funded_kobo: number;
  total_partner_funded_kobo: number;
  total_net_due_kobo: number;
  total_break_kobo: number;
  breaks_open: number;
  lines: BlackSettlementLine[];
}
