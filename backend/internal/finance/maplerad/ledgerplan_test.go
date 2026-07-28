package maplerad

import (
	"testing"

	"spotlight/backend/internal/finance/ledger"
)

const (
	tAmount = int64(500_000) // ₦5,000
	tFee    = int64(2_500)   // ₦25
	tTotal  = tAmount + tFee
	tRef    = "mpl-xfer-1"
)

// Hold debits the wallet by the full total into suspense.
func TestPlanHold_Legs(t *testing.T) {
	legs := PlanHold(tRef, tTotal)
	if len(legs) != 1 {
		t.Fatalf("hold: want 1 leg, got %d", len(legs))
	}
	l := legs[0]
	if l.Kind != LegJournal || !l.DebitIsUserWallet ||
		l.DebitAccount != ledger.AccountUserWallet ||
		l.CreditAccount != ledger.AccountFailedTransferSusp ||
		l.AmountKobo != tTotal {
		t.Errorf("hold leg wrong: %+v", l)
	}
	if got := NetEffectKobo(legs); got != -tTotal {
		t.Errorf("hold net wallet effect = %d, want %d", got, -tTotal)
	}
}

// Finalize sweeps suspense → settlement (+fee → revenue); zero wallet effect.
func TestPlanFinalize_WithFee(t *testing.T) {
	legs := PlanFinalize(tRef, tAmount, tFee)
	if len(legs) != 2 {
		t.Fatalf("finalize w/fee: want 2 legs, got %d", len(legs))
	}
	settle := legs[0]
	if settle.DebitAccount != ledger.AccountFailedTransferSusp ||
		settle.CreditAccount != ledger.AccountSettlement || settle.AmountKobo != tAmount {
		t.Errorf("settle leg wrong: %+v", settle)
	}
	fee := legs[1]
	if fee.DebitAccount != ledger.AccountFailedTransferSusp ||
		fee.CreditAccount != ledger.AccountPaymaxRevenue || fee.AmountKobo != tFee {
		t.Errorf("fee leg wrong: %+v", fee)
	}
	// The two legs together drain exactly the held total out of suspense.
	if settle.AmountKobo+fee.AmountKobo != tTotal {
		t.Errorf("finalize drains %d from suspense, want held total %d", settle.AmountKobo+fee.AmountKobo, tTotal)
	}
	if got := NetEffectKobo(legs); got != 0 {
		t.Errorf("finalize must not touch wallet, net=%d", got)
	}
}

func TestPlanFinalize_NoFee(t *testing.T) {
	legs := PlanFinalize(tRef, tAmount, 0)
	if len(legs) != 1 {
		t.Fatalf("finalize no-fee: want 1 leg, got %d", len(legs))
	}
}

// Hold then fail restores the wallet exactly (net 0 across the pair).
func TestHoldThenFail_RestoresExactly(t *testing.T) {
	hold := PlanHold(tRef, tTotal)
	rev := PlanReverseHold(tRef, tTotal)
	r := rev[0]
	if r.Kind != LegReversalPair || !r.RestoreIsUserWallet ||
		r.RestoreAccount != ledger.AccountUserWallet ||
		r.ReleaseAccount != ledger.AccountFailedTransferSusp || r.AmountKobo != tTotal {
		t.Errorf("reverse-hold leg wrong: %+v", r)
	}
	net := NetEffectKobo(hold) + NetEffectKobo(rev)
	if net != 0 {
		t.Errorf("hold+fail net wallet effect = %d, want 0 (restored exactly)", net)
	}
}

// Hold then success nets to -total on the wallet (money genuinely left).
func TestHoldThenSuccess_NetsCorrectly(t *testing.T) {
	hold := PlanHold(tRef, tTotal)
	fin := PlanFinalize(tRef, tAmount, tFee)
	net := NetEffectKobo(hold) + NetEffectKobo(fin)
	if net != -tTotal {
		t.Errorf("hold+success net wallet effect = %d, want %d", net, -tTotal)
	}
}

// Compensate (settled-then-reversed) restores the wallet from settlement.
func TestPlanCompensate_RestoresFromSettlement(t *testing.T) {
	legs := PlanCompensate(tRef, tTotal)
	l := legs[0]
	if l.Kind != LegReversalPair || l.ReleaseAccount != ledger.AccountSettlement ||
		!l.RestoreIsUserWallet {
		t.Errorf("compensate leg wrong: %+v", l)
	}
	if got := NetEffectKobo(legs); got != tTotal {
		t.Errorf("compensate net wallet effect = %d, want %d", got, tTotal)
	}
}

// Every leg across every plan carries a distinct idempotency key (per-leg keying
// is what makes a duplicate webhook a benign no-op at the ledger unique index).
func TestPlannedLegs_DistinctIdempotencyKeys(t *testing.T) {
	var all []PlannedLeg
	all = append(all, PlanHold(tRef, tTotal)...)
	all = append(all, PlanFinalize(tRef, tAmount, tFee)...)
	all = append(all, PlanReverseHold(tRef, tTotal)...)
	all = append(all, PlanCompensate(tRef, tTotal)...)
	seen := map[string]bool{}
	for _, l := range all {
		if seen[l.IdempotencyKey] {
			t.Errorf("duplicate idempotency key across legs: %q", l.IdempotencyKey)
		}
		seen[l.IdempotencyKey] = true
	}
}
