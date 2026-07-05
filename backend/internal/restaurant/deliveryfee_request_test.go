package restaurant

import "testing"

func f64(v float64) *float64 { return &v }

// PlaceOrderRequest.DeliveryCoords normalizes flat vs nested coordinate inputs.
func TestDeliveryCoords_Normalization(t *testing.T) {
	// Flat fields present → used directly.
	if lat, lng, ok := (PlaceOrderRequest{DeliveryLat: f64(6.5), DeliveryLng: f64(3.4)}).DeliveryCoords(); !ok || lat != 6.5 || lng != 3.4 {
		t.Fatalf("flat coords: got (%v,%v,%v)", lat, lng, ok)
	}

	// Nested delivery_location only → used.
	if lat, lng, ok := (PlaceOrderRequest{DeliveryLocation: &LatLng{Lat: 6.6, Lng: 3.3}}).DeliveryCoords(); !ok || lat != 6.6 || lng != 3.3 {
		t.Fatalf("nested coords: got (%v,%v,%v)", lat, lng, ok)
	}

	// Flat takes precedence over nested when both are present.
	req := PlaceOrderRequest{DeliveryLat: f64(1), DeliveryLng: f64(2), DeliveryLocation: &LatLng{Lat: 9, Lng: 9}}
	if lat, lng, ok := req.DeliveryCoords(); !ok || lat != 1 || lng != 2 {
		t.Fatalf("flat should win: got (%v,%v,%v)", lat, lng, ok)
	}

	// Neither present → fall back (ok=false).
	if _, _, ok := (PlaceOrderRequest{}).DeliveryCoords(); ok {
		t.Fatal("no coords should report ok=false")
	}

	// Only one flat field present → not a complete pair → fall back.
	if _, _, ok := (PlaceOrderRequest{DeliveryLat: f64(6.5)}).DeliveryCoords(); ok {
		t.Fatal("partial flat coords should report ok=false")
	}
}
