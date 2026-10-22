package estate

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Guard/visitor-access UAT (SP-01 + SP-02). See docs/uat/estate/gap-analysis.md
// themes 1 (self-grantable privileges) and 2 (gate loop not enforced).

// Sentinel authz errors so handlers/tests can branch on them rather than strings.
var (
	ErrNotMember                     = errors.New("estate: not a member of this estate")
	ErrAccountDeleted                = errors.New("estate: this account has been deleted")
	ErrAccountBanned                 = errors.New("estate: this account is banned from the estate")
	ErrInsufficientRole              = errors.New("estate: insufficient role")
	ErrEstateManagerApprovalRequired = errors.New("estate: an approved estate-management merchant is required to create an estate")
)

// staffRoles are the delegated, expiring capabilities a grant may carry. They are
// deliberately NOT estate_admin (that remains the residents-table super role).
var staffRoles = map[string]bool{
	"gate_officer":      true,
	"gate_supervisor":   true,
	"finance_officer":   true,
	"election_officer":  true,
	"facility_officer":  true,
	"meeting_secretary": true,
	"auditor":           true,
}

// EstateMerchantGate authorises estate creation from the merchant-onboarding
// subsystem. Implemented in the app layer so the estate package stays free of an
// onboarding import.
type EstateMerchantGate interface {
	CanCreateEstate(ctx context.Context, userID string) (bool, error)
}

// EstateMerchantGateFunc adapts a plain function to EstateMerchantGate.
type EstateMerchantGateFunc func(ctx context.Context, userID string) (bool, error)

func (f EstateMerchantGateFunc) CanCreateEstate(ctx context.Context, userID string) (bool, error) {
	return f(ctx, userID)
}

// WithEstateMerchantGate wires the creation gate. When unset, CreateEstate keeps
// its historical behaviour (any authenticated user may create an estate).
func (s *Service) WithEstateMerchantGate(g EstateMerchantGate) *Service {
	s.merchantGate = g
	return s
}

// hasLiveGrant reports whether userID holds an un-revoked, un-expired grant for any
// of roles in estateID.
func (s *Service) hasLiveGrant(ctx context.Context, estateID, userID string, roles []string) (bool, error) {
	if len(roles) == 0 {
		return false, nil
	}
	var ok bool
	err := s.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM estate_staff_grants
			WHERE estate_id=$1 AND user_id=$2
			  AND revoked_at IS NULL
			  AND (expires_at IS NULL OR expires_at > NOW())
			  AND role = ANY($3::text[])
		)`, estateID, userID, roles).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("estate: grant lookup: %w", err)
	}
	return ok, nil
}

// assertGate authorises a guard/gate operation. Passes for an estate_admin or a
// member holding any of the live roles. Fails closed on non-members, banned or
// deleted accounts. This replaces the previous assertResident on the guard
// endpoints, which let ANY estate member admit visitors and forge gate events.
func (s *Service) assertGate(ctx context.Context, estateID, userID string, roles ...string) error {
	var role string
	var banned, deleted bool
	err := s.db.QueryRow(ctx,
		`SELECT role, banned_at IS NOT NULL, deleted_at IS NOT NULL
		 FROM estate_residents WHERE estate_id=$1 AND user_id=$2`, estateID, userID,
	).Scan(&role, &banned, &deleted)
	if err != nil {
		return ErrNotMember
	}
	if deleted {
		return ErrAccountDeleted
	}
	if banned {
		return ErrAccountBanned
	}
	if role == "estate_admin" {
		return nil
	}
	ok, err := s.hasLiveGrant(ctx, estateID, userID, roles)
	if err != nil {
		return err
	}
	if !ok {
		return ErrInsufficientRole
	}
	return nil
}

// guardRoles is the role set permitted to admit/scan visitors.
var guardRoles = []string{"gate_officer", "gate_supervisor"}

// GrantRole lets an estate_admin delegate a scoped, optionally expiring officer
// role. The super role estate_admin is never grantable here (added via residents).
func (s *Service) GrantRole(ctx context.Context, estateID, adminID, userID, role string, expiresAt *time.Time) (*StaffGrant, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if !staffRoles[role] {
		return nil, errors.New("estate: unknown staff role")
	}
	if userID == "" {
		return nil, errors.New("estate: user_id required")
	}
	// A grantee must already be an estate member; delegation layers on membership.
	if _, err := s.getResidentID(ctx, estateID, userID); err != nil {
		return nil, err
	}
	g := &StaffGrant{
		ID:        uuid.New().String(),
		EstateID:  estateID,
		UserID:    userID,
		Role:      role,
		GrantedBy: adminID,
		ExpiresAt: expiresAt,
	}
	const q = `
		INSERT INTO estate_staff_grants (id, estate_id, user_id, role, granted_by, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (estate_id, user_id, role)
		DO UPDATE SET granted_by=EXCLUDED.granted_by, expires_at=EXCLUDED.expires_at, revoked_at=NULL
		RETURNING estate_id, granted_at`
	err := s.db.QueryRow(ctx, q, g.ID, g.EstateID, g.UserID, g.Role, g.GrantedBy, expiresAt).
		Scan(&g.EstateID, &g.GrantedAt)
	if err != nil {
		return nil, err
	}
	_ = s.audit(ctx, estateID, adminID, "STAFF_GRANT", "staff_grant", g.ID,
		map[string]any{"user_id": userID, "role": role})
	return g, nil
}

// RevokeRole lets an estate_admin revoke a delegated role immediately.
func (s *Service) RevokeRole(ctx context.Context, estateID, adminID, userID, role string) error {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return err
	}
	tag, err := s.db.Exec(ctx,
		`UPDATE estate_staff_grants SET revoked_at=NOW()
		 WHERE estate_id=$1 AND user_id=$2 AND role=$3 AND revoked_at IS NULL`,
		estateID, userID, role)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("estate: no active grant to revoke")
	}
	return s.audit(ctx, estateID, adminID, "STAFF_REVOKE", "staff_grant", userID,
		map[string]any{"role": role})
}

// ListGrants returns the live delegated grants for an estate (estate_admin only).
func (s *Service) ListGrants(ctx context.Context, estateID, adminID string) ([]StaffGrant, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	const q = `SELECT id, estate_id, user_id, role, granted_by, granted_at, expires_at, revoked_at
		FROM estate_staff_grants WHERE estate_id=$1 ORDER BY granted_at DESC LIMIT 200`
	rows, err := s.db.Query(ctx, q, estateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []StaffGrant
	for rows.Next() {
		var g StaffGrant
		if err := rows.Scan(&g.ID, &g.EstateID, &g.UserID, &g.Role, &g.GrantedBy, &g.GrantedAt, &g.ExpiresAt, &g.RevokedAt); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// RequestArrival lets a guard raise a host-approval request for a code that requires
// it. It does not admit the visitor; it only opens the pending request.
func (s *Service) RequestArrival(ctx context.Context, estateID, guardID, codeID string, gateID string) (string, error) {
	if err := s.assertGate(ctx, estateID, guardID, guardRoles...); err != nil {
		return "", err
	}
	var hostID string
	var requiresApproval bool
	err := s.db.QueryRow(ctx,
		`SELECT issued_by, require_host_approval FROM visitor_access_codes WHERE id=$1 AND estate_id=$2`,
		codeID, estateID,
	).Scan(&hostID, &requiresApproval)
	if err != nil {
		return "", errors.New("access code not found in this estate")
	}
	if !requiresApproval {
		return "", errors.New("estate: this code does not require host approval")
	}
	id := uuid.New().String()
	_, err = s.db.Exec(ctx,
		`INSERT INTO visitor_arrival_requests (id, estate_id, access_code_id, host_id, gate_id, status)
		 VALUES ($1,$2,$3,$4,NULLIF($5,'')::uuid,'pending')`,
		id, estateID, codeID, hostID, gateID)
	if err != nil {
		return "", err
	}
	s.notify(ctx, estateID, hostID, "visitor_arrival", "Visitor at the gate", "A visitor with your access code is at the gate and awaiting your approval.",
		map[string]any{"access_code_id": codeID, "arrival_request_id": id})
	return id, nil
}

// DecideArrival lets the issuing host accept or decline a pending arrival for their
// own code. Only the host (or estate_admin) may decide.
func (s *Service) DecideArrival(ctx context.Context, estateID, userID, requestID string, approve bool) error {
	var hostID string
	var status string
	err := s.db.QueryRow(ctx,
		`SELECT host_id, status FROM visitor_arrival_requests WHERE id=$1 AND estate_id=$2`,
		requestID, estateID,
	).Scan(&hostID, &status)
	if err != nil {
		return errors.New("arrival request not found in this estate")
	}
	if hostID != userID {
		if aerr := s.assertEstateAdmin(ctx, estateID, userID); aerr != nil {
			return ErrInsufficientRole
		}
	}
	if status != "pending" {
		return errors.New("estate: arrival already decided")
	}
	decision := "declined"
	if approve {
		decision = "approved"
	}
	_, err = s.db.Exec(ctx,
		`UPDATE visitor_arrival_requests SET status=$1, decided_by=$2, decided_at=NOW()
		 WHERE id=$3 AND status='pending'`,
		decision, userID, requestID)
	return err
}

// latestArrivalStatus returns the most recent arrival-request status for a code, or
// "none" when there is no request. Used by the guard admit path to honour
// host-approval-gated codes.
func (s *Service) latestArrivalStatus(ctx context.Context, codeID string) (string, error) {
	var status string
	err := s.db.QueryRow(ctx,
		`SELECT status FROM visitor_arrival_requests
		 WHERE access_code_id=$1 ORDER BY requested_at DESC LIMIT 1`, codeID,
	).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "none", nil
	}
	if err != nil {
		return "", err
	}
	return status, nil
}
