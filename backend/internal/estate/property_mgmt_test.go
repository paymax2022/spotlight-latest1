package estate

import "testing"

func TestValidOccupancyStatus(t *testing.T) {
	for _, ok := range []string{"vacant", "occupied", "reserved"} {
		if !validOccupancyStatus(ok) {
			t.Errorf("%q should be a valid occupancy status", ok)
		}
	}
	for _, bad := range []string{"", "archived", "sold", "VACANT"} {
		if validOccupancyStatus(bad) {
			t.Errorf("%q should NOT be a valid occupancy status", bad)
		}
	}
}

func TestValidTransferType(t *testing.T) {
	if !validTransferType("ownership") || !validTransferType("tenancy") {
		t.Error("ownership and tenancy must be valid transfer types")
	}
	for _, bad := range []string{"", "lease", "sale"} {
		if validTransferType(bad) {
			t.Errorf("%q should not be a valid transfer type", bad)
		}
	}
}

func TestValidTransferDecision(t *testing.T) {
	if !validTransferDecision("approved") || !validTransferDecision("rejected") {
		t.Error("approved and rejected must be valid decisions")
	}
	for _, bad := range []string{"", "pending", "maybe"} {
		if validTransferDecision(bad) {
			t.Errorf("%q should not be a valid decision", bad)
		}
	}
}
