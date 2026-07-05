// Package recon reconciles the holdings implied by transaction history against
// the holdings recorded in the portfolio positions. A divergence (delta != 0)
// means the ledger and the position store disagree for a symbol — an admin-only
// signal that something needs investigation (missed event, double-credit, etc.).
//
// It deliberately depends only on a tiny read interface (Source) rather than the
// whole store.Repository: store.Repository satisfies Source structurally, so the
// HTTP layer can pass its repo straight in without this package importing store.
package recon

import (
	"sort"
	"time"

	"paymax/crypto-backend/internal/domain"
)

// Source is the minimal read surface recon needs. store.Repository satisfies it
// structurally (same method set), so callers pass their repository directly.
type Source interface {
	Positions() []domain.Position
	Transactions(side string) []domain.TxSummary
}

// AssetRecon is the reconciliation outcome for a single symbol.
type AssetRecon struct {
	Symbol      string `json:"symbol"`
	ExpectedQty int64  `json:"expectedQty"`
	ActualQty   int64  `json:"actualQty"`
	Delta       int64  `json:"delta"`
	Balanced    bool   `json:"balanced"`
}

// Report is the full reconciliation snapshot across every known symbol.
type Report struct {
	GeneratedAt string       `json:"generatedAt"`
	Balanced    bool         `json:"balanced"`
	Assets      []AssetRecon `json:"assets"`
	Exceptions  []AssetRecon `json:"exceptions"`
}

// Reconcile sums the crypto deltas implied by transaction history per symbol and
// compares them against the live position quantities.
//
// Sign convention: "buy"/"deposit" add to a holding, "sell"/"withdraw" subtract.
// Failed/reversed transactions ("Failed", "WithdrawalFailed") are excluded — they
// never moved a balance (or were re-credited). Every other status is counted,
// including pending withdrawals: in this system's model a withdrawal debits the
// holding when submitted (and is only re-credited on explicit reversal), so a
// pending/under-review withdrawal is already reflected in the expected quantity.
func Reconcile(src Source) Report {
	expected := map[string]int64{}
	for _, tx := range src.Transactions("") {
		if tx.Status == "Failed" || tx.Status == "WithdrawalFailed" {
			continue
		}
		switch tx.Side {
		case "buy", "deposit":
			expected[tx.Symbol] += tx.Crypto.Amount
		case "sell", "withdraw":
			expected[tx.Symbol] -= tx.Crypto.Amount
		}
	}

	actual := map[string]int64{}
	for _, p := range src.Positions() {
		actual[p.Symbol] += p.Quantity.Amount
	}

	// Union of every symbol seen in either the ledger or the positions.
	seen := map[string]bool{}
	for sym := range expected {
		seen[sym] = true
	}
	for sym := range actual {
		seen[sym] = true
	}

	report := Report{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Balanced:    true,
	}
	for sym := range seen {
		exp := expected[sym]
		act := actual[sym]
		ar := AssetRecon{
			Symbol:      sym,
			ExpectedQty: exp,
			ActualQty:   act,
			Delta:       exp - act,
		}
		ar.Balanced = ar.Delta == 0
		report.Assets = append(report.Assets, ar)
		if !ar.Balanced {
			report.Balanced = false
			report.Exceptions = append(report.Exceptions, ar)
		}
	}

	// Deterministic ordering for stable output and tests.
	sort.Slice(report.Assets, func(i, j int) bool {
		return report.Assets[i].Symbol < report.Assets[j].Symbol
	})
	sort.Slice(report.Exceptions, func(i, j int) bool {
		return report.Exceptions[i].Symbol < report.Exceptions[j].Symbol
	})

	return report
}
