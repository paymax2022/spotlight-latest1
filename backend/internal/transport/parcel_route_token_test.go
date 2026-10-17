package transport

// DB-free tests for the parcel route token: the estimate signs the route it
// priced so the wallet booking can price from the SAME distance/duration
// (live config, frozen route). A token that does not verify is ignored —
// never trusted — so a client cannot shorten its own route.

import (
	"context"
	"strings"
	"testing"
	"time"
)

const testRouteSecret = "test-parcel-route-token-secret-0123456789"

var (
	tokPickup  = Place{Lat: 6.5, Lng: 3.4, Address: "A"}
	tokDropoff = Place{Lat: 6.6, Lng: 3.35, Address: "B"}
)

func TestParcelRouteToken_RoundTrip(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	tok := signParcelRoute(testRouteSecret, tokPickup, tokDropoff, RouteResult{DistanceM: 12345, DurationS: 1500}, now)
	if tok == "" {
		t.Fatal("want a token")
	}
	r, ok := verifyParcelRoute(testRouteSecret, tok, tokPickup, tokDropoff, now.Add(14*time.Minute))
	if !ok || r.DistanceM != 12345 || r.DurationS != 1500 {
		t.Fatalf("round trip: ok=%v route=%+v", ok, r)
	}
}

func TestParcelRouteToken_Rejects(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	tok := signParcelRoute(testRouteSecret, tokPickup, tokDropoff, RouteResult{DistanceM: 12345, DurationS: 1500}, now)
	payload, sig, _ := strings.Cut(tok, ".")
	// A token whose payload claims a shorter route, re-using the original signature.
	short := signParcelRoute(testRouteSecret, tokPickup, tokDropoff, RouteResult{DistanceM: 1, DurationS: 1}, now)
	shortPayload, _, _ := strings.Cut(short, ".")

	cases := []struct {
		name            string
		secret, token   string
		pickup, dropoff Place
		at              time.Time
	}{
		{"expired", testRouteSecret, tok, tokPickup, tokDropoff, now.Add(parcelRouteTokenTTL + time.Second)},
		{"wrong secret", "another-secret-another-secret-another", tok, tokPickup, tokDropoff, now},
		{"swapped payload", testRouteSecret, shortPayload + "." + sig, tokPickup, tokDropoff, now},
		{"flipped signature", testRouteSecret, payload + "." + strings.Repeat("0", len(sig)), tokPickup, tokDropoff, now},
		{"different pickup", testRouteSecret, tok, Place{Lat: 6.51, Lng: 3.4}, tokDropoff, now},
		{"different dropoff", testRouteSecret, tok, tokPickup, Place{Lat: 6.6, Lng: 3.36}, now},
		{"empty token", testRouteSecret, "", tokPickup, tokDropoff, now},
		{"garbage", testRouteSecret, "not-a-token", tokPickup, tokDropoff, now},
		{"no secret configured", "", tok, tokPickup, tokDropoff, now},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, ok := verifyParcelRoute(c.secret, c.token, c.pickup, c.dropoff, c.at); ok {
				t.Fatal("must not verify")
			}
		})
	}
}

func TestParcelRouteToken_NoSecretNoToken(t *testing.T) {
	if tok := signParcelRoute("", tokPickup, tokDropoff, RouteResult{DistanceM: 1, DurationS: 1}, time.Now()); tok != "" {
		t.Fatalf("no secret must issue no token, got %q", tok)
	}
}

// driftMaps returns a longer duration on every call, like a traffic-aware
// provider whose cache expired between estimate and booking.
type driftMaps struct {
	MockMaps
	calls int
}

func (d *driftMaps) Route(ctx context.Context, from, to LatLng) (RouteResult, error) {
	d.calls++
	return RouteResult{DistanceM: 12000, DurationS: 1200 + 300*d.calls}, nil
}

func TestParcelRouteForBooking_UsesTokenRouteNotALiveCall(t *testing.T) {
	m := &driftMaps{}
	s := (&Service{maps: m}).WithParcelRouteTokenSecret(testRouteSecret)
	est := RouteResult{DistanceM: 12000, DurationS: 1500}
	tok := signParcelRoute(testRouteSecret, tokPickup, tokDropoff, est, time.Now())

	r, err := s.parcelRouteForBooking(context.Background(), ParcelBookRequest{Pickup: tokPickup, Dropoff: tokDropoff, RouteToken: tok})
	if err != nil || r != est || m.calls != 0 {
		t.Fatalf("valid token: route=%+v err=%v maps calls=%d, want the token route and no call", r, err, m.calls)
	}
	r, err = s.parcelRouteForBooking(context.Background(), ParcelBookRequest{Pickup: tokPickup, Dropoff: tokDropoff, RouteToken: "forged.sig"})
	if err != nil || m.calls != 1 || r.DurationS != 1500 {
		t.Fatalf("bad token must fall back to a live route: route=%+v err=%v calls=%d", r, err, m.calls)
	}
}

func TestWithParcelRouteTokenSecret_RejectsShortSecret(t *testing.T) {
	s := (&Service{}).WithParcelRouteTokenSecret("too-short")
	if s.parcelRouteSecret != "" {
		t.Fatal("a secret under 32 bytes must leave tokens off")
	}
}
