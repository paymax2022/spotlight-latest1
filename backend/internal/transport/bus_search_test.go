package transport

import (
	"strings"
	"testing"
)

func TestBuildBusTripSearchWhere_InterDefault(t *testing.T) {
	where, args, err := buildBusTripSearchWhere(BusTripSearch{FromState: "Lagos", ToState: "Oyo"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(where, "r.from_state ILIKE $1") || !strings.Contains(where, "r.to_state ILIKE $2") {
		t.Fatalf("where = %q", where)
	}
	if len(args) != 2 || args[1] != "Oyo" {
		t.Fatalf("args = %v", args)
	}
	if _, _, err := buildBusTripSearchWhere(BusTripSearch{FromState: "Lagos", ToState: " lagos "}); err == nil {
		t.Fatal("inter search with the same state must be rejected")
	}
}

func TestBuildBusTripSearchWhere_Intra(t *testing.T) {
	where, args, err := buildBusTripSearchWhere(BusTripSearch{
		FromState: "Oyo", ToState: "Oyo", TripKind: "intra", FromCity: " Ibadan ", ToCity: "Ogbomosho",
	})
	if err != nil {
		t.Fatal(err)
	}
	// Both state columns pin to the one state; cities are lower-cased, trimmed
	// and bound once each (the bidirectional clause reuses the same $n).
	for _, want := range []string{"r.from_state ILIKE $1", "r.to_state ILIKE $2",
		"strpos(lower(COALESCE(r.from_city, r.origin_terminal)), $3) > 0 OR strpos($3,",
		"strpos(lower(COALESCE(r.to_city, r.dest_terminal)), $4) > 0 OR strpos($4,"} {
		if !strings.Contains(where, want) {
			t.Fatalf("missing %q in %q", want, where)
		}
	}
	if len(args) != 4 || args[2] != "ibadan" || args[3] != "ogbomosho" {
		t.Fatalf("args = %v", args)
	}
	if _, _, err := buildBusTripSearchWhere(BusTripSearch{FromState: "Oyo", ToState: "Lagos", TripKind: "intra"}); err == nil {
		t.Fatal("intra search across two states must be rejected")
	}
	if _, _, err := buildBusTripSearchWhere(BusTripSearch{TripKind: "intra"}); err == nil {
		t.Fatal("intra search needs a state")
	}
}

func TestBuildBusTripSearchWhere_Validation(t *testing.T) {
	if _, _, err := buildBusTripSearchWhere(BusTripSearch{TripKind: "air"}); err == nil {
		t.Fatal("unknown tripKind must be rejected")
	}
	if _, _, err := buildBusTripSearchWhere(BusTripSearch{Date: "29/10/2026"}); err == nil {
		t.Fatal("non-ISO date must be rejected")
	}
	where, args, err := buildBusTripSearchWhere(BusTripSearch{FromCity: "x%'; DROP TABLE bus_routes; --", ProviderID: "p1", Date: "2026-10-29"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(where, "DROP") || len(args) != 3 {
		t.Fatalf("user input leaked into SQL: %q %v", where, args)
	}
}
