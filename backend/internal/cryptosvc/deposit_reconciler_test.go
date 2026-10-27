package cryptosvc

// SP-0? GAP-DEP-01 Slice 2b — deposit reconciler domain tests. The webhook settles a
// deposit only when the provider delivers an event; a lost or delivered-under-confirmed
// webhook leaves a real transfer unsettled. The reconciler is the safety net: it polls
// ListDeposits per provider sub-account and re-feeds each transfer into the same
// once-only, confirmation-gated settler the webhook uses, so a credit can never be
// double-applied by the sweep. These tests drive it with the deterministic mock provider
// (no live Quidax). The live-DB money credit itself is proven against Postgres in
// deposit_reconciler_live_db_test.go.

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

// fakeLeader lets a test decide whether this replica wins the lock.
type fakeLeader struct{ lead bool }

func (f fakeLeader) TryLead(context.Context) (func(), bool, error) {
	if !f.lead {
		return func() {}, false, nil
	}
	return func() {}, true, nil
}

// recordingSettler tallies the deposits the reconciler feeds it and returns a canned
// outcome, so the test can assert on the sweep's classification.
type recordingSettler struct {
	calls    []cryptoprov.Deposit
	outcome  Outcome
	failFor  string // if set, any deposit with this ID returns an error
	errCount int
}

func (s *recordingSettler) SettleDeposit(_ context.Context, _ string, d cryptoprov.Deposit) (Outcome, error) {
	if s.failFor != "" && d.ID == s.failFor {
		return "", errors.New("settler boom")
	}
	s.calls = append(s.calls, d)
	return s.outcome, nil
}

type fakeAccounts struct {
	byProvider map[string][]string
	err        error
}

func (f fakeAccounts) ListProviderAccounts(_ context.Context, provider string) ([]string, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.byProvider[provider], nil
}

// newMockRegistry wires a single mock provider under its own name.
func newMockRegistry(name string) (*cryptoprov.Registry, *cryptoprov.Mock) {
	mock := cryptoprov.NewMock(name, func() time.Time { return time.Unix(0, 0).UTC() })
	reg := cryptoprov.NewRegistry(name)
	if err := reg.Register(mock); err != nil {
		panic(err)
	}
	return reg, mock
}

func confirmedDeposit(acct, id string, amount decimal.Decimal) cryptoprov.Deposit {
	return cryptoprov.Deposit{
		ID: id, AccountID: acct, Currency: "BTC", Network: "bitcoin",
		Amount: amount, Confirmations: 6, Status: cryptoprov.DepositConfirmed,
	}
}

func TestDepositReconcilerRequiresDeps(t *testing.T) {
	r := NewDepositReconciler(DepositReconcilerConfig{})
	if _, err := r.RunOnce(context.Background()); err == nil {
		t.Fatal("a reconciler with no deps must fail closed, not silently pass")
	}
}

func TestDepositReconcilerSkipsWhenNotLeader(t *testing.T) {
	reg, mock := newMockRegistry("quidax")
	mock.AddDeposit(confirmedDeposit("acct-1", "dep-1", decimal.RequireFromString("0.5")))
	settler := &recordingSettler{outcome: OutcomeApplied}
	r := NewDepositReconciler(DepositReconcilerConfig{
		ProviderName: "quidax", Registry: reg, Settler: settler,
		Accounts: fakeAccounts{byProvider: map[string][]string{"quidax": {"acct-1"}}},
		Leader:   fakeLeader{lead: false},
	})
	res, err := r.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if !res.Skipped {
		t.Fatal("a follower must skip, not sweep")
	}
	if len(settler.calls) != 0 {
		t.Fatalf("follower must not settle anything, got %d calls", len(settler.calls))
	}
}

func TestDepositReconcilerSettlesMissedWebhook(t *testing.T) {
	reg, mock := newMockRegistry("quidax")
	mock.AddDeposit(confirmedDeposit("acct-1", "dep-1", decimal.RequireFromString("0.5")))
	mock.AddDeposit(confirmedDeposit("acct-1", "dep-2", decimal.RequireFromString("1.0")))
	settler := &recordingSettler{outcome: OutcomeApplied}
	r := NewDepositReconciler(DepositReconcilerConfig{
		ProviderName: "quidax", Registry: reg, Settler: settler,
		Accounts: fakeAccounts{byProvider: map[string][]string{"quidax": {"acct-1"}}},
		Leader:   fakeLeader{lead: true},
	})
	res, err := r.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if res.Settled != 2 || len(settler.calls) != 2 {
		t.Fatalf("want 2 settled, got result %+v calls %d", res, len(settler.calls))
	}
	if res.Accounts != 1 || res.Scanned != 2 {
		t.Fatalf("want 1 account / 2 scanned, got %+v", res)
	}
}

func TestDepositReconcilerClassifiesOutcomes(t *testing.T) {
	cases := []struct {
		outcome Outcome
		check   func(DepositReconcileResult) bool
		name    string
	}{
		{OutcomeApplied, func(r DepositReconcileResult) bool { return r.Settled == 1 }, "settled"},
		{OutcomeDuplicate, func(r DepositReconcileResult) bool { return r.Duplicates == 1 }, "duplicate"},
		{OutcomePending, func(r DepositReconcileResult) bool { return r.Awaiting == 1 }, "awaiting"},
		{OutcomeIgnored, func(r DepositReconcileResult) bool { return r.Ignored == 1 }, "ignored"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			reg, mock := newMockRegistry("quidax")
			mock.AddDeposit(confirmedDeposit("acct-1", "dep-1", decimal.RequireFromString("0.5")))
			r := NewDepositReconciler(DepositReconcilerConfig{
				ProviderName: "quidax", Registry: reg,
				Settler:  &recordingSettler{outcome: tc.outcome},
				Accounts: fakeAccounts{byProvider: map[string][]string{"quidax": {"acct-1"}}},
				Leader:   fakeLeader{lead: true},
			})
			res, err := r.RunOnce(context.Background())
			if err != nil {
				t.Fatalf("RunOnce: %v", err)
			}
			if !tc.check(res) {
				t.Fatalf("outcome %q not tallied: %+v", tc.outcome, res)
			}
		})
	}
}

func TestDepositReconcilerSettlerErrorCountsAndAlerts(t *testing.T) {
	reg, mock := newMockRegistry("quidax")
	mock.AddDeposit(confirmedDeposit("acct-1", "bad", decimal.RequireFromString("0.5")))
	var alerts int
	r := NewDepositReconciler(DepositReconcilerConfig{
		ProviderName: "quidax", Registry: reg,
		Settler:  &recordingSettler{outcome: OutcomeApplied, failFor: "bad"},
		Accounts: fakeAccounts{byProvider: map[string][]string{"quidax": {"acct-1"}}},
		Leader:   fakeLeader{lead: true},
		Alert:    func(string, string) { alerts++ },
	})
	res, err := r.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("one settling deposit must not abort the pass: %v", err)
	}
	if res.Errors != 1 || alerts == 0 {
		t.Fatalf("want 1 error + an alert, got %+v alerts=%d", res, alerts)
	}
}

func TestDepositReconcilerAccountListErrorIsReported(t *testing.T) {
	reg, _ := newMockRegistry("quidax")
	r := NewDepositReconciler(DepositReconcilerConfig{
		ProviderName: "quidax", Registry: reg,
		Settler:  &recordingSettler{outcome: OutcomeApplied},
		Accounts: fakeAccounts{err: errors.New("db down")},
		Leader:   fakeLeader{lead: true},
	})
	if _, err := r.RunOnce(context.Background()); err == nil {
		t.Fatal("an account-source failure must surface as an error")
	}
}

func TestDepositReconcilerRespectsBatch(t *testing.T) {
	reg, mock := newMockRegistry("quidax")
	for i := 0; i < 5; i++ {
		mock.AddDeposit(confirmedDeposit("acct-1", string(rune('a'+i)), decimal.NewFromInt(1)))
	}
	settler := &recordingSettler{outcome: OutcomeApplied}
	r := NewDepositReconciler(DepositReconcilerConfig{
		ProviderName: "quidax", Registry: reg, Settler: settler,
		Accounts: fakeAccounts{byProvider: map[string][]string{"quidax": {"acct-1"}}},
		Leader:   fakeLeader{lead: true},
		Batch:    2,
	})
	res, err := r.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if res.Scanned != 2 || res.Settled != 2 {
		t.Fatalf("batch must cap deposits per account at 2, got %+v", res)
	}
	if !res.Truncated {
		t.Fatal("5 deposits with batch 2 must mark the pass truncated")
	}
}

func TestDepositReconcilerTruncatesAccounts(t *testing.T) {
	reg, mock := newMockRegistry("quidax")
	accts := make([]string, 0, 4)
	for i := 0; i < 4; i++ {
		a := "acct-" + string(rune('0'+i))
		mock.AddDeposit(confirmedDeposit(a, "d"+string(rune('0'+i)), decimal.NewFromInt(1)))
		accts = append(accts, a)
	}
	r := NewDepositReconciler(DepositReconcilerConfig{
		ProviderName: "quidax", Registry: reg, Settler: &recordingSettler{outcome: OutcomeApplied},
		Accounts:    fakeAccounts{byProvider: map[string][]string{"quidax": accts}},
		Leader:      fakeLeader{lead: true},
		MaxAccounts: 2,
	})
	res, err := r.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if res.Accounts != 2 || !res.Truncated {
		t.Fatalf("MaxAccounts 2 must sweep 2 accounts and mark truncated, got %+v", res)
	}
}

func TestDepositReconcilerRecordsSnapshot(t *testing.T) {
	reg, mock := newMockRegistry("quidax")
	mock.AddDeposit(confirmedDeposit("acct-1", "dep-1", decimal.NewFromInt(1)))
	r := NewDepositReconciler(DepositReconcilerConfig{
		ProviderName: "quidax", Registry: reg, Settler: &recordingSettler{outcome: OutcomeApplied},
		Accounts: fakeAccounts{byProvider: map[string][]string{"quidax": {"acct-1"}}},
		Leader:   fakeLeader{lead: true},
	})
	if _, err := r.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	snap := r.Snapshot()
	if snap.Runs != 1 || snap.LedRuns != 1 || snap.Totals.Settled != 1 {
		t.Fatalf("snapshot wrong after one led pass: %+v", snap)
	}
}
