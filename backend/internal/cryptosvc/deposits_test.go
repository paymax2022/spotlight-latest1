package cryptosvc

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

// Deposits on the provider rail: the provider credits the user's own sub-account, so the
// platform posts NO ledger legs. It records each deposit, from a re-query of the provider
// (never the webhook payload), for history and notification.

func depositRig(t *testing.T) (*svcRig, string) {
	t.Helper()
	r := newSvcRig(t)
	ds := newMemDeposits(r.store)
	r.svc.cfg.Deposits = ds
	r.svc.cfg.Ingest.WithDeposits(ds)
	acct, err := r.svc.ensureAccount(context.Background(), r.prov, user)
	if err != nil {
		t.Fatal(err)
	}
	return r, acct
}

func TestDepositAddressIsProvisionedOnceAndCached(t *testing.T) {
	r, _ := depositRig(t)
	a, err := r.svc.DepositAddress(context.Background(), user, "usdt", "trc20")
	if err != nil || a.Address == "" || a.Currency != "USDT" || a.Network != "trc20" {
		t.Fatalf("address = %+v, %v", a, err)
	}
	r.prov.FailNext("depositaddress", errors.New("provider down")) // a second call must not need the provider
	b, err := r.svc.DepositAddress(context.Background(), user, "USDT", "trc20")
	if err != nil || b.Address != a.Address {
		t.Fatalf("cached address = %+v, %v", b, err)
	}
}

func TestDepositAddressStillGeneratingIsPending(t *testing.T) {
	r, _ := depositRig(t)
	r.prov.SetAddressPending(true)
	if _, err := r.svc.DepositAddress(context.Background(), user, "USDT", "trc20"); !errors.Is(err, cryptoprov.ErrAddressPending) {
		t.Fatalf("err = %v, want ErrAddressPending", err)
	}
	r.prov.SetAddressPending(false)
	if a, err := r.svc.DepositAddress(context.Background(), user, "USDT", "trc20"); err != nil || a.Address == "" {
		t.Fatalf("after generation: %+v, %v", a, err)
	}
}

func TestDepositAddressValidatesInput(t *testing.T) {
	r, _ := depositRig(t)
	for _, asset := range []string{"", "NGN", "US DT", "a-very-long-asset-code"} {
		if _, err := r.svc.DepositAddress(context.Background(), user, asset, ""); err == nil {
			t.Errorf("asset %q accepted", asset)
		}
	}
	if _, err := r.svc.DepositAddress(context.Background(), user, "USDT", "bad network!"); err == nil {
		t.Error("network with spaces accepted")
	}
}

func deposit(acct, id string, st cryptoprov.DepositStatus) cryptoprov.Deposit {
	return cryptoprov.Deposit{ID: id, AccountID: acct, Currency: "USDT", Network: "trc20", Address: "TX1",
		Amount: decimal.RequireFromString("25.5"), TxID: "0xabc", Status: st, Confirmations: 1, RequiredConfirmations: 12}
}

func TestDepositWebhookIsRecordedFromTheProviderNotThePayloadAndMovesNoMoney(t *testing.T) {
	r, acct := depositRig(t)
	r.prov.PutDeposit(deposit(acct, "dp1", cryptoprov.DepositAccepted))
	ev := cryptoprov.Event{Key: "mock:deposit.successful:dp1", Type: "deposit.successful", Ref: "dp1", Account: acct,
		Raw: []byte(`{"amount":"999999","status":"accepted"}`)} // a lying payload
	out, err := r.svc.cfg.Ingest.process(context.Background(), r.prov, "mock", ev)
	if err != nil || out != OutcomeApplied {
		t.Fatalf("process = %s, %v", out, err)
	}
	got, err := r.svc.Deposits(context.Background(), user, 10)
	if err != nil || len(got) != 1 {
		t.Fatalf("deposits = %+v, %v", got, err)
	}
	if !got[0].Amount.Equal(decimal.RequireFromString("25.5")) || got[0].Status != cryptoprov.DepositAccepted || got[0].UserID != user {
		t.Fatalf("recorded = %+v (must come from the provider re-query)", got[0])
	}
	if r.led.total() != 0 || len(r.led.posted) != 0 {
		t.Fatal("a provider-custody deposit must post no ledger legs")
	}
}

func TestDepositStatusNeverRegresses(t *testing.T) {
	r, acct := depositRig(t)
	ctx := context.Background()
	run := func(st cryptoprov.DepositStatus) {
		r.prov.PutDeposit(deposit(acct, "dp1", st))
		if _, err := r.svc.cfg.Ingest.process(ctx, r.prov, "mock", cryptoprov.Event{Type: "deposit.transaction.confirmation", Ref: "dp1", Account: acct}); err != nil {
			t.Fatal(err)
		}
	}
	run(cryptoprov.DepositPending)
	run(cryptoprov.DepositAccepted)
	run(cryptoprov.DepositPending) // a late, out-of-order confirmation event
	got, _ := r.svc.Deposits(ctx, user, 10)
	if len(got) != 1 || got[0].Status != cryptoprov.DepositAccepted {
		t.Fatalf("deposits = %+v, want one accepted", got)
	}
}

func TestDepositForAnUnknownAccountIsIgnoredNotRetriedForever(t *testing.T) {
	r, _ := depositRig(t)
	r.prov.PutDeposit(deposit("stranger", "dp9", cryptoprov.DepositAccepted))
	out, err := r.svc.cfg.Ingest.process(context.Background(), r.prov, "mock", cryptoprov.Event{Type: "deposit.successful", Ref: "dp9", Account: "stranger"})
	if err != nil || out != OutcomeIgnored {
		t.Fatalf("process = %s, %v", out, err)
	}
}

func TestDepositReQueryFailureIsRetried(t *testing.T) {
	r, acct := depositRig(t)
	r.prov.FailNext("getdeposit", &cryptoprov.APIError{Provider: "mock", Status: 503})
	if _, err := r.svc.cfg.Ingest.process(context.Background(), r.prov, "mock", cryptoprov.Event{Type: "deposit.successful", Ref: "dp1", Account: acct}); err == nil {
		t.Fatal("a failed re-query must error so the provider redelivers")
	}
}

func TestDepositEventWithoutAnAccountIsIgnored(t *testing.T) {
	r, _ := depositRig(t)
	out, err := r.svc.cfg.Ingest.process(context.Background(), r.prov, "mock", cryptoprov.Event{Type: "deposit.successful", Ref: "dp1"})
	if err != nil || out != OutcomeIgnored {
		t.Fatalf("process = %s, %v", out, err)
	}
}

func TestDepositRoutes(t *testing.T) {
	h := newHTTPRigWith(t, user, nil)
	ds := newMemDeposits(h.store)
	h.svc.cfg.Deposits = ds
	h.svc.cfg.Ingest.WithDeposits(ds)

	w := h.do("GET", "/api/v1/crypto/swaps/deposit-address?asset=USDT&network=trc20", nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("address: %d %s", w.Code, w.Body.String())
	}
	addr := decode(t, w)["deposit_address"].(map[string]any)
	if addr["asset"] != "USDT" || addr["network"] != "trc20" || addr["address"] == "" {
		t.Fatalf("address = %v", addr)
	}

	h.prov.SetAddressPending(true)
	w = h.do("GET", "/api/v1/crypto/swaps/deposit-address?asset=BTC", nil, nil)
	if w.Code != http.StatusAccepted || decode(t, w)["error"] != "address_pending" {
		t.Fatalf("pending: %d %s", w.Code, w.Body.String())
	}
	if w := h.do("GET", "/api/v1/crypto/swaps/deposit-address?asset=", nil, nil); w.Code != http.StatusBadRequest {
		t.Fatalf("no asset -> %d", w.Code)
	}

	w = h.do("GET", "/api/v1/crypto/swaps/deposits", nil, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("deposits: %d %s", w.Code, w.Body.String())
	}
	if d, ok := decode(t, w)["deposits"].([]any); !ok || len(d) != 0 {
		t.Fatalf("deposits = %s", w.Body.String())
	}
	anon := newHTTPRig(t, "")
	for _, p := range []string{"/api/v1/crypto/swaps/deposit-address?asset=USDT", "/api/v1/crypto/swaps/deposits"} {
		if w := anon.do("GET", p, nil, nil); w.Code != http.StatusUnauthorized {
			t.Errorf("%s anonymous -> %d", p, w.Code)
		}
	}
}
