package wallet

import (
	"testing"
	"time"
)

// TestProjectRunningBalance pins the running-balance projection behind
// GET /campaigns/:id/ledger: entries must accumulate oldest→newest, be signed
// (+contribution / −withdrawal), and the response is newest-first. A wrong
// accumulation would show the creator a balance that never existed.
func TestProjectRunningBalance(t *testing.T) {
	base := time.Date(2027, 1, 1, 12, 0, 0, 0, time.UTC)
	raw := []rawEntry{
		{id: "c1", typ: "CONTRIBUTION", description: "backer one", amountKobo: 100_000, reference: "r1", status: "POSTED", createdAt: base},
		{id: "c2", typ: "CONTRIBUTION", description: "backer two", amountKobo: 50_000, reference: "r2", status: "POSTED", createdAt: base.Add(time.Hour)},
		{id: "w1", typ: "WITHDRAWAL", description: "payout", amountKobo: -60_000, reference: "r3", status: "POSTED", createdAt: base.Add(2 * time.Hour)},
	}
	out := projectRunningBalance(raw)
	if len(out) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(out))
	}
	// Newest-first ordering.
	if out[0].ID != "w1" || out[2].ID != "c1" {
		t.Fatalf("expected newest-first ordering, got %s,%s,%s", out[0].ID, out[1].ID, out[2].ID)
	}
	// Running balances: 100k → 150k → 90k.
	if out[2].BalanceKobo != 100_000 || out[1].BalanceKobo != 150_000 || out[0].BalanceKobo != 90_000 {
		t.Fatalf("running balances wrong: %d,%d,%d", out[2].BalanceKobo, out[1].BalanceKobo, out[0].BalanceKobo)
	}
	// Amounts stay signed and integer-kobo.
	if out[0].AmountKobo != -60_000 {
		t.Fatalf("withdrawal amount must be negative, got %d", out[0].AmountKobo)
	}
}
