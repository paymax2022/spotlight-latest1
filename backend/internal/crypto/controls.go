package crypto

import (
	"context"
	"errors"
	"strings"
)

// Operational controls (workplan RQ-ADM-004/005): a trading pause, a per-market switch and a
// global withdrawal kill switch, set by admins and stored by the cryptosvc controls store.
// They are injected by app wiring (WithControls) as plain funcs, so this package does not
// import cryptosvc; the wiring maps the store's refusals onto these errors. Production wiring
// always sets both; the funcs themselves fail closed when the state is unreadable.

var (
	// ErrTradingPaused: all crypto trading is paused by an admin.
	ErrTradingPaused = errors.New("crypto: trading is paused")
	// ErrMarketDisabled: this asset's market is switched off.
	ErrMarketDisabled = errors.New("crypto: this market is switched off")
	// ErrWithdrawalsPaused: the withdrawal kill switch is on (or its state is unknown).
	ErrWithdrawalsPaused = errors.New("crypto: withdrawals are paused")
	// ErrAboveTradeLimit: the trade is worth more than the admin's per-trade limit.
	ErrAboveTradeLimit = errors.New("crypto: amount is above the current per-trade limit")
	// ErrSelfDecision: an admin may not decide their own withdrawal (QDX-ADM-009).
	ErrSelfDecision = errors.New("crypto: you cannot decide your own withdrawal")
)

// independentApprover refuses an admin deciding a withdrawal they requested themselves, and a
// decision with no identified actor. Either decision (approve or reject) needs a second person.
func independentApprover(actorID, ownerID string) error {
	if actorID == "" || strings.EqualFold(actorID, ownerID) {
		return ErrSelfDecision
	}
	return nil
}

// TradeControlFunc refuses a trade in symbol with ErrTradingPaused or ErrMarketDisabled.
type TradeControlFunc func(ctx context.Context, symbol string) error

// WithdrawControlFunc refuses a payout with ErrWithdrawalsPaused.
type WithdrawControlFunc func(ctx context.Context) error

// LimitControlFunc refuses a buy/sell worth more than the per-trade NGN limit
// (ErrAboveTradeLimit), or any trade when the limit can't be read (ErrTradingPaused).
type LimitControlFunc func(ctx context.Context, ngnKobo int64) error

// WithTradeLimit wires the per-trade limit. Coin-to-coin swaps have no NGN leg and are not capped.
func (s *Service) WithTradeLimit(f LimitControlFunc) *Service {
	s.limitCtl = f
	return s
}

func (s *Service) checkLimit(ctx context.Context, ngnKobo int64) error {
	if s.limitCtl == nil {
		return nil
	}
	return s.limitCtl(ctx, ngnKobo)
}

// WithControls wires the operational controls.
func (s *Service) WithControls(trade TradeControlFunc, withdraw WithdrawControlFunc) *Service {
	s.tradeCtl, s.withdrawCtl = trade, withdraw
	return s
}

func (s *Service) checkTrade(ctx context.Context, symbols ...string) error {
	if s.tradeCtl == nil {
		return nil
	}
	for _, sym := range symbols {
		if err := s.tradeCtl(ctx, sym); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) checkWithdraw(ctx context.Context) error {
	if s.withdrawCtl == nil {
		return nil
	}
	return s.withdrawCtl(ctx)
}
