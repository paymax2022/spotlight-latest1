package healthlab

import (
	"errors"
	"testing"
)

// TS-10/11/18 sample↔patient integrity: LB-004/005 (barcode match), EC-001 (two
// samples swapped at accessioning), LR-001 (result bound to correct sample), and
// LR-010 (no cross-patient result leakage). Pure, deterministic — no DB.

// EC-001 / LB-005: a scanned barcode that disagrees with the sample's minted
// barcode is a possible tube swap/mislabel and must be rejected.
func TestVerifyBarcodeScanMismatch(t *testing.T) {
	if err := verifyBarcodeScan("LAB-AAAA-1111", "LAB-BBBB-2222"); !errors.Is(err, ErrBarcodeMismatch) {
		t.Fatalf("mismatched barcode must be rejected, got %v", err)
	}
}

func TestVerifyBarcodeScanMatch(t *testing.T) {
	if err := verifyBarcodeScan("LAB-AAAA-1111", "LAB-AAAA-1111"); err != nil {
		t.Fatalf("matching barcode must pass, got %v", err)
	}
	// Case/whitespace-insensitive (scanner formatting differences).
	if err := verifyBarcodeScan("  lab-aaaa-1111 ", "LAB-AAAA-1111"); err != nil {
		t.Fatalf("normalized barcode must match, got %v", err)
	}
}

// An empty scan means "not scanned" (flows that don't scan) and passes; a scan,
// once provided, is enforced.
func TestVerifyBarcodeScanEmpty(t *testing.T) {
	if err := verifyBarcodeScan("", "LAB-AAAA-1111"); err != nil {
		t.Fatalf("empty scan should pass (not scanned), got %v", err)
	}
	if err := verifyBarcodeScan("LAB-AAAA-1111", ""); !errors.Is(err, ErrBarcodeMismatch) {
		t.Fatalf("a scan against a sample with no barcode on record must fail, got %v", err)
	}
}

// LR-010: only the patient, the owning lab, or an admin may read an order's
// results — a foreign requester is denied (IDOR).
func TestAuthorizeOrderAccess(t *testing.T) {
	const patient, lab = "patient1", "lab_owner1"
	cases := []struct {
		name      string
		requester string
		isAdmin   bool
		labOwner  string
		want      bool
	}{
		{"patient reads own", patient, false, lab, true},
		{"lab owner reads", lab, false, lab, true},
		{"admin reads", "support", true, lab, true},
		{"foreign patient denied (IDOR)", "attacker", false, lab, false},
		{"empty requester denied", "", false, lab, false},
		{"empty requester + empty owner denied (no fail-open)", "", false, "", false},
	}
	for _, c := range cases {
		if got := authorizeOrderAccess(c.requester, patient, c.labOwner, c.isAdmin); got != c.want {
			t.Errorf("%s: authorizeOrderAccess = %v, want %v", c.name, got, c.want)
		}
	}
}
