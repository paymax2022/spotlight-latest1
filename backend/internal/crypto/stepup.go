package crypto

import (
	"context"
	"errors"
)

// Withdrawal step-up: a customer crypto withdrawal must be authorised by the
// user's transaction PIN, verified on the server before any units are parked or
// fees charged (workplan BR-12; QDX-WDR). The app's OTP screen used to discard
// the code it collected, so the server never saw a second factor at all.
//
// The verifier is the wallet's transaction-PIN service, injected by app wiring
// (WithStepUp) and adapted there onto these errors, so this package does not
// import the transfers module.

var (
	// ErrStepUpRejected: wrong or locked PIN.
	ErrStepUpRejected = errors.New("crypto: transaction PIN rejected")
	// ErrPinNotSet: the user has not created a transaction PIN yet.
	ErrPinNotSet = errors.New("crypto: transaction PIN not set")
)

// StepUpFunc verifies userID's transaction PIN. It returns ErrStepUpRejected or
// ErrPinNotSet for a refusal and any other error for an infrastructure failure.
type StepUpFunc func(ctx context.Context, userID, pin string) error

// WithStepUp wires the withdrawal second factor. Without it, customer
// withdrawals fail closed (503).
func (s *Service) WithStepUp(f StepUpFunc) *Service {
	s.stepUp = f
	return s
}
