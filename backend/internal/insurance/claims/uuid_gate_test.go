package claims

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// Same malformed-UUID gate as the policy handler: the claim/policy columns are
// uuid-typed, so a bad id used to reach Postgres as invalid-input-syntax and
// surface as a 500. The service is nil throughout — the gate must return
// before it is touched.

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
	h := NewHandler(nil)
	for _, tc := range []struct {
		name string
		fn   func(*gin.Context)
		body string
	}{
		{"Get", h.Get, "{}"},
		{"AddEvidence", h.AddEvidence, `{"file_name":"x.png"}`},
		{"ListEvidence", h.ListEvidence, "{}"},
		{"AdminGet", h.AdminGet, "{}"},
		{"AdminDecision", h.AdminDecision, `{"decision":"assess"}`},
	} {
		c, w := gateCtx(http.MethodGet, "/x", tc.body, "not-a-uuid")
		tc.fn(c)
		if w.Code != http.StatusNotFound {
			t.Errorf("%s with malformed id = %d, want 404 (was a 500 leak)", tc.name, w.Code)
		}
	}
}

func TestUUIDGate_FNOLMalformedPolicyIDIs404(t *testing.T) {
	h := NewHandler(nil)
	c, w := gateCtx(http.MethodPost, "/x",
		`{"policy_id":"not-a-uuid","claimed_amount_kobo":1000,"description":"probe"}`, "")
	h.SubmitFNOL(c)
	if w.Code != http.StatusNotFound {
		t.Errorf("SubmitFNOL with malformed policy_id = %d, want 404 (was a 500 leak)", w.Code)
	}
}

// policy_id in AdminSearch is a filter, not a resource id — a malformed value
// is a client input error, so 400 rather than the 404 a missing row gets.
func TestUUIDGate_AdminSearchMalformedPolicyFilterIs400(t *testing.T) {
	h := NewHandler(nil)
	c, w := gateCtx(http.MethodGet, "/x?policy_id=not-a-uuid", "", "")
	h.AdminSearch(c)
	if w.Code != http.StatusBadRequest {
		t.Errorf("AdminSearch with malformed policy_id = %d, want 400", w.Code)
	}
}
