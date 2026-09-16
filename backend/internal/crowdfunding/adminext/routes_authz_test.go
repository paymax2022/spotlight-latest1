package adminext

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// denyAllRBAC refuses every permission and records what was asked. Embedding the
// interface (rather than implementing its ~50 methods) keeps this stub honest: a
// call to anything other than CheckPermission nil-panics loudly instead of
// quietly returning a zero value.
type denyAllRBAC struct {
	services.RBACService
	asked []string
}

func (d *denyAllRBAC) CheckPermission(userID, permission, scopeType, scopeID string) (bool, error) {
	d.asked = append(d.asked, permission)
	return false, nil
}

// Every admin route must consult RBAC — no exceptions, no "the group covers it".
//
// This is the test that was missing. The whole adminext surface shipped with the
// group's auth middleware and nothing else, so being SIGNED IN was sufficient:
// against the running server, a campaign owner's token read GET /admin/withdrawals
// and set `featured` through PATCH /admin/campaigns/:id/flags, promoting their own
// campaign onto the public rail and stepping straight over the approval queue.
//
// Asserting route-by-route (rather than eyeballing the file) is deliberate: the
// original bug was not a wrong guard, it was an ABSENT one, and absence is exactly
// what review misses. A new route added without a guard fails here — with a deny-all
// RBAC it would reach its handler and answer something other than 403.
func TestRegisterAdmin_EveryRouteRequiresPermission(t *testing.T) {
	gin.SetMode(gin.TestMode)

	rbac := &denyAllRBAC{}
	r := gin.New()
	grp := r.Group("/api/crowdfunding/admin")
	// Stand in for the real group's auth: the caller IS authenticated. That is the
	// threat model — the danger was never the anonymous caller, it was the ordinary
	// signed-in one.
	grp.Use(func(c *gin.Context) {
		c.Set(middleware.AuthUserContextKey, domain.AuthenticatedUser{ID: "signed-in-but-not-admin"})
		c.Next()
	})
	RegisterAdmin(grp, nil, nil, nil, rbac)

	routes := r.Routes()
	if len(routes) == 0 {
		t.Fatal("no routes registered")
	}

	for _, ri := range routes {
		t.Run(ri.Method+" "+ri.Path, func(t *testing.T) {
			// Fill in :params so the request actually matches this route.
			path := ri.Path
			for _, seg := range strings.Split(ri.Path, "/") {
				if strings.HasPrefix(seg, ":") {
					path = strings.Replace(path, seg, "11111111-1111-1111-1111-111111111111", 1)
				}
			}

			before := len(rbac.asked)
			w := httptest.NewRecorder()
			req := httptest.NewRequest(ri.Method, path, strings.NewReader("{}"))
			req.Header.Set("Content-Type", "application/json")
			// An ungated route reaches its handler with a nil pool: it panics, or it
			// answers 2xx/4xx/5xx. Any of those fails this assertion, which is the point.
			r.ServeHTTP(w, req)

			if w.Code != http.StatusForbidden {
				t.Errorf("ungated: %s %s returned %d, want 403 from a deny-all RBAC "+
					"(this route reached its handler without a permission check)", ri.Method, ri.Path, w.Code)
			}
			if len(rbac.asked) == before {
				t.Errorf("ungated: %s %s never called CheckPermission", ri.Method, ri.Path)
			}
		})
	}
}

// Reads and writes must not share one grant: an operator trusted to LOOK at the
// withdrawal queue is not thereby trusted to APPROVE from it.
func TestRegisterAdmin_ReadsAndWritesUseDistinctPermissions(t *testing.T) {
	gin.SetMode(gin.TestMode)

	for _, tc := range []struct {
		method, path, want string
	}{
		{"GET", "/api/crowdfunding/admin/withdrawals", "crowdfunding.admin.review"},
		{"POST", "/api/crowdfunding/admin/withdrawals/abc/approve", "crowdfunding.admin.decide"},
		{"GET", "/api/crowdfunding/admin/featured", "crowdfunding.admin.review"},
		{"PATCH", "/api/crowdfunding/admin/campaigns/abc/flags", "crowdfunding.admin.decide"},
		{"POST", "/api/crowdfunding/admin/feature-requests/abc/approve", "crowdfunding.admin.decide"},
		{"PUT", "/api/crowdfunding/admin/config/fees", "crowdfunding.admin.decide"},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			rbac := &denyAllRBAC{}
			r := gin.New()
			grp := r.Group("/api/crowdfunding/admin")
			grp.Use(func(c *gin.Context) {
				c.Set(middleware.AuthUserContextKey, domain.AuthenticatedUser{ID: "u"})
				c.Next()
			})
			RegisterAdmin(grp, nil, nil, nil, rbac)

			w := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader("{}"))
			req.Header.Set("Content-Type", "application/json")
			r.ServeHTTP(w, req)

			if len(rbac.asked) != 1 || rbac.asked[0] != tc.want {
				t.Errorf("%s %s asked for %v, want [%s]", tc.method, tc.path, rbac.asked, tc.want)
			}
		})
	}
}
