package deposit

import (
	"context"
	"testing"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

func providerDeposit() cryptoprov.Deposit {
	return cryptoprov.Deposit{
		ID: "op-1", AccountID: "acct-1", Currency: "BTC", Network: "bitcoin",
		Address: "bc1q…", Amount: decimal.RequireFromString("0.001"), // 100000 sat at scale 1e8
		Confirmations: 3, Status: cryptoprov.DepositConfirmed, TxHash: "0xabc",
	}
}

// SettleDeposit converts a whole-unit decimal amount to minor units via the resolved asset
// scale and credits the owner — the value never comes from a webhook payload.
func TestSettleDepositConvertsByScaleAndCredits(t *testing.T) {
	ms := newMemStore()
	res, err := NewSettler(resolverWith(map[string]Owner{"acct-1": owner1()}), ms).
		SettleDeposit(context.Background(), "quidax", providerDeposit())
	if err != nil {
		t.Fatal(err)
	}
	if res.Outcome != OutcomeSettled {
		t.Fatalf("outcome=%s want settled", res.Outcome)
	}
	if got := ms.balance("user-A", "asset-btc"); got != 100_000 {
		t.Fatalf("units=%d want 100000 (0.001 BTC at scale 1e8)", got)
	}
	if res.UserID != "user-A" || res.AssetID != "asset-btc" {
		t.Fatalf("resolved owner = %+v", res)
	}
}

func TestSettleDepositReplayIsOnceOnly(t *testing.T) {
	ms := newMemStore()
	s := NewSettler(resolverWith(map[string]Owner{"acct-1": owner1()}), ms)
	d := providerDeposit()
	if r, _ := s.SettleDeposit(context.Background(), "quidax", d); r.Outcome != OutcomeSettled {
		t.Fatalf("first = %s", r.Outcome)
	}
	if r, _ := s.SettleDeposit(context.Background(), "quidax", d); r.Outcome != OutcomeDuplicate {
		t.Fatalf("replay = %s want duplicate", r.Outcome)
	}
	if got := ms.balance("user-A", "asset-btc"); got != 100_000 {
		t.Fatalf("balance=%d want credited exactly once", got)
	}
}

func TestSettleDepositBelowThresholdAwaits(t *testing.T) {
	ms := newMemStore()
	d := providerDeposit()
	d.Confirmations = 1 // owner1 requires 2
	res, err := NewSettler(resolverWith(map[string]Owner{"acct-1": owner1()}), ms).
		SettleDeposit(context.Background(), "quidax", d)
	if err != nil {
		t.Fatal(err)
	}
	if res.Outcome != OutcomeAwaiting {
		t.Fatalf("outcome=%s want awaiting", res.Outcome)
	}
	if ms.balance("user-A", "asset-btc") != 0 {
		t.Fatal("an under-confirmed deposit must credit nothing")
	}
}

// A pending transfer needs no scale read and must never credit; a failed one is rejected.
func TestSettleDepositNonFinalStates(t *testing.T) {
	for _, tc := range []struct {
		status cryptoprov.DepositStatus
		want   Outcome
	}{
		{cryptoprov.DepositPending, OutcomeAwaiting},
		{cryptoprov.DepositFailed, OutcomeRejected},
		{cryptoprov.DepositReorged, OutcomeRejected},
	} {
		ms := newMemStore()
		d := providerDeposit()
		d.Status = tc.status
		res, err := NewSettler(resolverWith(map[string]Owner{"acct-1": owner1()}), ms).
			SettleDeposit(context.Background(), "quidax", d)
		if err != nil {
			t.Fatalf("%s: %v", tc.status, err)
		}
		if res.Outcome != tc.want {
			t.Fatalf("%s: outcome=%s want %s", tc.status, res.Outcome, tc.want)
		}
		if ms.balance("user-A", "asset-btc") != 0 {
			t.Fatalf("%s must not credit", tc.status)
		}
	}
}

func TestSettleDepositUnmappedCreditsNobody(t *testing.T) {
	ms := newMemStore()
	d := providerDeposit()
	d.AccountID = "orphan"
	res, err := NewSettler(resolverWith(map[string]Owner{"acct-1": owner1()}), ms).
		SettleDeposit(context.Background(), "quidax", d)
	if err != nil {
		t.Fatal(err)
	}
	if res.Outcome != OutcomeUnmapped {
		t.Fatalf("outcome=%s want unmapped", res.Outcome)
	}
	if len(ms.applied) != 0 {
		t.Fatal("an orphan sub-account must write no journal row")
	}
}

// Sub-minor-unit dust, a zero amount, and an amount that cannot be represented are all
// refused — never rounded, never credited as a fraction.
func TestSettleDepositRejectsBadAmounts(t *testing.T) {
	cases := map[string]string{
		"zero":     "0",
		"negative": "-1",
		"dust":     "0.000000004", // finer than BTC's 1e-8 scale
	}
	for name, amt := range cases {
		t.Run(name, func(t *testing.T) {
			ms := newMemStore()
			d := providerDeposit()
			d.Amount = decimal.RequireFromString(amt)
			res, err := NewSettler(resolverWith(map[string]Owner{"acct-1": owner1()}), ms).
				SettleDeposit(context.Background(), "quidax", d)
			if err != nil {
				t.Fatal(err)
			}
			if res.Outcome != OutcomeRejected {
				t.Fatalf("outcome=%s want rejected", res.Outcome)
			}
			if ms.balance("user-A", "asset-btc") != 0 {
				t.Fatal("a refused amount must not credit")
			}
		})
	}
}

func TestSettleDepositResolverErrorPropagates(t *testing.T) {
	ms := newMemStore()
	_, err := NewSettler(fakeResolver{err: context.DeadlineExceeded}, ms).
		SettleDeposit(context.Background(), "quidax", providerDeposit())
	if err == nil {
		t.Fatal("a resolver outage must return an error so the provider redelivers")
	}
	if ms.balance("user-A", "asset-btc") != 0 {
		t.Fatal("a failed resolution must not credit")
	}
}

func TestToMinorUnits(t *testing.T) {
	good := map[string]struct {
		amount string
		scale  int64
		want   int64
	}{
		"whole btc": {"1", 1e8, 100_000_000},
		"sat":       {"0.00000001", 1e8, 1},
		"usdt 6dp":  {"1.5", 1e6, 1_500_000},
	}
	for name, tc := range good {
		got, err := toMinorUnits(decimal.RequireFromString(tc.amount), tc.scale)
		if err != nil || got != tc.want {
			t.Fatalf("%s: got %d, %v want %d", name, got, err, tc.want)
		}
	}
	bad := []struct {
		amount string
		scale  int64
	}{
		{"0", 1e8},                        // not positive
		{"-2", 1e8},                       // negative
		{"1", 0},                          // no scale
		{"1", -1e8},                       // negative scale
		{"0.1", 1},                        // sub-minor precision
		{"999999999999999999999999", 1e8}, // overflow
	}
	for _, tc := range bad {
		if _, err := toMinorUnits(decimal.RequireFromString(tc.amount), tc.scale); err == nil {
			t.Fatalf("amount=%s scale=%d: want error", tc.amount, tc.scale)
		}
	}
}
