package cryptosvc

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

// depProv is a webhook-capable provider that can also be re-queried for deposits, so the
// deposit routing is exercised without a live Quidax sandbox.
type depProv struct {
	name    string
	deposit cryptoprov.Deposit
	err     error
	queries int
}

func (p *depProv) Name() string                      { return p.name }
func (p *depProv) AssetClass() cryptoprov.AssetClass { return cryptoprov.AssetClassCrypto }
func (p *depProv) VerifyWebhook(h map[string]string, _ []byte) error {
	if h["sig"] != "ok" {
		return cryptoprov.ErrBadSignature
	}
	return nil
}

// ParseWebhook reads "<type>|<account>|<id>". The body deliberately carries NO amount or
// status: the settled value must come only from GetDeposit.
func (p *depProv) ParseWebhook(body []byte) (cryptoprov.Event, error) {
	typ, rest, ok := strings.Cut(string(body), "|")
	if !ok {
		return cryptoprov.Event{}, errors.New("bad body")
	}
	acct, id, ok := strings.Cut(rest, "|")
	if !ok {
		return cryptoprov.Event{}, errors.New("bad body")
	}
	return cryptoprov.Event{Key: "mock:" + typ + ":" + id, Type: typ, Ref: id, Account: acct, Raw: []byte(`{"id":"` + id + `"}`)}, nil
}

func (p *depProv) GetDeposit(_ context.Context, accountID, id string) (cryptoprov.Deposit, error) {
	p.queries++
	if p.err != nil {
		return cryptoprov.Deposit{}, p.err
	}
	d := p.deposit
	d.ID = id
	d.AccountID = accountID
	return d, nil
}

func (p *depProv) ListDeposits(_ context.Context, _ string) ([]cryptoprov.Deposit, error) {
	return []cryptoprov.Deposit{p.deposit}, nil
}

type fakeDepositSettler struct {
	got       []cryptoprov.Deposit
	providers []string
	outcome   Outcome
	err       error
}

func (f *fakeDepositSettler) SettleDeposit(_ context.Context, provider string, d cryptoprov.Deposit) (Outcome, error) {
	f.got = append(f.got, d)
	f.providers = append(f.providers, provider)
	if f.err != nil {
		return "", f.err
	}
	if f.outcome != "" {
		return f.outcome, nil
	}
	return OutcomeApplied, nil
}

func newDepRig(t *testing.T, wired bool, dp *depProv) (*Ingest, *memStore, *fakeDepositSettler) {
	t.Helper()
	reg := cryptoprov.NewRegistry(dp.name)
	if err := reg.Register(dp); err != nil {
		t.Fatal(err)
	}
	st := newMemStore()
	ing := NewIngest(reg, st)
	fake := &fakeDepositSettler{}
	if wired {
		ing.WithDepositSettler(fake)
	}
	return ing, st, fake
}

func deliverDep(t *testing.T, ing *Ingest, body string) (Outcome, error) {
	t.Helper()
	return ing.Handle(context.Background(), "mockd", map[string]string{"sig": "ok"}, []byte(body))
}

func TestDepositDeliveryRequeriesProviderAndSettles(t *testing.T) {
	dp := &depProv{name: "mockd", deposit: cryptoprov.Deposit{
		Amount: decimal.RequireFromString("0.5"), Status: cryptoprov.DepositConfirmed, Confirmations: 6,
	}}
	ing, st, fake := newDepRig(t, true, dp)
	out, err := deliverDep(t, ing, "deposit.successful|acct-9|dep-1")
	if err != nil || out != OutcomeApplied {
		t.Fatalf("out=%s err=%v", out, err)
	}
	if dp.queries != 1 {
		t.Fatalf("re-queries = %d, want exactly 1", dp.queries)
	}
	if len(fake.got) != 1 {
		t.Fatalf("settler calls = %d", len(fake.got))
	}
	// The settled value is the RE-QUERIED deposit, scoped to the sub-account the event named.
	if !fake.got[0].Amount.Equal(decimal.RequireFromString("0.5")) {
		t.Fatalf("settled amount = %s, want the provider's 0.5", fake.got[0].Amount)
	}
	if fake.got[0].AccountID != "acct-9" || fake.got[0].ID != "dep-1" {
		t.Fatalf("settled deposit not scoped to the event's account/id: %+v", fake.got[0])
	}
	if fake.providers[0] != "mockd" {
		t.Fatalf("provider name = %q", fake.providers[0])
	}
	if len(st.events) != 1 {
		t.Fatal("delivery was not recorded")
	}
}

func TestDepositWithoutSettlerIsRecordedAndIgnored(t *testing.T) {
	dp := &depProv{name: "mockd", deposit: cryptoprov.Deposit{Amount: decimal.NewFromInt(5)}}
	ing, st, fake := newDepRig(t, false, dp)
	out, err := deliverDep(t, ing, "deposit.successful|acct-9|dep-1")
	if err != nil || out != OutcomeIgnored {
		t.Fatalf("out=%s err=%v", out, err)
	}
	if dp.queries != 0 || len(fake.got) != 0 {
		t.Fatal("an unwired deposit engine must not re-query or settle")
	}
	if len(st.events) != 1 {
		t.Fatal("event should still be recorded")
	}
}

func TestDepositSettlerErrorReleasesTheDedupeRow(t *testing.T) {
	dp := &depProv{name: "mockd", deposit: cryptoprov.Deposit{Amount: decimal.NewFromInt(1), Status: cryptoprov.DepositConfirmed}}
	ing, st, fake := newDepRig(t, true, dp)
	fake.err = errors.New("ledger down")
	if _, err := deliverDep(t, ing, "deposit.credit|acct-1|dep-1"); err == nil {
		t.Fatal("settle error swallowed")
	}
	if len(st.events) != 0 {
		t.Fatal("dedupe row kept after a settle failure: the retry would be swallowed")
	}
	// The retry succeeds once the engine recovers.
	fake.err = nil
	if out, err := deliverDep(t, ing, "deposit.credit|acct-1|dep-1"); err != nil || out != OutcomeApplied {
		t.Fatalf("retry out=%s err=%v", out, err)
	}
}

func TestDepositRequeryErrorReleasesTheDedupeRow(t *testing.T) {
	dp := &depProv{name: "mockd", err: &cryptoprov.APIError{Provider: "mockd", Status: 503}}
	ing, st, _ := newDepRig(t, true, dp)
	if _, err := deliverDep(t, ing, "deposit.credit|acct-1|dep-1"); err == nil {
		t.Fatal("re-query failure swallowed")
	}
	if len(st.events) != 0 {
		t.Fatal("dedupe row kept after a re-query failure")
	}
}

func TestDepositReplaysAreDedupedBeforeTheEngine(t *testing.T) {
	dp := &depProv{name: "mockd", deposit: cryptoprov.Deposit{Amount: decimal.NewFromInt(1), Status: cryptoprov.DepositConfirmed}}
	ing, _, fake := newDepRig(t, true, dp)
	if _, err := deliverDep(t, ing, "deposit.credit|acct-1|dep-1"); err != nil {
		t.Fatal(err)
	}
	fake.outcome = OutcomeDuplicate
	out, err := deliverDep(t, ing, "deposit.credit|acct-1|dep-1")
	if err != nil || out != OutcomeDuplicate {
		t.Fatalf("replay out=%s err=%v", out, err)
	}
	if dp.queries != 1 || len(fake.got) != 1 {
		t.Fatalf("the second delivery must be swallowed by dedupe: queries=%d settles=%d", dp.queries, len(fake.got))
	}
}

func TestUnknownEventIsIgnoredButSwapsAndDepositsAreDistinct(t *testing.T) {
	dp := &depProv{name: "mockd", deposit: cryptoprov.Deposit{Amount: decimal.NewFromInt(1), Status: cryptoprov.DepositConfirmed}}
	ing, _, fake := newDepRig(t, true, dp)
	if out, err := deliverDep(t, ing, "withdraw.done|acct-1|w1"); err != nil || out != OutcomeIgnored {
		t.Fatalf("out=%s err=%v", out, err)
	}
	if len(fake.got) != 0 || dp.queries != 0 {
		t.Fatal("a non-deposit event must not touch the deposit engine")
	}
}
