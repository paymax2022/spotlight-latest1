package buscatalog_test

// LIVE-DB tests for the bus catalog service. Skipped unless TEST_DATABASE_URL
// is set — same pattern as backend/internal/transport/*_live_db_test.go.
// Each test seeds its own state/city/terminal/route rows (keyed off a unique
// run tag) and deletes them on cleanup, so a shared dev/test database is
// never left dirty and the seeded geo data is never edited.

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/transport"
	"spotlight/backend/internal/transport/buscatalog"
)

func catalogPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping buscatalog live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

// seededGeo carries the rows one test run created plus the tag they are
// keyed under — route codes are "<tag>-<n>" so cleanup can find them by
// prefix without tracking every id.
type seededGeo struct {
	Tag       string
	StateID   int16
	StateCode string
	CityID    string
	Terminals []string
}

// seedGeo creates one state + one city + N 'active' terminals and registers
// the teardown that removes them (children first — FK order).
func seedGeo(t *testing.T, ctx context.Context, pool *pgxpool.Pool, terminalCount int) seededGeo {
	t.Helper()
	tag := "t" + uuid.NewString()[:8]
	var stateID int16
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.bus_geo_state (code, name)
		VALUES (upper($1), $2) RETURNING id`,
		tag, "Test State "+tag).Scan(&stateID); err != nil {
		t.Fatalf("seed state: %v", err)
	}
	var cityID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.bus_geo_city (state_id, name)
		VALUES ($1, $2) RETURNING id`, stateID, "Test City "+tag).Scan(&cityID); err != nil {
		t.Fatalf("seed city: %v", err)
	}
	terms := make([]string, 0, terminalCount)
	for i := 0; i < terminalCount; i++ {
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO public.bus_terminal (city_id, name, status)
			VALUES ($1, $2, 'active') RETURNING id`,
			cityID, fmt.Sprintf("Terminal %s-%c", tag, 'A'+i)).Scan(&id); err != nil {
			t.Fatalf("seed terminal %d: %v", i, err)
		}
		terms = append(terms, id)
	}
	g := seededGeo{
		Tag: tag, StateID: stateID, StateCode: strings.ToUpper(tag),
		CityID: cityID, Terminals: terms,
	}
	t.Cleanup(func() {
		ctx := context.Background()
		// FK-safe order: departures → fares → routes (stops cascade) → terminals
		// → city → state.
		_, _ = pool.Exec(ctx, `DELETE FROM public.bus_departure WHERE route_id IN
			(SELECT id FROM public.bus_route_template WHERE code LIKE $1)`, tag+"-%")
		_, _ = pool.Exec(ctx, `DELETE FROM public.bus_route_fare WHERE route_id IN
			(SELECT id FROM public.bus_route_template WHERE code LIKE $1)`, tag+"-%")
		_, _ = pool.Exec(ctx, `DELETE FROM public.bus_route_template WHERE code LIKE $1`, tag+"-%")
		for _, id := range terms {
			_, _ = pool.Exec(ctx, `DELETE FROM public.bus_terminal WHERE id=$1`, id)
		}
		_, _ = pool.Exec(ctx, `DELETE FROM public.bus_geo_city WHERE id=$1`, cityID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.bus_geo_state WHERE id=$1`, stateID)
	})
	return g
}

func stopInputs(terms []string) []buscatalog.StopInput {
	out := make([]buscatalog.StopInput, len(terms))
	for i, id := range terms {
		out[i] = buscatalog.StopInput{
			Seq:             int16(i + 1),
			TerminalID:      id,
			DepartOffsetMin: int32(i * 120),
			BoardAllowed:    i < len(terms)-1,
			AlightAllowed:   i > 0,
		}
	}
	return out
}

func isCodedErr(t *testing.T, err error, code string) {
	t.Helper()
	var ce *transport.CodedError
	if !errors.As(err, &ce) {
		t.Fatalf("err %v is not a transport.CodedError", err)
	}
	if ce.Code != code {
		t.Fatalf("code = %q, want %q", ce.Code, code)
	}
}

func strPtr(s string) *string { return &s }

func TestLiveDB_TerminalLifecycle(t *testing.T) {
	pool := catalogPool(t)
	ctx := context.Background()
	geo := seedGeo(t, ctx, pool, 0)
	svc := buscatalog.NewService(pool)

	term, err := svc.CreateTerminal(ctx, buscatalog.TerminalCreateRequest{
		CityID: geo.CityID, Name: "Lifecycle " + uuid.NewString()[:8],
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if term.Status != buscatalog.TerminalPending {
		t.Fatalf("new terminal status = %q, want pending", term.Status)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM public.bus_terminal WHERE id=$1`, term.ID)
	})

	// pending → active is ILLEGAL (must pass through approved).
	if err := svc.SetTerminalStatus(ctx, term.ID, buscatalog.TerminalActive, nil); err == nil {
		t.Fatal("pending→active should be rejected")
	} else {
		isCodedErr(t, err, buscatalog.CodeInvalidState)
	}
	if err := svc.SetTerminalStatus(ctx, term.ID, buscatalog.TerminalApproved, nil); err != nil {
		t.Fatalf("pending→approved: %v", err)
	}
	if err := svc.SetTerminalStatus(ctx, term.ID, buscatalog.TerminalActive, nil); err != nil {
		t.Fatalf("approved→active: %v", err)
	}
	// Idempotent same-state set is a no-op.
	if err := svc.SetTerminalStatus(ctx, term.ID, buscatalog.TerminalActive, nil); err != nil {
		t.Fatalf("idempotent active: %v", err)
	}
	// Merge requires a target.
	if err := svc.SetTerminalStatus(ctx, term.ID, buscatalog.TerminalMerged, nil); err == nil {
		t.Fatal("merge without merged_into should be rejected")
	}
}

func TestLiveDB_RouteCreateAndFareQuote(t *testing.T) {
	pool := catalogPool(t)
	ctx := context.Background()
	geo := seedGeo(t, ctx, pool, 3)
	svc := buscatalog.NewService(pool)
	provider := uuid.NewString()
	code := geo.Tag + "-r1"

	rt, err := svc.CreateRouteTemplate(ctx, buscatalog.RouteCreateRequest{
		ProviderID: provider, Code: code, Name: "Test Route",
		Stops: stopInputs(geo.Terminals),
	})
	if err != nil {
		t.Fatalf("create route: %v", err)
	}
	if rt.Version != 1 || len(rt.Stops) != 3 {
		t.Fatalf("version=%d stops=%d, want 1/3", rt.Version, len(rt.Stops))
	}

	// Fare for the through OD pair 1→3, effective today.
	today := time.Now().UTC().Truncate(24 * time.Hour)
	fare, err := svc.UpsertFare(ctx, rt.ID, buscatalog.FareUpsertRequest{
		FromSeq: 1, ToSeq: 3, AmountKobo: 850000, EffectiveFrom: &today,
	})
	if err != nil {
		t.Fatalf("upsert fare: %v", err)
	}
	if fare.AmountKobo != 850000 || fare.Currency != "NGN" || fare.Status != buscatalog.FareActive {
		t.Fatalf("fare = %+v", fare)
	}

	// Same natural key re-upserted → same row id, new price.
	fare2, err := svc.UpsertFare(ctx, rt.ID, buscatalog.FareUpsertRequest{
		FromSeq: 1, ToSeq: 3, AmountKobo: 900000, EffectiveFrom: &today,
	})
	if err != nil {
		t.Fatalf("re-upsert: %v", err)
	}
	if fare2.ID != fare.ID || fare2.AmountKobo != 900000 {
		t.Fatalf("upsert should update in place: id %q→%q amount %d",
			fare.ID, fare2.ID, fare2.AmountKobo)
	}

	q, err := svc.QuoteFare(ctx, rt.ID, 1, 3, today)
	if err != nil {
		t.Fatalf("quote: %v", err)
	}
	if q.AmountKobo != 900000 {
		t.Fatalf("quote amount = %d, want 900000", q.AmountKobo)
	}

	// Reversed pair and missing pair must fail.
	if _, err := svc.QuoteFare(ctx, rt.ID, 3, 1, today); err == nil {
		t.Fatal("reversed OD should fail")
	}
	if _, err := svc.QuoteFare(ctx, rt.ID, 1, 2, today); err == nil {
		t.Fatal("unpriced OD should fail")
	} else {
		isCodedErr(t, err, buscatalog.CodeFareUnavailable)
	}
	// amount_kobo <= 0 rejected before touching the DB.
	if _, err := svc.UpsertFare(ctx, rt.ID, buscatalog.FareUpsertRequest{
		FromSeq: 1, ToSeq: 2, AmountKobo: 0,
	}); err == nil {
		t.Fatal("zero fare should be rejected")
	}
}

func TestLiveDB_ReviseRoute_VersionBumpWhenDeparted(t *testing.T) {
	pool := catalogPool(t)
	ctx := context.Background()
	geo := seedGeo(t, ctx, pool, 3)
	svc := buscatalog.NewService(pool)
	provider := uuid.NewString()
	code := geo.Tag + "-r1"

	rt, err := svc.CreateRouteTemplate(ctx, buscatalog.RouteCreateRequest{
		ProviderID: provider, Code: code, Name: "Bump Route",
		Stops: stopInputs(geo.Terminals),
	})
	if err != nil {
		t.Fatalf("create route: %v", err)
	}

	// Before any departure pins it, revise in place — same row id, same version.
	newName := "Bump Route v1.1"
	v1, err := svc.ReviseRoute(ctx, rt.ID, buscatalog.RouteReviseRequest{Name: &newName})
	if err != nil {
		t.Fatalf("in-place revise: %v", err)
	}
	if v1.ID != rt.ID || v1.Version != 1 || v1.Name != newName {
		t.Fatalf("in-place revise produced id=%s version=%d name=%q", v1.ID, v1.Version, v1.Name)
	}

	// Pin the version with a departure row (snapshots frozen at publish time).
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.bus_departure
			(provider_id, route_id, route_version, travel_date, depart_at,
			 capacity, itinerary_snapshot, fare_snapshot)
		VALUES ($1,$2,1,CURRENT_DATE+1,now()+interval '1 day',40,'[]','{}')`,
		provider, rt.ID); err != nil {
		t.Fatalf("pin departure: %v", err)
	}

	// Now a revise MUST bump: new row, version 2, original row untouched.
	v2, err := svc.ReviseRoute(ctx, rt.ID, buscatalog.RouteReviseRequest{Name: strPtr("Bump Route v2")})
	if err != nil {
		t.Fatalf("bump revise: %v", err)
	}
	if v2.ID == rt.ID || v2.Version != 2 || v2.Name != "Bump Route v2" {
		t.Fatalf("bump produced id=%s version=%d name=%q", v2.ID, v2.Version, v2.Name)
	}
	orig, err := svc.GetRouteTemplate(ctx, rt.ID)
	if err != nil {
		t.Fatal(err)
	}
	if orig.Name != newName || orig.Version != 1 {
		t.Fatalf("pinned version mutated: %+v", orig)
	}
	if len(v2.Stops) != 3 {
		t.Fatalf("bumped version carried %d stops, want 3", len(v2.Stops))
	}
}

func TestLiveDB_LinkReturnRoute(t *testing.T) {
	pool := catalogPool(t)
	ctx := context.Background()
	geo := seedGeo(t, ctx, pool, 3)
	svc := buscatalog.NewService(pool)
	provider := uuid.NewString()

	out, err := svc.CreateRouteTemplate(ctx, buscatalog.RouteCreateRequest{
		ProviderID: provider, Code: geo.Tag + "-o", Name: "Outbound",
		Stops: stopInputs(geo.Terminals),
	})
	if err != nil {
		t.Fatalf("create outbound: %v", err)
	}
	// Return leg: terminals reversed.
	rev := []string{geo.Terminals[2], geo.Terminals[1], geo.Terminals[0]}
	back, err := svc.CreateRouteTemplate(ctx, buscatalog.RouteCreateRequest{
		ProviderID: provider, Code: geo.Tag + "-b", Name: "Return",
		Stops: stopInputs(rev),
	})
	if err != nil {
		t.Fatalf("create return: %v", err)
	}

	if err := svc.LinkReturnRoute(ctx, out.ID, back.ID); err != nil {
		t.Fatalf("link: %v", err)
	}
	a, _ := svc.GetRouteTemplate(ctx, out.ID)
	b, _ := svc.GetRouteTemplate(ctx, back.ID)
	if a.ReturnRouteID == nil || *a.ReturnRouteID != back.ID ||
		b.ReturnRouteID == nil || *b.ReturnRouteID != out.ID {
		t.Fatalf("pairing not symmetric: %+v / %+v", a.ReturnRouteID, b.ReturnRouteID)
	}
	// Cross-provider pairing refused (provider check fires first).
	other, err := svc.CreateRouteTemplate(ctx, buscatalog.RouteCreateRequest{
		ProviderID: uuid.NewString(), Code: geo.Tag + "-x", Name: "Other",
		Stops: stopInputs(geo.Terminals),
	})
	if err != nil {
		t.Fatalf("create other: %v", err)
	}
	if err := svc.LinkReturnRoute(ctx, out.ID, other.ID); err == nil {
		t.Fatal("cross-provider pairing should be rejected")
	} else {
		isCodedErr(t, err, buscatalog.CodeForbidden)
	}
	// one_way_only refuses pairing.
	oneWay, err := svc.CreateRouteTemplate(ctx, buscatalog.RouteCreateRequest{
		ProviderID: provider, Code: geo.Tag + "-w", Name: "OneWay",
		OneWayOnly: true, Stops: stopInputs(geo.Terminals),
	})
	if err != nil {
		t.Fatalf("create oneway: %v", err)
	}
	if err := svc.LinkReturnRoute(ctx, oneWay.ID, other.ID); err == nil {
		t.Fatal("one_way_only pairing should be rejected")
	}
}

func TestLiveDB_SearchDepartures(t *testing.T) {
	pool := catalogPool(t)
	ctx := context.Background()
	geo := seedGeo(t, ctx, pool, 2)
	svc := buscatalog.NewService(pool)
	provider := uuid.NewString()

	rt, err := svc.CreateRouteTemplate(ctx, buscatalog.RouteCreateRequest{
		ProviderID: provider, Code: geo.Tag + "-s", Name: "Search Route",
		Stops: stopInputs(geo.Terminals),
	})
	if err != nil {
		t.Fatalf("create route: %v", err)
	}
	travel := time.Now().UTC().Add(72 * time.Hour).Truncate(24 * time.Hour)
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.bus_departure
			(provider_id, route_id, route_version, travel_date, depart_at,
			 capacity, status, itinerary_snapshot, fare_snapshot)
		VALUES ($1,$2,1,$3,$4,40,'published','[]','{}')`,
		provider, rt.ID, travel, travel.Add(8*time.Hour)); err != nil {
		t.Fatalf("seed departure: %v", err)
	}

	// The seeded route is a single-city shuttle: origin=dest state. A
	// state-level search (no city filter) matches regardless of fixture names.
	res, err := svc.SearchDepartures(ctx, buscatalog.DepartureSearchRequest{
		OriginState: geo.StateCode, DestState: geo.StateCode, TravelDate: travel,
	})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(res) != 1 {
		t.Fatalf("search returned %d departures, want 1", len(res))
	}
	if res[0].FromSeq != 1 || res[0].ToSeq != 2 {
		t.Fatalf("OD slice = %d→%d, want 1→2", res[0].FromSeq, res[0].ToSeq)
	}
	// A different travel date finds nothing.
	res, err = svc.SearchDepartures(ctx, buscatalog.DepartureSearchRequest{
		OriginState: geo.StateCode, DestState: geo.StateCode,
		TravelDate: travel.Add(48 * time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != 0 {
		t.Fatalf("wrong-date search returned %d, want 0", len(res))
	}
	// Missing params rejected.
	if _, err := svc.SearchDepartures(ctx, buscatalog.DepartureSearchRequest{
		DestState: geo.StateCode, TravelDate: travel,
	}); err == nil {
		t.Fatal("missing origin_state should be rejected")
	}
}
