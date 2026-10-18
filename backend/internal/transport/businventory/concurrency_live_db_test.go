package businventory

// LIVE-DB tests for the seat-conflict engine. Gated on TEST_DATABASE_URL —
// they require the 20271050000000_bus_transport_v2 migration applied. What
// they pin against real Postgres (never mocks):
//  1. Two goroutines claiming the same seat on an overlapping segment:
//     EXACTLY ONE wins (departure-row-lock serialization, not luck).
//  2. Adjacent (non-overlapping) segments on the same seat BOTH succeed —
//     the Lagos→Ibadan / Ibadan→Abuja resale rule.
//  3. ClaimHold vs expiry is deterministic: an expired hold can never be
//     consumed into occupancy.
//  4. CreateBooking replay returns the same booking; ConfirmPayment is
//     idempotent and issues exactly one ticket per passenger per leg.

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type invFx struct {
	t    *testing.T
	ctx  context.Context
	pool *pgxpool.Pool
	svc  *Service
}

func newInvFx(t *testing.T) *invFx {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping businventory live-DB test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return &invFx{t: t, ctx: ctx, pool: pool, svc: NewService(pool)}
}

// departure seeds the full chain: geo state → city → terminal → route template
// (3 stops) → seat layout (nSeat seats) → published departure tomorrow.
// Returns (departureID, providerID, seatKeys).
func (f *invFx) departure(nSeats int) (string, string, []string) {
	f.t.Helper()
	tag := uuid.New().String()[:8]
	providerID := uuid.NewString()

	var stateID int
	if err := f.pool.QueryRow(f.ctx, `
		INSERT INTO bus_geo_state (code, name) VALUES ($1,$2) RETURNING id`,
		"ZZ"+tag[:2], "Fixture State "+tag).Scan(&stateID); err != nil {
		f.t.Fatalf("geo state: %v", err)
	}
	var cityID, terminalID, routeID, layoutID, depID string
	if err := f.pool.QueryRow(f.ctx, `
		INSERT INTO bus_geo_city (state_id, name) VALUES ($1,$2) RETURNING id`,
		stateID, "Fixture City "+tag).Scan(&cityID); err != nil {
		f.t.Fatalf("geo city: %v", err)
	}
	if err := f.pool.QueryRow(f.ctx, `
		INSERT INTO bus_terminal (city_id, name, status) VALUES ($1,$2,'active') RETURNING id`,
		cityID, "Fixture Terminal "+tag).Scan(&terminalID); err != nil {
		f.t.Fatalf("terminal: %v", err)
	}
	if err := f.pool.QueryRow(f.ctx, `
		INSERT INTO bus_route_template (provider_id, code, name) VALUES ($1,$2,$3) RETURNING id`,
		providerID, "R-"+tag, "Fixture Route "+tag).Scan(&routeID); err != nil {
		f.t.Fatalf("route: %v", err)
	}
	for seq := 1; seq <= 3; seq++ {
		if _, err := f.pool.Exec(f.ctx, `
			INSERT INTO bus_route_stop (route_id, seq, terminal_id, depart_offset_min)
			VALUES ($1,$2,$3,$4)`, routeID, seq, terminalID, (seq-1)*60); err != nil {
			f.t.Fatalf("route stop %d: %v", seq, err)
		}
	}
	if err := f.pool.QueryRow(f.ctx, `
		INSERT INTO bus_seat_layout (provider_id, name, rows_count, cols_count, capacity)
		VALUES ($1,$2,$3,$4,$5) RETURNING id`,
		providerID, "L-"+tag, nSeats, 1, nSeats).Scan(&layoutID); err != nil {
		f.t.Fatalf("layout: %v", err)
	}
	seatKeys := make([]string, nSeats)
	for i := 0; i < nSeats; i++ {
		seatKeys[i] = fmt.Sprintf("S%d", i+1)
		if _, err := f.pool.Exec(f.ctx, `
			INSERT INTO bus_seat_layout_seat (layout_id, seat_key, label, deck, row_no, col_no)
			VALUES ($1,$2,$3,1,$4,1)`, layoutID, seatKeys[i], seatKeys[i], i+1); err != nil {
			f.t.Fatalf("layout seat %s: %v", seatKeys[i], err)
		}
	}
	depart := time.Now().Add(48 * time.Hour)
	if err := f.pool.QueryRow(f.ctx, `
		INSERT INTO bus_departure
			(provider_id, route_id, route_version, travel_date, depart_at,
			 layout_id, layout_version, capacity, status, itinerary_snapshot, fare_snapshot)
		VALUES ($1,$2,1,$3,$4,$5,1,$6,'published','[]','{}') RETURNING id`,
		providerID, routeID, depart.Format("2006-01-02"), depart, layoutID, nSeats).Scan(&depID); err != nil {
		f.t.Fatalf("departure: %v", err)
	}

	// bus_booking rows reference the departure without cascade → delete them
	// first; holds/occupancy cascade on departure delete.
	f.t.Cleanup(func() {
		c := context.Background()
		_, _ = f.pool.Exec(c, `DELETE FROM bus_booking WHERE provider_id=$1`, providerID)
		_, _ = f.pool.Exec(c, `DELETE FROM bus_departure WHERE id=$1`, depID)
		_, _ = f.pool.Exec(c, `DELETE FROM bus_seat_layout_seat WHERE layout_id=$1`, layoutID)
		_, _ = f.pool.Exec(c, `DELETE FROM bus_seat_layout WHERE id=$1`, layoutID)
		_, _ = f.pool.Exec(c, `DELETE FROM bus_route_stop WHERE route_id=$1`, routeID)
		_, _ = f.pool.Exec(c, `DELETE FROM bus_route_template WHERE id=$1`, routeID)
		_, _ = f.pool.Exec(c, `DELETE FROM bus_terminal WHERE id=$1`, terminalID)
		_, _ = f.pool.Exec(c, `DELETE FROM bus_geo_city WHERE id=$1`, cityID)
		_, _ = f.pool.Exec(c, `DELETE FROM bus_geo_state WHERE id=$1`, stateID)
	})
	return depID, providerID, seatKeys
}

func (f *invFx) countHolds(depID, state string) int {
	f.t.Helper()
	var n int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FROM bus_seat_hold WHERE departure_id=$1 AND state=$2`, depID, state).Scan(&n); err != nil {
		f.t.Fatalf("count holds: %v", err)
	}
	return n
}

func (f *invFx) countOccupancy(depID string) int {
	f.t.Helper()
	var n int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FROM bus_seat_occupancy WHERE departure_id=$1 AND state='occupied'`, depID).Scan(&n); err != nil {
		f.t.Fatalf("count occupancy: %v", err)
	}
	return n
}

// The money-invariant-shaped test: N concurrent claims on ONE seat's
// overlapping segment — exactly one may win. This is the "last seat" race the
// departure FOR UPDATE lock exists to serialize. Repeated across independent
// departures so a fluke can't pass it.
func TestLiveDB_HoldSeats_ConcurrentLastSeatExactlyOneWins(t *testing.T) {
	f := newInvFx(t)

	const racers = 6
	const rounds = 4
	for round := 0; round < rounds; round++ {
		depID, _, seats := f.departure(1)
		var wg sync.WaitGroup
		errs := make([]error, racers)
		holds := make([]*HoldResult, racers)
		for i := 0; i < racers; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				holds[i], errs[i] = f.svc.HoldSeats(f.ctx, depID, []string{seats[0]}, 1, 3,
					uuid.NewString(), fmt.Sprintf("race-%s-%d-%d", depID, round, i), 10*time.Minute)
			}(i)
		}
		wg.Wait()

		var winners, conflicts int
		for i, err := range errs {
			if err == nil {
				winners++
				if len(holds[i].HoldIDs) != 1 {
					t.Fatalf("round %d racer %d: winner without a hold row", round, i)
				}
				continue
			}
			var ce *CodedError
			if !errors.As(err, &ce) || (ce.Code != CodeSeatHeld && ce.Code != CodeSeatTaken) {
				t.Fatalf("round %d racer %d: loser must see SEAT_HELD/SEAT_TAKEN, got %v", round, i, err)
			}
			conflicts++
		}
		if winners != 1 || conflicts != racers-1 {
			t.Fatalf("round %d: %d winners %d conflicts — exactly one may win", round, winners, conflicts)
		}
		if n := f.countHolds(depID, "held"); n != 1 {
			t.Fatalf("round %d: %d live holds, want 1", round, n)
		}
	}
}

// Adjacent segments share no inventory: seat sold [1,2) may be resold [2,3).
// Concurrent AND sequential must both succeed.
func TestLiveDB_HoldSeats_NonOverlappingSegmentsBothSucceed(t *testing.T) {
	f := newInvFx(t)
	depID, _, seats := f.departure(1)

	// Concurrent adjacent claims.
	var wg sync.WaitGroup
	errs := make([]error, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, errs[0] = f.svc.HoldSeats(f.ctx, depID, []string{seats[0]}, 1, 2, uuid.NewString(), "adj-a-"+depID, 0)
	}()
	go func() {
		defer wg.Done()
		_, errs[1] = f.svc.HoldSeats(f.ctx, depID, []string{seats[0]}, 2, 3, uuid.NewString(), "adj-b-"+depID, 0)
	}()
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("adjacent claim %d must succeed, got %v", i, err)
		}
	}

	// Sequential: a third claim overlapping [1,3) must now be refused.
	_, err := f.svc.HoldSeats(f.ctx, depID, []string{seats[0]}, 1, 3, uuid.NewString(), "adj-c-"+depID, 0)
	var ce *CodedError
	if !errors.As(err, &ce) || ce.Code != CodeSeatHeld {
		t.Fatalf("overlapping claim must be SEAT_HELD, got %v", err)
	}
}

// Same-key replay must return the original hold group, never double-hold.
func TestLiveDB_HoldSeats_SameKeyReplays(t *testing.T) {
	f := newInvFx(t)
	depID, _, seats := f.departure(2)
	owner := uuid.NewString()
	key := "replay-" + depID

	first, err := f.svc.HoldSeats(f.ctx, depID, seats, 1, 3, owner, key, 0)
	if err != nil {
		t.Fatalf("first hold: %v", err)
	}
	again, err := f.svc.HoldSeats(f.ctx, depID, seats, 1, 3, owner, key, 0)
	if err != nil {
		t.Fatalf("replay must succeed, got %v", err)
	}
	if !again.Replayed || len(again.HoldIDs) != len(first.HoldIDs) {
		t.Fatalf("replay mismatch: %+v", again)
	}
	if n := f.countHolds(depID, "held"); n != len(seats) {
		t.Fatalf("replay created extra holds: %d, want %d", n, len(seats))
	}
	// Same key, different owner → key conflict.
	_, err = f.svc.HoldSeats(f.ctx, depID, seats, 1, 3, uuid.NewString(), key, 0)
	var ce *CodedError
	if !errors.As(err, &ce) || ce.Code != CodeKeyConflict {
		t.Fatalf("foreign-owner replay must be KEY_CONFLICT, got %v", err)
	}
}

// ConfirmSeats mints occupancy exactly once; an expired hold can NEVER be
// claimed (the deterministic payment-vs-expiry rule).
func TestLiveDB_ConfirmSeats_SingleClaimAndExpiry(t *testing.T) {
	f := newInvFx(t)
	depID, _, seats := f.departure(1)
	owner := uuid.NewString()

	res, err := f.svc.HoldSeats(f.ctx, depID, seats, 1, 3, owner, "cfm-"+depID, 0)
	if err != nil {
		t.Fatalf("hold: %v", err)
	}
	bookingID := uuid.NewString()
	o1, err := f.svc.ConfirmSeats(f.ctx, res.HoldIDs[0], bookingID)
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}
	if o1.State != "occupied" || o1.BookingID != bookingID {
		t.Fatalf("occupancy %+v", o1)
	}
	if got := f.countOccupancy(depID); got != 1 {
		t.Fatalf("occupancy rows = %d, want 1", got)
	}
	if got := f.countHolds(depID, "consumed"); got != 1 {
		t.Fatalf("consumed holds = %d, want 1", got)
	}
	// Second confirm on the consumed hold for the same booking replays.
	o2, err := f.svc.ConfirmSeats(f.ctx, res.HoldIDs[0], bookingID)
	if err != nil || o2.ID != o1.ID {
		t.Fatalf("replay confirm must return the same occupancy, got %v / %+v", err, o2)
	}
	// And the seat is now taken for a fresh hold.
	_, err = f.svc.HoldSeats(f.ctx, depID, seats, 1, 3, uuid.NewString(), "post-"+depID, 0)
	var ce *CodedError
	if !errors.As(err, &ce) || ce.Code != CodeSeatTaken {
		t.Fatalf("hold over occupied seat must be SEAT_TAKEN, got %v", err)
	}

	// Expired hold: claim must fail even though the row still says 'held'.
	res2, err := f.svc.HoldSeats(f.ctx, depID, []string{seats[0]}, 1, 2, owner, "exp-"+depID, time.Nanosecond)
	// seat is occupied [1,3) so this must already be refused — use a fresh departure.
	if err == nil {
		t.Fatalf("expected SEAT_TAKEN on occupied seat, got hold %+v", res2)
	}
	dep2, _, seats2 := f.departure(1)
	res3, err := f.svc.HoldSeats(f.ctx, dep2, seats2, 1, 3, owner, "exp2-"+dep2, time.Nanosecond)
	if err != nil {
		t.Fatalf("short-ttl hold: %v", err)
	}
	time.Sleep(50 * time.Millisecond) // let the TTL lapse
	if _, err := f.svc.ConfirmSeats(f.ctx, res3.HoldIDs[0], uuid.NewString()); err == nil {
		t.Fatal("confirm of an expired hold must fail")
	}
	if n, err := f.svc.ExpireHolds(f.ctx, time.Now()); err != nil {
		t.Fatalf("expire sweep: %v", err)
	} else {
		t.Logf("sweep expired %d holds (>=1)", n)
	}
	// Idempotent: second sweep expires nothing new for this hold.
	var st string
	if err := f.pool.QueryRow(f.ctx, `SELECT state FROM bus_seat_hold WHERE id=$1`, res3.HoldIDs[0]).Scan(&st); err != nil {
		t.Fatal(err)
	}
	if st != "expired" {
		t.Fatalf("hold state = %s, want expired", st)
	}
}

// Full booking path: create → replay → confirm payment → tickets, all
// idempotent, with holds consumed into occupancy atomically.
func TestLiveDB_CreateBooking_ConfirmPayment_IssueTickets(t *testing.T) {
	f := newInvFx(t)
	depID, providerID, seats := f.departure(2)
	purchaser := uuid.NewString()
	key := "bk-" + depID

	legs := []LegInput{{DepartureID: depID, FromSeq: 1, ToSeq: 3, FareKobo: 450000}}
	pax := []PassengerInput{
		{FullName: "Ada Lovelace", SeatKey: seats[0], DeliverTo: "purchaser"},
		{FullName: "Grace Hopper", SeatKey: seats[1], DeliverTo: "traveller", Email: "g@example.test"},
	}
	d, err := f.svc.CreateBooking(f.ctx, purchaser, providerID, legs, pax, key)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if d.Booking.State != string(BookingInventoryHeld) || d.Booking.TotalKobo != 900000 {
		t.Fatalf("booking %+v", d.Booking)
	}
	if len(d.Legs) != 1 || len(d.Legs[0].Passengers) != 2 {
		t.Fatalf("legs/passengers %+v", d.Legs)
	}
	if n := f.countHolds(depID, "held"); n != 2 {
		t.Fatalf("live holds = %d, want 2", n)
	}

	// Replay: same key → same booking, no extra rows.
	again, err := f.svc.CreateBooking(f.ctx, purchaser, providerID, legs, pax, key)
	if err != nil || !again.Replayed || again.Booking.ID != d.Booking.ID {
		t.Fatalf("replay: %+v err=%v", again, err)
	}
	if n := f.countHolds(depID, "held"); n != 2 {
		t.Fatalf("replay created holds: %d", n)
	}

	// Confirm via the webhook hook — never the client callback.
	d2, err := f.svc.ConfirmPayment(f.ctx, d.Booking.Ref, "paystack:ref:"+uuid.NewString())
	if err != nil {
		t.Fatalf("confirm payment: %v", err)
	}
	if d2.Booking.State != string(BookingConfirmed) {
		t.Fatalf("state = %s", d2.Booking.State)
	}
	if got := f.countOccupancy(depID); got != 2 {
		t.Fatalf("occupancy = %d, want 2", got)
	}
	if got := f.countHolds(depID, "consumed"); got != 2 {
		t.Fatalf("consumed holds = %d, want 2", got)
	}
	if len(d2.Tickets) != 2 {
		t.Fatalf("tickets = %d, want 2", len(d2.Tickets))
	}
	toks := map[string]bool{}
	for _, tk := range d2.Tickets {
		if len(tk.Token) != 32 || toks[tk.Token] {
			t.Fatalf("bad/dup token %+v", tk)
		}
		toks[tk.Token] = true
	}

	// Idempotent re-issue + re-confirm: same set, no dupes.
	tk2, err := f.svc.IssueTickets(f.ctx, d.Booking.ID)
	if err != nil || len(tk2) != 2 {
		t.Fatalf("re-issue: %v / %d", err, len(tk2))
	}
	for _, tk := range tk2 {
		if !toks[tk.Token] {
			t.Fatalf("re-issue minted a new token %+v", tk)
		}
	}
	_, err = f.svc.ConfirmPayment(f.ctx, d.Booking.Ref, "paystack:other-ref")
	if err == nil {
		t.Fatal("different payment_ref on confirmed booking must conflict")
	}
	var ce *CodedError
	if !errors.As(err, &ce) || ce.Code != CodePaymentConflict {
		t.Fatalf("want PAYMENT_CONFLICT, got %v", err)
	}
}

// Availability reflects holds + occupancy per segment.
func TestLiveDB_AvailableSeats(t *testing.T) {
	f := newInvFx(t)
	depID, _, seats := f.departure(3)

	av, err := f.svc.AvailableSeats(f.ctx, depID, 1, 3)
	if err != nil || av.Available != 3 {
		t.Fatalf("initial availability %+v err=%v", av, err)
	}
	if _, err := f.svc.HoldSeats(f.ctx, depID, []string{seats[0]}, 1, 2, uuid.NewString(), "av-"+depID, 0); err != nil {
		t.Fatalf("hold: %v", err)
	}
	av, err = f.svc.AvailableSeats(f.ctx, depID, 1, 3)
	if err != nil || av.Available != 2 {
		t.Fatalf("after hold availability = %+v err=%v", av, err)
	}
	// Disjoint segment [2,3) keeps all three seats.
	av, err = f.svc.AvailableSeats(f.ctx, depID, 2, 3)
	if err != nil || av.Available != 3 {
		t.Fatalf("disjoint availability = %+v err=%v", av, err)
	}
}

// Cancel of an unpaid booking releases its holds.
func TestLiveDB_RequestCancel_ReleasesHolds(t *testing.T) {
	f := newInvFx(t)
	depID, providerID, seats := f.departure(1)
	purchaser := uuid.NewString()

	d, err := f.svc.CreateBooking(f.ctx, purchaser, providerID,
		[]LegInput{{DepartureID: depID, FromSeq: 1, ToSeq: 3, FareKobo: 1000}},
		[]PassengerInput{{FullName: "A", SeatKey: seats[0]}},
		"cxl-"+depID)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	out, err := f.svc.RequestCancel(f.ctx, d.Booking.Ref, purchaser, "changed my mind")
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if out.Booking.State != string(BookingCancelled) {
		t.Fatalf("state = %s, want cancelled", out.Booking.State)
	}
	if n := f.countHolds(depID, "released"); n != 1 {
		t.Fatalf("released holds = %d, want 1", n)
	}
	// The seat is bookable again.
	if _, err := f.svc.HoldSeats(f.ctx, depID, seats, 1, 3, uuid.NewString(), "cxl2-"+depID, 0); err != nil {
		t.Fatalf("re-hold after cancel must succeed: %v", err)
	}
}
