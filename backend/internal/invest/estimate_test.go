package invest

import (
	"errors"
	"testing"
)

// estimateFromPrice is the pure pricing core behind POST /stocks/orders/estimate.
// These tests pin the money math (integer kobo) and the min/max/fee-floor guards,
// and prove the preview mirrors Buy/Sell (buy = gross+fee debit; sell = gross−fee net).
func TestEstimateFromPrice(t *testing.T) {
	fees := DefaultFeeSchedule() // 1.5% (150 bps), ₦100 (10_000 kobo) floor
	asset := func() StockAsset {
		return StockAsset{Symbol: "GTCO", MinimumOrderAmount: 0, MaximumOrderAmount: 0, SettlementDays: 3}
	}
	const price = int64(25_000) // ₦250.00 per share

	t.Run("buy by amount resolves qty and adds fee (floor applies)", func(t *testing.T) {
		est, err := estimateFromPrice(asset(), EstimateRequest{Side: SideBuy, OrderType: TypeMarket, AmountKobo: 100_000}, price, fees)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if est.GrossKobo != 100_000 {
			t.Errorf("gross = %d, want 100000", est.GrossKobo)
		}
		if est.Quantity != 4.0 { // 100_000 / 25_000
			t.Errorf("qty = %v, want 4.0", est.Quantity)
		}
		if est.FeesKobo != 10_000 { // 1.5% of 100_000 = 1_500 < floor → 10_000
			t.Errorf("fees = %d, want 10000 (floor)", est.FeesKobo)
		}
		if est.TotalKobo != 110_000 { // buy debit = gross + fee
			t.Errorf("total = %d, want 110000 (gross+fee)", est.TotalKobo)
		}
		if est.SettlementDays != 3 {
			t.Errorf("settlement days = %d, want 3", est.SettlementDays)
		}
	})

	t.Run("buy by quantity uses percentage fee above the floor", func(t *testing.T) {
		est, err := estimateFromPrice(asset(), EstimateRequest{Side: SideBuy, OrderType: TypeMarket, Quantity: 40}, price, fees)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if est.GrossKobo != 1_000_000 { // 40 * 25_000
			t.Errorf("gross = %d, want 1000000", est.GrossKobo)
		}
		if est.FeesKobo != 15_000 { // 1.5% of 1_000_000 = 15_000 > floor
			t.Errorf("fees = %d, want 15000 (1.5%%)", est.FeesKobo)
		}
		if est.TotalKobo != 1_015_000 {
			t.Errorf("total = %d, want 1015000", est.TotalKobo)
		}
	})

	t.Run("sell nets proceeds (gross minus fee)", func(t *testing.T) {
		est, err := estimateFromPrice(asset(), EstimateRequest{Side: SideSell, OrderType: TypeMarket, Quantity: 4}, price, fees)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if est.GrossKobo != 100_000 {
			t.Errorf("gross = %d, want 100000", est.GrossKobo)
		}
		if est.TotalKobo != 90_000 { // sell proceeds = gross − fee (10_000 floor)
			t.Errorf("total = %d, want 90000 (gross−fee)", est.TotalKobo)
		}
	})

	t.Run("below minimum is rejected", func(t *testing.T) {
		st := asset()
		st.MinimumOrderAmount = 200_000
		_, err := estimateFromPrice(st, EstimateRequest{Side: SideBuy, OrderType: TypeMarket, AmountKobo: 100_000}, price, fees)
		if !errors.Is(err, ErrBelowMinimum) {
			t.Fatalf("err = %v, want ErrBelowMinimum", err)
		}
	})

	t.Run("above maximum is rejected", func(t *testing.T) {
		st := asset()
		st.MaximumOrderAmount = 50_000
		_, err := estimateFromPrice(st, EstimateRequest{Side: SideBuy, OrderType: TypeMarket, AmountKobo: 100_000}, price, fees)
		if !errors.Is(err, ErrAboveMaximum) {
			t.Fatalf("err = %v, want ErrAboveMaximum", err)
		}
	})

	t.Run("sell without quantity is rejected", func(t *testing.T) {
		_, err := estimateFromPrice(asset(), EstimateRequest{Side: SideSell, OrderType: TypeMarket}, price, fees)
		if !errors.Is(err, ErrInvalidOrder) {
			t.Fatalf("err = %v, want ErrInvalidOrder", err)
		}
	})

	t.Run("non-positive price is rejected", func(t *testing.T) {
		_, err := estimateFromPrice(asset(), EstimateRequest{Side: SideBuy, OrderType: TypeMarket, AmountKobo: 100_000}, 0, fees)
		if !errors.Is(err, ErrInvalidOrder) {
			t.Fatalf("err = %v, want ErrInvalidOrder", err)
		}
	})
}
