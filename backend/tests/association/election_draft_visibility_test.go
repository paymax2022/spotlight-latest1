package association_test

// ---------------------------------------------------------------------------
// LIVE-DB regression: a newly-created DRAFT election was permanently invisible
// to the admin console that created it. ListElections unconditionally excluded
// status='DRAFT' — correct for a plain member's self-service call (members
// should never see an election before an officer opens it), but the admin
// console calls this SAME endpoint with an explicit ?org_id= override, and
// the frontend's own success toast after CreateElection says "Add candidates,
// then open voting from its page" — a page reachable only via a row in this
// list. An officer could create an election, see it confirmed in Postgres,
// and never be able to reach it again through the admin console: no link,
// no row, nothing. Live-reproduced via the browser during UAT before this fix.
//
// Gated on TEST_DATABASE_URL alone — see live_db_integration_test.go's
// bring-up note for this package.
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/association/... -run LiveDB_ListElections_DraftVisibility -v
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/association"
)

func TestLiveDB_ListElections_DraftVisibleToAdminNotToMember(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	org := seedOrganisation(t, ctx, pool, "Draft Visibility Guild "+uuid.New().String())
	officer := seedAdminRole(t, ctx, pool, org, "NATIONAL_ADMIN")
	plainMember, _ := seedActiveMembership(t, ctx, pool, org)

	electionID, err := svc.CreateElection(ctx, officer, org, association.CreateElectionInput{
		Title:     "Draft-only election",
		Positions: []association.CreatePositionInput{{Title: "Secretary"}},
	})
	if err != nil {
		t.Fatalf("CreateElection: %v", err)
	}

	// The admin console's own call shape: userID + an explicit org_id override.
	adminList, err := svc.ListElections(ctx, officer, org)
	if err != nil {
		t.Fatalf("ListElections (admin, org override): %v", err)
	}
	found := false
	for _, e := range adminList {
		if e.ID == electionID {
			found = true
			if e.Status != "DRAFT" {
				t.Errorf("listed election status = %q, want DRAFT", e.Status)
			}
		}
	}
	if !found {
		t.Fatalf("REGRESSION: the just-created DRAFT election %s is not in the admin's own org-scoped list — "+
			"it is permanently unreachable through the admin console (no row, no link, nothing)", electionID)
	}

	// The member self-service call shape (no override, resolved from the
	// caller's own primary membership) must still hide it — this is the
	// correct, unchanged half of the behavior.
	memberList, err := svc.ListElections(ctx, plainMember, "")
	if err != nil {
		t.Fatalf("ListElections (member, no override): %v", err)
	}
	for _, e := range memberList {
		if e.ID == electionID {
			t.Errorf("a plain member's list includes a DRAFT election (%s) — members must not see an election before an officer opens it", electionID)
		}
	}
}
