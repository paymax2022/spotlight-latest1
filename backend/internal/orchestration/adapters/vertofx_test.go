package adapters

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	orch "spotlight/backend/internal/orchestration"
	"spotlight/backend/internal/provider/vertofx"
)

var (
	_ orch.Provider = (*VertoFXLive)(nil)
	_ orch.Provider = (*VertoFX)(nil)
)

func TestVertoFX_Name(t *testing.T) {
	if got := NewVertoFX(false).Name(); got != "vertofx" {
		t.Fatalf("Name = %q", got)
	}
	if got := NewVertoFXLive(nil, "", false).Name(); got != "vertofx" {
		t.Fatalf("live Name = %q", got)
	}
}

func TestVertoFX_SupportsCorridors(t *testing.T) {
	v := NewVertoFXLive(nil, "", false)
	for _, c := range []string{"USD-NGN", "EUR-GBP", "NGN-KES", "GBP-AED", "USD-INR"} {
		if !v.Supports(c, orch.RailIBAN) {
			t.Errorf("expected %s supported", c)
		}
	}
	for _, c := range []string{"USD-JPY", "USDNGN", "BTC-NGN", ""} {
		if v.Supports(c, orch.RailIBAN) {
			t.Errorf("expected %s unsupported", c)
		}
	}
}

// fakeVerto serves login + rate; rate is returned as a decimal string.
func fakeVerto(t *testing.T, rate string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/users/login":
			_, _ = w.Write([]byte(`{"data":{"token":"tok","companyId":"co1"}}`))
		case "/fx/rate":
			_, _ = w.Write([]byte(`{"data":{"rate":"` + rate + `","vfxToken":"vt1"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
}

func TestVertoFXLive_Quote_MinorMajorRoundTrip(t *testing.T) {
	srv := fakeVerto(t, "1.234567")
	defer srv.Close()
	live := NewVertoFXLive(vertofx.New("id", "key", false).WithBaseURL(srv.URL), "", false)

	// Whole-major minor amounts round-trip exactly.
	for _, minor := range []int64{100, 123400, 99999900} {
		maj, err := vertoMinorToMajor(minor, "USD")
		if err != nil {
			t.Fatal(err)
		}
		if back := vertoMajorToMinor(maj, "USD"); back != minor {
			t.Fatalf("round trip %d -> %d -> %d", minor, maj, back)
		}
	}
	// A fractional-major amount must fail closed, never silently truncate.
	if _, err := vertoMinorToMajor(150050, "USD"); err == nil {
		t.Fatal("expected error for fractional major units")
	}

	// 1000.00 USD (100000 minor) at 1.234567 -> 1234.567 -> customer receives 1234.56 (floor).
	got, err := convertFloor(100000, 1_234_567, 2, 2)
	if err != nil || got != 123456 {
		t.Fatalf("convertFloor = %d, %v; want 123456", got, err)
	}
	// Destination-type: ceil so the customer receives at least the target.
	src, err := convertCeilSource(123456, 1_234_567, 2, 2)
	if err != nil || src != 100000 {
		t.Fatalf("convertCeilSource = %d, %v; want 100000", src, err)
	}
	if rcv, _ := convertFloor(src, 1_234_567, 2, 2); rcv < 123456 {
		t.Fatalf("destination-type under-delivers: %d", rcv)
	}

	q, err := live.Quote(context.Background(), "USD", "EUR", 100000, orch.AmountSource, orch.RailIBAN)
	if err != nil {
		t.Fatal(err)
	}
	if q.Provider != "vertofx" || !q.Viable || q.Rate != 1.234567 {
		t.Fatalf("unexpected quote %+v", q)
	}
	if q.ProviderFee.AmountMinor != 0 || q.ProviderFee.Currency != "USD" { // spread only via fxMarkup (D1)
		t.Fatalf("fee = %+v", q.ProviderFee)
	}
}

// Pins sub-unit rate behaviour: value that rounds to zero is never quoted viable.
func TestVertoFXLive_Quote_SubUnitRateNotViable(t *testing.T) {
	srv := fakeVerto(t, "0.00065")
	defer srv.Close()
	live := NewVertoFXLive(vertofx.New("id", "key", false).WithBaseURL(srv.URL), "", false)
	q, err := live.Quote(context.Background(), "NGN", "USD", 100, orch.AmountSource, orch.RailIBAN)
	if err != nil {
		t.Fatal(err)
	}
	if q.Viable {
		t.Fatal("0.065 minor units out must not be viable")
	}
	if got, _ := convertFloor(100, 650, 2, 2); got != 0 {
		t.Fatalf("floor = %d, want 0", got)
	}
}

func TestVertoFXLive_Quote_NilClientFallsBack(t *testing.T) {
	q, err := NewVertoFXLive(nil, "", false).Quote(context.Background(), "USD", "NGN", 10000, orch.AmountSource, orch.RailIBAN)
	if err != nil || q.Provider != "vertofx" || !q.Viable {
		t.Fatalf("fallback quote = %+v, %v", q, err)
	}
}

func TestVertoFXLive_VerifyWebhookSignature(t *testing.T) {
	payload := []byte(`{"event":"x"}`)
	m := hmac.New(sha256.New, []byte("s3cret"))
	m.Write(payload)
	sig := hex.EncodeToString(m.Sum(nil))

	live := NewVertoFXLive(vertofx.New("", "", false).WithWebhookSecret("s3cret"), "s3cret", false)
	if !live.VerifyWebhookSignature(payload, sig) {
		t.Fatal("valid signature rejected")
	}
	if live.VerifyWebhookSignature(payload, "deadbeef") || live.VerifyWebhookSignature(payload, "") {
		t.Fatal("bad signature accepted")
	}
	if NewVertoFXLive(nil, "s3cret", false).VerifyWebhookSignature(payload, sig) {
		t.Fatal("nil client must fail closed")
	}
	if NewVertoFX(false).VerifyWebhookSignature(payload, sig) {
		t.Fatal("deterministic adapter must fail closed")
	}
}

func TestVertoFXLive_ExecuteConversion_RejectsFractionalMajor(t *testing.T) {
	live := NewVertoFXLive(vertofx.New("", "", false), "", false)
	q := &orch.Quote{Source: orch.NewMoney(150050, "USD"), Destination: orch.NewMoney(1, "NGN")}
	if _, err := live.ExecuteConversion(context.Background(), q, "idem-1"); err == nil {
		t.Fatal("expected fractional-major error")
	}
}

// execServer serves login, rate, trades and funding; captures the trade body.
func execServer(t *testing.T, tradeStatus string, tradeBody *map[string]any, fundingFail bool) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/users/login":
			_, _ = w.Write([]byte(`{"data":{"token":"tok","companyId":"co1"}}`))
		case r.URL.Path == "/fx/rate":
			_, _ = w.Write([]byte(`{"data":{"rate":"1.5","vfxToken":"vt9"}}`))
		case r.URL.Path == "/fx/trades":
			b, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(b, tradeBody)
			_, _ = w.Write([]byte(`{"data":{"id":"trade-1","status":"` + tradeStatus + `"}}`))
		case strings.HasSuffix(r.URL.Path, "/funding-methods"):
			if fundingFail {
				http.Error(w, "boom", http.StatusBadRequest)
				return
			}
			_, _ = w.Write([]byte(`{"data":{"accountName":"Verto Ltd","accountNumber":"123","bankName":"B","bankCode":"9","reference":"ref-1"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
}

func TestVertoFXLive_ExecuteTransfer_HappyPath(t *testing.T) {
	var body map[string]any
	srv := execServer(t, "pending", &body, false)
	defer srv.Close()
	live := NewVertoFXLive(vertofx.New("id", "key", false).WithBaseURL(srv.URL), "", false)
	q := &orch.Quote{Source: orch.NewMoney(100000, "usd"), Destination: orch.NewMoney(1, "ngn"), AllInRate: 1}
	res, err := live.ExecuteTransfer(context.Background(), q, orch.Destination{AccountNumber: "acct-77"}, "idem-42")
	if err != nil {
		t.Fatal(err)
	}
	if body["paymentId"] != "idem-42" || body["targetAccountId"] != "acct-77" || body["vfxToken"] != "vt9" {
		t.Fatalf("trade body = %v", body)
	}
	if body["sourceAmount"] != float64(1000) { // 100000 minor -> 1000 major
		t.Fatalf("sourceAmount = %v", body["sourceAmount"])
	}
	mk, _ := body["fxMarkup"].(map[string]any)
	if mk["markupType"] != "percentage" || mk["markupPerc"] != float64(vertoFeeBPS) {
		t.Fatalf("fxMarkup = %v", mk)
	}
	if res.ProviderRef != "trade-1" || res.Status != "processing" || res.Destination.AmountMinor != 150000 || res.Destination.Currency != "NGN" {
		t.Fatalf("result = %+v", res)
	}
}

func TestVertoFXLive_ExecuteConversion_StatusMapping(t *testing.T) {
	for status, want := range map[string]string{"completed": "settled", "failed": "failed", "pending": "processing"} {
		var body map[string]any
		srv := execServer(t, status, &body, false)
		live := NewVertoFXLive(vertofx.New("id", "key", false).WithBaseURL(srv.URL), "", false)
		q := &orch.Quote{Source: orch.NewMoney(100000, "USD"), Destination: orch.NewMoney(1, "NGN")}
		res, err := live.ExecuteConversion(context.Background(), q, "k")
		srv.Close()
		if err != nil || res.Status != want {
			t.Fatalf("%s: res=%+v err=%v want %s", status, res, err, want)
		}
	}
}

func TestVertoFXLive_Execute_EmptyIdempotencyKey(t *testing.T) {
	var body map[string]any
	srv := execServer(t, "pending", &body, false)
	defer srv.Close()
	live := NewVertoFXLive(vertofx.New("id", "key", false).WithBaseURL(srv.URL), "", false)
	q := &orch.Quote{Source: orch.NewMoney(100000, "USD"), Destination: orch.NewMoney(1, "NGN")}
	if _, err := live.ExecuteConversion(context.Background(), q, ""); err == nil {
		t.Fatal("expected error for empty idempotency key")
	}
	if body != nil {
		t.Fatal("no trade may be booked without an idempotency key")
	}
}

func TestVertoFXLive_FractionalAmount_SentinelAndQuoteAgree(t *testing.T) {
	var body map[string]any
	srv := execServer(t, "pending", &body, false)
	defer srv.Close()
	live := NewVertoFXLive(vertofx.New("id", "key", false).WithBaseURL(srv.URL), "", false)
	q := &orch.Quote{Source: orch.NewMoney(150050, "USD"), Destination: orch.NewMoney(1, "NGN")}
	if _, err := live.ExecuteConversion(context.Background(), q, "k"); !errors.Is(err, ErrFractionalAmountUnsupported) {
		t.Fatalf("err = %v, want ErrFractionalAmountUnsupported", err)
	}
	pq, err := live.Quote(context.Background(), "USD", "NGN", 150050, orch.AmountSource, orch.RailIBAN)
	if err != nil || pq.Viable {
		t.Fatalf("fractional quote must be non-viable: %+v %v", pq, err)
	}
	// Whole-major source remains viable.
	if pq, _ := live.Quote(context.Background(), "USD", "NGN", 150000, orch.AmountSource, orch.RailIBAN); !pq.Viable {
		t.Fatal("whole-major quote should be viable")
	}
}

func TestVertoFXLive_CreateCollection_HappyPath(t *testing.T) {
	var body map[string]any
	srv := execServer(t, "pending", &body, false)
	defer srv.Close()
	live := NewVertoFXLive(vertofx.New("id", "key", false).WithBaseURL(srv.URL), "", true)
	res, err := live.CreateCollection(context.Background(), "ngn", "virtual", "cust")
	if err != nil {
		t.Fatal(err)
	}
	if res.ProviderRef != "ref-1" || res.Details["account_number"] != "123" || res.Details["currency"] != "NGN" {
		t.Fatalf("collection = %+v", res)
	}
}

func TestVertoFX_ProdFailsClosed(t *testing.T) {
	ctx := context.Background()
	// Live client errors in prod: no fabricated quote, no invented account.
	var body map[string]any
	srv := execServer(t, "pending", &body, true)
	defer srv.Close()
	prodLive := NewVertoFXLive(vertofx.New("id", "key", true).WithBaseURL(srv.URL), "", true)
	if _, err := prodLive.CreateCollection(ctx, "NGN", "virtual", "c"); err == nil {
		t.Fatal("prod funding failure must return error")
	}
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/users/login" {
			_, _ = w.Write([]byte(`{"data":{"token":"tok","companyId":"co1"}}`))
			return
		}
		http.Error(w, "bad", http.StatusBadRequest)
	}))
	defer down.Close()
	pl := NewVertoFXLive(vertofx.New("id", "key", true).WithBaseURL(down.URL), "", true)
	if q, err := pl.Quote(ctx, "USD", "NGN", 100000, orch.AmountSource, orch.RailIBAN); err != nil || q.Viable {
		t.Fatalf("prod rate failure must be non-viable: %+v %v", q, err)
	}
	// Non-prod keeps the deterministic fallback.
	dl := NewVertoFXLive(vertofx.New("id", "key", false).WithBaseURL(down.URL), "", false)
	if q, _ := dl.Quote(ctx, "USD", "NGN", 100000, orch.AmountSource, orch.RailIBAN); !q.Viable {
		t.Fatal("non-prod fallback quote should be viable")
	}
	// Nil client in prod: nothing fabricated.
	nilProd := NewVertoFXLive(nil, "", true)
	q := &orch.Quote{Source: orch.NewMoney(100000, "USD"), Destination: orch.NewMoney(1, "NGN")}
	if _, err := nilProd.ExecuteConversion(ctx, q, "k"); !errors.Is(err, ErrNoProviderInProd) {
		t.Fatalf("conversion err = %v", err)
	}
	if _, err := nilProd.ExecuteTransfer(ctx, q, orch.Destination{}, "k"); !errors.Is(err, ErrNoProviderInProd) {
		t.Fatalf("transfer err = %v", err)
	}
	if _, err := nilProd.CreateCollection(ctx, "NGN", "virtual", "c"); !errors.Is(err, ErrNoProviderInProd) {
		t.Fatalf("collection err = %v", err)
	}
	if pq, _ := nilProd.Quote(ctx, "USD", "NGN", 100000, orch.AmountSource, orch.RailIBAN); pq.Viable {
		t.Fatal("prod deterministic quote must be non-viable")
	}
	// Non-prod nil client keeps deterministic execution.
	if r, err := NewVertoFXLive(nil, "", false).ExecuteConversion(ctx, q, "k"); err != nil || r.Status != "settled" {
		t.Fatalf("non-prod deterministic: %+v %v", r, err)
	}
}

// Uses the REAL adapters so a currency/corridor mismatch in the collection
// default (bare "USD" vs "USD-USD") would route to maplerad and fail here.
func TestCollectionDefault_RealVertoFX(t *testing.T) {
	mk := func(def string) *orch.Service {
		return orch.NewService([]orch.Provider{NewMapleradFX(false), NewEversend(false), NewVertoFX(false)},
			orch.NewMemStore(), orch.Options{}, orch.WithDefaultProvider(def))
	}
	ctx := context.Background()
	for _, tc := range []struct{ def, typ, cur, want string }{
		{"vertofx", "virtual", "USD", "vertofx"},
		{"vertofx", "iban", "EUR", "vertofx"},
		{"vertofx", "virtual", "GBP", "vertofx"},
		{"", "virtual", "USD", "maplerad"},
		{"", "iban", "EUR", "eversend"},
	} {
		va, e := mk(tc.def).CreateCollection(ctx, "c1", orch.CollectionRequest{Currency: tc.cur, Type: tc.typ})
		if e != nil {
			t.Fatalf("%+v: %v", tc, e)
		}
		if va.Provider != tc.want {
			t.Errorf("def=%q %s/%s: provider=%s want %s", tc.def, tc.typ, tc.cur, va.Provider, tc.want)
		}
	}
}
