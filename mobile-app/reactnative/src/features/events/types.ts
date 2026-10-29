// Money is always integer minor units (kobo). Never floats, never strings for math.
// Field names mirror the Go backend `backend/internal/top5events/model.go` verbatim
// (organiser_id, venue, state, tier_id, credential_id, etc.) — do not rename them
// on the wire; only the mock fixtures below add extra UI-only display fields.

// Event lifecycle: DRAFT -> SUBMITTED -> APPROVED -> LIVE -> CLOSED
// APPROVED <-> SUSPENDED is admin-only.
export type EventState = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'LIVE' | 'CLOSED' | 'SUSPENDED' | 'PAUSED' | 'CANCELLED';

export type EventCategory = 'music' | 'tech' | 'sports' | 'comedy' | 'faith';

export interface TicketTier {
  id:         string;
  event_id:   string;
  name:       string;            // e.g. "Regular", "VIP", "Table for 5"
  price_kobo: number;
  /** Tiers can be free (price_kobo === 0). */
  capacity:   number;
  sold:       number;
  active:     boolean;
  invite_only?:    boolean;
  sales_start_at?: string | null;   // ISO
  sales_end_at?:   string | null;   // ISO
}

// List/discovery summary — GET /api/finance/events.
export interface EventSummary {
  id:             string;
  title:          string;
  venue:          string;
  // Only present with FEATURE_EVENTS_COMMERCIAL on (events.city is a commerce
  // column); discovery echoes '' when the column does not exist yet.
  city?:          string;
  starts_at:      string;        // ISO
  ends_at:        string;        // ISO
  state:          EventState;
  category:       EventCategory;
  min_price_kobo: number | null;
  sold_out:       boolean;
}

// The backend Event object (top5events model.go Event): what the organiser
// profile returns for each upcoming event. EventDetail adds the ticket tiers.
export interface Event {
  id:            string;
  organiser_id:  string;
  title:         string;
  description:   string;
  venue:         string;
  state:         EventState;
  starts_at:     string;
  ends_at:       string;
  fee_bps:       number;
  category:      EventCategory;
  created_at:    string;
  // Social fields (events-social). The four nullable fields are sent as null,
  // never omitted; a null coordinate pair means no map. `liked` is per-caller.
  banner_url:     string | null;
  venue_lat:      number | null;
  venue_lng:      number | null;
  venue_place_id: string | null;
  like_count:     number;
  liked:          boolean;
  // Commerce fields (FEATURE_EVENTS_COMMERCIAL / migration 20271400000000).
  // Optional because the server omits them while the flag is off, and a screen
  // must never show an empty refund policy as "no refunds".
  city?:                  string;
  venue_address?:         string;
  refund_policy?:         string;
  refund_cutoff_hours?:   number;
  checkin_opens_minutes?: number;
  checkin_closes_minutes?: number;
  submitted_at?:          string | null;
  moderation_status?:     string;
  moderation_note?:       string;
  moderation_decided_at?: string | null;
}

// Full detail — GET /api/finance/events/:id.
export interface EventDetail extends Event {
  tiers: TicketTier[];
}

// Discovery query the list route serves (backend EventListFilter). `sort` is the
// server's deterministic order — date_asc is its default, so omitting it and
// passing 'date_asc' render the same feed.
export type EventSort = 'date_asc' | 'date_desc' | 'price_asc' | 'price_desc';

export interface EventQuery {
  category?: string;      // EventCategory or 'all'
  state?:    EventState;
  city?:     string;      // commerce column; ignored by the server while its flag is off
  q?:        string;      // title + venue free text
  from?:     string;      // RFC3339 lower bound on starts_at
  to?:       string;      // RFC3339 upper bound on starts_at
  sort?:     EventSort;
}

// POST/DELETE /events/:id/like.
export interface LikeState {
  liked:      boolean;
  like_count: number;
}

// POST/DELETE /events/organisers/:id/follow.
export interface FollowState {
  following:      boolean;
  follower_count: number;
}

// GET /events/organisers/:id — public organiser page. `events` is the
// organiser's upcoming public events.
export interface OrganiserProfile {
  organiser_id:   string;
  display_name:   string;
  bio:            string;
  banner_url:     string | null;
  follower_count: number;
  following:      boolean;
  events:         Event[];
}

// PUT /events/organisers/me — every field optional. Omitted = unchanged;
// banner_url: null clears the banner.
export interface OrganiserPatch {
  display_name?: string;
  bio?:          string;
  banner_url?:   string | null;
}

// POST /events/organisers/me/banner/presign — PUT the image bytes to upload_url
// with this exact content_type header, then send object_key as banner_url in
// PUT /events/organisers/me.
export interface BannerPresign {
  upload_url:   string;
  object_key:   string;
  content_type: string;
  expires_in:   number;   // seconds
  method:       'PUT';
}

// PATCH /api/finance/events/:id — every field optional; omitted = unchanged.
export interface EventPatch {
  title?:       string;
  description?: string;
  venue?:       string;
  // Set together with the venue when an address is picked (FEATURE_EVENTS_SOCIAL).
  // null clears a stored pin; omit to leave it untouched.
  venue_lat?:      number | null;
  venue_lng?:      number | null;
  venue_place_id?: string | null;
  category?:    EventCategory;
  starts_at?:   string;
  ends_at?:     string;
  // Commerce disclosure/policy (FEATURE_EVENTS_COMMERCIAL). These columns are NOT
  // NULL with server-side defaults, so "absent means unchanged" is the contract:
  // there is no way to clear one, and an edit screen must never send '' meaning
  // "no refund policy".
  city?:                  string;
  venue_address?:         string;
  refund_policy?:         string;
  refund_cutoff_hours?:   number;
  checkin_opens_minutes?: number;
  checkin_closes_minutes?: number;
}

// POST /api/finance/events/:id/cancel body (202 Accepted; refunds run async).
export interface CancelEventRequest {
  reason: string;
}

// Ticket lifecycle: ISSUED -> TRANSFERRED -> USED | ISSUED -> USED | ISSUED -> REFUNDED
export type TicketState = 'ISSUED' | 'TRANSFERRED' | 'USED' | 'REFUNDED';

export interface Ticket {
  id:              string;
  event_id:        string;
  tier_id:         string;
  order_id:        string;
  owner_id:        string;
  state:           TicketState;
  credential_id:   string;       // rotating QR / NFC gate-entry token id
  price_paid_kobo: number;
  created_at:      string;
  // Door record (FEATURE_EVENTS_COMMERCIAL). AttendeeName is who the seat was
  // sold to at checkout — after a gift the owner and the person in the seat
  // differ, and the gate reads the attendee. All absent while the flag is off.
  attendee_name?:    string;
  checked_in_at?:    string | null;
  checkin_method?:   string;     // scan | manual
  checked_in_by?:    string;     // steward account id
  checked_in_gate?:  string;
}

export type EventWalletState = 'OPEN' | 'SPENDING' | 'CLOSED';

export interface EventWallet {
  id:            string;
  event_id:      string;
  owner_id:      string;
  state:         EventWalletState;
  balance_kobo:  number;         // closed-loop spendable balance (ledger projection)
  credential_id?: string;
  created_at:    string;
}

export type EventWalletEntryType = 'TOPUP' | 'CHARGE' | 'REFUND';

export interface EventWalletEntry {
  id:              string;
  wallet_id:       string;
  type:            EventWalletEntryType;
  amount_kobo:     number;
  reference:       string;
  idempotency_key: string;
  created_at:      string;
}

export type TopUpSource = 'wallet' | 'agent' | 'card';

export interface Vendor {
  id:            string;
  event_id:      string;
  user_id:       string;
  name:          string;
  active:        boolean;
  credential_id?: string;
  created_at:    string;
}

export interface PromoCode {
  id:          string;
  event_id:    string;
  code:        string;
  version:     number;
  percent_off: number;
  max_uses:    number;
  used:        number;
  active:      boolean;
  amount_off_kobo?: number;
  tier_id?:         string | null;
  starts_at?:       string | null;  // ISO
  ends_at?:         string | null;  // ISO
  per_user_limit?:  number;
}

// PATCH bodies — every field optional (snake_case wire shape).
export interface TierPatch {
  name?: string;
  description?: string;
  price_kobo?: number;
  capacity?: number;
  active?: boolean;
  invite_only?: boolean;
  sales_start_at?: string | null;
  sales_end_at?: string | null;
}

// `code` is deliberately absent: the server rejects code edits (create sets it).
export interface PromoPatch {
  percent_off?: number;
  amount_off_kobo?: number;
  tier_id?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  per_user_limit?: number;
  max_uses?: number;
  active?: boolean;
}

export interface CreateEventInput {
  title:        string;
  description:  string;
  venue:        string;
  venue_lat?:      number | null;
  venue_lng?:      number | null;
  venue_place_id?: string | null;
  category:     EventCategory;
  starts_at:    string;
  ends_at:      string;
  fee_bps?:     number;
  // Commerce disclosure/policy (FEATURE_EVENTS_COMMERCIAL). The server fills any
  // omitted one with its own default, so a draft is always publishable.
  city?:                  string;
  venue_address?:         string;
  refund_policy?:         string;
  refund_cutoff_hours?:   number;
  checkin_opens_minutes?: number;
  checkin_closes_minutes?: number;
  // once per tier after the event is created (backend has no bulk-create route).
  tiers:        { name: string; price_kobo: number; capacity: number }[];
}

export interface AddTierInput {
  name:       string;
  price_kobo: number;
  capacity:   number;
  description?:    string;
  invite_only?:    boolean;
  sales_start_at?: string | null;
  sales_end_at?:   string | null;
}

// POST /events/:id/promos — exactly one of percent_off / amount_off_kobo (server rejects both/neither).
export interface CreatePromoInput {
  code: string;
  percent_off?: number;
  amount_off_kobo?: number;
  tier_id?: string;
  starts_at?: string;
  ends_at?: string;
  per_user_limit?: number;
  max_uses?: number;
}

export interface PurchaseTicketInput {
  eventId:     string;
  tier_id:     string;
  quantity:    number;
  promo_code?: string;
  // Optional seat-holder names, one per seat in ticket order (FEATURE_EVENTS_
  // COMMERCIAL). Send either none or all: a partial list is a server-side 400,
  // because half-named seats would mis-attribute who the gate let in.
  attendee_names?: string[];
}

export interface PurchaseResult {
  ok:      boolean;
  tickets: Ticket[];
  total_kobo: number;
  // Batch checkout accounting (server-computed; the wallet rail fulfils seat by
  // seat, so a mid-batch sell-out returns the seats it could issue).
  quantity?:   number;
  fulfilled?:  number;
  partial?:    boolean;
  booking_ref?: string;
}

export interface GiftTicketInput {
  ticketId: string;
  cashtag:  string;
}

// The live, server-issued, HMAC-signed rotating token for a ticket's gate-entry
// credential (mirrors backend/internal/credential.Token's JSON tags exactly —
// cid/w/n/sig — so a scanned QR round-trips straight into a Go credential.Token
// via JSON.parse). Fetched via GET /tickets/:ticketId/token, never computed
// client-side; the server enforces its RotateTTL/anti-screenshot window.
export interface GateToken {
  cid: string; // credential id
  w:   number; // rotation window bucket
  n:   string; // per-window nonce
  sig: string; // HMAC-SHA256(secret, cid|w|n)
}

export interface Gate {
  id:   string;
  name: string;
}

export interface ScanInput {
  credential_id: string;
}

// Result of a steward scan (offline-tolerant validation).
export interface ScanResult {
  outcome:     'valid' | 'already-used' | 'invalid' | 'wrong-event';
  ticket_id?:  string;
  holderName?: string;
  tierName?:   string;
  /** True when validated against the locally cached manifest (offline). */
  offline:     boolean;
}

// display name, attendee counts, lat/lng, or address — those fields do not
// exist on Event/EventSummary. To preserve the existing visual design (colored
// banner cards with an emoji, etc.) these are derived deterministically on the
// client from id/category/venue, never fetched from the network, and never
// sent back in a request body.
export interface EventDisplayMeta {
  coverEmoji:  string;
  bannerColor: string;
}

// NOTE: the backend has no dedicated organiser-stats aggregate endpoint. The
// dashboard derives these figures client-side from the organiser's own event
// list (GET /api/finance/events?organiser scoping is not in the route table
// either — see report). ticketsSold/grossKobo are computed from tier sold
// counts on EventDetail where available.
// GET /organiser/mine — real endpoint. Snake_case, matching this file's stated
// convention (field names mirror the Go backend verbatim) rather than the
// camelCase this type had while it was still client-derived-only.
export interface OrganiserEventStats {
  event:         EventSummary;
  tickets_sold:  number;
  tickets_total: number | null;
  gross_kobo:    number;
}

// GET /:id/attendees — real, organiser/steward-gated endpoint. Snake_case, same
// reasoning as OrganiserEventStats above.
export interface Attendee {
  id:            string;
  name:          string;
  cashtag:       string;
  tier_name:     string;
  ticket_id:     string;
  state:         TicketState;
  checked_in:    boolean;
  checked_in_at?: string | null;
  // Door attribution (FEATURE_EVENTS_COMMERCIAL): who the seat was sold to, at
  // which gate, by which method, and which steward admitted them.
  attendee_name?:    string;
  gate?:             string;
  checkin_method?:   string;
  checked_in_by?:    string;
  checked_in_by_name?: string;
}

export interface VenueZone {
  id:    string;
  name:  string;
  type:  'stage' | 'food' | 'entry' | 'restroom' | 'vendor' | 'medical';
  x:     number;
  y:     number;
}

export interface VendorMenuItem {
  id:         string;
  name:       string;
  priceKobo:  number;
}

export interface EventVendorDisplay {
  id:       string;
  name:     string;
  category: string;
  emoji:    string;
  items:    VendorMenuItem[];
}

// Per-event team member (contracts/openapi.yaml EventTeamMember).
export interface TeamMember {
  user_id:    string;
  handle:     string;
  name:       string;
  role:       'MANAGER' | 'FINANCE';
  granted_by: string;
  created_at: string;
}

export interface AddTeamMemberInput {
  user_handle: string;
  role:        string;
}

// POST /events/{id}/comps — recipients are handles or cashtags.
export interface IssueCompInput {
  tier_id:    string;
  recipients: string[];
  note?:      string;
}

// POST /events/{id}/announcements — contract requires both subject and body.
export interface AnnounceInput {
  subject: string;
  body:    string;
}

export interface AnnounceResult {
  recipient_count: number;
}

// ── Events commerce (FEATURE_EVENTS_COMMERCIAL, migration 20271400000000) ────
// Field names mirror `backend/internal/top5events` JSON tags verbatim. Every
// commerce route 404s while the server flag is off, so these only ever load when
// EVENTS_COMMERCE_ENABLED is on; a screen must treat a missing field as unknown,
// never as zero.

export type OrderState = 'PENDING' | 'PAID' | 'EXPIRED' | 'REFUNDED';

// One seat's checkout record. Snapshot fields restate the price agreed at
// checkout, so a later tier edit cannot re-price a receipt.
export interface Order {
  id:              string;
  reference?:      string;      // card reference on the card rail, absent on wallet
  booking_ref?:    string;
  event_id:        string;
  event_title?:    string;
  event_starts_at?: string | null;
  buyer_id:        string;
  buyer_name?:     string;
  attendee_name?:  string;
  tier_name?:      string;
  promo_code?:     string;
  unit_price_kobo: number;
  discount_kobo:   number;
  total_kobo:      number;
  refunded_kobo:   number;
  payment_rail?:   string;
  status:          OrderState;
  created_at:      string;
}

// The seats of one checkout, grouped by booking_ref.
export interface Booking {
  booking_ref:        string;
  event_id:           string;
  event_title:        string;
  venue?:             string;
  city?:              string;
  starts_at:          string;
  event_state:        string;
  status:             string;
  seats:              number;
  subtotal_kobo:      number;
  discount_kobo:      number;
  total_kobo:         number;
  refunded_kobo:      number;
  platform_fee_kobo:  number;
  organiser_net_kobo: number;
  promo_code?:        string;
  refund_policy?:     string;
  fee_bps:            number;
  created_at:         string;
  orders?:            Order[];
}

// GET /:id/quote — the server's price for this exact basket. The checkout screen
// shows THIS, not a client-side arithmetic result: total_kobo is what the wallet
// will be debited.
export interface QuoteArgs {
  eventId:    string;
  tier_id:    string;
  quantity:   number;
  promo_code?: string;
}

export interface Quote {
  event_id:             string;
  event_title:          string;
  event_state:          string;
  venue?:               string;
  city?:                string;
  starts_at:            string;
  tier_id:              string;
  tier_name:            string;
  quantity:             number;
  unit_price_kobo:      number;
  subtotal_kobo:        number;
  promo_code?:          string;
  discount_per_seat_kobo: number;
  discount_kobo:        number;
  total_kobo:           number;
  fee_bps:              number;
  platform_fee_kobo:    number;
  organiser_net_kobo:   number;
  remaining_seats:      number;
  unlimited_capacity:   boolean;
  refund_policy?:       string;
  refund_cutoff_hours?: number;
  checkin_opens_minutes?: number;
  checkin_closes_minutes?: number;
}

export type RefundState =
  'REQUESTED' | 'APPROVED' | 'REJECTED' | 'PROCESSING' | 'REFUNDED' | 'FAILED';

export interface Refund {
  id:              string;
  event_id:        string;
  order_id:        string;
  ticket_id:       string;
  buyer_id:        string;
  amount_kobo:     number;
  fee_kobo:        number;
  refund_kobo:     number;
  reason?:         string;
  status:          RefundState;
  created_at:      string;
  decided_by?:     string;
  decided_at?:     string | null;
  decision_note?:  string;
  failure_reason?: string;
  // Queue display only — never an authorization input.
  event_title?:    string;
  event_state?:    string;
  tier_name?:      string;
  attendee_name?:  string;
  buyer_name?:     string;
  booking_ref?:    string;
}

export interface NotificationPage {
  notifications: EventNotification[];
  unread:        number;
}

export type NotificationKind =
  | 'refund_requested' | 'refund_approved' | 'refund_rejected'
  | 'event_cancelled' | 'moderation' | 'support_reply';

export interface EventNotification {
  id:         string;
  kind:       NotificationKind | string;
  title:      string;
  body:       string;
  event_id?:  string;
  order_id?:  string;
  refund_id?: string;
  read_at?:   string | null;
  created_at: string;
}

export type SupportCaseKind = 'REFUND' | 'TICKET' | 'CHECKIN' | 'PAYMENT' | 'CONDUCT' | 'OTHER';
export type SupportCaseState = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
// Lower-case on the wire: the column CHECK is priority IN ('low','normal','high',
// 'urgent'), and anything else the desk silently downgrades to 'normal'.
export type SupportPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface SupportMessage {
  id:           string;
  case_id:      string;
  author_id:    string;
  author_name?: string;
  body:         string;
  created_at:   string;
}

export interface SupportCase {
  id:           string;
  event_id?:    string;
  event_title?: string;
  order_id?:    string;
  ticket_id?:   string;
  opened_by:    string;
  kind:         SupportCaseKind | string;
  subject:      string;
  body:         string;
  status:       SupportCaseState | string;
  priority:     SupportPriority | string;
  assigned_to?: string;
  resolved_at?: string | null;
  created_at:   string;
  updated_at:   string;
  reply_count:  number;
  messages?:    SupportMessage[];
  last_message?: SupportMessage;
}

export interface OpenCaseInput {
  kind:     SupportCaseKind;
  subject:  string;
  body:     string;
  event_id?:  string;
  order_id?:  string;
  ticket_id?: string;
  priority?:  SupportPriority;
}

// GET /:id/moderation — one row of the event's governance trail.
export interface ModerationDecision {
  id:          string;
  event_id?:   string;
  actor_id?:   string;
  actor_name?: string;
  action:      string;
  from_state?: string;
  to_state?:   string;
  reason?:     string;
  created_at:  string;
}

// POST /:id/quote-free: the door roster, with attendee name and check-in
// attribution (commerce variant of Attendee).
export interface RosterRow {
  id:               string;      // ticket id
  name:             string;      // account owner (may differ from the seat holder)
  cashtag:          string;
  tier_name:        string;
  ticket_id:        string;
  state:            string;
  checked_in:       boolean;
  checked_in_at?:   string | null;
  attendee_name?:   string;
  gate?:            string;
  checkin_method?:  string;
  checked_in_by?:   string;
  checked_in_by_name?: string;
}

export interface RosterFilter {
  state?:  '' | 'waiting' | 'checked_in' | TicketState;
  gate?:   string;
  q?:      string;
  limit?:  number;
  offset?: number;
}

export interface CheckinStats {
  total:               number;
  checked_in:          number;
  waiting:             number;
  refunded:            number;
  by_gate:             Record<string, number>;
  by_method:           Record<string, number>;
  window_opens_at?:    string | null;
  window_closes_at?:   string | null;
  open:                boolean;
}

export interface CheckinEntry {
  id:          string;
  ticket_id:   string;
  actor_id:    string;
  actor_name?: string;
  action:      string;   // IN | OUT
  method:      string;   // scan | manual | undo
  gate?:       string;
  reason?:     string;
  occurred_at: string;
}
