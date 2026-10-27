package top5events

// Route-shape + guard-clause tests for the organiser payout API (EVTC-D003).
// Mounting RegisterPayouts on the SAME member/admin groups as Register is the
// point of TestRegisterPayouts_NoRouteConflicts: gin panics at registration
// time on a param/static collision, so reaching the assertions proves the
// payout surface coexists with every existing events route. Requests are only
// driven as far as the pre-service guard clauses — h.svc is nil (see
// handler_test.go for the convention); gin.Recovery turns the nil-service
// panic into a 500, which still proves the request routed (a 404 would mean
// the route silently lost to a wildcard).

import (
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
)

// mountPayoutRouter builds the real route shape: base Register plus the
// flag-gated RegisterPayouts, member under /events and admin under /admin.
func mountPayoutRouter(t *testing.T, mw ...gin.HandlerFunc) *gin.Engine {
	t.Helper()
	r, h := newTestRouter()
	r.Use(gin.Recovery())
	member := r.Group("/events", mw...)
	admin := r.Group("/admin", mw...)
	h.Register(member, admin, noopGuard)
	h.RegisterPayouts(member, admin, noopGuard) // panics here on a route conflict
	return r
}

func TestRegisterPayouts_NoRouteConflicts(t *testing.T) {
	r := mountPayoutRouter(t)

	// Member payout reads hit uid() first → 401 proves they routed.
	for _, path := range []string{
		"/events/payouts/mine",
		"/events/payouts/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
		"/events/e1/payout-statement",
	} {
		if w := doRequest(r, http.MethodGet, path, "", nil); w.Code != http.StatusUnauthorized {
			t.Errorf("GET %s = %d, want 401", path, w.Code)
		}
	}
	// Admin payout reads go straight to the nil service → recovery 500 proves
	// they routed; a wildcard steal would 404 instead.
	for _, path := range []string{
		"/admin/payouts",
		"/admin/payouts/queue",
		"/admin/events/e1/payout-statement",
	} {
		if w := doRequest(r, http.MethodGet, path, "", nil); w.Code != http.StatusInternalServerError {
			t.Errorf("GET %s = %d, want 500 (routed to nil service)", path, w.Code)
		}
	}
	// The static member routes must still win over /:id after the payout
	// routes registered alongside them.
	for _, path := range []string{"/events/my/tickets", "/events/organiser/mine"} {
		if w := doRequest(r, http.MethodGet, path, "", nil); w.Code == http.StatusNotFound {
			t.Errorf("GET %s = 404 — static route shadowed by payout params", path)
		}
	}
}

func TestPayoutHandler_MutationsRequireIdempotencyKey(t *testing.T) {
	// Authenticated (identity injected) but no Idempotency-Key header → 400
	// before the service runs.
	r := mountPayoutRouter(t, withUser("u1"))
	for _, tc := range []struct{ method, path string }{
		{http.MethodPost, "/events/e1/payouts"},
		{http.MethodPost, "/admin/e1/payouts"},
		{http.MethodPost, "/admin/payouts/p1/approve"},
	} {
		if w := doRequest(r, tc.method, tc.path, ``, nil); w.Code != http.StatusBadRequest {
			t.Errorf("%s %s = %d, want 400 (missing Idempotency-Key)", tc.method, tc.path, w.Code)
		}
	}
}

func TestPayoutHandler_RejectRequiresReason(t *testing.T) {
	r, h := newTestRouter()
	r.POST("/admin/payouts/:payoutId/reject", withUser("admin1"), h.AdminRejectPayout)

	// Missing/empty body → generic 400 from bindFail.
	if w := doRequest(r, http.MethodPost, "/admin/payouts/p1/reject", ``, nil); w.Code != http.StatusBadRequest {
		t.Fatalf("empty body = %d, want 400", w.Code)
	}
	if w := doRequest(r, http.MethodPost, "/admin/payouts/p1/reject", `{}`, nil); w.Code != http.StatusBadRequest {
		t.Fatalf("missing reason = %d, want 400", w.Code)
	}
}

func TestPayoutHandler_Unauthenticated(t *testing.T) {
	r, h := newTestRouter()
	r.POST("/events/:id/payouts", h.RequestPayout)
	r.GET("/events/payouts/mine", h.MyPayouts)

	if w := doRequest(r, http.MethodPost, "/events/e1/payouts", ``, nil); w.Code != http.StatusUnauthorized {
		t.Fatalf("request payout = %d, want 401", w.Code)
	}
	if w := doRequest(r, http.MethodGet, "/events/payouts/mine", "", nil); w.Code != http.StatusUnauthorized {
		t.Fatalf("my payouts = %d, want 401", w.Code)
	}
}
