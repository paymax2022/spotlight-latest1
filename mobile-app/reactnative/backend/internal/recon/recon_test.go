package recon

import (
	"testing"

	"paymax/crypto-backend/internal/domain"
)

// fakeSource is a hand-built Source for table-free, explicit test fixtures.
type fakeSource struct {
	positions []domain.Position
	txns      []domain.TxSummary
}

func (f fakeSource) Positions() []domain.Position { return f.positions }

func (f fakeSource) Transactions(side string) []domain.TxSummary {
	if side == "" {
		return f.txns
	}
	out := []domain.TxSummary{}
	for _, t := range f.txns {
		if t.Side == side {
			out = append(out, t)
		}
	}
	return out
}

func pos(symbol string, qty int64) domain.Position {
	return domain.Position{Symbol: symbol, Quantity: domain.CryptoAmount{Amount: qty, Symbol: symbol}}
}

func tx(side, symbol, status string, qty int64) domain.TxSummary {
	return domain.TxSummary{Side: side, Symbol: symbol, Status: status, Crypto: domain.CryptoAmount{Amount: qty, Symbol: symbol}}
}

// findAsset returns the AssetRecon for symbol, or false if absent.
func findAsset(rs []AssetRecon, symbol string) (AssetRecon, bool) {
	for _, a := range rs {
		if a.Symbol == symbol {
			return a, true
		}
	}
	return AssetRecon{}, false
}

func TestReconcileBalanced(t *testing.T) {
	// buy 100 + deposit 50 - sell 30 = 120, position holds 120.
	src := fakeSource{
		positions: []domain.Position{pos("BTC", 120)},
		txns: []domain.TxSummary{
			tx("buy", "BTC", "Filled", 100),
			tx("deposit", "BTC", "DepositConfirmed", 50),
			tx("sell", "BTC", "Filled", 30),
		},
	}

	r := Reconcile(src)

	if !r.Balanced {
		t.Fatalf("Balanced = false, want true (exceptions: %+v)", r.Exceptions)
	}
	if len(r.Exceptions) != 0 {
		t.Fatalf("Exceptions = %d, want 0", len(r.Exceptions))
	}
	a, ok := findAsset(r.Assets, "BTC")
	if !ok {
		t.Fatalf("BTC missing from Assets")
	}
	if a.ExpectedQty != 120 || a.ActualQty != 120 || a.Delta != 0 || !a.Balanced {
		t.Fatalf("BTC recon = %+v, want expected=120 actual=120 delta=0 balanced", a)
	}
}

func TestReconcileUnbalanced(t *testing.T) {
	// Expected: buy 100 - withdraw 10 = 90, but position only holds 70 → delta 20.
	src := fakeSource{
		positions: []domain.Position{pos("ETH", 70)},
		txns: []domain.TxSummary{
			tx("buy", "ETH", "Filled", 100),
			tx("withdraw", "ETH", "WithdrawalConfirmed", 10),
		},
	}

	r := Reconcile(src)

	if r.Balanced {
		t.Fatalf("Balanced = true, want false")
	}
	if len(r.Exceptions) != 1 {
		t.Fatalf("Exceptions = %d, want 1", len(r.Exceptions))
	}
	e := r.Exceptions[0]
	if e.Symbol != "ETH" || e.ExpectedQty != 90 || e.ActualQty != 70 || e.Delta != 20 || e.Balanced {
		t.Fatalf("exception = %+v, want symbol=ETH expected=90 actual=70 delta=20 unbalanced", e)
	}
}

func TestReconcileExcludesFailed(t *testing.T) {
	// The failed buy and failed withdrawal must NOT move the expected quantity:
	// expected = buy 100 (Filled) = 100, matching the 100-unit position.
	src := fakeSource{
		positions: []domain.Position{pos("SOL", 100)},
		txns: []domain.TxSummary{
			tx("buy", "SOL", "Filled", 100),
			tx("buy", "SOL", "Failed", 999),
			tx("withdraw", "SOL", "WithdrawalFailed", 40),
		},
	}

	r := Reconcile(src)

	a, ok := findAsset(r.Assets, "SOL")
	if !ok {
		t.Fatalf("SOL missing from Assets")
	}
	if a.ExpectedQty != 100 {
		t.Fatalf("ExpectedQty = %d, want 100 (failed txns must be excluded)", a.ExpectedQty)
	}
	if !r.Balanced || len(r.Exceptions) != 0 {
		t.Fatalf("Balanced = %v exceptions = %d, want true/0", r.Balanced, len(r.Exceptions))
	}
}
