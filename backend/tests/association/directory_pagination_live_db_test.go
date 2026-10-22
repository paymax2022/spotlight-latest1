package association_test

// ---------------------------------------------------------------------------
// LIVE-DB regression guard for GetDirectory's new limit/offset support,
// added during a comprehensive association-module UAT pass. Before this:
// the query had a hardcoded `ORDER BY mp.full_name LIMIT 200` with no offset
// parameter anywhere in MemberDirectoryQuery or GetDirectory's signature —
// any org over 200 (ACTIVE, non-restricted) members silently truncated the
// same way for every caller, with nothing in the response distinguishing
// "that's everyone" from "there are more, and you can't reach them."
//
// Skipped unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/association"
)

func TestLiveDB_GetDirectory_LimitAndOffset(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgID := seedOrganisation(t, ctx, pool, "Directory Paging "+uuid.New().String())
	viewer, _ := seedActiveMembership(t, ctx, pool, orgID)
	seedMemberProfile(t, ctx, pool, membershipIDFor(t, ctx, pool, orgID, viewer), "Aaa Viewer")

	// Three more members, named so ORDER BY full_name is deterministic.
	names := []string{"Bbb Member", "Ccc Member", "Ddd Member"}
	for _, name := range names {
		_, mid := seedActiveMembership(t, ctx, pool, orgID)
		seedMemberProfile(t, ctx, pool, mid, name)
	}
	// Total directory for this org: Aaa, Bbb, Ccc, Ddd = 4.

	page1, err := svc.GetDirectory(ctx, viewer, association.MemberDirectoryQuery{}, 2, 0)
	if err != nil {
		t.Fatalf("page 1: %v", err)
	}
	if len(page1) != 2 || page1[0].FullName != "Aaa Viewer" || page1[1].FullName != "Bbb Member" {
		t.Fatalf("page 1 (limit=2,offset=0) = %+v, want [Aaa Viewer, Bbb Member]", namesOf(page1))
	}

	page2, err := svc.GetDirectory(ctx, viewer, association.MemberDirectoryQuery{}, 2, 2)
	if err != nil {
		t.Fatalf("page 2: %v", err)
	}
	if len(page2) != 2 || page2[0].FullName != "Ccc Member" || page2[1].FullName != "Ddd Member" {
		t.Fatalf("page 2 (limit=2,offset=2) = %+v, want [Ccc Member, Ddd Member]", namesOf(page2))
	}

	page3, err := svc.GetDirectory(ctx, viewer, association.MemberDirectoryQuery{}, 2, 4)
	if err != nil {
		t.Fatalf("page 3: %v", err)
	}
	if len(page3) != 0 {
		t.Fatalf("page 3 (limit=2,offset=4) = %+v, want empty (only 4 members exist)", namesOf(page3))
	}

	// limit<=0 falls back to the default (200) rather than returning nothing.
	all, err := svc.GetDirectory(ctx, viewer, association.MemberDirectoryQuery{}, 0, 0)
	if err != nil {
		t.Fatalf("default limit: %v", err)
	}
	if len(all) != 4 {
		t.Fatalf("default-limit directory = %d members, want 4", len(all))
	}
}

func namesOf(rows []association.MemberProfileSummary) []string {
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.FullName
	}
	return out
}

func membershipIDFor(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orgID, userID string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(ctx, `SELECT id FROM assoc_memberships WHERE organisation_id=$1 AND user_id=$2`, orgID, userID).Scan(&id); err != nil {
		t.Fatalf("resolve membership id: %v", err)
	}
	return id
}
