package restaurant

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"spotlight/backend/go-common/cryptox"
)

// Ownership used to be a single column: restaurants.owner_id, checked by
// assertOwner. That is workable for one person with one shop and breaks down the
// moment a brand runs several outlets — the owner cannot let a branch manager
// change that branch's menu, or a cashier accept orders, without handing over the
// account that also controls banking.
// A staff grant is per (outlet, user), so a manager at Lekki has no authority at
// Ikeja. That is the whole point: authority follows the shop, not the brand.
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
	PermManageBanking StaffPermission = "banking" // payout account, KYB submission
	PermManageStaff   StaffPermission = "staff"   // invite/suspend/remove staff
	PermManageStore   StaffPermission = "store"   // name, address, packaging price, hours
	PermManageMenu    StaffPermission = "menu"    // categories, items, availability
	PermViewOrders    StaffPermission = "orders.view"
	PermAcceptOrders  StaffPermission = "orders.accept"   // accept/reject an incoming order
	PermProgressOrder StaffPermission = "orders.progress" // preparing → ready
	PermDeliverOrder  StaffPermission = "orders.deliver"  // pickup → handoff
	PermViewEarnings  StaffPermission = "earnings.view"
)

// staffPermissions is the authority each role carries at its own outlet.
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

// ResolveStaffRole returns the caller's grant at one outlet.
// Falls back to restaurants.owner_id when no staff row exists: the backfill
// covers every current owner, but a restaurant created after this code ships and
// before its OWNER row is written must not lock its own owner out. Ownership is
// the source of truth; the staff table records everyone else.
func (s *Service) ResolveStaffRole(ctx context.Context, restaurantID, userID string) (StaffRole, StaffStatus, error) {
	var ownerID string
	if err := s.db.QueryRow(ctx, `SELECT owner_id FROM restaurants WHERE id=$1`, restaurantID).Scan(&ownerID); err != nil {
		// Same shape as assertOwner: a bad id is "not found", not "forbidden", so
		// an operator gets a 404 rather than a misleading permission error.
		return "", "", errors.New("restaurant: not found")
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
		return errors.New("restaurant: you do not have permission to do that here")
	}
	return nil
}

// An invite is a CREDENTIAL: whoever redeems it gains standing authority at a
// real shop — the menu, the order queue, sometimes the earnings. It is therefore
// handled like a password rather than like data:
//   - a 256-bit random token, returned to the inviter exactly once;
//   - only its SHA-256 hash at rest, so a dump of restaurant_staff cannot be
//     used to accept anybody's outstanding invites;
//   - bound to the invited user, so a forwarded link is useless to anyone else;
//   - single-use, so a replayed token cannot resurrect a grant that was later
//     suspended or removed.
// The grant graph is also kept acyclic: only an OWNER may create a MANAGER.
// Without that, two managers can promote each other's nominees indefinitely and
// the owner's control over their own business becomes nominal.

// StaffMember is one row of the roster. The token hash is deliberately absent.
type StaffMember struct {
	UserID     string      `json:"user_id"`
	Email      string      `json:"email,omitempty"`
	Role       StaffRole   `json:"role"`
	Status     StaffStatus `json:"status"`
	AcceptedAt *time.Time  `json:"accepted_at,omitempty"`
	CreatedAt  time.Time   `json:"created_at"`
	// InviteTokenHash is never populated by ListStaff. It exists only so a test
	// can assert that fact.
	InviteTokenHash string `json:"-"`
}

// StaffInvite is what the inviter gets back. Token is shown once and never again.
type StaffInvite struct {
	UserID string    `json:"user_id"`
	Role   StaffRole `json:"role"`
	// Token is the plaintext to hand to the invitee. It is not recoverable later.
	Token string `json:"token"`
}

func newInviteToken() (string, string, error) {
	var plain string = cryptox.RandHex(32)
	return plain, hashInviteToken(plain), nil
}

func hashInviteToken(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}

// InviteStaff grants a role at one outlet, pending acceptance.
// The actor needs PermManageStaff at that outlet. MANAGER may only be granted by
// an OWNER (see the escalation note above), and OWNER may not be granted at all.
func (s *Service) InviteStaff(ctx context.Context, restaurantID, actorID, inviteeID string, role StaffRole) (*StaffInvite, error) {
	if err := s.AssertStaffPermission(ctx, restaurantID, actorID, PermManageStaff); err != nil {
		return nil, err
	}
	if !IsGrantableRole(role) {
		return nil, fmt.Errorf("restaurant: %s cannot be granted through the staff list", role)
	}
	if inviteeID == actorID {
		return nil, errors.New("restaurant: you already have access here")
	}

	// Only an owner mints a manager.
	if role == RoleManager {
		actorRole, _, err := s.ResolveStaffRole(ctx, restaurantID, actorID)
		if err != nil {
			return nil, err
		}
		if actorRole != RoleOwner && !isAdminOverride(ctx) {
			return nil, errors.New("restaurant: only the owner may add a manager")
		}
	}

	plain, hash, err := newInviteToken()
	if err != nil {
		return nil, err
	}

	// ON CONFLICT so re-inviting someone re-issues a token rather than failing on
	// the unique constraint — but never downgrades a live grant back to INVITED,
	// which would silently cut off someone who is currently working.
	const q = `
		INSERT INTO restaurant_staff (restaurant_id, user_id, role, status, invited_by, invite_token_hash)
		VALUES ($1,$2,$3,'INVITED',$4,$5)
		ON CONFLICT (restaurant_id, user_id) DO UPDATE
		   SET role = EXCLUDED.role,
		       invited_by = EXCLUDED.invited_by,
		       invite_token_hash = EXCLUDED.invite_token_hash,
		       status = CASE WHEN restaurant_staff.status = 'ACTIVE' THEN 'ACTIVE' ELSE 'INVITED' END,
		       updated_at = now()`
	if _, err := s.db.Exec(ctx, q, restaurantID, inviteeID, string(role), actorID, hash); err != nil {
		return nil, fmt.Errorf("restaurant: could not create the invite: %w", err)
	}
	// NOT audited yet: this package has no audit collaborator wired (see the TODO
	// on recordOrderEvent). Granting standing authority at a shop is exactly the
	// kind of event that belongs in audit_logs — logged as a gap under A25,
	// scheduled for Phase 3 rather than bolted on here.
	return &StaffInvite{UserID: inviteeID, Role: role, Token: plain}, nil
}

// AcceptStaffInvite redeems a token for the user it was issued to.
// Matching on (user, hash) is what binds the invite to its addressee: a
// forwarded link is useless to anyone else. Requiring status='INVITED' makes it
// single-use, so a replayed token cannot resurrect a suspended or removed grant.
func (s *Service) AcceptStaffInvite(ctx context.Context, token, userID string) error {
	if token == "" {
		return errors.New("restaurant: invalid invite")
	}
	tag, err := s.db.Exec(ctx, `
		UPDATE restaurant_staff
		   SET status = 'ACTIVE', accepted_at = now(), invite_token_hash = NULL, updated_at = now()
		 WHERE user_id = $1 AND invite_token_hash = $2 AND status = 'INVITED'`,
		userID, hashInviteToken(token))
	if err != nil {
		return fmt.Errorf("restaurant: could not accept the invite: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Deliberately one message for "wrong token", "not yours" and "already
		// used": distinguishing them tells an attacker which guess was close.
		return errors.New("restaurant: this invite is not valid")
	}
	return nil
}

// SetStaffStatus suspends, restores or removes a member.
// The OWNER row is untouchable here: it mirrors restaurants.owner_id, and a
// manager with staff authority must not be able to lock the owner out of their
// own business.
func (s *Service) SetStaffStatus(ctx context.Context, restaurantID, actorID, memberID string, status StaffStatus) error {
	if err := s.AssertStaffPermission(ctx, restaurantID, actorID, PermManageStaff); err != nil {
		return err
	}
	switch status {
	case StaffActive, StaffSuspended, StaffRemoved:
	default:
		return fmt.Errorf("restaurant: invalid staff status %q", status)
	}

	memberRole, _, err := s.ResolveStaffRole(ctx, restaurantID, memberID)
	if err != nil {
		return err
	}
	if memberRole == RoleOwner {
		return errors.New("restaurant: the owner's access cannot be changed here")
	}

	tag, err := s.db.Exec(ctx,
		`UPDATE restaurant_staff SET status=$3, updated_at=now()
		  WHERE restaurant_id=$1 AND user_id=$2`, restaurantID, memberID, string(status))
	if err != nil {
		return fmt.Errorf("restaurant: could not update staff: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return errors.New("restaurant: that person is not on this outlet's staff")
	}
	// Not audited yet — see the note in InviteStaff (A25, Phase 3).
	return nil
}

// ListStaff returns the roster for one outlet. Requires PermManageStaff, so a
// cashier cannot enumerate colleagues.
func (s *Service) ListStaff(ctx context.Context, restaurantID, actorID string) ([]StaffMember, error) {
	if err := s.AssertStaffPermission(ctx, restaurantID, actorID, PermManageStaff); err != nil {
		return nil, err
	}
	const q = `
		SELECT st.user_id, COALESCE(u.email,''), st.role, st.status, st.accepted_at, st.created_at
		FROM restaurant_staff st
		LEFT JOIN public.platform_users u ON u.id = st.user_id
		WHERE st.restaurant_id = $1 AND st.status <> 'REMOVED'
		ORDER BY CASE st.role WHEN 'OWNER' THEN 0 WHEN 'MANAGER' THEN 1 ELSE 2 END, st.created_at`
	rows, err := s.db.Query(ctx, q, restaurantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []StaffMember{}
	for rows.Next() {
		var m StaffMember
		var role, status string
		if err := rows.Scan(&m.UserID, &m.Email, &role, &status, &m.AcceptedAt, &m.CreatedAt); err != nil {
			return nil, err
		}
		m.Role, m.Status = StaffRole(role), StaffStatus(status)
		out = append(out, m)
	}
	return out, rows.Err()
}

// UserLookup is the response when searching for a user by email or phone.
type UserLookup struct {
	UserID string `json:"user_id"`
	Email  string `json:"email,omitempty"`
	Phone  string `json:"phone,omitempty"`
	Name   string `json:"name,omitempty"`
}

// LookupUser searches for a user by email or phone number for staff invitation.
func (s *Service) LookupUser(ctx context.Context, query string) (*UserLookup, error) {
	const q = `
		SELECT id, COALESCE(email, ''), COALESCE(phone, ''), COALESCE(NULLIF(btrim(first_name || ' ' || last_name), ''), '')
		FROM public.platform_users
		WHERE (email ILIKE $1 OR phone LIKE $2) AND deleted_at IS NULL
		LIMIT 1`

	searchPattern := "%" + query + "%"
	var u UserLookup
	err := s.db.QueryRow(ctx, q, searchPattern, "%"+query).Scan(
		&u.UserID, &u.Email, &u.Phone, &u.Name,
	)
	if err != nil {
		return nil, fmt.Errorf("user not found: %w", err)
	}
	return &u, nil
}
