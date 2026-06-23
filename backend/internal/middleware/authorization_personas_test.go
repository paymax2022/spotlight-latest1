package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/services"
)

// authorization_personas_test.go drives the RBAC middleware through the scenario
// personas required by RELEASE_READINESS_CHECKLIST.md §4 (contest manager, state
// coordinator, judge, sponsor, school rep). The goal is object/scope-level
// authorization: a grant in one scope must NOT leak into another scope, and the
// system must deny by default.
//
// We use a scope-aware fake RBAC (grantMap keyed by userID|permission|scopeType|scopeID)
// so CheckPermission models the real "is this user allowed to do X within scope Y"
// decision — the exact decision RequireScopedPermission delegates.

// scopeKey identifies a single grant.
type scopeKey struct {
	user, perm, scopeType, scopeID string
}

// scopedRBAC is a deny-by-default fake: only explicitly granted tuples pass.
type scopedRBAC struct {
	grants map[scopeKey]bool
	err    error // when non-nil, CheckPermission fails closed
}

func newScopedRBAC() *scopedRBAC { return &scopedRBAC{grants: map[scopeKey]bool{}} }

func (s *scopedRBAC) grant(user, perm, scopeType, scopeID string) {
	s.grants[scopeKey{user, perm, scopeType, scopeID}] = true
}

func (s *scopedRBAC) CheckPermission(userID, permission, scopeType, scopeID string) (bool, error) {
	if s.err != nil {
		return false, s.err
	}
	return s.grants[scopeKey{userID, permission, scopeType, scopeID}], nil
}

// --- remaining RBACService methods are unused no-ops for this suite ---
func (s *scopedRBAC) GetUserRoles(string) ([]string, error)                       { return nil, nil }
func (s *scopedRBAC) GetUserScopes(string) ([]domain.UserScope, error)            { return nil, nil }
func (s *scopedRBAC) GetUserPermissions(string, string, string) ([]string, error) { return nil, nil }
func (s *scopedRBAC) ListRoles() ([]domain.Role, error)                           { return nil, nil }
func (s *scopedRBAC) CreateRole(domain.Role) (domain.Role, error)                 { return domain.Role{}, nil }
func (s *scopedRBAC) UpdateRole(string, domain.Role) (domain.Role, error)         { return domain.Role{}, nil }
func (s *scopedRBAC) CloneRole(string, string, string) (domain.Role, error)       { return domain.Role{}, nil }
func (s *scopedRBAC) DeleteRole(string) error                                     { return nil }
func (s *scopedRBAC) ListPermissions() ([]domain.Permission, error)               { return nil, nil }
func (s *scopedRBAC) CreatePermission(domain.Permission) (domain.Permission, error) {
	return domain.Permission{}, nil
}
func (s *scopedRBAC) UpdatePermission(string, domain.Permission) (domain.Permission, error) {
	return domain.Permission{}, nil
}
func (s *scopedRBAC) GetPermissionMatrix() (services.PermissionMatrix, error) {
	return services.PermissionMatrix{}, nil
}
func (s *scopedRBAC) AssignPermissionToRole(string, string, string) error           { return nil }
func (s *scopedRBAC) RemovePermissionFromRole(string, string) error                 { return nil }
func (s *scopedRBAC) DeletePermission(string) error                                 { return nil }
func (s *scopedRBAC) AssignRoleToUser(string, string, string, string, string) error { return nil }
func (s *scopedRBAC) RemoveRoleFromUser(string, string, string) error               { return nil }
func (s *scopedRBAC) GetUserStatus(string) (string, error)                          { return "active", nil }
func (s *scopedRBAC) SuspendUser(string) error                                      { return nil }
func (s *scopedRBAC) UnsuspendUser(string) error                                    { return nil }
func (s *scopedRBAC) LockUser(string) error                                         { return nil }
func (s *scopedRBAC) UnlockUser(string) error                                       { return nil }
func (s *scopedRBAC) ListAdminUsers(domain.AdminUserFilter) ([]domain.AdminUser, error) {
	return nil, nil
}
func (s *scopedRBAC) GetAdminUser(string) (domain.AdminUser, error) { return domain.AdminUser{}, nil }
func (s *scopedRBAC) UpdateAdminUser(string, map[string]any) (domain.AdminUser, error) {
	return domain.AdminUser{}, nil
}

// scopedRouter builds a router that injects userID as the authed user and gates
// GET /scope/:scopeID on RequireScopedPermission(perm, scopeType, "scopeID").
func scopedRouter(rbac services.RBACService, userID, perm, scopeType string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(AuthUserContextKey, domain.AuthenticatedUser{ID: userID})
		c.Next()
	})
	r.GET("/scope/:scopeID",
		RequireScopedPermission(rbac, perm, scopeType, "scopeID"),
		func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) },
	)
	return r
}

func doGet(r *gin.Engine, path string) int {
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	return w.Code
}

// --- Contest manager: scoped to a single contest -----------------------------

func TestPersona_ContestManager_ScopedAllowAndCrossScopeDeny(t *testing.T) {
	rbac := newScopedRBAC()
	rbac.grant("mgr-1", "contest.manage", "contest", "contest-A")
	r := scopedRouter(rbac, "mgr-1", "contest.manage", "contest")

	if code := doGet(r, "/scope/contest-A"); code != http.StatusOK {
		t.Errorf("manager on own contest: got %d, want 200", code)
	}
	// Cross-scope isolation: same permission, different contest -> forbidden.
	if code := doGet(r, "/scope/contest-B"); code != http.StatusForbidden {
		t.Errorf("manager on foreign contest: got %d, want 403", code)
	}
}

// --- State coordinator: scoped to a state ------------------------------------

func TestPersona_StateCoordinator_ScopeIsolation(t *testing.T) {
	rbac := newScopedRBAC()
	rbac.grant("coord-lagos", "applicants.review", "state", "lagos")
	r := scopedRouter(rbac, "coord-lagos", "applicants.review", "state")

	if code := doGet(r, "/scope/lagos"); code != http.StatusOK {
		t.Errorf("coordinator in own state: got %d, want 200", code)
	}
	if code := doGet(r, "/scope/kano"); code != http.StatusForbidden {
		t.Errorf("coordinator in foreign state: got %d, want 403", code)
	}
}

// --- Judge: scoped to a contest, NO write outside judging --------------------

func TestPersona_Judge_CannotActOutsideAssignedContest(t *testing.T) {
	rbac := newScopedRBAC()
	rbac.grant("judge-1", "scores.submit", "contest", "contest-X")
	r := scopedRouter(rbac, "judge-1", "scores.submit", "contest")

	if code := doGet(r, "/scope/contest-X"); code != http.StatusOK {
		t.Errorf("judge scoring own contest: got %d, want 200", code)
	}
	if code := doGet(r, "/scope/contest-Y"); code != http.StatusForbidden {
		t.Errorf("judge scoring foreign contest: got %d, want 403", code)
	}
}

// --- Sponsor: read-only on sponsored program, denied on others ---------------

func TestPersona_Sponsor_DeniedWritePermission(t *testing.T) {
	rbac := newScopedRBAC()
	// Sponsor is granted ONLY analytics.view on their program.
	rbac.grant("sponsor-1", "analytics.view", "program", "prog-1")

	// Granted read permission passes.
	rRead := scopedRouter(rbac, "sponsor-1", "analytics.view", "program")
	if code := doGet(rRead, "/scope/prog-1"); code != http.StatusOK {
		t.Errorf("sponsor analytics.view: got %d, want 200", code)
	}
	// A write permission they were NOT granted is denied by default.
	rWrite := scopedRouter(rbac, "sponsor-1", "contest.manage", "program")
	if code := doGet(rWrite, "/scope/prog-1"); code != http.StatusForbidden {
		t.Errorf("sponsor attempting manage: got %d, want 403", code)
	}
}

// --- School rep: scoped to a school ------------------------------------------

func TestPersona_SchoolRep_ScopeBoundToOwnSchool(t *testing.T) {
	rbac := newScopedRBAC()
	rbac.grant("rep-1", "students.manage", "school", "school-7")
	r := scopedRouter(rbac, "rep-1", "students.manage", "school")

	if code := doGet(r, "/scope/school-7"); code != http.StatusOK {
		t.Errorf("rep on own school: got %d, want 200", code)
	}
	if code := doGet(r, "/scope/school-9"); code != http.StatusForbidden {
		t.Errorf("rep on foreign school: got %d, want 403", code)
	}
}

// --- Deny-by-default: an ungranted user is forbidden everywhere ---------------

func TestPersona_UngrantedUser_DeniedByDefault(t *testing.T) {
	rbac := newScopedRBAC() // no grants at all
	r := scopedRouter(rbac, "stranger", "contest.manage", "contest")
	for _, id := range []string{"contest-A", "contest-B", ""} {
		if code := doGet(r, "/scope/"+id); code != http.StatusForbidden && code != http.StatusNotFound {
			// "" routes to a different path (404), anything resolved must be 403.
			if id != "" {
				t.Errorf("ungranted user on %q: got %d, want 403", id, code)
			}
		}
	}
}

// --- Fail-closed: an RBAC backend error must DENY, never allow ----------------

func TestScopedPermission_FailsClosedOnError(t *testing.T) {
	rbac := newScopedRBAC()
	rbac.grant("u", "p", "contest", "c") // would normally pass
	rbac.err = errBackendDown            // ...but the backend is erroring
	r := scopedRouter(rbac, "u", "p", "contest")
	if code := doGet(r, "/scope/c"); code != http.StatusForbidden {
		t.Errorf("fail-closed: got %d, want 403 when RBAC errors", code)
	}
}

// --- Unauthenticated: no auth context -> 401 ---------------------------------

func TestScopedPermission_UnauthenticatedIs401(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rbac := newScopedRBAC()
	r := gin.New() // NOTE: no auth-injecting middleware
	r.GET("/scope/:scopeID",
		RequireScopedPermission(rbac, "p", "contest", "scopeID"),
		func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) },
	)
	if code := doGet(r, "/scope/c"); code != http.StatusUnauthorized {
		t.Errorf("missing auth context: got %d, want 401", code)
	}
}

type backendErr struct{}

func (backendErr) Error() string { return "rbac backend unavailable" }

var errBackendDown = backendErr{}
