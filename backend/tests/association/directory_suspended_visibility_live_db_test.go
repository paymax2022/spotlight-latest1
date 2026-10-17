package association_test

// ---------------------------------------------------------------------------
// LIVE-DB regression guard for a real bug found while auditing the
// "suspended member visibility" behavior GetDirectory's own comment claims
// ("a plain member still only ever sees ACTIVE members"): the code checked
// `q.Status == "" && q.OrgID == ""` before forcing the ACTIVE-only filter,
// so a PLAIN member (no org_id — they can never pass the requireCapInOrg
// authorization the admin override needs) could set their own ?status=
// value and see members in any status, with no authorization check on that
// override at all. Fixed by gating the ACTIVE-only filter on q.OrgID alone.
//
// Skipped unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/association"
)

func TestLiveDB_GetDirectory_PlainMemberCannotOverrideStatusFilter(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgID := seedOrganisation(t, ctx, pool, "Suspended Visibility "+uuid.New().String())
	viewer, _ := seedActiveMembership(t, ctx, pool, orgID)
	seedMemberProfile(t, ctx, pool, membershipIDFor(t, ctx, pool, orgID, viewer), "Viewer Person")

	_, suspendedMembershipID := seedActiveMembership(t, ctx, pool, orgID)
	seedMemberProfile(t, ctx, pool, suspendedMembershipID, "Suspended Person")
	if _, err := pool.Exec(ctx, `UPDATE assoc_memberships SET status='SUSPENDED' WHERE id=$1`, suspendedMembershipID); err != nil {
		t.Fatalf("suspend member: %v", err)
	}

	// A plain member, with NO org_id override, explicitly asking for
	// SUSPENDED members must never get one back. The fix forces ACTIVE-only
	// unconditionally without org_id, so combined with the caller's own
	// status=SUSPENDED it fails closed to an empty result (ACTIVE AND
	// SUSPENDED matches nothing) rather than silently substituting ACTIVE
	// members instead — both are safe (neither leaks), but empty is what the
	// query actually does, and that's the assertion that matters here: no
	// SUSPENDED row ever comes back to a caller who isn't authorized to ask.
	list, err := svc.GetDirectory(ctx, viewer, association.MemberDirectoryQuery{Status: "SUSPENDED"}, 0, 0)
	if err != nil {
		t.Fatalf("GetDirectory: %v", err)
	}
	for _, m := range list {
		if m.Status == "SUSPENDED" {
			t.Fatalf("plain member's ?status=SUSPENDED request returned a suspended member (%s) — the override was honored with no authorization check", m.FullName)
		}
	}

	// Sanity: the SAME plain member with NO status override at all still
	// correctly sees their own ACTIVE membership — proves GetDirectory isn't
	// just broken/empty in general, only the unauthorized override is blocked.
	defaultList, err := svc.GetDirectory(ctx, viewer, association.MemberDirectoryQuery{}, 0, 0)
	if err != nil {
		t.Fatalf("GetDirectory (no filter): %v", err)
	}
	found := false
	for _, m := range defaultList {
		if m.FullName == "Viewer Person" {
			found = true
		}
	}
	if !found {
		t.Fatal("the viewer's own ACTIVE membership is missing from the default (unfiltered) directory — query is broken, not just correctly restrictive")
	}
}
