package invest

import (
	"context"
	"fmt"

	"github.com/gin-gonic/gin"
	"net/http"
)

// ─────────────────────────────────────────────────────────────────────────────
// Pre-trade ESTIMATE (read-only order preview).
//
// The confirmation screen must show price, quantity, fees, total and the
// settlement timeline BEFORE the user commits (see Receipt doc). Buy/Sell compute
// those fields inline, but there was no way to preview them without placing an
// order. EstimateOrder fills that gap: it mirrors the Buy/Sell pricing math
// EXACTLY (same quote → priceForCalc → notional → FeeFor → total) but moves no
// money — no PIN, no compliance gate, no persistence, no ledger post. It is a pure
// pricing preview, so the number shown here equals the number the executed order
// will use for the same inputs and quote. (It does NOT guarantee acceptance — the
// eligibility/PIN/balance gates still run at Buy/Sell time.)
// ─────────────────────────────────────────────────────────────────────────────

// EstimateRequest previews an order without placing it. Side is "buy" or "sell".
// For a buy, provide amount_kobo (buy-by-amount) OR quantity; for a sell, quantity.
type EstimateRequest struct {
	Symbol         string    `json:"symbol" binding:"required"`
	Side           OrderSide `json:"side" binding:"required"` // buy | sell
	OrderType      OrderType `json:"order_type"`              // market (default) | limit
	AmountKobo     int64     `json:"amount_kobo"`             // buy-by-amount (buy only)
	Quantity       float64   `json:"quantity"`                // shares (required for sell / buy-by-quantity)
	LimitPriceKobo int64     `json:"limit_price_kobo"`        // required for limit orders
}

// OrderEstimate is the read-only preview returned to the confirmation screen.
type OrderEstimate struct {
	Symbol             string    `json:"symbol"`
	Side               OrderSide `json:"side"`
	OrderType          OrderType `json:"order_type"`
	EstimatedPriceKobo int64     `json:"estimated_price_kobo"` // indicative unit price used
	Quantity           float64   `json:"quantity"`             // resolved shares
	GrossKobo          int64     `json:"gross_kobo"`           // notional = qty * price
	FeesKobo           int64     `json:"fees_kobo"`
	TotalKobo          int64     `json:"total_kobo"`     // buy: gross + fees (cash debit) ; sell: gross − fees (net proceeds)
	CommissionBps      int       `json:"commission_bps"` // fee schedule applied
	MinFeeKobo         int64     `json:"min_fee_kobo"`
	MinimumOrderAmount int64     `json:"minimum_order_amount"`
	MaximumOrderAmount int64     `json:"maximum_order_amount"` // 0 = uncapped
	SettlementDays     int       `json:"settlement_days"`
}

// EstimateOrder previews an order (read-only). It fetches the asset + live quote
// then delegates the money math to the pure estimateFromPrice so the computation
// stays unit-testable and identical to Buy/Sell.
func (s *Service) EstimateOrder(ctx context.Context, req EstimateRequest) (*OrderEstimate, error) {
	if req.Side != SideBuy && req.Side != SideSell {
		return nil, fmt.Errorf("%w: side must be buy or sell", ErrInvalidOrder)
	}
	if req.OrderType == "" {
		req.OrderType = TypeMarket
	}
	if req.OrderType == TypeLimit && req.LimitPriceKobo <= 0 {
		return nil, fmt.Errorf("%w: limit price required", ErrInvalidOrder)
	}

	st, err := s.repo.GetStockBySymbol(ctx, req.Symbol)
	if err != nil {
		return nil, err
	}

	priceForCalc := req.LimitPriceKobo
	if req.OrderType != TypeLimit {
		quote, qerr := s.market.GetQuote(ctx, st.providerSym())
		if qerr != nil {
			return nil, qerr
		}
		priceForCalc = quote.PriceKobo
	}

	return estimateFromPrice(*st, req, priceForCalc, s.feeSchedule(ctx))
}

// estimateFromPrice is the pure pricing core (no IO). Mirrors Buy (buy: notional +
// fee; buy-by-amount vs buy-by-quantity) and Sell (sell: qty × price, net = gross −
// fee) with integer kobo math and the same min/max guards.
func estimateFromPrice(st StockAsset, req EstimateRequest, priceForCalc int64, fees FeeSchedule) (*OrderEstimate, error) {
	if priceForCalc <= 0 {
		return nil, ErrInvalidOrder
	}

	var qty float64
	var notional int64
	if req.Side == SideBuy && req.AmountKobo > 0 {
		notional = req.AmountKobo
		qty = float64(req.AmountKobo) / float64(priceForCalc)
	} else {
		if req.Quantity <= 0 {
			return nil, fmt.Errorf("%w: quantity required", ErrInvalidOrder)
		}
		qty = req.Quantity
		notional = int64(qty * float64(priceForCalc))
	}

	if notional < st.MinimumOrderAmount {
		return nil, ErrBelowMinimum
	}
	if st.MaximumOrderAmount > 0 && notional > st.MaximumOrderAmount {
		return nil, ErrAboveMaximum
	}

	fee := fees.FeeFor(notional)
	total := notional + fee // buy: cash the user must have
	if req.Side == SideSell {
		total = notional - fee // sell: net proceeds credited
	}

	return &OrderEstimate{
		Symbol:             st.Symbol,
		Side:               req.Side,
		OrderType:          req.OrderType,
		EstimatedPriceKobo: priceForCalc,
		Quantity:           qty,
		GrossKobo:          notional,
		FeesKobo:           fee,
		TotalKobo:          total,
		CommissionBps:      fees.CommissionBPS,
		MinFeeKobo:         fees.MinFeeKobo,
		MinimumOrderAmount: st.MinimumOrderAmount,
		MaximumOrderAmount: st.MaximumOrderAmount,
		SettlementDays:     st.SettlementDays,
	}, nil
}

// Estimate → POST /stocks/orders/estimate. Read-only order preview (no money move).
func (h *Handler) Estimate(c *gin.Context) {
	var req EstimateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	est, err := h.svc.EstimateOrder(c.Request.Context(), req)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, est)
}
