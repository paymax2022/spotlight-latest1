package crypto

// The customer withdrawal must be authorised by the user's transaction PIN,
// verified on the SERVER before anything moves. The app's OTP step used to be
// client-side only (the code was discarded), so a stolen session could withdraw.
// Every refusal here happens before the service is touched: the Service under
// test has no pool, so reaching it would panic.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

type fakeStepUp struct {
	calls int
	err   error
}

func (f *fakeStepUp) verify(_ context.Context, _ string, pin string) error {
	f.calls++
	return f.err
}

func withdrawRouter(svc *Service) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("user_id", "u-1"); c.Next() })
	r.POST("/withdrawals", NewHandler(svc).Withdraw)
	return r
}

func postWithdraw(r *gin.Engine, body string) (int, map[string]any) {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/withdrawals", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "wd-stepup-test-key-0001")
	r.ServeHTTP(w, req)
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out
}

const wdBody = `{"symbol":"USDT","address_id":"a-1","units":1000}`

func TestWithdraw_RequiresAServerVerifiedPin(t *testing.T) {
	t.Run("no verifier wired fails closed", func(t *testing.T) {
		code, _ := postWithdraw(withdrawRouter(&Service{}), `{"symbol":"USDT","address_id":"a-1","units":1000,"pin":"1234"}`)
		if code != http.StatusServiceUnavailable {
			t.Fatalf("status %d, want 503", code)
		}
	})
	t.Run("missing pin is a bad request and is not scored", func(t *testing.T) {
		f := &fakeStepUp{}
		code, out := postWithdraw(withdrawRouter((&Service{}).WithStepUp(f.verify)), wdBody)
		if code != http.StatusBadRequest || out["code"] != "pin_required" || f.calls != 0 {
			t.Fatalf("status %d body %v calls %d, want 400 pin_required with no verify call", code, out, f.calls)
		}
	})
	t.Run("wrong or locked pin is refused", func(t *testing.T) {
		f := &fakeStepUp{err: ErrStepUpRejected}
		code, out := postWithdraw(withdrawRouter((&Service{}).WithStepUp(f.verify)), `{"symbol":"USDT","address_id":"a-1","units":1000,"pin":"0000"}`)
		if code != http.StatusForbidden || out["code"] != "pin_invalid" || f.calls != 1 {
			t.Fatalf("status %d body %v calls %d, want 403 pin_invalid", code, out, f.calls)
		}
	})
	t.Run("no pin set is refused distinctly", func(t *testing.T) {
		f := &fakeStepUp{err: ErrPinNotSet}
		code, out := postWithdraw(withdrawRouter((&Service{}).WithStepUp(f.verify)), `{"symbol":"USDT","address_id":"a-1","units":1000,"pin":"1234"}`)
		if code != http.StatusForbidden || out["code"] != "pin_not_set" {
			t.Fatalf("status %d body %v, want 403 pin_not_set", code, out)
		}
	})
	t.Run("a verifier outage is a 500, never a pass", func(t *testing.T) {
		f := &fakeStepUp{err: errors.New("db down")}
		code, _ := postWithdraw(withdrawRouter((&Service{}).WithStepUp(f.verify)), `{"symbol":"USDT","address_id":"a-1","units":1000,"pin":"1234"}`)
		if code != http.StatusInternalServerError {
			t.Fatalf("status %d, want 500", code)
		}
	})
}
