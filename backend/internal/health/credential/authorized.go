package credential

import (
	"context"
	"strings"
	"time"
)

// Authorized is the canonical, point-in-time provider-authorization decision
// (CR-001/002/003/004, EC-007). A provider may perform a capability-gated action
// at `now` only if ALL hold:
//
//   - the verification record is VERIFIED — practice is never authorized before
//     verification completes (CR-001);
//   - the record's capability matches the required capability, case-insensitively
//     (role-correct credential / scope-of-practice — a vet credential cannot act
//     as a doctor). An empty requiredCapability skips this gate (CR-002/004);
//   - the licence is unexpired at `now`. Expiry is checked at the point of USE, so
//     an expired licence is unauthorized immediately — fail-safe even if the
//     periodic RunLicenceSweep has not yet auto-suspended the record (CR-003,
//     EC-007 licence-expires-mid-consult). Expiry is half-open (== now ⇒ expired).
//
// It is pure and unit-tested; callers (prescribe/dispense/consult gates) should
// route their "is this provider allowed" check through it rather than trusting the
// stored status alone.
func Authorized(status Status, capability string, licenceExpiry *time.Time, requiredCapability string, now time.Time) bool {
	if status != StatusVerified {
		return false
	}
	if req := strings.TrimSpace(requiredCapability); req != "" {
		if !strings.EqualFold(strings.TrimSpace(capability), req) {
			return false
		}
	}
	if licenceExpiry != nil && !licenceExpiry.After(now) {
		return false
	}
	return true
}

// IsAuthorized reports whether the provider behind `applicationID` is currently
// authorized to act with `requiredCapability` at `now`. It loads the latest
// verification record and applies the pure Authorized rule (VERIFIED + capability
// match + unexpired). A missing/unreadable record is unauthorized — fail-closed.
// This is the live authorization API callers (prescribe/dispense gates) invoke.
func (s *Service) IsAuthorized(ctx context.Context, applicationID, requiredCapability string, now time.Time) (bool, error) {
	rec, err := s.repo.LatestByApplication(ctx, applicationID)
	if err != nil || rec == nil {
		return false, nil
	}
	return Authorized(rec.Status, rec.Capability, rec.LicenceExpiry, requiredCapability, now), nil
}
