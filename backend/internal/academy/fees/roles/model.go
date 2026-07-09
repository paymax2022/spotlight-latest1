package feesroles

import (
	"errors"
	"time"
)

// Package feesroles is the EdTech School-Fees staff role-management surface (task E11).
//
// It is a THIN wrapper over the existing enterprise RBAC system — it does NOT build a
// parallel authz layer, a second roles/permissions store, or its own user_roles table.
// A staff-role assignment IS a scoped `public.user_roles` row with
// scope_type='school' and scope_id=<schoolID> (verified against
// 20260527100000_enterprise_auth_rbac.sql, whose scope_type CHECK already includes
// 'school'). Assign/revoke go through the injected RBAC service (RBACGateway); listing
// staff reads the same user_roles/roles tables via a narrow StaffLister.
//
// Conventions mirror academy/fees/school: sentinel errors mapped to snake_case codes by
// the handler, an injected data-access interface so the authorization logic is unit
// testable with in-memory fakes, and NO money movement here.

// StaffRole is a school-scoped staff role that may be assigned to a user for a specific
// school. The slug matches the role's `public.roles.slug` seeded by the integration
// migration (see report handoff). Guardian and student are deliberately NOT here: they
// are self-service capabilities, not staff-assigned. platform_edtech_admin is a
// platform-level (global-scope) role, out of per-school scope, so it is excluded too.
type StaffRole string

const (
	RoleSchoolOwner  StaffRole = "school-owner"
	RoleBursar       StaffRole = "bursar"
	RoleClassTeacher StaffRole = "class-teacher"
	RoleHeadTeacher  StaffRole = "head-teacher"
)

// AssignableStaffRoles is the closed set of roles this service may assign at school scope.
// Any slug outside this set is rejected with ErrInvalidRole (fail-closed) — you cannot,
// e.g., grant 'guardian', 'student', 'platform-edtech-admin' or 'super-admin' via this
// per-school surface.
var AssignableStaffRoles = map[StaffRole]struct{}{
	RoleSchoolOwner:  {},
	RoleBursar:       {},
	RoleClassTeacher: {},
	RoleHeadTeacher:  {},
}

// IsAssignable reports whether r is a staff role this service may assign at school scope.
func (r StaffRole) IsAssignable() bool {
	_, ok := AssignableStaffRoles[r]
	return ok
}

// ScopeTypeSchool is the RBAC scope_type used for every fees staff assignment. It already
// exists in the user_roles.scope_type CHECK — no schema change required.
const ScopeTypeSchool = "school"

// PermAssignRoles is the RBAC permission slug (module.resource.action) an actor must hold
// AT school scope to assign/revoke staff roles within that school. Granted (by the
// integration seed migration) to school-owner and head-teacher; super-admin bypasses;
// platform_edtech_admin holds the platform-wide equivalent. Enforced fail-closed.
const PermAssignRoles = "academy.fees.roles.assign"

// StaffAssignment is one staff member's role at a school (a projection of a scoped
// user_roles row joined to roles).
type StaffAssignment struct {
	UserID     string    `json:"userId"`
	SchoolID   string    `json:"schoolId"`
	Role       StaffRole `json:"role"`
	RoleName   string    `json:"roleName,omitempty"`
	AssignedBy *string   `json:"assignedBy,omitempty"`
	AssignedAt time.Time `json:"assignedAt"`
}

// ── Request DTOs ─────────────────────────────────────────────────────────────────

// AssignRoleRequest assigns a staff role to a user for a school. The school id comes from
// the route param; the actor is the authenticated caller (never trusted from the body).
type AssignRoleRequest struct {
	UserID string `json:"userId" binding:"required"`
	Role   string `json:"role" binding:"required"`
}

// RevokeRoleRequest revokes a previously-assigned staff role from a user for a school.
type RevokeRoleRequest struct {
	UserID string `json:"userId" binding:"required"`
	Role   string `json:"role" binding:"required"`
}

// ── Sentinel errors (mapped to snake_case codes by the handler) ───────────────────

var (
	ErrUnauthenticated = errors.New("unauthenticated")
	ErrForbidden       = errors.New("forbidden")
	ErrInvalidRole     = errors.New("invalid_staff_role")
	ErrMissingSchool   = errors.New("missing_school_id")
	ErrMissingUser     = errors.New("missing_user_id")
	ErrRoleNotFound    = errors.New("role_not_found")
)
