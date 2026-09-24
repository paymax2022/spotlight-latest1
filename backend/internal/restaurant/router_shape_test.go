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
	// FOOD-005: withdrawal money path — static siblings of :id, like /mine above.
	g.POST("/bank-accounts", noop)
	g.GET("/bank-accounts", noop)
	g.PATCH("/bank-accounts/:accountId/default", noop)
	g.DELETE("/bank-accounts/:accountId", noop)
	g.POST("/withdrawals", noop)
	g.GET("/withdrawals", noop)
	g.GET("/withdrawals/:withdrawalId", noop)
	g.GET("/:id", noop)
	// FOOD-003: merchant KYB onboarding — static "kyb"/"kyb/documents"/"kyb/submit"
	// siblings beside ":id" params, like staff above.
	g.GET("/:id/kyb", noop)
	g.PUT("/:id/kyb", noop)
	g.POST("/:id/kyb/documents", noop)
	g.POST("/:id/kyb/submit", noop)
	g.GET("/:id/staff", noop)
	g.POST("/:id/staff", noop)
	g.PATCH("/:id/staff/:userId", noop)
	g.POST("/:id/orders", noop)
	g.GET("/:id/orders/:orderId", noop)
	g.POST("/orders/:orderId/accept", noop)
	// Paystack-funded checkout (paystackcheckout.RegisterRestaurantPaystackCheckout):
	// POST is one level deeper than the existing "/:id/orders" (no wildcard sibling
	// at that position). GET adds a static "orders/paystack/..." branch alongside
	// the plain "/orders" + "/orders/:orderId" GETs (real siblings, added here too
	// so the static-vs-wildcard shape is actually exercised) — same shape already
	// proven safe by /staff/accept and /kyb above.
	g.POST("/:id/orders/paystack/initiate", noop)
	g.GET("/orders", noop)
	g.GET("/orders/:orderId", noop)
	g.GET("/orders/paystack/:reference/status", noop)

	// Admin group: static "listings"/"restaurants" siblings beside ":id" params.
	a := r.Group("/api/restaurant/admin")
	a.GET("/listings/pending", noop)
	a.POST("/listings/:id/decision", noop)
	a.GET("/restaurants/unclaimed", noop)
	a.GET("/onboarding", noop)
	a.POST("/onboarding/:id/:decision", noop)
	a.GET("/payouts", noop)
	a.GET("/payouts/:id", noop)
	a.GET("/withdrawals", noop)
	a.GET("/withdrawals/:withdrawalId", noop)
	a.POST("/withdrawals/:withdrawalId/paid", noop)
	a.POST("/withdrawals/:withdrawalId/failed", noop)

	if len(r.Routes()) == 0 {
		t.Fatal("no routes registered")
	}
}
