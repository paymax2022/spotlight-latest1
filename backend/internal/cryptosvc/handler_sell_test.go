package cryptosvc

import (
	"net/http"
	"testing"

	"github.com/shopspring/decimal"
)

func (h *httpRig) sellHTTP(t *testing.T, key, amount string) map[string]any {
	t.Helper()
	w := h.do("POST", "/api/v1/crypto/swaps/quote", map[string]any{"side": "sell", "asset": "USDT", "amount": amount}, map[string]string{"Idempotency-Key": key})
	if w.Code != http.StatusCreated {
		t.Fatalf("sell quote: %d %s", w.Code, w.Body.String())
	}
	return decode(t, w)["swap"].(map[string]any)
}

func TestSellQuoteViewNamesTheAssetSoldAndTheNetPayout(t *testing.T) {
	h := newHTTPRig(t, user)
	h.prov.SetPrice("USDTNGN", decimal.RequireFromString("1500"))
	sw := h.sellHTTP(t, "s1", "10")
	if sw["side"] != "sell" || sw["asset"] != "USDT" || sw["amount"] != "10" {
		t.Fatalf("swap = %v", sw)
	}
	ngn, fee := int64(sw["ngn_kobo"].(float64)), int64(sw["fee_kobo"].(float64))
	if ngn != 1_500_000 || fee <= 0 {
		t.Fatalf("ngn=%d fee=%d", ngn, fee)
	}
	// total_kobo is what moves through the wallet: a sell CREDITS gross minus fee.
	if int64(sw["total_kobo"].(float64)) != ngn-fee {
		t.Fatalf("total_kobo = %v, want %d", sw["total_kobo"], ngn-fee)
	}
}

func TestSellQuoteBodyValidation(t *testing.T) {
	h := newHTTPRig(t, user)
	for name, body := range map[string]any{
		"no amount":       map[string]any{"side": "sell", "asset": "USDT"},
		"zero":            map[string]any{"side": "sell", "asset": "USDT", "amount": "0"},
		"negative":        map[string]any{"side": "sell", "asset": "USDT", "amount": "-1"},
		"numeric amount":  `{"side":"sell","asset":"USDT","amount":1.5}`,
		"garbage":         map[string]any{"side": "sell", "asset": "USDT", "amount": "1e400x"},
		"exponent":        map[string]any{"side": "sell", "asset": "USDT", "amount": "1e3"},
		"too many places": map[string]any{"side": "sell", "asset": "USDT", "amount": "0.0000000000000000001"},
		"sell with kobo":  map[string]any{"side": "sell", "asset": "USDT", "amount": "1", "ngn_kobo": 100},
		"buy with amount": map[string]any{"side": "buy", "asset": "USDT", "ngn_kobo": 100, "amount": "1"},
		"unknown side":    map[string]any{"side": "short", "asset": "USDT", "amount": "1"},
	} {
		if w := h.do("POST", "/api/v1/crypto/swaps/quote", body, map[string]string{"Idempotency-Key": "k"}); w.Code != http.StatusBadRequest {
			t.Errorf("%s -> %d %s", name, w.Code, w.Body.String())
		}
	}
	if h.prov.AccountsCreated() != 0 {
		t.Fatal("invalid requests reached the provider")
	}
}

func TestExplicitBuySideStillWorks(t *testing.T) {
	h := newHTTPRig(t, user)
	w := h.do("POST", "/api/v1/crypto/swaps/quote", map[string]any{"side": "buy", "asset": "USDT", "ngn_kobo": 1_000_000}, map[string]string{"Idempotency-Key": "b1"})
	if w.Code != http.StatusCreated {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	if sw := decode(t, w)["swap"].(map[string]any); sw["side"] != "buy" || sw["total_kobo"] != float64(1_007_500) {
		t.Fatalf("swap = %v", sw)
	}
}
