package cryptosvc

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

func TestBalancesWithoutAProviderAccountAreEmptyAndCreateNothing(t *testing.T) {
	r := newSvcRig(t)
	got, err := r.svc.Balances(context.Background(), user)
	if err != nil || len(got) != 0 {
		t.Fatalf("balances = %v, %v; want empty", got, err)
	}
	if r.prov.AccountsCreated() != 0 {
		t.Fatal("a balance READ created a provider account")
	}
}

func TestBalancesListCryptoHoldingsOnly(t *testing.T) {
	r := newSvcRig(t)
	q := r.sellQuoteOrBuy(t)
	acct, _, _ := r.store.ProviderAccount(context.Background(), user, "mock")
	if acct == "" {
		t.Fatalf("no account after quote %s", q.ID)
	}
	r.prov.SetWallets(acct,
		cryptoprov.Wallet{Currency: "USDT", Balance: decimal.RequireFromString("12.5"), Locked: decimal.RequireFromString("0.5")},
		cryptoprov.Wallet{Currency: "NGN", Balance: decimal.NewFromInt(900)}, // NGN lives in the platform wallet, not here
		cryptoprov.Wallet{Currency: "BTC", Balance: decimal.Zero},            // empty wallets are noise
	)
	got, err := r.svc.Balances(context.Background(), user)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Currency != "USDT" || !got[0].Balance.Equal(decimal.RequireFromString("12.5")) {
		t.Fatalf("balances = %+v", got)
	}
}

func TestBalancesProviderErrorSurfaces(t *testing.T) {
	r := newSvcRig(t)
	r.sellQuoteOrBuy(t)
	r.prov.FailNext("wallets", errors.New("boom"))
	if _, err := r.svc.Balances(context.Background(), user); err == nil {
		t.Fatal("a provider failure must not read as an empty portfolio")
	}
}

func (r *svcRig) sellQuoteOrBuy(t *testing.T) SwapRecord {
	t.Helper()
	q, err := r.svc.Quote(context.Background(), QuoteRequest{UserID: user, IdempotencyKey: "acct-maker", Asset: "USDT", NGNKobo: 1_000_000})
	if err != nil {
		t.Fatal(err)
	}
	return q
}

func TestBalancesAndConfigRoutes(t *testing.T) {
	h := newHTTPRig(t, user)
	w := h.do("GET", "/api/v1/crypto/swaps/balances", nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("balances: %d %s", w.Code, w.Body.String())
	}
	if b, ok := decode(t, w)["balances"].([]any); !ok || len(b) != 0 {
		t.Fatalf("balances body = %s", w.Body.String())
	}

	h.sellQuoteOrBuy(t)
	acct, _, _ := h.store.ProviderAccount(context.Background(), user, "mock")
	h.prov.SetWallets(acct, cryptoprov.Wallet{Currency: "USDT", Balance: decimal.RequireFromString("3.25"), Locked: decimal.RequireFromString("1")})
	w = h.do("GET", "/api/v1/crypto/swaps/balances", nil, nil)
	row := decode(t, w)["balances"].([]any)[0].(map[string]any)
	// Crypto amounts are decimal STRINGS. The provider's balance is what is spendable;
	// locked (open withdrawals) is on top of it.
	if row["asset"] != "USDT" || row["available"] != "3.25" || row["locked"] != "1" || row["total"] != "4.25" {
		t.Fatalf("row = %v", row)
	}

	w = h.do("GET", "/api/v1/crypto/swaps/config", nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("config: %d %s", w.Code, w.Body.String())
	}
	cfg := decode(t, w)["config"].(map[string]any)
	if cfg["rail"] != "provider" || cfg["sides"] == nil || cfg["max_quote_kobo"] != float64(MaxQuoteKobo) {
		t.Fatalf("config = %v", cfg)
	}

	anon := newHTTPRig(t, "")
	for _, p := range []string{"/api/v1/crypto/swaps/balances", "/api/v1/crypto/swaps/config"} {
		if w := anon.do("GET", p, nil, nil); w.Code != http.StatusUnauthorized {
			t.Errorf("%s anonymous -> %d", p, w.Code)
		}
	}
}
