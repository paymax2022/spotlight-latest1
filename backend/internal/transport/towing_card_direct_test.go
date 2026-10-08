package transport

// Pure (DB-free) tests for the TOWING card-direct seam — the towing counterpart
// of card_direct_hardening_test.go. The DB-backed halves live in
// towing_card_direct_live_db_test.go and
// paystackcheckout/towing_live_db_test.go.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
)

func towingReq() TowingBookRequest {
	return TowingBookRequest{
		ServiceType: "tow",
		VehicleType: "sedan",
		IssueType:   "breakdown",
		Pickup:      Place{Lat: 6.50, Lng: 3.40, Address: "3rd Mainland Bridge"},
		Dest:        &Place{Lat: 6.60, Lng: 3.35, Address: "AutoWorks Garage, Ikeja"},
	}
}

// L1: the wallet handler must not accept keys in the card-direct namespaces.
func TestBookTowing_WalletPathRejectsReservedCardDirectPrefixes(t *testing.T) {
	s := &Service{} // must be refused before any DB / settlement use
	for _, key := range []string{
		"towingorder:abc12345", "TOWINGORDER:abc12345", "parcelorder:abc12345", "rideorder:abc12345",
		"foodorder:abc12345", "duespay:abc12345", "feespay:abc12345",
		"moversorder:abc12345", "carhireorder:abc12345", "busorder:abc12345", "eventorder:abc12345",
	} {
		_, err := s.BookTowing(context.Background(), "u1", towingReq(), key)
		ce, ok := errors.AsType[*CodedError](err)
		if !ok || ce.Status != http.StatusBadRequest || ce.Code != "INVALID_IDEMPOTENCY_KEY" {
			t.Errorf("key %q: want 400 INVALID_IDEMPOTENCY_KEY, got %v", key, err)
		}
	}
	// the legacy body-key fallback is checked too
	req := towingReq()
	req.IdempotencyKey = "towingorder:abc12345"
	if _, err := s.BookTowing(context.Background(), "u1", req, ""); err == nil {
		t.Error("a reserved key smuggled via the request body must be refused as well")
	}
}

// L2: one deterministic job id per charge.
func TestExternalTowingID_IsDeterministicPerKey(t *testing.T) {
	a, b := externalTowingID("towingorder:key-1"), externalTowingID("towingorder:key-1")
	if a != b {
		t.Fatalf("same key produced %s and %s: a retry after a crash would escrow under a different 'towing:<id>' reference", a, b)
	}
	if c := externalTowingID("towingorder:key-2"); c == a {
		t.Error("different keys must not share a job id")
	}
	if len(a) != 36 {
		t.Errorf("not a uuid: %q", a)
	}
	// Must not collide with the parcel id derivation for the same key
	// (different namespace) — one key string can never address two entities.
	if externalParcelID("towingorder:key-1") == a {
		t.Error("towing and parcel ids must live in different UUID namespaces")
	}
}

// Validation happens BEFORE pricing so a customer is never charged for a job
// the INSERT (NOT NULL / CHECK constraints) would refuse after the money moved.
func TestValidateTowingBookRequest(t *testing.T) {
	good := towingReq()
	if err := validateTowingBookRequest(good); err != nil {
		t.Fatalf("good request refused: %v", err)
	}
	roadside := towingReq()
	roadside.ServiceType, roadside.Dest = "jumpstart", nil
	if err := validateTowingBookRequest(roadside); err != nil {
		t.Fatalf("roadside (no dest) refused: %v", err)
	}
	empty := towingReq()
	empty.ServiceType = "" // defaults to "tow" exactly like the wallet path
	if err := validateTowingBookRequest(empty); err != nil {
		t.Fatalf("default service type refused: %v", err)
	}
	for name, mut := range map[string]func(*TowingBookRequest){
		"no pickup address":      func(r *TowingBookRequest) { r.Pickup.Address = "" },
		"unknown service type":   func(r *TowingBookRequest) { r.ServiceType = "teleport" },
		"zero pickup coords":     func(r *TowingBookRequest) { r.Pickup.Lat, r.Pickup.Lng = 0, 0 },
		"out-of-range pickup":    func(r *TowingBookRequest) { r.Pickup.Lat = 123 },
		"out-of-range dest":      func(r *TowingBookRequest) { r.Dest.Lng = -400 },
		"dest missing for a tow": func(r *TowingBookRequest) { r.Dest = nil },
	} {
		r := towingReq()
		mut(&r)
		err := validateTowingBookRequest(r)
		ce, ok := errors.AsType[*CodedError](err)
		if !ok || ce.Status != http.StatusBadRequest {
			t.Errorf("%s: want 400 CodedError, got %v", name, err)
		}
	}
}

func TestQuoteTowingBookingFrozen_RejectsInvalidBeforeAnyDBUse(t *testing.T) {
	s := &Service{} // nil db: any pricing read would panic
	bad := towingReq()
	bad.Pickup.Address = ""
	if _, _, err := s.QuoteTowingBookingFrozen(context.Background(), bad); err == nil {
		t.Fatal("must refuse an unbookable request before pricing")
	}
	if _, err := s.QuoteTowingBooking(context.Background(), bad); err == nil {
		t.Fatal("must refuse an unbookable request before pricing")
	}
}

// H8: pricing from frozen inputs is exactly towingFare over those inputs.
func TestTowingPricingFromFrozen(t *testing.T) {
	cfg := PricingConfig{BaseFareKobo: 500_000, PerKMKobo: 12_000, MinFareKobo: 300_000, ServiceType: "towing", Zone: "default"}
	raw, err := json.Marshal(towingFrozenPricing{DistanceM: 12_500, Config: cfg})
	if err != nil {
		t.Fatal(err)
	}
	frozen, err := decodeTowingFrozen(raw)
	if err != nil || frozen == nil {
		t.Fatalf("decode: %v %v", frozen, err)
	}
	pr := towingPricingFromFrozen(frozen)
	if want := towingFare(12_500, &cfg); pr.fare != want || pr.distanceM != 12_500 {
		t.Errorf("fare=%d dist=%d, want %d / 12500", pr.fare, pr.distanceM, want)
	}
	// the snapshot is copied, never aliased
	pr.cfg.BaseFareKobo = 1
	if frozen.Config.BaseFareKobo != 500_000 {
		t.Error("frozen config was aliased into the pricing")
	}
	if f, err := decodeTowingFrozen(nil); f != nil || err != nil {
		t.Errorf("empty frozen must mean live pricing, got %v %v", f, err)
	}
	if _, err := decodeTowingFrozen(json.RawMessage(`{`)); err == nil {
		t.Error("garbage frozen pricing must be an error, never a silent live re-price")
	}
}
