package healthpharmacy

import (
	"strings"
	"time"
	"unicode/utf8"
)

// OrderState is the PharmacyOrder lifecycle (HEALTH-BUILD §5):
//
//	CREATED → [RX_PENDING_VERIFICATION] → CONFIRMED → DISPENSED
//	        → IN_DELIVERY | READY_FOR_PICKUP → DELIVERED | COLLECTED → CLOSED
//	(any pre-DISPENSED) → CANCELLED → REFUNDED
//
// payment (HL-9): HELD on CREATED (escrow.Hold) → RELEASED on DELIVERED/COLLECTED
// (escrow.Release) → REFUNDED on CANCELLED (escrow.Refund). Every transition is a
// guarded compare-and-set against the DB row + an immutable audit entry (HL-12).
type OrderState string

const (
	StateCreated        OrderState = "CREATED"
	StateRxPending      OrderState = "RX_PENDING_VERIFICATION"
	StateConfirmed      OrderState = "CONFIRMED"
	StateDispensed      OrderState = "DISPENSED"
	StateInDelivery     OrderState = "IN_DELIVERY"
	StateReadyForPickup OrderState = "READY_FOR_PICKUP"
	StateDelivered      OrderState = "DELIVERED"
	StateCollected      OrderState = "COLLECTED"
	StateClosed         OrderState = "CLOSED"
	StateCancelled      OrderState = "CANCELLED"
	StateRefunded       OrderState = "REFUNDED"
)

// allowedOrderTransitions encodes the guarded PharmacyOrder state machine. Any
// transition not listed is rejected. Money side effects are bound to specific
// edges in the service (HELD→CREATED, RELEASE on DELIVERED/COLLECTED, REFUND on
// CANCELLED) — never a raw status write.
var allowedOrderTransitions = map[OrderState]map[OrderState]bool{
	StateCreated:        {StateRxPending: true, StateConfirmed: true, StateCancelled: true},
	StateRxPending:      {StateConfirmed: true, StateCancelled: true},
	StateConfirmed:      {StateDispensed: true, StateCancelled: true},
	StateDispensed:      {StateInDelivery: true, StateReadyForPickup: true},
	StateInDelivery:     {StateDelivered: true},
	StateReadyForPickup: {StateCollected: true},
	StateDelivered:      {StateClosed: true},
	StateCollected:      {StateClosed: true},
	StateClosed:         {},
	StateCancelled:      {StateRefunded: true},
	StateRefunded:       {},
}

func canTransitionOrder(from, to OrderState) bool {
	next, ok := allowedOrderTransitions[from]
	if !ok {
		return false
	}
	return next[to]
}

// isPreDispense reports whether an order may still be cancelled (HL-9: refund is
// only legal pre-DISPENSED, mirroring the state table).
func isPreDispense(s OrderState) bool {
	return s == StateCreated || s == StateRxPending || s == StateConfirmed
}

// FulfilmentMethod is how the patient receives the medication.
type FulfilmentMethod string

const (
	FulfilDelivery FulfilmentMethod = "DELIVERY"
	FulfilPickup   FulfilmentMethod = "PICKUP"
)

// Product is a NAFDAC-gated catalog item (HL-5). is_controlled is forbidden at
// MVP (HL-4) by a DB CHECK and validated again at write. rx_required (HL-3) is
// config-driven per product; POM items require a verified e-Rx before fulfilment.
type Product struct {
	ID                 string    `json:"id"`
	PharmacyProviderID string    `json:"pharmacy_provider_id"`
	PharmacyName       string    `json:"pharmacy_name"` // owning pharmacy's display name (join)
	Name               string    `json:"name"`
	NAFDACRef          string    `json:"nafdac_ref"` // HL-5: required, registered reference
	NAFDACStatus       string    `json:"nafdac_status"`
	RxRequired         bool      `json:"rx_required"`   // HL-3 config-driven POM flag
	IsControlled       bool      `json:"is_controlled"` // HL-4: must be false at MVP
	PriceKobo          int64     `json:"price_kobo"`
	StockQty           int       `json:"stock_qty"`
	Active             bool      `json:"active"`
	CreatedAt          time.Time `json:"created_at"`
}

// OrderLine is a requested product + quantity, priced in kobo at order time.
type OrderLine struct {
	ID            string `json:"id"`
	OrderID       string `json:"order_id"`
	ProductID     string `json:"product_id"`
	ProductName   string `json:"product_name"`
	RxRequired    bool   `json:"rx_required"`
	Quantity      int    `json:"quantity"`
	UnitPriceKobo int64  `json:"unit_price_kobo"`
	LineTotalKobo int64  `json:"line_total_kobo"`
}

// Order is a PharmacyOrder. The held money lives in the shared escrow account
// (HL-9, no balance column); EscrowID is the funds-hold reference. PrescriptionID
// pins the e-Rx (HL-3) when any line is Rx-required.
type Order struct {
	ID                 string           `json:"id"`
	PatientID          string           `json:"patient_id"`
	PharmacyProviderID string           `json:"pharmacy_provider_id"`
	PrescriptionID     *string          `json:"prescription_id,omitempty"`
	State              OrderState       `json:"state"`
	FulfilmentMethod   FulfilmentMethod `json:"fulfilment_method"`
	TotalKobo          int64            `json:"total_kobo"`
	EscrowID           *string          `json:"escrow_id,omitempty"`
	DeliveryRef        *string          `json:"delivery_ref,omitempty"`    // transport last-mile ref
	PickupCode         *string          `json:"pickup_code,omitempty"`     // pickup QR/code credential
	SearchEventID      *string          `json:"search_event_id,omitempty"` // originating symptom search (PRD §10)
	IdempotencyKey     string           `json:"idempotency_key"`
	Lines              []OrderLine      `json:"lines,omitempty"`
	CreatedAt          time.Time        `json:"created_at"`
}

// DispenseRecord is the immutable record of a pharmacist dispensing an order
// (HL-1 clinical action by the licensed pharmacist; HL-12 audit). dispense-once
// is enforced upstream by healthrx (the e-Rx may be filled only once).
type DispenseRecord struct {
	ID             string    `json:"id"`
	OrderID        string    `json:"order_id"`
	PrescriptionID *string   `json:"prescription_id,omitempty"`
	PharmacistID   string    `json:"pharmacist_id"`
	CreatedAt      time.Time `json:"created_at"`
}

// ─── Multi-pharmacy discovery + ratings (HL-2 gated) ────────────────────────
//
// A customer browses ALL APPROVED + discoverable PHARMACY providers and picks
// one to shop from — by proximity (PostGIS, mirroring the vet vertical's
// DiscoverVets), by rating, or a plain list. PharmacyProfile is the read model
// returned to the client; the underlying storefront row (pharmacy_provider_profiles)
// is optional until the owner sets it or the first review lands, so every field
// here degrades to a safe zero value rather than requiring the row to exist.

// PharmacySort selects the DiscoverPharmacies ranking.
type PharmacySort string

const (
	SortDistance PharmacySort = "distance"
	SortRating   PharmacySort = "rating"
	SortName     PharmacySort = "name"
)

// resolveSort normalises the requested sort against what the query can honor:
// distance sorting requires a lat/lng pair; anything else (or an unrecognised
// value) is left to the caller-visible sort but never silently changed to
// distance without coordinates, and an empty value defaults sensibly.
func resolveSort(hasGeo bool, requested string) PharmacySort {
	s := PharmacySort(strings.ToLower(strings.TrimSpace(requested)))
	switch s {
	case SortDistance:
		if !hasGeo {
			return SortRating // no coordinates — fall back rather than error
		}
		return SortDistance
	case SortRating:
		return SortRating
	case SortName:
		return SortName
	default:
		if hasGeo {
			return SortDistance
		}
		return SortRating
	}
}

// defaultDiscoveryRadiusM is applied when the caller omits/zeroes radius_m.
const defaultDiscoveryRadiusM = 25000.0 // 25km, matches healthvet.DiscoverVets

// discoveryRadius returns a positive radius in meters, applying the default
// when the caller didn't supply one (mirrors healthvet's inline default so the
// two verticals behave identically for callers).
func discoveryRadius(radiusM float64) float64 {
	if radiusM <= 0 {
		return defaultDiscoveryRadiusM
	}
	return radiusM
}

// validRating reports whether r is a legal 1..5 star rating.
func validRating(r int) bool { return r >= 1 && r <= 5 }

// maxReviewBodyLen caps the free-text review body (rune count) to bound storage
// and response size on the public feed and blunt stored-content abuse.
const maxReviewBodyLen = 2000

// normalizeReviewBody trims a review body and reports whether it is within the
// allowed rune length. Returns the trimmed body so callers persist exactly what
// was validated. Rune count (not byte len) so multibyte text is capped fairly.
func normalizeReviewBody(body string) (string, bool) {
	body = strings.TrimSpace(body)
	return body, utf8.RuneCountInString(body) <= maxReviewBodyLen
}

// reviewableStates are the PharmacyOrder states a completed order must be in
// before the patient may leave a review — mirrors isPreDispense's terminal-edge
// reasoning: a review reflects a fulfilled experience, not an in-flight order.
var reviewableStates = map[OrderState]bool{
	StateDelivered: true,
	StateCollected: true,
	StateClosed:    true,
}

func isReviewable(s OrderState) bool { return reviewableStates[s] }

// PharmacyProfile is a discoverable pharmacy (HL-2: APPROVED + discoverable
// PHARMACY health_providers row), enriched with its optional storefront
// profile and rating aggregate. DistanceM is populated only for geo-ranked
// discovery queries (PostGIS ST_Distance), never for the plain list/rating sort.
type PharmacyProfile struct {
	ProviderID       string   `json:"provider_id"`
	DisplayName      string   `json:"display_name"`
	Address          string   `json:"address"`
	Lat              *float64 `json:"lat,omitempty"`
	Lng              *float64 `json:"lng,omitempty"`
	DistanceM        *float64 `json:"distance_m,omitempty"`
	SupportsPickup   bool     `json:"supports_pickup"`
	SupportsDelivery bool     `json:"supports_delivery"`
	DeliveryFeeKobo  int64    `json:"delivery_fee_kobo"`
	AvgRating        float64  `json:"avg_rating"`
	RatingCount      int      `json:"rating_count"`
}

// UpsertPharmacyProfileInput is the owner-editable subset of PharmacyProfile
// (address/fulfilment/fees). Rating fields are never client-writable — they are
// server-computed from pharmacy_reviews only.
type UpsertPharmacyProfileInput struct {
	Address          string `json:"address"`
	SupportsPickup   bool   `json:"supports_pickup"`
	SupportsDelivery bool   `json:"supports_delivery"`
	DeliveryFeeKobo  int64  `json:"delivery_fee_kobo"`
}

// PharmacyReview is a patient's rating of a completed pharmacy order.
type PharmacyReview struct {
	ID                 string    `json:"id"`
	OrderID            string    `json:"order_id"`
	PharmacyProviderID string    `json:"pharmacy_provider_id"`
	PatientID          string    `json:"-"` // HL-8: never serialise the reviewer's identity to other readers
	Rating             int       `json:"rating"`
	Body               string    `json:"body"`
	CreatedAt          time.Time `json:"created_at"`
}

// PharmacyEarnings is the owner's money view for their pharmacies.
//
// Sourced from escrow_holds, not from order workflow states: an order can look
// finished by a path that never released funds (cancelled, refunded), and a
// number shown to a merchant must not be a guess about a lifecycle.
type PharmacyEarnings struct {
	// ReleasedKobo is what has actually reached the owner. escrow.Release credits
	// the payee the FULL held amount — commission is recorded separately in the
	// profit registry, not deducted — so this is exact, not an estimate.
	ReleasedKobo int64 `json:"released_kobo"`
	// HeldKobo is customer money still in escrow: paid, not yet released. The
	// pharmacist's lever on it is completing the order.
	HeldKobo int64 `json:"held_kobo"`
	// OrdersPaid counts released orders, so the figure above can be read per order.
	OrdersPaid int `json:"orders_paid"`
}
