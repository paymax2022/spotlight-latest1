package healthconsent

import (
	"context"
	"strings"
	"testing"
)

// P0 regression (wave-6 prod probe): POST /health/consent accepted a caller-
// supplied subject_owner_id naming SOMEONE ELSE, minting a consent row that
// HasActiveGrant then honoured — a self-forged grant over a victim's records
// (IDOR on PHI). The guard must fire BEFORE the INSERT, so a nil pool proves
// ordering: reaching db.Exec on a nil pool panics rather than returning.
func TestGrantRejectsForgedSubjectOwner(t *testing.T) {
	svc := NewService(nil, nil)
	if _, err := svc.Grant(context.Background(), "attacker", "attacker", "victim", "RECORDS", nil); err == nil {
		t.Fatal("subject_owner_id naming someone other than the grantor must be rejected")
	}
}

// The legitimate shapes — empty subject (defaults to grantor) and an explicit
// self-subject — must NOT hit the forge guard. They proceed to the INSERT,
// which on a nil pool panics; recover distinguishes "reached the write"
// (correct) from "guard rejected" (regression).
func TestGrantAllowsSelfSubject(t *testing.T) {
	svc := NewService(nil, nil)
	for _, tc := range []struct{ name, subject string }{
		{"empty subject defaults to grantor", ""},
		{"explicit self-subject", "me"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				r := recover()
				if r == nil {
					t.Fatalf("%s: expected the write path to be reached (nil-pool panic proves ordering), got clean return", tc.name)
				}
			}()
			_, _ = svc.Grant(context.Background(), "me", "grantee", tc.subject, "RECORDS", nil)
		})
	}
}

// Defense-in-depth: even if a forged row lands (legacy data, direct SQL),
// HasActiveGrant must not honour it — the query only counts grants the
// subject owner made themselves.
func TestHasActiveGrantQueryRequiresSelfGranted(t *testing.T) {
	if !strings.Contains(hasActiveGrantQuery, "grantor_id = subject_owner_id") {
		t.Fatal("HasActiveGrant must ignore grants where grantor_id != subject_owner_id")
	}
}
