package engine

import (
	"math"
	"testing"

	"paymax/crypto-backend/internal/domain"
)

// testAsset is a clean synthetic asset: ₦100.00/coin, 2dp, low risk (50bps spread).
func testAsset() domain.Asset {
	return domain.Asset{
		ID: "ast_tst", Symbol: "TST", Decimals: 2, RiskRating: "low", Status: "active",
		BuyEnabled: true, SellEnabled: true, WithdrawalEnabled: true,
		MinOrderAmount: 1, MaxOrderAmount: 1_000_000_00,
		Price: domain.Money{Amount: 100_00, Currency: "NGN"},
		SupportedNetworks: []domain.Network{
			{ID: "bitcoin", Name: "Bitcoin", Confirmations: 2},
			{ID: "tron", Name: "Tron (TRC-20)", Confirmations: 20},
		},
	}
}

func feeByType(fees []domain.Fee, typ string) int64 {
	for _, f := range fees {
		if f.Type == typ {
			return f.Amount.Amount
		}
	}
	return -1
}

func TestBuildQuoteBuy(t *testing.T) {
	q := BuildQuote(testAsset(), "buy", "crypto", 100, "NGN", true) // buy 1.00 TST

	if q.AllInRate.Amount != 10050 { // 10000 * 1.005
		t.Fatalf("allInRate = %d, want 10050", q.AllInRate.Amount)
	}
	if q.Crypto.Amount != 100 {
		t.Fatalf("crypto = %d, want 100", q.Crypto.Amount)
	}
	if q.Fiat.Amount != 10050 {
		t.Fatalf("tradeFiat = %d, want 10050", q.Fiat.Amount)
	}
	if got := feeByType(q.Fees, "spread"); got != 50 {
		t.Errorf("spread fee = %d, want 50", got)
	}
	if got := feeByType(q.Fees, "paymax_fee"); got != 90 {
		t.Errorf("paymax fee = %d, want 90", got)
	}
	if got := feeByType(q.Fees, "provider_fee"); got != 20 {
		t.Errorf("provider fee = %d, want 20", got)
	}
	if q.TotalFiat.Amount != 10160 { // 10050 + 90 + 20
		t.Fatalf("totalFiat = %d, want 10160", q.TotalFiat.Amount)
	}
	if q.Status != "locked" {
		t.Errorf("status = %q, want locked", q.Status)
	}
}

func TestBuildQuoteSell(t *testing.T) {
	q := BuildQuote(testAsset(), "sell", "crypto", 100, "NGN", false) // sell 1.00 TST

	if q.AllInRate.Amount != 9950 { // 10000 * 0.995
		t.Fatalf("allInRate = %d, want 9950", q.AllInRate.Amount)
	}
	// Sell nets fees out of the proceeds: 9950 - 90 - 20 = 9840.
	if q.TotalFiat.Amount != 9840 {
		t.Fatalf("totalFiat = %d, want 9840", q.TotalFiat.Amount)
	}
	if q.Status != "quoted" {
		t.Errorf("status = %q, want quoted", q.Status)
	}
}

func TestBuildSwapQuote(t *testing.T) {
	from := testAsset()                    // ₦100.00
	to := testAsset()                      // ₦50.00
	to.Symbol, to.ID = "TS2", "ast_ts2"
	to.Price = domain.Money{Amount: 50_00, Currency: "NGN"}

	q := BuildSwapQuote(from, to, 100) // swap 1.00 TST

	if q.FiatValue.Amount != 10000 {
		t.Fatalf("fiatValue = %d, want 10000", q.FiatValue.Amount)
	}
	// netFiat = 10000 * (1 - 0.008) = 9920 ; to = 9920/5000 * 100 = 198.4 -> 198
	if q.To.Amount != 198 {
		t.Fatalf("to = %d, want 198", q.To.Amount)
	}
	if q.Fee.Amount != 30 { // 10000 * 0.003
		t.Fatalf("fee = %d, want 30", q.Fee.Amount)
	}
	if math.Abs(q.Rate-1.98) > 1e-9 {
		t.Errorf("rate = %v, want 1.98", q.Rate)
	}
}

func TestWithdrawalQuote(t *testing.T) {
	a := testAsset()
	q := WithdrawalQuoteFor(a, a.SupportedNetworks[0], 100_000) // 1000.00 TST

	if q.NetworkFee.Amount != 50 { // max(round(100*0.00005), round(100000*0.0005)) = 50
		t.Fatalf("networkFee = %d, want 50", q.NetworkFee.Amount)
	}
	if q.ReceiveAmount.Amount != 99_950 {
		t.Fatalf("receive = %d, want 99950", q.ReceiveAmount.Amount)
	}
	if q.FiatValue.Amount != 10_000_000 { // 1000 * 10000
		t.Fatalf("fiatValue = %d, want 10000000", q.FiatValue.Amount)
	}
	if q.PaymaxFee.Amount != 150_00 {
		t.Fatalf("paymaxFee = %d, want 15000", q.PaymaxFee.Amount)
	}
	if !q.RequiresManualReview {
		t.Error("withdrawal should require manual review (MVP)")
	}
}

func TestDepositAddressDeterministicAndNetworkAware(t *testing.T) {
	a := testAsset()
	btc := DepositAddressFor(a, domain.Network{ID: "bitcoin", Name: "Bitcoin", Confirmations: 2})
	btc2 := DepositAddressFor(a, domain.Network{ID: "bitcoin", Name: "Bitcoin", Confirmations: 2})
	if btc.Address != btc2.Address {
		t.Errorf("deposit address not deterministic: %q vs %q", btc.Address, btc2.Address)
	}
	if len(btc.Address) < 10 || btc.Address[:4] != "bc1q" {
		t.Errorf("bitcoin address prefix wrong: %q", btc.Address)
	}
	if btc.Memo != "" {
		t.Errorf("bitcoin should have no memo, got %q", btc.Memo)
	}
	tron := DepositAddressFor(a, domain.Network{ID: "tron", Name: "Tron (TRC-20)", Confirmations: 20})
	if tron.Memo == "" {
		t.Error("tron deposit should carry a destination memo")
	}
}

func TestChartLength(t *testing.T) {
	a := testAsset()
	cases := map[string]int{"1H": 30, "1D": 24, "1W": 28, "1M": 30, "1Y": 52}
	for rng, want := range cases {
		if got := len(Chart(a, rng)); got != want {
			t.Errorf("Chart(%s) len = %d, want %d", rng, got, want)
		}
	}
}
