package transport

// DB-free tests for the wallet parcel booking's fare-drift guard: the fare the
// customer saw (expected_fare_kobo) must equal the fare about to be escrowed,
// or the booking is refused with 409 FARE_CHANGED before any money moves.
// The end-to-end "nothing moved" proof is in parcel_fare_drift_live_db_test.go.

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestCheckExpectedParcelFare(t *testing.T) {
	v := func(n int64) *int64 { return &n }
	cases := []struct {
		name     string
		expected *int64
		fare     int64
		wantErr  bool
	}{
		{"omitted keeps legacy behaviour", nil, 300000, false},
		{"exact match", v(300000), 300000, false},
		{"price went up", v(300000), 660000, true},
		{"price went down is also drift", v(300000), 250000, true},
		{"off by one kobo", v(300000), 300001, true},
		{"zero expected against a real fare", v(0), 300000, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := checkExpectedParcelFare(c.expected, c.fare)
			if !c.wantErr {
				if err != nil {
					t.Fatalf("want nil, got %v", err)
				}
				return
			}
			ce, ok := err.(*CodedError)
			if !ok || ce.Status != http.StatusConflict || ce.Code != CodeFareChanged {
				t.Fatalf("want 409 %s, got %v", CodeFareChanged, err)
			}
			body := ce.Body()
			if body["fare_kobo"] != c.fare || body["expected_fare_kobo"] != *c.expected {
				t.Fatalf("body must carry the new and the expected fare, got %v", body)
			}
		})
	}
}

// expected_fare_kobo binds as an optional integer; a float must not be
// silently truncated into a matching fare.
func TestParcelBookRequest_ExpectedFareBinding(t *testing.T) {
	var r ParcelBookRequest
	if err := json.Unmarshal([]byte(`{"expected_fare_kobo":300000}`), &r); err != nil || r.ExpectedFareKobo == nil || *r.ExpectedFareKobo != 300000 {
		t.Fatalf("bind int: %v %v", err, r.ExpectedFareKobo)
	}
	r = ParcelBookRequest{}
	if err := json.Unmarshal([]byte(`{}`), &r); err != nil || r.ExpectedFareKobo != nil {
		t.Fatalf("absent must stay nil: %v %v", err, r.ExpectedFareKobo)
	}
	if err := json.Unmarshal([]byte(`{"expected_fare_kobo":3000.5}`), &r); err == nil {
		t.Fatal("a fractional kobo amount must be rejected")
	}
}
