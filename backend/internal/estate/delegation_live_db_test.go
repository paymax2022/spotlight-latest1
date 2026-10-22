package estate

// LIVE-DB UAT for SP-01 (delegated officer roles + fail-closed authz) and SP-02
// (guard-gate enforcement: atomic code consume + host-arrival gating). Mirrors
// the TEST_DATABASE_URL-gated pattern in service_dues_live_db_test.go and reuses
// its seedDuesUser / seedEstate / seedResident helpers (same package). These
// cases exercise the Go service, which connects as Supabase service_role and so
// is authoritative over RLS — the enforcement under test lives here.
//
// Run:
//   TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
//     go test ./internal/estate/... -run TestLiveDB -v
//
// Until a reachable Postgres is available these SKIP (never report a false
// pass); the pure-domain contract is covered by delegation_test.go.

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func testDBDSN() string { return os.Getenv("TEST_DATABASE_URL") }

func estateDelegationPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := testDBDSN()
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB estate delegation/gate tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping test db: %v", err)
	}
	t.Cleanup(pool.Close)
	// The migration that adds the grant/arrival tables must be applied. Fail
	// loudly rather than silently mis-asserting when it is not.
	ctx := context.Background()
	for _, tbl := range []string{"estate_staff_grants", "visitor_arrival_requests"} {
		var exists bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name=$1)`, tbl).Scan(&exists); err != nil {
			t.Fatalf("check table %s: %v", tbl, err)
		}
		if !exists {
			t.Skipf("migration 20271087000000_estate_delegation.sql not applied to the test DB — skipping (no false pass)")
		}
	}
	return pool
}

// seedGuard makes userID a resident of estateID and grants them a live gate role.
func seedGuard(t *testing.T, ctx context.Context, pool *pgxpool.Pool, estateID, userID, role string, expiresAt *time.Time) {
	t.Helper()
	seedResident(t, ctx, pool, estateID, userID, "resident")
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO estate_staff_grants (id, estate_id, user_id, role, granted_by, expires_at)
		 VALUES ($1,$2,$3,$4,$5,$6)
		 ON CONFLICT (estate_id, user_id, role)
		 DO UPDATE SET granted_by=EXCLUDED.granted_by, expires_at=EXCLUDED.expires_at, revoked_at=NULL`,
		id, estateID, userID, role, userID, expiresAt); err != nil {
		t.Fatalf("seed grant: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM estate_staff_grants WHERE estate_id=$1 AND user_id=$2`, estateID, userID)
	})
}

func mustCreateCode(t *testing.T, svc *Service, ctx context.Context, estateID, issuerID string, req CreateAccessCodeRequest) *AccessCode {
	t.Helper()
	code, err := svc.CreateAccessCode(ctx, estateID, issuerID, req)
	if err != nil {
		t.Fatalf("CreateAccessCode: %v", err)
	}
	t.Cleanup(func() {
		_, _ = svc.db.Exec(context.WithoutCancel(ctx), `DELETE FROM visitor_access_codes WHERE id=$1`, code.ID)
	})
	return code
}

// TestLiveDBAssertGateFailClosed proves the guard/admit authz is fail-closed on
// every non-privileged state and only passes for estate_admin or a live grant.
func TestLiveDBAssertGateFailClosed(t *testing.T) {
	pool := estateDelegationPool(t)
	ctx := context.Background()
	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)

	stranger := seedDuesUser(t, ctx, pool)
	resident := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, resident, "resident")
	banned := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, banned, "resident")
	_, _ = pool.Exec(ctx, `UPDATE estate_residents SET banned_at=NOW() WHERE estate_id=$1 AND user_id=$2`, estateID, banned)
	deleted := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, deleted, "resident")
	_, _ = pool.Exec(ctx, `UPDATE estate_residents SET deleted_at=NOW() WHERE estate_id=$1 AND user_id=$2`, estateID, deleted)

	svc := NewService(pool, nil).WithGuardGrants(true)

	if err := svc.assertGate(ctx, estateID, admin, "gate_officer"); err != nil {
		t.Fatalf("estate_admin must pass assertGate, got %v", err)
	}
	if err := svc.assertGate(ctx, estateID, stranger, "gate_officer"); !errors.Is(err, ErrNotMember) {
		t.Fatalf("stranger: got %v, want ErrNotMember", err)
	}
	if err := svc.assertGate(ctx, estateID, resident, "gate_officer"); !errors.Is(err, ErrInsufficientRole) {
		t.Fatalf("plain resident w/o grant: got %v, want ErrInsufficientRole", err)
	}
	if err := svc.assertGate(ctx, estateID, banned, "gate_officer"); !errors.Is(err, ErrAccountBanned) {
		t.Fatalf("banned: got %v, want ErrAccountBanned", err)
	}
	if err := svc.assertGate(ctx, estateID, deleted, "gate_officer"); !errors.Is(err, ErrAccountDeleted) {
		t.Fatalf("deleted: got %v, want ErrAccountDeleted", err)
	}
}

// TestLiveDBGrantRevokeAndExpiry covers admin-only delegation, expiry, revocation
// and that the super role is not grantable.
func TestLiveDBGrantRevokeAndExpiry(t *testing.T) {
	pool := estateDelegationPool(t)
	ctx := context.Background()
	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	officer := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, officer, "resident")
	someoneElse := seedDuesUser(t, ctx, pool)

	svc := NewService(pool, nil).WithGuardGrants(true)

	// Non-admin cannot delegate.
	if _, err := svc.GrantRole(ctx, estateID, someoneElse, officer, "gate_officer", nil); err == nil {
		t.Fatal("non-admin GrantRole must fail")
	}

	// estate_admin role is never grantable through delegation.
	if _, err := svc.GrantRole(ctx, estateID, admin, officer, "estate_admin", nil); err == nil {
		t.Fatal("granting estate_admin via GrantRole must be rejected")
	}

	// Admin delegates a live gate_officer → assertGate passes.
	if _, err := svc.GrantRole(ctx, estateID, admin, officer, "gate_officer", nil); err != nil {
		t.Fatalf("GrantRole gate_officer: %v", err)
	}
	if err := svc.assertGate(ctx, estateID, officer, "gate_officer", "gate_supervisor"); err != nil {
		t.Fatalf("live grant should pass assertGate, got %v", err)
	}

	// Revoke → immediately denied.
	if err := svc.RevokeRole(ctx, estateID, admin, officer, "gate_officer"); err != nil {
		t.Fatalf("RevokeRole: %v", err)
	}
	if err := svc.assertGate(ctx, estateID, officer, "gate_officer", "gate_supervisor"); !errors.Is(err, ErrInsufficientRole) {
		t.Fatalf("after revoke: got %v, want ErrInsufficientRole", err)
	}

	// Expired grant → denied.
	past := time.Now().Add(-time.Hour)
	if _, err := svc.GrantRole(ctx, estateID, admin, officer, "gate_supervisor", &past); err != nil {
		t.Fatalf("GrantRole expired: %v", err)
	}
	if err := svc.assertGate(ctx, estateID, officer, "gate_officer", "gate_supervisor"); !errors.Is(err, ErrInsufficientRole) {
		t.Fatalf("expired grant: got %v, want ErrInsufficientRole", err)
	}
}

// TestLiveDBListEstatesIsolation proves a caller only sees estates where they are
// a member or hold a live grant, and that revoking the grant removes visibility.
func TestLiveDBListEstatesIsolation(t *testing.T) {
	pool := estateDelegationPool(t)
	ctx := context.Background()
	adminA := seedDuesUser(t, ctx, pool)
	estateA := seedEstate(t, ctx, pool, adminA)
	adminB := seedDuesUser(t, ctx, pool)
	estateB := seedEstate(t, ctx, pool, adminB)

	outsider := seedDuesUser(t, ctx, pool)
	officer := seedDuesUser(t, ctx, pool)

	svc := NewService(pool, nil).WithGuardGrants(true)

	// Empty caller fails closed.
	if _, err := svc.ListEstates(ctx, "", ""); !errors.Is(err, ErrNotMember) {
		t.Fatalf("empty callerID: got %v, want ErrNotMember", err)
	}

	// Outsider sees nothing.
	list, err := svc.ListEstates(ctx, outsider, "")
	if err != nil {
		t.Fatalf("ListEstates outsider: %v", err)
	}
	for _, e := range list {
		if e.ID == estateA || e.ID == estateB {
			t.Fatalf("outsider must not see seeded estates, saw %s", e.ID)
		}
	}

	// A live grant on estateB makes it visible, and only it. GrantRole requires
	// the grantee to already be a member — delegation layers on membership.
	seedResident(t, ctx, pool, estateB, officer, "resident")
	future := time.Now().Add(time.Hour)
	if _, err := svc.GrantRole(ctx, estateB, adminB, officer, "gate_officer", &future); err != nil {
		t.Fatalf("GrantRole: %v", err)
	}
	list, err = svc.ListEstates(ctx, officer, "")
	if err != nil {
		t.Fatalf("ListEstates after grant: %v", err)
	}
	if len(list) != 1 || list[0].ID != estateB {
		t.Fatalf("granted officer should see only estateB, got %+v", list)
	}

	// Revoke → gate authority is gone (visibility stays: residentship is the
	// source of listing access, the grant only layers gate role capability).
	if err := svc.RevokeRole(ctx, estateB, adminB, officer, "gate_officer"); err != nil {
		t.Fatalf("RevokeRole: %v", err)
	}
	if err := svc.assertGate(ctx, estateB, officer, guardRoles...); !errors.Is(err, ErrInsufficientRole) {
		t.Fatalf("after revoke assertGate: got %v, want ErrInsufficientRole", err)
	}
}

// TestLiveDBSingleUseAtomicRace proves the atomic consume admits exactly one
// visitor for a max_uses=1 code even under concurrent admits, and a second
// sequential admit is denied.
func TestLiveDBSingleUseAtomicRace(t *testing.T) {
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
		VisitorName: "Guest A", CodeType: "one_time",
		ValidFrom: time.Now().Add(-time.Minute), ValidUntil: time.Now().Add(time.Hour),
		MaxUses: 1,
	})

	// Two concurrent admits for the same single-use code.
	var wg sync.WaitGroup
	var mu sync.Mutex
	admits, denials := 0, 0
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := svc.CheckInVisitor(ctx, estateID, guard, GuardCheckinRequest{NumericCode: code.NumericCode})
			mu.Lock()
			if err == nil {
				admits++
			} else {
				denials++
			}
			mu.Unlock()
		}()
	}
	wg.Wait()
	if admits != 1 || denials != 1 {
		t.Fatalf("single-use race: want exactly 1 admit + 1 denial, got admits=%d denials=%d", admits, denials)
	}

	// used_count is 1 and the code is consumed.
	var used int
	var status string
	if err := pool.QueryRow(ctx, `SELECT used_count, status FROM visitor_access_codes WHERE id=$1`, code.ID).Scan(&used, &status); err != nil {
		t.Fatalf("read code: %v", err)
	}
	if used != 1 {
		t.Fatalf("used_count = %d, want 1 (no overshoot)", used)
	}
	if status != "used" {
		t.Fatalf("status = %q, want used", status)
	}

	// A third, sequential admit is denied.
	if _, err := svc.CheckInVisitor(ctx, estateID, guard, GuardCheckinRequest{NumericCode: code.NumericCode}); err == nil {
		t.Fatal("admit on a consumed code must be denied")
	}
}

// TestLiveDBExpiryDenied proves an out-of-window code is refused.
func TestLiveDBExpiryDenied(t *testing.T) {
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
		VisitorName: "Expired Guest", CodeType: "one_time",
		ValidFrom: time.Now().Add(-3 * time.Hour), ValidUntil: time.Now().Add(-2 * time.Hour),
		MaxUses: 5,
	})
	if _, err := svc.CheckInVisitor(ctx, estateID, guard, GuardCheckinRequest{NumericCode: code.NumericCode}); err == nil {
		t.Fatal("expired code admit must be denied")
	}
}

// TestLiveDBGuardAuthzRequiredOnCheckIn proves a plain resident (no gate grant)
// cannot run the guard admit path.
func TestLiveDBGuardAuthzRequiredOnCheckIn(t *testing.T) {
	pool := estateDelegationPool(t)
	ctx := context.Background()
	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	host := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, host, "resident")
	naughty := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, naughty, "resident")

	svc := NewService(pool, nil).WithGuardGrants(true)
	code := mustCreateCode(t, svc, ctx, estateID, host, CreateAccessCodeRequest{
		VisitorName: "Guest", CodeType: "one_time",
		ValidFrom: time.Now().Add(-time.Minute), ValidUntil: time.Now().Add(time.Hour), MaxUses: 1,
	})
	if _, err := svc.CheckInVisitor(ctx, estateID, naughty, GuardCheckinRequest{NumericCode: code.NumericCode}); !errors.Is(err, ErrInsufficientRole) {
		t.Fatalf("non-guard resident CheckIn: got %v, want ErrInsufficientRole", err)
	}
}

// TestLiveDBArrivalGating proves a require_host_approval code is refused until the
// issuing host approves a live arrival request, then admits.
func TestLiveDBArrivalGating(t *testing.T) {
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
		VisitorName: "Approval Guest", CodeType: "one_time",
		ValidFrom: time.Now().Add(-time.Minute), ValidUntil: time.Now().Add(time.Hour),
		MaxUses: 1, RequireHostApproval: true,
	})

	// Before approval: admit is denied.
	if _, err := svc.CheckInVisitor(ctx, estateID, guard, GuardCheckinRequest{NumericCode: code.NumericCode}); err == nil {
		t.Fatal("host-approval code must be denied before approval")
	}

	// Guard raises the arrival request; host approves it.
	reqID, err := svc.RequestArrival(ctx, estateID, guard, code.ID, "")
	if err != nil {
		t.Fatalf("RequestArrival: %v", err)
	}
	if err := svc.DecideArrival(ctx, estateID, host, reqID, true); err != nil {
		t.Fatalf("DecideArrival approve: %v", err)
	}

	// Now the admit succeeds.
	if _, err := svc.CheckInVisitor(ctx, estateID, guard, GuardCheckinRequest{NumericCode: code.NumericCode}); err != nil {
		t.Fatalf("admit after host approval should succeed, got %v", err)
	}
}

// TestLiveDBDeclinedArrivalStaysDenied proves a declined arrival keeps the door shut.
func TestLiveDBDeclinedArrivalStaysDenied(t *testing.T) {
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
		VisitorName: "Declined Guest", CodeType: "one_time",
		ValidFrom: time.Now().Add(-time.Minute), ValidUntil: time.Now().Add(time.Hour),
		MaxUses: 1, RequireHostApproval: true,
	})
	reqID, err := svc.RequestArrival(ctx, estateID, guard, code.ID, "")
	if err != nil {
		t.Fatalf("RequestArrival: %v", err)
	}
	if err := svc.DecideArrival(ctx, estateID, host, reqID, false); err != nil {
		t.Fatalf("DecideArrival decline: %v", err)
	}
	if _, err := svc.CheckInVisitor(ctx, estateID, guard, GuardCheckinRequest{NumericCode: code.NumericCode}); err == nil {
		t.Fatal("declined arrival must keep the door denied")
	}
}

// TestLiveDBArrivalDecisionAuthz proves a non-host, non-admin cannot decide an arrival.
func TestLiveDBArrivalDecisionAuthz(t *testing.T) {
	pool := estateDelegationPool(t)
	ctx := context.Background()
	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	host := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, host, "resident")
	guard := seedDuesUser(t, ctx, pool)
	seedGuard(t, ctx, pool, estateID, guard, "gate_officer", nil)
	other := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, other, "resident")

	svc := NewService(pool, nil).WithGuardGrants(true)
	code := mustCreateCode(t, svc, ctx, estateID, host, CreateAccessCodeRequest{
		VisitorName: "Authz Guest", CodeType: "one_time",
		ValidFrom: time.Now().Add(-time.Minute), ValidUntil: time.Now().Add(time.Hour),
		MaxUses: 1, RequireHostApproval: true,
	})
	reqID, err := svc.RequestArrival(ctx, estateID, guard, code.ID, "")
	if err != nil {
		t.Fatalf("RequestArrival: %v", err)
	}
	if err := svc.DecideArrival(ctx, estateID, other, reqID, true); !errors.Is(err, ErrInsufficientRole) {
		t.Fatalf("non-host decision: got %v, want ErrInsufficientRole", err)
	}
}

// TestLiveDBE2EVisitorAccessJourney runs the whole SP-01+SP-02 loop end to end.
func TestLiveDBE2EVisitorAccessJourney(t *testing.T) {
	pool := estateDelegationPool(t)
	ctx := context.Background()

	// 1. Admin creates an estate (merchant gate off → nil service gate).
	admin := seedDuesUser(t, ctx, pool)
	estateID := seedEstate(t, ctx, pool, admin)
	// 2. Admin delegates a gate officer.
	guard := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, guard, "resident")
	svc := NewService(pool, nil).WithGuardGrants(true)
	if _, err := svc.GrantRole(ctx, estateID, admin, guard, "gate_officer", nil); err != nil {
		t.Fatalf("GrantRole: %v", err)
	}
	// 3. Resident issues a reusable code (2 uses).
	host := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, host, "resident")
	code := mustCreateCode(t, svc, ctx, estateID, host, CreateAccessCodeRequest{
		VisitorName: "Journey Guest", CodeType: "recurring",
		ValidFrom: time.Now().Add(-time.Minute), ValidUntil: time.Now().Add(time.Hour), MaxUses: 2,
	})
	// 4. Guard looks up the code (authorised).
	payload, err := svc.LookupCode(ctx, estateID, guard, code.NumericCode, "")
	if err != nil {
		t.Fatalf("LookupCode: %v", err)
	}
	if !payload.Allowed {
		t.Fatal("fresh reusable code should be allowed")
	}
	// 5. Two admits succeed, third is denied.
	for i := 0; i < 2; i++ {
		if _, err := svc.CheckInVisitor(ctx, estateID, guard, GuardCheckinRequest{NumericCode: code.NumericCode}); err != nil {
			t.Fatalf("admit %d: %v", i+1, err)
		}
	}
	if _, err := svc.CheckInVisitor(ctx, estateID, guard, GuardCheckinRequest{NumericCode: code.NumericCode}); err == nil {
		t.Fatal("third admit on a 2-use code must be denied")
	}
	// 6. Exactly two checkin rows recorded.
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM visitor_checkins WHERE code_id=$1`, code.ID).Scan(&n); err != nil {
		t.Fatalf("count checkins: %v", err)
	}
	if n != 2 {
		t.Fatalf("visitor_checkins = %d, want 2", n)
	}
}
