package extranet

// Registration-time guard for the extranet route tree.
//
// gin panics when a static segment conflicts with a wildcard at the same
// position, and it does so at REGISTRATION — i.e. at boot, not under test.
// staff_invite.go adds "/staff/invite/accept" (static, root-level) beside
// "/properties/:propertyId" and "/me/properties" — same class of shape that
// bit the restaurant module's own staff-invite routes (see
// backend/internal/restaurant/router_shape_test.go). Every other test in this
// package works on the service, so nothing else would catch a router that
// refuses to start.

import (
	"testing"

	"github.com/gin-gonic/gin"
)

func TestExtranetRouteShapeRegistersWithoutConflict(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("route registration panicked — the API would not boot: %v", r)
		}
	}()

	h := NewHandler(NewService(NewRepository(nil), NewAuthZ(nil), nil, noopStaffInviteMailer{}, ""))
	r := gin.New()
	g := r.Group("/api/stays/extranet")
	h.Register(g)

	if len(r.Routes()) == 0 {
		t.Fatal("no routes registered")
	}
}
