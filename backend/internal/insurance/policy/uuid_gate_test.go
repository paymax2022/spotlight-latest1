package policy

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// Every member handler that takes a :id path param (or a uuid id in the body)
// must gate it BEFORE the uuid-typed Postgres column sees it — a malformed id
// used to come back as invalid-input-syntax and surface as a 500. A malformed
// id can never name a row, so the contract is the same 404 a missing id gets.
// The service is nil throughout: the gate must return before it is touched.

func gateCtx(method, target, body, id string) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "test-idem-key")
	c.Request = req
	c.Set("user_id", "00000000-0000-0000-0000-000000000001")
	if id != "" {
		c.Params = gin.Params{gin.Param{Key: "id", Value: id}}
	}
	return c, w
}

func TestUUIDGate_PathParamMalformedIs404(t *testing.T) {
	h := NewHandler(nil, nil)
	for _, tc := range []struct {
		name string
		fn   func(*gin.Context)
	}{
		{"GetQuote", h.GetQuote},
		{"Get", h.Get},
		{"Certificate", h.Certificate},
		{"Cancel", h.Cancel},
		{"AddBeneficiary", h.AddBeneficiary},
		{"ListBeneficiaries", h.ListBeneficiaries},
	} {
		c, w := gateCtx(http.MethodGet, "/x", "{}", "not-a-uuid")
		tc.fn(c)
		if w.Code != http.StatusNotFound {
			t.Errorf("%s with malformed id = %d, want 404 (was a 500 leak)", tc.name, w.Code)
		}
	}
}

func TestUUIDGate_BindMalformedQuoteIDIs404(t *testing.T) {
	h := NewHandler(nil, nil)
	c, w := gateCtx(http.MethodPost, "/x", `{"quote_id":"not-a-uuid"}`, "")
	h.Bind(c)
	if w.Code != http.StatusNotFound {
		t.Errorf("Bind with malformed quote_id = %d, want 404 (was a 500 leak)", w.Code)
	}
}
