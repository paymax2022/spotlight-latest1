package connectaml

import "context"

// SanctionsScreener screens a subject against sanctions / PEP lists. This is a
// stub INTERFACE: the real implementation plugs in a provider (e.g. a watchlist
// API) without changing the AML service. The default NoopScreener returns no hit
// so the money path is never blocked by an unconfigured provider — production
// MUST wire a real screener (fail-closed policy is provider-side).
//
// Implementations MUST NOT return or log raw PII; a hit is described by a stable
// list name + match code only.
type SanctionsScreener interface {
	Screen(ctx context.Context, subjectID string) (ScreenResult, error)
}

// NoopScreener is the default stub — always "no hit". Replace in production.
type NoopScreener struct{}

// Screen always returns no hit.
func (NoopScreener) Screen(ctx context.Context, subjectID string) (ScreenResult, error) {
	return ScreenResult{Hit: false}, nil
}
