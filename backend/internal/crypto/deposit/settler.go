package deposit

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

// Settler turns a provider-reported inbound transfer into a balance credit, enforcing
// the four money-IN invariants the UAT treats as non-negotiable:
//   1. finality   — credit only at the network's required confirmations and only for a
//      terminal-confirmed status (a pending or reorged transfer credits nothing);
//   2. once-only  — exactly one credit per ProviderOpID, enforced by the Store;
//   3. mapping    — the recipient is resolved from the provider sub-account, never
//      trusted from the event, so a spoofed recipient cannot redirect funds;
//   4. positivity — only a strictly positive amount is creditable.
type Settler struct {
	owners OwnerResolver
	store  Store
}

// NewSettler wires the resolver and the store. Either being nil is a programming error;
// callers construct it fully.
func NewSettler(owners OwnerResolver, store Store) *Settler {
	return &Settler{owners: owners, store: store}
}

// Settle classifies and (when appropriate) applies c. It never partially credits: every
// non-Settled outcome leaves the balance untouched. Awaiting is not an error — it is the
// normal state of a transfer still confirming, and the caller re-submits once it is final
// (or the reconciler does).
func (s *Settler) Settle(ctx context.Context, c Credit) (Result, error) {
	if c.Units <= 0 {
		return Result{Outcome: OutcomeRejected, Reason: "credit amount must be positive"}, nil
	}
	switch c.Status {
	case StatusReorged, StatusFailed:
		return Result{Outcome: OutcomeRejected, Reason: "transfer is not final (" + string(c.Status) + ")"}, nil
	case StatusConfirmed:
		// proceed to the confirmation-threshold check below
	default:
		// pending or unknown: never credit a non-terminal transfer
		return Result{Outcome: OutcomeAwaiting, Reason: "transfer not confirmed (" + string(c.Status) + ")"}, nil
	}

	owner, ok, err := s.owners.Resolve(ctx, c)
	if err != nil {
		// A dependency failure is NOT a rejection: leave the deposit uncredited and let
		// the caller/provider retry. Returning the error surfaces it as a 5xx so the
		// provider redelivers rather than dropping a real deposit.
		return Result{Outcome: OutcomeRejected}, err
	}
	if !ok {
		// Orphan/unknown sub-account: park for human review, credit nobody.
		return Result{Outcome: OutcomeUnmapped, Reason: "no owner for provider sub-account " + c.ProviderAccountID}, nil
	}

	return s.checkAndApply(ctx, c, owner)
}

// SettleDeposit is the provider-deposit entry point: it takes the authoritative re-queried
// transfer (cryptoprov.Deposit), converts the whole-unit decimal amount to integer minor
// units with the resolved asset's scale, and settles it through the same four invariants.
// provider is recorded on the journal row; d carries the value — a webhook payload only
// ever NAMES this deposit, so nothing here trusts an amount the event claimed.
func (s *Settler) SettleDeposit(ctx context.Context, provider string, d cryptoprov.Deposit) (Result, error) {
	c := Credit{
		Provider:          provider,
		ProviderAccountID: d.AccountID,
		ProviderOpID:      d.ID,
		Symbol:            d.Currency,
		Network:           d.Network,
		Address:           d.Address,
		Confirmations:     d.Confirmations,
		Status:            mapProviderStatus(d.Status),
		TxHash:            d.TxHash,
	}
	// Non-final states decide without a DB read; only a confirmed transfer needs the
	// owner's scale to turn its decimal amount into minor units.
	switch c.Status {
	case StatusReorged, StatusFailed:
		return Result{Outcome: OutcomeRejected, Reason: "transfer is not final (" + string(c.Status) + ")"}, nil
	case StatusConfirmed:
	default:
		return Result{Outcome: OutcomeAwaiting, Reason: "transfer not confirmed (" + string(c.Status) + ")"}, nil
	}

	owner, ok, err := s.owners.Resolve(ctx, c)
	if err != nil {
		return Result{Outcome: OutcomeRejected}, err
	}
	if !ok {
		return Result{Outcome: OutcomeUnmapped, Reason: "no owner for provider sub-account " + c.ProviderAccountID}, nil
	}
	units, err := toMinorUnits(d.Amount, owner.MinorUnitScale)
	if err != nil {
		return Result{Outcome: OutcomeRejected, UserID: owner.UserID, AssetID: owner.AssetID, Reason: err.Error()}, nil
	}
	c.Units = units
	return s.checkAndApply(ctx, c, owner)
}

// checkAndApply enforces the confirmation threshold and writes the once-only credit for a
// confirmed transfer whose owner is already resolved. Shared by Settle and SettleDeposit so
// the threshold and the store call live in exactly one place.
func (s *Settler) checkAndApply(ctx context.Context, c Credit, owner Owner) (Result, error) {
	if c.Confirmations < owner.RequiredConfs {
		return Result{
			Outcome: OutcomeAwaiting, UserID: owner.UserID, AssetID: owner.AssetID,
			Reason: "awaiting confirmations: " + strconv.Itoa(c.Confirmations) + "/" + strconv.Itoa(owner.RequiredConfs),
		}, nil
	}
	out, err := s.store.ApplyCredit(ctx, Apply{
		Provider:          c.Provider,
		ProviderAccountID: c.ProviderAccountID,
		ProviderOpID:      c.ProviderOpID,
		UserID:            owner.UserID,
		AssetID:           owner.AssetID,
		Symbol:            c.Symbol,
		Network:           c.Network,
		Address:           c.Address,
		Units:             c.Units,
		Confirmations:     c.Confirmations,
		RequiredConfs:     owner.RequiredConfs,
		TxHash:            c.TxHash,
	})
	if err != nil {
		return Result{Outcome: OutcomeRejected, UserID: owner.UserID, AssetID: owner.AssetID}, err
	}
	return Result{Outcome: out, UserID: owner.UserID, AssetID: owner.AssetID}, nil
}

// mapProviderStatus maps the provider's deposit state onto this package's Status. The
// provider has no reorg signal, so it never maps to StatusReorged; unknown states fall to
// pending, which credits nothing.
func mapProviderStatus(st cryptoprov.DepositStatus) Status {
	switch st {
	case cryptoprov.DepositConfirmed:
		return StatusConfirmed
	case cryptoprov.DepositFailed:
		return StatusFailed
	case cryptoprov.DepositReorged:
		return StatusReorged
	default:
		return StatusPending
	}
}

// toMinorUnits converts a provider amount expressed in whole asset units to integer minor
// units using the asset scale (e.g. BTC scale 1e8: 0.001 -> 100000). It fails closed: a
// non-positive amount, a non-positive scale, an amount finer than the asset's minor-unit
// precision, or a value that would overflow int64 all refuse the credit rather than mint
// a fraction, round a balance, or wrap.
func toMinorUnits(amount decimal.Decimal, scale int64) (int64, error) {
	if !amount.IsPositive() {
		return 0, errors.New("deposit amount must be positive")
	}
	if scale <= 0 {
		return 0, fmt.Errorf("asset minor-unit scale must be positive (got %d)", scale)
	}
	scaled := amount.Mul(decimal.NewFromInt(scale))
	if !scaled.IsInteger() {
		return 0, fmt.Errorf("amount %s is finer than the asset's minor-unit precision (scale %d)", amount, scale)
	}
	if scaled.GreaterThan(decimal.NewFromInt(math.MaxInt64)) {
		return 0, errors.New("deposit amount exceeds the representable minor-unit range")
	}
	return scaled.IntPart(), nil
}
