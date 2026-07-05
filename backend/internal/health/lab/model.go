package healthlab

import "time"

// ─── LabOrder state machine (HEALTH-BUILD §5) ───────────────────────────────
//
// LabOrder: CREATED → SCHEDULED → SAMPLE_COLLECTED → IN_TRANSIT → ACCESSIONED
//           → PROCESSING → RESULT_READY → RELEASED → CLOSED
//           RESULT_READY(critical) → ESCALATED → RELEASED
//
// payment (HL-9): HELD on CREATED (escrow.Hold) → RELEASED on RELEASED
// (escrow.Release) → REFUNDED on CANCELLED (escrow.Refund). Every transition is a
// guarded compare-and-set against the DB row + an immutable audit entry (HL-12).
type OrderState string

const (
	StateCreated         OrderState = "CREATED"
	StateScheduled       OrderState = "SCHEDULED"
	StateSampleCollected OrderState = "SAMPLE_COLLECTED"
	StateInTransit       OrderState = "IN_TRANSIT"
	StateAccessioned     OrderState = "ACCESSIONED"
	StateProcessing      OrderState = "PROCESSING"
	StateResultReady     OrderState = "RESULT_READY"
	StateEscalated       OrderState = "ESCALATED"
	StateReleased        OrderState = "RELEASED"
	StateClosed          OrderState = "CLOSED"
	StateCancelled       OrderState = "CANCELLED"
	StateRefunded        OrderState = "REFUNDED"
)

// allowedOrderTransitions encodes the guarded LabOrder state machine. Any
// transition not listed is rejected. Money side effects are bound to specific
// edges in the service (HELD→CREATED, RELEASE on RELEASED, REFUND on CANCELLED) —
// never a raw status write. RESULT_READY may go straight to RELEASED only when no
// critical/abnormal value is present; a critical value forces RESULT_READY →
// ESCALATED → RELEASED so the HL-7 human escalation is never skipped.
var allowedOrderTransitions = map[OrderState]map[OrderState]bool{
	StateCreated:         {StateScheduled: true, StateCancelled: true},
	StateScheduled:       {StateSampleCollected: true, StateCancelled: true},
	StateSampleCollected: {StateInTransit: true, StateAccessioned: true, StateCancelled: true},
	StateInTransit:       {StateAccessioned: true},
	StateAccessioned:     {StateProcessing: true},
	StateProcessing:      {StateResultReady: true},
	StateResultReady:     {StateEscalated: true, StateReleased: true},
	StateEscalated:       {StateReleased: true},
	StateReleased:        {StateClosed: true},
	StateClosed:          {},
	StateCancelled:       {StateRefunded: true},
	StateRefunded:        {},
}

func canTransitionOrder(from, to OrderState) bool {
	next, ok := allowedOrderTransitions[from]
	if !ok {
		return false
	}
	return next[to]
}

// isPreCollection reports whether an order may still be cancelled (HL-9: refund is
// only legal before the sample is in the lab pipeline — once accessioned the chain
// of custody owns the sample). Cancellation is allowed up to SAMPLE_COLLECTED.
func isPreCollection(s OrderState) bool {
	return s == StateCreated || s == StateScheduled || s == StateSampleCollected
}

// ─── Sample / ChainOfCustody state machine (HEALTH-BUILD §5, HL-6) ──────────
//
// Sample/Custody: COLLECTED → IN_CUSTODY → HANDED_OVER → ACCESSIONED
//                 (break detected) → BREACHED → RECOLLECT_REQUIRED
//
// The custody log is immutable (append-only events). Accession requires a sample
// in HANDED_OVER (or COLLECTED for walk-in) with an UNBROKEN chain; a detected
// break flips the sample to BREACHED → RECOLLECT_REQUIRED and no result may be
// produced (HL-6: no result without an unbroken chain).
type SampleState string

const (
	SampleCollected         SampleState = "COLLECTED"
	SampleInCustody         SampleState = "IN_CUSTODY"
	SampleHandedOver        SampleState = "HANDED_OVER"
	SampleAccessioned       SampleState = "ACCESSIONED"
	SampleBreached          SampleState = "BREACHED"
	SampleRecollectRequired SampleState = "RECOLLECT_REQUIRED"
)

var allowedSampleTransitions = map[SampleState]map[SampleState]bool{
	SampleCollected:         {SampleInCustody: true, SampleAccessioned: true, SampleBreached: true},
	SampleInCustody:         {SampleHandedOver: true, SampleAccessioned: true, SampleBreached: true},
	SampleHandedOver:        {SampleAccessioned: true, SampleBreached: true},
	SampleAccessioned:       {},
	SampleBreached:          {SampleRecollectRequired: true},
	SampleRecollectRequired: {},
}

func canTransitionSample(from, to SampleState) bool {
	next, ok := allowedSampleTransitions[from]
	if !ok {
		return false
	}
	return next[to]
}

// chainIntact reports whether a sample state is on the unbroken custody path
// (HL-6). A BREACHED or RECOLLECT_REQUIRED sample can never be accessioned and can
// never yield a result.
func chainIntact(s SampleState) bool {
	return s == SampleCollected || s == SampleInCustody || s == SampleHandedOver || s == SampleAccessioned
}

// CollectionMethod is how the sample is obtained.
type CollectionMethod string

const (
	CollectHome   CollectionMethod = "HOME"    // phlebotomist dispatch on transport rail
	CollectWalkIn CollectionMethod = "WALK_IN" // patient attends the lab
)

// ResultStatus is the clinical flag a scientist assigns at validation (HL-7).
type ResultStatus string

const (
	ResultNormal   ResultStatus = "NORMAL"
	ResultAbnormal ResultStatus = "ABNORMAL"
	ResultCritical ResultStatus = "CRITICAL"
)

// needsEscalation reports whether a validated result demands the HL-7 human
// escalation path (notify patient + clinician) before RELEASED. Critical and
// abnormal values are escalated; never a silent in-app flag.
func needsEscalation(s ResultStatus) bool {
	return s == ResultCritical || s == ResultAbnormal
}

// ─── Catalog ─────────────────────────────────────────────────────────────────

// Test is a single laboratory test in the catalog. prep_instructions and
// tat_hours (turnaround) are surfaced to the patient before booking. price_kobo is
// minor units (NL-8). A test is listed only by a verified MLSCN lab (HL-2).
type Test struct {
	ID            string    `json:"id"`
	LabProviderID string    `json:"lab_provider_id"`
	Code          string    `json:"code"`
	Name          string    `json:"name"`
	Specimen      string    `json:"specimen"`         // e.g. BLOOD, URINE
	PrepInstructions string `json:"prep_instructions"` // e.g. fasting 8h
	TATHours      int       `json:"tat_hours"`        // turnaround time
	RefRange      string    `json:"ref_range"`        // reference range descriptor
	PriceKobo     int64     `json:"price_kobo"`
	Active        bool      `json:"active"`
	CreatedAt     time.Time `json:"created_at"`
}

// Package is a bundle of tests sold at a package price (e.g. a screening panel).
type Package struct {
	ID            string    `json:"id"`
	LabProviderID string    `json:"lab_provider_id"`
	Name          string    `json:"name"`
	Description   string    `json:"description"`
	PrepInstructions string `json:"prep_instructions"`
	TATHours      int       `json:"tat_hours"`
	PriceKobo     int64     `json:"price_kobo"`
	TestIDs       []string  `json:"test_ids"`
	Active        bool      `json:"active"`
	CreatedAt     time.Time `json:"created_at"`
}

// ─── Order + lines ───────────────────────────────────────────────────────────

// Order is a LabOrder. The held money lives in the shared escrow account (HL-9,
// no balance column); EscrowID is the funds-hold reference. CollectionMethod is
// HOME (phlebotomist dispatch) or WALK_IN.
type Order struct {
	ID             string           `json:"id"`
	PatientID      string           `json:"patient_id"`
	LabProviderID  string           `json:"lab_provider_id"`
	State          OrderState       `json:"state"`
	CollectionMethod CollectionMethod `json:"collection_method"`
	TotalKobo      int64            `json:"total_kobo"`
	EscrowID       *string          `json:"escrow_id,omitempty"`
	DeliveryRef    *string          `json:"delivery_ref,omitempty"`   // phlebotomist dispatch / results courier
	ResultRecordID *string          `json:"result_record_id,omitempty"` // vault record id on release (HL-8)
	CancelReason   string           `json:"cancel_reason,omitempty"`
	IdempotencyKey string           `json:"idempotency_key"`
	Lines          []OrderLine      `json:"lines,omitempty"`
	CreatedAt      time.Time        `json:"created_at"`
}

// OrderLine is a requested test (or test within a package), priced in kobo at
// order time so the price is pinned regardless of later catalog changes.
type OrderLine struct {
	ID            string `json:"id"`
	OrderID       string `json:"order_id"`
	TestID        string `json:"test_id"`
	TestName      string `json:"test_name"`
	UnitPriceKobo int64  `json:"unit_price_kobo"`
}

// ─── Sample + custody ────────────────────────────────────────────────────────

// Sample is a specimen collected for a LabOrder. State tracks the chain-of-custody
// position. CustodianID is the current holder (phlebotomist → lab). A BREACHED
// sample forces RECOLLECT_REQUIRED and blocks any result (HL-6).
type Sample struct {
	ID           string      `json:"id"`
	OrderID      string      `json:"order_id"`
	State        SampleState `json:"state"`
	CollectionMethod CollectionMethod `json:"collection_method"`
	CustodianID  *string     `json:"custodian_id,omitempty"`
	BarcodeRef   string      `json:"barcode_ref"`
	CollectedBy  *string     `json:"collected_by,omitempty"`
	CollectedAt  time.Time   `json:"collected_at"`
}

// CustodyEvent is an immutable chain-of-custody log entry (HL-6/HL-12). One row
// per state transition / handover; rows are append-only and never updated.
type CustodyEvent struct {
	ID         string      `json:"id"`
	SampleID   string      `json:"sample_id"`
	FromState  SampleState `json:"from_state"`
	ToState    SampleState `json:"to_state"`
	ActorID    string      `json:"actor_id"`
	FromCustodian *string  `json:"from_custodian,omitempty"`
	ToCustodian   *string  `json:"to_custodian,omitempty"`
	Note       string      `json:"note,omitempty"`
	OccurredAt time.Time   `json:"occurred_at"`
}

// ─── Result ──────────────────────────────────────────────────────────────────

// Result is a scientist-entered, validated test result. Status drives HL-7
// escalation. ValidatedBy is the scientist who validated; ReleasedBy is the
// sign-off scientist (may be the same). The result body is minimised; the
// authoritative copy is written to the records vault on release (HL-8).
type Result struct {
	ID            string       `json:"id"`
	OrderID       string       `json:"order_id"`
	TestID        string       `json:"test_id"`
	TestName      string       `json:"test_name"`
	Value         string       `json:"value"`
	Unit          string       `json:"unit"`
	RefRange      string       `json:"ref_range"`
	Status        ResultStatus `json:"status"`
	ValidatedBy   string       `json:"validated_by"`
	ReleasedBy    *string      `json:"released_by,omitempty"`
	EscalatedAt   *time.Time   `json:"escalated_at,omitempty"`
	ReleasedAt    *time.Time   `json:"released_at,omitempty"`
	CreatedAt     time.Time    `json:"created_at"`
}
