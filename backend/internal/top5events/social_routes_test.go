package top5events

import (
	"testing"

	"github.com/gin-gonic/gin"
)

func routeSet(e *gin.Engine) map[string]bool {
	out := map[string]bool{}
	for _, r := range e.Routes() {
		out[r.Method+" "+r.Path] = true
	}
	return out
}

var socialRoutes = []string{
	"POST /api/finance/events/:id/like",
	"DELETE /api/finance/events/:id/like",
	"POST /api/finance/events/organisers/:id/follow",
	"DELETE /api/finance/events/organisers/:id/follow",
}

func noopGuard(string) gin.HandlerFunc { return func(c *gin.Context) { c.Next() } }

// TestRegisterSocialRoutes asserts the four social routes are mounted, and that
// mounting them next to the full existing route tree does not panic. Gin
// rejects sibling wildcards with different names at one level, so every new
// route uses :id.
func TestRegisterSocialRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	e := gin.New()
	h := NewHandler(nil)
	member := e.Group("/api/finance/events")
	admin := e.Group("/api/events/admin")

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("route registration panicked: %v", r)
		}
	}()
	h.Register(member, admin, noopGuard)
	h.RegisterSocial(member)

	got := routeSet(e)
	for _, want := range socialRoutes {
		if !got[want] {
			t.Errorf("missing route %q", want)
		}
	}
}

// TestSocialRoutesAbsentWithoutRegisterSocial is the flag-off shape: the gate in
// internal/app/top5_routes.go simply does not call RegisterSocial.
func TestSocialRoutesAbsentWithoutRegisterSocial(t *testing.T) {
	gin.SetMode(gin.TestMode)
	e := gin.New()
	h := NewHandler(nil)
	h.Register(e.Group("/api/finance/events"), e.Group("/api/events/admin"), noopGuard)

	got := routeSet(e)
	for _, r := range socialRoutes {
		if got[r] {
			t.Errorf("route %q present without RegisterSocial", r)
		}
	}
}

// TestOrganiserProfileAndFollowingRoutes asserts the Task 6 routes are mounted and
// coexist with the param routes: /organisers/me is static beside GET
// /organisers/:id (different method trees), and GET /following sits beside the
// existing /:id routes. Registering the whole tree must not panic.
func TestOrganiserProfileAndFollowingRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	e := gin.New()
	h := NewHandler(nil)
	member := e.Group("/api/finance/events")
	admin := e.Group("/api/events/admin")

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("route registration panicked: %v", r)
		}
	}()
	h.Register(member, admin, noopGuard)
	h.RegisterLifecycle(member)
	h.RegisterTicketing(member)
	h.RegisterTeam(member)
	h.RegisterComps(member)
	h.RegisterSocial(member)

	got := routeSet(e)
	for _, want := range []string{
		"GET /api/finance/events/following",
		"PUT /api/finance/events/organisers/me",
		"POST /api/finance/events/organisers/me/banner/presign",
		"GET /api/finance/events/organisers/:id",
	} {
		if !got[want] {
			t.Errorf("missing route %q", want)
		}
	}
}
