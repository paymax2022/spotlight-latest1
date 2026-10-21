package busfleet

// Unit tests for the pure decision functions in service.go — no database.
// Live-DB coverage lives in live_db_test.go (gated on TEST_DATABASE_URL).

import (
	"errors"
	"net/http"
	"testing"
	"time"

	"spotlight/backend/go-common/ptr"
)

func codeOf(t *testing.T, err error) string {
	t.Helper()
	var ce *Error
	if !errors.As(err, &ce) {
		t.Fatalf("expected *Error, got %v", err)
	}
	return ce.Code
}

func seat(key, label string, deck, row, col int, typ SeatType, bookable *bool) SeatInput {
	return SeatInput{SeatKey: key, Label: label, Deck: deck, Row: row, Col: col, Type: typ, Bookable: bookable}
}

func stdSeat(key, label string, row, col int) SeatInput {
	return seat(key, label, 1, row, col, SeatStandard, nil)
}

// ─── seat-set validation ────────────────────────────────────────────────────

func TestValidateSeatSet_HappyPathNormalizesDefaults(t *testing.T) {
	norm, bookable, err := validateSeatSet([]SeatInput{
		stdSeat("s1", "A1", 1, 1),
		seat("s2", "A2", 1, 1, 2, SeatPremium, nil),
		seat("drv", "DRV", 1, 1, 3, SeatDriver, nil),
		seat("acc", "B1", 1, 2, 1, SeatAccessible, ptr.Of(true)),
	}, 1, 10, 4, 40)
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if bookable != 3 {
		t.Fatalf("bookable=%d, want 3 (driver seat is never sellable)", bookable)
	}
	if norm[0].Type != SeatStandard {
		t.Fatalf("empty type must default to standard, got %q", norm[0].Type)
	}
	if *norm[0].Bookable != true || *norm[2].Bookable != false {
		t.Fatalf("bookable normalization wrong: %+v", norm)
	}
}

func TestValidateSeatSet_RejectsDuplicates(t *testing.T) {
	cases := map[string][]SeatInput{
		"dup seat_key":   {stdSeat("s1", "A1", 1, 1), stdSeat("s1", "A2", 1, 2)},
		"dup label":      {stdSeat("s1", "A1", 1, 1), stdSeat("s2", "A1", 1, 2)},
		"dup position":   {stdSeat("s1", "A1", 1, 1), stdSeat("s2", "A2", 1, 1)},
		"blank seat_key": {seat("  ", "A1", 1, 1, 1, SeatStandard, nil)},
		"blank label":    {stdSeat("s1", "  ", 1, 1)},
	}
	for name, seats := range cases {
		if _, _, err := validateSeatSet(seats, 1, 10, 4, 40); err == nil {
			t.Fatalf("%s: expected error", name)
		} else if codeOf(t, err) != CodeValidation {
			t.Fatalf("%s: want %s, got %v", name, CodeValidation, err)
		}
	}
}

func TestValidateSeatSet_BoundsAndDims(t *testing.T) {
	if _, _, err := validateSeatSet([]SeatInput{stdSeat("s1", "A1", 11, 1)}, 1, 10, 4, 40); err == nil {
		t.Fatal("row outside grid must fail")
	}
	if _, _, err := validateSeatSet([]SeatInput{seat("s1", "A1", 2, 1, 1, SeatStandard, nil)}, 1, 10, 4, 40); err == nil {
		t.Fatal("deck outside grid must fail")
	}
	if _, _, err := validateSeatSet([]SeatInput{stdSeat("s1", "A1", 1, 5)}, 1, 10, 4, 40); err == nil {
		t.Fatal("col outside grid must fail")
	}
	for _, dims := range [][4]int{{0, 10, 4, 40}, {1, 0, 4, 40}, {1, 10, 0, 40}, {1, 10, 4, 0}} {
		if _, _, err := validateSeatSet([]SeatInput{stdSeat("s1", "A1", 1, 1)}, dims[0], dims[1], dims[2], dims[3]); err == nil {
			t.Fatalf("dims %v must fail", dims)
		}
	}
	if _, _, err := validateSeatSet(nil, 1, 10, 4, 40); err == nil {
		t.Fatal("empty seat set must fail")
	}
}

func TestValidateSeatSet_SeatTypeAndBookableRules(t *testing.T) {
	if _, _, err := validateSeatSet([]SeatInput{seat("s1", "A1", 1, 1, 1, "vip", nil)}, 1, 10, 4, 40); err == nil {
		t.Fatal("invalid seat_type must fail")
	}
	// driver/blocked explicitly marked bookable must fail, not be silently fixed.
	for _, typ := range []SeatType{SeatDriver, SeatBlocked} {
		_, _, err := validateSeatSet([]SeatInput{seat("x", "X1", 1, 1, 1, typ, ptr.Of(true))}, 1, 10, 4, 40)
		if err == nil {
			t.Fatalf("%s seat marked bookable must fail", typ)
		}
		// Same seat with bookable unset normalizes to false and passes.
		norm, bookable, err := validateSeatSet([]SeatInput{seat("x", "X1", 1, 1, 1, typ, nil)}, 1, 10, 4, 40)
		if err != nil || bookable != 0 || *norm[0].Bookable {
			t.Fatalf("%s seat must normalize to non-bookable: %v", typ, err)
		}
	}
	// A sellable type can be explicitly non-bookable (e.g. aisle spacer).
	_, bookable, err := validateSeatSet([]SeatInput{
		stdSeat("s1", "A1", 1, 1),
		seat("s2", "A2", 1, 1, 2, SeatStandard, ptr.Of(false)),
	}, 1, 10, 4, 40)
	if err != nil || bookable != 1 {
		t.Fatalf("explicit non-bookable standard seat: bookable=%d err=%v", bookable, err)
	}
}

func TestValidateSeatSet_BookableCannotExceedCapacity(t *testing.T) {
	_, _, err := validateSeatSet([]SeatInput{
		stdSeat("s1", "A1", 1, 1), stdSeat("s2", "A2", 1, 2), stdSeat("s3", "A3", 1, 3),
	}, 1, 10, 4, 2)
	if codeOf(t, err) != CodeCapacity {
		t.Fatalf("want %s, got %v", CodeCapacity, err)
	}
	var ce *Error
	if errors.As(err, &ce) && ce.Status != http.StatusConflict {
		t.Fatalf("capacity breach must be 409, got %d", ce.Status)
	}
}

// ─── version cloning ────────────────────────────────────────────────────────

func TestCloneSeatInputs_PreservesEverythingForNewVersion(t *testing.T) {
	orig := []Seat{
		{ID: "id1", LayoutID: "L1", SeatKey: "k1", Label: "A1", Deck: 1, Row: 1, Col: 1, Type: SeatStandard, Bookable: true},
		{ID: "id2", LayoutID: "L1", SeatKey: "k2", Label: "A2", Deck: 1, Row: 1, Col: 2, Type: SeatPremium, Bookable: true},
		{ID: "id3", LayoutID: "L1", SeatKey: "drv", Label: "DRV", Deck: 1, Row: 1, Col: 3, Type: SeatDriver, Bookable: false},
	}
	inputs := cloneSeatInputs(orig)
	if len(inputs) != 3 {
		t.Fatalf("cloned %d seats", len(inputs))
	}
	for i, in := range inputs {
		if in.SeatKey != orig[i].SeatKey || in.Label != orig[i].Label ||
			in.Deck != orig[i].Deck || in.Row != orig[i].Row || in.Col != orig[i].Col ||
			in.Type != orig[i].Type || *in.Bookable != orig[i].Bookable {
			t.Fatalf("clone %d drifted: %+v vs %+v", i, in, orig[i])
		}
	}
	// The cloned set must re-validate against the same dims/capacity —
	// cloning a live layout into a new version can never produce an
	// invalid seat set.
	norm, bookable, err := validateSeatSet(inputs, 1, 10, 4, 2)
	if err != nil {
		t.Fatalf("cloned set must re-validate: %v", err)
	}
	if bookable != 2 {
		t.Fatalf("bookable=%d", bookable)
	}
	// materializeSeats gives every clone a NEW row id on the NEW layout while
	// keeping the stable seat_key — the key is what bookings pin to.
	seats := materializeSeats("L2", norm)
	for i, st := range seats {
		if st.LayoutID != "L2" || st.ID == orig[i].ID || st.ID == "" {
			t.Fatalf("clone %d must get a fresh id on the new layout: %+v", i, st)
		}
		if st.SeatKey != orig[i].SeatKey {
			t.Fatalf("seat_key must be stable across versions")
		}
	}
}

func TestNewVersionSeatSet_StillBoundByCapacity(t *testing.T) {
	// A caller supplying MORE bookable seats than capacity in the new version
	// hits the same CAPACITY_EXCEEDED guard as create.
	_, _, err := validateSeatSet([]SeatInput{
		stdSeat("s1", "A1", 1, 1), stdSeat("s2", "A2", 1, 2),
		stdSeat("s3", "A3", 1, 3), stdSeat("s4", "A4", 1, 4),
	}, 1, 10, 4, 3)
	if codeOf(t, err) != CodeCapacity {
		t.Fatalf("want %s, got %v", CodeCapacity, err)
	}
}

// ─── transition maps ────────────────────────────────────────────────────────

func TestDepartureTransitions_HappyPathAndTerminals(t *testing.T) {
	legal := [][2]DepartureStatus{
		{DepDraft, DepScheduled},
		{DepScheduled, DepPublished},
		{DepPublished, DepBoarding},
		{DepBoarding, DepDeparted},
		{DepDeparted, DepArrived},
		{DepArrived, DepCompleted},
		{DepScheduled, DepDelayed},
		{DepDelayed, DepBoarding},
		{DepDelayed, DepDeparted},
		{DepPublished, DepCancelled},
		{DepBoarding, DepNoShow},
		{DepDeparted, DepCancelled},
	}
	for _, tr := range legal {
		if !canTransitionDeparture(tr[0], tr[1]) {
			t.Errorf("%s -> %s must be legal", tr[0], tr[1])
		}
	}
	illegal := [][2]DepartureStatus{
		{DepScheduled, DepDeparted}, // must publish + board first
		{DepDraft, DepBoarding},
		{DepDeparted, DepBoarding},
		{DepArrived, DepCancelled},
		{DepCompleted, DepDeparted},
		{DepCancelled, DepScheduled},
		{DepNoShow, DepPublished},
		{DepScheduled, DepScheduled}, // self-loop never legal
	}
	for _, tr := range illegal {
		if canTransitionDeparture(tr[0], tr[1]) {
			t.Errorf("%s -> %s must be rejected", tr[0], tr[1])
		}
	}
	for _, term := range []DepartureStatus{DepCompleted, DepCancelled, DepNoShow} {
		if !departureTransitions.IsTerminal(term) {
			t.Errorf("%s must be terminal", term)
		}
	}
}

func TestVehicleTransitions(t *testing.T) {
	legal := [][2]VehicleStatus{
		{VehicleAvailable, VehicleAssigned},
		{VehicleAvailable, VehicleMaintenance},
		{VehicleAssigned, VehicleAvailable},
		{VehicleAssigned, VehicleMaintenance},
		{VehicleMaintenance, VehicleAvailable},
	}
	for _, tr := range legal {
		if !canTransitionVehicle(tr[0], tr[1]) {
			t.Errorf("%s -> %s must be legal", tr[0], tr[1])
		}
	}
	illegal := [][2]VehicleStatus{
		{VehicleMaintenance, VehicleAssigned}, // back to pool first
		{VehicleRetired, VehicleAvailable},
		{VehicleRetired, VehicleMaintenance},
		{VehicleAvailable, VehicleAvailable},
	}
	for _, tr := range illegal {
		if canTransitionVehicle(tr[0], tr[1]) {
			t.Errorf("%s -> %s must be rejected", tr[0], tr[1])
		}
	}
	if !vehicleTransitions.IsTerminal(VehicleRetired) {
		t.Error("retired must be terminal")
	}
	if VehicleMaintenance.assignable() || VehicleRetired.assignable() || !VehicleAvailable.assignable() {
		t.Error("assignable() wrong")
	}
}

// ─── vehicle-overlap check ──────────────────────────────────────────────────

func TestConflictsFor_TurnaroundPadsBothSides(t *testing.T) {
	dep := time.Date(2027, 1, 10, 8, 0, 0, 0, time.UTC)
	existing := []OccupiedWindow{
		{DepartureID: "d1", DepartAt: dep, ArriveAt: dep.Add(4 * time.Hour)}, // busy 08:00-12:00
	}
	turn := 45 * time.Minute

	// Candidate departing 12:30 — inside the 45min turnaround after a 12:00 arrival.
	cand := AssignmentWindow{DepartAt: dep.Add(4*time.Hour + 30*time.Minute), ArriveAt: dep.Add(8 * time.Hour)}
	if got := conflictsFor(cand, turn, existing); len(got) != 1 || got[0].DepartureID != "d1" {
		t.Fatalf("want d1 conflict inside turnaround, got %+v", got)
	}
	// 13:30 depart — the existing bus frees at 12:45 and its own padded window
	// ends exactly when the candidate's begins; a boundary touch is free.
	cand.DepartAt = dep.Add(5*time.Hour + 30*time.Minute)
	if got := conflictsFor(cand, turn, existing); len(got) != 0 {
		t.Fatalf("boundary-touching slot must be free, got %+v", got)
	}
	// Earlier window ending inside the candidate's boarding turnaround.
	cand2 := AssignmentWindow{DepartAt: dep.Add(-5 * time.Hour), ArriveAt: dep.Add(-30 * time.Minute)}
	if got := conflictsFor(cand2, turn, existing); len(got) != 1 {
		t.Fatalf("arrival inside turnaround must conflict, got %+v", got)
	}
	// Zero turnaround ⇒ windows only conflict on true time overlap.
	cand3 := AssignmentWindow{DepartAt: dep.Add(4 * time.Hour), ArriveAt: dep.Add(6 * time.Hour)}
	if got := conflictsFor(cand3, 0, existing); len(got) != 0 {
		t.Fatalf("touching windows with 0 turnaround must be free, got %+v", got)
	}
}

func TestItineraryEnd_LastStopWins(t *testing.T) {
	dep := time.Date(2027, 1, 10, 8, 0, 0, 0, time.UTC)
	arr := dep.Add(3 * time.Hour)
	stops := []SnapshotStop{
		{Seq: 1, DepartAt: dep},
		{Seq: 2, DepartAt: dep.Add(2 * time.Hour), ArriveAt: &arr},
	}
	if got := itineraryEnd(stops, dep); !got.Equal(arr) {
		t.Fatalf("itineraryEnd=%v want %v", got, arr)
	}
	// No arrive time on the last stop ⇒ its depart_at.
	stops[1].ArriveAt = nil
	if got := itineraryEnd(stops, dep); !got.Equal(stops[1].DepartAt) {
		t.Fatalf("itineraryEnd fallback=%v", got)
	}
	if got := itineraryEnd(nil, dep); !got.Equal(dep) {
		t.Fatalf("empty itinerary must fall back, got %v", got)
	}
}

func TestBuildItinerary_ComputesStopTimes(t *testing.T) {
	dep := time.Date(2027, 1, 10, 8, 0, 0, 0, time.UTC)
	arrOff := 150
	stops := []routeStopRow{
		{Seq: 1, TerminalID: "t1", TerminalName: "Ojota", CityName: "Lagos", DepartOffsetMin: 0, BoardAllowed: true, AlightAllowed: false},
		{Seq: 2, TerminalID: "t2", TerminalName: "Utako", CityName: "Abuja", ArriveOffsetMin: &arrOff, DepartOffsetMin: 150, BoardAllowed: false, AlightAllowed: true},
	}
	itin := buildItinerary(stops, dep)
	if len(itin) != 2 {
		t.Fatalf("stops=%d", len(itin))
	}
	if itin[0].ArriveAt != nil || !itin[0].DepartAt.Equal(dep) {
		t.Fatalf("origin stop must have nil arrive_at and depart at t0: %+v", itin[0])
	}
	if itin[1].ArriveAt == nil || !itin[1].ArriveAt.Equal(dep.Add(150*time.Minute)) {
		t.Fatalf("dest arrive_at=%v", itin[1].ArriveAt)
	}
	if itin[1].TerminalName != "Utako" || !itin[1].AlightAllowed {
		t.Fatalf("stop fields not carried into snapshot: %+v", itin[1])
	}
}

// ─── swap seat planning ─────────────────────────────────────────────────────

func bookable(keys ...string) map[string]Seat {
	m := map[string]Seat{}
	for _, k := range keys {
		m[k] = Seat{SeatKey: k, Bookable: true}
	}
	return m
}

func TestPlanSeatRemap_PassthroughWhenKeyExists(t *testing.T) {
	plan, err := planSeatRemap([]string{"s1", "s2"}, bookable("s1", "s2", "s3"), nil)
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	if plan["s1"] != "s1" || plan["s2"] != "s2" {
		t.Fatalf("identical keys must pass through: %v", plan)
	}
}

func TestPlanSeatRemap_MissingKeyRequiresRemap(t *testing.T) {
	_, err := planSeatRemap([]string{"s9"}, bookable("a", "b"), nil)
	if codeOf(t, err) != CodeSeatUnmapped {
		t.Fatalf("want %s, got %v", CodeSeatUnmapped, err)
	}
	var ce *Error
	if errors.As(err, &ce) && ce.Details["seat_key"] != "s9" {
		t.Fatalf("error must name the unmapped seat: %v", ce.Details)
	}
	// Supplying the remap fixes it.
	plan, err := planSeatRemap([]string{"s9"}, bookable("a", "b"), map[string]string{"s9": "b"})
	if err != nil || plan["s9"] != "b" {
		t.Fatalf("remap must place the seat: %v %v", plan, err)
	}
}

func TestPlanSeatRemap_TargetMustBeBookable(t *testing.T) {
	m := bookable("a")
	m["drv"] = Seat{SeatKey: "drv", Bookable: false}
	_, err := planSeatRemap([]string{"s1"}, m, map[string]string{"s1": "drv"})
	if codeOf(t, err) != CodeSeatUnmapped {
		t.Fatalf("remap onto a non-bookable seat must fail, got %v", err)
	}
	_, err = planSeatRemap([]string{"s1"}, m, map[string]string{"s1": "ghost"})
	if codeOf(t, err) != CodeSeatUnmapped {
		t.Fatalf("remap onto a nonexistent seat must fail, got %v", err)
	}
}

func TestPlanSeatRemap_NoTwoSeatsOnOneTarget(t *testing.T) {
	_, err := planSeatRemap([]string{"s1", "s2"}, bookable("a", "b"),
		map[string]string{"s1": "a", "s2": "a"})
	if codeOf(t, err) != CodeSeatUnmapped {
		t.Fatalf("colliding remap must fail, got %v", err)
	}
}

func TestPlanSeatRemap_OccupiedCannotExceedNewCapacity(t *testing.T) {
	_, err := planSeatRemap([]string{"s1", "s2", "s3"}, bookable("a", "b"), nil)
	if codeOf(t, err) != CodeCapacity {
		t.Fatalf("want %s, got %v", CodeCapacity, err)
	}
}
