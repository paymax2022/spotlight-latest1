package venue

import "context"

// NoopAdapter is the ONLY adapter in this codebase and the safe default. It is
// permanently disabled and rejects every order — so wiring the venue package in
// cannot place a real trade. It exists to (1) give the pipeline a concrete Adapter
// to hold before a real venue is built, and (2) make "executes nothing" a
// structural property, not a promise. A real adapter replaces it only after being
// built as a separate, security-reviewed module and promoted through the §12 ladder.
type NoopAdapter struct{ name string }

// NewNoopAdapter returns a disabled, reject-all adapter.
func NewNoopAdapter(name string) *NoopAdapter {
	if name == "" {
		name = "noop"
	}
	return &NoopAdapter{name: name}
}

func (n *NoopAdapter) Name() string { return n.name }

// Enabled is always false — the no-op never trades.
func (n *NoopAdapter) Enabled() bool { return false }

// WithdrawalsDisabled is true vacuously (there are no credentials, so nothing can
// withdraw), but Enabled() is false so Transmit rejects before this matters.
func (n *NoopAdapter) WithdrawalsDisabled() bool { return true }

func (n *NoopAdapter) Killed() bool { return true } // treated as killed: never transmits
func (n *NoopAdapter) Kill()        {}

// Submit always rejects — no order is ever transmitted.
func (n *NoopAdapter) Submit(_ context.Context, o Order) (Fill, error) {
	return Fill{ClientOrderID: o.ClientOrderID, Status: StatusRejected}, ErrNotEnabled
}

func (n *NoopAdapter) Cancel(_ context.Context, _ string) error { return nil }

func (n *NoopAdapter) Reconcile(_ context.Context) ([]Fill, error) { return nil, nil }

// AllowAll is a Guard that approves everything — for TESTS ONLY. Production wires a
// real Guard to risk.Screen / committee.Decide. Named loudly so it can't be used by
// accident.
type AllowAll struct{}

func (AllowAll) PreTradeApprove(_ context.Context, _ Order) error { return nil }
