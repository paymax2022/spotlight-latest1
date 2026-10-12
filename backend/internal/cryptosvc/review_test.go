package cryptosvc

// Regression tests for the independent security + money review of PR #719.

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"spotlight/backend/internal/cryptoprov"
)

type auditSink struct {
	mu sync.Mutex
	ev []AuditEvent
}

func (a *auditSink) Audit(_ context.Context, e AuditEvent) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.ev = append(a.ev, e)
}

func (a *auditSink) actions() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	var out []string
	for _, e := range a.ev {
		out = append(out, e.Action)
	}
	return out
}

func (a *auditSink) has(action string) bool {
	for _, x := range a.actions() {
		if x == action {
			return true
		}
	}
	return false
}

func TestMalformedSwapIDsAre404NotAServerError(t *testing.T) {
	h := newHTTPRig(t, user)
	h.led.fund(user, 2_000_000)
	for _, id := range []string{"not-a-uuid", "x", "..%2Fetc", "1%3B%20drop%20table"} {
		if w := h.do("GET", "/api/v1/crypto/swaps/"+id, nil, nil); w.Code != http.StatusNotFound {
			t.Errorf("GET %q -> %d", id, w.Code)
		}
		w := h.do("POST", "/api/v1/crypto/swaps/"+id+"/confirm", map[string]any{"pin": "1234"}, nil)
		if w.Code != http.StatusNotFound {
			t.Errorf("confirm %q -> %d", id, w.Code)
		}
	}
	if h.su.calls != 0 {
		t.Fatal("a PIN was verified against a malformed swap id")
	}
}

func TestQuoteHasAnUpperBound(t *testing.T) {
	h := newHTTPRig(t, user)
	for _, kobo := range []int64{MaxQuoteKobo + 1, 9_223_372_036_854_775_000} {
		w := h.do("POST", "/api/v1/crypto/swaps/quote", map[string]any{"asset": "USDT", "ngn_kobo": kobo}, map[string]string{"Idempotency-Key": "k"})
		if w.Code != http.StatusBadRequest {
			t.Errorf("%d -> %d", kobo, w.Code)
		}
	}
	if h.prov.AccountsCreated() != 0 {
		t.Fatal("an absurd quote created a provider account")
	}
}

func TestIdempotencyKeysAreLengthAndCharsetBounded(t *testing.T) {
	h := newHTTPRig(t, user)
	for name, key := range map[string]string{
		"too long": strings.Repeat("a", 256),
		"spaces":   "has space",
		"quotes":   `a"b`,
		"newline":  "a\tb",
	} {
		w := h.do("POST", "/api/v1/crypto/swaps/quote", map[string]any{"asset": "USDT", "ngn_kobo": 100000}, map[string]string{"Idempotency-Key": key})
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s -> %d", name, w.Code)
		}
	}
	if w := h.do("POST", "/api/v1/crypto/swaps/quote", map[string]any{"asset": "USDT", "ngn_kobo": 100000}, map[string]string{"Idempotency-Key": "ok-key_1.2:3"}); w.Code != http.StatusCreated {
		t.Errorf("a normal key was refused: %d", w.Code)
	}
}

// countingLocker records the peak number of callers inside the distributed lock per key.
type countingLocker struct {
	memLocker
	mu       sync.Mutex
	waiting  map[string]int
	peakWait int
}

func (c *countingLocker) WithSwapLock(ctx context.Context, id string, fn func(context.Context) error) error {
	c.mu.Lock()
	if c.waiting == nil {
		c.waiting = map[string]int{}
	}
	c.waiting[id]++
	if c.waiting[id] > c.peakWait {
		c.peakWait = c.waiting[id]
	}
	c.mu.Unlock()
	defer func() { c.mu.Lock(); c.waiting[id]--; c.mu.Unlock() }()
	return c.memLocker.WithSwapLock(ctx, id, fn)
}

// A user hammering one swap must not pin one pooled lock connection per request.
func TestParallelConfirmsOfOneSwapQueueInProcessNotOnThePool(t *testing.T) {
	r := newSvcRig(t)
	cl := &countingLocker{}
	r.svc.cfg.Locker = cl
	r.led.fund(user, 2_000_000)
	q := r.quote(t, "k", 1_000_000)
	var wg sync.WaitGroup
	var started int32
	for i := 0; i < 30; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			atomic.AddInt32(&started, 1)
			_, _ = r.svc.Confirm(context.Background(), user, q.ID)
		}()
	}
	wg.Wait()
	if cl.peakWait > 2 { // the in-process gate lets one through at a time; nested settler keys differ
		t.Fatalf("up to %d callers were inside the distributed lock for one swap", cl.peakWait)
	}
	if r.prov.confirms != 1 || r.led.bal(walletK) != 992_500 {
		t.Fatalf("confirms=%d wallet=%d", r.prov.confirms, r.led.bal(walletK))
	}
}

func TestMoneyMutationsEmitAuditEvents(t *testing.T) {
	r := newSvcRig(t)
	a := &auditSink{}
	r.svc.cfg.Audit = a
	r.svc.cfg.Ingest.WithAuditor(a)
	r.led.fund(user, 2_000_000)
	q := r.quote(t, "k", 1_000_000)
	conf, err := r.svc.Confirm(context.Background(), user, q.ID)
	if err != nil {
		t.Fatal(err)
	}
	_ = r.prov.CompleteSwap(conf.ProviderSwapID, cryptoprov.SwapCompleted)
	if _, err := r.svc.Resolve(context.Background(), user, q.ID); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"crypto.swap.quote", "crypto.swap.hold", "crypto.swap.executed", "crypto.swap.completed"} {
		if !a.has(want) {
			t.Errorf("missing audit event %q (got %v)", want, a.actions())
		}
	}
	for _, e := range a.ev {
		if e.Actor == "" || e.EntityID == "" {
			t.Errorf("audit event without actor or entity: %+v", e)
		}
	}
}

func TestRefusalsAndParksAreAudited(t *testing.T) {
	r := newSvcRig(t)
	a := &auditSink{}
	r.svc.cfg.Audit = a
	r.led.fund(user, 2_000_000)
	q := r.quote(t, "k", 1_000_000)
	r.prov.confirmErr = &cryptoprov.APIError{Provider: "mock", Status: 503}
	_, _ = r.svc.Confirm(context.Background(), user, q.ID)
	if !a.has("crypto.swap.parked") {
		t.Fatalf("a parked swap with money held was not audited: %v", a.actions())
	}

	r2 := newSvcRig(t)
	a2 := &auditSink{}
	r2.svc.cfg.Audit = a2
	r2.led.fund(user, 2_000_000)
	q2 := r2.quote(t, "k", 1_000_000)
	r2.prov.confirmErr = &cryptoprov.APIError{Provider: "mock", Status: 422}
	_, _ = r2.svc.Confirm(context.Background(), user, q2.ID)
	if !a2.has("crypto.swap.released") {
		t.Fatalf("a released hold was not audited: %v", a2.actions())
	}
}

func TestAWrongPinIsAudited(t *testing.T) {
	h := newHTTPRig(t, user)
	a := &auditSink{}
	h.svc.cfg.Audit = a
	sw := h.quoteHTTP(t, "k", 1_000_000)
	_ = h.do("POST", "/api/v1/crypto/swaps/"+sw["id"].(string)+"/confirm", map[string]any{"pin": "9999"}, nil)
	if !a.has("crypto.swap.pin_rejected") {
		t.Fatalf("pin rejection not audited: %v", a.actions())
	}
	for _, e := range a.ev {
		if strings.Contains(strings.ToLower(e.Reason), "9999") {
			t.Fatal("the PIN was written to the audit log")
		}
	}
}
