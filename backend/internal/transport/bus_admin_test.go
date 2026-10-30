package transport

import (
	"strings"
	"testing"
)

func TestBuildBusScheduleAdminWhere_Empty(t *testing.T) {
	where, args, err := buildBusScheduleAdminWhere(BusScheduleAdminFilter{})
	if err != nil || where != "" || len(args) != 0 {
		t.Fatalf("empty filter: where=%q args=%v err=%v", where, args, err)
	}
}

func TestBuildBusScheduleAdminWhere_AllFilters(t *testing.T) {
	f := false
	where, args, err := buildBusScheduleAdminWhere(BusScheduleAdminFilter{
		RouteID: "r1", ProviderID: "p1", Status: "scheduled", FareApproved: &f,
		From: "2026-10-01", To: "2026-10-31",
	})
	if err != nil {
		t.Fatal(err)
	}
	for i, want := range []string{"s.route_id::text = $1", "r.provider_id::text = $2", "s.status = $3",
		"s.fare_approved = $4", "s.departure_time::date >= $5::date", "s.departure_time::date <= $6::date"} {
		if !strings.Contains(where, want) {
			t.Fatalf("clause %d %q missing from %q", i, want, where)
		}
	}
	if len(args) != 6 || args[3] != false {
		t.Fatalf("args = %v", args)
	}
}

func TestBuildBusScheduleAdminWhere_RejectsBadInput(t *testing.T) {
	if _, _, err := buildBusScheduleAdminWhere(BusScheduleAdminFilter{Status: "bogus"}); err == nil {
		t.Fatal("unknown status must be rejected")
	}
	if _, _, err := buildBusScheduleAdminWhere(BusScheduleAdminFilter{From: "10/01/2026"}); err == nil {
		t.Fatal("non-ISO date must be rejected")
	}
	// User input is never interpolated into SQL.
	where, _, err := buildBusScheduleAdminWhere(BusScheduleAdminFilter{RouteID: "x' OR 1=1 --"})
	if err != nil || strings.Contains(where, "OR 1=1") {
		t.Fatalf("route id leaked into SQL: %q", where)
	}
}
