package buscatalog

// Unit tests for the pure validators — no DB required (mirrors the parent
// transport package's *_test.go files; live-DB coverage lives in
// catalog_live_db_test.go behind TEST_DATABASE_URL).

import (
	"errors"
	"testing"
	"time"

	"spotlight/backend/internal/transport"
)

// stops is a helper building a valid 3-stop itinerary (origin → mid → dest).
func stops(overrides ...func(*StopInput)) []StopInput {
	base := []StopInput{
		{Seq: 1, TerminalID: "t1", DepartOffsetMin: 0, BoardAllowed: true, AlightAllowed: false},
		{Seq: 2, TerminalID: "t2", DepartOffsetMin: 120, BoardAllowed: true, AlightAllowed: true},
		{Seq: 3, TerminalID: "t3", DepartOffsetMin: 300, BoardAllowed: false, AlightAllowed: true},
	}
	for _, f := range overrides {
		for i := range base {
			f(&base[i])
		}
	}
	return base
}

func routeStops() []RouteStop {
	return []RouteStop{
		{Seq: 1, TerminalID: "t1", BoardAllowed: true, AlightAllowed: false},
		{Seq: 2, TerminalID: "t2", BoardAllowed: true, AlightAllowed: true},
		{Seq: 3, TerminalID: "t3", BoardAllowed: false, AlightAllowed: true},
	}
}

func isCoded(t *testing.T, err error, wantCode string) {
	t.Helper()
	var ce *transport.CodedError
	if !errors.As(err, &ce) {
		t.Fatalf("err %v is not a CodedError", err)
	}
	if ce.Code != wantCode {
		t.Fatalf("code = %q, want %q (msg: %s)", ce.Code, wantCode, ce.Message)
	}
}

func TestValidateStops_Valid(t *testing.T) {
	if err := validateStops(stops()); err != nil {
		t.Fatalf("valid itinerary rejected: %v", err)
	}
	// Unordered input is fine — validation keys off seq, not slice order.
	s := stops()
	s[0], s[2] = s[2], s[0]
	if err := validateStops(s); err != nil {
		t.Fatalf("out-of-order but seq-correct itinerary rejected: %v", err)
	}
}

func TestValidateStops_Ordering(t *testing.T) {
	cases := []struct {
		name  string
		stops []StopInput
	}{
		{"too few stops", stops()[0:1]},
		{"duplicate seq", []StopInput{
			{Seq: 1, TerminalID: "t1", BoardAllowed: true},
			{Seq: 1, TerminalID: "t2", AlightAllowed: true},
		}},
		{"seq gap", []StopInput{
			{Seq: 1, TerminalID: "t1", DepartOffsetMin: 0, BoardAllowed: true},
			{Seq: 3, TerminalID: "t3", DepartOffsetMin: 60, AlightAllowed: true},
		}},
		{"seq starts at 2", []StopInput{
			{Seq: 2, TerminalID: "t1", DepartOffsetMin: 0, BoardAllowed: true},
			{Seq: 3, TerminalID: "t3", DepartOffsetMin: 60, AlightAllowed: true},
		}},
		{"decreasing depart offset", []StopInput{
			{Seq: 1, TerminalID: "t1", DepartOffsetMin: 200, BoardAllowed: true},
			{Seq: 2, TerminalID: "t2", DepartOffsetMin: 60, BoardAllowed: true, AlightAllowed: true},
			{Seq: 3, TerminalID: "t3", DepartOffsetMin: 300, AlightAllowed: true},
		}},
		{"equal depart offset ok", stops()},
		{"origin with arrive offset", []StopInput{
			{Seq: 1, TerminalID: "t1", ArriveOffsetMin: i32(10), DepartOffsetMin: 20, BoardAllowed: true},
			{Seq: 2, TerminalID: "t2", DepartOffsetMin: 60, AlightAllowed: true},
		}},
		{"arrive after depart", []StopInput{
			{Seq: 1, TerminalID: "t1", DepartOffsetMin: 0, BoardAllowed: true},
			{Seq: 2, TerminalID: "t2", ArriveOffsetMin: i32(90), DepartOffsetMin: 60, AlightAllowed: true},
		}},
		{"origin cannot board", []StopInput{
			{Seq: 1, TerminalID: "t1", DepartOffsetMin: 0, BoardAllowed: false, AlightAllowed: true},
			{Seq: 2, TerminalID: "t2", DepartOffsetMin: 60, AlightAllowed: true},
		}},
		{"last stop cannot alight", []StopInput{
			{Seq: 1, TerminalID: "t1", DepartOffsetMin: 0, BoardAllowed: true},
			{Seq: 2, TerminalID: "t2", DepartOffsetMin: 60, BoardAllowed: true, AlightAllowed: false},
		}},
		{"missing terminal", []StopInput{
			{Seq: 1, TerminalID: "t1", DepartOffsetMin: 0, BoardAllowed: true},
			{Seq: 2, TerminalID: "", DepartOffsetMin: 60, AlightAllowed: true},
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateStops(tc.stops)
			if tc.name == "equal depart offset ok" {
				if err != nil {
					t.Fatalf("non-decreasing depart offsets should pass: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatal("expected validation error")
			}
			isCoded(t, err, CodeValidation)
		})
	}
}

func i32(v int32) *int32 { return &v }

func TestValidateODPair(t *testing.T) {
	rs := routeStops()
	cases := []struct {
		name     string
		from, to int16
		wantCode string // "" = expect success
	}{
		{"forward adjacent", 1, 2, ""},
		{"forward through-stop", 1, 3, ""},
		{"mid to dest", 2, 3, ""},
		{"reversed", 3, 1, CodeValidation},
		{"same stop", 2, 2, CodeValidation},
		{"from missing seq", 9, 10, CodeNotFound},
		{"to missing seq", 1, 9, CodeNotFound},
		{"both missing", 4, 5, CodeNotFound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateODPair(rs, tc.from, tc.to)
			if tc.wantCode == "" {
				if err != nil {
					t.Fatalf("valid OD rejected: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatal("expected error")
			}
			isCoded(t, err, tc.wantCode)
		})
	}

	// Board/alight flag checks need stops where flags are off — exercise
	// directly since routeStops' from<to valid pairs all carry correct flags.
	alightless := []RouteStop{
		{Seq: 1, BoardAllowed: true, AlightAllowed: true},
		{Seq: 2, BoardAllowed: false, AlightAllowed: true},
	}
	if err := validateODPair(alightless, 2, 1); err == nil {
		t.Fatal("expected reversed-pair rejection")
	}
	boardless := []RouteStop{
		{Seq: 1, BoardAllowed: false, AlightAllowed: true},
		{Seq: 2, BoardAllowed: false, AlightAllowed: true},
	}
	if err := validateODPair(boardless, 1, 2); err == nil {
		t.Fatal("expected no-boarding rejection")
	} else {
		isCoded(t, err, CodeValidation)
	}
	noAlight := []RouteStop{
		{Seq: 1, BoardAllowed: true, AlightAllowed: false},
		{Seq: 2, BoardAllowed: true, AlightAllowed: false},
	}
	if err := validateODPair(noAlight, 1, 2); err == nil {
		t.Fatal("expected no-alighting rejection")
	} else {
		isCoded(t, err, CodeValidation)
	}
}

func TestResolveFare(t *testing.T) {
	day := func(d int) time.Time { return time.Date(2027, 1, d, 0, 0, 0, 0, time.UTC) }
	fare := func(from, to int16, kobo int64, status string, effFrom time.Time, effTo *time.Time) RouteFare {
		return RouteFare{FromSeq: from, ToSeq: to, AmountKobo: kobo, Currency: "NGN",
			Status: status, EffectiveFrom: effFrom, EffectiveTo: effTo}
	}
	base := fare(1, 3, 500000, FareActive, day(1), nil)

	t.Run("resolves open-ended active fare", func(t *testing.T) {
		f, err := resolveFare([]RouteFare{base}, 1, 3, day(10))
		if err != nil {
			t.Fatal(err)
		}
		if f.AmountKobo != 500000 {
			t.Fatalf("amount = %d, want 500000", f.AmountKobo)
		}
	})

	t.Run("no fare at all", func(t *testing.T) {
		_, err := resolveFare(nil, 1, 3, day(10))
		isCoded(t, err, CodeFareUnavailable)
	})

	t.Run("expired fare rejected", func(t *testing.T) {
		end := day(5)
		_, err := resolveFare([]RouteFare{fare(1, 3, 500000, FareActive, day(1), &end)}, 1, 3, day(10))
		isCoded(t, err, CodeFareUnavailable)
	})

	t.Run("not-yet-effective fare rejected", func(t *testing.T) {
		_, err := resolveFare([]RouteFare{fare(1, 3, 500000, FareActive, day(20), nil)}, 1, 3, day(10))
		isCoded(t, err, CodeFareUnavailable)
	})

	t.Run("draft and retired fares skipped", func(t *testing.T) {
		_, err := resolveFare([]RouteFare{
			fare(1, 3, 500000, FareDraft, day(1), nil),
			fare(1, 3, 400000, FareRetired, day(1), nil),
		}, 1, 3, day(10))
		isCoded(t, err, CodeFareUnavailable)
	})

	t.Run("latest effective_from wins", func(t *testing.T) {
		newer := fare(1, 3, 650000, FareActive, day(8), nil)
		f, err := resolveFare([]RouteFare{base, newer}, 1, 3, day(10))
		if err != nil {
			t.Fatal(err)
		}
		if f.AmountKobo != 650000 {
			t.Fatalf("amount = %d, want 650000 (newer window)", f.AmountKobo)
		}
		// Before the newer window starts, the base fare still governs.
		f, err = resolveFare([]RouteFare{base, newer}, 1, 3, day(5))
		if err != nil {
			t.Fatal(err)
		}
		if f.AmountKobo != 500000 {
			t.Fatalf("amount = %d, want 500000 (base window)", f.AmountKobo)
		}
	})

	t.Run("boundary dates inclusive", func(t *testing.T) {
		end := day(15)
		windowed := fare(1, 3, 700000, FareActive, day(10), &end)
		for _, d := range []int{10, 15} {
			f, err := resolveFare([]RouteFare{base, windowed}, 1, 3, day(d))
			if err != nil {
				t.Fatalf("day %d: %v", d, err)
			}
			if f.AmountKobo != 700000 {
				t.Fatalf("day %d amount = %d, want 700000", d, f.AmountKobo)
			}
		}
		// Day 16: windowed fare expired → falls back to open-ended base.
		f, err := resolveFare([]RouteFare{base, windowed}, 1, 3, day(16))
		if err != nil {
			t.Fatal(err)
		}
		if f.AmountKobo != 500000 {
			t.Fatalf("amount = %d, want 500000 (base after window)", f.AmountKobo)
		}
	})
}

func TestTerminalTransitions(t *testing.T) {
	cases := []struct {
		from, to string
		want     bool
	}{
		{TerminalPending, TerminalApproved, true},
		{TerminalPending, TerminalInactive, true},
		{TerminalPending, TerminalActive, false}, // must pass through approved
		{TerminalApproved, TerminalActive, true},
		{TerminalActive, TerminalInactive, true},
		{TerminalInactive, TerminalActive, true},
		{TerminalActive, TerminalApproved, false},
		{TerminalActive, TerminalMerged, true},
		{TerminalMerged, TerminalActive, false}, // merged is a tombstone
		{TerminalMerged, TerminalPending, false},
		{TerminalActive, TerminalActive, true}, // idempotent same-state set
		{TerminalMerged, TerminalMerged, true}, // idempotent
	}
	for _, tc := range cases {
		if got := canTransitionTerminal(tc.from, tc.to); got != tc.want {
			t.Errorf("canTransitionTerminal(%s→%s) = %v, want %v", tc.from, tc.to, got, tc.want)
		}
	}
}
