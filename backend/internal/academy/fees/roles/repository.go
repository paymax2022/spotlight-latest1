package feesroles

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RBACGateway is the SUBSET of services.RBACService this package needs to assign/revoke
// scoped roles and resolve slug→id. It is an in-package interface (satisfied directly by
// *services.rbacService, which implements services.RBACService) so the authorization
// logic is unit-testable with an in-memory fake — no live DB, no parallel authz layer.
//
// Reuse notes:
//   - AssignRoleToUser / RemoveRoleFromUser are the EXISTING RBAC mutations; we do NOT
//     insert into user_roles with raw SQL. AssignRoleToUser writes a user_roles row with
//     (scope_type='school', scope_id=<schoolID>); RemoveRoleFromUser deletes by
//     (user_id, role_id) — the service also protects the last-super-admin invariant.
//   - ListRoles resolves a role slug → role_id (the RBAC mutations key off role_id).
//   - CheckPermission is the authorization gate (actor must hold PermAssignRoles at the
//     'school' scope for this schoolID; super-admin bypasses inside the RBAC layer).
type RBACGateway interface {
	CheckPermission(userID, permission, scopeType, scopeID string) (bool, error)
	AssignRoleToUser(userID, roleID, scopeType, scopeID, assignedBy string) error
	RemoveRoleFromUser(actorUserID, userID, roleID string) error
	ListRoles() ([]roleRow, error)
}

// roleRow is the minimal shape needed to map slug→id/name. It intentionally mirrors the
// fields the service consumes from domain.Role so the adapter (see rbacServiceAdapter in
// handler.go) can bridge services.RBACService without importing domain here.
type roleRow struct {
	ID   string
	Slug string
	Name string
}

// StaffLister reads staff assignments for a school directly from the EXISTING RBAC tables
// (public.user_roles JOIN public.roles) filtered to scope_type='school' AND
// scope_id=<schoolID>. There is no list-by-scope method on services.RBACService, so this
// read is provided here — it queries the same tables the RBAC system owns (it is NOT a
// second store) and follows the existing schema exactly. Substituted by an in-memory fake
// in tests.
type StaffLister interface {
	ListStaffForSchool(ctx context.Context, schoolID string) ([]StaffAssignment, error)
}

// Repository is the pgx-backed StaffLister over public.user_roles / public.roles.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository builds the pgx-backed StaffLister.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// querier abstracts *pgxpool.Pool and pgx.Tx (parity with sibling fees packages).
type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// ListStaffForSchool returns every active school-scoped staff assignment for a school,
// restricted to the fees staff roles (school-owner/bursar/class-teacher/head-teacher).
// It reads the canonical RBAC tables — active, unexpired rows only — so it stays a true
// projection of user_roles and never drifts from the authz source of truth.
func (r *Repository) ListStaffForSchool(ctx context.Context, schoolID string) ([]StaffAssignment, error) {
	const q = `
		SELECT ur.user_id, r.slug, r.name, ur.assigned_by, ur.created_at
		FROM public.user_roles ur
		JOIN public.roles r ON r.id = ur.role_id
		WHERE ur.scope_type = 'school'
		  AND ur.scope_id = $1
		  AND ur.is_active = true
		  AND r.is_active = true
		  AND (ur.expires_at IS NULL OR ur.expires_at > now())
		  AND r.slug IN ('school-owner','bursar','class-teacher','head-teacher')
		ORDER BY r.slug ASC, ur.created_at ASC`
	rows, err := r.db.Query(ctx, q, schoolID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []StaffAssignment{}
	for rows.Next() {
		var a StaffAssignment
		var slug string
		if err := rows.Scan(&a.UserID, &slug, &a.RoleName, &a.AssignedBy, &a.AssignedAt); err != nil {
			return nil, err
		}
		a.SchoolID = schoolID
		a.Role = StaffRole(slug)
		out = append(out, a)
	}
	return out, rows.Err()
}
