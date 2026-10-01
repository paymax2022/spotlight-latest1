package healthrx

import (
	"context"
	"errors"
	"fmt"
	"spotlight/backend/internal/health/clinicalsafety"
	"strings"
)

// ClinicalContextProvider supplies the patient's clinical context (allergies,
// current meds, weight) for the pre-issue safety screen. It is the seam a real
// EHR/health-profile source implements; when nil the human safety screen has no
// data to check against (vet callers pass context explicitly). Injected via
// WithClinicalContext so existing constructors are unchanged.
type ClinicalContextProvider interface {
	ClinicalContext(ctx context.Context, patientID string) (clinicalsafety.PatientContext, bool, error)
}

// WithClinicalContext wires the human clinical-context source. Returns the
// service for chaining.
func (s *Service) WithClinicalContext(p ClinicalContextProvider) *Service {
	s.clinical = p
	return s
}

// SafetyBlockError is returned when a prescription hits one or more hard-stop
// safety findings and no documented override reason was supplied (RX-002/011).
type SafetyBlockError struct {
	Findings []clinicalsafety.Finding
}

func (e *SafetyBlockError) Error() string {
	parts := make([]string, 0, len(e.Findings))
	for _, f := range e.Findings {
		parts = append(parts, string(f.Kind)+": "+f.Message)
	}
	return "rx: blocked by clinical safety check (" + strings.Join(parts, "; ") + ")"
}

// toSafetyItems maps prescription items to the engine's item shape. Dose is not
// structured on Item (free-text dosage), so mg-based dose checks are skipped here;
// the name-based allergy/interaction/duplicate/species hard-stops still apply.
func toSafetyItems(items []Item) []clinicalsafety.RxItem {
	out := make([]clinicalsafety.RxItem, 0, len(items))
	for _, it := range items {
		out = append(out, clinicalsafety.RxItem{DrugName: it.DrugName, DoseMg: it.DoseMg, Quantity: it.Quantity})
	}
	return out
}

// screenRx runs the clinical safety engine and enforces the hard-stop/override
// policy. It is pure (no I/O) and deterministic: it returns the engine result and,
// when the prescription is blocked and no override reason is given, a
// *SafetyBlockError. A non-empty overrideReason lets a licensed prescriber proceed
// past hard stops (the caller MUST audit the reason — RX-011).
func screenRx(pc clinicalsafety.PatientContext, items []Item, overrideReason string) (clinicalsafety.Result, error) {
	res := clinicalsafety.Check(pc, toSafetyItems(items))
	if res.Blocked && strings.TrimSpace(overrideReason) == "" {
		return res, &SafetyBlockError{Findings: res.HardStops()}
	}
	return res, nil
}

// safetyAudit builds the audit metadata for an issued Rx, recording the safety
// outcome so every override is attributable (RX-011 / §4.8).
func safetyAudit(res clinicalsafety.Result, overrideReason string) map[string]any {
	m := map[string]any{"safety_findings": len(res.Findings), "safety_blocked": res.Blocked}
	if res.Blocked && strings.TrimSpace(overrideReason) != "" {
		m["safety_override_reason"] = overrideReason
		m["safety_override_count"] = len(res.HardStops())
	}
	return m
}

// PrescriberAuthorizer is the injection seam for scope-of-practice enforcement at
// the prescribe boundary (CR-004): it reports whether a prescriber may issue
// prescriptions right now (a VERIFIED, capability-matched, unexpired prescriber
// credential). Backed in production by the credential service's authorization API;
// nil disables the check (existing callers/tests unaffected). This is
// defense-in-depth on top of route-level RBAC and the vet/doctor caller gates.
type PrescriberAuthorizer interface {
	IsAuthorizedPrescriber(ctx context.Context, prescriberID string) (bool, error)
}

// WithPrescriberAuthorizer wires the scope-of-practice gate. Returns the service
// for chaining.
func (s *Service) WithPrescriberAuthorizer(a PrescriberAuthorizer) *Service {
	s.prescriberAuth = a
	return s
}

// UnauthorizedPrescriberError is returned when a prescriber is not currently
// authorized to prescribe (unverified, wrong capability, or expired licence).
type UnauthorizedPrescriberError struct{ PrescriberID string }

func (e *UnauthorizedPrescriberError) Error() string {
	return "rx: prescriber " + e.PrescriberID + " is not authorized to prescribe (scope-of-practice / licence)"
}

// authorizePrescriber runs the scope-of-practice gate fail-closed: an unauthorized
// prescriber, or a lookup error, blocks issuance. A nil authorizer is a no-op (the
// caller relies on route RBAC + the vet/doctor gates). Pure w.r.t. the injected
// seam, so it is unit-tested with a fake authorizer.
func authorizePrescriber(ctx context.Context, a PrescriberAuthorizer, prescriberID string) error {
	if a == nil {
		return nil
	}
	ok, err := a.IsAuthorizedPrescriber(ctx, prescriberID)
	if err != nil {
		return fmt.Errorf("rx: could not verify prescriber authorization: %w", err)
	}
	if !ok {
		return &UnauthorizedPrescriberError{PrescriberID: prescriberID}
	}
	return nil
}

// DP-004 — prescription refills.
// A prescriber may authorize a number of refills on a prescription; the medication
// may then be dispensed that many additional times beyond the initial fill, and no
// more. Refills are modeled as a SEPARATE counter (refills_used vs
// refills_authorized) that leaves the HL-3 dispense-once path fully intact: the
// initial Dispense (VERIFIED→DISPENSED, backed by the partial UNIQUE index) is
// unchanged and always happens exactly once; refills are additional fills that only
// become available AFTER that initial dispense.

var (
	// ErrRefillsExhausted — no authorized refills remain (DP-004: blocked after count).
	ErrRefillsExhausted = errors.New("rx: no refills remaining on this prescription (DP-004)")
	// ErrRefillCountRange — an authorized-refill count outside the allowed range.
	ErrRefillCountRange = errors.New("rx: refills authorized must be between 0 and the maximum")
	// ErrNotYetDispensed — a refill was requested before the initial fill.
	ErrNotYetDispensed = errors.New("rx: prescription must be dispensed once before it can be refilled")
	// ErrRefillsLocked — refills can only be (re)authorized before the first dispense.
	ErrRefillsLocked = errors.New("rx: refills can only be authorized before the prescription is dispensed")
)

// maxRefillsAuthorized bounds authorized refills — chronic-medication refill counts
// are single digits to low tens; the bound keeps the value sane and the counter
// arithmetic trivially safe.
const maxRefillsAuthorized = 24

// validRefillCount reports whether n is an acceptable authorized-refill count.
func validRefillCount(n int) bool { return n >= 0 && n <= maxRefillsAuthorized }

// canRefill reports whether another refill may be dispensed: a refill is allowed
// while the number already used is below the number authorized. The initial fill is
// NOT counted as a refill — refills are the additional fills authorized beyond it.
func canRefill(refillsUsed, refillsAuthorized int) bool {
	return refillsUsed < refillsAuthorized
}

// refillsRemaining is the number of refills still available (never negative).
func refillsRemaining(refillsUsed, refillsAuthorized int) int {
	if refillsUsed >= refillsAuthorized {
		return 0
	}
	return refillsAuthorized - refillsUsed
}

// AuthorizeRefills sets the number of refills a prescriber grants on a prescription
// (DP-004). Prescriber-only, count within range, and only before the prescription is
// dispensed — once dispensing has begun the authorized count is locked so it cannot
// be widened mid-fill. Additive to the issue flow: prescriptions default to 0
// refills, and this is the explicit authorization step.
func (s *Service) AuthorizeRefills(ctx context.Context, prescriberID, rxID string, count int) (*Prescription, error) {
	if !validRefillCount(count) {
		return nil, ErrRefillCountRange
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("rx: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var owner, state string
	if err := tx.QueryRow(ctx, `SELECT prescriber_id, state FROM health_prescriptions WHERE id=$1 FOR UPDATE`, rxID).
		Scan(&owner, &state); err != nil {
		return nil, fmt.Errorf("rx: not found")
	}
	if prescriberID != owner {
		return nil, fmt.Errorf("rx: only the prescriber may authorize refills")
	}
	if st := State(state); st == StateDispensed || st == StateFulfilled {
		return nil, ErrRefillsLocked
	}
	if _, err := tx.Exec(ctx, `UPDATE health_prescriptions SET refills_authorized=$2, updated_at=now() WHERE id=$1`, rxID, count); err != nil {
		return nil, fmt.Errorf("rx: set refills: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("rx: commit: %w", err)
	}
	s.audited(prescriberID, "", "health.rx.refills.authorize", rxID, nil, map[string]any{"refills_authorized": count})
	return s.load(ctx, rxID)
}

// DispenseRefill dispenses one refill of an already-dispensed prescription (DP-004),
// distinct from the initial Dispense so the dispense-once invariant is untouched. It
// requires the initial fill to have happened (state DISPENSED/FULFILLED), enforces
// POM verification (HL-3), and blocks with ErrRefillsExhausted once the authorized
// refills are used up. The count check + increment are one atomic FOR UPDATE tx so
// concurrent refills can never overshoot the authorized number.
func (s *Service) DispenseRefill(ctx context.Context, pharmacistID, rxID string) (*Prescription, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("rx: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var state string
	var verifiedBy *string
	var refillsUsed, refillsAuthorized int
	var hasPOM bool
	const q = `SELECT state, verified_by, refills_used, refills_authorized,
	                  EXISTS (SELECT 1 FROM health_prescription_items i WHERE i.prescription_id=health_prescriptions.id AND i.is_pom)
	           FROM health_prescriptions WHERE id=$1 FOR UPDATE`
	if err := tx.QueryRow(ctx, q, rxID).Scan(&state, &verifiedBy, &refillsUsed, &refillsAuthorized, &hasPOM); err != nil {
		return nil, fmt.Errorf("rx: not found")
	}
	if st := State(state); st != StateDispensed && st != StateFulfilled {
		return nil, ErrNotYetDispensed
	}
	if hasPOM && verifiedBy == nil {
		return nil, fmt.Errorf("rx: POM items require pharmacist verification before dispense (HL-3)")
	}
	if !canRefill(refillsUsed, refillsAuthorized) {
		return nil, ErrRefillsExhausted
	}
	if _, err := tx.Exec(ctx, `UPDATE health_prescriptions SET refills_used=refills_used+1, dispensed_at=now(), updated_at=now() WHERE id=$1`, rxID); err != nil {
		return nil, fmt.Errorf("rx: record refill: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("rx: commit: %w", err)
	}
	s.audited(pharmacistID, "", "health.rx.refill", rxID,
		map[string]any{"refills_used": refillsUsed},
		map[string]any{"refills_used": refillsUsed + 1, "refills_authorized": refillsAuthorized})
	return s.load(ctx, rxID)
}
