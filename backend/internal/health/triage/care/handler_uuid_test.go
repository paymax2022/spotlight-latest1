package care

// w12 sweep regression: session/referral/escalation :id params feed uuid
// columns, and the pay path is a money mutation — a malformed id must be a
// clean 400 before the service/pgx, and a missing idempotency key must fail
// closed at 400. The nil-dependency service (nil repo) means any fallthrough
// past the guards would panic, not merely fail.

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

const careUUIDOK = "3f0a1c9e-0000-4000-8000-000000000001"

func careUUIDRouter() (*gin.Engine, *Handler) {
	gin.SetMode(gin.TestMode)
	h := NewHandler(NewCareService(nil, nil, nil, nil, nil, nil))
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("user_id", "u-1") })
	return r, h
}

func carePost(t *testing.T, r *gin.Engine, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestCarePathIDs_Malformed_Are400(t *testing.T) {
	r, h := careUUIDRouter()
	r.POST("/sessions/:id/refer", h.Refer)
	r.POST("/referrals/:id/pay", h.PayReferral)
	r.POST("/escalations/:id/ack", h.AdminAcknowledge)
	r.POST("/escalations/:id/resolve", h.AdminResolve)
	for _, p := range []string{
		"/sessions/not-a-uuid/refer",
		"/referrals/not-a-uuid/pay",
		"/escalations/not-a-uuid/ack",
		"/escalations/not-a-uuid/resolve",
	} {
		if w := carePost(t, r, p, `{}`); w.Code != http.StatusBadRequest {
			t.Fatalf("POST %s: status = %d, want 400 (got %s)", p, w.Code, w.Body.String())
		}
	}
}

// A money mutation with no Idempotency-Key header AND no body key fails closed
// at 400 — the service's ErrIdempotencyRequired check runs before any repo call.
func TestPayReferral_NoIdempotencyKey_Is400(t *testing.T) {
	r, h := careUUIDRouter()
	r.POST("/referrals/:id/pay", h.PayReferral)
	if w := carePost(t, r, "/referrals/"+careUUIDOK+"/pay", `{}`); w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}

// careFail maps ErrNotFound (missing OR foreign — folded in the service) → 404;
// ErrIdempotencyRequired → 400; other domain refusals → 409.
func TestCareFail_Mapping(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := []struct {
		err  error
		want int
	}{
		{ErrNotFound, http.StatusNotFound},
		{ErrIdempotencyRequired, http.StatusBadRequest},
		{ErrIllegalTransition, http.StatusConflict},
		{errors.New("care: illegal referral transition routed -> closed"), http.StatusConflict},
	}
	for _, tc := range cases {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		careFail(c, tc.err)
		if w.Code != tc.want {
			t.Fatalf("%v: status = %d, want %d", tc.err, w.Code, tc.want)
		}
	}
}
