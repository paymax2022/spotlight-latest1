package association_test

// ---------------------------------------------------------------------------
// LIVE-DB regression: GetElection unconditionally required the caller to hold
// a real assoc_memberships row in the election's org, returning ErrForbidden
// otherwise. This is correct for a voter, but it made the election detail
// page — the ONLY page that can add candidates, open/close voting, or publish
// results — unreachable for the admin console's actual users: a platform
// admin overseeing many associations is not personally a member of most of
// them. This is the same gap GetMember had before it was given an admin
// bypass (see that function's own comment). Live-reproduced via the browser
// during UAT (a real cf4-admin-style platform super-admin, real HTTP, real
// backend) before this fix: 403 on the election detail page for an org the
// admin account does not personally belong to.
//
// Gated on TEST_DATABASE_URL alone — see live_db_integration_test.go's
// bring-up note for this package.
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/association/... -run LiveDB_GetElection_PlatformAdminWithoutMembership -v
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/association"
)

func TestLiveDB_GetElection_PlatformAdminWithoutMembershipCanView(t *testing.T) {
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	org := seedOrganisation(t, ctx, pool, "Platform Admin View Guild "+uuid.New().String())
	officer := seedAdminRole(t, ctx, pool, org, "NATIONAL_ADMIN")

	electionID, err := svc.CreateElection(ctx, officer, org, association.CreateElectionInput{
		Title:     "Platform-admin-viewable election",
		Positions: []association.CreatePositionInput{{Title: "Treasurer"}},
	})
	if err != nil {
		t.Fatalf("CreateElection: %v", err)
	}

	// A platform super-admin with NO association membership anywhere — the
	// exact shape a real admin-console operator has relative to any one of
	// the many associations they administer but never personally joined.
	adminID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO auth.users (id, email, aud, role)
		VALUES ($1, $2, 'authenticated', 'authenticated')
		ON CONFLICT (id) DO NOTHING`, adminID, "assoc-uat-platform-admin-"+adminID+"@test.local"); err != nil {
		t.Fatalf("seed platform admin user: %v", err)
	}
	var roleID string
	if err := pool.QueryRow(ctx, `SELECT id FROM public.roles WHERE slug = 'super-admin'`).Scan(&roleID); err != nil {
		t.Skipf("no 'super-admin' role in this database — skipping (isPlatformSuperAdmin path untestable here): %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO public.user_roles (user_id, role_id) VALUES ($1, $2)`, adminID, roleID); err != nil {
		t.Fatalf("grant platform super-admin role: %v", err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM public.user_roles WHERE user_id = $1`, adminID) })

	// Prove the premise: this admin genuinely has no membership row in this org.
	var membershipCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_memberships WHERE user_id=$1 AND organisation_id=$2`, adminID, org).Scan(&membershipCount); err != nil {
		t.Fatalf("count memberships: %v", err)
	}
	if membershipCount != 0 {
		t.Fatalf("test setup: platform admin unexpectedly has a membership in this org")
	}

	detail, err := svc.GetElection(ctx, adminID, electionID)
	if err != nil {
		t.Fatalf("REGRESSION: a platform super-admin with no membership row was refused GetElection: %v — "+
			"the election management page is unreachable for any admin who is not personally a member of this org", err)
	}
	if detail.Eligible {
		t.Errorf("a non-member platform admin was marked Eligible to vote — they hold no membership to cast a ballot from")
	}
	if detail.EligibilityReason == "" {
		t.Errorf("EligibilityReason is empty for an ineligible non-member admin")
	}
	if len(detail.Positions) != 1 {
		t.Errorf("Positions = %d, want 1 — the admin must see the real election content, not a stripped view", len(detail.Positions))
	}
}
