package vertofx

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// newServer returns a fake Verto API; logins counts POST /users/login hits.
func newServer(t *testing.T, logins *int32, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/users/login", func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(logins, 1)
		var in map[string]string
		_ = json.NewDecoder(r.Body).Decode(&in)
		if in["clientId"] != "cid" || in["apiKey"] != "key" {
			http.Error(w, "bad creds", http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"data":{"token":"tok-1","companyId":"co-1"}}`))
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok-1" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		handler(w, r)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestClient_GetFXRate_ParsesRateAndToken(t *testing.T) {
	var logins int32
	srv := newServer(t, &logins, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/fx/rate" {
			t.Errorf("path = %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"data":{"rate":"1520.5","vfxToken":"vfx-abc"}}`))
	})
	c := New("cid", "key", false).WithBaseURL(srv.URL)
	before := time.Now()
	r, err := c.GetFXRate(context.Background(), "USD", "NGN", 100)
	if err != nil {
		t.Fatal(err)
	}
	if r.RatePPM != 1_520_500_000 {
		t.Errorf("RatePPM = %d", r.RatePPM)
	}
	if r.VfxToken != "vfx-abc" {
		t.Errorf("VfxToken = %q", r.VfxToken)
	}
	d := r.ExpiresAt.Sub(before)
	if d < 25*time.Second || d > 35*time.Second {
		t.Errorf("expiry %v not ~30s", d)
	}
}

func TestClient_ReLoginAfterTokenExpiry(t *testing.T) {
	var logins int32
	srv := newServer(t, &logins, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"data":{"rate":"2","vfxToken":"t"}}`))
	})
	c := New("cid", "key", false).WithBaseURL(srv.URL)
	if _, err := c.GetFXRate(context.Background(), "USD", "NGN", 1); err != nil {
		t.Fatal(err)
	}
	if _, err := c.GetFXRate(context.Background(), "USD", "NGN", 1); err != nil {
		t.Fatal(err)
	}
	if n := atomic.LoadInt32(&logins); n != 1 {
		t.Fatalf("logins = %d, want 1 (cached)", n)
	}
	c.mu.Lock()
	c.tokenExp = time.Now().Add(-time.Minute)
	c.mu.Unlock()
	if _, err := c.GetFXRate(context.Background(), "USD", "NGN", 1); err != nil {
		t.Fatal(err)
	}
	if n := atomic.LoadInt32(&logins); n != 2 {
		t.Fatalf("logins = %d, want 2", n)
	}
}

func TestClient_CreateFXTrade_SendsPaymentIDAndMarkup(t *testing.T) {
	var logins int32
	var got map[string]any
	srv := newServer(t, &logins, func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &got)
		_, _ = w.Write([]byte(`{"data":{"id":"tr-1","status":"pending","paymentId":"pay-1"}}`))
	})
	c := New("cid", "key", false).WithBaseURL(srv.URL)
	tr, err := c.CreateFXTrade(context.Background(), TradeInput{
		PaymentID: "pay-1", PaymentType: "convertWalletPayout", SourceWalletID: "w1",
		SourceAmount: 100, VfxToken: "vfx-abc", TargetAccountID: "acc-1",
		FXMarkup: FXMarkup{MarkupType: "percentage", MarkupPerc: 150},
	})
	if err != nil {
		t.Fatal(err)
	}
	if tr.ID != "tr-1" || tr.Status != "pending" {
		t.Errorf("trade = %+v", tr)
	}
	if got["paymentId"] != "pay-1" {
		t.Errorf("paymentId = %v", got["paymentId"])
	}
	mk, ok := got["fxMarkup"].(map[string]any)
	if !ok || mk["markupType"] != "percentage" || mk["markupPerc"] != float64(150) {
		t.Errorf("fxMarkup = %v", got["fxMarkup"])
	}
	if got["vfxToken"] != "vfx-abc" {
		t.Errorf("vfxToken = %v", got["vfxToken"])
	}
}

func TestClient_VerifyWebhookSignature_HMACSHA256(t *testing.T) {
	body := []byte(`{"event":"payment.completed"}`)
	m := hmac.New(sha256.New, []byte("whsec"))
	m.Write(body)
	sig := hex.EncodeToString(m.Sum(nil))

	c := New("cid", "key", false).WithWebhookSecret("whsec")
	if !c.VerifyWebhookSignature(body, sig) {
		t.Error("valid signature rejected")
	}
	if c.VerifyWebhookSignature([]byte(`{"event":"tampered"}`), sig) {
		t.Error("tampered body accepted")
	}
	if New("cid", "key", false).VerifyWebhookSignature(body, sig) {
		t.Error("empty secret must fail closed")
	}
}

func TestClient_OfflineMockWhenNoKey(t *testing.T) {
	hit := int32(0)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hit, 1)
	}))
	defer srv.Close()
	c := New("", "", false).WithBaseURL(srv.URL)
	ctx := context.Background()

	r1, err := c.GetFXRate(ctx, "USD", "NGN", 100)
	if err != nil || r1.RatePPM <= 0 || r1.VfxToken == "" {
		t.Fatalf("rate = %+v err=%v", r1, err)
	}
	r2, _ := c.GetFXRate(ctx, "USD", "NGN", 100)
	if r1.RatePPM != r2.RatePPM || r1.VfxToken != r2.VfxToken {
		t.Error("mock rate not deterministic")
	}
	tr, err := c.CreateFXTrade(ctx, TradeInput{PaymentID: "p1"})
	if err != nil || tr.ID == "" {
		t.Fatalf("trade = %+v err=%v", tr, err)
	}
	f, err := c.CreateFundingDetails(ctx, "co", "USD")
	if err != nil || f.AccountNumber == "" {
		t.Fatalf("funding = %+v err=%v", f, err)
	}
	if hit != 0 {
		t.Errorf("offline mode made %d HTTP calls", hit)
	}
}
