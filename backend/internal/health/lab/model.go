package healthlab

import (
	"errors"
	"math"
	"spotlight/backend/go-common/fsm"
	"spotlight/backend/internal/health/labref"
	"strings"
	"time"
)

// LabOrder: CREATED → SCHEDULED → SAMPLE_COLLECTED → IN_TRANSIT → ACCESSIONED
//
//	→ PROCESSING → RESULT_READY → RELEASED → CLOSED
//	RESULT_READY(critical) → ESCALATED → RELEASED
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
var allowedOrderTransitions = fsm.Table[OrderState]{
	StateCreated:         fsm.Set(StateScheduled, StateCancelled),
	StateScheduled:       fsm.Set(StateSampleCollected, StateCancelled),
	StateSampleCollected: fsm.Set(StateInTransit, StateAccessioned, StateCancelled),
	StateInTransit:       fsm.Set(StateAccessioned),
	StateAccessioned:     fsm.Set(StateProcessing),
	StateProcessing:      fsm.Set(StateResultReady),
	StateResultReady:     fsm.Set(StateEscalated, StateReleased),
	StateEscalated:       fsm.Set(StateReleased),
	StateReleased:        fsm.Set(StateClosed),
	StateClosed:          fsm.Set[OrderState](),
	StateCancelled:       fsm.Set(StateRefunded),
	StateRefunded:        fsm.Set[OrderState](),
}

func canTransitionOrder(from, to OrderState) bool {
	return allowedOrderTransitions.Can(from, to)
}

// isPreCollection reports whether an order may still be cancelled (HL-9: refund is
// only legal before the sample is in the lab pipeline — once accessioned the chain
// of custody owns the sample). Cancellation is allowed up to SAMPLE_COLLECTED.
func isPreCollection(s OrderState) bool {
	return s == StateCreated || s == StateScheduled || s == StateSampleCollected
}

// Sample/Custody: COLLECTED → IN_CUSTODY → HANDED_OVER → ACCESSIONED
//
//	(break detected) → BREACHED → RECOLLECT_REQUIRED
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

var allowedSampleTransitions = fsm.Table[SampleState]{
	// SampleHandedOver missing here would make Handover() unreachable from
	// its own documented starting state — Handover's switch treats
	// SampleCollected as valid (the phlebotomist → courier handoff, per the
	// package's own "phlebotomist → courier → lab" doc comment), but without
	// this edge canTransitionSample rejects every such call with "illegal
	// sample transition COLLECTED -> HANDED_OVER" regardless of caller.
	SampleCollected:         fsm.Set(SampleInCustody, SampleHandedOver, SampleAccessioned, SampleBreached),
	SampleInCustody:         fsm.Set(SampleHandedOver, SampleAccessioned, SampleBreached),
	SampleHandedOver:        fsm.Set(SampleAccessioned, SampleBreached),
	SampleAccessioned:       fsm.Set[SampleState](),
	SampleBreached:          fsm.Set(SampleRecollectRequired),
	SampleRecollectRequired: fsm.Set[SampleState](),
}

func canTransitionSample(from, to SampleState) bool {
	return allowedSampleTransitions.Can(from, to)
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

// Test is a single laboratory test in the catalog. prep_instructions and
// tat_hours (turnaround) are surfaced to the patient before booking. price_kobo is
// minor units (NL-8). A test is listed only by a verified MLSCN lab (HL-2).
type Test struct {
	ID               string    `json:"id"`
	LabProviderID    string    `json:"lab_provider_id"`
	Code             string    `json:"code"`
	Name             string    `json:"name"`
	Specimen         string    `json:"specimen"`          // e.g. BLOOD, URINE
	PrepInstructions string    `json:"prep_instructions"` // e.g. fasting 8h
	TATHours         int       `json:"tat_hours"`         // turnaround time
	RefRange         string    `json:"ref_range"`         // reference range descriptor
	PriceKobo        int64     `json:"price_kobo"`
	Active           bool      `json:"active"`
	CreatedAt        time.Time `json:"created_at"`
}

// Package is a bundle of tests sold at a package price (e.g. a screening panel).
type Package struct {
	ID               string    `json:"id"`
	LabProviderID    string    `json:"lab_provider_id"`
	Name             string    `json:"name"`
	Description      string    `json:"description"`
	PrepInstructions string    `json:"prep_instructions"`
	TATHours         int       `json:"tat_hours"`
	PriceKobo        int64     `json:"price_kobo"`
	TestIDs          []string  `json:"test_ids"`
	Active           bool      `json:"active"`
	CreatedAt        time.Time `json:"created_at"`
}

// Order is a LabOrder. The held money lives in the shared escrow account (HL-9,
// no balance column); EscrowID is the funds-hold reference. CollectionMethod is
// HOME (phlebotomist dispatch) or WALK_IN.
type Order struct {
	ID               string           `json:"id"`
	PatientID        string           `json:"patient_id"`
	LabProviderID    string           `json:"lab_provider_id"`
	State            OrderState       `json:"state"`
	CollectionMethod CollectionMethod `json:"collection_method"`
	TotalKobo        int64            `json:"total_kobo"`
	EscrowID         *string          `json:"escrow_id,omitempty"`
	DeliveryRef      *string          `json:"delivery_ref,omitempty"`     // phlebotomist dispatch / results courier
	ResultRecordID   *string          `json:"result_record_id,omitempty"` // vault record id on release (HL-8)
	CancelReason     string           `json:"cancel_reason,omitempty"`
	IdempotencyKey   string           `json:"idempotency_key"`
	Lines            []OrderLine      `json:"lines,omitempty"`
	CreatedAt        time.Time        `json:"created_at"`
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

// ProviderOrderSummary is the lab-staff order-list row (Service.ListProviderOrders)
// — an enriched, owner-scoped view distinct from the raw admin oversight rows
// AdminListOrders returns.
type ProviderOrderSummary struct {
	ID               string           `json:"id"`
	PatientID        string           `json:"patient_id"`
	State            OrderState       `json:"state"`
	CollectionMethod CollectionMethod `json:"collection_method"`
	CreatedAt        time.Time        `json:"created_at"`
	SampleBarcode    *string          `json:"sample_barcode,omitempty"`
	TestNames        []string         `json:"test_names"`
	HasCritical      bool             `json:"has_critical"`
}

// Sample is a specimen collected for a LabOrder. State tracks the chain-of-custody
// position. CustodianID is the current holder (phlebotomist → lab). A BREACHED
// sample forces RECOLLECT_REQUIRED and blocks any result (HL-6).
type Sample struct {
	ID               string           `json:"id"`
	OrderID          string           `json:"order_id"`
	State            SampleState      `json:"state"`
	CollectionMethod CollectionMethod `json:"collection_method"`
	CustodianID      *string          `json:"custodian_id,omitempty"`
	BarcodeRef       string           `json:"barcode_ref"`
	CollectedBy      *string          `json:"collected_by,omitempty"`
	CollectedAt      time.Time        `json:"collected_at"`
}

// CustodyEvent is an immutable chain-of-custody log entry (HL-6/HL-12). One row
// per state transition / handover; rows are append-only and never updated.
type CustodyEvent struct {
	ID            string      `json:"id"`
	SampleID      string      `json:"sample_id"`
	FromState     SampleState `json:"from_state"`
	ToState       SampleState `json:"to_state"`
	ActorID       string      `json:"actor_id"`
	FromCustodian *string     `json:"from_custodian,omitempty"`
	ToCustodian   *string     `json:"to_custodian,omitempty"`
	Note          string      `json:"note,omitempty"`
	OccurredAt    time.Time   `json:"occurred_at"`
}

// Result is a scientist-entered, validated test result. Status drives HL-7
// escalation. ValidatedBy is the scientist who validated; ReleasedBy is the
// sign-off scientist (may be the same). The result body is minimised; the
// authoritative copy is written to the records vault on release (HL-8).
type Result struct {
	ID          string       `json:"id"`
	OrderID     string       `json:"order_id"`
	TestID      string       `json:"test_id"`
	TestName    string       `json:"test_name"`
	Value       string       `json:"value"`
	Unit        string       `json:"unit"`
	RefRange    string       `json:"ref_range"`
	Status      ResultStatus `json:"status"`
	ValidatedBy string       `json:"validated_by"`
	ReleasedBy  *string      `json:"released_by,omitempty"`
	EscalatedAt *time.Time   `json:"escalated_at,omitempty"`
	ReleasedAt  *time.Time   `json:"released_at,omitempty"`
	CreatedAt   time.Time    `json:"created_at"`
	// LR-006 versioned amendment. Version is 1 for an original result; a corrected
	// re-issue is version+1 and the prior row is retained (superseded). loadResults
	// returns only the current (non-superseded) version, so callers see the latest.
	Version         int        `json:"version"`
	AmendedBy       *string    `json:"amended_by,omitempty"`
	AmendedAt       *time.Time `json:"amended_at,omitempty"`
	AmendmentReason string     `json:"amendment_reason,omitempty"`
}

// canReleaseFrom reports whether an order in `state` may be signed off and released
// (LR-004). Only a validated RESULT_READY order, or one already ESCALATED (critical
// values surfaced for human review), can proceed — so a result is never released
// before an authorized scientist has entered and validated it, and a released order
// is never re-released. This mirrors the guarded order state machine
// (allowedOrderTransitions); Release also requires a verified scientist (HL-2) and
// stamps released_by for attribution.
func canReleaseFrom(state OrderState) bool {
	return state == StateResultReady || state == StateEscalated
}

// Payment/cart money errors (TS-13). Amounts are integer minor units (kobo) — no
// floats anywhere on the money path.
var (
	ErrNegativeLinePrice = errors.New("lab: line price must not be negative")
	ErrTotalOverflow     = errors.New("lab: order total overflows")
)

// sumLineKobo sums integer minor-unit (kobo) line prices exactly (PM-008/PM-011:
// cart totals are exact with no drift). It rejects a negative line price (which
// could silently offset the total) and guards against int64 overflow (no
// wrap-around). The catalog is the source of prices; this is the server-side total.
func sumLineKobo(prices []int64) (int64, error) {
	var total int64
	for _, p := range prices {
		if p < 0 {
			return 0, ErrNegativeLinePrice
		}
		if total > math.MaxInt64-p {
			return 0, ErrTotalOverflow
		}
		total += p
	}
	return total, nil
}

// ErrBarcodeMismatch signals a scanned barcode that does not match the sample's
// minted barcode on record — a possible tube swap or mislabel (EC-001/LB-005).
// Accessioning and result entry reject it: no result on an unverified
// sample↔patient bond (§4.3 "right patient, right result").
var ErrBarcodeMismatch = errors.New("lab: scanned barcode does not match the sample on record (possible mix-up) — recollection/verification required")

// ErrOrderNotFound is the not-found sentinel for lab_orders. Handlers map it to
// a uniform 404.
var ErrOrderNotFound = errors.New("lab: order not found")

// ErrIdemConflict refuses an Idempotency-Key already bound to an order owned by
// a DIFFERENT patient. Replaying a foreign key must fail closed here, before
// escrow.Hold — the hold rail dedups on the bare key, and a replay must never
// resolve a stranger's order (escrow id, totals, state).
var ErrIdemConflict = errors.New("lab: idempotency key already used")

// normalizeBarcode canonicalizes a barcode for comparison (case + surrounding
// whitespace only; internal characters are significant).
func normalizeBarcode(b string) string { return strings.ToUpper(strings.TrimSpace(b)) }

// verifyBarcodeScan checks a scanned barcode against the sample's minted barcode.
// An empty scan means the step did not scan (backward-compatible for flows that
// don't) and passes; a non-empty scan MUST match the recorded barcode exactly
// (after normalization), else ErrBarcodeMismatch. A scan against a sample that has
// no recorded barcode is a mismatch — there is nothing to bind against.
func verifyBarcodeScan(scanned, expected string) error {
	if strings.TrimSpace(scanned) == "" {
		return nil
	}
	if normalizeBarcode(scanned) != normalizeBarcode(expected) {
		return ErrBarcodeMismatch
	}
	return nil
}

// authorizeOrderAccess is the pure object-level read decision for a lab order and
// its results/custody (LR-010, §4.6). Fail-closed: an empty requester is never
// authorized (guards the empty-requester/empty-owner fail-open); otherwise the
// data-subject patient, the owning lab, or an admin may read — everyone else is
// denied (cross-patient IDOR).
func authorizeOrderAccess(requesterID, patientID, labOwner string, isAdmin bool) bool {
	if strings.TrimSpace(requesterID) == "" {
		return false
	}
	if isAdmin {
		return true
	}
	return requesterID == patientID || (labOwner != "" && requesterID == labOwner)
}

// statusRank orders result severity for the never-downgrade backstop.
func statusRank(s ResultStatus) int {
	switch s {
	case ResultCritical:
		return 2
	case ResultAbnormal:
		return 1
	default:
		return 0
	}
}

func labrefToStatus(s labref.Status) (ResultStatus, bool) {
	switch s {
	case labref.StatusCritical:
		return ResultCritical, true
	case labref.StatusAbnormal:
		return ResultAbnormal, true
	case labref.StatusNormal:
		return ResultNormal, true
	default: // UNKNOWN — cannot machine-interpret; keep the entered status
		return "", false
	}
}

// deriveEffectiveStatus is the fail-safe result backstop (LR-002/003, §4.4/§4.12).
// It runs the pure labref interpreter over the entered value/unit/reference range
// and:
//   - NEVER downgrades the scientist's manual status, and
//   - UPGRADES it when the engine derives a more severe interpretation (e.g. a
//     panic potassium entered as NORMAL becomes CRITICAL) — so a critical value
//     can never be silently released without the HL-7 escalation path.
//
// It also reports a unit mismatch (mg/dL vs mmol/L transposition) so EnterResults
// can reject the line (LR-008/EC-002) rather than interpret a wrong-unit value.
func deriveEffectiveStatus(entered ResultStatus, analyte, value, unit, refRange string) (ResultStatus, bool) {
	var effective ResultStatus

	interp := labref.Interpret(analyte, value, unit, refRange)
	effective = entered
	if derived, ok := labrefToStatus(interp.Status); ok && statusRank(derived) > statusRank(entered) {
		effective = derived
	}
	return effective, interp.UnitMismatch
}
