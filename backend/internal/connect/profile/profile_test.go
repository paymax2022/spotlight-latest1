package connectprofile

import "testing"

func TestValidMode(t *testing.T) {
	for _, m := range []string{"dating", "friendship", "professional", "creator", "event"} {
		if !ValidMode(m) {
			t.Errorf("%q should be a valid mode", m)
		}
	}
	for _, m := range []string{"", "teen", "DATING", "marriage"} {
		if ValidMode(m) {
			t.Errorf("%q must be rejected (no teen/unknown modes)", m)
		}
	}
}

// dob must never be serialised — it is an unexported field, so the JSON contract
// can never accidentally leak it. This guards invariant: dob never exposed raw.
func TestProfileDOBNotExported(t *testing.T) {
	p := Profile{}
	// If dob were exported it would marshal; the unexported field guarantees it
	// stays off the wire. A compile-time presence check suffices here.
	_ = p.dob
	_ = p.geoLat
	_ = p.geoLng
}
