package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"paymax/crypto-backend/internal/store"
)

// The unified net-worth endpoint sums crypto holdings + stock holdings + cash into
// one figure, with a breakdown and allocation that are internally consistent.
func TestGetNetWorth_AggregatesAllSilos(t *testing.T) {
	s := NewServer(store.New())
	cp := s.S.Portfolio()
	sp := s.Stocks.Portfolio()
	wantTotal := cp.TotalValue.Amount + sp.TotalValue.Amount + cp.InvestableBalance.Amount

	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/portfolio/networth", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}

	var got netWorthResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if got.NetWorth.Amount != wantTotal {
		t.Errorf("netWorth = %d, want %d (crypto+stocks+cash)", got.NetWorth.Amount, wantTotal)
	}
	// Breakdown must sum to the net worth.
	sum := got.Breakdown.Crypto.Amount + got.Breakdown.Stocks.Amount + got.Breakdown.Cash.Amount
	if sum != got.NetWorth.Amount {
		t.Errorf("breakdown sum = %d, want net worth %d", sum, got.NetWorth.Amount)
	}
	// Cash is counted once (from the crypto/ledger wallet), not duplicated.
	if got.Breakdown.Cash.Amount != cp.InvestableBalance.Amount {
		t.Errorf("cash = %d, want %d (single wallet)", got.Breakdown.Cash.Amount, cp.InvestableBalance.Amount)
	}
	// Allocation percentages sum to ~100 when there is any value.
	if wantTotal > 0 {
		allocSum := got.Allocation.CryptoPct + got.Allocation.StocksPct + got.Allocation.CashPct
		if allocSum < 99.0 || allocSum > 101.0 {
			t.Errorf("allocation sums to %.2f, want ~100", allocSum)
		}
	}
	if got.BaseCurrency == "" {
		t.Error("baseCurrency must be set")
	}
}
