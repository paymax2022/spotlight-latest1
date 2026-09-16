package association_test

// ---------------------------------------------------------------------------
// LIVE-DB pin: requireElectionOfficer (service_elections.go) gates election
// administration on "holds ANY admin role != NONE in this org" — it does NOT
// go through the capabilities model (AdminCapabilities) every other admin
// mutation in this package uses. capabilitiesFor("SECRETARY") returns a zero
// AdminCapabilities{} (service.go) — a secretary cannot approve members,
// manage members, manage finance, import members, or manage committees
// anywhere else in this module — yet can fully administer an election:
// create it, add candidates, open/close voting, and publish results.
//
// This may well be intentional (the secretary is the traditional election
// clerk/minute-taker in many real associations), but nothing in the codebase
// — no comment on requireElectionOfficer itself, no test — records that as a
// decision, unlike the analogous EL-015 role-handover allowlist a few lines
// away in the same file, which IS explicitly decision-tagged. This test
// exists to (a) prove the current live behavior with real data rather than a
// code read, and (b) make any FUTURE change to this boundary a deliberate,
// visible diff instead of an accidental one. Flagged in the UAT bug tracker
// for an explicit product decision — not treated as a bug to silently patch.
//
// Gated on TEST_DATABASE_URL alone — see live_db_integration_test.go's
// bring-up note for this package.
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/association/... -run LiveDB_Election_SecretaryIsAFullOfficer -v
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/association"
)

func TestLiveDB_Election_SecretaryIsAFullOfficer(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	org := seedOrganisation(t, ctx, pool, "Secretary Officer Guild "+uuid.New().String())
	secretary := seedAdminRole(t, ctx, pool, org, "SECRETARY")
	_, candMembA := seedActiveMembership(t, ctx, pool, org)
	_, candMembB := seedActiveMembership(t, ctx, pool, org)

	electionID, err := svc.CreateElection(ctx, secretary, "", association.CreateElectionInput{
		Title:     "Secretary-run election",
		Positions: []association.CreatePositionInput{{Title: "Chairperson", Seats: 1}},
	})
	if err != nil {
		t.Fatalf("a SECRETARY (capabilitiesFor returns zero AdminCapabilities) was refused CreateElection: %v — "+
			"if this is now intentionally restricted, requireElectionOfficer's behavior changed; update this test to match", err)
	}

	var positionID string
	if err := pool.QueryRow(ctx, `SELECT id FROM assoc_election_positions WHERE election_id=$1`, electionID).Scan(&positionID); err != nil {
		t.Fatalf("read position: %v", err)
	}
	if _, err := svc.AddCandidate(ctx, secretary, electionID, association.AddCandidateInput{PositionID: positionID, MembershipID: candMembA, Manifesto: "A"}); err != nil {
		t.Errorf("SECRETARY AddCandidate: %v", err)
	}
	if _, err := svc.AddCandidate(ctx, secretary, electionID, association.AddCandidateInput{PositionID: positionID, MembershipID: candMembB, Manifesto: "B"}); err != nil {
		t.Errorf("SECRETARY AddCandidate: %v", err)
	}
	if err := svc.OpenElection(ctx, secretary, electionID); err != nil {
		t.Errorf("SECRETARY OpenElection: %v", err)
	}
	if err := svc.CloseElection(ctx, secretary, electionID); err != nil {
		t.Errorf("SECRETARY CloseElection: %v", err)
	}
	if _, err := svc.PublishResults(ctx, secretary, electionID); err != nil {
		t.Errorf("SECRETARY PublishResults: %v", err)
	}

	t.Log("CONFIRMED LIVE: a SECRETARY — zero AdminCapabilities everywhere else in this module — can independently " +
		"run an election's full lifecycle unsupervised (create, candidates, open, close, publish). Flagged as an " +
		"open product decision (ASSOC-DECISION-001), not silently changed here.")
}
