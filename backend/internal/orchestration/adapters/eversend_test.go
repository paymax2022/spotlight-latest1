package adapters

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	orch "spotlight/backend/internal/orchestration"
	"spotlight/backend/internal/provider/eversend"
)

var (
	_ orch.Provider = (*EversendLive)(nil)
	_ orch.Provider = (*Eversend)(nil)
)

type evsCapture struct {
	quoteRate  atomic.Value // float64 returned by the quotation endpoint
	exchIdem   atomic.Value // Idempotency-Key header seen on /exchanges
	payoutIdem atomic.Value
	payoutBody atomic.Value
	exchCalls  atomic.Int32
	status     string
	exchFail   bool
}

func evsServer(t *testing.T, c *evsCapture) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/auth/token":
			_, _ = w.Write([]byte(`{"token":"tok"}`))
		case "/exchanges/quotation":
			rate, _ := c.quoteRate.Load().(float64)
			_, _ = w.Write([]byte(`{"data":{"quotation":{"token":"qt1","rate":` + ftoa(rate) + `,"fee":1.25}}}`))
		case "/exchanges":
			c.exchCalls.Add(1)
			c.exchIdem.Store(r.Header.Get("Idempotency-Key"))
			if c.exchFail {
				http.Error(w, "nope", http.StatusBadRequest)
				return
			}
			_, _ = w.Write([]byte(`{"data":{"transactionId":"ex-1","status":"successful","rate":1500.5,"destinationAmount":1500500.25}}`))
		case "/payouts":
			c.payoutIdem.Store(r.Header.Get("Idempotency-Key"))
			b, _ := io.ReadAll(r.Body)
			var m map[string]any
			_ = json.Unmarshal(b, &m)
			c.payoutBody.Store(m)
			_, _ = w.Write([]byte(`{"data":{"transactionId":"po-1","status":"` + c.status + `"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
}

func ftoa(f float64) string { b, _ := json.Marshal(f); return string(b) }

func newEvsLive(srv *httptest.Server, prod bool) *EversendLive {
	return NewEversendLive(eversend.New("id", "secret", prod).WithBaseURL(srv.URL), "whsec", prod)
}

func TestEversend_Name(t *testing.T) {
	if NewEversend(false).Name() != "eversend" || (&EversendLive{}).Name() != "eversend" {
		t.Fatal("name")
	}
}

func TestEversend_SupportsCorridors(t *testing.T) {
	e := NewEversend(false)
	if !e.Supports("USD-NGN", orch.RailIBAN) {
		t.Fatal("USD-NGN should be supported")
	}
	if e.Supports("USD-JPY", orch.RailIBAN) || e.Supports("garbage", orch.RailIBAN) {
		t.Fatal("unsupported corridor must be rejected")
	}
}

func TestEversendLive_Quote_MinorMajorRoundTrip(t *testing.T) {
	c := &evsCapture{}
	c.quoteRate.Store(1500.0)
	srv := evsServer(t, c)
	defer srv.Close()
	pq, err := newEvsLive(srv, false).Quote(context.Background(), "USD", "NGN", 100000, orch.AmountSource, orch.RailIBAN)
	if err != nil {
		t.Fatal(err)
	}
	if pq.Rate != 1500 || pq.ProviderFee.AmountMinor != 125 || pq.RailFee.AmountMinor != 150 || !pq.Viable {
		t.Fatalf("quote = %+v", pq)
	}
}

func TestEversendLive_Quote_RateFluctuationReflected(t *testing.T) {
	c := &evsCapture{}
	srv := evsServer(t, c)
	defer srv.Close()
	live := newEvsLive(srv, false)
	c.quoteRate.Store(1500.0)
	a, _ := live.Quote(context.Background(), "USD", "NGN", 100000, orch.AmountSource, orch.RailBankTransfer)
	c.quoteRate.Store(1480.0)
	b, _ := live.Quote(context.Background(), "USD", "NGN", 100000, orch.AmountSource, orch.RailBankTransfer)
	if a.Rate != 1500 || b.Rate != 1480 {
		t.Fatalf("rates %v %v", a.Rate, b.Rate)
	}
}

func TestEversendLive_Quote_NilClientFallsBack(t *testing.T) {
	pq, err := NewEversendLive(nil, "", false).Quote(context.Background(), "USD", "NGN", 100000, orch.AmountSource, orch.RailBankTransfer)
	if err != nil || pq == nil || pq.Provider != "eversend" {
		t.Fatalf("fallback quote = %+v err=%v", pq, err)
	}
}

func TestEversendLive_Quote_ProdFailsClosed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/auth/token" {
			_, _ = w.Write([]byte(`{"token":"tok"}`))
			return
		}
		http.Error(w, "down", http.StatusBadRequest)
	}))
	defer srv.Close()
	if pq, err := newEvsLive(srv, true).Quote(context.Background(), "USD", "NGN", 100000, orch.AmountSource, orch.RailBankTransfer); err == nil {
		t.Fatalf("prod must not price from the deterministic fallback, got %+v", pq)
	}
	// Non-prod keeps the graceful degradation.
	if pq, err := newEvsLive(srv, false).Quote(context.Background(), "USD", "NGN", 100000, orch.AmountSource, orch.RailBankTransfer); err != nil || pq == nil {
		t.Fatalf("non-prod should fall back, err=%v", err)
	}
}

func TestEversendLive_ExecuteConversion_HappyPathForwardsIdempotency(t *testing.T) {
	c := &evsCapture{}
	c.quoteRate.Store(1500.0)
	srv := evsServer(t, c)
	defer srv.Close()
	q := &orch.Quote{Source: orch.NewMoney(100000, "USD"), Destination: orch.NewMoney(150000000, "NGN"), AllInRate: 1500}
	res, err := newEvsLive(srv, false).ExecuteConversion(context.Background(), q, "idem-evs-1")
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := c.exchIdem.Load().(string); got != "idem-evs-1" {
		t.Fatalf("idempotency header = %q", got)
	}
	if res.ProviderRef != "ex-1" || res.Status != "settled" || res.Destination.AmountMinor != 150050025 || res.Destination.Currency != "NGN" || res.ExecutedRate != 1500.5 {
		t.Fatalf("result = %+v", res)
	}
}

func TestEversendLive_ExecuteConversion_FailureAndMissingKey(t *testing.T) {
	c := &evsCapture{exchFail: true}
	c.quoteRate.Store(1500.0)
	srv := evsServer(t, c)
	defer srv.Close()
	live := newEvsLive(srv, false)
	q := &orch.Quote{Source: orch.NewMoney(100000, "USD"), Destination: orch.NewMoney(1, "NGN")}
	if _, err := live.ExecuteConversion(context.Background(), q, "k"); err == nil {
		t.Fatal("provider failure must surface as an error, not a settled result")
	}
	before := c.exchCalls.Load()
	if _, err := live.ExecuteConversion(context.Background(), q, ""); err == nil {
		t.Fatal("empty idempotency key must be rejected")
	}
	if c.exchCalls.Load() != before {
		t.Fatal("no provider call may be made without an idempotency key")
	}
}

func TestEversendLive_ExecuteTransfer_StatusMappingAndIdempotency(t *testing.T) {
	for status, want := range map[string]string{"successful": "paid", "completed": "paid", "pending": "processing"} {
		c := &evsCapture{status: status}
		srv := evsServer(t, c)
		q := &orch.Quote{Source: orch.NewMoney(100000, "USD"), Destination: orch.NewMoney(250050, "USD"), AllInRate: 1}
		d := orch.Destination{Currency: "USD", AccountNumber: "acct-9", Counterparty: orch.Counterparty{Name: "Ada"}}
		res, err := newEvsLive(srv, false).ExecuteTransfer(context.Background(), q, d, "idem-po-1")
		srv.Close()
		if err != nil || res.Status != want || res.ProviderRef != "po-1" {
			t.Fatalf("%s: res=%+v err=%v", status, res, err)
		}
		if got, _ := c.payoutIdem.Load().(string); got != "idem-po-1" {
			t.Fatalf("payout idempotency header = %q", got)
		}
		body, _ := c.payoutBody.Load().(map[string]any)
		if body["amount"] != 2500.5 || body["reference"] != "idem-po-1" {
			t.Fatalf("payout body = %v", body)
		}
	}
}

func TestEversendLive_ExecuteTransfer_RejectsEmptyKey(t *testing.T) {
	c := &evsCapture{status: "pending"}
	srv := evsServer(t, c)
	defer srv.Close()
	q := &orch.Quote{Destination: orch.NewMoney(100, "USD")}
	if _, err := newEvsLive(srv, false).ExecuteTransfer(context.Background(), q, orch.Destination{}, ""); err == nil {
		t.Fatal("expected error")
	}
}

func TestEversend_Webhook_SignatureVerification(t *testing.T) {
	payload := []byte(`{"event":"payout.successful","id":"po-1"}`)
	mac := hmac.New(sha256.New, []byte("whsec"))
	mac.Write(payload)
	good := hex.EncodeToString(mac.Sum(nil))

	live := NewEversendLive(nil, "whsec", false)
	if !live.VerifyWebhookSignature(payload, good) {
		t.Fatal("valid signature rejected")
	}
	if live.VerifyWebhookSignature(payload, strings.Repeat("0", len(good))) || live.VerifyWebhookSignature(payload, "") {
		t.Fatal("bad/empty signature accepted")
	}
	if live.VerifyWebhookSignature(append(payload, ' '), good) {
		t.Fatal("tampered payload accepted")
	}
	if NewEversendLive(nil, "", false).VerifyWebhookSignature(payload, good) {
		t.Fatal("empty secret must fail closed")
	}
	if NewEversend(false).VerifyWebhookSignature(payload, good) {
		t.Fatal("deterministic adapter must fail closed")
	}
}

func TestEversendLive_ExecuteConversion_RateMovedAdverselyRejected(t *testing.T) {
	c := &evsCapture{}
	c.quoteRate.Store(1490.0) // ~67 bps below the 1500 promised to the customer
	srv := evsServer(t, c)
	defer srv.Close()
	q := &orch.Quote{Source: orch.NewMoney(100000, "USD"), Destination: orch.NewMoney(150000000, "NGN"), AllInRate: 1500}
	if _, err := newEvsLive(srv, false).ExecuteConversion(context.Background(), q, "k"); err != ErrRateMoved {
		t.Fatalf("want ErrRateMoved, got %v", err)
	}
	if c.exchCalls.Load() != 0 {
		t.Fatal("no exchange may be placed once the rate has moved")
	}
	c.quoteRate.Store(1495.0) // 33 bps: within tolerance
	if _, err := newEvsLive(srv, false).ExecuteConversion(context.Background(), q, "k2"); err != nil {
		t.Fatalf("within tolerance must execute: %v", err)
	}
}

func TestEversend_CreateCollection_NeverFabricatesIBAN(t *testing.T) {
	if r, err := NewEversend(false).CreateCollection(context.Background(), "EUR", "iban", "c"); err == nil || r != nil {
		t.Fatalf("deterministic adapter must not return bank details: %+v", r)
	}
}
