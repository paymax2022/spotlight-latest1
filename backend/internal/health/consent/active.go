package healthconsent

import "time"

// grantActive is the canonical rule for whether a consent grant currently permits
// a read of `wantScope` at `now`. It is the single source of truth enforced by
// HasActiveGrant (HL-8 cross-vertical gate):
//
//   - the grant must be ACTIVE — a REVOKED grant never permits access, so
//     withdrawal stops further sharing immediately (AC-008);
//   - the grant's scope must cover the requested scope (exact match, or the
//     catch-all "ALL") — a narrower grant cannot be escalated (AC-004);
//   - the grant must be unexpired — expiry is half-open, so a grant expiring
//     exactly at `now` no longer permits access (AC-004).
func grantActive(state, grantScope string, expiresAt *time.Time, wantScope string, now time.Time) bool {
	if state != "ACTIVE" {
		return false
	}
	if grantScope != wantScope && grantScope != "ALL" {
		return false
	}
	if expiresAt != nil && !expiresAt.After(now) {
		return false
	}
	return true
}
