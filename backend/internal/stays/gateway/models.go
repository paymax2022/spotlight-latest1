package gateway

import "time"

// Normalised STAYS supply models. These are the ONLY shapes that cross the gateway
// boundary — supplier JSON never leaks past an adapter. Every monetary amount is an
// integer in minor units (kobo / cents of the carried Currency); every rate carries
// its Currency so FX is explicit and never silent (PRD §10).

// SourceRail identifies which supply rail an offer/reservation came from.
type SourceRail string

const (
	// RailBedbank — Rail A: aggregator/bedbank API (breadth, instant, net rate +
	// markup). PRD §5.1.
	RailBedbank SourceRail = "BEDBANK"
	// RailDirect — Rail B: direct local extranet inventory via ari-svc (depth,
	// margin, Naira, sell rate + commission). PRD §5.2.
	RailDirect SourceRail = "DIRECT"
)

// RatePlanType enumerates the normalised rate-plan kinds (PRD §10).
type RatePlanType string

const (
	RatePlanBAR           RatePlanType = "BAR"            // flexible / free cancellation
	RatePlanNonRefundable RatePlanType = "NON_REFUNDABLE" // cheaper, no refund
	RatePlanBreakfast     RatePlanType = "BREAKFAST"      // breakfast included
	RatePlanMobileOnly    RatePlanType = "MOBILE_ONLY"    // mobile-only rate
	RatePlanLOSDiscount   RatePlanType = "LOS_DISCOUNT"   // length-of-stay discount
	RatePlanEarlyBird     RatePlanType = "EARLY_BIRD"
	RatePlanLastMinute    RatePlanType = "LAST_MINUTE"
)

// PaymentMethod enumerates checkout methods (PRD §12).
type PaymentMethod string

const (
	PaymentWallet         PaymentMethod = "WALLET"
	PaymentCard           PaymentMethod = "CARD"
	PaymentTransfer       PaymentMethod = "TRANSFER"
	PaymentPayAtProperty  PaymentMethod = "PAY_AT_PROPERTY"
	PaymentDeposit        PaymentMethod = "DEPOSIT"
)

// Occupancy describes the guests per room for a search/booking.
type Occupancy struct {
	Adults       int   `json:"adults"`
	Children     int   `json:"children"`
	ChildAges    []int `json:"child_ages,omitempty"`
}

// SearchRequest is the normalised search input handed to each adapter.
type SearchRequest struct {
	City      string    `json:"city,omitempty"`
	Lat       float64   `json:"lat,omitempty"`
	Lng       float64   `json:"lng,omitempty"`
	RadiusKm  float64   `json:"radius_km,omitempty"`
	CheckIn   time.Time `json:"check_in"`
	CheckOut  time.Time `json:"check_out"`
	Rooms     int       `json:"rooms"`
	Occupancy Occupancy `json:"occupancy"`
	// Currency is the requested display currency (e.g. "NGN"). Each rate still
	// carries its native currency; conversion is controlled, never silent.
	Currency string `json:"currency"`
	// LoyaltyTier is the guest's Paymax Stays tier for tier-priced markup/discount.
	LoyaltyTier string `json:"loyalty_tier,omitempty"`
}

// RatePlan is the normalised rate-plan view of a bookable offer.
type RatePlan struct {
	SupplierRatePlanRef string         `json:"supplier_rate_plan_ref"`
	Type                RatePlanType   `json:"type"`
	Board               string         `json:"board"` // room-only | breakfast | half-board ...
	Refundable          bool           `json:"refundable"`
	MobileOnly          bool           `json:"mobile_only"`
	// CancellationPolicy is the normalised, snapshot-able policy (free-cancel
	// deadline, penalty schedule, non-ref flag) — captured on the reservation.
	CancellationPolicy map[string]any `json:"cancellation_policy"`
}

// PropertyOffer is one bookable search result: property + room type + rate plan +
// priced total. The supplier_property_ref + rail let the dedup layer map identical
// hotels across rails and pick the lowest bookable total.
type PropertyOffer struct {
	Rail                SourceRail `json:"rail"`
	SupplierCode        string     `json:"supplier_code"`
	SupplierPropertyRef string     `json:"supplier_property_ref"`
	// MappedPropertyID is set by the dedup layer (empty as returned by an adapter).
	MappedPropertyID string `json:"mapped_property_id,omitempty"`
	Name             string `json:"name"`
	City             string `json:"city"`
	Address          string `json:"address"`
	Lat              float64 `json:"lat"`
	Lng              float64 `json:"lng"`
	StarRating       int     `json:"star_rating"`
	PropertyType     string  `json:"property_type"`

	SupplierRoomTypeRef string   `json:"supplier_room_type_ref"`
	RoomName            string   `json:"room_name"`
	RatePlan            RatePlan `json:"rate_plan"`

	// Money — all in minor units of Currency. NetRateKobo is the supplier net rate
	// (Rail A) or the hotel sell rate (Rail B); the pricing engine derives the
	// display total (markup / commission, taxes, FX) above the adapter.
	NetRateKobo int64  `json:"net_rate_kobo"`
	TaxKobo     int64  `json:"tax_kobo"`
	Currency    string `json:"currency"`

	// OfferToken is an ephemeral supplier token tying this priced offer to a prebook
	// (short TTL). It is NOT the book_token (that comes from Prebook).
	OfferToken string    `json:"offer_token,omitempty"`
	ExpiresAt  time.Time `json:"expires_at,omitempty"`
}

// PropertyContent is the normalised content view (descriptions/photos/amenities).
type PropertyContent struct {
	SupplierPropertyRef string         `json:"supplier_property_ref"`
	Name                string         `json:"name"`
	Description         string         `json:"description"`
	Address             string         `json:"address"`
	City                string         `json:"city"`
	Lat                 float64        `json:"lat"`
	Lng                 float64        `json:"lng"`
	StarRating          int            `json:"star_rating"`
	PropertyType        string         `json:"property_type"`
	Amenities           []string       `json:"amenities"`
	Photos              []string       `json:"photos"`
	Extra               map[string]any `json:"extra,omitempty"`
}

// PrebookRequest re-validates one selected offer before money is held.
type PrebookRequest struct {
	Rail                SourceRail `json:"rail"`
	SupplierCode        string     `json:"supplier_code"`
	SupplierPropertyRef string     `json:"supplier_property_ref"`
	SupplierRoomTypeRef string     `json:"supplier_room_type_ref"`
	SupplierRatePlanRef string     `json:"supplier_rate_plan_ref"`
	OfferToken          string     `json:"offer_token"`
	CheckIn             time.Time  `json:"check_in"`
	CheckOut            time.Time  `json:"check_out"`
	Rooms               int        `json:"rooms"`
	Occupancy           Occupancy  `json:"occupancy"`
	Currency            string     `json:"currency"`
}

// PrebookResult is the re-validated price + the short-lived book_token that Book
// must consume. Changed=true means the live price differs from the offer (price
// drift) — the caller re-quotes; SoldOut=true means availability is gone.
type PrebookResult struct {
	BookToken          string         `json:"book_token"`
	NetRateKobo        int64          `json:"net_rate_kobo"`
	TaxKobo            int64          `json:"tax_kobo"`
	Currency           string         `json:"currency"`
	Changed            bool           `json:"changed"`
	SoldOut            bool           `json:"sold_out"`
	CancellationPolicy map[string]any `json:"cancellation_policy"`
	ExpiresAt          time.Time      `json:"expires_at"`
}

// GuestInfo is the lead-guest PII forwarded to the supplier at book time. It is
// shared ONLY after NDPA consent (the consent gate runs before Book).
type GuestInfo struct {
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Email     string `json:"email"`
	Phone     string `json:"phone"`
}

// BookRequest is the normalised, idempotent book input.
type BookRequest struct {
	Rail         SourceRail `json:"rail"`
	SupplierCode string     `json:"supplier_code"`
	// BookToken is the short-lived token from Prebook; Book is idempotent on
	// IdempotencyKey + BookToken — a retry returns the same reservation.
	BookToken      string    `json:"book_token"`
	IdempotencyKey string    `json:"idempotency_key"`
	Guest          GuestInfo `json:"guest"`
	// GuestRef is an opaque Paymax-side reference (NOT the auth user id) so adapters
	// never receive internal user ids.
	GuestRef    string `json:"guest_ref"`
	NetRateKobo int64  `json:"net_rate_kobo"`
	Currency    string `json:"currency"`
}

// ReservationStatus is the supplier-side normalised status token.
type ReservationStatus string

const (
	ResStatusConfirmed ReservationStatus = "confirmed"
	ResStatusFailed    ReservationStatus = "failed"
	ResStatusCancelled ReservationStatus = "cancelled"
)

// Reservation is the normalised supplier reservation view.
type Reservation struct {
	SupplierRef string            `json:"supplier_ref"`
	Status      ReservationStatus `json:"status"`
	NetRateKobo int64             `json:"net_rate_kobo"`
	TaxKobo     int64             `json:"tax_kobo"`
	Currency    string            `json:"currency"`
	// VoucherRef is a supplier-hosted voucher pointer (the service stores the ref
	// and re-signs media on demand; the bytes never travel through the adapter).
	VoucherRef string `json:"voucher_ref"`
}

// CancelRequest cancels a supplier reservation idempotently.
type CancelRequest struct {
	Rail        SourceRail `json:"rail"`
	SupplierCode string    `json:"supplier_code"`
	SupplierRef string     `json:"supplier_ref"`
	Reason      string     `json:"reason"`
	IdempotencyKey string  `json:"idempotency_key"`
}

// Cancellation is the normalised cancellation result, incl. the refund amount the
// policy snapshot allows (computed at the supplier / from policy).
type Cancellation struct {
	SupplierRef     string `json:"supplier_ref"`
	Status          string `json:"status"`
	RefundKobo      int64  `json:"refund_kobo"`
	PenaltyKobo     int64  `json:"penalty_kobo"`
	Currency        string `json:"currency"`
	CancellationRef string `json:"cancellation_ref"`
}

// ModifyRequest re-prices a stay delta (dates/occupancy).
type ModifyRequest struct {
	Rail         SourceRail `json:"rail"`
	SupplierCode string     `json:"supplier_code"`
	SupplierRef  string     `json:"supplier_ref"`
	NewCheckIn   time.Time  `json:"new_check_in"`
	NewCheckOut  time.Time  `json:"new_check_out"`
	NewOccupancy Occupancy  `json:"new_occupancy"`
	IdempotencyKey string   `json:"idempotency_key"`
}

// ARIEvent is a Rail-B availability/rate/restriction push (PRD §28 B). Idempotent
// ingest keyed by ExternalEventID.
type ARIEvent struct {
	SupplierCode    string         `json:"supplier_code"`
	EventType       string         `json:"event_type"` // rate.updated | availability.updated | ...
	ExternalEventID string         `json:"external_event_id"`
	Payload         map[string]any `json:"payload"`
}
