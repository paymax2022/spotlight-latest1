package feesroles

import (
	"context"
	"strings"
)

// Service assigns/revokes school-scoped staff roles and lists a school's staff. It owns
// NO authz logic of its own: every mutation and the actor-authorization check delegate to
// the injected RBACGateway (the real enterprise RBAC service) so there is exactly ONE
// authorization source of truth. It moves NO money.
//
// A role assignment is a scoped user_roles row (scope_type='school', scope_id=schoolID).
// Only an actor holding PermAssignRoles AT that school (school-owner / head-teacher, or a
// platform/super admin who bypasses in the RBAC layer) may assign or revoke — enforced
// fail-closed BEFORE any mutation.
type Service struct {
	rbac  RBACGateway
	staff StaffLister
}

// NewService injects the RBAC gateway (assign/revoke/authorize/slug-resolve) and the
// staff lister (read projection over user_roles). Both are interfaces so tests use
// in-memory fakes with no live DB.
func NewService(rbac RBACGateway, staff StaffLister) *Service {
	return &Service{rbac: rbac, staff: staff}
}

// AssignRole grants a school-scoped staff role to a user. Order is strictly fail-closed:
//  1. actor must be authenticated,
//  2. school + target user must be present,
//  3. role must be an assignable staff role (closed set),
//  4. actor must hold PermAssignRoles AT this school (RBAC scoped check),
//  5. resolve slug→role_id, then delegate to the RBAC service (which writes the scoped
//     user_roles row with scope_type='school', scope_id=schoolID, assigned_by=actorID).
func (s *Service) AssignRole(ctx context.Context, schoolID, userID string, role StaffRole, actorID string) error {
	if actorID == "" {
		return ErrUnauthenticated
	}
	if strings.TrimSpace(schoolID) == "" {
		return ErrMissingSchool
	}
	if strings.TrimSpace(userID) == "" {
		return ErrMissingUser
	}
	if !role.IsAssignable() {
		return ErrInvalidRole
	}
	if err := s.authorizeActor(schoolID, actorID); err != nil {
		return err
	}
	roleID, err := s.resolveRoleID(role)
	if err != nil {
		return err
	}
	// Delegate the write to the EXISTING RBAC service — scoped to this school. This is the
	// single place a user_roles row is created; scope_id carries schoolID so the grant is
	// isolated to this school (scope isolation).
	return s.rbac.AssignRoleToUser(userID, roleID, ScopeTypeSchool, schoolID, actorID)
}

// RevokeRole removes a school-scoped staff role from a user. Same fail-closed actor
// authorization as AssignRole; delegates the delete to the RBAC service.
//
// NOTE: services.RBACService.RemoveRoleFromUser keys off (user_id, role_id) and enforces
// the last-super-admin invariant. Since this surface can only ever grant the four fees
// staff roles at school scope, a super-admin grant is never created or removed here.
func (s *Service) RevokeRole(ctx context.Context, schoolID, userID string, role StaffRole, actorID string) error {
	if actorID == "" {
		return ErrUnauthenticated
	}
	if strings.TrimSpace(schoolID) == "" {
		return ErrMissingSchool
	}
	if strings.TrimSpace(userID) == "" {
		return ErrMissingUser
	}
	if !role.IsAssignable() {
		return ErrInvalidRole
	}
	if err := s.authorizeActor(schoolID, actorID); err != nil {
		return err
	}
	roleID, err := s.resolveRoleID(role)
	if err != nil {
		return err
	}
	return s.rbac.RemoveRoleFromUser(actorID, userID, roleID)
}

// ListStaff returns the staff (with roles) for a school. Reading the staff list requires
// the same actor authorization as mutating it (a school's roster of staff/roles is
// sensitive) — fail-closed.
func (s *Service) ListStaff(ctx context.Context, schoolID, actorID string) ([]StaffAssignment, error) {
	if actorID == "" {
		return nil, ErrUnauthenticated
	}
	if strings.TrimSpace(schoolID) == "" {
		return nil, ErrMissingSchool
	}
	if err := s.authorizeActor(schoolID, actorID); err != nil {
		return nil, err
	}
	return s.staff.ListStaffForSchool(ctx, schoolID)
}

// authorizeActor is the fail-closed gate: the actor must hold PermAssignRoles at the
// 'school' scope for this schoolID. Any RBAC error OR a false result denies (ErrForbidden)
// — we never fail open. super-admin / platform_edtech_admin bypass is handled inside the
// RBAC layer (public.user_has_permission), so we do not special-case them here.
func (s *Service) authorizeActor(schoolID, actorID string) error {
	allowed, err := s.rbac.CheckPermission(actorID, PermAssignRoles, ScopeTypeSchool, schoolID)
	if err != nil || !allowed {
		return ErrForbidden
	}
	return nil
}

// resolveRoleID maps a staff role slug → role_id using the RBAC service's ListRoles. The
// RBAC mutations key off role_id, and roles are seeded by the integration migration
// (report handoff), so a missing slug means the seed has not run ⇒ ErrRoleNotFound
// (fail-closed rather than silently creating a role here).
func (s *Service) resolveRoleID(role StaffRole) (string, error) {
	roles, err := s.rbac.ListRoles()
	if err != nil {
		return "", err
	}
	for _, r := range roles {
		if r.Slug == string(role) {
			return r.ID, nil
		}
	}
	return "", ErrRoleNotFound
}
