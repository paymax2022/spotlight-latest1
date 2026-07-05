package kycverify

import "errors"

// Domain errors for the KYC verification gateway. The handler maps these to HTTP
// status codes (handler.go). Mirrors the maplerad model.go error vocabulary.
var (
	// ErrForbidden — object-level authz: caller does not own the resource. 403.
	ErrForbidden = errors.New("kycverify: not authorized for this resource")
	// ErrConsentRequired — a check was attempted before consent was recorded. 403.
	ErrConsentRequired = errors.New("kycverify: NDPA/CBN consent required before verification")
	// ErrNoProvider — the routing chain for a check type has no usable provider. 503.
	ErrNoProvider = errors.New("kycverify: no provider available for check type")
	// ErrProviderUnavailable — the gateway/registry is not configured. 503.
	ErrProviderUnavailable = errors.New("kycverify: provider gateway not configured")
	// ErrInvalidTier — target tier outside the 1..3 CBN range. 400.
	ErrInvalidTier = errors.New("kycverify: target tier must be between 1 and 3")
	// ErrNotFound — no session/check row for the lookup. 404.
	ErrNotFound = errors.New("kycverify: not found")
	// ErrIllegalTransition — a guarded state transition was rejected. 409.
	ErrIllegalTransition = errors.New("kycverify: illegal state transition")
	// ErrInvalidRequest — malformed / missing required field. 400.
	ErrInvalidRequest = errors.New("kycverify: invalid request")
)

// ReviewCase is the admin review-queue projection: a session plus its checks.
type ReviewCase struct {
	Session Session `json:"session"`
	Checks  []Check `json:"checks"`
}
