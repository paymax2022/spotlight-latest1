package transport

// Pure-logic unit tests for the interstate bus PROVIDER MARKETPLACE. DB-free and
// correct-by-construction: they exercise the guards that protect the marketplace
// invariants (interstate-only routing, cross-provider ownership, seat math, and
// the amenities JSON round-trip) via the small extracted seams, so
// `go test ./internal/transport/...` proves them without a Postgres instance.
//
// Companion suites: money_authz_test.go, modes_engine_test.go, split_invariant_test.go.

import (
	"reflect"
	"testing"
)

// ─── 1. Interstate invariant: from != to (search AND route-create) ───────────
//
// sameState is the single decision behind both the search 400 and the
// route-create 400. Equal states (any case / whitespace) must be rejected; a
// different pair (or a blank/open filter) must pass.

func TestSameState_RejectsEqualStates(t *testing.T) {
	if !sameState("Lagos", "Lagos") {
		t.Fatal("identical states must be flagged as the same (reject the route/search)")
	}
	// Case- and whitespace-insensitive: still the same state.
	if !sameState("lagos", "  LAGOS ") {
		t.Fatal("state equality must ignore case and surrounding whitespace")
	}
}

func TestSameState_AllowsDistinctStates(t *testing.T) {
	if sameState("Lagos", "Abuja") {
		t.Fatal("distinct states must NOT be flagged as the same (interstate route is valid)")
	}
}

func TestSameState_BlankFilterIsOpenNotEqual(t *testing.T) {
	// In search a missing state filter means "any" — it must not collapse to an
	// equality rejection.
	if sameState("", "Lagos") || sameState("Lagos", "") || sameState("", "") {
		t.Fatal("a blank state on either side must be treated as open, not as an equal-state rejection")
	}
}

// ─── 2. Cross-provider ownership ─────────────────────────────────────────────
//
// routeOwnedBy is the pure decision behind "provider B cannot edit provider A's
// route". It also rejects unclaimed (legacy admin, provider_id NULL) routes.

func TestRouteOwnedBy_OwnerMayEdit(t *testing.T) {
	owner := "provider-A"
	if !routeOwnedBy(&owner, "provider-A") {
		t.Fatal("a provider must be allowed to edit its own route")
	}
}

func TestRouteOwnedBy_OtherProviderRejected(t *testing.T) {
	owner := "provider-A"
	if routeOwnedBy(&owner, "provider-B") {
		t.Fatal("provider B must NOT be allowed to edit provider A's route")
	}
}

func TestRouteOwnedBy_UnclaimedRouteRejected(t *testing.T) {
	// A legacy admin route has provider_id NULL — no marketplace provider owns it.
	if routeOwnedBy(nil, "provider-A") {
		t.Fatal("a route with no provider_id must not be editable by any provider")
	}
}

// ─── 3. seatsAvailable math ──────────────────────────────────────────────────

func TestSeatsAvailable_SubtractsBooked(t *testing.T) {
	if got := seatsAvailable(14, 5); got != 9 {
		t.Fatalf("seatsAvailable(14,5) = %d, want 9", got)
	}
	if got := seatsAvailable(14, 0); got != 14 {
		t.Fatalf("seatsAvailable(14,0) = %d, want 14", got)
	}
}

func TestSeatsAvailable_FlooredAtZero(t *testing.T) {
	// Overbooking can never surface a negative availability to the client.
	if got := seatsAvailable(14, 20); got != 0 {
		t.Fatalf("seatsAvailable(14,20) = %d, want 0 (floored)", got)
	}
	if got := seatsAvailable(14, 14); got != 0 {
		t.Fatalf("a fully-booked schedule must report 0 seats, got %d", got)
	}
}

// ─── 4. Amenities JSON round-trip ────────────────────────────────────────────
//
// Routes persist amenities as a jsonb array; the customer-facing projection must
// round-trip cleanly and default to an EMPTY (non-nil) array so the mobile client
// never receives null.

func TestAmenities_RoundTrip(t *testing.T) {
	in := []string{"wifi", "ac", "usb"}
	raw, err := marshalAmenities(in)
	if err != nil {
		t.Fatalf("marshalAmenities: %v", err)
	}
	out := unmarshalAmenities([]byte(raw))
	if !reflect.DeepEqual(in, out) {
		t.Fatalf("amenities did not round-trip: in=%v out=%v", in, out)
	}
}

func TestAmenities_NilDefaultsToEmptyArray(t *testing.T) {
	raw, err := marshalAmenities(nil)
	if err != nil {
		t.Fatalf("marshalAmenities(nil): %v", err)
	}
	if raw != "[]" {
		t.Fatalf("nil amenities must marshal to an empty JSON array, got %q", raw)
	}
	if out := unmarshalAmenities(nil); out == nil || len(out) != 0 {
		t.Fatalf("empty amenities column must decode to a non-nil empty slice, got %#v", out)
	}
}

// ─── 5. Slug derivation is stable + URL-safe ─────────────────────────────────

func TestBusProviderSlug_IsURLSafeAndStable(t *testing.T) {
	id := "abcd1234-ef56-7890-abcd-ef1234567890"
	a := busProviderSlug("God Is Good Motors!", id)
	b := busProviderSlug("God Is Good Motors!", id)
	if a != b {
		t.Fatalf("slug must be stable for the same name+id: %q vs %q", a, b)
	}
	if a != "god-is-good-motors-abcd1234" {
		t.Fatalf("unexpected slug %q (must lower-case, dash spaces, drop punctuation, append id prefix)", a)
	}
	// A name with no slug-able characters still yields a usable slug.
	if s := busProviderSlug("!!!", id); s != "provider-abcd1234" {
		t.Fatalf("empty-slug name must fall back to 'provider', got %q", s)
	}
}
