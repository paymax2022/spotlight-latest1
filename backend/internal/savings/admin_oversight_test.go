package savings

// Route-mount + guard regression for the wave-12 admin-oversight residual —
// the savings twin of the social #625 fix: the admin route
// /api/savings/admin/circles/:id pointed at the MEMBER GetCircle handler, so
// an ops admin holding savings.admin.view who was not a circle member was
// denied exactly like an outsider, silently losing the oversight the RBAC
// grant exists for. The fix mounts dedicated AdminGetCircle /
// AdminGetCircleMembers oversight handlers behind savings.admin.view; the
// member routes stay member-scoped.
//
// These tests pin the mount + guard ordering DB-free; the read behaviour,
// the uniform-404 member oracle and the audit row are proven live in
// admin_oversight_live_db_test.go.

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRegister_AdminOversightRoutes_MountedAndGuarded(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	member := r.Group("/api/finance")
	admin := r.Group("/api/savings/admin")

	var perms []string
	guard := func(p string) gin.HandlerFunc {
		perms = append(perms, p)
		return func(c *gin.Context) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"success": false, "error": "denied"})
		}
	}
	// Nil services are safe: every request below is refused at the guard, so
	// no handler body ever touches the service.
	h := NewHandler(nil, nil, nil)
	h.Register(member, admin, guard)

	routes := map[string]bool{}
	for _, rt := range r.Routes() {
		routes[rt.Method+" "+rt.Path] = true
	}
	for _, want := range []string{
		"GET /api/savings/admin/circles/:id",
		"GET /api/savings/admin/circles/:id/members",
	} {
		if !routes[want] {
			t.Errorf("admin oversight route missing: %s", want)
		}
	}
	// Auth, not just existence: EVERY admin route must sit behind
	// savings.admin.view — a plain-authenticated member must not reach it.
	if len(perms) != 2 {
		t.Fatalf("guard invoked %d times, want 2 (one per admin route)", len(perms))
	}
	for _, p := range perms {
		if p != "savings.admin.view" {
			t.Errorf("admin route guarded by %q, want savings.admin.view", p)
		}
	}

	// The guard must run BEFORE the handler: a denied caller is refused at
	// the middleware and never reaches the (nil-service) handler.
	for _, path := range []string{"/api/savings/admin/circles/x", "/api/savings/admin/circles/x/members"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusForbidden {
			t.Fatalf("%s: guard bypassed (got %d) — handler ran without permission", path, w.Code)
		}
	}
}

// The member oracle must stay closed: Register must keep mounting the
// member-scoped GetCircle on the member group, and must NOT mount any
// oversight handler there.
func TestRegister_MemberGroup_KeepsMemberScopedCircleOnly(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	member := r.Group("/api/finance")
	h := NewHandler(nil, nil, nil)
	h.Register(member, nil, nil)

	routes := map[string]bool{}
	for _, rt := range r.Routes() {
		routes[rt.Method+" "+rt.Path] = true
	}
	if !routes["GET /api/finance/savings/circles/:id"] {
		t.Error("member circle read missing: GET /api/finance/savings/circles/:id")
	}
	// No admin-shaped route may appear under the member prefix.
	for rt := range routes {
		if rt == "GET /api/finance/savings/circles/:id/members" {
			t.Errorf("oversight roster leaked onto member group: %s", rt)
		}
	}
}
