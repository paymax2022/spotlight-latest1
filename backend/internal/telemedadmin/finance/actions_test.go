package finance

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

type fakeActor struct {
	calls   []string
	gotKey  string
	gotNote string
	gotIn   CommissionUpdate
	err     error
}

func (f *fakeActor) rec(name, key string) (ActionResult, error) {
	f.calls = append(f.calls, name)
	f.gotKey = key
	return ActionResult{Action: name, Status: "ok"}, f.err
}
func (f *fakeActor) approvePayout(_ context.Context, key, _, _, note string) (ActionResult, error) {
	f.gotNote = note
	return f.rec("approve", key)
}
func (f *fakeActor) holdPayout(_ context.Context, key, _, _, reason string) (ActionResult, error) {
	f.gotNote = reason
	return f.rec("hold", key)
}
func (f *fakeActor) resolveDispute(_ context.Context, key, _, _, _, note string) (ActionResult, error) {
	f.gotNote = note
	return f.rec("resolve", key)
}
func (f *fakeActor) updateCommission(_ context.Context, key, _, _ string, in CommissionUpdate) (ActionResult, error) {
	f.gotIn = in
	return f.rec("commission", key)
}

const someID = "3f2b1c4e-8a9d-4e0b-9c1d-2a3b4c5d6e7f"

func actionRouter(f *fakeActor, manage gin.HandlerFunc) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/api/v1/telemedicine/admin")
	g.Use(func(c *gin.Context) { c.Set("user_id", "9a9a9a9a-8a9d-4e0b-9c1d-2a3b4c5d6e7f"); c.Next() })
	registerActions(g, f, manage)
	return r
}

func send(r *gin.Engine, method, path, key, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	r.ServeHTTP(w, req)
	return w
}

func TestActions_GuardedByManage(t *testing.T) {
	f := &fakeActor{}
	r := actionRouter(f, func(c *gin.Context) { c.AbortWithStatus(http.StatusForbidden) })
	for _, rt := range r.Routes() {
		p := strings.NewReplacer(":id", someID, ":doctorUserId", someID).Replace(rt.Path)
		if w := send(r, rt.Method, p, "key-12345678", `{}`); w.Code != http.StatusForbidden {
			t.Errorf("%s %s = %d, want 403", rt.Method, rt.Path, w.Code)
		}
	}
	if len(f.calls) != 0 {
		t.Errorf("actor reached without manage: %v", f.calls)
	}
}

func TestActions_RequireIdempotencyKey(t *testing.T) {
	f := &fakeActor{}
	r := actionRouter(f, allowAll)
	cases := []struct{ m, p, body string }{
		{http.MethodPost, base + "/payouts/" + someID + "/approve", `{}`},
		{http.MethodPost, base + "/payouts/" + someID + "/hold", `{"reason":"kyc"}`},
		{http.MethodPost, base + "/disputes/" + someID + "/resolve", `{"outcome":"resolved","note":"x"}`},
		{http.MethodPut, base + "/commission-config/" + someID, `{"commission_bps":1500,"vat_bps":750,"payout_cycle":"weekly"}`},
	}
	for _, tc := range cases {
		for _, key := range []string{"", "short"} {
			if w := send(r, tc.m, tc.p, key, tc.body); w.Code != http.StatusBadRequest {
				t.Errorf("%s %s key=%q = %d, want 400", tc.m, tc.p, key, w.Code)
			}
		}
		if w := send(r, tc.m, tc.p, "key-12345678", tc.body); w.Code != http.StatusOK {
			t.Errorf("%s %s with key = %d: %s", tc.m, tc.p, w.Code, w.Body)
		}
	}
	if len(f.calls) != 4 || f.gotKey != "key-12345678" {
		t.Errorf("calls=%v key=%q", f.calls, f.gotKey)
	}
}

func TestActions_ValidateBodies(t *testing.T) {
	f := &fakeActor{}
	r := actionRouter(f, allowAll)
	bad := []struct{ m, p, body string }{
		{http.MethodPost, base + "/payouts/not-a-uuid/approve", `{}`},
		{http.MethodPost, base + "/payouts/" + someID + "/hold", `{"reason":"  "}`},
		{http.MethodPost, base + "/disputes/" + someID + "/resolve", `{"outcome":"refunded","note":"x"}`},
		{http.MethodPost, base + "/disputes/" + someID + "/resolve", `{"outcome":"resolved"}`},
		{http.MethodPut, base + "/commission-config/" + someID, `{"commission_bps":10001,"vat_bps":0,"payout_cycle":"weekly"}`},
		{http.MethodPut, base + "/commission-config/" + someID, `{"commission_bps":100,"vat_bps":-1,"payout_cycle":"weekly"}`},
		{http.MethodPut, base + "/commission-config/" + someID, `{"commission_bps":100,"vat_bps":0,"payout_cycle":"daily"}`},
	}
	for _, tc := range bad {
		if w := send(r, tc.m, tc.p, "key-12345678", tc.body); w.Code != http.StatusBadRequest {
			t.Errorf("%s %s %s = %d, want 400", tc.m, tc.p, tc.body, w.Code)
		}
	}
	if len(f.calls) != 0 {
		t.Errorf("actor reached with invalid input: %v", f.calls)
	}
	if w := send(r, http.MethodPost, base+"/payouts/"+someID+"/hold", "key-12345678", `{"reason":"  bank mismatch "}`); w.Code != http.StatusOK || f.gotNote != "bank mismatch" {
		t.Errorf("hold = %d note=%q", w.Code, f.gotNote)
	}
}

func TestActions_ErrorMapping(t *testing.T) {
	for err, want := range map[error]int{
		errNotFound: http.StatusNotFound,
		fmt.Errorf("%w: payout is paid", errConflict): http.StatusConflict,
		errKeyReuse:        http.StatusUnprocessableEntity,
		fmt.Errorf("boom"): http.StatusInternalServerError,
	} {
		r := actionRouter(&fakeActor{err: err}, allowAll)
		if w := send(r, http.MethodPost, base+"/payouts/"+someID+"/approve", "key-12345678", ``); w.Code != want {
			t.Errorf("%v -> %d, want %d", err, w.Code, want)
		}
	}
}
