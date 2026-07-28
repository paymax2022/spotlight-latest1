package domain

import (
	"testing"
	"time"
)

// The domain package is almost entirely inert struct definitions (AuthenticatedUser,
// Role, Permission, UserScope, Lead, AdminUser, ...). The single piece of real
// behavior is Session.Active, a usability predicate over revocation + expiry.
func TestSession_Active(t *testing.T) {
	now := time.Date(2026, time.July, 27, 12, 0, 0, 0, time.UTC)
	revoked := now.Add(-time.Hour)

	cases := []struct {
		name    string
		session Session
		want    bool
	}{
		{
			name:    "not revoked and expires in the future is active",
			session: Session{ExpiresAt: now.Add(time.Hour)},
			want:    true,
		},
		{
			name:    "expired session is inactive",
			session: Session{ExpiresAt: now.Add(-time.Hour)},
			want:    false,
		},
		{
			name:    "expiry exactly at now is inactive (strict After)",
			session: Session{ExpiresAt: now},
			want:    false,
		},
		{
			name:    "revoked session is inactive even if not yet expired",
			session: Session{ExpiresAt: now.Add(time.Hour), RevokedAt: &revoked},
			want:    false,
		},
		{
			name:    "revoked and expired is inactive",
			session: Session{ExpiresAt: now.Add(-time.Hour), RevokedAt: &revoked},
			want:    false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.session.Active(now); got != tc.want {
				t.Fatalf("Active(%v) = %v, want %v", now, got, tc.want)
			}
		})
	}
}

// A revoked-at pointer being nil is the load-bearing distinction between the
// active and revoked branches; pin that a distinct future revocation instant
// still deactivates regardless of its value.
func TestSession_Active_RevokedPointerGovernsRegardlessOfInstant(t *testing.T) {
	now := time.Date(2026, time.July, 27, 12, 0, 0, 0, time.UTC)
	future := now.Add(24 * time.Hour)

	s := Session{ExpiresAt: now.Add(time.Hour), RevokedAt: &future}
	if s.Active(now) {
		t.Fatalf("session with non-nil RevokedAt must be inactive, got active")
	}
}
