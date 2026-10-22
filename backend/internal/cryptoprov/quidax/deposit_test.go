package quidax

import (
	"context"
	"errors"
	"testing"

	"spotlight/backend/internal/cryptoprov"
)

func TestGetDepositMapsStatusAndKeepsExactAmounts(t *testing.T) {
	for raw, want := range map[string]cryptoprov.DepositStatus{
		"accepted": cryptoprov.DepositAccepted, "ACCEPTED": cryptoprov.DepositAccepted,
		"submitted": cryptoprov.DepositPending, "": cryptoprov.DepositPending,
		"rejected": cryptoprov.DepositRejected, "failed_aml": cryptoprov.DepositRejected,
	} {
		srv, calls, _ := server(t, jsonReply(200, `{"data":{"id":"dp_9","currency":"usdt","amount":"25.000001","fee":"0","txid":"0xabc","status":"`+raw+`",
			"payment_transaction":{"confirmations":3,"required_confirmations":12},
			"payment_address":{"address":"TXyz","network":"trc20"},"user":{"id":"acct1"}}}`))
		d, err := newClient(t, srv.URL, nil).GetDeposit(context.Background(), "acct1", "dp_9")
		if err != nil {
			t.Fatalf("%q: %v", raw, err)
		}
		if d.Status != want || d.ID != "dp_9" || d.Currency != "USDT" || !d.Amount.Equal(dec("25.000001")) || d.TxID != "0xabc" {
			t.Fatalf("%q: deposit = %+v", raw, d)
		}
		if d.Confirmations != 3 || d.RequiredConfirmations != 12 || d.Network != "trc20" || d.Address != "TXyz" || d.AccountID != "acct1" {
			t.Fatalf("%q: details = %+v", raw, d)
		}
		if c := (*calls)[0]; c.method != "GET" || c.path != "/users/acct1/deposits/dp_9" {
			t.Fatalf("request = %s %s", c.method, c.path)
		}
	}
}

func TestGetDepositRefusesUnreadableOrNonPositive(t *testing.T) {
	for _, body := range []string{`{"data":{}}`, `{"data":{"id":"d","currency":"usdt","amount":"0","status":"accepted"}}`, `{"data":{"id":"d","currency":"usdt","amount":"x","status":"accepted"}}`, `{"data":{"id":"d","amount":"1","status":"accepted"}}`} {
		srv, _, _ := server(t, jsonReply(200, body))
		if _, err := newClient(t, srv.URL, nil).GetDeposit(context.Background(), "a", "d"); err == nil {
			t.Fatalf("accepted %s", body)
		}
	}
	if _, err := newClient(t, "https://x.invalid", nil).GetDeposit(context.Background(), "", "d"); err == nil {
		t.Fatal("no account id")
	}
}

func TestDepositAddressReadsTheCurrentAddress(t *testing.T) {
	srv, calls, _ := server(t, jsonReply(200, `{"data":{"address":"TXyz","destination_tag":"","currency":"usdt","network":"trc20"}}`))
	a, err := newClient(t, srv.URL, nil).DepositAddress(context.Background(), "acct1", "USDT", "trc20")
	if err != nil || a.Address != "TXyz" || a.Network != "trc20" {
		t.Fatalf("address = %+v, %v", a, err)
	}
	if c := (*calls)[0]; c.method != "GET" || c.path != "/users/acct1/wallets/usdt/address" || c.query != "network=trc20" {
		t.Fatalf("request = %s %s?%s", c.method, c.path, c.query)
	}
}

func TestAnAddressStillBeingGeneratedIsPendingNotAnError(t *testing.T) {
	srv, _, _ := server(t, jsonReply(200, `{"data":{"address":null,"currency":"usdt"}}`))
	if _, err := newClient(t, srv.URL, nil).DepositAddress(context.Background(), "a", "usdt", ""); !errors.Is(err, cryptoprov.ErrAddressPending) {
		t.Fatalf("err = %v, want ErrAddressPending", err)
	}
	srv2, _, _ := server(t, jsonReply(200, `{"data":{"address":null}}`))
	if _, err := newClient(t, srv2.URL, nil).CreateDepositAddress(context.Background(), "a", "usdt", ""); !errors.Is(err, cryptoprov.ErrAddressPending) {
		t.Fatalf("create err = %v, want ErrAddressPending", err)
	}
}

func TestParseWebhookCarriesTheAccountForDeposits(t *testing.T) {
	ev, err := newClient(t, "https://x.invalid", nil).ParseWebhook([]byte(`{"event":"deposit.successful","data":{"id":"dp_9","user":{"id":"acct1"}}}`))
	if err != nil || ev.Account != "acct1" || ev.Ref != "dp_9" || ev.Type != "deposit.successful" {
		t.Fatalf("event = %+v, %v", ev, err)
	}
}

func TestDepositEventKeysDistinguishProgressButDedupeRedeliveries(t *testing.T) {
	c := newClient(t, "https://x.invalid", nil)
	key := func(body string) string {
		ev, err := c.ParseWebhook([]byte(body))
		if err != nil {
			t.Fatal(err)
		}
		return ev.Key
	}
	conf1 := `{"event":"deposit.transaction.confirmation","data":{"id":"dp_9","status":"submitted","payment_transaction":{"confirmations":1},"user":{"id":"a"}}}`
	conf2 := `{"event":"deposit.transaction.confirmation","data":{"id":"dp_9","status":"submitted","payment_transaction":{"confirmations":2},"user":{"id":"a"}}}`
	if key(conf1) == key(conf2) {
		t.Fatal("a later confirmation was keyed as a duplicate of an earlier one")
	}
	if key(conf1) != key(conf1) {
		t.Fatal("an exact redelivery must dedupe")
	}
	swap := `{"event":"swap_transaction.completed","data":{"id":"sw_1","status":"completed"}}`
	if key(swap) != "quidax:swap_transaction.completed:sw_1" {
		t.Fatalf("swap keys must not change: %s", key(swap))
	}
}
