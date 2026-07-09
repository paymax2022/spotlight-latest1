package feesroles

import (
	"context"
	"errors"
	"testing"
	"time"
)

// These tests are PURE — no DB, no pgx. The enterprise RBAC service and the user_roles
// read are replaced by an in-memory fakeRBAC that models exactly the two behaviours we
// depend on: (1) scoped permission checks (an actor is "allowed" only for the school+perm
// pairs it was granted), and (2) scoped user_roles rows keyed by (userID, roleID,
// scopeType, scopeID) — so scope isolation across schools is observable. The fake
// implements BOTH RBACGateway and StaffLister.

// ── in-memory fake RBAC (gateway + staff lister) ──────────────────────────────────

type userRoleRow struct {
	userID, roleID, scopeType, scopeID, assignedBy string
	createdAt                                       time.Time
}

type fakeRBAC struct {
	roles []roleRow // seeded roles (slug→id)
	// perms[actorID][schoolID] = holds PermAssignRoles at that school scope.
	perms map[string]map[string]bool
	// assignments is the fake user_roles table.
	assignments []userRoleRow
	// forceCheckErr makes CheckPermission return an error (assert fail-closed).
	forceCheckErr error
	seq           int
}

func newFakeRBAC() *fakeRBAC {
	return &fakeRBAC{
		roles: []roleRow{
			{ID: "role-owner", Slug: string(RoleSchoolOwner), Name: "School Owner"},
			{ID: "role-bursar", Slug: string(RoleBursar), Name: "Bursar"},
			{ID: "role-ct", Slug: string(RoleClassTeacher), Name: "Class Teacher"},
			{ID: "role-ht", Slug: string(RoleHeadTeacher), Name: "Head Teacher"},
		},
		perms: map[string]map[string]bool{},
	}
}

// grantAssignPerm marks that actor holds PermAssignRoles at schoolID (models a school-owner
// or head-teacher grant, or a super-admin bypass).
func (f *fakeRBAC) grantAssignPerm(actorID, schoolID string) {
	if f.perms[actorID] == nil {
		f.perms[actorID] = map[string]bool{}
	}
	f.perms[actorID][schoolID] = true
}

func (f *fakeRBAC) CheckPermission(userID, permission, scopeType, scopeID string) (bool, error) {
	if f.forceCheckErr != nil {
		return false, f.forceCheckErr
	}
	if permission != PermAssignRoles || scopeType != ScopeTypeSchool {
		return false, nil
	}
	return f.perms[userID][scopeID], nil
}

func (f *fakeRBAC) AssignRoleToUser(userID, roleID, scopeType, scopeID, assignedBy string) error {
	// mimic the UNIQUE(user_id, role_id, scope_type, scope_id) upsert-ish behaviour.
	for _, a := range f.assignments {
		if a.userID == userID && a.roleID == roleID && a.scopeType == scopeType && a.scopeID == scopeID {
			return nil
		}
	}
	f.seq++
	f.assignments = append(f.assignments, userRoleRow{
		userID: userID, roleID: roleID, scopeType: scopeType, scopeID: scopeID,
		assignedBy: assignedBy, createdAt: time.Now(),
	})
	return nil
}

func (f *fakeRBAC) RemoveRoleFromUser(actorUserID, userID, roleID string) error {
	// RBAC service deletes by (user_id, role_id) across scopes — mirror that.
	out := f.assignments[:0]
	for _, a := range f.assignments {
		if a.userID == userID && a.roleID == roleID {
			continue
		}
		out = append(out, a)
	}
	f.assignments = out
	return nil
}

func (f *fakeRBAC) ListRoles() ([]roleRow, error) { return f.roles, nil }

// ListStaffForSchool is the fake StaffLister: project user_roles rows scoped to school.
func (f *fakeRBAC) ListStaffForSchool(_ context.Context, schoolID string) ([]StaffAssignment, error) {
	slugByID := map[string]string{}
	nameByID := map[string]string{}
	for _, r := range f.roles {
		slugByID[r.ID] = r.Slug
		nameByID[r.ID] = r.Name
	}
	out := []StaffAssignment{}
	for _, a := range f.assignments {
		if a.scopeType != ScopeTypeSchool || a.scopeID != schoolID {
			continue
		}
		ab := a.assignedBy
		out = append(out, StaffAssignment{
			UserID: a.userID, SchoolID: schoolID, Role: StaffRole(slugByID[a.roleID]),
			RoleName: nameByID[a.roleID], AssignedBy: &ab, AssignedAt: a.createdAt,
		})
	}
	return out, nil
}

func newSvc(f *fakeRBAC) *Service { return NewService(f, f) }

// ── DoD 1: assign → list shows the role; revoke removes it ─────────────────────────

func TestAssignThenListThenRevoke(t *testing.T) {
	f := newFakeRBAC()
	f.grantAssignPerm("owner-1", "school-A") // owner may manage school A
	svc := newSvc(f)
	ctx := context.Background()

	if err := svc.AssignRole(ctx, "school-A", "user-9", RoleBursar, "owner-1"); err != nil {
		t.Fatalf("assign: %v", err)
	}

	staff, err := svc.ListStaff(ctx, "school-A", "owner-1")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(staff) != 1 || staff[0].UserID != "user-9" || staff[0].Role != RoleBursar {
		t.Fatalf("expected user-9 as bursar, got %+v", staff)
	}
	if staff[0].SchoolID != "school-A" {
		t.Fatalf("assignment must carry schoolID=school-A, got %q", staff[0].SchoolID)
	}

	if err := svc.RevokeRole(ctx, "school-A", "user-9", RoleBursar, "owner-1"); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	staff, _ = svc.ListStaff(ctx, "school-A", "owner-1")
	if len(staff) != 0 {
		t.Fatalf("expected no staff after revoke, got %+v", staff)
	}
}

// ── DoD 2: a non-authorized actor (a bursar) cannot assign a role ──────────────────

func TestAssign_NonAuthorizedActorRejected(t *testing.T) {
	f := newFakeRBAC()
	// bursar-7 is staff but was NOT granted PermAssignRoles ⇒ CheckPermission is false.
	svc := newSvc(f)
	ctx := context.Background()

	err := svc.AssignRole(ctx, "school-A", "victim", RoleClassTeacher, "bursar-7")
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected forbidden for unauthorized actor, got %v", err)
	}
	// Nothing was written.
	staff, _ := f.ListStaffForSchool(ctx, "school-A")
	if len(staff) != 0 {
		t.Fatalf("unauthorized assign must not write a row, got %+v", staff)
	}

	// Revoke by an unauthorized actor is likewise rejected.
	f.grantAssignPerm("owner-1", "school-A")
	_ = svc.AssignRole(ctx, "school-A", "victim", RoleClassTeacher, "owner-1")
	if err := svc.RevokeRole(ctx, "school-A", "victim", RoleClassTeacher, "bursar-7"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected forbidden for unauthorized revoke, got %v", err)
	}
}

// ── DoD 3: scope isolation — a grant for school A does not apply to school B ───────

func TestScopeIsolation_SchoolAGrantDoesNotLeakToB(t *testing.T) {
	f := newFakeRBAC()
	// owner-1 may manage school A only.
	f.grantAssignPerm("owner-1", "school-A")
	svc := newSvc(f)
	ctx := context.Background()

	// Assign a bursar in school A.
	if err := svc.AssignRole(ctx, "school-A", "user-9", RoleBursar, "owner-1"); err != nil {
		t.Fatalf("assign A: %v", err)
	}

	// The SAME actor cannot assign in school B (no permission at school-B scope).
	if err := svc.AssignRole(ctx, "school-B", "user-9", RoleBursar, "owner-1"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected forbidden assigning in school-B, got %v", err)
	}

	// The user_roles row is scoped to school A: it appears in A's staff list…
	staffA, _ := f.ListStaffForSchool(ctx, "school-A")
	if len(staffA) != 1 {
		t.Fatalf("expected 1 staff in school-A, got %d", len(staffA))
	}
	// …and NOT in school B's staff list (scope_id isolation).
	staffB, _ := f.ListStaffForSchool(ctx, "school-B")
	if len(staffB) != 0 {
		t.Fatalf("school-A grant must not appear in school-B, got %+v", staffB)
	}
	// Assert the stored row carries scope_type='school' and scope_id='school-A'.
	if len(f.assignments) != 1 {
		t.Fatalf("expected exactly one assignment row, got %d", len(f.assignments))
	}
	row := f.assignments[0]
	if row.scopeType != ScopeTypeSchool || row.scopeID != "school-A" {
		t.Fatalf("assignment must be scope_type='school', scope_id='school-A', got %q/%q", row.scopeType, row.scopeID)
	}
	if row.assignedBy != "owner-1" {
		t.Fatalf("assigned_by must be the actor, got %q", row.assignedBy)
	}
}

// ── Guard rails: closed role set, required inputs, fail-closed RBAC errors ─────────

func TestAssign_RejectsNonStaffRole(t *testing.T) {
	f := newFakeRBAC()
	f.grantAssignPerm("owner-1", "school-A")
	svc := newSvc(f)
	ctx := context.Background()

	for _, bad := range []StaffRole{"guardian", "student", "platform-edtech-admin", "super-admin", ""} {
		if err := svc.AssignRole(ctx, "school-A", "u", bad, "owner-1"); !errors.Is(err, ErrInvalidRole) {
			t.Fatalf("expected invalid_staff_role for %q, got %v", bad, err)
		}
	}
}

func TestAssign_RequiresInputs(t *testing.T) {
	svc := newSvc(newFakeRBAC())
	ctx := context.Background()
	if err := svc.AssignRole(ctx, "school-A", "u", RoleBursar, ""); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("expected unauthenticated for empty actor, got %v", err)
	}
	if err := svc.AssignRole(ctx, "", "u", RoleBursar, "owner-1"); !errors.Is(err, ErrMissingSchool) {
		t.Fatalf("expected missing_school_id, got %v", err)
	}
	if err := svc.AssignRole(ctx, "school-A", " ", RoleBursar, "owner-1"); !errors.Is(err, ErrMissingUser) {
		t.Fatalf("expected missing_user_id, got %v", err)
	}
}

func TestAuthorize_FailClosedOnRBACError(t *testing.T) {
	f := newFakeRBAC()
	f.forceCheckErr = errors.New("rbac down")
	svc := newSvc(f)
	if err := svc.AssignRole(context.Background(), "school-A", "u", RoleBursar, "owner-1"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("RBAC error must fail closed to forbidden, got %v", err)
	}
}

func TestAssign_UnknownRoleSlugNotSeeded(t *testing.T) {
	f := newFakeRBAC()
	f.roles = nil // simulate seed migration not yet applied
	f.grantAssignPerm("owner-1", "school-A")
	svc := newSvc(f)
	if err := svc.AssignRole(context.Background(), "school-A", "u", RoleBursar, "owner-1"); !errors.Is(err, ErrRoleNotFound) {
		t.Fatalf("expected role_not_found when slug unseeded, got %v", err)
	}
}

func TestListStaff_RequiresAuthorization(t *testing.T) {
	f := newFakeRBAC()
	svc := newSvc(f)
	if _, err := svc.ListStaff(context.Background(), "school-A", "stranger"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected forbidden listing staff without permission, got %v", err)
	}
}
