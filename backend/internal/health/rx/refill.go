package healthrx

import (
	"context"
	"errors"
	"fmt"
)

// DP-004 — prescription refills.
//
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
