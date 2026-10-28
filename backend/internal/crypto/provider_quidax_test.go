package crypto

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
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
	t.Run("real sandbox shape: data.<market>.ticker.last is a JSON number", func(t *testing.T) {
		rt := &rtFunc{status: 200, body: `{"status":"success","data":{"usdtngn":{"ticker":{"last":1363.5000000000000000,"buy":1363.5},"at":1791736915000}}}`}
		got, ok := newTestQuidax(rt, false).PriceKobo(context.Background(), "USDT")
		if !ok || got != 136350 {
			t.Fatalf("PriceKobo = %d, ok=%v; want 136350, true", got, ok)
		}
	})
	t.Run("real shape for a different market is not used", func(t *testing.T) {
		rt := &rtFunc{status: 200, body: `{"data":{"ethngn":{"ticker":{"last":5}}}}`}
		if _, ok := newTestQuidax(rt, false).PriceKobo(context.Background(), "BTC"); ok {
			t.Fatal("price taken from the wrong market")
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
		{100_000_000, 100_000_000, "1"},  // 1 BTC
		{150_000, 100_000_000, "0.0015"}, // 0.0015 BTC
		{1, 100_000_000, "0.00000001"},   // 1 sat
		{2_500_000, 1_000_000, "2.5"},    // 2.5 (6dp asset)
		{1_600, 100, "16"},               // 16.00 → 16
		{0, 100_000_000, "0"},            // zero
		{123, 0, "0"},                    // guard: bad scale
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

// === Quidax Instant Swap Tests (R1) ===

func TestQuidax_CreateQuotation(t *testing.T) {
	t.Run("valid quotation → id + expiry", func(t *testing.T) {
		rt := &rtFunc{status: 201, body: `{
			"data":{
				"id":"QT-12345",
				"from_amount":1000000,
				"to_amount":50000,
				"status":"pending",
				"expires_at":"2026-10-28T12:34:50Z"
			}
		}`}
		p := newTestQuidax(rt, false)
		quoteID, expiresAt, err := p.CreateQuotation(context.Background(), "user1", "NGN", "BTC", 100_000_000) // 1M kobo
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if quoteID != "QT-12345" {
			t.Errorf("quoteID = %s; want QT-12345", quoteID)
		}
		if expiresAt.IsZero() {
			t.Error("expiresAt must not be zero")
		}
		// Verify API path and headers
		if !strings.Contains(rt.lastReq.URL.Path, "/exchange-open-api/api/v1/users/user1/swap_quotation") {
			t.Errorf("path = %s; want …/users/user1/swap_quotation", rt.lastReq.URL.Path)
		}
		if rt.lastReq.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("missing or wrong Authorization header")
		}
	})

	t.Run("non-2xx → error", func(t *testing.T) {
		for _, code := range []int{400, 401, 429, 500} {
			rt := &rtFunc{status: code, body: `{"error":"invalid pair"}`}
			_, _, err := newTestQuidax(rt, false).CreateQuotation(context.Background(), "user1", "NGN", "BADCOIN", 100_000_000)
			if err == nil {
				t.Fatalf("code %d: expected error, got nil", code)
			}
		}
	})

	t.Run("missing api key → error", func(t *testing.T) {
		p := newQuidaxProvider("https://api.example/v1", "", false)
		_, _, err := p.CreateQuotation(context.Background(), "user1", "NGN", "BTC", 100_000_000)
		if err == nil {
			t.Error("expected error when api key missing")
		}
	})

	t.Run("invalid amount ≤ 0 → error", func(t *testing.T) {
		p := newTestQuidax(&rtFunc{status: 201, body: `{}`}, false)
		for _, amt := range []int64{0, -100} {
			_, _, err := p.CreateQuotation(context.Background(), "user1", "NGN", "BTC", amt)
			if err == nil {
				t.Errorf("expected error for amount %d", amt)
			}
		}
	})

	t.Run("response missing id → error (never fabricate)", func(t *testing.T) {
		rt := &rtFunc{status: 201, body: `{"data":{"expires_at":"2026-10-28T12:34:50Z"}}`}
		_, _, err := newTestQuidax(rt, false).CreateQuotation(context.Background(), "user1", "NGN", "BTC", 100_000_000)
		if err == nil {
			t.Error("expected error when response missing id")
		}
	})

	t.Run("no expires_at → fall back to 15 seconds from now", func(t *testing.T) {
		rt := &rtFunc{status: 201, body: `{"data":{"id":"QT-99","from_amount":1000000}}`}
		p := newTestQuidax(rt, false)
		before := time.Now().UTC()
		_, expiresAt, err := p.CreateQuotation(context.Background(), "user1", "NGN", "BTC", 100_000_000)
		after := time.Now().UTC()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		// expiresAt should be approximately 15 seconds from the time of the call
		delta := expiresAt.Sub(before).Seconds()
		if delta < 14 || delta > 16 {
			t.Errorf("expiresAt delta = %.1f sec; want ~15", delta)
		}
		_ = after // satisfy linter
	})
}

func TestQuidax_ConfirmQuotation(t *testing.T) {
	t.Run("valid confirm → swap transaction id", func(t *testing.T) {
		rt := &rtFunc{status: 200, body: `{
			"data":{
				"swap_transaction_id":"SWP-67890",
				"status":"processing",
				"from_amount":1000000,
				"to_amount":50000
			}
		}`}
		p := newTestQuidax(rt, false)
		txID, err := p.ConfirmQuotation(context.Background(), "user1", "QT-12345")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if txID != "SWP-67890" {
			t.Errorf("txID = %s; want SWP-67890", txID)
		}
		// Verify path
		if !strings.Contains(rt.lastReq.URL.Path, "/exchange-open-api/api/v1/users/user1/swap_quotation/QT-12345/confirm") {
			t.Errorf("path = %s; want …/swap_quotation/QT-12345/confirm", rt.lastReq.URL.Path)
		}
	})

	t.Run("quote expired / invalid → non-2xx error", func(t *testing.T) {
		rt := &rtFunc{status: 422, body: `{"error":"quotation expired"}`}
		_, err := newTestQuidax(rt, false).ConfirmQuotation(context.Background(), "user1", "QT-EXPIRED")
		if err == nil {
			t.Error("expected error on expired quotation")
		}
	})

	t.Run("missing swap_transaction_id in response → error", func(t *testing.T) {
		rt := &rtFunc{status: 200, body: `{"data":{"status":"processing"}}`}
		_, err := newTestQuidax(rt, false).ConfirmQuotation(context.Background(), "user1", "QT-12345")
		if err == nil {
			t.Error("expected error when swap_transaction_id missing")
		}
	})

	t.Run("missing quotation id → error", func(t *testing.T) {
		p := newTestQuidax(&rtFunc{status: 200, body: `{}`}, false)
		_, err := p.ConfirmQuotation(context.Background(), "user1", "")
		if err == nil {
			t.Error("expected error for empty quotation id")
		}
	})
}

func TestQuidax_GetSwapTransaction(t *testing.T) {
	t.Run("terminal success → status + metadata", func(t *testing.T) {
		rt := &rtFunc{status: 200, body: `{
			"data":{
				"status":"completed",
				"from_amount":1000000,
				"to_amount":50000,
				"fee":10000,
				"rate":"0.05"
			}
		}`}
		p := newTestQuidax(rt, false)
		status, meta, err := p.GetSwapTransaction(context.Background(), "user1", "SWP-67890")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if status != "completed" {
			t.Errorf("status = %s; want completed", status)
		}
		if len(meta) == 0 {
			t.Error("metadata should not be empty")
		}
		if f, ok := meta["fee"].(float64); !ok || f != 10000 {
			t.Errorf("fee in metadata = %v; want 10000 (as float)", meta["fee"])
		}
	})

	t.Run("pending (not terminal) → status + retry", func(t *testing.T) {
		rt := &rtFunc{status: 200, body: `{
			"data":{"status":"pending","reason":"awaiting confirmation from blockchain"}
		}`}
		status, meta, err := newTestQuidax(rt, false).GetSwapTransaction(context.Background(), "user1", "SWP-99")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if status != "pending" {
			t.Errorf("status = %s; want pending", status)
		}
		if len(meta) == 0 {
			t.Error("metadata should not be empty")
		}
	})

	t.Run("404 / not found → error", func(t *testing.T) {
		rt := &rtFunc{status: 404, body: `{"error":"transaction not found"}`}
		_, _, err := newTestQuidax(rt, false).GetSwapTransaction(context.Background(), "user1", "SWP-NOTFOUND")
		if err == nil {
			t.Error("expected error on 404")
		}
	})

	t.Run("missing status in response → error", func(t *testing.T) {
		rt := &rtFunc{status: 200, body: `{"data":{"from_amount":1000000}}`}
		_, _, err := newTestQuidax(rt, false).GetSwapTransaction(context.Background(), "user1", "SWP-12345")
		if err == nil {
			t.Error("expected error when status missing")
		}
	})
}

func TestVerifyQuidaxWebhook(t *testing.T) {
	t.Run("valid signature → nil error", func(t *testing.T) {
		secret := "test-webhook-secret"
		body := []byte(`{"event_type":"swap.completed","id":"EVT-1","timestamp":1635100000000}`)

		// Calculate correct signature
		h := hmac.New(sha256.New, []byte(secret))
		h.Write(body)
		signature := hex.EncodeToString(h.Sum(nil))

		err := VerifyQuidaxWebhook(body, signature, secret, 300)
		if err != nil {
			t.Errorf("unexpected error with valid signature: %v", err)
		}
	})

	t.Run("wrong signature → error", func(t *testing.T) {
		secret := "test-secret"
		body := []byte(`{"event_type":"swap.completed"}`)
		err := VerifyQuidaxWebhook(body, "wrongsignature123", secret, 300)
		if err == nil {
			t.Error("expected error with wrong signature")
		}
	})

	t.Run("missing signature header → error", func(t *testing.T) {
		err := VerifyQuidaxWebhook([]byte(`{}`), "", "secret", 300)
		if err == nil {
			t.Error("expected error when signature missing")
		}
	})

	t.Run("missing webhook secret → error", func(t *testing.T) {
		body := []byte(`{}`)
		h := hmac.New(sha256.New, []byte("some-secret"))
		h.Write(body)
		sig := hex.EncodeToString(h.Sum(nil))
		err := VerifyQuidaxWebhook(body, sig, "", 300)
		if err == nil {
			t.Error("expected error when webhook secret missing")
		}
	})
}

func TestParseQuidaxWebhook(t *testing.T) {
	t.Run("valid event → parsed", func(t *testing.T) {
		body := []byte(`{
			"event_type":"swap.completed",
			"id":"EVT-12345",
			"timestamp":1635100000000,
			"data":{"swap_transaction_id":"SWP-99","status":"completed"}
		}`)
		event, err := ParseQuidaxWebhook(body)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if event.EventType != "swap.completed" {
			t.Errorf("event_type = %s; want swap.completed", event.EventType)
		}
		if event.ID != "EVT-12345" {
			t.Errorf("id = %s; want EVT-12345", event.ID)
		}
		if event.Timestamp != 1635100000000 {
			t.Errorf("timestamp = %d; want 1635100000000", event.Timestamp)
		}
	})

	t.Run("malformed json → error", func(t *testing.T) {
		_, err := ParseQuidaxWebhook([]byte(`{broken`))
		if err == nil {
			t.Error("expected error with malformed json")
		}
	})

	t.Run("missing event_type → error", func(t *testing.T) {
		_, err := ParseQuidaxWebhook([]byte(`{"id":"EVT-1","timestamp":1000}`))
		if err == nil {
			t.Error("expected error when event_type missing")
		}
	})

	t.Run("missing id → error", func(t *testing.T) {
		_, err := ParseQuidaxWebhook([]byte(`{"event_type":"swap.completed","timestamp":1000}`))
		if err == nil {
			t.Error("expected error when id missing")
		}
	})
}
