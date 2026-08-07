package healthrx

import (
	"context"
	"fmt"
)

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
