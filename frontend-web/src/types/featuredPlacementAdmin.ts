// Featured Placement admin types. Mirrors the Go backend Campaign DTO
// (snake_case JSON) served under /placement/admin/*. Money fields are integer
// kobo (minor units) — never floats.

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

export const CAMPAIGN_STATES: CampaignState[] = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'NEEDS_MORE_INFO',
  'REJECTED',
  'PENDING_PAYMENT',
  'SCHEDULED',
  'ACTIVE',
  'PAUSED',
  'SUSPENDED',
  'CANCELLED',
  'CANCELLED_EARLY',
  'COMPLETED',
];

export interface CampaignCreative {
  headline: string;
  image_ref: string;
  cta: string;
  deep_link: string;
}

export interface Campaign {
  id: string;
  merchant_id: string;
  subject_type: string;
  subject_id: string;
  zone_code: string;
  window_start: string;
  window_end: string;
  duration_days: number;
  creative: CampaignCreative;
  quoted_price_kobo: number;
  rate_version: string;
  state: CampaignState;
  review_reason?: string | null;
  created_at: string;
  updated_at: string;
  // Optional merchant standing fields the detail endpoint may include.
  merchant_name?: string | null;
  merchant_standing?: string | null;
  merchant_active_campaigns?: number | null;
}

export interface ReviewQueueFilters {
  state?: string;
}
