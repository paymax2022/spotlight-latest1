// ── Events domain types ──────────────────────────────────────────────────────
// Money is always integer minor units (kobo). Never floats, never strings for math.
// Field names mirror the Go backend `backend/internal/top5events/model.go` verbatim
// (organiser_id, venue, state, tier_id, credential_id, etc.) — do not rename them
// on the wire; only the mock fixtures below add extra UI-only display fields.

// Event lifecycle: DRAFT -> SUBMITTED -> APPROVED -> LIVE -> CLOSED
// APPROVED <-> SUSPENDED is admin-only.
export type EventState = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'LIVE' | 'CLOSED' | 'SUSPENDED';

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
}

// List/discovery summary — GET /api/finance/events.
export interface EventSummary {
  id:             string;
  title:          string;
  venue:          string;
  starts_at:      string;        // ISO
  ends_at:        string;        // ISO
  state:          EventState;
  category:       EventCategory;
  min_price_kobo: number | null; // cheapest active tier; null/0 = free
  sold_out:       boolean;
}

// Full detail — GET /api/finance/events/:id.
export interface EventDetail {
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
  tiers:         TicketTier[];
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
}

// ── Cashless closed-loop event wallet (NL-3) ─────────────────────────────────
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
}

// ── Inputs ───────────────────────────────────────────────────────────────────
export interface CreateEventInput {
  title:        string;
  description:  string;
  venue:        string;
  category:     EventCategory;
  starts_at:    string;
  ends_at:      string;
  fee_bps?:     number;
  // Ticket tiers submitted alongside creation; client calls the /tiers endpoint
  // once per tier after the event is created (backend has no bulk-create route).
  tiers:        { name: string; price_kobo: number; capacity: number }[];
}

export interface AddTierInput {
  name:       string;
  price_kobo: number;
  capacity:   number;
}

export interface PurchaseTicketInput {
  eventId:     string;
  tier_id:     string;
  quantity:    number;
  promo_code?: string;
}

export interface PurchaseResult {
  ok:      boolean;
  tickets: Ticket[];
  total_kobo: number;
}

export interface GiftTicketInput {
  ticketId: string;
  cashtag:  string;
}

// ── Steward scan ─────────────────────────────────────────────────────────────

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

// ── UI-only display extras ───────────────────────────────────────────────────
// The real backend does not return cover art, banner colors, city, organiser
// display name, attendee counts, lat/lng, or address — those fields do not
// exist on Event/EventSummary. To preserve the existing visual design (colored
// banner cards with an emoji, etc.) these are derived deterministically on the
// client from id/category/venue, never fetched from the network, and never
// sent back in a request body.
export interface EventDisplayMeta {
  coverEmoji:  string;
  bannerColor: string;
}

// ── Organiser dashboard ──────────────────────────────────────────────────────
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
