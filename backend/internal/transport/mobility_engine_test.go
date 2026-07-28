package transport

// Pure-logic unit tests for the mobility fare engine, negotiation guards, trip
// state machine, and the mock maps adapter. These cover the PRD acceptance
// invariants without a database, so `go test ./internal/transport/...` is fast
// and deterministic in CI.

import (
	"context"
	"net/http"
	"testing"
)

func testPricingCfg() *PricingConfig {
	return &PricingConfig{
		Zone:                  "default",
		ServiceType:           "ride_hailing",
		Currency:              "NGN",
		BaseFareKobo:          50000,  // ₦500
		PerKMKobo:             12000,  // ₦120/km
		PerMinKobo:            2500,   // ₦25/min
		MinFareKobo:           150000, // ₦1,500
		FareFloorPct:          0.85,
		FareCeilingPct:        1.50,
		DriverProfitFloorKobo: 120000, // ₦1,200
		SurgeMultiplier:       1.0,
	}
}

// ─── SystemFare ──────────────────────────────────────────────────────────────

func TestSystemFare_Composition(t *testing.T) {
	cfg := testPricingCfg()
	// 10 km, 20 min: 50000 + 10*12000 + 20*2500 = 50000+120000+50000 = 220000.
	got := SystemFare(10000, 1200, cfg)
	if got != 220000 {
		t.Fatalf("SystemFare = %d, want 220000", got)
	}
}

func TestSystemFare_FlooredAtMinimum(t *testing.T) {
	cfg := testPricingCfg()
	// A trivially short trip must never price below the minimum fare.
	got := SystemFare(100, 30, cfg)
	if got != cfg.MinFareKobo {
		t.Fatalf("SystemFare = %d, want min %d", got, cfg.MinFareKobo)
	}
}

func TestSystemFare_SurgeApplied(t *testing.T) {
	cfg := testPricingCfg()
	cfg.SurgeMultiplier = 2.0
	base := SystemFare(10000, 1200, testPricingCfg())
	surged := SystemFare(10000, 1200, cfg)
	if surged <= base {
		t.Fatalf("surge fare %d should exceed base fare %d", surged, base)
	}
}

// ─── offerBounds + range validation ──────────────────────────────────────────

func TestOfferBounds(t *testing.T) {
	cfg := testPricingCfg()
	min, max := offerBounds(200000, cfg)
	if min != 170000 { // 85%
		t.Errorf("min = %d, want 170000", min)
	}
	if max != 300000 { // 150%
		t.Errorf("max = %d, want 300000", max)
	}
}

func TestValidateFareInRange(t *testing.T) {
	cfg := testPricingCfg()
	system := int64(200000)
	cases := []struct {
		name    string
		offer   int64
		wantErr bool
		code    string
	}{
		{"at floor", 170000, false, ""},
		{"mid range", 220000, false, ""},
		{"at ceiling", 300000, false, ""},
		{"below floor", 169999, true, CodeFareBelowFloor},
		{"above ceiling", 300001, true, CodeFareAboveCeiling},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateFareInRange(tc.offer, system, cfg)
			if tc.wantErr && err == nil {
				t.Fatalf("expected error for offer %d", tc.offer)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("unexpected error for offer %d: %v", tc.offer, err)
			}
			if tc.wantErr {
				ce, ok := err.(*CodedError)
				if !ok {
					t.Fatalf("expected *CodedError, got %T", err)
				}
				if ce.Status != http.StatusUnprocessableEntity {
					t.Errorf("status = %d, want 422", ce.Status)
				}
				if ce.Code != tc.code {
					t.Errorf("code = %q, want %q", ce.Code, tc.code)
				}
			}
		})
	}
}

// ─── Driver-profit floor (the core differentiator) ───────────────────────────

func TestEnforceDriverProfitFloor(t *testing.T) {
	cfg := testPricingCfg() // profit floor ₦1,200; floor enforced on driver NET
	comm := &CommissionConfig{Tier: "standard", ProviderPct: 0.80, PlatformPct: 0.20}

	// Accepted fare 150000 → driver net = 120000 = floor exactly → allowed.
	if err := enforceDriverProfitFloor(150000, comm, cfg); err != nil {
		t.Fatalf("fare at exact floor should be allowed, got %v", err)
	}
	// Accepted fare 149000 → driver net = 119200 < 120000 → rejected 422.
	err := enforceDriverProfitFloor(149000, comm, cfg)
	if err == nil {
		t.Fatal("fare below driver-profit floor must be rejected")
	}
	ce, ok := err.(*CodedError)
	if !ok || ce.Status != http.StatusUnprocessableEntity || ce.Code != CodeProfitFloor {
		t.Fatalf("want 422 FARE_BELOW_FLOOR, got %+v", err)
	}
}

func TestProfitFloor_LowerCommissionAllowsLowerFare(t *testing.T) {
	cfg := testPricingCfg()
	// A driver on the 'low' commission tier (88% provider) keeps more, so the
	// same low fare can clear the profit floor where 'standard' would not.
	low := &CommissionConfig{Tier: "low", ProviderPct: 0.88, PlatformPct: 0.12}
	std := &CommissionConfig{Tier: "standard", ProviderPct: 0.80, PlatformPct: 0.20}
	fare := int64(140000)
	if err := enforceDriverProfitFloor(fare, std, cfg); err == nil {
		t.Fatal("standard tier should reject 140000 (net 112000 < 120000)")
	}
	if err := enforceDriverProfitFloor(fare, low, cfg); err != nil {
		t.Fatalf("low tier should allow 140000 (net 123200 >= 120000), got %v", err)
	}
}

// ─── Trip state machine ──────────────────────────────────────────────────────

func TestCanTransition_HappyPath(t *testing.T) {
	path := []TripPhase{
		PhaseRequested, PhaseDriverAssigned, PhaseDriverArriving,
		PhasePinVerified, PhaseInProgress, PhaseCompleted,
	}
	for i := 0; i+1 < len(path); i++ {
		if !canTransition(path[i], path[i+1]) {
			t.Errorf("expected legal transition %s → %s", path[i], path[i+1])
		}
	}
}

func TestCanTransition_IllegalRejected(t *testing.T) {
	illegal := [][2]TripPhase{
		{PhaseRequested, PhaseInProgress},   // can't skip assignment + PIN
		{PhaseRequested, PhaseCompleted},    // can't complete an unstarted trip
		{PhaseDriverArriving, PhaseInProgress}, // PIN must be verified first
		{PhaseCompleted, PhaseInProgress},   // terminal state is final
		{PhaseCompleted, PhaseCancelled},    // can't cancel a completed trip
		{PhaseInProgress, PhaseCancelled},   // in-progress rides aren't cancellable here
	}
	for _, tc := range illegal {
		if canTransition(tc[0], tc[1]) {
			t.Errorf("expected illegal transition %s → %s to be rejected", tc[0], tc[1])
		}
	}
}

func TestCanTransition_SameStateRejected(t *testing.T) {
	if canTransition(PhaseInProgress, PhaseInProgress) {
		t.Error("self-transition must be rejected")
	}
}

func TestCanTransition_CancellableEarlyPhases(t *testing.T) {
	for _, p := range []TripPhase{PhaseRequested, PhaseDriverAssigned, PhaseDriverArriving, PhasePinVerified} {
		if !canTransition(p, PhaseCancelled) {
			t.Errorf("phase %s should be cancellable", p)
		}
	}
}

func TestCanTransition_SafetyHoldFromActive(t *testing.T) {
	if !canTransition(PhaseInProgress, PhaseSafetyHold) {
		t.Error("an in-progress trip must be able to enter safety_hold")
	}
}

// ─── Mock maps adapter ───────────────────────────────────────────────────────

func TestMockMaps_RouteDeterministic(t *testing.T) {
	m := NewMockMaps()
	from := LatLng{Lat: 6.45, Lng: 3.39}
	to := LatLng{Lat: 6.60, Lng: 3.50}
	r1, err := m.Route(context.Background(), from, to)
	if err != nil {
		t.Fatal(err)
	}
	r2, _ := m.Route(context.Background(), from, to)
	if r1 != r2 {
		t.Fatal("mock route must be deterministic")
	}
	if r1.DistanceM <= 0 || r1.DurationS <= 0 {
		t.Fatalf("expected positive distance/duration, got %+v", r1)
	}
}

func TestMockMaps_ETAMatchesRoute(t *testing.T) {
	m := NewMockMaps()
	from := LatLng{Lat: 6.45, Lng: 3.39}
	to := LatLng{Lat: 6.50, Lng: 3.42}
	route, _ := m.Route(context.Background(), from, to)
	eta, _ := m.ETA(context.Background(), from, to)
	if eta != route.DurationS {
		t.Errorf("ETA %d should match route duration %d", eta, route.DurationS)
	}
}

func TestMockMaps_GeocodeStable(t *testing.T) {
	m := NewMockMaps()
	a, err := m.Geocode(context.Background(), "12 Marina, Lagos")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := m.Geocode(context.Background(), "12 Marina, Lagos")
	if a != b {
		t.Error("geocode must be stable for the same address")
	}
	if _, err := m.Geocode(context.Background(), ""); err == nil {
		t.Error("empty address should error")
	}
}

// ─── Commission split integrity ──────────────────────────────────────────────

func TestCommissionSplitsSumToWhole(t *testing.T) {
	cases := []CommissionConfig{
		{Tier: "standard", ProviderPct: 0.80, PlatformPct: 0.20},
		{Tier: "low", ProviderPct: 0.88, PlatformPct: 0.12},
		{Tier: "fleet", ProviderPct: 0.85, PlatformPct: 0.15},
	}
	for _, c := range cases {
		if sum := c.ProviderPct + c.PlatformPct; sum < 0.999 || sum > 1.001 {
			t.Errorf("tier %s split sums to %.3f, want 1.0", c.Tier, sum)
		}
	}
}
