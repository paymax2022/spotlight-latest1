package cryptosvc

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

// memControls is an in-memory ControlsStore with the same version/idempotency rules as PG.
type memControls struct {
	mu   sync.Mutex
	hist []VersionedControls
	keys map[string]int
	err  error
}

func newMemControls() *memControls { return &memControls{keys: map[string]int{}} }

func (m *memControls) Current(context.Context) (VersionedControls, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.err != nil {
		return VersionedControls{}, m.err
	}
	if len(m.hist) == 0 {
		return VersionedControls{Reason: "default", CreatedBy: "system"}, nil
	}
	return m.hist[len(m.hist)-1], nil
}

func (m *memControls) History(_ context.Context, limit int) ([]VersionedControls, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []VersionedControls{}
	for i := len(m.hist) - 1; i >= 0 && len(out) < limit; i-- {
		out = append(out, m.hist[i])
	}
	return out, nil
}

func (m *memControls) Append(_ context.Context, in ControlsInput) (ControlsChange, error) {
	if err := in.Validate(); err != nil {
		return ControlsChange{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if i, ok := m.keys[in.IdempotencyKey]; ok {
		if !sameControls(m.hist[i].Controls, in.Controls.normalised()) {
			return ControlsChange{}, ErrControlsIdempotencyConflict
		}
		return ControlsChange{New: m.hist[i]}, nil
	}
	old := VersionedControls{Reason: "default", CreatedBy: "system"}
	if len(m.hist) > 0 {
		old = m.hist[len(m.hist)-1]
	}
	if old.Version != in.ExpectedVersion {
		return ControlsChange{}, ErrControlsVersionConflict
	}
	v := VersionedControls{Version: old.Version + 1, Controls: in.Controls.normalised(), Reason: in.Reason, CreatedBy: in.Actor, CreatedAt: time.Now()}
	m.hist = append(m.hist, v)
	m.keys[in.IdempotencyKey] = len(m.hist) - 1
	return ControlsChange{New: v, Old: old, Created: true}, nil
}

func setControls(t *testing.T, m *memControls, c Controls) {
	t.Helper()
	cur, _ := m.Current(context.Background())
	if _, err := m.Append(context.Background(), ControlsInput{Controls: c, Reason: "test", Actor: "admin:1", IdempotencyKey: time.Now().String(), ExpectedVersion: cur.Version}); err != nil {
		t.Fatal(err)
	}
}

func controlledRig(t *testing.T) (*svcRig, *memControls) {
	r := newSvcRig(t)
	m := newMemControls()
	r.svc.cfg.Controls = m
	return r, m
}

func TestControlsValidation(t *testing.T) {
	ok := ControlsInput{Reason: "incident 42", Actor: "admin:1", IdempotencyKey: "k"}
	if err := ok.Validate(); err != nil {
		t.Fatalf("valid input refused: %v", err)
	}
	for name, mut := range map[string]func(*ControlsInput){
		"no reason":        func(i *ControlsInput) { i.Reason = " " },
		"no actor":         func(i *ControlsInput) { i.Actor = "" },
		"bad asset":        func(i *ControlsInput) { i.DisabledAssets = []string{"BTC!"} },
		"NGN market":       func(i *ControlsInput) { i.DisabledAssets = []string{"ngn"} },
		"negative limit":   func(i *ControlsInput) { i.MaxQuoteKobo = -1 },
		"limit above cap":  func(i *ControlsInput) { i.MaxQuoteKobo = MaxQuoteKobo + 1 },
		"banner too long":  func(i *ControlsInput) { i.Banner = &Banner{Message: string(make([]byte, 281)), Severity: "info"} },
		"banner severity":  func(i *ControlsInput) { i.Banner = &Banner{Message: "hi", Severity: "panic"} },
		"empty banner":     func(i *ControlsInput) { i.Banner = &Banner{Message: "  ", Severity: "info"} },
		"negative version": func(i *ControlsInput) { i.ExpectedVersion = -1 },
	} {
		in := ok
		mut(&in)
		if err := in.Validate(); !errors.Is(err, ErrControlsInput) {
			t.Errorf("%s: err = %v", name, err)
		}
	}
}

func TestTradingPauseRefusesQuotesAndConfirmsBeforeAnyMoneyMoves(t *testing.T) {
	r, m := controlledRig(t)
	q := r.quote(t, "k1", 1_000_000) // quoted before the pause
	setControls(t, m, Controls{TradingPaused: true})
	if _, err := r.svc.Quote(context.Background(), QuoteRequest{UserID: user, IdempotencyKey: "k2", Asset: "USDT", NGNKobo: 1_000_000}); !errors.Is(err, ErrTradingPaused) {
		t.Fatalf("quote while paused: %v", err)
	}
	if _, err := r.svc.Confirm(context.Background(), user, q.ID); !errors.Is(err, ErrTradingPaused) {
		t.Fatalf("confirm while paused: %v", err)
	}
	if r.led.total() != 0 || r.prov.confirms != 0 {
		t.Fatal("a paused trade moved money or reached the provider")
	}
}

func TestMarketSwitchStopsOnlyThatMarket(t *testing.T) {
	r, m := controlledRig(t)
	r.prov.SetPrice("BTCNGN", decimal.RequireFromString("100000000"))
	r.prov.SetPrice("NGNBTC", decimal.RequireFromString("0.00000001"))
	setControls(t, m, Controls{DisabledAssets: []string{"usdt"}})
	if _, err := r.svc.Quote(context.Background(), QuoteRequest{UserID: user, IdempotencyKey: "k1", Asset: "USDT", NGNKobo: 1_000_000}); !errors.Is(err, ErrMarketDisabled) {
		t.Fatalf("disabled market: %v", err)
	}
	if _, err := r.svc.Quote(context.Background(), QuoteRequest{UserID: user, IdempotencyKey: "k2", Asset: "USDT", Side: SideSell, Amount: decimal.NewFromInt(1)}); !errors.Is(err, ErrMarketDisabled) {
		t.Fatalf("disabled market (sell): %v", err)
	}
}

func TestQuoteLimitAppliesToBothSides(t *testing.T) {
	r, m := controlledRig(t)
	r.prov.SetPrice("USDTNGN", decimal.RequireFromString("1500"))
	setControls(t, m, Controls{MaxQuoteKobo: 500_000})
	if _, err := r.svc.Quote(context.Background(), QuoteRequest{UserID: user, IdempotencyKey: "b", Asset: "USDT", NGNKobo: 500_001}); !errors.Is(err, ErrAboveLimit) {
		t.Fatalf("buy over limit: %v", err)
	}
	if _, err := r.svc.Quote(context.Background(), QuoteRequest{UserID: user, IdempotencyKey: "s", Asset: "USDT", Side: SideSell, Amount: decimal.NewFromInt(10)}); !errors.Is(err, ErrAboveLimit) {
		t.Fatalf("sell worth ₦15,000 over a ₦5,000 limit: %v", err)
	}
	if _, err := r.svc.Quote(context.Background(), QuoteRequest{UserID: user, IdempotencyKey: "ok", Asset: "USDT", NGNKobo: 500_000}); err != nil {
		t.Fatalf("at the limit: %v", err)
	}
}

func TestControlsUnreadableFailsClosed(t *testing.T) {
	r, m := controlledRig(t)
	q := r.quote(t, "k1", 1_000_000)
	m.err = errors.New("db down")
	if _, err := r.svc.Quote(context.Background(), QuoteRequest{UserID: user, IdempotencyKey: "k2", Asset: "USDT", NGNKobo: 1_000_000}); err == nil {
		t.Fatal("quoted without being able to read the controls")
	}
	if _, err := r.svc.Confirm(context.Background(), user, q.ID); err == nil || r.led.total() != 0 {
		t.Fatalf("confirmed without being able to read the controls: %v", err)
	}
}

func TestControlsStoreVersionAndIdempotency(t *testing.T) {
	m := newMemControls()
	ctx := context.Background()
	in := ControlsInput{Controls: Controls{WithdrawalsPaused: true}, Reason: "incident", Actor: "admin:1", IdempotencyKey: "a", ExpectedVersion: 0}
	if ch, err := m.Append(ctx, in); err != nil || !ch.Created || ch.New.Version != 1 {
		t.Fatalf("first append: %+v %v", ch, err)
	}
	if ch, err := m.Append(ctx, in); err != nil || ch.Created {
		t.Fatalf("replay must return the stored row: %+v %v", ch, err)
	}
	in2 := in
	in2.WithdrawalsPaused = false
	if _, err := m.Append(ctx, in2); !errors.Is(err, ErrControlsIdempotencyConflict) {
		t.Fatalf("same key, other body: %v", err)
	}
	in2.IdempotencyKey = "b" // still expects version 0
	if _, err := m.Append(ctx, in2); !errors.Is(err, ErrControlsVersionConflict) {
		t.Fatalf("stale version: %v", err)
	}
}

func controlsHTTP(t *testing.T, uid string) (*httpRig, *memControls) {
	t.Helper()
	h := newHTTPRig(t, uid)
	m := newMemControls()
	h.svc.cfg.Controls = m
	inject := func(c *gin.Context) {
		if uid != "" {
			c.Set("user_id", uid)
		}
		c.Next()
	}
	RegisterControlRoutes(h.r.Group("/api/v1/crypto", inject), h.r.Group("/api/v1/admin/crypto", inject), m)
	return h, m
}

func TestStatusRouteShowsTheLiveControls(t *testing.T) {
	h, m := controlsHTTP(t, user)
	setControls(t, m, Controls{WithdrawalsPaused: true, DisabledAssets: []string{"btc"}, Banner: &Banner{Message: "Withdrawals are paused while we upgrade.", Severity: "warning"}})
	w := h.do("GET", "/api/v1/crypto/status", nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status: %d %s", w.Code, w.Body.String())
	}
	s := decode(t, w)["status"].(map[string]any)
	if s["withdrawals_paused"] != true || s["trading_paused"] != false || s["max_quote_kobo"] != float64(MaxQuoteKobo) {
		t.Fatalf("status = %v", s)
	}
	if d := s["disabled_assets"].([]any); len(d) != 1 || d[0] != "BTC" {
		t.Fatalf("disabled = %v", d)
	}
	if b := s["banner"].(map[string]any); b["severity"] != "warning" {
		t.Fatalf("banner = %v", b)
	}
	m.err = errors.New("db down")
	if w := h.do("GET", "/api/v1/crypto/status", nil, nil); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("unreadable controls -> %d, want 503 (never 'all open')", w.Code)
	}
}

func TestAdminControlsUpdate(t *testing.T) {
	h, m := controlsHTTP(t, "admin-1")
	put := func(key string, body any) *httptest.ResponseRecorder {
		hdr := map[string]string{}
		if key != "" {
			hdr["Idempotency-Key"] = key
		}
		return h.do("PUT", "/api/v1/admin/crypto/controls", body, hdr)
	}
	body := map[string]any{"expected_version": 0, "trading_paused": true, "withdrawals_paused": false, "disabled_assets": []string{"doge"}, "max_quote_kobo": 0, "reason": "provider incident"}
	if w := put("", body); w.Code != http.StatusBadRequest {
		t.Fatalf("no key -> %d", w.Code)
	}
	w := put("c1", body)
	if w.Code != http.StatusOK {
		t.Fatalf("update: %d %s", w.Code, w.Body.String())
	}
	cur, _ := m.Current(context.Background())
	if !cur.TradingPaused || cur.Version != 1 || cur.CreatedBy != "admin-1" || cur.DisabledAssets[0] != "DOGE" {
		t.Fatalf("stored = %+v", cur)
	}
	if w := put("c1", body); w.Code != http.StatusOK || decode(t, w)["created"] != false {
		t.Fatalf("replay: %d %s", w.Code, w.Body.String())
	}
	if w := put("c2", body); w.Code != http.StatusConflict { // still expects version 0
		t.Fatalf("stale version -> %d", w.Code)
	}
	bad := map[string]any{"expected_version": 1, "reason": "x", "max_quote_kobo": -5}
	if w := put("c3", bad); w.Code != http.StatusBadRequest {
		t.Fatalf("invalid -> %d", w.Code)
	}
	if w := put("c4", `{"expected_version":1,"reason":"x","surprise":true}`); w.Code != http.StatusBadRequest {
		t.Fatalf("unknown field -> %d", w.Code)
	}
	w = h.do("GET", "/api/v1/admin/crypto/controls", nil, nil)
	if w.Code != http.StatusOK || len(decode(t, w)["history"].([]any)) != 1 {
		t.Fatalf("get: %d %s", w.Code, w.Body.String())
	}
}

func TestARetriedConfirmStillHonoursAPauseSetAfterTheClaim(t *testing.T) {
	r, m := controlledRig(t)
	q := r.quote(t, "k1", 1_000_000)
	// Simulate a confirm that claimed quoted->confirming and then died before executing.
	if ok, err := r.store.TransitionSwap(context.Background(), q.ID, "quoted", "confirming", decimal.Zero, ""); err != nil || !ok {
		t.Fatalf("claim: %v %v", ok, err)
	}
	setControls(t, m, Controls{TradingPaused: true})
	if _, err := r.svc.Confirm(context.Background(), user, q.ID); !errors.Is(err, ErrTradingPaused) {
		t.Fatalf("retried confirm while paused: %v", err)
	}
	if r.prov.confirms != 0 || r.led.total() != 0 {
		t.Fatal("a paused retry reached the provider or held money")
	}
}

func TestALimitLoweredAfterTheQuoteStopsTheConfirm(t *testing.T) {
	r, m := controlledRig(t)
	q := r.quote(t, "k1", 1_000_000)
	setControls(t, m, Controls{MaxQuoteKobo: 500_000})
	if _, err := r.svc.Confirm(context.Background(), user, q.ID); !errors.Is(err, ErrAboveLimit) {
		t.Fatalf("confirm above a lowered limit: %v", err)
	}
	if r.prov.confirms != 0 || r.led.total() != 0 {
		t.Fatal("moved money above the limit")
	}
}

func TestAuditActionPrefixIsMatchedLiterally(t *testing.T) {
	if got := likePrefix(`a_b%c\`); got != `a\_b\%c\\` {
		t.Fatalf("likePrefix = %q", got)
	}
}
