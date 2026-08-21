package restaurant

import (
	"context"
	"fmt"
)

// ── Per-outlet staff roles (foodhub A18) ────────────────────────────────────
//
// Ownership used to be a single column: restaurants.owner_id, checked by
// assertOwner. That is workable for one person with one shop and breaks down the
// moment a brand runs several outlets — the owner cannot let a branch manager
// change that branch's menu, or a cashier accept orders, without handing over the
// account that also controls banking.
//
// A staff grant is per (outlet, user), so a manager at Lekki has no authority at
// Ikeja. That is the whole point: authority follows the shop, not the brand.
//
// The matrix below is pure and table-driven so it can be tested exhaustively —
// authorization bugs are the ones that do not announce themselves.

// StaffRole is a user's authority AT ONE OUTLET.
type StaffRole string

const (
	// RoleOwner is system-managed: it mirrors restaurants.owner_id and is not
	// grantable or revocable through the staff API.
	RoleOwner   StaffRole = "OWNER"
	RoleManager StaffRole = "MANAGER"
	RoleCashier StaffRole = "CASHIER"
	RoleKitchen StaffRole = "KITCHEN"
	RoleRider   StaffRole = "RIDER"
)

// StaffStatus is the lifecycle of a grant.
type StaffStatus string

const (
	StaffInvited   StaffStatus = "INVITED"
	StaffActive    StaffStatus = "ACTIVE"
	StaffSuspended StaffStatus = "SUSPENDED"
	StaffRemoved   StaffStatus = "REMOVED"
)

// StaffPermission is a thing someone can do at an outlet.
type StaffPermission string

const (
	// Money and identity — the owner alone.
	PermManageBanking StaffPermission = "banking"    // payout account, KYB submission
	PermManageStaff   StaffPermission = "staff"      // invite/suspend/remove staff
	PermManageStore   StaffPermission = "store"      // name, address, packaging price, hours
	PermManageMenu    StaffPermission = "menu"       // categories, items, availability
	PermViewOrders    StaffPermission = "orders.view"
	PermAcceptOrders  StaffPermission = "orders.accept"  // accept/reject an incoming order
	PermProgressOrder StaffPermission = "orders.progress" // preparing → ready
	PermDeliverOrder  StaffPermission = "orders.deliver"  // pickup → handoff
	PermViewEarnings  StaffPermission = "earnings.view"
)

// staffPermissions is the authority each role carries at its own outlet.
//
// Deliberately restrictive at the edges:
//   - only OWNER touches banking, because that is where the money leaves;
//   - MANAGER runs the shop but cannot change banking or grant themselves more;
//   - KITCHEN can progress an order but not accept one (accepting is a commercial
//     commitment, and it starts the SLA clock);
//   - RIDER sees only what it must to deliver — not earnings, not the menu.
var staffPermissions = map[StaffRole]map[StaffPermission]bool{
	RoleOwner: {
		PermManageBanking: true, PermManageStaff: true, PermManageStore: true,
		PermManageMenu: true, PermViewOrders: true, PermAcceptOrders: true,
		PermProgressOrder: true, PermDeliverOrder: true, PermViewEarnings: true,
	},
	RoleManager: {
		PermManageStore: true, PermManageMenu: true, PermManageStaff: true,
		PermViewOrders: true, PermAcceptOrders: true, PermProgressOrder: true,
		PermDeliverOrder: true, PermViewEarnings: true,
	},
	RoleCashier: {
		PermViewOrders: true, PermAcceptOrders: true, PermProgressOrder: true,
	},
	RoleKitchen: {
		PermViewOrders: true, PermProgressOrder: true,
	},
	RoleRider: {
		PermViewOrders: true, PermDeliverOrder: true,
	},
}

// RoleCan reports whether a role carries a permission at its own outlet.
//
// Unknown roles and unknown permissions are denied: a grant this code does not
// understand must never widen authority.
func RoleCan(role StaffRole, perm StaffPermission) bool {
	return staffPermissions[role][perm]
}

// StatusGrantsAccess reports whether a grant in this status confers anything.
// Only ACTIVE does — an invite that was never accepted, a suspension and a
// removal all deny.
func StatusGrantsAccess(status StaffStatus) bool {
	return status == StaffActive
}

// Can is the whole check: an ACTIVE grant of a role that carries the permission.
func Can(role StaffRole, status StaffStatus, perm StaffPermission) bool {
	if !StatusGrantsAccess(status) {
		return false
	}
	return RoleCan(role, perm)
}

// IsGrantableRole reports whether a role may be handed out through the staff API.
// OWNER is not: it is derived from restaurants.owner_id, and granting it here
// would create a second, divergent source of truth for who owns the shop.
func IsGrantableRole(role StaffRole) bool {
	switch role {
	case RoleManager, RoleCashier, RoleKitchen, RoleRider:
		return true
	default:
		return false
	}
}

// ─── Resolution against the database ────────────────────────────────────────

// ResolveStaffRole returns the caller's grant at one outlet.
//
// Falls back to restaurants.owner_id when no staff row exists: the backfill
// covers every current owner, but a restaurant created after this code ships and
// before its OWNER row is written must not lock its own owner out. Ownership is
// the source of truth; the staff table records everyone else.
func (s *Service) ResolveStaffRole(ctx context.Context, restaurantID, userID string) (StaffRole, StaffStatus, error) {
	var ownerID string
	if err := s.db.QueryRow(ctx, `SELECT owner_id FROM restaurants WHERE id=$1`, restaurantID).Scan(&ownerID); err != nil {
		// Same shape as assertOwner: a bad id is "not found", not "forbidden", so
		// an operator gets a 404 rather than a misleading permission error.
		return "", "", fmt.Errorf("restaurant: not found")
	}
	if ownerID == userID {
		return RoleOwner, StaffActive, nil
	}

	var role, status string
	err := s.db.QueryRow(ctx,
		`SELECT role, status FROM restaurant_staff WHERE restaurant_id=$1 AND user_id=$2`,
		restaurantID, userID).Scan(&role, &status)
	if err != nil {
		return "", "", nil // no grant at this outlet — not an error, just no authority
	}
	return StaffRole(role), StaffStatus(status), nil
}

// AssertStaffPermission is the guard the owner-side handlers use.
//
// Replaces assertOwner without changing its answer: an owner is resolved as
// OWNER (every permission), a stranger resolves to nothing, and the admin
// override still applies AFTER the existence check so a bad id stays a 404 for
// operators too.
func (s *Service) AssertStaffPermission(ctx context.Context, restaurantID, userID string, perm StaffPermission) error {
	role, status, err := s.ResolveStaffRole(ctx, restaurantID, userID)
	if err != nil {
		return err
	}
	if isAdminOverride(ctx) {
		return nil
	}
	if !Can(role, status, perm) {
		return fmt.Errorf("restaurant: you do not have permission to do that here")
	}
	return nil
}
