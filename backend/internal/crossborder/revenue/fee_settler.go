package revenue

import (
	"context"
	"fmt"

	"spotlight/backend/internal/crossborder/fees"
)

// FeeSettler adapts a Recognizer to fees.FeeSettler for the daily fee sweep.
// (It lives here because fees cannot import revenue.)
type FeeSettler struct{ r *Recognizer }

var _ fees.FeeSettler = (*FeeSettler)(nil)

// NewFeeSettler wraps r.
func NewFeeSettler(r *Recognizer) *FeeSettler { return &FeeSettler{r: r} }

// PendingFee reports the fee to sweep and whether it is still ACCRUED. A
// SETTLED or REVERSED fee is not pending. The record is rebuilt from the ledger
// on a store miss, so this works after a restart.
func (s *FeeSettler) PendingFee(ctx context.Context, transferID, service string) (int64, bool, error) {
	rec, ok, err := s.r.Record(ctx, transferID, ComponentPlatformFee)
	if err != nil {
		return 0, false, err
	}
	if !ok {
		return 0, false, ErrNotFound
	}
	if rec.Service != service {
		return 0, false, fmt.Errorf("%w: fee service %q != swept service %q", ErrInvalid, rec.Service, service)
	}
	return rec.NGNMinor, rec.State == StateAccrued, nil
}

// SettleFee marks the platform fee SETTLED (fees_unswept drain + NGN commission
// roll-up, both idempotent). sweepRef is the Verto transfer id.
func (s *FeeSettler) SettleFee(ctx context.Context, transferID, _, sweepRef string) error {
	return s.r.MarkSettled(ctx, transferID, ComponentPlatformFee, Settlement{Reference: sweepRef})
}
