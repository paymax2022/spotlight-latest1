package top5events

// Route-registration tests for the commerce area. Gin builds one radix tree per
// group, so a new area can break routes that already work: a second wildcard
// name at a level that has one panics at registration, and a static path can be
// shadowed by a sibling ":id". Both failure modes are silent until runtime, so
// they are proven here — with every area mounted, the way the app does it.

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

const (
	memberBase = "/api/finance/events"
	adminBase  = "/api/events/admin"
)

// commerceMemberRouteKeys and commerceAdminRouteKeys (below) are every route
// RegisterCommerce adds. They must survive the full mount, and must be absent
// when the flag gate in internal/app/top5_routes.go skips RegisterCommerce.

// mountEveryEventArea registers the whole events surface — the base routes plus
// every flagged area including commerce — on one engine, exactly as
// internal/app/top5_routes.go does when all the flags are on.
func mountEveryEventArea(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	e := gin.New()
	e.Use(gin.Recovery())
	h := NewHandler(nil)
	member := e.Group(memberBase)
	admin := e.Group(adminBase)

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("route registration panicked: %v", r)
		}
	}()
	h.Register(member, admin, noopGuard)
	h.RegisterOrganiserGate(member)
	h.RegisterLifecycle(member)
	h.RegisterTicketing(member)
	h.RegisterTeam(member)
	h.RegisterComps(member)
	h.RegisterPayouts(member, admin, noopGuard)
	h.RegisterSocial(member)
	h.RegisterCardCheckout(member, true)
	h.RegisterCommerce(member, admin, noopGuard)
	return e
}

func TestRegisterCommerce_NoRouteConflictsWithEveryAreaMounted(t *testing.T) {
	e := mountEveryEventArea(t)

	got := routeSet(e)
	for _, want := range append(commerceMemberRouteKeys(), commerceAdminRouteKeys()...) {
		if !got[want] {
			t.Errorf("missing route %q", want)
		}
	}
}

// TestCommerceRoutesAbsentWhenNotRegistered is the flag-off shape: the gate
// simply never calls RegisterCommerce, so none of its paths exist and the
// customer/admin console cannot reach a half-built surface.
func TestCommerceRoutesAbsentWhenNotRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)
	e := gin.New()
	e.Use(gin.Recovery())
	h := NewHandler(nil)
	h.Register(e.Group(memberBase), e.Group(adminBase), noopGuard)

	for _, key := range append(commerceMemberRouteKeys(), commerceAdminRouteKeys()...) {
		if routeSet(e)[key] {
			t.Errorf("route %q registered without RegisterCommerce", key)
		}
	}
}

// TestCommerceStaticRoutesAreNotShadowedByParamPaths answers the second failure
// mode: "/my/orders" must not be swallowed by the ":id" sibling that
// "/:id/quote" introduced, and "/refunds/stats" must not be swallowed by
// "/refunds/:refundId". A route that exists but is shadowed answers the wrong
// handler, so this drives real requests and checks the status they return.
func TestCommerceStaticRoutesAreNotShadowedByParamPaths(t *testing.T) {
	e := mountEveryEventArea(t)

	// Member reads reach uid() first, so an unauthenticated call answers 401.
	// That is the proof the request arrived at the intended handler; a shadowed
	// or missing route answers 404 instead.
	for _, path := range []string{
		memberBase + "/my/orders",
		memberBase + "/my/bookings",
		memberBase + "/my/refunds",
		memberBase + "/my/notifications",
		memberBase + "/support/cases",
		memberBase + "/card/ref-1/status", // card area, registered after commerce
		memberBase + "/my/tickets",        // base route, must still win over /:id
	} {
		if w := get(e, path); w.Code != http.StatusUnauthorized {
			t.Errorf("GET %s = %d, want 401 (routed to the member handler)", path, w.Code)
		}
	}

	// Param routes still resolve: the ":caseId"/":bookingRef" wildcards sit under
	// their static parents and take the id through.
	for _, path := range []string{
		memberBase + "/my/bookings/BK-1",
		memberBase + "/support/cases/11111111-1111-1111-1111-111111111111",
	} {
		if w := get(e, path); w.Code == http.StatusNotFound {
			t.Errorf("GET %s = 404, want the param route to resolve", path)
		}
	}

	// Admin commerce reads run straight against the service, which is nil here —
	// so 500 (via Recovery) means "this path routed". 404 would mean the static
	// segment lost to a sibling wildcard.
	for _, path := range []string{
		adminBase + "/refunds",
		adminBase + "/refunds/stats", // static, sibling of /refunds/:refundId
		adminBase + "/fees",
		adminBase + "/organisers",
		adminBase + "/support/queue",
		adminBase + "/support/queue/stats",
		adminBase + "/dashboard", // base admin read, must still route
	} {
		if w := get(e, path); w.Code != http.StatusInternalServerError {
			t.Errorf("GET %s = %d, want 500 (routed to the nil service)", path, w.Code)
		}
	}

	// The two moderation reads answer 401 instead: they resolve the admin's user
	// id before touching the service, which is also proof they routed — a
	// shadowed path would 404.
	for _, path := range []string{
		adminBase + "/moderation",
		adminBase + "/events/e1/moderation",
	} {
		if w := get(e, path); w.Code != http.StatusUnauthorized {
			t.Errorf("GET %s = %d, want 401 (routed, then rejected for no user id)", path, w.Code)
		}
	}
}

func commerceMemberRouteKeys() []string {
	return []string{
		"GET " + memberBase + "/:id/quote",
		"GET " + memberBase + "/my/orders",
		"GET " + memberBase + "/my/bookings",
		"GET " + memberBase + "/my/bookings/:bookingRef",
		"POST " + memberBase + "/tickets/:ticketId/refund-request",
		"GET " + memberBase + "/my/refunds",
		"GET " + memberBase + "/my/notifications",
		"POST " + memberBase + "/my/notifications/read-all",
		"POST " + memberBase + "/notifications/:notificationId/read",
		"POST " + memberBase + "/support/cases",
		"GET " + memberBase + "/support/cases",
		"GET " + memberBase + "/support/cases/:caseId",
		"POST " + memberBase + "/support/cases/:caseId/replies",
		"POST " + memberBase + "/:id/submit-review",
		"GET " + memberBase + "/:id/roster",
		"GET " + memberBase + "/:id/checkin-stats",
		"GET " + memberBase + "/:id/checkin-history",
		"POST " + memberBase + "/:id/checkin",
		"POST " + memberBase + "/:id/checkin/undo",
		"GET " + memberBase + "/:id/refunds",
		"POST " + memberBase + "/:id/refunds/:refundId/decide",
		"POST " + memberBase + "/:id/refunds/:refundId/execute",
		"GET " + memberBase + "/:id/moderation",
	}
}

func commerceAdminRouteKeys() []string {
	return []string{
		"GET " + adminBase + "/refunds",
		"GET " + adminBase + "/refunds/stats",
		"POST " + adminBase + "/refunds/:refundId/decide",
		"POST " + adminBase + "/refunds/:refundId/execute",
		"POST " + adminBase + "/events/:id/review/approve",
		"POST " + adminBase + "/events/:id/review/reject",
		"POST " + adminBase + "/events/:id/review/changes",
		"POST " + adminBase + "/events/:id/review/suspend",
		"POST " + adminBase + "/events/:id/review/reinstate",
		"GET " + adminBase + "/events/:id/moderation",
		"GET " + adminBase + "/moderation",
		"GET " + adminBase + "/fees",
		"PUT " + adminBase + "/fees",
		"GET " + adminBase + "/organisers",
		"GET " + adminBase + "/organisers/:organiserId",
		"POST " + adminBase + "/organisers/:organiserId/sanction",
		"GET " + adminBase + "/support/queue",
		"GET " + adminBase + "/support/queue/stats",
		"GET " + adminBase + "/support/cases/:caseId",
		"POST " + adminBase + "/support/cases/:caseId/replies",
		"PATCH " + adminBase + "/support/cases/:caseId",
	}
}

func get(e *gin.Engine, path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	e.ServeHTTP(w, req)
	return w
}
