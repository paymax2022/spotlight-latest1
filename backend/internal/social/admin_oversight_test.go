package social

// Route-mount + guard regression for the wave-12 admin-oversight residual:
// PR #602 made GetSplit caller-scoped (uniform 404 for non-participants) but
// the admin route kept pointing at the member handler — an ops admin holding
// social.admin.view who was not a participant got the SAME 404 an outsider
// gets, silently losing the oversight the RBAC grant exists for. The fix
// mounts dedicated AdminGetSplit/AdminGetPool oversight handlers behind
// social.admin.view; the member routes stay caller-scoped.
//
// These tests pin the mount + guard ordering DB-free; the read behaviour and
// the non-party oracle sweep are proven live in admin_oversight_live_db_test.go.

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
	admin := r.Group("/api/social/admin")

	var perms []string
	guard := func(p string) gin.HandlerFunc {
		perms = append(perms, p)
		return func(c *gin.Context) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"success": false, "error": "denied"})
		}
	}
	// Nil pool is safe: every request below is refused at the guard, so no
	// handler body ever touches the service.
	h := NewHandler(NewService(nil, nil, nil, nil, nil), nil)
	h.Register(member, admin, guard)

	routes := map[string]bool{}
	for _, rt := range r.Routes() {
		routes[rt.Method+" "+rt.Path] = true
	}
	for _, want := range []string{
		"GET /api/social/admin/splits/:id",
		"GET /api/social/admin/pools/:id",
	} {
		if !routes[want] {
			t.Errorf("admin oversight route missing: %s", want)
		}
	}
	// Auth, not just existence: EVERY admin route must sit behind
	// social.admin.view — a plain-authenticated member must not reach it.
	if len(perms) != 2 {
		t.Fatalf("guard invoked %d times, want 2 (one per admin route)", len(perms))
	}
	for _, p := range perms {
		if p != "social.admin.view" {
			t.Errorf("admin route guarded by %q, want social.admin.view", p)
		}
	}

	// The guard must run BEFORE the handler: a denied caller is refused at
	// the middleware and never reaches the (nil-pool) service.
	for _, path := range []string{"/api/social/admin/splits/x", "/api/social/admin/pools/x"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusForbidden {
			t.Fatalf("%s: guard bypassed (got %d) — handler ran without permission", path, w.Code)
		}
	}
}

// The member oracle must stay closed: Register must keep mounting the
// caller-scoped GetSplit on the member group, and must NOT mount any
// oversight handler there.
func TestRegister_MemberGroup_KeepsCallerScopedSplitOnly(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	member := r.Group("/api/finance")
	h := NewHandler(NewService(nil, nil, nil, nil, nil), nil)
	h.Register(member, nil, nil)

	routes := map[string]bool{}
	for _, rt := range r.Routes() {
		routes[rt.Method+" "+rt.Path] = true
	}
	if !routes["GET /api/finance/social/splits/:id"] {
		t.Error("member split read missing: GET /api/finance/social/splits/:id")
	}
	// No admin-shaped route may appear under the member prefix.
	for rt := range routes {
		if rt == "GET /api/finance/social/pools/:id" {
			t.Errorf("unscoped pool detail leaked onto member group: %s", rt)
		}
	}
}
