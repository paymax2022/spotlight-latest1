package embedded

// State is the embedded-binding engine state (PRD §10.3).
//
//	EVENT_RECEIVED → COVER_RESOLVED → PREMIUM_HELD → BINDING → ACTIVE
//	        │              │               │             └─ FAILED → release → UNCOVERED
//	        │              │               └─ INSUFFICIENT_FUNDS → UNCOVERED (offer top-up)
//	        └─ NO_MAPPING (no-op, log)
//
// The engine is IDEMPOTENT on source_event_id — a replayed platform event never
// double-binds (enforced by uq_insurance_policy_source_event + a pre-check).
type State string

const (
	StateEventReceived     State = "EVENT_RECEIVED"
	StateCoverResolved     State = "COVER_RESOLVED"
	StatePremiumHeld       State = "PREMIUM_HELD"
	StateBinding           State = "BINDING"
	StateActive            State = "ACTIVE"
	StateFailed            State = "FAILED"
	StateUncovered         State = "UNCOVERED"
	StateNoMapping         State = "NO_MAPPING"
	StateInsufficientFunds State = "INSUFFICIENT_FUNDS"
)

// EmbeddedEvent is a normalised platform lifecycle event that may trigger an
// embedded bind. SourceEventID is the platform's unique event id and is the
// idempotency key for the whole bind. ProductLine resolves the cover via the
// catalog (data-driven routing — no event→product branching in code beyond the
// well-known mapping table).
type EmbeddedEvent struct {
	// SourceEventID is the globally-unique platform event id. A replayed event
	// with the same id is a safe no-op (never double-binds).
	SourceEventID string `json:"source_event_id"`
	// EventType is the platform event name, e.g. "trip.started", "loan.disbursed".
	EventType string `json:"event_type"`
	// UserID is the policyholder the cover binds for.
	UserID string `json:"user_id"`
	// SumInsuredKobo is an optional declared cover amount (e.g. parcel value); 0
	// lets the product's sum_insured_rules drive it.
	SumInsuredKobo int64 `json:"sum_insured_kobo"`
	// Inputs are product-specific, schema-minimised fields (trip_id, imei, ...).
	Inputs map[string]any `json:"inputs"`
}

// Result is the outcome of handling an embedded event.
type Result struct {
	State       State  `json:"state"`
	PolicyID    string `json:"policy_id,omitempty"`
	ProductCode string `json:"product_code,omitempty"`
	Provider    string `json:"provider,omitempty"`
	Reason      string `json:"reason,omitempty"`
	// Replayed is true when the event was already processed (idempotent no-op).
	Replayed bool `json:"replayed,omitempty"`
}

// eventProductLine maps a platform event type to the catalog product_line whose
// active product carries the cover. This is the §13/§B embedded event catalog
// (PRD lines 347-355). The actual provider + product code are resolved from the
// catalog (single source of truth) — this table only names the line.
//
//	trip.started            -> transport  (Octamile passenger/rider)
//	parcel.booked           -> logistics  (Octamile GIT per-shipment)
//	bus.seat_booked         -> transport  (Octamile passenger)
//	consignment.created     -> logistics  (Octamile haulage/GIT)
//	loan.disbursed          -> credit-life (MyCover credit-life)
//	device.purchased        -> device     (MyCover device cover)
//	wallet.funded           -> wallet     (MyCover wallet insurance)
//	spotlight.event_created -> spotlight-event (MyCover event cover)
//	contestant.enrolled     -> spotlight-contestant (MyCover contestant cover)
var eventProductLine = map[string]string{
	"trip.started":            "transport",
	"parcel.booked":           "logistics",
	"bus.seat_booked":         "transport",
	"consignment.created":     "logistics",
	"loan.disbursed":          "credit-life",
	"device.purchased":        "device",
	"wallet.funded":           "wallet",
	"spotlight.event_created": "spotlight-event",
	"contestant.enrolled":     "spotlight-contestant",
}
