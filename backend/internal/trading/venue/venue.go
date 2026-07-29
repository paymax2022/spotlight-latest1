// Package venue is the execution-boundary CONTRACT for the AI-trading system (§8
// of the go-live runbook). It defines the interface a real exchange/broker adapter
// must satisfy and — more importantly — the fail-closed SAFETY ENVELOPE every order
// must pass through before it can leave the building. It contains NO real venue
// client: the only adapter here is a reject-all no-op, so this package cannot place
// a real order. A real adapter is a separate, security-reviewed module that must
// itself climb the §12 promotion ladder before full allocation.
//
// Design rules encoded here (from the build brief + runbook):
//   - The adapter NEVER sizes or decides. It receives an already-sized,
//     already-approved Order from the deterministic pipeline and only transmits it.
//   - Credentials must be TRADE-ONLY with withdrawals disabled at the venue; an
//     adapter that cannot attest this is refused (fail-closed).
//   - Every order is transmitted at most once (idempotent on ClientOrderID).
//   - A pre-trade re-check runs at the very edge against fresh state; if anything
//     changed (risk veto, circuit), the order is aborted — never transmitted.
//   - A per-venue kill switch halts all transmission independently of the ladder.
package venue

import (
	"context"
	"errors"
	"strings"
)

// Side is the direction of an order. Matches the pipeline's string side.
type Side string

const (
	Long  Side = "long"
	Short Side = "short"
)

// Order is an already-SIZED, already-APPROVED instruction to transmit. The adapter
// does not compute any field here — the deterministic pipeline
// (regime → signals → risk.Screen → committee.Decide) produced it. ClientOrderID is
// the idempotency key: the same id must never transmit twice.
type Order struct {
	ClientOrderID   string // caller-generated idempotency key (unique per intended order)
	Strategy        string
	Asset           string
	Side            Side
	NotionalKobo    int64 // the risk-approved size; the adapter may not raise it
	StopDistanceBps int64
}

// OrderStatus is the terminal or interim state of a transmitted order.
type OrderStatus string

const (
	StatusAccepted OrderStatus = "accepted"
	StatusPartial  OrderStatus = "partially_filled"
	StatusFilled   OrderStatus = "filled"
	StatusRejected OrderStatus = "rejected"
	StatusCanceled OrderStatus = "canceled"
)

// Fill is the venue's response for an order, used to reconcile against the ledger.
type Fill struct {
	ClientOrderID      string
	VenueOrderID       string
	Status             OrderStatus
	FilledNotionalKobo int64
	AvgPriceKobo       int64 // execution price in kobo (per unit)
	FeeKobo            int64
}

// Adapter is the contract a concrete venue implementation must satisfy. It is only
// ever driven through Transmit (below), never called directly by trading code.
type Adapter interface {
	// Name identifies the venue (safe to log; no secret).
	Name() string
	// Enabled reports whether this venue is configured and turned on. Default OFF.
	Enabled() bool
	// WithdrawalsDisabled attests the credentials in use CANNOT withdraw or transfer
	// funds — verified against the venue's key scopes, not merely unused. Transmit
	// refuses to trade unless this is true (fail-closed).
	WithdrawalsDisabled() bool
	// Killed reports whether the per-venue kill switch is engaged.
	Killed() bool
	// Kill engages the kill switch; all subsequent transmission is refused.
	Kill()
	// Submit transmits an order. MUST be idempotent on o.ClientOrderID: a retry with
	// the same id returns the prior result and never double-submits.
	Submit(ctx context.Context, o Order) (Fill, error)
	// Cancel requests cancellation of a working order.
	Cancel(ctx context.Context, clientOrderID string) error
	// Reconcile returns recent fills so the caller can reconcile against the ledger.
	Reconcile(ctx context.Context) ([]Fill, error)
}

// Guard is the pre-trade re-check run at the edge, immediately before transmit. It
// re-evaluates the risk veto against FRESH state; a non-nil error aborts the order.
// Wire this to risk.Screen / committee.Decide so nothing is transmitted that the
// deterministic core would no longer approve.
type Guard interface {
	PreTradeApprove(ctx context.Context, o Order) error
}

// GuardFunc adapts a function to Guard.
type GuardFunc func(ctx context.Context, o Order) error

func (f GuardFunc) PreTradeApprove(ctx context.Context, o Order) error { return f(ctx, o) }

// Sentinel refusals from the safety envelope.
var (
	ErrNotEnabled          = errors.New("venue: adapter not enabled")
	ErrKilled              = errors.New("venue: kill switch engaged")
	ErrWithdrawalsPossible = errors.New("venue: refusing to trade — withdrawals are not disabled on these credentials")
	ErrPreTradeVetoed      = errors.New("venue: pre-trade re-check vetoed the order")
	ErrBadOrder            = errors.New("venue: malformed order")
)

// Transmit is the ONE safe entry point to a venue. It applies the fail-closed
// safety envelope IN ORDER, then delegates to the adapter's idempotent Submit.
// Trading code must never call Adapter.Submit directly — always go through here.
//
//	1. order well-formed (id + asset + positive size)
//	2. adapter enabled
//	3. kill switch NOT engaged
//	4. credentials attest withdrawals disabled
//	5. pre-trade re-check approves against fresh state
//
// Any failure returns a rejected Fill + the reason; nothing is transmitted.
func Transmit(ctx context.Context, a Adapter, g Guard, o Order) (Fill, error) {
	rejected := Fill{ClientOrderID: o.ClientOrderID, Status: StatusRejected}

	if a == nil || g == nil {
		return rejected, ErrNotEnabled
	}
	if strings.TrimSpace(o.ClientOrderID) == "" || strings.TrimSpace(o.Asset) == "" ||
		o.NotionalKobo <= 0 || (o.Side != Long && o.Side != Short) {
		return rejected, ErrBadOrder
	}
	if !a.Enabled() {
		return rejected, ErrNotEnabled
	}
	if a.Killed() {
		return rejected, ErrKilled
	}
	if !a.WithdrawalsDisabled() {
		return rejected, ErrWithdrawalsPossible
	}
	if err := g.PreTradeApprove(ctx, o); err != nil {
		return rejected, errors.Join(ErrPreTradeVetoed, err)
	}
	return a.Submit(ctx, o)
}
