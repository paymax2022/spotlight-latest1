// ── Featured Placement — Types ────────────────────────────────────────────────
// Merchants book paid landing-page promotion ("Featured Placement"); consumers
// see Featured items on the home screen. All money is integer kobo.
//
// Mirrors the placement contract: /api/v1/placement/* (member) and
// /api/v1/landing/* + /api/v1/placement/events (public).

export type Kobo = number;

// Campaign lifecycle — the server is the source of truth for transitions.
export type CampaignState =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'NEEDS_MORE_INFO'
  | 'REJECTED'
  | 'PENDING_PAYMENT'
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'PAUSED'
  | 'SUSPENDED'
  | 'CANCELLED'
  | 'CANCELLED_EARLY'
  | 'COMPLETED';

// 'restaurant' promotes a whole store to the top of food discovery, priced by
// the RESTAURANT_TOP zone. The backend's subject_type is free text and its
// eligibility check is permissive, so this is a client-side vocabulary addition;
// the value must stay exactly 'restaurant' because food discovery's ordering
// filters on that literal (see restaurant/discovery_page.go).
export type SubjectType = 'listing' | 'product' | 'event' | 'service' | 'profile' | 'restaurant';

export interface Creative {
  headline: string;
  image_ref: string;
  cta: string;
  deep_link: string;
}

/** Per-zone creative authoring spec (drives the customize step's hints/limits). */
export interface CreativeSpec {
  headline_max?: number;
  cta_max?: number;
  image_aspect?: string;       // e.g. "16:9"
  image_hint?: string;
  cta_suggestions?: string[];
}

export type ZoneLayout = 'hero' | 'carousel' | 'grid';

export interface Zone {
  zone_code: string;
  name: string;
  description?: string;
  layout_type: ZoneLayout;
  base_daily_rate_kobo: Kobo;
  /** Availability hint surfaced in the picker ("limited slots"). */
  slots_total: number;
  slots_taken: number;
  creative_spec?: CreativeSpec;
}

export interface QuoteBreakdown {
  base_daily_rate_kobo: Kobo;
  duration_days: number;
  tier_multiplier: number;
  duration_discount_pct: number;
  fees_kobo: Kobo;
}

export interface Quote {
  quoted_price_kobo: Kobo;
  rate_version: string;
  breakdown: QuoteBreakdown;
}

export interface Campaign {
  id: string;
  state: CampaignState;
  subject_type: SubjectType;
  subject_id: string;
  subject_label?: string;
  zone_code: string;
  zone_name?: string;
  window_start: string;        // ISO date (YYYY-MM-DD)
  window_end: string;          // ISO date (YYYY-MM-DD)
  creative: Creative;
  quoted_price_kobo?: Kobo;
  rate_version?: string;
  created_at: string;
  updated_at: string;
  review_note?: string;        // populated for NEEDS_MORE_INFO / REJECTED
}

export interface CampaignAnalytics {
  campaign_id: string;
  impressions: number;
  taps: number;
  ctr: number;                 // taps / impressions (0..1)
  spend_kobo: Kobo;
  days_elapsed: number;
  days_total: number;
}

export interface CreateDraftRequest {
  subject_type: SubjectType;
  subject_id: string;
  subject_label?: string;
  zone_code: string;
  window_start: string;
  window_end: string;
  creative: Creative;
}

// ─── Eligible items the merchant can promote (mock for now) ───────────────────
export interface EligibleItem {
  subject_type: SubjectType;
  subject_id: string;
  label: string;
  subtitle?: string;
  image_ref?: string;
  deep_link: string;
  default_headline?: string;
  default_cta?: string;
}

// ─── Public landing resolver ──────────────────────────────────────────────────
export interface LandingItem {
  campaign_id: string;
  placement_token: string;
  subject_type: SubjectType;
  subject_id: string;
  creative: Creative;
  label: string;              // human label shown under the card
}

export interface LandingZone {
  zone_code: string;
  layout_type: ZoneLayout;
  items: LandingItem[];
}

export interface LandingResponse {
  zones: LandingZone[];
}

export type PlacementEventType = 'impression' | 'tap';

export interface PlacementEvent {
  campaign_id: string;
  type: PlacementEventType;
  placement_token: string;
  session_id: string;
}

// ─── Errors ───────────────────────────────────────────────────────────────────
export interface FeaturedError extends Error {
  status?: number;
  code?: string;
}
