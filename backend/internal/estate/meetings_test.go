package estate

import "testing"

func TestValidRSVPResponse(t *testing.T) {
	for _, ok := range []string{"yes", "no", "maybe"} {
		if !validRSVPResponse(ok) {
			t.Errorf("%q should be a valid RSVP response", ok)
		}
	}
	for _, bad := range []string{"", "y", "YES", "definitely"} {
		if validRSVPResponse(bad) {
			t.Errorf("%q should NOT be a valid RSVP response", bad)
		}
	}
}

func TestValidCheckinMethod(t *testing.T) {
	if !validCheckinMethod("qr") || !validCheckinMethod("manual") {
		t.Error("qr and manual must be valid check-in methods")
	}
	for _, bad := range []string{"", "nfc", "QR"} {
		if validCheckinMethod(bad) {
			t.Errorf("%q should not be a valid check-in method", bad)
		}
	}
}

func TestValidMeetingMode(t *testing.T) {
	for _, ok := range []string{"", "physical", "virtual", "hybrid"} {
		if !validMeetingMode(ok) {
			t.Errorf("%q should be a valid meeting mode (empty = default)", ok)
		}
	}
	for _, bad := range []string{"online", "in-person", "PHYSICAL"} {
		if validMeetingMode(bad) {
			t.Errorf("%q should not be a valid meeting mode", bad)
		}
	}
}
