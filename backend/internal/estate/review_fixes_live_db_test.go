package estate

// Regression tests for the security review of PR #876 (ADR-PR876):
//   H1  one host approval admits at most once, and only within its TTL;
//   M1  with FEATURE_ESTATE_GUARD_GRANTS off, guard access and ListEstates
//       behave exactly as before this PR (plain residents keep the gate);
//   M2  the new tables are not reachable through PostgREST at all.
// Skipped unless TEST_DATABASE_URL is set (estateDelegationPool).

import (
	"context"
	"errors"
	"testing"
	"time"
)

func approvedArrival(t *testing.T, ctx context.Context, svc *Service, estateID, guard, host, codeID string) string {
	t.Helper()
	reqID, err := svc.RequestArrival(ctx, estateID, guard, codeID, "")
	if err != nil {
		t.Fatalf("RequestArrival: %v", err)
	}
	if err := svc.DecideArrival(ctx, estateID, host, reqID, true); err != nil {
		t.Fatalf("DecideArrival approve: %v", err)
	}
	return reqID
}

func TestLiveDBApprovalAdmitsOnce(t *testing.T) {
	pool := estateDelegationPool(t)
	ctx := context.Background()
	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	host := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, host, "resident")
	guard := seedDuesUser(t, ctx, pool)
	seedGuard(t, ctx, pool, estateID, guard, "gate_officer", nil)

	svc := NewService(pool, nil).WithGuardGrants(true)
	code := mustCreateCode(t, svc, ctx, estateID, host, CreateAccessCodeRequest{
		VisitorName: "Two-use Guest", CodeType: "recurring",
		ValidFrom: time.Now().Add(-time.Minute), ValidUntil: time.Now().Add(time.Hour),
		MaxUses: 2, RequireHostApproval: true,
	})
	approvedArrival(t, ctx, svc, estateID, guard, host, code.ID)

	if _, err := svc.CheckInVisitor(ctx, estateID, guard, GuardCheckinRequest{NumericCode: code.NumericCode}); err != nil {
		t.Fatalf("first admit after approval should succeed: %v", err)
	}
	if _, err := svc.CheckInVisitor(ctx, estateID, guard, GuardCheckinRequest{NumericCode: code.NumericCode}); err == nil {
		t.Fatal("second admit on the SAME approval must be denied (approval is single-use)")
	}
	// A fresh approval admits the second use.
	approvedArrival(t, ctx, svc, estateID, guard, host, code.ID)
	if _, err := svc.CheckInVisitor(ctx, estateID, guard, GuardCheckinRequest{NumericCode: code.NumericCode}); err != nil {
		t.Fatalf("admit after a second approval should succeed: %v", err)
	}
}

func TestLiveDBApprovalExpires(t *testing.T) {
	pool := estateDelegationPool(t)
	ctx := context.Background()
	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	host := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, host, "resident")
	guard := seedDuesUser(t, ctx, pool)
	seedGuard(t, ctx, pool, estateID, guard, "gate_officer", nil)

	svc := NewService(pool, nil).WithGuardGrants(true)
	code := mustCreateCode(t, svc, ctx, estateID, host, CreateAccessCodeRequest{
		VisitorName: "Late Guest", CodeType: "one_time",
		ValidFrom: time.Now().Add(-time.Minute), ValidUntil: time.Now().Add(time.Hour),
		MaxUses: 1, RequireHostApproval: true,
	})
	reqID := approvedArrival(t, ctx, svc, estateID, guard, host, code.ID)
	if _, err := pool.Exec(ctx, `UPDATE visitor_arrival_requests SET decided_at = NOW() - make_interval(secs => $2) WHERE id=$1`,
		reqID, (arrivalApprovalTTL + time.Minute).Seconds()); err != nil {
		t.Fatalf("age approval: %v", err)
	}
	if _, err := svc.CheckInVisitor(ctx, estateID, guard, GuardCheckinRequest{NumericCode: code.NumericCode}); err == nil {
		t.Fatal("an approval older than arrivalApprovalTTL must not admit")
	}
}

func TestLiveDBGuardGrantsFlagOffKeepsPreviousBehaviour(t *testing.T) {
	pool := estateDelegationPool(t)
	ctx := context.Background()
	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	resident := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, resident, "resident")
	stranger := seedDuesUser(t, ctx, pool)

	off := NewService(pool, nil) // FEATURE_ESTATE_GUARD_GRANTS off (default)
	if err := off.assertGate(ctx, estateID, resident, guardRoles...); err != nil {
		t.Fatalf("flag off: a plain resident must keep gate access as before, got %v", err)
	}
	if err := off.assertGate(ctx, estateID, stranger, guardRoles...); err == nil {
		t.Fatal("flag off: a non-member must still be refused")
	}
	all, err := off.ListEstates(ctx, stranger, "")
	if err != nil {
		t.Fatalf("flag off ListEstates: %v", err)
	}
	found := false
	for _, e := range all {
		found = found || e.ID == estateID
	}
	if !found {
		t.Fatal("flag off: ListEstates must keep its previous discovery behaviour")
	}

	on := NewService(pool, nil).WithGuardGrants(true)
	if err := on.assertGate(ctx, estateID, resident, guardRoles...); !errors.Is(err, ErrInsufficientRole) {
		t.Fatalf("flag on: a plain resident without a grant must be refused, got %v", err)
	}
}

func TestLiveDBNewEstateTablesNotReachableViaPostgREST(t *testing.T) {
	pool := estateDelegationPool(t)
	ctx := context.Background()
	// Asserted on the catalog: Postgres expands RLS policies before it checks
	// privileges, so probing with a SELECT can surface an unrelated policy error
	// first. No privilege at all is what keeps PostgREST out.
	for _, tbl := range []string{"estate_staff_grants", "visitor_arrival_requests"} {
		for _, role := range []string{"anon", "authenticated"} {
			var any bool
			if err := pool.QueryRow(ctx,
				`SELECT has_table_privilege($1, 'public.'||$2, 'SELECT,INSERT,UPDATE,DELETE')`,
				role, tbl).Scan(&any); err != nil {
				t.Fatal(err)
			}
			if any {
				t.Errorf("%s: %s must hold no table privileges (PostgREST lockdown)", tbl, role)
			}
		}
	}
}
