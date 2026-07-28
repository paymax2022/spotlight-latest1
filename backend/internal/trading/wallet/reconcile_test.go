package wallet

import "testing"

func TestReconcile_Consistent(t *testing.T) {
	r := Reconcile(5_000_000, 5_000_000, 4_800_000, 4_800_000, 0)
	if !r.OK || !r.UnitsOK || !r.AUMOK {
		t.Fatalf("consistent fund must reconcile: %+v", r)
	}
	if r.UnitDrift != 0 || r.AUMDriftKobo != 0 {
		t.Fatalf("no drift expected: %+v", r)
	}
}

func TestReconcile_UnitDriftHalts(t *testing.T) {
	// A single missing unit row must break reconciliation (exact match required).
	r := Reconcile(4_999_999, 5_000_000, 4_800_000, 4_800_000, 100)
	if r.OK || r.UnitsOK {
		t.Fatalf("unit drift must fail reconciliation: %+v", r)
	}
	if r.UnitDrift != -1 {
		t.Fatalf("unit drift = %d, want -1", r.UnitDrift)
	}
}

func TestReconcile_AUMWithinToleranceOK(t *testing.T) {
	// Valuation dust within tolerance is acceptable.
	r := Reconcile(1_000_000, 1_000_000, 1_000_002, 1_000_000, 5)
	if !r.OK || !r.AUMOK {
		t.Fatalf("AUM within tolerance must reconcile: %+v", r)
	}
	if r.AUMDriftKobo != 2 {
		t.Fatalf("AUM drift = %d, want 2", r.AUMDriftKobo)
	}
}

func TestReconcile_AUMBeyondToleranceHalts(t *testing.T) {
	r := Reconcile(1_000_000, 1_000_000, 1_050_000, 1_000_000, 5)
	if r.OK || r.AUMOK {
		t.Fatalf("AUM beyond tolerance must fail reconciliation: %+v", r)
	}
	if r.AUMDriftKobo != 50_000 {
		t.Fatalf("AUM drift = %d, want 50_000", r.AUMDriftKobo)
	}
}
