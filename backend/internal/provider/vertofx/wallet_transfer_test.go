package vertofx

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

func TestClient_WalletToWallet_PostsModeledBody(t *testing.T) {
	var logins int32
	srv := newServer(t, &logins, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/wallets/transfer" {
			t.Errorf("got %s %s", r.Method, r.URL.Path)
		}
		var in map[string]any
		_ = json.NewDecoder(r.Body).Decode(&in)
		if in["paymentId"] != "pay-1" || in["sourceWalletId"] != "w-sub" || in["targetWalletId"] != "w-master" ||
			in["currency"] != "NGN" || in["amountMinor"] != float64(5000) {
			t.Errorf("body = %v", in)
		}
		_, _ = w.Write([]byte(`{"data":{"id":"tr-1","status":"completed","paymentId":"pay-1"}}`))
	})
	c := New("cid", "key", false).WithBaseURL(srv.URL)
	tr, err := c.WalletToWallet(context.Background(), "w-sub", "w-master", "NGN", 5000, "pay-1")
	if err != nil {
		t.Fatal(err)
	}
	if tr.ID != "tr-1" || tr.PaymentID != "pay-1" {
		t.Errorf("tr = %+v", tr)
	}
}

func TestClient_WalletToWallet_RejectsBadInputAndBadResponse(t *testing.T) {
	var logins int32
	srv := newServer(t, &logins, func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{"data":{}}`)) })
	c := New("cid", "key", false).WithBaseURL(srv.URL)
	ctx := context.Background()
	for name, f := range map[string]func() error{
		"zero amount":  func() error { _, e := c.WalletToWallet(ctx, "a", "b", "NGN", 0, "p"); return e },
		"negative":     func() error { _, e := c.WalletToWallet(ctx, "a", "b", "NGN", -1, "p"); return e },
		"same wallet":  func() error { _, e := c.WalletToWallet(ctx, "a", "a", "NGN", 1, "p"); return e },
		"no paymentID": func() error { _, e := c.WalletToWallet(ctx, "a", "b", "NGN", 1, ""); return e },
		"no currency":  func() error { _, e := c.WalletToWallet(ctx, "a", "b", "", 1, "p"); return e },
		"empty resp":   func() error { _, e := c.WalletToWallet(ctx, "a", "b", "NGN", 1, "p"); return e },
	} {
		if f() == nil {
			t.Errorf("%s: want error", name)
		}
	}
}

func TestClient_WalletToWallet_OfflineMockIsDeterministic(t *testing.T) {
	c := New("", "", false)
	a, err := c.WalletToWallet(context.Background(), "a", "b", "NGN", 10, "pay-9")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := c.WalletToWallet(context.Background(), "a", "b", "NGN", 10, "pay-9")
	if a != b || a.ID == "" {
		t.Errorf("a=%+v b=%+v", a, b)
	}
}
