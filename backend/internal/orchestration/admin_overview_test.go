package orchestration

import (
	"math"
	"testing"
	"time"
)

func TestBuildAdminOverviewAggregatesWindow(t *testing.T) {
	defer overrideMidRates(t)()

	rows := []overviewRow{
		{kind: "conversion", provider: "eversend", corridor: "USD-NGN", currency: "USD", amount: 1_000_00, status: "settled", spread: 10_00},
		{kind: "transfer", provider: "vertofx", corridor: "USD-NGN", currency: "USD", amount: 500_00, status: "paid", spread: 5_00},
		{kind: "transfer", provider: "eversend", corridor: "USD-XAF", currency: "USD", amount: 100_00, status: "failed", spread: 1_00},
		{kind: "transfer", provider: "eversend", corridor: "USD-GHS", currency: "USD", amount: 50_00, status: "reversed", spread: 52},
		{kind: "conversion", provider: "vertofx", corridor: "NGN-USD", currency: "NGN", amount: 1_600_000_00, status: "pending"},
		{kind: "collection", provider: "eversend", currency: "USD", amount: 1_200_00},
	}
	now := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)

	got := buildAdminOverview(rows, nil, now)

	if got.TxCount24h != 6 {
		t.Fatalf("TxCount24h = %d, want 6", got.TxCount24h)
	}
	// 1000+500+100+50+1200 USD plus 1,600,000 NGN at the pinned 1598.2 mid.
	wantGMV := int64(285_000 + 100_113)
	if got.GMVUsdCents != wantGMV {
		t.Fatalf("GMVUsdCents = %d, want %d", got.GMVUsdCents, wantGMV)
	}
	// Margin is only recognised on settled rows: 10.00 + 5.00. The failed row's
	// 1.00 spread is not revenue.
	if got.MarginUsdCents != 15_00 {
		t.Fatalf("MarginUsdCents = %d, want 1500", got.MarginUsdCents)
	}
	if got.SuccessRate == nil || got.FailureRate == nil {
		t.Fatalf("rates = %v/%v, want both set", got.SuccessRate, got.FailureRate)
	}
	if *got.SuccessRate != 50 || *got.FailureRate != 50 {
		t.Fatalf("rates = %v/%v, want 50/50 (2 settled, 1 failed, 1 reversed)", *got.SuccessRate, *got.FailureRate)
	}
	if got.ReconBreaks != nil || got.OpenIncidents != nil {
		t.Fatalf("recon/incidents = %v/%v, want nil (no backend source)", got.ReconBreaks, got.OpenIncidents)
	}
	if len(got.Breakers) != 0 {
		t.Fatalf("breakers = %v, want empty", got.Breakers)
	}

	if len(got.ProviderMix) != 2 {
		t.Fatalf("providerMix = %v, want 2 rows", got.ProviderMix)
	}
	if got.ProviderMix[0].Provider != "eversend" || got.ProviderMix[0].VolumeUsdCents != 235_000 {
		t.Fatalf("providerMix[0] = %+v, want eversend/235000", got.ProviderMix[0])
	}
	if math.Abs(got.ProviderMix[0].Share-61.0) > 0.05 {
		t.Fatalf("eversend share = %v, want ~61.0", got.ProviderMix[0].Share)
	}

	if len(got.TopCorridors) != 4 {
		t.Fatalf("topCorridors = %v, want 4", got.TopCorridors)
	}
	first := got.TopCorridors[0]
	if first.Corridor != "USD-NGN" || first.VolumeUsdCents != 150_000 || first.MarginUsdCents != 15_00 {
		t.Fatalf("topCorridors[0] = %+v, want USD-NGN/150000/1500", first)
	}
	if first.SuccessRate == nil || *first.SuccessRate != 100 {
		t.Fatalf("USD-NGN successRate = %v, want 100", first.SuccessRate)
	}
	// The pending NGN conversion has volume but no terminal outcome.
	if pending := got.TopCorridors[1]; pending.Corridor != "NGN-USD" || pending.SuccessRate != nil {
		t.Fatalf("topCorridors[1] = %+v, want NGN-USD with nil successRate", pending)
	}
}

func TestBuildAdminOverviewEmptyWindow(t *testing.T) {
	got := buildAdminOverview(nil, nil, time.Now())

	if got.GMVUsdCents != 0 || got.TxCount24h != 0 || got.MarginUsdCents != 0 {
		t.Fatalf("empty window produced money: %+v", got)
	}
	if got.SuccessRate != nil || got.FailureRate != nil {
		t.Fatalf("rates = %v/%v, want nil with no terminal rows", got.SuccessRate, got.FailureRate)
	}
	if got.FloatHealthPct != nil {
		t.Fatalf("floatHealthPct = %v, want nil with no buckets", *got.FloatHealthPct)
	}
	// Slices must marshal as [] — the console maps over them.
	if got.ProviderMix == nil || got.TopCorridors == nil || got.Breakers == nil {
		t.Fatalf("nil slices in payload: %+v", got)
	}
}

func TestBuildAdminOverviewUnpricedCurrency(t *testing.T) {
	rows := []overviewRow{
		{kind: "transfer", provider: "eversend", corridor: "XYZ-USD", currency: "XYZ", amount: 500_00, status: "paid"},
	}
	got := buildAdminOverview(rows, nil, time.Now())

	if got.UnpricedRows != 1 {
		t.Fatalf("UnpricedRows = %d, want 1", got.UnpricedRows)
	}
	if got.GMVUsdCents != 0 {
		t.Fatalf("GMVUsdCents = %d, want 0 (no USD rate for XYZ)", got.GMVUsdCents)
	}
	if got.TxCount24h != 1 {
		t.Fatalf("TxCount24h = %d, want 1", got.TxCount24h)
	}
}

func TestBuildAdminOverviewFloatHealth(t *testing.T) {
	buckets := []FloatBucket{
		{Provider: "eversend", Currency: "USD", BalanceMinor: 820_000_00, LowWaterMinor: 200_000_00},
		{Provider: "eversend", Currency: "NGN", BalanceMinor: 100_000_00, LowWaterMinor: 250_000_00},
		{Provider: "vertofx", Currency: "USD", BalanceMinor: 600_000_00, LowWaterMinor: 150_000_00},
	}
	got := buildAdminOverview(nil, buckets, time.Now())

	if got.FloatBuckets != 3 || got.FloatBelowLow != 1 {
		t.Fatalf("float = %d buckets / %d below, want 3/1", got.FloatBuckets, got.FloatBelowLow)
	}
	if got.FloatHealthPct == nil || math.Abs(*got.FloatHealthPct-66.7) > 0.05 {
		t.Fatalf("floatHealthPct = %v, want 66.7", got.FloatHealthPct)
	}
}

// overrideMidRates pins the USD mid table for the test and returns a restore func,
// so assertions on USD-equivalents do not depend on production rate values.
func overrideMidRates(t *testing.T) func() {
	t.Helper()
	orig := baseUSDRates
	baseUSDRates = map[string]float64{"USD": 1, "NGN": 1598.20}
	return func() { baseUSDRates = orig }
}
