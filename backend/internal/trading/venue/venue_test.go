package venue

import (
	"context"
	"errors"
	"testing"
)

// fakeAdapter is a configurable in-memory adapter for exercising the envelope. It
// counts Submit calls so we can prove idempotency and no-transmit-on-reject.
type fakeAdapter struct {
	enabled, killed, wd bool
	submits             int
	fills               map[string]Fill // idempotency store keyed by ClientOrderID
}

func newFake() *fakeAdapter {
	return &fakeAdapter{enabled: true, killed: false, wd: true, fills: map[string]Fill{}}
}
func (f *fakeAdapter) Name() string              { return "fake" }
func (f *fakeAdapter) Enabled() bool             { return f.enabled }
func (f *fakeAdapter) WithdrawalsDisabled() bool { return f.wd }
func (f *fakeAdapter) Killed() bool              { return f.killed }
func (f *fakeAdapter) Kill()                     { f.killed = true }
func (f *fakeAdapter) Submit(_ context.Context, o Order) (Fill, error) {
	if prior, ok := f.fills[o.ClientOrderID]; ok {
		return prior, nil // idempotent replay — no new transmission
	}
	f.submits++
	fill := Fill{ClientOrderID: o.ClientOrderID, VenueOrderID: "v1", Status: StatusFilled, FilledNotionalKobo: o.NotionalKobo, AvgPriceKobo: 100, FeeKobo: 10}
	f.fills[o.ClientOrderID] = fill
	return fill, nil
}
func (f *fakeAdapter) Cancel(context.Context, string) error   { return nil }
func (f *fakeAdapter) Reconcile(context.Context) ([]Fill, error) { return nil, nil }

func goodOrder() Order {
	return Order{ClientOrderID: "ord-1", Strategy: "s", Asset: "BTC", Side: Long, NotionalKobo: 5_000_000, StopDistanceBps: 300}
}

// The no-op adapter — the only one that ships — can never transmit.
func TestNoop_NeverTrades(t *testing.T) {
	n := NewNoopAdapter("")
	if n.Enabled() {
		t.Fatal("noop must be disabled")
	}
	if _, err := Transmit(context.Background(), n, AllowAll{}, goodOrder()); !errors.Is(err, ErrNotEnabled) {
		t.Fatalf("noop must reject via the envelope, got %v", err)
	}
}

// A clean, fully-attested order transmits exactly once.
func TestTransmit_HappyPath(t *testing.T) {
	f := newFake()
	fill, err := Transmit(context.Background(), f, AllowAll{}, goodOrder())
	if err != nil || fill.Status != StatusFilled {
		t.Fatalf("clean order should fill, got %+v err %v", fill, err)
	}
	if f.submits != 1 {
		t.Fatalf("expected exactly 1 submit, got %d", f.submits)
	}
}

// The envelope fail-closes on EVERY unsafe condition, and nothing is transmitted.
func TestTransmit_FailClosed(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name  string
		mut   func(*fakeAdapter)
		guard Guard
		order Order
		want  error
	}{
		{"disabled", func(f *fakeAdapter) { f.enabled = false }, AllowAll{}, goodOrder(), ErrNotEnabled},
		{"killed", func(f *fakeAdapter) { f.killed = true }, AllowAll{}, goodOrder(), ErrKilled},
		{"withdrawals-possible", func(f *fakeAdapter) { f.wd = false }, AllowAll{}, goodOrder(), ErrWithdrawalsPossible},
		{"pretrade-veto", func(*fakeAdapter) {}, GuardFunc(func(context.Context, Order) error { return errors.New("drawdown breach") }), goodOrder(), ErrPreTradeVetoed},
		{"bad-order-size", func(*fakeAdapter) {}, AllowAll{}, func() Order { o := goodOrder(); o.NotionalKobo = 0; return o }(), ErrBadOrder},
		{"bad-order-noid", func(*fakeAdapter) {}, AllowAll{}, func() Order { o := goodOrder(); o.ClientOrderID = ""; return o }(), ErrBadOrder},
		{"bad-order-side", func(*fakeAdapter) {}, AllowAll{}, func() Order { o := goodOrder(); o.Side = "sideways"; return o }(), ErrBadOrder},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := newFake()
			c.mut(f)
			fill, err := Transmit(ctx, f, c.guard, c.order)
			if !errors.Is(err, c.want) {
				t.Fatalf("want %v, got %v", c.want, err)
			}
			if fill.Status != StatusRejected {
				t.Fatalf("rejected order must have StatusRejected, got %s", fill.Status)
			}
			if f.submits != 0 {
				t.Fatalf("nothing must be transmitted on a fail-closed path, got %d submits", f.submits)
			}
		})
	}
}

// Ordering: the withdrawals check must gate BEFORE any transmit even when the
// pre-trade guard would pass — a credential that can withdraw never trades.
func TestTransmit_WithdrawalsGateIsHard(t *testing.T) {
	f := newFake(); f.wd = false
	if _, err := Transmit(context.Background(), f, AllowAll{}, goodOrder()); !errors.Is(err, ErrWithdrawalsPossible) {
		t.Fatalf("withdrawals-possible must hard-block, got %v", err)
	}
	if f.submits != 0 {
		t.Fatal("must not transmit when withdrawals are possible")
	}
}

// Idempotency: re-transmitting the same ClientOrderID does not double-submit.
func TestTransmit_Idempotent(t *testing.T) {
	f := newFake()
	o := goodOrder()
	_, _ = Transmit(context.Background(), f, AllowAll{}, o)
	_, _ = Transmit(context.Background(), f, AllowAll{}, o) // same id
	if f.submits != 1 {
		t.Fatalf("same ClientOrderID must transmit once, got %d", f.submits)
	}
}

// A kill switch engaged mid-session stops further transmission.
func TestTransmit_KillSwitch(t *testing.T) {
	f := newFake()
	if _, err := Transmit(context.Background(), f, AllowAll{}, goodOrder()); err != nil {
		t.Fatalf("first order should pass: %v", err)
	}
	f.Kill()
	o2 := goodOrder(); o2.ClientOrderID = "ord-2"
	if _, err := Transmit(context.Background(), f, AllowAll{}, o2); !errors.Is(err, ErrKilled) {
		t.Fatalf("after Kill, transmission must be refused, got %v", err)
	}
	if f.submits != 1 {
		t.Fatal("no transmit after kill")
	}
}
