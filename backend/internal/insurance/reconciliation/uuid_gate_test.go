package reconciliation

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// Same malformed-UUID gate as the policy/claims handlers: the
// reconciliation-record id and commission policy_id columns are uuid-typed, so
// a bad value used to reach Postgres as invalid-input-syntax and surface as a
// 500. The service is nil throughout — the gate must return before it is
// touched.

func gateCtx(method, target, body string, params ...gin.Param) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	c.Request = req
	if len(params) > 0 {
		c.Params = params
	}
	return c, w
}

func TestUUIDGate_PathParamMalformedIs404(t *testing.T) {
	h := NewHandler(nil)

	c, w := gateCtx(http.MethodPost, "/x", "{}", gin.Param{Key: "id", Value: "not-a-uuid"})
	h.ResolveBreak(c)
	if w.Code != http.StatusNotFound {
		t.Errorf("ResolveBreak with malformed id = %d, want 404 (was a 500 leak)", w.Code)
	}

	for _, tc := range []struct {
		name string
		fn   func(*gin.Context)
	}{
		{"ConfirmCommission", h.ConfirmCommission},
		{"ReverseCommission", h.ReverseCommission},
	} {
		c, w := gateCtx(http.MethodPost, "/x", "{}", gin.Param{Key: "policy_id", Value: "not-a-uuid"})
		tc.fn(c)
		if w.Code != http.StatusNotFound {
			t.Errorf("%s with malformed policy_id = %d, want 404 (was a 500 leak)", tc.name, w.Code)
		}
	}
}

// A statement line's policy_id is request input, not a resource id — a
// malformed value is a client error (400), same convention as the claims
// AdminSearch policy_id filter.
func TestUUIDGate_MatchStatementMalformedLineIs400(t *testing.T) {
	h := NewHandler(nil)
	c, w := gateCtx(http.MethodPost, "/x",
		`{"provider":"mycover","lines":[{"policy_id":"not-a-uuid","statement_ref":"s1","amount_kobo":1000}]}`)
	h.MatchStatement(c)
	if w.Code != http.StatusBadRequest {
		t.Errorf("MatchStatement with malformed line policy_id = %d, want 400 (was a 500 leak)", w.Code)
	}
}
