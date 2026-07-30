package crypto

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

// rtFunc is a fake http.RoundTripper: it returns a canned status+body per call and
// captures the last request so tests can assert what the adapter sent.
type rtFunc struct {
	status  int
	body    string
	err     error
	lastReq *http.Request
	lastRaw string
}

func (f *rtFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	f.lastReq = r
	if r.Body != nil {
		b, _ := io.ReadAll(r.Body)
		f.lastRaw = string(b)
	}
	if f.err != nil {
		return nil, f.err
	}
	return &http.Response{
		StatusCode: f.status,
		Body:       io.NopCloser(strings.NewReader(f.body)),
		Header:     make(http.Header),
	}, nil
}

func newTestQuidax(rt *rtFunc, live bool) *quidaxProvider {
	p := newQuidaxProvider("https://api.example/v1", "test-key", live)
	p.http = &http.Client{Transport: rt}
	return p
}

func TestQuidax_PriceKobo(t *testing.T) {
	t.Run("valid ticker → naira×100 kobo", func(t *testing.T) {
		rt := &rtFunc{status: 200, body: `{"data":{"ticker":{"last":"90000000.00"}}}`}
		p := newTestQuidax(rt, false)
		got, ok := p.PriceKobo(context.Background(), "BTC")
		if !ok || got != 9_000_000_000 {
			t.Fatalf("PriceKobo = %d, ok=%v; want 9000000000, true", got, ok)
		}
		// market must be lowercased symbol + ngn
		if !strings.HasSuffix(rt.lastReq.URL.Path, "/markets/tickers/btcngn") {
			t.Errorf("ticker path = %s; want …/markets/tickers/btcngn", rt.lastReq.URL.Path)
		}
		if rt.lastReq.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("missing bearer auth header")
		}
	})
	t.Run("fractional naira rounds to nearest kobo", func(t *testing.T) {
		rt := &rtFunc{status: 200, body: `{"data":{"ticker":{"last":"1599.999"}}}`}
		got, ok := newTestQuidax(rt, false).PriceKobo(context.Background(), "usdt")
		if !ok || got != 160000 {
			t.Fatalf("PriceKobo = %d, ok=%v; want 160000, true", got, ok)
		}
	})
	t.Run("non-2xx → ok=false (degrade, never trade on bad price)", func(t *testing.T) {
		if _, ok := newTestQuidax(&rtFunc{status: 404, body: `{}`}, false).PriceKobo(context.Background(), "BTC"); ok {
			t.Fatal("expected ok=false on 404")
		}
	})
	t.Run("malformed / non-positive → ok=false", func(t *testing.T) {
		for _, b := range []string{`not json`, `{"data":{"ticker":{"last":"0"}}}`, `{"data":{"ticker":{"last":"abc"}}}`} {
			if _, ok := newTestQuidax(&rtFunc{status: 200, body: b}, false).PriceKobo(context.Background(), "BTC"); ok {
				t.Fatalf("expected ok=false for body %q", b)
			}
		}
	})
	t.Run("empty symbol → ok=false", func(t *testing.T) {
		if _, ok := newTestQuidax(&rtFunc{status: 200, body: `{}`}, false).PriceKobo(context.Background(), ""); ok {
			t.Fatal("expected ok=false for empty symbol")
		}
	})
}

func TestQuidax_Broadcast(t *testing.T) {
	base := BroadcastRequest{
		WithdrawalID: "wd1", Symbol: "BTC", Network: "bitcoin",
		Address: "bc1qxyz", Units: 150000, MinorUnitScale: 100_000_000, // 0.0015 BTC
		ProviderIdemKey: "crypto:withdraw:wd1",
	}

	t.Run("2xx with id → Accepted + ref/tx", func(t *testing.T) {
		rt := &rtFunc{status: 201, body: `{"data":{"id":"QWD-1","txid":"0xabc","status":"processing"}}`}
		res, err := newTestQuidax(rt, true).Broadcast(context.Background(), base)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !res.Accepted || res.ProviderRef != "QWD-1" || res.TxHash != "0xabc" {
			t.Fatalf("res = %+v; want accepted QWD-1/0xabc", res)
		}
		// amount must be the whole-unit decimal, and note carries the idem key
		if !strings.Contains(rt.lastRaw, `"amount":"0.0015"`) {
			t.Errorf("amount not formatted as 0.0015: %s", rt.lastRaw)
		}
		if !strings.Contains(rt.lastRaw, `"fund_uid":"bc1qxyz"`) || !strings.Contains(rt.lastRaw, `"currency":"btc"`) {
			t.Errorf("payload missing fund_uid/currency: %s", rt.lastRaw)
		}
		if !strings.HasSuffix(rt.lastReq.URL.Path, "/users/me/withdraws") {
			t.Errorf("withdraw path = %s", rt.lastReq.URL.Path)
		}
	})

	t.Run("FAIL-CLOSED: non-2xx → error, NOT accepted (service keeps pending)", func(t *testing.T) {
		for _, code := range []int{400, 401, 422, 429, 500, 503} {
			rt := &rtFunc{status: code, body: `{"error":"nope"}`}
			res, err := newTestQuidax(rt, false).Broadcast(context.Background(), base)
			if err == nil {
				t.Fatalf("code %d: expected error (fail-closed), got nil", code)
			}
			if res.Accepted {
				t.Fatalf("code %d: must NOT be Accepted on non-2xx", code)
			}
		}
	})

	t.Run("FAIL-CLOSED: transport error → error, not accepted", func(t *testing.T) {
		rt := &rtFunc{err: io.ErrUnexpectedEOF}
		res, err := newTestQuidax(rt, false).Broadcast(context.Background(), base)
		if err == nil || res.Accepted {
			t.Fatalf("transport error must surface + not accept; got res=%+v err=%v", res, err)
		}
	})

	t.Run("2xx but missing id → error (never fabricate success)", func(t *testing.T) {
		rt := &rtFunc{status: 200, body: `{"data":{"txid":"0xabc"}}`}
		if res, err := newTestQuidax(rt, false).Broadcast(context.Background(), base); err == nil || res.Accepted {
			t.Fatalf("missing id must error; got res=%+v err=%v", res, err)
		}
	})

	t.Run("guard: missing scale / address / units / key", func(t *testing.T) {
		p := newTestQuidax(&rtFunc{status: 200, body: `{"data":{"id":"x"}}`}, false)
		if _, err := p.Broadcast(context.Background(), BroadcastRequest{Symbol: "BTC", Address: "a", Units: 1, MinorUnitScale: 0}); err == nil {
			t.Error("expected error on missing scale")
		}
		if _, err := p.Broadcast(context.Background(), BroadcastRequest{Symbol: "BTC", Address: "", Units: 1, MinorUnitScale: 1e8}); err == nil {
			t.Error("expected error on empty address")
		}
		noKey := newQuidaxProvider("https://api.example/v1", "", false)
		noKey.http = &http.Client{Transport: &rtFunc{status: 200, body: `{"data":{"id":"x"}}`}}
		if _, err := noKey.Broadcast(context.Background(), base); err == nil {
			t.Error("expected error when api key missing")
		}
	})
}

func TestFormatWholeUnits(t *testing.T) {
	cases := []struct {
		units, scale int64
		want         string
	}{
		{100_000_000, 100_000_000, "1"},          // 1 BTC
		{150_000, 100_000_000, "0.0015"},         // 0.0015 BTC
		{1, 100_000_000, "0.00000001"},           // 1 sat
		{2_500_000, 1_000_000, "2.5"},            // 2.5 (6dp asset)
		{1_600, 100, "16"},                       // 16.00 → 16
		{0, 100_000_000, "0"},                    // zero
		{123, 0, "0"},                            // guard: bad scale
	}
	for _, c := range cases {
		if got := formatWholeUnits(c.units, c.scale); got != c.want {
			t.Errorf("formatWholeUnits(%d,%d) = %q; want %q", c.units, c.scale, got, c.want)
		}
	}
}

func TestProvidersFromConfig(t *testing.T) {
	t.Run("default/mock", func(t *testing.T) {
		p, w, mode := ProvidersFromConfig(ProviderConfig{Provider: "mock"})
		if p.Name() != "mock" || w.Name() != "mock" || !strings.Contains(mode, "mock") {
			t.Fatalf("want mock providers; got price=%s withdraw=%s mode=%s", p.Name(), w.Name(), mode)
		}
	})
	t.Run("quidax test creds selected in non-prod", func(t *testing.T) {
		p, w, mode := ProvidersFromConfig(ProviderConfig{
			Provider: "quidax", Live: false,
			TestKey: "tk", TestBaseURL: "https://t/v1", LiveKey: "lk", LiveBaseURL: "https://l/v1",
		})
		if p.Name() != "quidax-test" || w.Name() != "quidax-test" || mode != "quidax-test" {
			t.Fatalf("want quidax-test; got price=%s withdraw=%s mode=%s", p.Name(), w.Name(), mode)
		}
		if qp, ok := p.(*quidaxProvider); !ok || qp.baseURL != "https://t/v1" || qp.apiKey != "tk" {
			t.Fatalf("test creds not selected: %#v", p)
		}
	})
	t.Run("quidax live creds selected in prod", func(t *testing.T) {
		p, _, mode := ProvidersFromConfig(ProviderConfig{
			Provider: "quidax", Live: true,
			TestKey: "tk", TestBaseURL: "https://t/v1", LiveKey: "lk", LiveBaseURL: "https://l/v1",
		})
		if mode != "quidax-live" {
			t.Fatalf("want quidax-live; got %s", mode)
		}
		if qp := p.(*quidaxProvider); qp.baseURL != "https://l/v1" || qp.apiKey != "lk" {
			t.Fatalf("live creds not selected: %#v", qp)
		}
	})
	t.Run("quidax selected but creds missing → safe mock fallback", func(t *testing.T) {
		p, w, mode := ProvidersFromConfig(ProviderConfig{Provider: "quidax", Live: false, TestKey: "", TestBaseURL: "https://t/v1"})
		if p.Name() != "mock" || w.Name() != "mock" || !strings.Contains(mode, "mock") {
			t.Fatalf("want mock fallback; got price=%s withdraw=%s mode=%s", p.Name(), w.Name(), mode)
		}
	})
}
