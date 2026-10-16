package adapters

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
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
	if q.ProviderFee.AmountMinor != 200 || q.ProviderFee.Currency != "USD" { // 20 bps of 100000, ceil
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
