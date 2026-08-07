package invest

import (
	"context"
	"testing"
)

// ── Order state machine ──────────────────────────────────────────────────────

func TestOrderStateMachine_HappyBuyPath(t *testing.T) {
	path := []OrderStatus{
		StatusDraft, StatusPendingReview, StatusAwaitingConfirm, StatusCashLocked,
		StatusSubmitted, StatusAccepted, StatusFilled, StatusPendingSettlement, StatusSettled,
	}
	for i := 0; i+1 < len(path); i++ {
		if !CanTransition(path[i], path[i+1]) {
			t.Fatalf("expected legal transition %s→%s", path[i], path[i+1])
		}
	}
}

func TestOrderStateMachine_IllegalTransitions(t *testing.T) {
	illegal := [][2]OrderStatus{
		{StatusSettled, StatusFilled},      // terminal
		{StatusCancelled, StatusSubmitted}, // terminal
		{StatusDraft, StatusFilled},        // skips locking
		{StatusFilled, StatusCancelled},    // can't cancel a filled order
		{StatusRejected, StatusAccepted},   // terminal
	}
	for _, tc := range illegal {
		if CanTransition(tc[0], tc[1]) {
			t.Errorf("expected ILLEGAL transition %s→%s", tc[0], tc[1])
		}
	}
}

func TestOrderStateMachine_FailReleasesPath(t *testing.T) {
	// A cash-locked order that fails must be able to reach Failed.
	if !CanTransition(StatusCashLocked, StatusFailed) {
		t.Fatal("CashLocked must be able to fail")
	}
	if !CanTransition(StatusFailed, StatusReversalPending) {
		t.Fatal("Failed must be able to start reversal")
	}
}

func TestIsTerminal(t *testing.T) {
	for _, s := range []OrderStatus{StatusSettled, StatusCancelled, StatusRejected, StatusReversed} {
		if !IsTerminal(s) {
			t.Errorf("%s should be terminal", s)
		}
	}
	for _, s := range []OrderStatus{StatusDraft, StatusPendingSettlement, StatusAccepted} {
		if IsTerminal(s) {
			t.Errorf("%s should NOT be terminal", s)
		}
	}
}

// ── Fee engine ───────────────────────────────────────────────────────────────

func TestFeeFor(t *testing.T) {
	f := FeeSchedule{CommissionBPS: 150, MinFeeKobo: 10_000} // 1.5%, ₦100 min
	cases := []struct {
		notional int64
		want     int64
	}{
		{0, 0},
		{100_000, 10_000},     // 1.5% = 1,500 kobo → floored to min 10,000
		{10_000_000, 150_000}, // ₦100,000 → 1.5% = ₦1,500
		{1_000_000, 15_000},   // ₦10,000 → 1.5% = ₦150
	}
	for _, c := range cases {
		if got := f.FeeFor(c.notional); got != c.want {
			t.Errorf("FeeFor(%d) = %d, want %d", c.notional, got, c.want)
		}
	}
}

func TestFeeFor_NeverFloat(t *testing.T) {
	// Integer math only — large notionals must not overflow into float rounding.
	f := DefaultFeeSchedule()
	if got := f.FeeFor(50_000_000_00); got != 50_000_000_00*150/10_000 {
		t.Errorf("unexpected fee %d", got)
	}
}

// ── Suitability scoring ──────────────────────────────────────────────────────

func TestScoreToCategory(t *testing.T) {
	cases := []struct {
		score int
		want  RiskCategory
	}{
		{0, RiskRestricted}, {4, RiskRestricted},
		{5, RiskConservative}, {9, RiskConservative},
		{10, RiskBalanced}, {15, RiskBalanced},
		{16, RiskGrowth}, {20, RiskGrowth},
		{21, RiskAggressive}, {99, RiskAggressive},
	}
	for _, c := range cases {
		if got := scoreToCategory(c.score); got != c.want {
			t.Errorf("scoreToCategory(%d) = %s, want %s", c.score, got, c.want)
		}
	}
}

func TestCategoryEligibility_RestrictedIsEducationOnly(t *testing.T) {
	elig := categoryEligibility(RiskRestricted)
	if len(elig) != 1 || elig[0] != "education_only" {
		t.Errorf("restricted must be education-only, got %v", elig)
	}
}

// ── PIN verifier (mock) ──────────────────────────────────────────────────────

func TestMockPINVerifier(t *testing.T) {
	v := MockPINVerifier{}
	ctx := context.Background()
	if err := v.Verify(ctx, "u1", "1234"); err != nil {
		t.Errorf("4-digit numeric PIN should pass: %v", err)
	}
	for _, bad := range []string{"", "12", "12345678", "abcd", "12a4"} {
		if err := v.Verify(ctx, "u1", bad); err == nil {
			t.Errorf("PIN %q should be rejected", bad)
		}
	}
}

// ── Mock market data determinism ─────────────────────────────────────────────

func TestMockMarketData_Deterministic(t *testing.T) {
	m := NewMockMarketData()
	ctx := context.Background()
	q1, err := m.GetQuote(ctx, "DANGCEM")
	if err != nil {
		t.Fatal(err)
	}
	q2, _ := m.GetQuote(ctx, "DANGCEM")
	if q1.PriceKobo != q2.PriceKobo {
		t.Errorf("quotes must be stable within an hour: %d vs %d", q1.PriceKobo, q2.PriceKobo)
	}
	if q1.PriceKobo <= 0 {
		t.Errorf("price must be positive, got %d", q1.PriceKobo)
	}
	if q1.DataStatus != "delayed" {
		t.Errorf("mock data must be labelled delayed, got %q", q1.DataStatus)
	}
	// Different symbols should (almost always) differ.
	qOther, _ := m.GetQuote(ctx, "MTNN")
	if qOther.PriceKobo == q1.PriceKobo {
		t.Logf("warning: symbol price collision (acceptable but rare)")
	}
}

func TestMockMarketData_ForceStatus(t *testing.T) {
	m := NewMockMarketData()
	m.SetForceStatus("open")
	if s, _ := m.GetMarketStatus(context.Background()); s != "open" {
		t.Errorf("forced status should be open, got %q", s)
	}
}

// ── Mock broker fills ────────────────────────────────────────────────────────

func TestMockBroker_MarketBuyFills(t *testing.T) {
	b := NewMockBroker()
	q := Quote{Symbol: "X", PriceKobo: 50_000}
	o := Order{Symbol: "X", Side: SideBuy, OrderType: TypeMarket, AmountKobo: 1_000_000}
	res, err := b.SubmitBuyOrder(context.Background(), o, q)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Accepted || res.Status != "filled" {
		t.Fatalf("market buy should fill, got %+v", res)
	}
	if res.ProviderReference == "" {
		t.Error("every order must carry a provider reference")
	}
	if res.FilledQuantity <= 0 {
		t.Error("filled quantity should be positive")
	}
}

// ── Price-alert evaluation ───────────────────────────────────────────────────

func TestAlertHit(t *testing.T) {
	q := Quote{PriceKobo: 5_000_00, DayChangePct: 6.0} // ₦5,000, +6% today
	cases := []struct {
		cond   string
		target int64
		want   bool
	}{
		{"above", 4_900_00, true},  // price >= target
		{"above", 5_100_00, false}, // price < target
		{"below", 5_100_00, true},  // price <= target
		{"below", 4_900_00, false}, // price > target
		{"pct_gain", 500, true},    // +6% >= 5.00%
		{"pct_gain", 700, false},   // +6% < 7.00%
		{"pct_loss", 500, false},   // not a loss
	}
	for _, c := range cases {
		got := alertHit(PriceAlert{Condition: c.cond, TargetPriceKobo: c.target}, q)
		if got != c.want {
			t.Errorf("alertHit(%s, %d) = %v, want %v", c.cond, c.target, got, c.want)
		}
	}
}

func TestAlertHit_LossCondition(t *testing.T) {
	q := Quote{PriceKobo: 4_700_00, DayChangePct: -8.0}
	if !alertHit(PriceAlert{Condition: "pct_loss", TargetPriceKobo: 500}, q) {
		t.Error("expected pct_loss alert to fire at -8% with 5% threshold")
	}
	if alertHit(PriceAlert{Condition: "pct_loss", TargetPriceKobo: 900}, q) {
		t.Error("did not expect pct_loss alert to fire at -8% with 9% threshold")
	}
}

func TestLogNotifier(t *testing.T) {
	if err := (LogNotifier{}).AlertTriggered(context.Background(), "u1", "MTNN", "test"); err != nil {
		t.Errorf("LogNotifier should not error: %v", err)
	}
}

func TestMockBroker_LimitBuyRestsWhenNotMarketable(t *testing.T) {
	b := NewMockBroker()
	q := Quote{Symbol: "X", PriceKobo: 50_000}
	o := Order{Symbol: "X", Side: SideBuy, OrderType: TypeLimit, Quantity: 10, LimitPriceKobo: 40_000}
	res, _ := b.SubmitBuyOrder(context.Background(), o, q)
	if res.Status == "filled" {
		t.Error("a below-market limit buy should not fill immediately")
	}
	if !res.Accepted {
		t.Error("a resting limit order should still be accepted")
	}
}
