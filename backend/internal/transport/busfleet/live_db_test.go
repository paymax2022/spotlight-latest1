package busfleet

// LIVE-DB tests for busfleet — skipped unless TEST_DATABASE_URL is set.
// Covers the paths the pure unit tests cannot: layout persistence + versioning,
// plate uniqueness, idempotent departure generation, and swap blocking.
// Mirrors the *_live_db_test.go convention in the parent transport package.

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type fleetFx struct {
	t    *testing.T
	ctx  context.Context
	pool *pgxpool.Pool
	svc  *Service
	prov string
}

func newFleetFx(t *testing.T) *fleetFx {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping busfleet live-DB test")
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
	f := &fleetFx{t: t, ctx: ctx, pool: pool, svc: NewService(pool), prov: uuid.New().String()}
	f.cleanup()
	return f
}

// cleanup registers deletes for every bus_* row the fixture created.
func (f *fleetFx) cleanup() {
	f.t.Cleanup(func() {
		c := context.Background()
		for _, q := range []string{
			`DELETE FROM transport_audit_log WHERE entity_type IN ('bus_seat_layout','bus_vehicle','bus_departure')
			   AND entity_id IN (SELECT id::text FROM bus_departure WHERE provider_id=$1
			                     UNION SELECT id::text FROM bus_vehicle WHERE provider_id=$1
			                     UNION SELECT id::text FROM bus_seat_layout WHERE provider_id=$1)`,
			`DELETE FROM bus_seat_occupancy WHERE departure_id IN (SELECT id FROM bus_departure WHERE provider_id=$1)`,
			`DELETE FROM bus_seat_hold WHERE departure_id IN (SELECT id FROM bus_departure WHERE provider_id=$1)`,
			`DELETE FROM bus_departure WHERE provider_id=$1`,
			`DELETE FROM bus_vehicle WHERE provider_id=$1`,
			`DELETE FROM bus_seat_layout_seat WHERE layout_id IN (SELECT id FROM bus_seat_layout WHERE provider_id=$1)`,
			`DELETE FROM bus_seat_layout WHERE provider_id=$1`,
			`DELETE FROM bus_route_fare WHERE route_id IN (SELECT id FROM bus_route_template WHERE provider_id=$1)`,
			`DELETE FROM bus_route_stop WHERE route_id IN (SELECT id FROM bus_route_template WHERE provider_id=$1)`,
			`DELETE FROM bus_route_template WHERE provider_id=$1`,
		} {
			if _, err := f.pool.Exec(c, q, f.prov); err != nil {
				f.t.Logf("cleanup: %v", err)
			}
		}
	})
}

// route seeds a 2-stop route template with one OD fare; returns the route id.
func (f *fleetFx) route() string {
	f.t.Helper()
	sfx := uuid.New().String()[:8]
	var stateID int
	if err := f.pool.QueryRow(f.ctx,
		`INSERT INTO bus_geo_state (code, name) VALUES ($1,$2) RETURNING id`,
		"Z"+sfx[:6], "Test "+sfx).Scan(&stateID); err != nil {
		f.t.Fatalf("state: %v", err)
	}
	f.t.Cleanup(func() { _, _ = f.pool.Exec(context.Background(), `DELETE FROM bus_geo_state WHERE id=$1`, stateID) })
	var cityID string
	if err := f.pool.QueryRow(f.ctx,
		`INSERT INTO bus_geo_city (state_id, name) VALUES ($1,$2) RETURNING id`, stateID, "City "+sfx).Scan(&cityID); err != nil {
		f.t.Fatalf("city: %v", err)
	}
	f.t.Cleanup(func() {
		c := context.Background()
		_, _ = f.pool.Exec(c, `DELETE FROM bus_terminal WHERE city_id=$1`, cityID)
		_, _ = f.pool.Exec(c, `DELETE FROM bus_geo_city WHERE id=$1`, cityID)
	})
	termID := func(name string) string {
		var id string
		if err := f.pool.QueryRow(f.ctx,
			`INSERT INTO bus_terminal (city_id, name, status) VALUES ($1,$2,'active') RETURNING id`,
			cityID, name+" "+sfx).Scan(&id); err != nil {
			f.t.Fatalf("terminal: %v", err)
		}
		return id
	}
	orig, dest := termID("Origin"), termID("Dest")
	var routeID string
	if err := f.pool.QueryRow(f.ctx,
		`INSERT INTO bus_route_template (provider_id, code, name) VALUES ($1,$2,$3) RETURNING id`,
		f.prov, "RT-"+sfx, "Test route").Scan(&routeID); err != nil {
		f.t.Fatalf("route: %v", err)
	}
	arr := 240
	for _, s := range []struct {
		seq    int
		term   string
		arrOff *int
		depOff int
	}{
		{1, orig, nil, 0},
		{2, dest, &arr, 240},
	} {
		if _, err := f.pool.Exec(f.ctx,
			`INSERT INTO bus_route_stop (route_id, seq, terminal_id, arrive_offset_min, depart_offset_min, board_allowed, alight_allowed)
			 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			routeID, s.seq, s.term, s.arrOff, s.depOff, s.seq == 1, s.seq == 2); err != nil {
			f.t.Fatalf("stop: %v", err)
		}
	}
	if _, err := f.pool.Exec(f.ctx,
		`INSERT INTO bus_route_fare (route_id, from_seq, to_seq, amount_kobo) VALUES ($1,1,2,500000)`, routeID); err != nil {
		f.t.Fatalf("fare: %v", err)
	}
	return routeID
}

// layout creates a 1-deck 10x4 layout with 38 sellable + 1 driver + 1 blocked seat.
func (f *fleetFx) layout() *SeatLayout {
	f.t.Helper()
	seats := []SeatInput{{SeatKey: "drv", Label: "DRV", Deck: 1, Row: 1, Col: 1, Type: SeatDriver}}
	n := 0
	for r := 1; r <= 10; r++ {
		for c := 1; c <= 4; c++ {
			if r == 1 && c == 1 {
				continue // driver position
			}
			n++
			seats = append(seats, SeatInput{
				SeatKey: fmt.Sprintf("s%d", n), Label: fmt.Sprintf("S%d", n),
				Deck: 1, Row: r, Col: c, Type: SeatStandard,
			})
		}
	}
	// last seat blocked
	seats[len(seats)-1].Type = SeatBlocked
	l, err := f.svc.CreateLayout(f.ctx, CreateLayoutRequest{
		ProviderID: f.prov, Name: "coach-" + uuid.New().String()[:8],
		Rows: 10, Cols: 4, Capacity: 38, Seats: seats,
	}, f.prov)
	if err != nil {
		f.t.Fatalf("create layout: %v", err)
	}
	return l
}

func (f *fleetFx) vehicle(plate string, layoutID string) *Vehicle {
	f.t.Helper()
	v, err := f.svc.RegisterVehicle(f.ctx, VehicleRequest{
		ProviderID: f.prov, PlateNumber: plate, Capacity: 40, LayoutID: layoutID,
	}, f.prov)
	if err != nil {
		f.t.Fatalf("register vehicle: %v", err)
	}
	return v
}

func TestLiveDB_LayoutCreateVersionAndFreeze(t *testing.T) {
	f := newFleetFx(t)
	l := f.layout()
	if l.Version != 1 || len(l.Seats) != 40 { // 38 sellable + 1 driver + 1 blocked
		t.Fatalf("layout v%d seats=%d", l.Version, len(l.Seats))
	}
	frozen, err := f.svc.LayoutFrozen(f.ctx, l.ID)
	if err != nil || frozen {
		t.Fatalf("fresh layout must not be frozen: %v %v", frozen, err)
	}
	// Second create with the same name hits UNIQUE(provider_id,name,version).
	_, err = f.svc.CreateLayout(f.ctx, CreateLayoutRequest{
		ProviderID: f.prov, Name: l.Name, Rows: 10, Cols: 4, Capacity: 38,
		Seats: []SeatInput{{SeatKey: "x", Label: "X1", Deck: 1, Row: 1, Col: 1, Type: SeatStandard}},
	}, f.prov)
	if codeOfErr(err) != CodeConflict {
		t.Fatalf("same-name v1 must conflict, got %v", err)
	}
	// NewVersion clones seat keys verbatim and bumps to version 2.
	v2, err := f.svc.NewLayoutVersion(f.ctx, l.ID, nil, f.prov)
	if err != nil {
		t.Fatalf("new version: %v", err)
	}
	if v2.Version != 2 || v2.ID == l.ID || len(v2.Seats) != len(l.Seats) {
		t.Fatalf("v2: %+v", v2)
	}
	keys := map[string]bool{}
	for _, s := range v2.Seats {
		keys[s.SeatKey] = true
		if s.LayoutID != v2.ID || s.ID == "" {
			t.Fatalf("clone seat not rebound to v2: %+v", s)
		}
	}
	for _, s := range l.Seats {
		if !keys[s.SeatKey] {
			t.Fatalf("seat_key %q lost across versions", s.SeatKey)
		}
	}
	// Audit rows exist for both mutations.
	var audits int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT COUNT(*) FROM transport_audit_log WHERE entity_type='bus_seat_layout' AND entity_id=$1`, v2.ID).Scan(&audits); err != nil || audits != 1 {
		t.Fatalf("version audit=%d err=%v", audits, err)
	}
}

func TestLiveDB_VehiclePlateUniqueAndLayoutGuard(t *testing.T) {
	f := newFleetFx(t)
	l := f.layout()
	v := f.vehicle("KJA-100-AA", l.ID)
	if v.Status != VehicleAvailable {
		t.Fatalf("status=%s", v.Status)
	}
	if _, err := f.svc.RegisterVehicle(f.ctx, VehicleRequest{
		ProviderID: f.prov, PlateNumber: "KJA-100-AA", Capacity: 40, LayoutID: l.ID,
	}, f.prov); codeOfErr(err) != CodeConflict {
		t.Fatalf("duplicate plate must conflict, got %v", err)
	}
	// Same plate under another provider is legal.
	if _, err := f.svc.RegisterVehicle(f.ctx, VehicleRequest{
		ProviderID: uuid.New().String(), PlateNumber: "KJA-100-AA", Capacity: 40, LayoutID: l.ID,
	}, f.prov); codeOfErr(err) != CodeForbidden {
		t.Fatalf("other provider must be refused by the layout guard, got %v", err)
	}
	// Status machine: available->retired legal, then terminal.
	if _, err := f.svc.SetVehicleStatus(f.ctx, v.ID, VehicleStatus("bogus"), f.prov, ""); codeOfErr(err) != CodeInvalidState {
		t.Fatalf("bogus status must be INVALID_STATE, got %v", err)
	}
	if _, err := f.svc.SetVehicleStatus(f.ctx, v.ID, VehicleRetired, f.prov, "end of life"); err != nil {
		t.Fatalf("retire: %v", err)
	}
	if _, err := f.svc.SetVehicleStatus(f.ctx, v.ID, VehicleAvailable, f.prov, ""); codeOfErr(err) != CodeInvalidState {
		t.Fatalf("retired must be terminal, got %v", err)
	}
}

func TestLiveDB_GenerateDeparturesIdempotentAndAudited(t *testing.T) {
	f := newFleetFx(t)
	routeID := f.route()
	l := f.layout()
	v := f.vehicle("KJA-200-BB", l.ID)
	dep := time.Now().Add(72 * time.Hour).UTC().Truncate(time.Second)

	gen := func() []*Departure {
		out, err := f.svc.GenerateDepartures(f.ctx, GenerateRequest{
			RouteID: routeID, VehicleID: v.ID,
			Slots: []DepartureSlot{{DepartAt: dep}, {DepartAt: dep.Add(24 * time.Hour)}},
		}, f.prov)
		if err != nil {
			f.t.Fatalf("generate: %v", err)
		}
		return out
	}
	first := gen()
	if len(first) != 2 || !first[0].Created || !first[1].Created {
		t.Fatalf("first pass must create both slots: %+v", first)
	}
	// Snapshot checks: itinerary frozen with terminal names + computed times,
	// fare matrix frozen, capacity = bookable seats (38), layout pinned.
	d0 := first[0]
	if len(d0.Itinerary) != 2 || d0.Itinerary[0].TerminalName == "" || d0.Itinerary[0].ArriveAt != nil {
		t.Fatalf("itinerary snapshot wrong: %+v", d0.Itinerary)
	}
	if d0.Itinerary[1].ArriveAt == nil || !d0.Itinerary[1].ArriveAt.Equal(dep.Add(240*time.Minute)) {
		t.Fatalf("dest arrive_at=%v", d0.Itinerary[1].ArriveAt)
	}
	if len(d0.Fares) != 1 || d0.Fares[0].AmountKobo != 500000 {
		t.Fatalf("fare snapshot: %+v", d0.Fares)
	}
	if d0.Capacity != 38 || d0.LayoutVersion == nil || *d0.LayoutVersion != 1 {
		t.Fatalf("capacity=%d layoutVersion=%v", d0.Capacity, d0.LayoutVersion)
	}
	if d0.Status != DepScheduled {
		t.Fatalf("status=%s", d0.Status)
	}
	// Idempotent replay: same ids, created=false.
	second := gen()
	for i := range first {
		if second[i].ID != first[i].ID || second[i].Created {
			t.Fatalf("replay must return the existing row untouched: %+v", second[i])
		}
	}
	var n int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT COUNT(*) FROM bus_departure WHERE route_id=$1`, routeID).Scan(&n); err != nil || n != 2 {
		t.Fatalf("departures=%d err=%v", n, err)
	}
	// Vehicle flipped to assigned; audit rows written per created departure.
	if got := mustVehicleStatus(f, v.ID); got != VehicleAssigned {
		t.Fatalf("vehicle status=%s", got)
	}
	var audits int
	_ = f.pool.QueryRow(f.ctx,
		`SELECT COUNT(*) FROM transport_audit_log WHERE entity_type='bus_departure' AND action='busfleet.departure.generate'`).Scan(&audits)
	if audits != 2 {
		t.Fatalf("generate audits=%d", audits)
	}
	// Overlap guard: a second generation inside the first slot's window is refused.
	busy, err := f.svc.GenerateDepartures(f.ctx, GenerateRequest{
		RouteID: routeID, VehicleID: v.ID,
		Slots: []DepartureSlot{{DepartAt: dep.Add(2 * time.Hour)}},
	}, f.prov)
	if busy != nil || codeOfErr(err) != CodeVehicleBusy {
		t.Fatalf("overlapping slot must be VEHICLE_BUSY, got %v %+v", err, busy)
	}
}

func TestLiveDB_TransitionAndSwapVehicleGuards(t *testing.T) {
	f := newFleetFx(t)
	routeID := f.route()
	lA := f.layout()
	vOld := f.vehicle("KJA-300-CC", lA.ID)
	dep := time.Now().Add(96 * time.Hour).UTC().Truncate(time.Second)
	out, err := f.svc.GenerateDepartures(f.ctx, GenerateRequest{
		RouteID: routeID, VehicleID: vOld.ID, Slots: []DepartureSlot{{DepartAt: dep}},
	}, f.prov)
	if err != nil || len(out) != 1 {
		t.Fatalf("generate: %v", err)
	}
	d := out[0]
	// Illegal transition: scheduled -> departed (must publish+board first).
	if _, err := f.svc.TransitionDeparture(f.ctx, d.ID, DepDeparted, f.prov, ""); codeOfErr(err) != CodeInvalidState {
		t.Fatalf("scheduled->departed must be INVALID_STATE, got %v", err)
	}
	// Legal path.
	for _, to := range []DepartureStatus{DepPublished, DepBoarding} {
		if _, err := f.svc.TransitionDeparture(f.ctx, d.ID, to, f.prov, ""); err != nil {
			t.Fatalf("-> %s: %v", to, err)
		}
	}
	// Seed one occupied seat that only exists on layout A.
	bookingID := uuid.New().String()
	if _, err := f.pool.Exec(f.ctx,
		`INSERT INTO bus_seat_occupancy (departure_id, seat_key, from_seq, to_seq, booking_id) VALUES ($1,'s1',1,2,$2)`,
		d.ID, bookingID); err != nil {
		t.Fatalf("occupy: %v", err)
	}
	// Swap to a vehicle on a DIFFERENT layout without remap -> SEAT_UNMAPPED.
	lB, err := f.svc.NewLayoutVersion(f.ctx, lA.ID, []SeatInput{
		{SeatKey: "a1", Label: "A1", Deck: 1, Row: 1, Col: 1, Type: SeatStandard},
		{SeatKey: "a2", Label: "A2", Deck: 1, Row: 1, Col: 2, Type: SeatStandard},
		{SeatKey: "a3", Label: "A3", Deck: 1, Row: 1, Col: 3, Type: SeatStandard},
	}, f.prov)
	if err != nil {
		t.Fatalf("layout B: %v", err)
	}
	vNew := f.vehicle("KJA-400-DD", lB.ID)
	if _, err := f.svc.SwapVehicle(f.ctx, SwapRequest{DepartureID: d.ID, NewVehicleID: vNew.ID}, f.prov); codeOfErr(err) != CodeSeatUnmapped {
		t.Fatalf("unmapped occupied seat must block the swap, got %v", err)
	}
	// Same seat_key on the old vehicle must be untouched.
	if got := seatKeyOf(f, d.ID); got != "s1" {
		t.Fatalf("failed swap must not move seats, seat=%s", got)
	}
	// With a remap the swap lands: departure re-bused, occupancy rewritten.
	d2, err := f.svc.SwapVehicle(f.ctx, SwapRequest{
		DepartureID: d.ID, NewVehicleID: vNew.ID,
		SeatRemap: map[string]string{"s1": "a2"}, Reason: "bus broke down",
	}, f.prov)
	if err != nil {
		t.Fatalf("swap with remap: %v", err)
	}
	if *d2.VehicleID != vNew.ID || *d2.LayoutID != lB.ID || d2.Capacity != 3 {
		t.Fatalf("swapped departure wrong: %+v", d2)
	}
	if got := seatKeyOf(f, d.ID); got != "a2" {
		t.Fatalf("occupied seat must be remapped to a2, got %s", got)
	}
	if got := mustVehicleStatus(f, vOld.ID); got != VehicleAvailable {
		t.Fatalf("old vehicle must be freed, status=%s", got)
	}
	if got := mustVehicleStatus(f, vNew.ID); got != VehicleAssigned {
		t.Fatalf("new vehicle must be assigned, status=%s", got)
	}
	var audits int
	_ = f.pool.QueryRow(f.ctx,
		`SELECT COUNT(*) FROM transport_audit_log WHERE entity_type='bus_departure' AND entity_id=$1 AND action='busfleet.departure.swap_vehicle'`, d.ID).Scan(&audits)
	if audits != 1 {
		t.Fatalf("swap audits=%d", audits)
	}
	// A departed bus can no longer swap.
	if _, err := f.svc.TransitionDeparture(f.ctx, d.ID, DepDeparted, f.prov, ""); err != nil {
		t.Fatalf("depart: %v", err)
	}
	vThird := f.vehicle("KJA-500-EE", lB.ID)
	if _, err := f.svc.SwapVehicle(f.ctx, SwapRequest{DepartureID: d.ID, NewVehicleID: vThird.ID}, f.prov); codeOfErr(err) != CodeInvalidState {
		t.Fatalf("post-departure swap must be INVALID_STATE, got %v", err)
	}
}

func codeOfErr(err error) string {
	var ce *Error
	if errors.As(err, &ce) {
		return ce.Code
	}
	if err == nil {
		return ""
	}
	return "RAW:" + err.Error()
}

func mustVehicleStatus(f *fleetFx, id string) VehicleStatus {
	f.t.Helper()
	var s string
	if err := f.pool.QueryRow(f.ctx, `SELECT status FROM bus_vehicle WHERE id=$1`, id).Scan(&s); err != nil {
		f.t.Fatalf("vehicle status: %v", err)
	}
	return VehicleStatus(s)
}

func seatKeyOf(f *fleetFx, depID string) string {
	f.t.Helper()
	var k string
	if err := f.pool.QueryRow(f.ctx,
		`SELECT seat_key FROM bus_seat_occupancy WHERE departure_id=$1 AND state='occupied'`, depID).Scan(&k); err != nil {
		f.t.Fatalf("seat key: %v", err)
	}
	return k
}
