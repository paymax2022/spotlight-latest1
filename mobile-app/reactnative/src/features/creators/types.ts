// ── Creators monetisation domain types ───────────────────────────────────────
// Money is always integer minor units (kobo). Creator income = content/perks,
// never a financial return (NL-5).

export interface Creator {
  id:           string;
  handle:       string;          // includes leading @
  displayName:  string;
  bio:          string;
  avatarColor:  string;
  category:     string;          // e.g. Music, Comedy, Education
  verified:     boolean;
  subscriberCount: number;
  /** Lowest subscription tier price (kobo) for "from ₦X/mo" labels. */
  fromPriceKobo: number | null;
  acceptsTips:  boolean;
}

// ── Storefront (creator's public page) ───────────────────────────────────────
export interface Storefront {
  creator:      Creator;
  tiers:        SubTier[];
  content:      GatedContent[];
  /** Is the viewer currently subscribed (any active tier)? */
  isSubscribed: boolean;
}

// ── Subscription tiers ───────────────────────────────────────────────────────
export interface SubTier {
  id:           string;
  creatorId:    string;
  name:         string;          // e.g. Fan, Super Fan, VIP
  priceKobo:    number;          // monthly price (kobo)
  perks:        string[];
  popular?:     boolean;
}

// `Subscription: ACTIVE → PAST_DUE → CANCELLED`
export type SubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';

export interface Subscription {
  id:            string;
  creatorId:     string;
  creatorName:   string;
  creatorHandle: string;
  avatarColor:   string;
  tierId:        string;
  tierName:      string;
  priceKobo:     number;
  status:        SubscriptionStatus;
  renewsAtISO:   string | null;  // null when cancelled
  startedAtISO:  string;
}

// ── Gated content + entitlements ─────────────────────────────────────────────
// `Entitlement: GRANTED → REVOKED`
export type ContentKind = 'video' | 'image' | 'article' | 'audio';

export interface GatedContent {
  id:           string;
  creatorId:    string;
  title:        string;
  kind:         ContentKind;
  /** true = pay-per-view / subscriber-only; false = public preview. */
  gated:        boolean;
  priceKobo:    number | null;   // for pay-per-view (kobo); null = subscriber-only
  /** NL-11 — mature/adult content that requires an age gate. */
  ageRestricted: boolean;
  thumbColor:   string;
  durationLabel?: string;
  publishedAtISO: string;
  /** Does the viewer hold an entitlement (GRANTED) for this item? */
  entitled:     boolean;
}

// ── Tips ──────────────────────────────────────────────────────────────────────
export interface TipInput {
  creatorId:  string;
  amountKobo: number;
  message?:   string;
}

export interface TipResult {
  id:     string;
  ok:     boolean;
}

// ── Subscribe ─────────────────────────────────────────────────────────────────
export interface SubscribeInput {
  creatorId: string;
  tierId:    string;
}

// ── Become a creator (schema wizard + payout KYC) ────────────────────────────
export interface BecomeCreatorInput {
  displayName: string;
  handle:      string;
  category:    string;
  bio:         string;
  /** Self-attested payout KYC: legal name + BVN/NIN reference. */
  legalName:   string;
  kycRef:      string;
  acceptedTerms: boolean;
}

export interface BecomeCreatorResult {
  ok:        boolean;
  creatorId: string;
}

// ── Earnings + payout ────────────────────────────────────────────────────────
export type EarningSource = 'tip' | 'subscription' | 'content';

export interface EarningEntry {
  id:       string;
  source:   EarningSource;
  label:    string;
  amountKobo: number;          // net to creator (kobo)
  atISO:    string;
}

export interface CreatorEarnings {
  /** Available to withdraw now (kobo). */
  availableKobo:  number;
  /** Pending clearance (kobo). */
  pendingKobo:    number;
  /** Lifetime gross earned (kobo). */
  lifetimeKobo:   number;
  /** Has the creator completed payout KYC? Gates withdrawals. */
  payoutKycDone:  boolean;
  recent:         EarningEntry[];
}

export interface PayoutInput {
  amountKobo: number;
}

export interface PayoutResult {
  ok:        boolean;
  reference: string;
  newAvailableKobo: number;
}

// ── Content management (creator side) ────────────────────────────────────────
export interface CreateContentInput {
  title:         string;
  kind:          ContentKind;
  gated:         boolean;
  priceKobo:     number | null;
  ageRestricted: boolean;
}
