package transport

// Pure-logic unit tests for the multi-modal fare engines and state machines
// (parcel, towing, car hire, business logistics, movers). DB-free and
// deterministic. Values match the seeded transport_pricing_config rows.

import "testing"

func parcelCfg() *PricingConfig {
	return &PricingConfig{ServiceType: "parcel", BaseFareKobo: 40000, PerKMKobo: 9000, PerMinKobo: 1500, MinFareKobo: 100000}
}
func towingCfg() *PricingConfig {
	return &PricingConfig{ServiceType: "towing", BaseFareKobo: 300000, PerKMKobo: 20000, MinFareKobo: 300000}
}
func carHireCfg() *PricingConfig {
	return &PricingConfig{ServiceType: "car_hire", BaseFareKobo: 500000, PerKMKobo: 8000, MinFareKobo: 500000}
}

// ─── Parcel ──────────────────────────────────────────────────────────────────

func TestParcelMultipliers(t *testing.T) {
	if parcelSizeMultiplier("small") != 1.0 || parcelSizeMultiplier("medium") != 1.4 || parcelSizeMultiplier("large") != 2.0 {
		t.Error("parcel size multipliers wrong")
	}
	if parcelSizeMultiplier("???") != 1.0 {
		t.Error("unknown size must default to 1.0")
	}
	if parcelSpeedMultiplier("express") != 1.5 || parcelSpeedMultiplier("scheduled") != 0.9 || parcelSpeedMultiplier("standard") != 1.0 {
		t.Error("parcel speed multipliers wrong")
	}
}

func TestParcelFare_Composition(t *testing.T) {
	// 10km, 20min, medium(1.4) × express(1.5)=2.1:
	// (40000 + 10*9000 + 20*1500) * 2.1 = 160000 * 2.1 = 336000.
	got := parcelFare(10000, 1200, "medium", "express", parcelCfg())
	if got != 336000 {
		t.Fatalf("parcelFare = %d, want 336000", got)
	}
}

func TestParcelFare_FlooredAtMinimum(t *testing.T) {
	got := parcelFare(100, 30, "small", "standard", parcelCfg())
	if got != 100000 {
		t.Fatalf("parcelFare = %d, want min 100000", got)
	}
}

func TestParcelTransitions(t *testing.T) {
	ok := [][2]string{{"created", "courier_assigned"}, {"dropoff_verified", "delivered"}, {"picked_up", "in_transit"}}
	for _, c := range ok {
		if !canTransitionParcel(c[0], c[1]) {
			t.Errorf("expected legal parcel %s→%s", c[0], c[1])
		}
	}
	bad := [][2]string{{"created", "delivered"}, {"picked_up", "delivered"}, {"delivered", "created"}, {"created", "created"}}
	for _, c := range bad {
		if canTransitionParcel(c[0], c[1]) {
			t.Errorf("expected illegal parcel %s→%s", c[0], c[1])
		}
	}
}

// ─── Towing ──────────────────────────────────────────────────────────────────

func TestTowingFare(t *testing.T) {
	if got := towingFare(0, towingCfg()); got != 300000 { // callout only, floored at min
		t.Errorf("towingFare(0) = %d, want 300000", got)
	}
	if got := towingFare(10000, towingCfg()); got != 500000 { // 300000 + 10*20000
		t.Errorf("towingFare(10km) = %d, want 500000", got)
	}
}

func TestTowingTransitions(t *testing.T) {
	if !canTransitionTowing("operator_en_route", "pin_verified") {
		t.Error("en_route→pin_verified must be legal")
	}
	if canTransitionTowing("requested", "in_progress") {
		t.Error("can't start towing before PIN verification")
	}
	if canTransitionTowing("completed", "in_progress") {
		t.Error("completed is terminal")
	}
}

// ─── Car hire ────────────────────────────────────────────────────────────────

func TestCarHireFare(t *testing.T) {
	fare, deposit := carHireFare(24, carHireCfg()) // 500000 + 24*8000 = 692000
	if fare != 692000 {
		t.Errorf("carHire fare(24h) = %d, want 692000", fare)
	}
	if deposit != 500000 { // one base period
		t.Errorf("carHire deposit = %d, want 500000", deposit)
	}
	fare1, _ := carHireFare(1, carHireCfg()) // 508000, above min
	if fare1 != 508000 {
		t.Errorf("carHire fare(1h) = %d, want 508000", fare1)
	}
}

func TestCarHireTransitions(t *testing.T) {
	if !canTransitionCarHire("active", "extended") || !canTransitionCarHire("extended", "completed") {
		t.Error("active→extended→completed must be legal")
	}
	if canTransitionCarHire("requested", "completed") {
		t.Error("can't complete an unstarted hire")
	}
}

// ─── Business logistics ──────────────────────────────────────────────────────

func TestDeliverySizeMultiplier(t *testing.T) {
	if deliverySizeMultiplier("small") != 1.0 || deliverySizeMultiplier("medium") != 1.4 || deliverySizeMultiplier("large") != 2.0 {
		t.Error("delivery size multipliers wrong")
	}
}

func TestDeliveryTransitions(t *testing.T) {
	if !canTransitionDelivery("created", "assigned") || !canTransitionDelivery("picked_up", "delivered") {
		t.Error("created→assigned and picked_up→delivered must be legal")
	}
	if canTransitionDelivery("created", "delivered") {
		t.Error("can't deliver before pickup")
	}
	if canTransitionDelivery("assigned", "failed") == false {
		t.Error("assigned→failed must be legal")
	}
}

// ─── Movers ──────────────────────────────────────────────────────────────────

func TestMoverTransitions(t *testing.T) {
	if !canTransitionMover("bid_accepted", "in_progress") || !canTransitionMover("in_progress", "completion_confirmed") {
		t.Error("bid_accepted→in_progress→completion_confirmed must be legal")
	}
	if canTransitionMover("quote_requested", "completion_confirmed") {
		t.Error("can't confirm completion before a bid is accepted")
	}
	if canTransitionMover("completion_confirmed", "in_progress") {
		t.Error("completion_confirmed is terminal")
	}
}
