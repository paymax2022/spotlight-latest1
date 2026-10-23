package quidax

import (
	"context"
	"testing"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

func TestGetDepositRequeriesByAccount(t *testing.T) {
	srv, calls, _ := server(t, jsonReply(200, `{"status":"success","data":{"id":"dep9","currency":"usdt","amount":"12.345678","status":"successful","confirmations":6,"txid":"0xdead"}}`))
	d, err := newClient(t, srv.URL, nil).GetDeposit(context.Background(), "acct1", "dep9")
	if err != nil {
		t.Fatal(err)
	}
	c := (*calls)[0]
	if c.method != "GET" || c.path != "/users/acct1/deposits/dep9" {
		t.Fatalf("request = %+v", c)
	}
	if d.ID != "dep9" || d.Currency != "USDT" || d.AccountID != "acct1" {
		t.Fatalf("deposit = %+v", d)
	}
	if !d.Amount.Equal(decimal.RequireFromString("12.345678")) {
		t.Fatalf("amount lost precision: %s", d.Amount)
	}
	if d.Status != cryptoprov.DepositConfirmed || d.Confirmations != 6 {
		t.Fatalf("status=%s confs=%d", d.Status, d.Confirmations)
	}
	if d.TxHash != "0xdead" {
		t.Fatalf("txhash = %q", d.TxHash)
	}
}

func TestGetDepositUnknownStatusStaysPending(t *testing.T) {
	srv, _, _ := server(t, jsonReply(200, `{"data":{"id":"d1","currency":"btc","amount":"0.1","status":"processing"}}`))
	d, err := newClient(t, srv.URL, nil).GetDeposit(context.Background(), "a", "d1")
	if err != nil {
		t.Fatal(err)
	}
	// Only an explicitly successful status is final; anything else can never trigger a credit.
	if d.Status != cryptoprov.DepositPending {
		t.Fatalf("status = %s, want pending", d.Status)
	}
	if d.Confirmations != 0 {
		t.Fatalf("confirmations = %d, want 0 when absent", d.Confirmations)
	}
}

func TestGetDepositFailedStatusMaps(t *testing.T) {
	srv, _, _ := server(t, jsonReply(200, `{"data":{"id":"d1","amount":"1","status":"rejected"}}`))
	d, _ := newClient(t, srv.URL, nil).GetDeposit(context.Background(), "a", "d1")
	if d.Status != cryptoprov.DepositFailed {
		t.Fatalf("status = %s, want failed", d.Status)
	}
}

func TestGetDepositRequiresAccountAndID(t *testing.T) {
	c, _ := New(Config{SecretKey: "k", RateBudgetPerMinute: -1})
	if _, err := c.GetDeposit(context.Background(), "", "d"); err == nil {
		t.Fatal("empty account accepted")
	}
	if _, err := c.GetDeposit(context.Background(), "a", ""); err == nil {
		t.Fatal("empty deposit id accepted")
	}
}

func TestListDepositsParsesArrayAndWraps(t *testing.T) {
	srv, _, _ := server(t, jsonReply(200, `{"data":[{"id":"d1","currency":"btc","amount":"1","status":"successful"},{"id":"d2","currency":"eth","amount":"2","status":"pending"}]}`))
	ds, err := newClient(t, srv.URL, nil).ListDeposits(context.Background(), "acct1")
	if err != nil {
		t.Fatal(err)
	}
	if len(ds) != 2 || ds[0].Currency != "BTC" || ds[1].Status != cryptoprov.DepositPending {
		t.Fatalf("deposits = %+v", ds)
	}
	for _, d := range ds {
		if d.AccountID != "acct1" {
			t.Fatalf("listed deposit %s not scoped to the account", d.ID)
		}
	}
}

func TestParseWebhookCarriesAccountForDepositEvents(t *testing.T) {
	c, _ := New(Config{SecretKey: "k"})
	// A deposit event carries the sub-account that located the transfer.
	d, err := c.ParseWebhook([]byte(`{"event":"deposit.successful","data":{"id":"dep9","user_id":"acct-77","amount":"999"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if d.Account != "acct-77" || d.Ref != "dep9" {
		t.Fatalf("event = %+v", d)
	}
	// A swap event with no user_id leaves Account empty (routing ignores it there).
	s, _ := c.ParseWebhook([]byte(`{"event":"swap_transaction.completed","data":{"id":"sw_1"}}`))
	if s.Account != "" {
		t.Fatalf("swap event carried an account: %+v", s)
	}
}
