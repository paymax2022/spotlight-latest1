package crypto

import (
	"context"
	"errors"
	"testing"
)

// Validation runs before any database call, so a service with no pool is enough.
func TestCreateAlertRejectsBadInput(t *testing.T) {
	s := &Service{}
	cases := []struct {
		name string
		in   NewPriceAlert
	}{
		{"unknown condition", NewPriceAlert{AssetID: "BTC", Condition: "sideways", TargetPrice: 100, Currency: "NGN"}},
		{"zero target", NewPriceAlert{AssetID: "BTC", Condition: "above", TargetPrice: 0, Currency: "NGN"}},
		{"negative target", NewPriceAlert{AssetID: "BTC", Condition: "below", TargetPrice: -5, Currency: "NGN"}},
		{"unsupported currency", NewPriceAlert{AssetID: "BTC", Condition: "above", TargetPrice: 100, Currency: "EUR"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := s.CreateAlert(context.Background(), "u1", c.in)
			if !errors.Is(err, ErrInvalidAlert) {
				t.Fatalf("got %v, want ErrInvalidAlert", err)
			}
		})
	}
}
