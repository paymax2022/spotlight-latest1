package restaurant_test

// Registration-time guard for the restaurant route tree.
//
// gin panics when a static segment conflicts with a wildcard at the same
// position, and it does so at REGISTRATION — i.e. at boot, not under test. The
// staff routes add `/staff/accept` (static) beside `/:id/...` (param), which is
// exactly the shape that panics if gin cannot reconcile it. Every other test in
// this package works on the service, so nothing else would have caught a router
// that refuses to start.

import (
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRestaurantRouteShapeRegistersWithoutConflict(t *testing.T) {
	gin.SetMode(gin.ReleaseMode)
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("route registration panicked — the API would not boot: %v", r)
		}
	}()

	r := gin.New()
	g := r.Group("/api/finance/restaurant")
	noop := func(c *gin.Context) {}

	// Mirrors finance_routes.go, in the same order.
	g.POST("", noop)
	g.GET("/mine", noop)
	g.GET("/earnings", noop)
	g.GET("/payout-readiness", noop)
	g.POST("/staff/accept", noop)
	g.GET("/:id", noop)
	g.GET("/:id/staff", noop)
	g.POST("/:id/staff", noop)
	g.PATCH("/:id/staff/:userId", noop)
	g.POST("/:id/orders", noop)
	g.GET("/:id/orders/:orderId", noop)
	g.POST("/orders/:orderId/accept", noop)

	if len(r.Routes()) == 0 {
		t.Fatal("no routes registered")
	}
}
