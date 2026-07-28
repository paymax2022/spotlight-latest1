// ── Hotelier Extranet — Paymax Stays (Booking.com Extranet/Pulse equivalent) ─
// Object-scoped to the signed-in hotelier's OWN property. Field names mirror the
// Go JSON (snake_case) from /api/stays/extranet/*. Money is BIGINT kobo (minor
// units) and settled in Naira (NGN). RBAC: stays.hotelier.* + staff roles.

export type Currency = 'NGN' | 'USD' | 'EUR' | 'GBP';

// ── A · Onboarding & verification ────────────────────────────────────────────
export type PropertyType = 'hotel' | 'apartment' | 'guesthouse' | 'resort' | 'hostel' | 'villa';
export type VerificationStage = 'signup' | 'property' | 'verification' | 'content' | 'policies' | 'go_live';
export type VerificationItemStatus = 'pending' | 'in_progress' | 'submitted' | 'approved' | 'rejected' | 'needs_changes';

export interface VerificationChecklistItem {
  key: string;
  label: string;
  stage: VerificationStage;
  status: VerificationItemStatus;
  detail?: string;
  required: boolean;
}
export interface VerificationStatus {
  property_id: string;
  property_name: string;
  overall: VerificationItemStatus;
  go_live_eligible: boolean;
  submitted_for_review_at?: string | null;
  reviewed_at?: string | null;
  reviewer_note?: string | null;
  checklist: VerificationChecklistItem[];
}

export interface BusinessVerification {
  legal_name: string;
  rc_number: string; // CAC registration
  tin: string;
  kyc_status: VerificationItemStatus;
  business_doc_status: VerificationItemStatus;
  director_name: string;
  director_bvn_last4: string;
}

export interface BankSettings {
  bank_name: string;
  account_name: string;
  account_number: string;
  currency: Currency; // settlement currency — NGN
  verified: boolean;
  payout_schedule: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  next_payout_date: string;
}

// ── B · Content & inventory ──────────────────────────────────────────────────
export interface Geo { lat: number; lng: number; }
export interface PropertyProfile {
  property_id: string;
  name: string;
  type: PropertyType;
  star_rating: number;
  description: string;
  short_tagline: string;
  address_line: string;
  city: string;
  state: string;
  country: string;
  geo: Geo;
  check_in_from: string; // "14:00"
  check_out_until: string; // "12:00"
  contact_phone: string;
  contact_email: string;
  currency: Currency;
  status: 'draft' | 'pending_review' | 'live' | 'paused';
}

export interface PhotoAsset {
  id: string;
  url: string;
  caption: string;
  tag: 'exterior' | 'room' | 'lobby' | 'amenity' | 'dining' | 'view';
  is_cover: boolean;
  order: number;
}

export interface AmenityGroup {
  group: string;
  items: { key: string; label: string; enabled: boolean }[];
}

export interface RoomType {
  id: string;
  name: string;
  max_occupancy: number;
  beds: string; // "1 King" / "2 Twin"
  size_sqm: number;
  count: number; // physical rooms of this type
  smoking: boolean;
  status: 'active' | 'disabled';
}

export type BoardBasis = 'room_only' | 'breakfast' | 'half_board' | 'full_board' | 'all_inclusive';
export interface RatePlan {
  id: string;
  room_type_id: string;
  name: string;
  board: BoardBasis;
  refundable: boolean;
  cancellation_window_hours: number;
  mobile_rate: boolean;
  derived_from?: string | null; // parent rate plan id (linked/derived)
  derived_adjustment_pct?: number | null; // e.g. -0.10 = 10% below parent
  loyalty_opt_in: boolean;
  base_rate_kobo: number;
  currency: Currency;
  status: 'active' | 'disabled';
}

// Calendar month grid: per room-type per date availability + rate + restrictions.
export interface CalendarCell {
  date: string; // YYYY-MM-DD
  available: number;
  rate_kobo: number;
  min_los: number;
  cta: boolean; // closed to arrival
  ctd: boolean; // closed to departure
  stop_sell: boolean;
}
export interface CalendarRoomRow {
  room_type_id: string;
  room_type_name: string;
  cells: CalendarCell[];
}
export interface CalendarData {
  property_id: string;
  month: string; // YYYY-MM
  currency: Currency;
  rows: CalendarRoomRow[];
}

export interface BulkEditPayload {
  room_type_ids: string[];
  date_from: string;
  date_to: string;
  weekdays?: number[]; // 0..6 optional filter
  rate_kobo?: number;
  available?: number;
  min_los?: number;
  cta?: boolean;
  ctd?: boolean;
  stop_sell?: boolean;
}

export interface Restriction {
  room_type_id: string;
  room_type_name: string;
  min_los: number;
  max_los: number;
  cta: boolean;
  ctd: boolean;
  stop_sell: boolean;
}

// ── C · Promotions & visibility ──────────────────────────────────────────────
export type PromotionType = 'early_bird' | 'los' | 'last_minute' | 'mobile';
export interface Promotion {
  id: string;
  name: string;
  type: PromotionType;
  discount_pct: number; // 0..1
  date_from: string;
  date_to: string;
  min_los?: number | null;
  advance_days?: number | null; // early-bird
  last_minute_hours?: number | null;
  applies_to_rate_plans: string[];
  status: 'active' | 'scheduled' | 'ended' | 'paused';
  redemptions: number;
}

export interface LoyaltyOptIn {
  program_name: string;
  enrolled_rate_plans: { rate_plan_id: string; name: string; opted_in: boolean; earn_rate_pct: number }[];
  member_bookings_30d: number;
  member_gmv_30d_kobo: number;
}

export interface VisibilityBooster {
  phase: 'phase_3_placeholder';
  enabled: boolean;
  current_rank?: number | null;
  suggested_commission_uplift_pct?: number | null;
  note: string;
}

export interface Opportunity {
  id: string;
  title: string;
  category: 'pricing' | 'content' | 'availability' | 'reviews' | 'promotions';
  impact: 'high' | 'medium' | 'low';
  description: string;
  cta_label: string;
  cta_href?: string | null;
}

// ── D · Reservations & guests ────────────────────────────────────────────────
export type ReservationStatus =
  | 'confirmed' | 'in_house' | 'completed' | 'cancelled_by_guest'
  | 'cancelled_by_hotel' | 'no_show' | 'pending';
export type PaymentStatus = 'paid' | 'pay_at_property' | 'deposit_held' | 'refunded' | 'partial';

export interface ReservationSummary {
  id: string;
  ref: string;
  guest_name: string;
  room_type_name: string;
  rate_plan_name: string;
  check_in: string;
  check_out: string;
  nights: number;
  guests: number;
  status: ReservationStatus;
  payment_status: PaymentStatus;
  total_kobo: number;
  currency: Currency;
  channel: string; // paymax_app | agent | direct
  created_at: string;
}
export interface ReservationDetail extends ReservationSummary {
  guest_email: string;
  guest_phone: string;
  guest_country: string;
  special_requests?: string | null;
  board: BoardBasis;
  deposit_kobo: number;
  balance_due_kobo: number;
  commission_kobo: number;
  net_to_hotel_kobo: number;
  loyalty_member: boolean;
  timeline: { at: string; label: string; kind: string }[];
}

export interface ModifyReservationPayload {
  reservation_id: string;
  action: 'modify_dates' | 'modify_room' | 'cancel' | 'mark_no_show';
  new_check_in?: string;
  new_check_out?: string;
  new_room_type_id?: string;
  reason?: string;
}
export interface ManualActionResult {
  reservation_id: string;
  status: ReservationStatus;
  message: string;
}

export interface GuestMessage {
  id: string;
  reservation_ref: string;
  guest_name: string;
  last_message: string;
  unread: number;
  from: 'guest' | 'hotel';
  updated_at: string;
}

export interface Review {
  id: string;
  guest_name: string;
  reservation_ref: string;
  rating: number; // 1..10
  title: string;
  body: string;
  created_at: string;
  response?: string | null;
  responded_at?: string | null;
  status: 'published' | 'pending' | 'flagged';
}

// ── E · Finance ──────────────────────────────────────────────────────────────
export interface Payout {
  id: string;
  period: string; // "2026-06-01 → 2026-06-15"
  gross_kobo: number;
  commission_kobo: number;
  net_kobo: number;
  currency: Currency;
  status: 'paid' | 'scheduled' | 'pending' | 'held';
  paid_at?: string | null;
  reference?: string | null;
}
export interface Invoice {
  id: string;
  number: string;
  issued_at: string;
  amount_kobo: number;
  currency: Currency;
  type: 'commission' | 'service_fee';
  status: 'paid' | 'pending' | 'overdue';
}
export interface CommissionOverview {
  rate_pct: number; // 0..1
  gmv_30d_kobo: number;
  commission_30d_kobo: number;
  net_30d_kobo: number;
  currency: Currency;
  by_rate_plan: { rate_plan_name: string; gmv_kobo: number; commission_kobo: number }[];
}
export interface DepositReconRow {
  reservation_ref: string;
  guest_name: string;
  check_in: string;
  deposit_kobo: number;
  collected_at_property_kobo: number;
  status: 'reconciled' | 'pending' | 'flagged';
  currency: Currency;
}

// ── F · Analytics ────────────────────────────────────────────────────────────
export interface PerformanceAnalytics {
  currency: Currency;
  occupancy_pct: number; // 0..1
  adr_kobo: number; // average daily rate
  revpar_kobo: number; // revenue per available room
  total_revenue_30d_kobo: number;
  trend: { date: string; occupancy_pct: number; adr_kobo: number; revpar_kobo: number }[];
}
export interface ConversionFunnel {
  searches: number;
  property_views: number;
  rate_views: number;
  add_to_cart: number;
  bookings: number;
  view_to_book_pct: number; // 0..1
}
export interface BookerInsights {
  by_geo: { region: string; bookings: number; share_pct: number }[];
  by_device: { device: string; bookings: number; share_pct: number }[];
  lead_time_buckets: { bucket: string; bookings: number }[];
}
export interface MarketContext {
  currency: Currency;
  your_adr_kobo: number;
  market_median_adr_kobo: number;
  comp_set: { name: string; adr_kobo: number; occupancy_pct: number }[];
  note: string;
}

// ── G · Account & staff ──────────────────────────────────────────────────────
export type StaffRole = 'owner' | 'revenue_manager' | 'front_desk';
export interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  status: 'active' | 'invited' | 'disabled';
  last_active?: string | null;
}
export interface ExtranetSettings {
  property_id: string;
  notifications: {
    new_reservation: boolean;
    cancellation: boolean;
    new_review: boolean;
    new_message: boolean;
    payout: boolean;
  };
  channel: { email: boolean; sms: boolean; push: boolean };
  timezone: string;
  default_currency: Currency;
}
