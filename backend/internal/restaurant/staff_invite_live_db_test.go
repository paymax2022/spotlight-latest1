package restaurant

// LIVE-DB tests for staff invite / accept (foodhub A18).
//
// An invite is a credential: whoever holds the token gains standing authority at
// a real shop — the menu, the order queue, sometimes the earnings. So the token
// is treated like a password (hashed at rest, returned exactly once), and the
// grant graph is kept acyclic: only an OWNER may create a MANAGER, or a manager
// could promote a peer and, through them, themselves.
//
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestLiveDB_InviteIssuesAOneTimeTokenAndStoresOnlyItsHash(t *testing.T) {
	pool := staffPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newStaffFixture(t, ctx, pool)

	invitee := seedUser(t, ctx, f)
	inv, err := f.svc.InviteStaff(ctx, f.lekki, f.owner, invitee, RoleCashier)
	if err != nil {
		t.Fatalf("InviteStaff: %v", err)
	}
	if inv.Token == "" {
		t.Fatal("no token returned — the owner has nothing to send the invitee")
	}

	var stored string
	var status, role string
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(invite_token_hash,''), status, role FROM restaurant_staff
		  WHERE restaurant_id=$1 AND user_id=$2`, f.lekki, invitee).Scan(&stored, &status, &role); err != nil {
		t.Fatalf("read invite row: %v", err)
	}
	// The plaintext must never be at rest: a dump of this table would otherwise
	// let anyone accept any outstanding invite.
	if stored == inv.Token {
		t.Error("the invite token is stored in plaintext")
	}
	if stored == "" {
		t.Error("no token hash stored — the invite can never be verified")
	}
	if status != string(StaffInvited) {
		t.Errorf("status = %s, want INVITED — an invite confers nothing until accepted", status)
	}
	if role != string(RoleCashier) {
		t.Errorf("role = %s, want CASHIER", role)
	}
}

func TestLiveDB_AcceptingAnInviteActivatesItExactlyOnce(t *testing.T) {
	pool := staffPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newStaffFixture(t, ctx, pool)

	invitee := seedUser(t, ctx, f)
	inv, err := f.svc.InviteStaff(ctx, f.lekki, f.owner, invitee, RoleKitchen)
	if err != nil {
		t.Fatalf("InviteStaff: %v", err)
	}

	// Before accepting, the invitee has nothing.
	if err := f.svc.AssertStaffPermission(ctx, f.lekki, invitee, PermViewOrders); err == nil {
		t.Error("an unaccepted invite already granted access")
	}

	if err := f.svc.AcceptStaffInvite(ctx, inv.Token, invitee); err != nil {
		t.Fatalf("AcceptStaffInvite: %v", err)
	}
	if err := f.svc.AssertStaffPermission(ctx, f.lekki, invitee, PermViewOrders); err != nil {
		t.Errorf("an accepted kitchen invite does not see the queue: %v", err)
	}

	// Single use: a replayed token must not re-activate a grant that was later
	// suspended or removed.
	if err := f.svc.AcceptStaffInvite(ctx, inv.Token, invitee); err == nil {
		t.Error("the same invite token was accepted twice")
	}
}

func TestLiveDB_AnInviteBindsToTheInvitedPerson(t *testing.T) {
	pool := staffPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newStaffFixture(t, ctx, pool)

	invitee := seedUser(t, ctx, f)
	interloper := seedUser(t, ctx, f)
	inv, err := f.svc.InviteStaff(ctx, f.lekki, f.owner, invitee, RoleCashier)
	if err != nil {
		t.Fatalf("InviteStaff: %v", err)
	}

	// A forwarded or intercepted link must not work for anyone else.
	if err := f.svc.AcceptStaffInvite(ctx, inv.Token, interloper); err == nil {
		t.Error("someone else accepted an invite addressed to another user")
	}
	if err := f.svc.AssertStaffPermission(ctx, f.lekki, interloper, PermViewOrders); err == nil {
		t.Error("the interloper gained access")
	}
	// A wrong token gets nowhere either.
	if err := f.svc.AcceptStaffInvite(ctx, "not-the-token", invitee); err == nil {
		t.Error("a bogus token was accepted")
	}
}

func TestLiveDB_OwnerRoleCannotBeGranted(t *testing.T) {
	pool := staffPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newStaffFixture(t, ctx, pool)

	invitee := seedUser(t, ctx, f)
	// OWNER mirrors restaurants.owner_id. Granting it here would create a second,
	// divergent answer to "who owns this shop" — and payouts read the first one.
	if _, err := f.svc.InviteStaff(ctx, f.lekki, f.owner, invitee, RoleOwner); err == nil {
		t.Error("OWNER was grantable through the staff API")
	}
}

func TestLiveDB_ManagersCannotBuildAnEscalationChain(t *testing.T) {
	pool := staffPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newStaffFixture(t, ctx, pool)

	invitee := seedUser(t, ctx, f)
	// A manager may staff the shop…
	if _, err := f.svc.InviteStaff(ctx, f.lekki, f.manager, invitee, RoleCashier); err != nil {
		t.Errorf("a manager could not invite a cashier: %v", err)
	}
	// …but may not mint another manager. Otherwise two managers can promote each
	// other's nominees indefinitely, and the owner's control is nominal.
	another := seedUser(t, ctx, f)
	if _, err := f.svc.InviteStaff(ctx, f.lekki, f.manager, another, RoleManager); err == nil {
		t.Error("a manager created another manager — only the owner may")
	}
}

func TestLiveDB_StaffCannotBeTurnedAgainstTheOwner(t *testing.T) {
	pool := staffPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newStaffFixture(t, ctx, pool)

	// The OWNER row is system-managed. A manager with staff authority must not be
	// able to suspend or remove the person who owns the business.
	if err := f.svc.SetStaffStatus(ctx, f.lekki, f.manager, f.owner, StaffSuspended); err == nil {
		t.Error("a manager suspended the owner")
	}
	if err := f.svc.SetStaffStatus(ctx, f.lekki, f.manager, f.owner, StaffRemoved); err == nil {
		t.Error("a manager removed the owner")
	}
}

func TestLiveDB_OwnerCanSuspendAndRestoreStaff(t *testing.T) {
	pool := staffPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newStaffFixture(t, ctx, pool)

	if err := f.svc.SetStaffStatus(ctx, f.lekki, f.owner, f.manager, StaffSuspended); err != nil {
		t.Fatalf("suspend: %v", err)
	}
	if err := f.svc.AssertStaffPermission(ctx, f.lekki, f.manager, PermViewOrders); err == nil {
		t.Error("a suspended manager retained access")
	}
	if err := f.svc.SetStaffStatus(ctx, f.lekki, f.owner, f.manager, StaffActive); err != nil {
		t.Fatalf("restore: %v", err)
	}
	if err := f.svc.AssertStaffPermission(ctx, f.lekki, f.manager, PermViewOrders); err != nil {
		t.Errorf("a restored manager did not regain access: %v", err)
	}
}

func TestLiveDB_StaffRosterIsScopedAndGuarded(t *testing.T) {
	pool := staffPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newStaffFixture(t, ctx, pool)

	roster, err := f.svc.ListStaff(ctx, f.lekki, f.owner)
	if err != nil {
		t.Fatalf("ListStaff: %v", err)
	}
	if len(roster) < 2 {
		t.Errorf("roster has %d rows, want the owner and the manager", len(roster))
	}
	for _, m := range roster {
		// The hash is a credential derivative and has no business leaving the server.
		if m.InviteTokenHash != "" {
			t.Error("the roster leaked an invite token hash")
		}
	}
	// A cashier has no staff authority, so cannot enumerate colleagues.
	if _, err := f.svc.ListStaff(ctx, f.lekki, f.stranger); err == nil {
		t.Error("a stranger read the staff roster")
	}
}

// seedUser creates a throwaway account and registers its cleanup.
func seedUser(t *testing.T, ctx context.Context, f staffFixture) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := f.pool.Exec(ctx,
		`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return id
}
