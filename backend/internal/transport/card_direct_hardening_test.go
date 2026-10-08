package transport

// Pure (DB-free) tests for the card-direct hardening in the transport layer:
//   L1  wallet idempotency keys may not squat the card-direct namespaces
//   L2  the external parcel id is derived deterministically from the key
//   H5  insert-failure compensation never reverses an escrow on a guess
//   H8  card-direct pricing is frozen at quote time and replayed at booking
// The DB-backed halves live in paystackcheckout/card_direct_hardening_live_db_test.go.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
)

// ── L1 ──────────────────────────────────────────────────────────────────────

func TestBookParcel_WalletPathRejectsReservedCardDirectPrefixes(t *testing.T) {
	s := &Service{} // must be refused before any DB / settlement use
	req := ParcelBookRequest{ProhibitedAck: true}
	for _, key := range []string{
		"parcelorder:abc12345", "rideorder:abc12345", "foodorder:abc12345",
		"duespay:abc12345", "feespay:abc12345",
		"towingorder:abc12345", "moversorder:abc12345", "carhireorder:abc12345", "busorder:abc12345", "eventorder:abc12345",
	} {
		_, err := s.BookParcel(context.Background(), "u1", req, key)
		ce, ok := errors.AsType[*CodedError](err)
		if !ok || ce.Status != http.StatusBadRequest || ce.Code != "INVALID_IDEMPOTENCY_KEY" {
			t.Errorf("key %q: want 400 INVALID_IDEMPOTENCY_KEY, got %v", key, err)
		}
	}
	// the legacy body-key fallback is checked too
	req.IdempotencyKey = "parcelorder:abc12345"
	if _, err := s.BookParcel(context.Background(), "u1", req, ""); err == nil {
		t.Error("a reserved key smuggled via the request body must be refused as well")
	}
}

func TestIsReservedIdempotencyKey_OrdinaryKeysAreNotReserved(t *testing.T) {
	for _, k := range []string{"parcel-1700000000-abcd1234", "parcel:abc", "ride-123", "", "parcelorderx"} {
		if IsReservedIdempotencyKey(k) {
			t.Errorf("%q must remain usable on the wallet path", k)
		}
	}
	if !IsReservedIdempotencyKey("PARCELORDER:x") {
		t.Error("prefix match must be case-insensitive (Paystack references are not case-folded, our keys must not dodge it)")
	}
}

// ── L2 ──────────────────────────────────────────────────────────────────────

func TestExternalParcelID_IsDeterministicPerKey(t *testing.T) {
	a, b := externalParcelID("parcelorder:key-1"), externalParcelID("parcelorder:key-1")
	if a != b {
		t.Fatalf("same key produced %s and %s: a retry after a crash would escrow under a different 'parcel:<id>' reference", a, b)
	}
	if c := externalParcelID("parcelorder:key-2"); c == a {
		t.Error("different keys must not share a parcel id")
	}
	if len(a) != 36 {
		t.Errorf("not a uuid: %q", a)
	}
}

// ── H5 ──────────────────────────────────────────────────────────────────────

func TestResolveExternalInsertFailure(t *testing.T) {
	reversed := 0
	rev := func() error { reversed++; return nil }

	// a concurrent confirm won the unique(idempotency_key): that parcel owns the escrow
	id, did, err := resolveExternalInsertFailure(func() (string, bool, error) { return "p-9", true, nil }, rev)
	if id != "p-9" || did || err != nil || reversed != 0 {
		t.Errorf("found: id=%q reversed=%v err=%v calls=%d", id, did, err, reversed)
	}
	// Find itself failed: we cannot prove no parcel owns the escrow → LEAVE it.
	id, did, err = resolveExternalInsertFailure(func() (string, bool, error) { return "", false, errors.New("db down") }, rev)
	if err == nil || did || reversed != 0 {
		t.Errorf("find error: the escrow must be left alone and the error returned; err=%v reversed=%v calls=%d", err, did, reversed)
	}
	// provably not found → reverse
	_, did, err = resolveExternalInsertFailure(func() (string, bool, error) { return "", false, nil }, rev)
	if err != nil || !did || reversed != 1 {
		t.Errorf("not found: err=%v reversed=%v calls=%d", err, did, reversed)
	}
	// reversal failing is surfaced (the engine then leaves the claim for retry)
	_, _, err = resolveExternalInsertFailure(func() (string, bool, error) { return "", false, nil }, func() error { return errors.New("ledger down") })
	if err == nil {
		t.Error("a failed reversal must be returned, not swallowed")
	}
}

// ── H8 ──────────────────────────────────────────────────────────────────────

type flappingMaps struct {
	MockMaps
	calls     int
	durations []int
}

func (m *flappingMaps) Route(_ context.Context, _, _ LatLng) (RouteResult, error) {
	d := m.durations[m.calls%len(m.durations)]
	m.calls++
	return RouteResult{DistanceM: 9000, DurationS: d}, nil
}

func frozenCfg() PricingConfig {
	return PricingConfig{ID: "cfg-1", Zone: "default", ServiceType: "parcel", Currency: "NGN",
		BaseFareKobo: 40_000, PerKMKobo: 9_000, PerMinKobo: 1_500, MinFareKobo: 100_000}
}

func TestPriceParcelFrozen_UsesFrozenRouteAndConfig_NeverRequeries(t *testing.T) {
	maps := &flappingMaps{durations: []int{600, 1500, 3000}} // traffic-aware: every call differs
	s := &Service{maps: maps}
	req := ParcelBookRequest{ProhibitedAck: true, Size: "small", Speed: "standard",
		Pickup: Place{Lat: 6.5, Lng: 3.4}, Dropoff: Place{Lat: 6.6, Lng: 3.35}}
	cfg := frozenCfg()
	frozen := &parcelFrozenPricing{DistanceM: 9000, DurationS: 600, Config: cfg}

	want := parcelFare(9000, 600, "small", "standard", &cfg)
	for i := 0; i < 3; i++ {
		got, err := s.priceParcelFrozen(context.Background(), req, frozen)
		if err != nil {
			t.Fatal(err)
		}
		if got.fare != want {
			t.Fatalf("call %d: fare %d, want the frozen-input fare %d", i, got.fare, want)
		}
		if got.route.DistanceM != 9000 || got.route.DurationS != 600 {
			t.Errorf("route %+v is not the frozen one", got.route)
		}
	}
	if maps.calls != 0 {
		t.Fatalf("routing was re-queried %d times: a traffic-aware duration change would now cause a spurious amount mismatch (and a refund of a correct charge)", maps.calls)
	}
}

func TestFrozenPricing_RoundTripsThroughJSON(t *testing.T) {
	in := parcelFrozenPricing{DistanceM: 9000, DurationS: 600, Config: frozenCfg()}
	b, err := json.Marshal(in)
	if err != nil {
		t.Fatal(err)
	}
	var out parcelFrozenPricing
	if err := json.Unmarshal(b, &out); err != nil || out != in {
		t.Fatalf("round trip lost data: %+v vs %+v (%v)", out, in, err)
	}
}
