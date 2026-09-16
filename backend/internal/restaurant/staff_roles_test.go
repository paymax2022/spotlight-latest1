package restaurant

import "testing"

// Authorization matrix for per-outlet staff roles (foodhub A18).
//
// These are exhaustive on purpose. Authorization bugs do not announce themselves
// — nothing crashes when a cashier can edit the payout account — so every
// (role, permission) pair is asserted rather than spot-checked.

func TestOwnerCanDoEverything(t *testing.T) {
	for _, p := range allPermissions() {
		if !Can(RoleOwner, StaffActive, p) {
			t.Errorf("owner denied %q", p)
		}
	}
}

func TestOnlyTheOwnerTouchesBanking(t *testing.T) {
	// Banking is where money leaves the business. A manager runs the shop; they
	// do not get to change where the payouts land.
	for _, r := range []StaffRole{RoleManager, RoleCashier, RoleKitchen, RoleRider} {
		if Can(r, StaffActive, PermManageBanking) {
			t.Errorf("%s can change banking — only OWNER may", r)
		}
	}
}

func TestKitchenCannotAcceptOrders(t *testing.T) {
	// Accepting is a commercial commitment and starts the SLA clock; progressing
	// one already accepted is kitchen work.
	if Can(RoleKitchen, StaffActive, PermAcceptOrders) {
		t.Error("kitchen can accept orders — that is a commercial commitment")
	}
	if !Can(RoleKitchen, StaffActive, PermProgressOrder) {
		t.Error("kitchen cannot progress an order it is cooking")
	}
}

func TestRiderSeesOnlyWhatDeliveryNeeds(t *testing.T) {
	if !Can(RoleRider, StaffActive, PermDeliverOrder) {
		t.Error("rider cannot deliver")
	}
	for _, p := range []StaffPermission{PermManageMenu, PermManageStore, PermViewEarnings, PermManageStaff, PermAcceptOrders} {
		if Can(RoleRider, StaffActive, p) {
			t.Errorf("rider has %q, which delivery does not require", p)
		}
	}
}

func TestCashierRunsTheCounterOnly(t *testing.T) {
	for _, p := range []StaffPermission{PermViewOrders, PermAcceptOrders, PermProgressOrder} {
		if !Can(RoleCashier, StaffActive, p) {
			t.Errorf("cashier denied %q", p)
		}
	}
	for _, p := range []StaffPermission{PermManageMenu, PermManageStore, PermManageStaff, PermManageBanking, PermViewEarnings} {
		if Can(RoleCashier, StaffActive, p) {
			t.Errorf("cashier has %q", p)
		}
	}
}

func TestOnlyActiveGrantsConferAnything(t *testing.T) {
	// An invite that was never accepted, a suspension and a removal must all deny
	// — including for a role as powerful as OWNER.
	for _, st := range []StaffStatus{StaffInvited, StaffSuspended, StaffRemoved} {
		for _, r := range []StaffRole{RoleOwner, RoleManager, RoleCashier, RoleKitchen, RoleRider} {
			for _, p := range allPermissions() {
				if Can(r, st, p) {
					t.Errorf("%s/%s granted %q", r, st, p)
				}
			}
		}
	}
}

func TestUnknownRolesAndPermissionsAreDenied(t *testing.T) {
	// A grant this build does not understand — an older or newer row — must never
	// widen authority.
	if Can(StaffRole("SUPERUSER"), StaffActive, PermManageBanking) {
		t.Error("an unknown role was granted banking")
	}
	if Can(RoleOwner, StaffActive, StaffPermission("delete.everything")) {
		t.Error("an unknown permission was granted")
	}
}

func TestOwnerRoleIsNotGrantable(t *testing.T) {
	// OWNER mirrors restaurants.owner_id. Handing it out through the staff API
	// would create a second, divergent source of truth for who owns the shop.
	if IsGrantableRole(RoleOwner) {
		t.Error("OWNER is grantable through the staff API")
	}
	for _, r := range []StaffRole{RoleManager, RoleCashier, RoleKitchen, RoleRider} {
		if !IsGrantableRole(r) {
			t.Errorf("%s should be grantable", r)
		}
	}
	if IsGrantableRole(StaffRole("ADMIN")) {
		t.Error("an unknown role is grantable")
	}
}

func TestEveryRoleCanAtLeastSeeOrders(t *testing.T) {
	// A staff grant that cannot see the queue is a grant that does nothing.
	for _, r := range []StaffRole{RoleOwner, RoleManager, RoleCashier, RoleKitchen, RoleRider} {
		if !Can(r, StaffActive, PermViewOrders) {
			t.Errorf("%s cannot view orders", r)
		}
	}
}

func allPermissions() []StaffPermission {
	return []StaffPermission{
		PermManageBanking, PermManageStaff, PermManageStore, PermManageMenu,
		PermViewOrders, PermAcceptOrders, PermProgressOrder, PermDeliverOrder, PermViewEarnings,
	}
}
