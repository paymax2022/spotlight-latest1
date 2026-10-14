package cryptosvc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/cryptoprov"
)

type fakeStepUp struct {
	has   bool
	err   error
	calls int
}

func (f *fakeStepUp) HasPin(context.Context, string) (bool, error) { return f.has, nil }
func (f *fakeStepUp) VerifyPin(_ context.Context, _ string, pin string) error {
	f.calls++
	if f.err != nil {
		return f.err
	}
	if pin != "1234" {
		return ErrStepUpRejected
	}
	return nil
}

type httpRig struct {
	*svcRig
	r  *gin.Engine
	su *fakeStepUp
}

// webhook provider wrapper: the Mock plus a trivial signature scheme.
type whProv struct{ *spy }

func (w whProv) VerifyWebhook(h map[string]string, _ []byte) error {
	if h["x-sig"] != "ok" {
		return cryptoprov.ErrBadSignature
	}
	return nil
}
func (w whProv) ParseWebhook(b []byte) (cryptoprov.Event, error) {
	t, id, _ := strings.Cut(string(b), "|")
	return cryptoprov.Event{Key: "mock:" + t + ":" + id, Type: t, Ref: id}, nil
}

func newHTTPRig(t *testing.T, uid string) *httpRig {
	t.Helper()
	return newHTTPRigWith(t, uid, nil)
}

// newHTTPRigWith is newHTTPRig with a hook to adjust the handler deps (limiters).
func newHTTPRigWith(t *testing.T, uid string, tweak func(*HandlerDeps)) *httpRig {
	t.Helper()
	gin.SetMode(gin.TestMode)
	s := newSvcRig(t)
	// Re-register a webhook-capable provider under the same name.
	reg := cryptoprov.NewRegistry("mock")
	_ = reg.Register(whProv{s.prov})
	ing := NewIngest(reg, s.store).WithSettler(s.svc.cfg.Settler)
	s.svc.cfg.Registry, s.svc.cfg.Ingest = reg, ing
	h := &httpRig{svcRig: s, su: &fakeStepUp{has: true}}
	h.r = gin.New()
	member := h.r.Group("/api/v1/crypto")
	member.Use(func(c *gin.Context) {
		if uid != "" {
			c.Set("user_id", uid)
		}
		c.Next()
	})
	deps := HandlerDeps{Service: s.svc, Ingest: ing, StepUp: h.su}
	if tweak != nil {
		tweak(&deps)
	}
	RegisterRoutes(member, h.r.Group("/api/v1/webhooks"), deps)
	return h
}

func (h *httpRig) do(method, path string, body any, hdr map[string]string) *httptest.ResponseRecorder {
	var rdr *bytes.Reader
	switch b := body.(type) {
	case nil:
		rdr = bytes.NewReader(nil)
	case string:
		rdr = bytes.NewReader([]byte(b))
	default:
		j, _ := json.Marshal(b)
		rdr = bytes.NewReader(j)
	}
	req := httptest.NewRequest(method, path, rdr)
	req.Header.Set("Content-Type", "application/json")
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.r.ServeHTTP(w, req)
	return w
}

func decode(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
		t.Fatalf("body %q: %v", w.Body.String(), err)
	}
	return m
}

func (h *httpRig) quoteHTTP(t *testing.T, key string, kobo int64) map[string]any {
	t.Helper()
	w := h.do("POST", "/api/v1/crypto/swaps/quote", map[string]any{"asset": "USDT", "ngn_kobo": kobo}, map[string]string{"Idempotency-Key": key})
	if w.Code != http.StatusCreated {
		t.Fatalf("quote: %d %s", w.Code, w.Body.String())
	}
	return decode(t, w)["swap"].(map[string]any)
}

func TestUnauthenticatedRequestsAreRejected(t *testing.T) {
	h := newHTTPRig(t, "")
	for _, p := range []string{"POST /api/v1/crypto/swaps/quote", "POST /api/v1/crypto/swaps/x/confirm", "GET /api/v1/crypto/swaps/x"} {
		m, path, _ := strings.Cut(p, " ")
		if w := h.do(m, path, `{}`, map[string]string{"Idempotency-Key": "k"}); w.Code != http.StatusUnauthorized {
			t.Errorf("%s -> %d", p, w.Code)
		}
	}
}

func TestQuoteRequiresAnIdempotencyKeyAndAValidBody(t *testing.T) {
	h := newHTTPRig(t, user)
	if w := h.do("POST", "/api/v1/crypto/swaps/quote", map[string]any{"asset": "USDT", "ngn_kobo": 100000}, nil); w.Code != http.StatusBadRequest {
		t.Errorf("no key -> %d", w.Code)
	}
	for name, body := range map[string]any{"bad json": `{`, "zero": map[string]any{"asset": "USDT", "ngn_kobo": 0}, "no asset": map[string]any{"ngn_kobo": 100}, "float": `{"asset":"USDT","ngn_kobo":1.5}`, "string": `{"asset":"USDT","ngn_kobo":"100"}`} {
		if w := h.do("POST", "/api/v1/crypto/swaps/quote", body, map[string]string{"Idempotency-Key": "k"}); w.Code != http.StatusBadRequest {
			t.Errorf("%s -> %d %s", name, w.Code, w.Body.String())
		}
	}
	if h.prov.AccountsCreated() != 0 {
		t.Fatal("invalid requests reached the provider")
	}
}

func TestQuoteReturnsAnIntegerKoboViewWithoutProviderInternals(t *testing.T) {
	h := newHTTPRig(t, user)
	sw := h.quoteHTTP(t, "k1", 1_000_000)
	if sw["status"] != "quoted" || sw["side"] != "buy" || sw["asset"] != "USDT" {
		t.Fatalf("swap = %v", sw)
	}
	if sw["ngn_kobo"] != float64(1_000_000) || sw["fee_kobo"] != float64(7_500) || sw["total_kobo"] != float64(1_007_500) {
		t.Fatalf("money fields = %v", sw)
	}
	if _, ok := sw["quoted_amount"].(string); !ok {
		t.Fatalf("crypto amounts must be decimal STRINGS: %v", sw["quoted_amount"])
	}
	for _, leak := range []string{"provider_account_id", "provider_quote_id", "provider_swap_id", "user_id", "idempotency_key"} {
		if _, ok := sw[leak]; ok {
			t.Errorf("response leaks %s", leak)
		}
	}
}

func TestQuoteIdempotencyConflictIs409(t *testing.T) {
	h := newHTTPRig(t, user)
	h.quoteHTTP(t, "same", 1_000_000)
	w := h.do("POST", "/api/v1/crypto/swaps/quote", map[string]any{"asset": "USDT", "ngn_kobo": 2_000_000}, map[string]string{"Idempotency-Key": "same"})
	if w.Code != http.StatusConflict {
		t.Fatalf("code = %d", w.Code)
	}
}

func TestConfirmRequiresAPinBeforeAnythingIsVerifiedOrHeld(t *testing.T) {
	h := newHTTPRig(t, user)
	h.led.fund(user, 2_000_000)
	sw := h.quoteHTTP(t, "k", 1_000_000)
	id := sw["id"].(string)
	// A missing pin is a bad request, never a failed guess that counts toward lockout.
	w := h.do("POST", "/api/v1/crypto/swaps/"+id+"/confirm", `{}`, nil)
	if w.Code != http.StatusBadRequest || h.su.calls != 0 {
		t.Fatalf("code=%d verifyCalls=%d", w.Code, h.su.calls)
	}
	// A wrong pin is refused and nothing is held.
	w = h.do("POST", "/api/v1/crypto/swaps/"+id+"/confirm", map[string]any{"pin": "9999"}, nil)
	if w.Code != http.StatusForbidden {
		t.Fatalf("wrong pin -> %d", w.Code)
	}
	if h.led.bal(walletK) != 2_000_000 || h.prov.confirms != 0 {
		t.Fatal("a failed step-up moved money or reached the provider")
	}
}

func TestConfirmWithoutAPinSetIsRefused(t *testing.T) {
	h := newHTTPRig(t, user)
	h.su.has = false
	sw := h.quoteHTTP(t, "k", 1_000_000)
	w := h.do("POST", "/api/v1/crypto/swaps/"+sw["id"].(string)+"/confirm", map[string]any{"pin": "1234"}, nil)
	if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "pin_not_set") {
		t.Fatalf("code=%d body=%s", w.Code, w.Body.String())
	}
}

func TestConfirmHoldsAndReturnsProcessing(t *testing.T) {
	h := newHTTPRig(t, user)
	h.led.fund(user, 2_000_000)
	sw := h.quoteHTTP(t, "k", 1_000_000)
	w := h.do("POST", "/api/v1/crypto/swaps/"+sw["id"].(string)+"/confirm", map[string]any{"pin": "1234"}, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("code=%d %s", w.Code, w.Body.String())
	}
	if got := decode(t, w)["swap"].(map[string]any)["status"]; got != "processing" {
		t.Fatalf("status = %v", got)
	}
	if h.led.bal(walletK) != 992_500 {
		t.Fatalf("wallet = %d", h.led.bal(walletK))
	}
}

func TestConfirmErrorsMapToSafeStatuses(t *testing.T) {
	h := newHTTPRig(t, user)
	h.led.fund(user, 500_000) // not enough
	sw := h.quoteHTTP(t, "k", 1_000_000)
	w := h.do("POST", "/api/v1/crypto/swaps/"+sw["id"].(string)+"/confirm", map[string]any{"pin": "1234"}, nil)
	if w.Code != http.StatusUnprocessableEntity || !strings.Contains(w.Body.String(), "insufficient_funds") {
		t.Fatalf("insufficient funds -> %d %s", w.Code, w.Body.String())
	}

	h2 := newHTTPRig(t, user)
	h2.led.fund(user, 2_000_000)
	sw2 := h2.quoteHTTP(t, "k", 1_000_000)
	h2.now = h2.now.Add(time_hour)
	w = h2.do("POST", "/api/v1/crypto/swaps/"+sw2["id"].(string)+"/confirm", map[string]any{"pin": "1234"}, nil)
	if w.Code != http.StatusGone {
		t.Fatalf("expired -> %d %s", w.Code, w.Body.String())
	}
}

func TestAnAmbiguousProviderOutcomeIs202WithoutInternals(t *testing.T) {
	h := newHTTPRig(t, user)
	h.led.fund(user, 2_000_000)
	sw := h.quoteHTTP(t, "k", 1_000_000)
	h.prov.confirmErr = &cryptoprov.APIError{Provider: "mock", Status: 503, Message: "internal stack trace here"}
	w := h.do("POST", "/api/v1/crypto/swaps/"+sw["id"].(string)+"/confirm", map[string]any{"pin": "1234"}, nil)
	if w.Code != http.StatusAccepted {
		t.Fatalf("code=%d %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "stack trace") {
		t.Fatal("provider error text leaked to the client")
	}
	if decode(t, w)["swap"].(map[string]any)["status"] != "needs_review" {
		t.Fatalf("body = %s", w.Body.String())
	}
}

func TestAnotherUsersSwapIs404OnEveryRoute(t *testing.T) {
	h := newHTTPRig(t, user)
	sw := h.quoteHTTP(t, "k", 1_000_000)
	id := sw["id"].(string)
	// Same app, different caller.
	other := newHTTPRigOn(h, "someone-else")
	if w := other.do("GET", "/api/v1/crypto/swaps/"+id, nil, nil); w.Code != http.StatusNotFound {
		t.Errorf("get -> %d", w.Code)
	}
	if w := other.do("POST", "/api/v1/crypto/swaps/"+id+"/confirm", map[string]any{"pin": "1234"}, nil); w.Code != http.StatusNotFound {
		t.Errorf("confirm -> %d", w.Code)
	}
}

func TestGetSwapReturnsTheOwnersView(t *testing.T) {
	h := newHTTPRig(t, user)
	sw := h.quoteHTTP(t, "k", 1_000_000)
	w := h.do("GET", "/api/v1/crypto/swaps/"+sw["id"].(string), nil, nil)
	if w.Code != http.StatusOK || decode(t, w)["swap"].(map[string]any)["id"] != sw["id"] {
		t.Fatalf("code=%d %s", w.Code, w.Body.String())
	}
}

// ---- webhook ---------------------------------------------------------------

func TestWebhookBadSignatureIs401AndStoresNothing(t *testing.T) {
	h := newHTTPRig(t, "")
	w := h.do("POST", "/api/v1/webhooks/crypto/mock", "swap_transaction.completed|sw1", map[string]string{"x-sig": "forged"})
	if w.Code != http.StatusUnauthorized || len(h.store.events) != 0 {
		t.Fatalf("code=%d events=%d", w.Code, len(h.store.events))
	}
}

func TestWebhookUnknownProviderIs404(t *testing.T) {
	h := newHTTPRig(t, "")
	if w := h.do("POST", "/api/v1/webhooks/crypto/nope", "x|y", map[string]string{"x-sig": "ok"}); w.Code != http.StatusNotFound {
		t.Fatalf("code=%d", w.Code)
	}
}

func TestWebhookCompletesASwapAndDuplicatesAre200(t *testing.T) {
	h := newHTTPRig(t, user)
	h.led.fund(user, 2_000_000)
	sw := h.quoteHTTP(t, "k", 1_000_000)
	conf := h.do("POST", "/api/v1/crypto/swaps/"+sw["id"].(string)+"/confirm", map[string]any{"pin": "1234"}, nil)
	psid := ""
	for _, r := range h.store.swaps {
		psid = r.ProviderSwapID
	}
	if conf.Code != http.StatusOK || psid == "" {
		t.Fatalf("setup: %d %s", conf.Code, conf.Body.String())
	}
	_ = h.prov.CompleteSwap(psid, cryptoprov.SwapCompleted)
	for i := 0; i < 2; i++ {
		w := h.do("POST", "/api/v1/webhooks/crypto/mock", "swap_transaction.completed|"+psid, map[string]string{"x-sig": "ok"})
		if w.Code != http.StatusOK {
			t.Fatalf("delivery %d -> %d %s", i, w.Code, w.Body.String())
		}
	}
	if h.led.bal(revenueK) != 7_500 {
		t.Fatalf("fee recognised %d times", h.led.bal(revenueK)/7_500)
	}
}

func TestWebhookProcessingFailureIs500SoTheProviderRetries(t *testing.T) {
	h := newHTTPRig(t, user)
	h.led.fund(user, 2_000_000)
	sw := h.quoteHTTP(t, "k", 1_000_000)
	_ = h.do("POST", "/api/v1/crypto/swaps/"+sw["id"].(string)+"/confirm", map[string]any{"pin": "1234"}, nil)
	var psid string
	for _, r := range h.store.swaps {
		psid = r.ProviderSwapID
	}
	_ = h.prov.CompleteSwap(psid, cryptoprov.SwapCompleted)
	h.prov.Mock.FailNext("getswap", errors.New("provider down"))
	w := h.do("POST", "/api/v1/webhooks/crypto/mock", "swap_transaction.completed|"+psid, map[string]string{"x-sig": "ok"})
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("code=%d", w.Code)
	}
	if strings.Contains(w.Body.String(), "provider down") {
		t.Fatal("internal error text leaked")
	}
}

func TestWebhookBodyIsSizeLimited(t *testing.T) {
	h := newHTTPRig(t, "")
	big := strings.Repeat("a", 2<<20)
	if w := h.do("POST", "/api/v1/webhooks/crypto/mock", big, map[string]string{"x-sig": "ok"}); w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("code=%d", w.Code)
	}
}

const time_hour = 3600 * 1e9

// newHTTPRigOn serves the SAME service and store under a different authenticated user.
func newHTTPRigOn(h *httpRig, uid string) *httpRig {
	o := &httpRig{svcRig: h.svcRig, su: h.su}
	o.r = gin.New()
	member := o.r.Group("/api/v1/crypto")
	member.Use(func(c *gin.Context) { c.Set("user_id", uid); c.Next() })
	RegisterRoutes(member, o.r.Group("/api/v1/webhooks"), HandlerDeps{Service: h.svc, Ingest: h.svc.cfg.Ingest, StepUp: h.su})
	return o
}
