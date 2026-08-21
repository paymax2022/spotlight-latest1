package restaurant

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"
)

// ── Staff invites (foodhub A18) ─────────────────────────────────────────────
//
// An invite is a CREDENTIAL: whoever redeems it gains standing authority at a
// real shop — the menu, the order queue, sometimes the earnings. It is therefore
// handled like a password rather than like data:
//
//   - a 256-bit random token, returned to the inviter exactly once;
//   - only its SHA-256 hash at rest, so a dump of restaurant_staff cannot be
//     used to accept anybody's outstanding invites;
//   - bound to the invited user, so a forwarded link is useless to anyone else;
//   - single-use, so a replayed token cannot resurrect a grant that was later
//     suspended or removed.
//
// The grant graph is also kept acyclic: only an OWNER may create a MANAGER.
// Without that, two managers can promote each other's nominees indefinitely and
// the owner's control over their own business becomes nominal.

// StaffMember is one row of the roster. The token hash is deliberately absent.
type StaffMember struct {
	UserID     string     `json:"user_id"`
	Email      string     `json:"email,omitempty"`
	Role       StaffRole  `json:"role"`
	Status     StaffStatus `json:"status"`
	AcceptedAt *time.Time `json:"accepted_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
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

func newInviteToken() (plain, hash string, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", fmt.Errorf("restaurant: could not generate an invite token: %w", err)
	}
	plain = hex.EncodeToString(b)
	return plain, hashInviteToken(plain), nil
}

func hashInviteToken(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}

// InviteStaff grants a role at one outlet, pending acceptance.
//
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
		return nil, fmt.Errorf("restaurant: you already have access here")
	}

	// Only an owner mints a manager.
	if role == RoleManager {
		actorRole, _, err := s.ResolveStaffRole(ctx, restaurantID, actorID)
		if err != nil {
			return nil, err
		}
		if actorRole != RoleOwner && !isAdminOverride(ctx) {
			return nil, fmt.Errorf("restaurant: only the owner may add a manager")
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
//
// Matching on (user, hash) is what binds the invite to its addressee: a
// forwarded link is useless to anyone else. Requiring status='INVITED' makes it
// single-use, so a replayed token cannot resurrect a suspended or removed grant.
func (s *Service) AcceptStaffInvite(ctx context.Context, token, userID string) error {
	if token == "" {
		return fmt.Errorf("restaurant: invalid invite")
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
		return fmt.Errorf("restaurant: this invite is not valid")
	}
	return nil
}

// SetStaffStatus suspends, restores or removes a member.
//
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
		return fmt.Errorf("restaurant: the owner's access cannot be changed here")
	}

	tag, err := s.db.Exec(ctx,
		`UPDATE restaurant_staff SET status=$3, updated_at=now()
		  WHERE restaurant_id=$1 AND user_id=$2`, restaurantID, memberID, string(status))
	if err != nil {
		return fmt.Errorf("restaurant: could not update staff: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("restaurant: that person is not on this outlet's staff")
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
		LEFT JOIN auth.users u ON u.id = st.user_id
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
