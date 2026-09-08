package creator

// Route-registration guard.
//
// The creator package shares one router group with the sibling discovery and
// wallet packages, all of which register routes on the /campaigns/:id tree.
// Gin PANICS at registration time on a wildcard conflict (a differently-named
// param in the same segment position, or a static sibling of a wildcard), so a
// bad route here takes down the whole API at boot rather than failing one
// endpoint. routes.go carries a comment warning about exactly this; this test
// makes the warning enforceable.
//
// Register only stores the pool, so a nil pool is fine — nothing here touches a
// database.

import (
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRegister_NoRouteConflicts(t *testing.T) {
	gin.SetMode(gin.TestMode)
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("route registration panicked (Gin wildcard conflict): %v", r)
		}
	}()

	r := gin.New()
	Register(r.Group("/api/v1/crowdfunding"), nil)

	want := map[string]string{
		"PATCH  /api/v1/crowdfunding/creator/campaigns/:id":                 "partial edit",
		"DELETE /api/v1/crowdfunding/creator/campaigns/:id":                 "soft delete",
		"POST   /api/v1/crowdfunding/creator/campaigns/:id/pause":           "pause",
		"POST   /api/v1/crowdfunding/creator/campaigns/:id/resume":          "resume",
		"POST   /api/v1/crowdfunding/creator/campaigns/:id/feature-request": "request featuring",
		"DELETE /api/v1/crowdfunding/creator/campaigns/:id/feature-request": "withdraw request",
		"POST   /api/v1/crowdfunding/creator/campaigns/:id/unfeature":       "self-unfeature",
	}

	got := map[string]bool{}
	for _, ri := range r.Routes() {
		got[ri.Method+" "+ri.Path] = true
	}

	for route, what := range want {
		method, path := splitRoute(route)
		if !got[method+" "+path] {
			t.Errorf("missing owner self-management route (%s): %s %s", what, method, path)
		}
	}
}

// The pre-existing analytics route must survive the new registrations — it uses
// the same ':id' param position and is the most likely casualty of a conflict.
func TestRegister_KeepsExistingAnalyticsRoute(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	Register(r.Group("/api/v1/crowdfunding"), nil)

	for _, ri := range r.Routes() {
		if ri.Method == http.MethodGet && ri.Path == "/api/v1/crowdfunding/creator/campaigns/:id/analytics" {
			return
		}
	}
	t.Fatal("the existing GET /creator/campaigns/:id/analytics route disappeared")
}

func splitRoute(s string) (method, path string) {
	for i := 0; i < len(s); i++ {
		if s[i] == ' ' {
			method = s[:i]
			for i < len(s) && s[i] == ' ' {
				i++
			}
			return method, s[i:]
		}
	}
	return s, ""
}
