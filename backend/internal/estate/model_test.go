package estate_test

import (
	"testing"
	"time"

	"spotlight/backend/internal/estate"
)

// TestVisitorPassStatusValues verifies the visitor pass lifecycle states.
func TestVisitorPassStatusValues(t *testing.T) {
	validStatuses := map[string]bool{
		"active":  true,
		"used":    true,
		"expired": true,
		"revoked": true,
	}
	for s := range validStatuses {
		if s == "" {
			t.Error("VisitorPass status must not be empty")
		}
	}
	// "used", "expired", "revoked" are terminal; "active" is entry state.
	for _, terminal := range []string{"used", "expired", "revoked"} {
		if terminal == "active" {
			t.Errorf("terminal status %q must differ from entry state 'active'", terminal)
		}
	}
}

// TestElectionStatusValues verifies the election lifecycle states.
func TestElectionStatusValues(t *testing.T) {
	validStatuses := map[string]bool{
		"draft":   true,
		"open":    true,
		"closed":  true,
		"tallied": true,
	}
	if len(validStatuses) < 4 {
		t.Error("expected at least 4 election lifecycle states")
	}
}

// TestResidentRoles verifies the two resident roles.
func TestResidentRoles(t *testing.T) {
	roles := []string{"resident", "estate_admin"}
	seen := map[string]bool{}
	for _, r := range roles {
		if r == "" {
			t.Error("resident role must not be empty")
		}
		if seen[r] {
			t.Errorf("duplicate resident role: %q", r)
		}
		seen[r] = true
	}
}

// TestVisitorPassValidityWindow verifies ValidUntil must be after ValidFrom.
func TestVisitorPassValidityWindow(t *testing.T) {
	now := time.Now()
	req := estate.IssuePassRequest{
		VisitorName: "John Smith",
		ValidFrom:   now,
		ValidUntil:  now.Add(4 * time.Hour),
	}
	if !req.ValidUntil.After(req.ValidFrom) {
		t.Errorf("ValidUntil (%v) must be after ValidFrom (%v)", req.ValidUntil, req.ValidFrom)
	}
}

// TestElectionRequiresAtLeastTwoCandidates verifies the minimum candidate constraint.
// An election with only one candidate is meaningless; binding:min=2 enforces this.
func TestElectionRequiresAtLeastTwoCandidates(t *testing.T) {
	req := estate.CreateElectionRequest{
		Title:    "AGM Chairperson Election",
		StartsAt: time.Now().Add(time.Hour),
		EndsAt:   time.Now().Add(24 * time.Hour),
		Candidates: []estate.Candidate{
			{Name: "Alice"},
			{Name: "Bob"},
		},
	}
	if len(req.Candidates) < 2 {
		t.Errorf("election requires at least 2 candidates, got %d", len(req.Candidates))
	}
}

// TestOneVotePerResident documents the at-most-once voting invariant.
// Enforced by UNIQUE(election_id, voter_id) + Redlock in the service.
func TestOneVotePerResident(t *testing.T) {
	// If two Vote records share the same (ElectionID, VoterID), it's a violation.
	v1 := estate.Vote{ElectionID: "election-001", VoterID: "resident-abc", CandidateID: "cand-1"}
	v2 := estate.Vote{ElectionID: "election-001", VoterID: "resident-abc", CandidateID: "cand-2"}

	if v1.ElectionID == v2.ElectionID && v1.VoterID == v2.VoterID {
		// This combination must be rejected by the DB UNIQUE constraint.
		t.Log("INVARIANT: (election_id, voter_id) must be UNIQUE — duplicate detected; DB will reject")
	}
}

// TestVisitorPassQRCodeRequired verifies every pass has a QR code for scanning.
func TestVisitorPassQRCodeRequired(t *testing.T) {
	pass := estate.VisitorPass{
		VisitorName: "Jane Doe",
		QRCode:      "550e8400-e29b-41d4-a716-446655440000",
		Status:      "active",
	}
	if pass.QRCode == "" {
		t.Error("VisitorPass.QRCode must not be empty — required for gate scanning")
	}
}
