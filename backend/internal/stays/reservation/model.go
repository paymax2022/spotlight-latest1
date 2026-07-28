package reservation

import (
	"time"

	"spotlight/backend/internal/stays/gateway"
)

// State is the guarded booking lifecycle state (PRD §11). Transitions are enforced
// by canTransition; the saga drives them in one direction with optimistic locking.
type State string

const (
	StateSearching     State = "SEARCHING"
	StateOfferSelected State = "OFFER_SELECTED"
	StatePrebookOK     State = "PREBOOK_OK"
	StatePaymentHeld   State = "PAYMENT_HELD"
	StateBooking       State = "BOOKING"
	StateConfirmed     State = "CONFIRMED"
	StateCompleted     State = "COMPLETED"

	StateCancelledByGuest State = "CANCELLED_BY_GUEST"
	StateCancelledByHotel State = "CANCELLED_BY_HOTEL"
	StateNoShow           State = "NO_SHOW"

	StateBookFailed    State = "BOOK_FAILED"    // → release hold (no debit) → VOID
	StatePaymentFailed State = "PAYMENT_FAILED" // → VOID
	StatePrebookFailed State = "PREBOOK_FAILED" // price drift / sold out → re-quote | VOID
	StateVoid          State = "VOID"
)

// transitions encodes the legal forward edges of the state machine. Any edge not
// listed is rejected (fail-closed) by canTransition.
var transitions = map[State]map[State]bool{
	StateSearching:     {StateOfferSelected: true, StateVoid: true},
	StateOfferSelected: {StatePrebookOK: true, StatePrebookFailed: true, StateVoid: true},
	StatePrebookOK:     {StatePaymentHeld: true, StatePaymentFailed: true, StateVoid: true},
	StatePaymentHeld:   {StateBooking: true, StatePaymentFailed: true},
	StateBooking:       {StateConfirmed: true, StateBookFailed: true},
	StateConfirmed: {
		StateCompleted:        true,
		StateCancelledByGuest: true,
		StateCancelledByHotel: true,
		StateNoShow:           true,
	},
	StateCompleted: {}, // terminal (REVIEWABLE is a derived view, not a state)

	StatePrebookFailed: {StateOfferSelected: true, StateVoid: true}, // re-quote | VOID
	StatePaymentFailed: {StateVoid: true},
	StateBookFailed:    {StateVoid: true},
}

// canTransition returns true if from→to is a legal edge.
func canTransition(from, to State) bool {
	edges, ok := transitions[from]
	if !ok {
		return false
	}
	return edges[to]
}

// IsTerminal reports whether a state has no outbound saga transitions.
func (s State) IsTerminal() bool {
	switch s {
	case StateCompleted, StateVoid, StateCancelledByGuest, StateCancelledByHotel, StateNoShow:
		return true
	default:
		return false
	}
}

// Reservation is the durable booking projection. Money columns are kobo (minor
// units); state is the guarded lifecycle; version is the optimistic lock.
type Reservation struct {
	ID                  string                `json:"id"`
	GuestUserID         string                `json:"guest_user_id"`
	PropertyID          string                `json:"property_id"`
	RoomTypeID          string                `json:"room_type_id"`
	RatePlanID          string                `json:"rate_plan_id"`
	SourceRail          gateway.SourceRail    `json:"source_rail"`
	SupplierCode        string                `json:"supplier_code"`
	SupplierRef         *string               `json:"supplier_ref"` // NULL until confirmed
	State               State                 `json:"state"`
	CheckIn             time.Time             `json:"check_in"`
	CheckOut            time.Time             `json:"check_out"`
	Rooms               int                   `json:"rooms"`
	Occupancy           map[string]any        `json:"occupancy"`
	Currency            string                `json:"currency"`
	GrossAmountKobo     int64                 `json:"gross_amount_kobo"`
	TaxAmountKobo       int64                 `json:"tax_amount_kobo"`
	NetRateKobo         int64                 `json:"net_rate_kobo"`
	MarkupKobo          int64                 `json:"markup_kobo"`
	CommissionKobo      int64                 `json:"commission_kobo"`
	PaymentMethod       gateway.PaymentMethod `json:"payment_method"`
	CancellationPolicy  map[string]any        `json:"cancellation_policy_snapshot"`
	IdempotencyKey      string                `json:"idempotency_key"`
	BookTokenRef        *string               `json:"book_token_ref"`
	VoucherRef          *string               `json:"voucher_ref"`
	CreatedAt           time.Time             `json:"created_at"`
	UpdatedAt           time.Time             `json:"updated_at"`
	Version             int                   `json:"version"`
}
