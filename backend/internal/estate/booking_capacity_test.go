package estate

import "testing"

// TestMaxConcurrentBookings pins the facility slot rule used by BookFacility:
// a set capacity allows that many overlapping active bookings, while a NULL or
// non-positive capacity means exclusive use (one booking at a time). This is
// the guard behind EST-UAT-0248 ("two residents reserve the last slot at the
// same time, exactly one succeeds").
func TestMaxConcurrentBookings(t *testing.T) {
	cases := []struct {
		name     string
		capacity *int
		want     int
	}{
		{"nil capacity is exclusive", nil, 1},
		{"zero capacity is exclusive", new(0), 1},
		{"negative capacity is exclusive", new(-3), 1},
		{"capacity one", new(1), 1},
		{"capacity thirty", new(30), 30},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := maxConcurrentBookings(tc.capacity); got != tc.want {
				t.Errorf("maxConcurrentBookings(%v) = %d, want %d", tc.capacity, got, tc.want)
			}
		})
	}
}
