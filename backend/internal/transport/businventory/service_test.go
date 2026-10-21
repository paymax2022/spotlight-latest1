package businventory

// Pure unit tests — no database. Pin the overlap predicate, the booking state
// machine, input validation, token/ref entropy shape, and TTL clamping.
// Concurrency proofs live in concurrency_live_db_test.go (TEST_DATABASE_URL).

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestSegmentsOverlap(t *testing.T) {
	cases := []struct {
		name       string
		aFrom, aTo int
		bFrom, bTo int
		want       bool
	}{
		{"identical", 1, 3, 1, 3, true},
		{"a inside b", 2, 3, 1, 5, true},
		{"b inside a", 1, 5, 2, 3, true},
		{"a starts before b", 1, 3, 2, 5, true},
		{"a ends inside b", 2, 5, 1, 3, true},
		{"adjacent a before b — alighting stop resale", 1, 3, 3, 5, false},
		{"adjacent b before a", 3, 5, 1, 3, false},
		{"disjoint before", 1, 2, 4, 6, false},
		{"disjoint after", 5, 6, 1, 3, false},
		{"single-hop vs long", 4, 5, 1, 6, true},
	}
	for _, tc := range cases {
		if got := segmentsOverlap(tc.aFrom, tc.aTo, tc.bFrom, tc.bTo); got != tc.want {
			t.Errorf("%s: segmentsOverlap(%d,%d,%d,%d) = %v, want %v",
				tc.name, tc.aFrom, tc.aTo, tc.bFrom, tc.bTo, got, tc.want)
		}
		// Overlap is symmetric.
		if got := segmentsOverlap(tc.bFrom, tc.bTo, tc.aFrom, tc.aTo); got != tc.want {
			t.Errorf("%s (symmetric): got %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestBookingStateMachine(t *testing.T) {
	legal := [][2]BookingState{
		{BookingQuoted, BookingInventoryHeld},
		{BookingInventoryHeld, BookingPaymentPending},
		{BookingInventoryHeld, BookingConfirmed}, // webhook can beat the pending marker
		{BookingPaymentPending, BookingConfirmed},
		{BookingPaymentPending, BookingPaymentFailed},
		{BookingPaymentFailed, BookingPaymentPending},
		{BookingConfirmed, BookingCancelRequested},
		{BookingCancelRequested, BookingRefundPending},
		{BookingCancelRequested, BookingCancelled},
		{BookingRefundPending, BookingRefunded},
		{BookingRefundPending, BookingPartiallyRefunded},
		{BookingPartiallyRefunded, BookingRefunded},
		{BookingPaymentPending, BookingExceptionReview},
		{BookingExceptionReview, BookingCancelled},
		{BookingExceptionReview, BookingRefunded},
		{BookingInventoryHeld, BookingCancelled},
	}
	for _, tr := range legal {
		if !canTransition(tr[0], tr[1]) {
			t.Errorf("legal transition %s → %s rejected", tr[0], tr[1])
		}
	}
	illegal := [][2]BookingState{
		{BookingQuoted, BookingConfirmed},
		{BookingConfirmed, BookingPaymentPending},
		{BookingRefunded, BookingConfirmed},
		{BookingExpired, BookingConfirmed},
		{BookingCancelled, BookingConfirmed},
		{BookingConfirmed, BookingConfirmed}, // self-loops never legal (fsm.Can)
		{BookingRefunded, BookingCancelled},
	}
	for _, tr := range illegal {
		if canTransition(tr[0], tr[1]) {
			t.Errorf("illegal transition %s → %s accepted", tr[0], tr[1])
		}
	}
	if !bookingMoves.IsTerminal(BookingRefunded) || !bookingMoves.IsTerminal(BookingExpired) {
		t.Error("refunded and expired must be terminal")
	}
}

func TestValidateBookingInput(t *testing.T) {
	leg := LegInput{DepartureID: "dep-1", FromSeq: 1, ToSeq: 3, FareKobo: 500000}
	returnLeg := LegInput{DepartureID: "dep-2", FromSeq: 1, ToSeq: 3, FareKobo: 500000}
	pax := PassengerInput{FullName: "Ada", SeatKey: "A1"}
	cases := []struct {
		name       string
		legs       []LegInput
		passengers []PassengerInput
		wantErr    bool
	}{
		{"one leg one pax", []LegInput{leg}, []PassengerInput{pax}, false},
		{"return leg pax on leg 1", []LegInput{leg, returnLeg}, []PassengerInput{{FullName: "Ada", SeatKey: "A1"}, {FullName: "Ada", SeatKey: "A2", LegIndex: 1}}, false},
		{"no legs", nil, []PassengerInput{pax}, true},
		{"three legs", []LegInput{leg, leg, leg}, []PassengerInput{pax}, true},
		{"no passengers", []LegInput{leg}, nil, true},
		{"bad segment", []LegInput{{DepartureID: "d", FromSeq: 3, ToSeq: 3}}, []PassengerInput{pax}, true},
		{"zero from seq", []LegInput{{DepartureID: "d", FromSeq: 0, ToSeq: 2}}, []PassengerInput{pax}, true},
		{"negative fare", []LegInput{{DepartureID: "d", FromSeq: 1, ToSeq: 2, FareKobo: -1}}, []PassengerInput{pax}, true},
		{"no departure id", []LegInput{{FromSeq: 1, ToSeq: 2}}, []PassengerInput{pax}, true},
		{"no name", []LegInput{leg}, []PassengerInput{{SeatKey: "A1"}}, true},
		{"no seat", []LegInput{leg}, []PassengerInput{{FullName: "Ada"}}, true},
		{"leg index out of range", []LegInput{leg}, []PassengerInput{{FullName: "Ada", SeatKey: "A1", LegIndex: 1}}, true},
		{"dup seat on same leg", []LegInput{leg}, []PassengerInput{pax, pax}, true},
		{"same seat on different legs ok", []LegInput{leg, returnLeg}, []PassengerInput{pax, {FullName: "Ada", SeatKey: "A1", LegIndex: 1}}, false},
		{"bad deliver_to", []LegInput{leg}, []PassengerInput{{FullName: "Ada", SeatKey: "A1", DeliverTo: "carrier-pigeon"}}, true},
	}
	for _, tc := range cases {
		err := validateBookingInput(tc.legs, tc.passengers)
		if tc.wantErr && err == nil {
			t.Errorf("%s: want error, got nil", tc.name)
		}
		if !tc.wantErr && err != nil {
			t.Errorf("%s: want nil, got %v", tc.name, err)
		}
		if tc.wantErr && err != nil {
			var ce *CodedError
			if !errors.As(err, &ce) || ce.Status != http.StatusBadRequest {
				t.Errorf("%s: want 400 CodedError, got %v", tc.name, err)
			}
		}
	}
}

func TestNewBookingRef(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 200; i++ {
		r := newBookingRef()
		if !strings.HasPrefix(r, "BK-") || len(r) != 3+16 {
			t.Fatalf("ref %q must be BK- + 16 chars", r)
		}
		for _, ch := range r[3:] {
			if !strings.ContainsRune("0123456789ABCDEFGHIJKLMNOPQRSTUV", ch) {
				t.Fatalf("ref %q carries non-base32hex char %c", r, ch)
			}
		}
		if seen[r] {
			t.Fatal("duplicate ref generated")
		}
		seen[r] = true
	}
}

func TestNewTicketToken(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 200; i++ {
		tok := newTicketToken()
		if len(tok) != 32 {
			t.Fatalf("token %q must be 32 hex chars", tok)
		}
		for _, ch := range tok {
			if !strings.ContainsRune("0123456789abcdef", ch) {
				t.Fatalf("token %q carries non-hex char %c", tok, ch)
			}
		}
		if seen[tok] {
			t.Fatal("duplicate token generated")
		}
		seen[tok] = true
	}
}

func TestClampHoldTTL(t *testing.T) {
	svc := &Service{cfg: DefaultConfig()}
	if got := svc.clampTTL(0); got != 10*time.Minute {
		t.Errorf("default ttl = %v, want 10m", got)
	}
	if got := svc.clampTTL(5 * time.Minute); got != 5*time.Minute {
		t.Errorf("5m ttl = %v", got)
	}
	if got := svc.clampTTL(2 * time.Hour); got != 30*time.Minute {
		t.Errorf("over-cap ttl = %v, want 30m clamp", got)
	}
}

func TestBookingHoldKeyShape(t *testing.T) {
	k := bookingHoldKey("bid-123", 1, "A1")
	if k != "bk:bid-123:1:A1" {
		t.Fatalf("hold key %q", k)
	}
	if !strings.HasPrefix(k, "bk:bid-123:") {
		t.Fatal("hold key must carry the bk:<bookingID>: group prefix")
	}
}

func TestFareFromSnapshot(t *testing.T) {
	snap := []byte(`{"matrix":[{"from_seq":1,"to_seq":3,"amount_kobo":450000},{"from_seq":1,"to_seq":2,"amount_kobo":300000}]}`)
	if v, ok := fareFromSnapshot(snap, 1, 3); !ok || v != 450000 {
		t.Fatalf("matrix fare = %d,%v", v, ok)
	}
	if _, ok := fareFromSnapshot(snap, 2, 3); ok {
		t.Fatal("missing OD pair must not yield a fare")
	}
	arr := []byte(`[{"from_seq":1,"to_seq":2,"fare_kobo":100}]`)
	if v, ok := fareFromSnapshot(arr, 1, 2); !ok || v != 100 {
		t.Fatalf("array fare = %d,%v", v, ok)
	}
	if _, ok := fareFromSnapshot([]byte(`{}`), 1, 2); ok {
		t.Fatal("empty snapshot must yield false")
	}
}
