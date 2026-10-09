package invest

// Edge gate: every client-keyed money mutation refuses a request that carries
// no Idempotency-Key header with 400 + the canonical "Idempotency-Key
// required" body BEFORE the service runs (transfers convention). The service
// is nil throughout — the gate must return before it is touched, so a nil
// service would panic if reached. The service-level ErrInvalidOrder check
// stays as the fail-closed backstop for any caller that bypasses the handler.

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func idemCtx(t *testing.T, body string, params ...gin.Param) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	c.Request = req
	c.Set("user_id", "00000000-0000-0000-0000-000000000001")
	if len(params) > 0 {
		c.Params = params
	}
	return c, w
}

func TestEdgeGate_MissingIdempotencyKeyIs400(t *testing.T) {
	h := NewHandler(nil)
	for _, tc := range []struct {
		name   string
		fn     func(*gin.Context)
		body   string
		params []gin.Param
	}{
		{"Buy", h.Buy, `{"symbol":"MTNN","pin":"1234","amount_kobo":1000}`, nil},
		{"Sell", h.Sell, `{"symbol":"MTNN","pin":"1234","quantity":1}`, nil},
		{"Deposit", h.Deposit, `{"amount_kobo":1000}`, nil},
		{"Withdraw", h.Withdraw, `{"amount_kobo":1000,"pin":"1234"}`, nil},
		{"ApplyPublicOffer", h.ApplyPublicOffer, `{"amount_kobo":1000}`,
			[]gin.Param{{Key: "id", Value: "offer-1"}}},
		{"AcceptRightsIssue", h.AcceptRightsIssue, `{"units":2}`,
			[]gin.Param{{Key: "id", Value: "ri-1"}}},
	} {
		c, w := idemCtx(t, tc.body, tc.params...)
		tc.fn(c)
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s without Idempotency-Key = %d, want 400", tc.name, w.Code)
		}
		if !strings.Contains(w.Body.String(), "Idempotency-Key required") {
			t.Errorf("%s body %q missing canonical refusal", tc.name, w.Body.String())
		}
	}
}
