package stocks

import "testing"

// synthetic returns a clean stock for exact arithmetic in the estimate tests:
// price ₦1,000.00 (100000 minor), feeBps 25, provider 10, generous limits, open.
func synthetic() Stock {
	return Stock{
		ID: "stk_syn", Type: "stock", Symbol: "SYN", Name: "Synthetic Plc",
		Exchange: "NGX", Sector: "Test", Currency: "NGN",
		RiskRating: "low", Status: "active",
		BuyEnabled: true, SellEnabled: true, MarketStatus: "open",
		Price:           Money{Amount: 100_000, Currency: "NGN"},
		FeeBps:          25,
		SettlementCycle: "T+3",
		MinOrderAmount:  100_000,
		MaxOrderAmount:  100_000_000,
	}
}

func TestBuildEstimate(t *testing.T) {
	s := synthetic()
	tests := []struct {
		name       string
		side       string
		orderType  string
		qty        int64
		limit      int64
		wantGross  int64
		wantComm   int64
		wantProv   int64
		wantTotal  int64
		wantHasLim bool
	}{
		// gross = 100000*10 = 1_000_000; comm = 2500; prov = 1000; total buy = 1_003_500
		{"buy market", "buy", "market", 10, 0, 1_000_000, 2_500, 1_000, 1_003_500, false},
		// sell: total = gross - fees = 1_000_000 - 3500 = 996_500
		{"sell market", "sell", "market", 10, 0, 1_000_000, 2_500, 1_000, 996_500, false},
		// limit uses limitPrice 90000: gross = 900_000; comm = 2250; prov = 900; total = 903_150
		{"buy limit", "buy", "limit", 10, 90_000, 900_000, 2_250, 900, 903_150, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			est := BuildEstimate(s, tc.side, tc.orderType, tc.qty, tc.limit)
			if est.Gross.Amount != tc.wantGross {
				t.Errorf("gross = %d, want %d", est.Gross.Amount, tc.wantGross)
			}
			if len(est.Fees) != 2 {
				t.Fatalf("fees len = %d, want 2", len(est.Fees))
			}
			if est.Fees[0].Type != "commission" || est.Fees[0].Amount.Amount != tc.wantComm {
				t.Errorf("commission = %+v, want %d", est.Fees[0], tc.wantComm)
			}
			if est.Fees[1].Type != "provider_fee" || est.Fees[1].Amount.Amount != tc.wantProv {
				t.Errorf("provider_fee = %+v, want %d", est.Fees[1], tc.wantProv)
			}
			if est.Total.Amount != tc.wantTotal {
				t.Errorf("total = %d, want %d", est.Total.Amount, tc.wantTotal)
			}
			if tc.wantHasLim && est.LimitPrice == nil {
				t.Errorf("expected limitPrice to be set")
			}
			if !tc.wantHasLim && est.LimitPrice != nil {
				t.Errorf("expected limitPrice to be nil, got %+v", est.LimitPrice)
			}
			if est.SettlementCycle != "T+3" {
				t.Errorf("settlementCycle = %q, want T+3", est.SettlementCycle)
			}
		})
	}
}

func TestPlaceOrderMarketFill(t *testing.T) {
	svc := NewService()
	o, err := svc.PlaceOrder(OrderDraft{
		AssetID: "stk_dangcem", Symbol: "DANGCEM", Side: "buy", OrderType: "market", Quantity: 10,
	}, "idem-mkt-1")
	if err != nil {
		t.Fatalf("unexpected error: %+v", err)
	}
	if o.Status != "Filled" {
		t.Errorf("status = %q, want Filled", o.Status)
	}
	if o.FilledQuantity != 10 {
		t.Errorf("filledQuantity = %d, want 10", o.FilledQuantity)
	}
	if o.SettlementDate == "" {
		t.Errorf("expected settlementDate to be set for a market fill")
	}
	// Persisted into Orders().
	found := false
	for _, x := range svc.Orders("") {
		if x.ID == o.ID {
			found = true
		}
	}
	if !found {
		t.Errorf("placed order not found in Orders()")
	}
}

func TestPlaceOrderLimitSubmitted(t *testing.T) {
	svc := NewService()
	o, err := svc.PlaceOrder(OrderDraft{
		AssetID: "stk_dangcem", Symbol: "DANGCEM", Side: "buy", OrderType: "limit", Quantity: 10, LimitPrice: 48_000,
	}, "idem-lim-1")
	if err != nil {
		t.Fatalf("unexpected error: %+v", err)
	}
	if o.Status != "Submitted" {
		t.Errorf("status = %q, want Submitted", o.Status)
	}
	if o.FilledQuantity != 0 {
		t.Errorf("filledQuantity = %d, want 0", o.FilledQuantity)
	}
	if o.LimitPrice == nil || o.LimitPrice.Amount != 48_000 {
		t.Errorf("limitPrice = %+v, want 48000", o.LimitPrice)
	}
}

func TestPlaceOrderPreTradeRejects(t *testing.T) {
	t.Run("market_closed", func(t *testing.T) {
		svc := NewService()
		// NESTLE is paused + market closed.
		_, err := svc.PlaceOrder(OrderDraft{
			AssetID: "stk_nestle", Symbol: "NESTLE", Side: "buy", OrderType: "market", Quantity: 1,
		}, "")
		if err == nil || err.Type != "market_closed" {
			t.Fatalf("err = %+v, want type market_closed", err)
		}
	})

	t.Run("insufficient_balance", func(t *testing.T) {
		svc := NewService()
		// DANGCEM @ ₦485.50 → 50,000 shares ≈ ₦24.275m gross + fees > ₦1.25m investable,
		// but still within max ₦50m so it trips the balance check, not the limit check.
		_, err := svc.PlaceOrder(OrderDraft{
			AssetID: "stk_dangcem", Symbol: "DANGCEM", Side: "buy", OrderType: "market", Quantity: 50_000,
		}, "")
		if err == nil || err.Type != "insufficient_balance" {
			t.Fatalf("err = %+v, want type insufficient_balance", err)
		}
	})

	t.Run("limit_exceeded", func(t *testing.T) {
		svc := NewService()
		// 1 share of DANGCEM = ₦485.50 gross < min ₦1,000 → below limit.
		_, err := svc.PlaceOrder(OrderDraft{
			AssetID: "stk_dangcem", Symbol: "DANGCEM", Side: "buy", OrderType: "market", Quantity: 1,
		}, "")
		if err == nil || err.Type != "limit_exceeded" {
			t.Fatalf("err = %+v, want type limit_exceeded", err)
		}
	})
}

func TestPlaceOrderIdempotencyReplay(t *testing.T) {
	svc := NewService()
	draft := OrderDraft{AssetID: "stk_dangcem", Symbol: "DANGCEM", Side: "buy", OrderType: "market", Quantity: 10}
	first, err := svc.PlaceOrder(draft, "idem-replay")
	if err != nil {
		t.Fatalf("unexpected error: %+v", err)
	}
	second, err := svc.PlaceOrder(draft, "idem-replay")
	if err != nil {
		t.Fatalf("unexpected error on replay: %+v", err)
	}
	if first.ID != second.ID || first.Reference != second.Reference {
		t.Errorf("idempotency replay returned a different order: %s/%s vs %s/%s",
			first.ID, first.Reference, second.ID, second.Reference)
	}
	// Only one order should have been persisted for the key.
	count := 0
	for _, o := range svc.Orders("") {
		if o.IdempotencyKey == "idem-replay" {
			count++
		}
	}
	if count != 1 {
		t.Errorf("persisted %d orders for the idempotency key, want 1", count)
	}
}

func TestCancelOrderTransitions(t *testing.T) {
	svc := NewService()
	// so_3 (ARADEL limit) is Submitted → cancellable.
	o, ok := svc.CancelOrder("so_3")
	if !ok {
		t.Fatalf("expected so_3 to be cancellable")
	}
	if o.Status != "Cancelled" {
		t.Errorf("status = %q, want Cancelled", o.Status)
	}
	last := o.StatusHistory[len(o.StatusHistory)-1]
	if last.Status != "Cancelled" {
		t.Errorf("last history = %q, want Cancelled", last.Status)
	}
	if o.FailureReason == "" {
		t.Errorf("expected a cancellation failureReason")
	}

	// so_1 (DANGCEM) is already Filled → not cancellable.
	if _, ok := svc.CancelOrder("so_1"); ok {
		t.Errorf("expected Filled order so_1 to not be cancellable")
	}
}

func TestApplyToOffer(t *testing.T) {
	svc := NewService()
	// of_1 GREENTECH is open, minUnits 1000.
	o, err := svc.ApplyToOffer("of_1", 1_000, "idem-offer-1")
	if err != nil {
		t.Fatalf("unexpected error: %+v", err)
	}
	if o.Status != "Submitted" {
		t.Errorf("status = %q, want Submitted", o.Status)
	}
	// gross = priceHigh (2200) * 1000 = 2_200_000
	if o.Gross.Amount != 2_200_000 {
		t.Errorf("gross = %d, want 2200000", o.Gross.Amount)
	}

	// Below min units → limit_exceeded.
	if _, err := svc.ApplyToOffer("of_1", 10, ""); err == nil || err.Type != "limit_exceeded" {
		t.Fatalf("err = %+v, want type limit_exceeded", err)
	}
	// Not open (of_2 is upcoming) → limit_exceeded.
	if _, err := svc.ApplyToOffer("of_2", 100, ""); err == nil || err.Type != "limit_exceeded" {
		t.Fatalf("err = %+v, want type limit_exceeded", err)
	}
}
