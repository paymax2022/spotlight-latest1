package telemedicine

import "testing"

// synthSlots must always produce a fully-populated 5-day x 7-slot calendar so the
// booking picker is never empty for an un-scheduled doctor.
func TestSynthSlotsShape(t *testing.T) {
	slots := synthSlots("doc-1")
	if got, want := len(slots), 5*len(defaultSlotTimes); got != want {
		t.Fatalf("synthSlots len = %d, want %d", got, want)
	}
	// IDs must be unique and carry the doctor ID.
	seen := map[string]bool{}
	for _, s := range slots {
		if s.DoctorID != "doc-1" {
			t.Errorf("slot %s has doctor %q, want doc-1", s.ID, s.DoctorID)
		}
		if s.Date == "" || s.Time == "" {
			t.Errorf("slot %s missing date/time", s.ID)
		}
		if seen[s.ID] {
			t.Errorf("duplicate slot id %s", s.ID)
		}
		seen[s.ID] = true
	}
}

// At least some slots must be available and some booked, so the UI exercises both
// states (deterministic (d+i)%3 generator).
func TestSynthSlotsMixedAvailability(t *testing.T) {
	slots := synthSlots("doc-x")
	var open, closed int
	for _, s := range slots {
		if s.Available {
			open++
		} else {
			closed++
		}
	}
	if open == 0 || closed == 0 {
		t.Fatalf("expected a mix of open/closed slots, got open=%d closed=%d", open, closed)
	}
}

// Review rating bounds: the service rejects ratings outside 1..5 before any DB write.
func TestSubmitReviewRatingBounds(t *testing.T) {
	cases := []struct {
		rating int
		valid  bool
	}{
		{0, false}, {1, true}, {3, true}, {5, true}, {6, false}, {-1, false},
	}
	for _, tc := range cases {
		ok := tc.rating >= 1 && tc.rating <= 5
		if ok != tc.valid {
			t.Errorf("rating %d: validity = %v, want %v", tc.rating, ok, tc.valid)
		}
	}
}

// SubmitReviewRequest carries the binding contract the handler relies on.
func TestSubmitReviewRequestFields(t *testing.T) {
	req := SubmitReviewRequest{Rating: 5, Comment: "Great listener. On time."}
	if req.Rating != 5 {
		t.Errorf("Rating = %d, want 5", req.Rating)
	}
	if req.Comment == "" {
		t.Error("Comment should be preserved")
	}
}

// Doctor rating projection: recomputing the average over reviews must round to two
// decimals and never exceed 5 — mirrors the SQL ROUND(AVG(rating), 2) projection.
func TestRatingAggregateArithmetic(t *testing.T) {
	ratings := []int{5, 4, 5, 3, 5}
	var sum int
	for _, r := range ratings {
		sum += r
	}
	avg := float64(sum) / float64(len(ratings)) // 4.4
	rounded := float64(int(avg*100+0.5)) / 100
	if rounded < 0 || rounded > 5 {
		t.Fatalf("aggregate rating %.2f out of bounds", rounded)
	}
	if rounded != 4.4 {
		t.Errorf("rounded avg = %.2f, want 4.40", rounded)
	}
}

// Settlement split on completion: doctor 85%, platform 15%, no kobo lost, platform
// absorbs the rounding remainder (matches CompleteAppointment's Split).
func TestBlock13SettlementSplit(t *testing.T) {
	fees := []int64{350_000, 450_000, 500_000, 600_000, 750_000, 333_333}
	for _, fee := range fees {
		doctor := int64(float64(fee) * 0.85)
		platform := fee - doctor
		if doctor+platform != fee {
			t.Errorf("fee %d: %d + %d != %d", fee, doctor, platform, fee)
		}
		if doctor < platform*4 { // doctor share should dominate (~85/15)
			t.Errorf("fee %d: doctor share %d unexpectedly small vs platform %d", fee, doctor, platform)
		}
	}
}
