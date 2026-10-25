package estate

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/health/makercheck"
)

// ESTD-D027 pure-policy + handler tests (no DB). Live-DB coverage lives in
// dual_control_live_db_test.go.

func TestRequiresChecker_ThresholdPolicy(t *testing.T) {
	th := ApprovalThresholds{VendorPayoutKobo: 10_000_000}
	cases := []struct {
		name   string
		action ApprovalAction
		amount int64
		want   bool
	}{
		{"payout below threshold executes directly", ApprovalVendorPayout, 9_999_999, false},
		{"payout at threshold needs checker", ApprovalVendorPayout, 10_000_000, true},
		{"payout above threshold needs checker", ApprovalVendorPayout, 50_000_000, true},
		{"ban always needs checker", ApprovalResidentBan, 0, true},
		{"role grant always needs checker", ApprovalRoleGrant, 0, true},
		{"threshold change always needs checker", ApprovalThresholdChange, 0, true},
		{"unknown action fails closed", ApprovalAction("bogus"), 0, true},
	}
	for _, tc := range cases {
		if got := requiresChecker(tc.action, tc.amount, th); got != tc.want {
			t.Errorf("%s: requiresChecker = %v, want %v", tc.name, got, tc.want)
		}
	}
	// Threshold 0 → every payout needs a checker.
	if !requiresChecker(ApprovalVendorPayout, 1, ApprovalThresholds{VendorPayoutKobo: 0}) {
		t.Fatal("zero threshold must dual-control every payout")
	}
}

func TestParseThresholdPayload_KoboIntegersOnly(t *testing.T) {
	if p, err := parseThresholdPayload(json.RawMessage(`{"vendor_payout_kobo": 5000000}`)); err != nil || p.VendorPayoutKobo != 5_000_000 {
		t.Fatalf("valid payload: got %+v, %v", p, err)
	}
	for _, bad := range []string{``, `[]`, `{}`, `{"vendor_payout_kobo": 12.5}`, `{"vendor_payout_kobo": "100"}`, `{"vendor_payout_kobo": -1}`} {
		if _, err := parseThresholdPayload(json.RawMessage(bad)); !errors.Is(err, ErrApprovalInvalid) {
			t.Errorf("payload %q: err = %v, want ErrApprovalInvalid", bad, err)
		}
	}
}

func TestApprovalStatusMapsOntoMakercheck(t *testing.T) {
	want := map[string]makercheck.State{
		ApprovalPending:  makercheck.StatePending,
		ApprovalApproved: makercheck.StateApproved,
		ApprovalExecuted: makercheck.StateConsumed,
		ApprovalRejected: makercheck.StateRejected,
		ApprovalExpired:  makercheck.StateRejected,
	}
	for in, w := range want {
		if got := approvalToMakercheck(in); got != w {
			t.Errorf("%s → %s, want %s", in, got, w)
		}
	}
	if !errors.Is(mapMakercheckErr(makercheck.ErrSelfApproval), ErrApprovalSelf) {
		t.Fatal("self-approval must map to ErrApprovalSelf")
	}
	if !errors.Is(mapMakercheckErr(makercheck.ErrNotPending), ErrApprovalNotPending) {
		t.Fatal("not-pending must map to ErrApprovalNotPending")
	}
}

func TestDualControlOff_ServiceRefusesApprovals(t *testing.T) {
	svc := NewService(nil, nil) // flag off by default
	ctx := t.Context()
	if _, err := svc.CreateApproval(ctx, "e", "a", CreateApprovalInput{Action: ApprovalResidentBan, IdempotencyKey: "k"}); !errors.Is(err, ErrDualControlDisabled) {
		t.Fatalf("create: %v", err)
	}
	if _, _, err := svc.ApproveApproval(ctx, "e", "b", "id", ""); !errors.Is(err, ErrDualControlDisabled) {
		t.Fatalf("approve: %v", err)
	}
	if _, err := svc.RejectApproval(ctx, "e", "b", "id", ""); !errors.Is(err, ErrDualControlDisabled) {
		t.Fatalf("reject: %v", err)
	}
}

func dualControlRouter(svc *Service) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("user_id", "admin-a"); c.Next() })
	h := NewHandler(svc)
	r.POST("/estate/:id/admin/approvals", h.CreateApproval)
	r.POST("/estate/:id/admin/approvals/:rid/approve", h.ApproveApproval)
	return r
}

func TestApprovalHandlers_RequireIdempotencyKey(t *testing.T) {
	r := dualControlRouter(NewService(nil, nil).WithDualControl(true))
	for _, path := range []string{"/estate/e1/admin/approvals", "/estate/e1/admin/approvals/r1/approve"} {
		w := httptest.NewRecorder()
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, strings.NewReader(`{"action":"resident_ban","subject_id":"x"}`))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s without Idempotency-Key: status %d, want 400", path, w.Code)
		}
	}
}

func TestApprovalHandlers_FlagOffIs503(t *testing.T) {
	r := dualControlRouter(NewService(nil, nil))
	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/estate/e1/admin/approvals", strings.NewReader(`{"action":"resident_ban","subject_id":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "idem-12345678")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d, want 503 (body %s)", w.Code, w.Body.String())
	}
}

func TestApprovalErrMap(t *testing.T) {
	cases := map[error]int{
		ErrApprovalSelf:                         http.StatusForbidden,
		ErrApprovalNotFound:                     http.StatusNotFound,
		ErrApprovalNotPending:                   http.StatusConflict,
		ErrApprovalOpen:                         http.StatusConflict,
		ErrDualControlRequired:                  http.StatusConflict,
		ErrApprovalInvalid:                      http.StatusBadRequest,
		ErrIdempotencyRequired:                  http.StatusBadRequest,
		errors.New("estate: insufficient role"): http.StatusForbidden,
		errors.New("boom"):                      http.StatusInternalServerError,
	}
	for err, want := range cases {
		if got := approvalErrMap.Code(err); got != want {
			t.Errorf("%v → %d, want %d", err, got, want)
		}
	}
}

func TestWritePendingApproval(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	if writePendingApproval(c, errors.New("other")) {
		t.Fatal("non-pending error must not be written")
	}
	if !writePendingApproval(c, &PendingApprovalError{Request: &ApprovalRequest{ID: "r1", Status: ApprovalPending}}) {
		t.Fatal("pending error must be written")
	}
	if w.Code != http.StatusAccepted || !strings.Contains(w.Body.String(), `"pending_approval":true`) {
		t.Fatalf("got %d %s", w.Code, w.Body.String())
	}
}
