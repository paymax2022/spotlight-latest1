// ── Loyalty domain types ─────────────────────────────────────────────────────
// IMPORTANT (NL-4): points are NON-CASH. They are a promotional balance, never
// money. Never apply kobo/naira math to a points value. Redeemable reward COST
// is in points; reward VALUE (airtime/bill credit) is in kobo for display only.

export type TierId = 'TIER1' | 'TIER2' | 'TIER3';

export interface Tier {
  id:        TierId;
  name:      string;
  minPoints: number;
  color:     string;
  perks:     string[];
}

export interface LoyaltyAccount {
  /** Lifetime points earned (drives tier). */
  lifetimePoints: number;
  /** Currently spendable points balance (NON-CASH). */
  balancePoints:  number;
  tierId:         TierId;
  /** Points still needed to reach the next tier; 0 if at top tier. */
  pointsToNext:   number;
  nextTierId:     TierId | null;
}

// Points ledger — earns from multiple modules + redemptions.
export type EarnSource =
  | 'wallet'        // transfers / payments
  | 'bills'         // bill payments
  | 'events'        // ticket purchases
  | 'savings'       // savings contributions
  | 'referral'      // referral bonus
  | 'signup'        // welcome bonus
  | 'redeem';       // negative — a redemption

export interface PointsEntry {
  id:        string;
  /** Positive = earned, negative = redeemed. NON-CASH. */
  points:    number;
  source:    EarnSource;
  label:     string;
  atISO:     string;
}

// Rewards catalog — redeem to airtime / bill credit / discount / perk (NL-4).
export type RewardKind = 'airtime' | 'bill' | 'discount' | 'perk';

export interface CatalogItem {
  id:          string;
  title:       string;
  description: string;
  kind:        RewardKind;
  costPoints:  number;
  /** Cash-equivalent VALUE in kobo (for display of what you get; NOT cash-out). */
  valueKobo:   number | null;
  emoji:       string;
  /** Minimum tier required to redeem, if any. */
  minTierId?:  TierId | null;
}

export interface RedeemResult {
  ok:               boolean;
  newBalancePoints: number;
  reference:        string;
}

export interface RedeemInput {
  itemId: string;
}
