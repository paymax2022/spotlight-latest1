package transport

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"log"
	"strings"
	"time"

	"spotlight/backend/go-common/cryptox"
)

// Parcel route token: the estimate signs the route it priced (distance,
// duration, pickup, dropoff, expiry) and the wallet booking prices from that
// route instead of a fresh routing call. With a traffic-aware provider the
// duration — and so the fare — moves between estimate and booking even when no
// price changed, which made expected_fare_kobo refuse bookings for nothing.
// The card-direct rail solves the same problem by freezing its quote.
//
// Only the ROUTE is frozen: the pricing config and rate card are re-read live,
// so a real price change is still refused with FARE_CHANGED. The token is
// HMAC-signed, so a client cannot shorten its own route; one that does not
// verify is ignored and the route is fetched live (today's behaviour).
// Off unless PARCEL_ROUTE_TOKEN_SECRET (>= 32 bytes) is set.

const (
	parcelRouteTokenTTL       = 15 * time.Minute
	minParcelRouteSecretBytes = 32
)

type parcelRouteClaims struct {
	PickupLat  float64 `json:"pa"`
	PickupLng  float64 `json:"po"`
	DropoffLat float64 `json:"da"`
	DropoffLng float64 `json:"do"`
	DistanceM  int     `json:"d"`
	DurationS  int     `json:"t"`
	ExpiresAt  int64   `json:"e"`
}

// WithParcelRouteTokenSecret turns route tokens on. A secret shorter than 32
// bytes is refused (tokens stay off) rather than signing with a weak key.
func (s *Service) WithParcelRouteTokenSecret(secret string) *Service {
	if secret != "" && len(secret) < minParcelRouteSecretBytes {
		log.Printf("[transport] PARCEL_ROUTE_TOKEN_SECRET shorter than %d bytes — parcel route tokens disabled", minParcelRouteSecretBytes)
		secret = ""
	}
	s.parcelRouteSecret = secret
	return s
}

// signParcelRoute returns "<base64url payload>.<hex hmac>", or "" with no secret.
func signParcelRoute(secret string, pickup, dropoff Place, route RouteResult, now time.Time) string {
	if secret == "" {
		return ""
	}
	payload, err := json.Marshal(parcelRouteClaims{
		PickupLat: pickup.Lat, PickupLng: pickup.Lng, DropoffLat: dropoff.Lat, DropoffLng: dropoff.Lng,
		DistanceM: route.DistanceM, DurationS: route.DurationS, ExpiresAt: now.Add(parcelRouteTokenTTL).Unix(),
	})
	if err != nil {
		return ""
	}
	p := base64.RawURLEncoding.EncodeToString(payload)
	return p + "." + cryptox.HMACSHA256Hex(secret, "parcel-route", p)
}

// verifyParcelRoute returns the signed route when the token is authentic,
// unexpired and was issued for exactly this pickup and dropoff.
func verifyParcelRoute(secret, token string, pickup, dropoff Place, now time.Time) (RouteResult, bool) {
	if secret == "" || token == "" {
		return RouteResult{}, false
	}
	p, sig, ok := strings.Cut(token, ".")
	if !ok || !cryptox.ConstantTimeEqual(sig, cryptox.HMACSHA256Hex(secret, "parcel-route", p)) {
		return RouteResult{}, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(p)
	if err != nil {
		return RouteResult{}, false
	}
	var c parcelRouteClaims
	if err := json.Unmarshal(raw, &c); err != nil {
		return RouteResult{}, false
	}
	if now.Unix() > c.ExpiresAt ||
		c.PickupLat != pickup.Lat || c.PickupLng != pickup.Lng ||
		c.DropoffLat != dropoff.Lat || c.DropoffLng != dropoff.Lng ||
		c.DistanceM <= 0 || c.DurationS < 0 {
		return RouteResult{}, false
	}
	return RouteResult{DistanceM: c.DistanceM, DurationS: c.DurationS}, true
}

// parcelRouteForBooking is the wallet booking's route: the estimate's signed
// route when the token verifies, else a live routing call.
func (s *Service) parcelRouteForBooking(ctx context.Context, req ParcelBookRequest) (RouteResult, error) {
	if r, ok := verifyParcelRoute(s.parcelRouteSecret, req.RouteToken, req.Pickup, req.Dropoff, time.Now()); ok {
		return r, nil
	}
	return s.maps.Route(ctx,
		LatLng{Lat: req.Pickup.Lat, Lng: req.Pickup.Lng},
		LatLng{Lat: req.Dropoff.Lat, Lng: req.Dropoff.Lng},
	)
}
