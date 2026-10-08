package transfers_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/finance/transfers"
)

// AUD-BE-011: pin the header contract — a header-only Idempotency-Key is
// accepted (fails deeper, not at binding) and neither-source still 400s.
// The handler is constructed with a nil service on purpose: reaching the service
// at all is the signal under test — a bind rejection answers 400 first.

func idemEngine(h func(*gin.Context)) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(func(c *gin.Context) {
		c.Set("user_id", "u-sender")
		c.Next()
	})
	r.POST("/t", h)
	return r
}

func post(t *testing.T, r *gin.Engine, body, idemHeader string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/t", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if idemHeader != "" {
		req.Header.Set("Idempotency-Key", idemHeader)
	}
	r.ServeHTTP(w, req)
	return w
}

const walletBody = `{"recipient_phone":"+2348000000099","amount_kobo":10000}`

func TestWalletTransfer_HeaderOnlyIdemKey_IsAccepted(t *testing.T) {
	r := idemEngine(transfers.NewHandler(nil, true, true).InitiatePaymax)
	w := post(t, r, walletBody, "idem-hdr-1")
	if w.Code == http.StatusBadRequest && strings.Contains(w.Body.String(), "IdempotencyKey") {
		t.Fatalf("header-only Idempotency-Key rejected at binding: %d %s", w.Code, w.Body.String())
	}
}

func TestWalletTransfer_NoIdemKey_400s(t *testing.T) {
	r := idemEngine(transfers.NewHandler(nil, true, true).InitiatePaymax)
	w := post(t, r, walletBody, "")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 without any idempotency key, got %d %s", w.Code, w.Body.String())
	}
}

func TestBankTransfer_HeaderOnlyIdemKey_IsAccepted(t *testing.T) {
	r := idemEngine(transfers.NewHandler(nil, true, true).InitiateBank)
	body := `{"account_number":"0123456789","bank_code":"058","amount_kobo":200000,"pin":"1234"}`
	w := post(t, r, body, "idem-hdr-2")
	if w.Code == http.StatusBadRequest && strings.Contains(w.Body.String(), "IdempotencyKey") {
		t.Fatalf("header-only Idempotency-Key rejected at binding: %d %s", w.Code, w.Body.String())
	}
}

func TestBankToBank_HeaderOnlyIdemKey_IsAccepted(t *testing.T) {
	r := idemEngine(transfers.NewHandler(nil, true, true).InitiateBankToBank)
	body := `{"account_number":"0123456789","bank_code":"058","amount_kobo":200000,"pin":"1234"}`
	w := post(t, r, body, "idem-hdr-3")
	if w.Code == http.StatusBadRequest && strings.Contains(w.Body.String(), "IdempotencyKey") {
		t.Fatalf("header-only Idempotency-Key rejected at binding: %d %s", w.Code, w.Body.String())
	}
}
