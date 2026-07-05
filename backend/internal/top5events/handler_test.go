// Route-level tests for the Top-5 Event Ticketing + cashless Event Wallet HTTP API.
//
// Following this repo's established handler-test convention (see
// backend/internal/handlers/stem_handler_test.go and
// backend/internal/middleware/authorization_test.go): gin.SetMode(gin.TestMode) +
// gin.New() + httptest.NewRequest/NewRecorder, constructing the Handler with a nil
// *Service. This exercises every guard clause a request hits BEFORE the service/DB
// layer is touched — auth-context extraction, Idempotency-Key requirement, and JSON
// body validation — without needing a live Postgres pool (none is available in this
// CI lane; see .github/workflows/top5-ci.yml).
//
// Tests that would need to reach h.svc.* (e.g. successful CreateEvent, Approve,
// Purchase) are NOT exercised here — they belong to service_integration_test.go
// under the `integration` build tag, gated on a real migrated DB.
package top5events

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func newTestRouter() (*gin.Engine, *Handler) {
	gin.SetMode(gin.TestMode)
	h := NewHandler(nil)
	r := gin.New()
	return r, h
}

// withUser injects a fake authenticated identity the way the real auth middleware
// would (c.Set("user_id", ...)), mirroring backend/internal/middleware's convention.
func withUser(userID string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if userID != "" {
			c.Set("user_id", userID)
		}
		c.Next()
	}
}

func doRequest(r *gin.Engine, method, path, body string, headers map[string]string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	var req *http.Request
	if body != "" {
		req = httptest.NewRequest(method, path, bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
	} else {
		req = httptest.NewRequest(method, path, nil)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	r.ServeHTTP(w, req)
	return w
}

// --- Unauthenticated access is rejected on every member route ---

func TestHandler_CreateEvent_Unauthenticated(t *testing.T) {
	r, h := newTestRouter()
	r.POST("/events", h.CreateEvent) // no withUser middleware

	w := doRequest(r, http.MethodPost, "/events", `{"title":"t"}`, nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", w.Code, w.Body.String())
	}
}

func TestHandler_Submit_Unauthenticated(t *testing.T) {
	r, h := newTestRouter()
	r.POST("/events/:id/submit", h.Submit)

	w := doRequest(r, http.MethodPost, "/events/e1/submit", "", nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestHandler_GoLive_Unauthenticated(t *testing.T) {
	r, h := newTestRouter()
	r.POST("/events/:id/golive", h.GoLive)

	w := doRequest(r, http.MethodPost, "/events/e1/golive", "", nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestHandler_Close_Unauthenticated(t *testing.T) {
	r, h := newTestRouter()
	r.POST("/events/:id/close", h.Close)

	w := doRequest(r, http.MethodPost, "/events/e1/close", "", nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestHandler_Approve_Unauthenticated(t *testing.T) {
	r, h := newTestRouter()
	r.POST("/events/:id/approve", h.Approve)

	w := doRequest(r, http.MethodPost, "/events/e1/approve", "", nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestHandler_Suspend_Unauthenticated(t *testing.T) {
	r, h := newTestRouter()
	r.POST("/events/:id/suspend", h.Suspend)

	w := doRequest(r, http.MethodPost, "/events/e1/suspend", "", nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestHandler_MyTickets_Unauthenticated(t *testing.T) {
	r, h := newTestRouter()
	r.GET("/events/my/tickets", h.MyTickets)

	w := doRequest(r, http.MethodGet, "/events/my/tickets", "", nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestHandler_Scan_Unauthenticated(t *testing.T) {
	r, h := newTestRouter()
	r.POST("/events/scan", h.Scan)

	w := doRequest(r, http.MethodPost, "/events/scan", `{"token":{}}`, nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestHandler_OpenWallet_Unauthenticated(t *testing.T) {
	r, h := newTestRouter()
	r.POST("/events/:id/wallet", h.OpenWallet)

	w := doRequest(r, http.MethodPost, "/events/e1/wallet", "", nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestHandler_GetWallet_Unauthenticated(t *testing.T) {
	r, h := newTestRouter()
	r.GET("/events/wallet/:walletId", h.GetWallet)

	w := doRequest(r, http.MethodGet, "/events/wallet/w1", "", nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestHandler_CloseWallet_Unauthenticated(t *testing.T) {
	r, h := newTestRouter()
	r.POST("/events/wallet/:walletId/close", h.CloseWallet)

	w := doRequest(r, http.MethodPost, "/events/wallet/w1/close", "", nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestHandler_TapCharge_Unauthenticated(t *testing.T) {
	r, h := newTestRouter()
	r.POST("/events/vendors/:vendorId/charge", h.TapCharge)

	w := doRequest(r, http.MethodPost, "/events/vendors/v1/charge", `{"wallet_id":"w1","amount_kobo":100}`, nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestHandler_SettleVendor_Unauthenticated(t *testing.T) {
	r, h := newTestRouter()
	r.POST("/events/:id/vendors/:vendorId/settle", h.SettleVendor)

	w := doRequest(r, http.MethodPost, "/events/e1/vendors/v1/settle", "", map[string]string{"Idempotency-Key": "k1"})
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// --- Idempotency-Key header is mandatory on every money-mutating route ---

func TestHandler_Purchase_RequiresIdempotencyKey(t *testing.T) {
	r, h := newTestRouter()
	r.Use(withUser("buyer-1"))
	r.POST("/events/:id/purchase", h.Purchase)

	w := doRequest(r, http.MethodPost, "/events/e1/purchase", `{"tier_id":"t1"}`, nil) // no Idempotency-Key
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 (missing Idempotency-Key), got %d body=%s", w.Code, w.Body.String())
	}
}

func TestHandler_TopUp_RequiresIdempotencyKey(t *testing.T) {
	r, h := newTestRouter()
	r.Use(withUser("owner-1"))
	r.POST("/events/wallet/:walletId/topup", h.TopUp)

	w := doRequest(r, http.MethodPost, "/events/wallet/w1/topup", `{"amount_kobo":1000,"source":"wallet"}`, nil)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 (missing Idempotency-Key), got %d body=%s", w.Code, w.Body.String())
	}
}

func TestHandler_TapCharge_RequiresIdempotencyKey(t *testing.T) {
	r, h := newTestRouter()
	r.Use(withUser("steward-1"))
	r.POST("/events/vendors/:vendorId/charge", h.TapCharge)

	w := doRequest(r, http.MethodPost, "/events/vendors/v1/charge", `{"wallet_id":"w1","amount_kobo":500}`, nil)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 (missing Idempotency-Key), got %d body=%s", w.Code, w.Body.String())
	}
}

func TestHandler_SettleVendor_RequiresIdempotencyKey(t *testing.T) {
	r, h := newTestRouter()
	r.Use(withUser("admin-1"))
	r.POST("/events/:id/vendors/:vendorId/settle", h.SettleVendor)

	w := doRequest(r, http.MethodPost, "/events/e1/vendors/v1/settle", "", nil)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 (missing Idempotency-Key), got %d body=%s", w.Code, w.Body.String())
	}
}

// --- Body validation guards fire before the service is touched ---

func TestHandler_CreateEvent_InvalidJSON(t *testing.T) {
	r, h := newTestRouter()
	r.Use(withUser("org-1"))
	r.POST("/events", h.CreateEvent)

	w := doRequest(r, http.MethodPost, "/events", `not-json`, nil)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestHandler_Purchase_MissingRequiredTierID(t *testing.T) {
	r, h := newTestRouter()
	r.Use(withUser("buyer-1"))
	r.POST("/events/:id/purchase", h.Purchase)

	w := doRequest(r, http.MethodPost, "/events/e1/purchase", `{}`, map[string]string{"Idempotency-Key": "k1"})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 (tier_id required), got %d body=%s", w.Code, w.Body.String())
	}
}

func TestHandler_GiftTicket_MissingRecipient(t *testing.T) {
	r, h := newTestRouter()
	r.Use(withUser("owner-1"))
	r.POST("/events/tickets/:ticketId/gift", h.GiftTicket)

	w := doRequest(r, http.MethodPost, "/events/tickets/tk1/gift", `{}`, nil)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 (recipient required), got %d body=%s", w.Code, w.Body.String())
	}
}

func TestHandler_TopUp_MissingAmount(t *testing.T) {
	r, h := newTestRouter()
	r.Use(withUser("owner-1"))
	r.POST("/events/wallet/:walletId/topup", h.TopUp)

	w := doRequest(r, http.MethodPost, "/events/wallet/w1/topup", `{"source":"wallet"}`, map[string]string{"Idempotency-Key": "k1"})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 (amount_kobo required), got %d body=%s", w.Code, w.Body.String())
	}
}

func TestHandler_TapCharge_MissingWalletID(t *testing.T) {
	r, h := newTestRouter()
	r.Use(withUser("steward-1"))
	r.POST("/events/vendors/:vendorId/charge", h.TapCharge)

	w := doRequest(r, http.MethodPost, "/events/vendors/v1/charge", `{"amount_kobo":500}`, map[string]string{"Idempotency-Key": "k1"})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 (wallet_id required), got %d body=%s", w.Code, w.Body.String())
	}
}

// --- respond()/respondOK() error-to-status mapping (pure function, no service call) ---

func TestRespond_ErrorStatusMapping(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := []struct {
		name string
		err  error
		want int
	}{
		{"forbidden", ErrForbidden, http.StatusForbidden},
		{"not found", ErrNotFound, http.StatusNotFound},
		{"sold out", ErrSoldOut, http.StatusConflict},
		{"insufficient float", ErrInsufficientFloat, http.StatusConflict},
		{"kyc required", ErrKYCRequired, http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			respond(c, nil, tc.err)
			if w.Code != tc.want {
				t.Fatalf("%v -> status %d, want %d", tc.err, w.Code, tc.want)
			}
		})
	}
}

func TestRespondOK_ErrorStatusMapping(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := []struct {
		name string
		err  error
		want int
	}{
		{"forbidden", ErrForbidden, http.StatusForbidden},
		{"not found", ErrNotFound, http.StatusNotFound},
		{"generic", errSentinelForTest, http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			respondOK(c, tc.err)
			if w.Code != tc.want {
				t.Fatalf("%v -> status %d, want %d", tc.err, w.Code, tc.want)
			}
		})
	}
}

var errSentinelForTest = &genericErr{"some generic service error"}

type genericErr struct{ s string }

func (e *genericErr) Error() string { return e.s }
