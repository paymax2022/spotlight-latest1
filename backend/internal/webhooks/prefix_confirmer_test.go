package webhooks

import (
	"context"
	"encoding/json"
	"testing"
)

type recConfirmer struct{ refs []string }

func (r *recConfirmer) OnChargeSuccess(_ context.Context, reference, _ string) (any, error) {
	r.refs = append(r.refs, reference)
	return nil, nil
}

func charge(t *testing.T, ref string) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(map[string]any{"reference": ref, "amount": 1000})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// A registered prefix must route to ITS confirmer only, ahead of the
// wallet/VA fallbacks (which are nil here — a mis-route would nil-panic).
func TestRegisterPrefixConfirmer_RoutesByPrefix(t *testing.T) {
	h := &PaystackHandler{}
	parcel, bus := &recConfirmer{}, &recConfirmer{}
	h.RegisterPrefixConfirmer("parcelorder:", parcel)
	h.RegisterPrefixConfirmer("busorder:", bus)
	h.RegisterPrefixConfirmer("", &recConfirmer{}) // ignored
	h.RegisterPrefixConfirmer("x:", nil)           // ignored

	if err := h.handleChargeSuccess(context.Background(), charge(t, "parcelorder:abc")); err != nil {
		t.Fatal(err)
	}
	if err := h.handleChargeSuccess(context.Background(), charge(t, "busorder:def")); err != nil {
		t.Fatal(err)
	}
	if len(parcel.refs) != 1 || parcel.refs[0] != "parcelorder:abc" || len(bus.refs) != 1 || bus.refs[0] != "busorder:def" {
		t.Errorf("parcel=%v bus=%v", parcel.refs, bus.refs)
	}
	if len(h.prefixConfirmers) != 2 {
		t.Errorf("empty prefix / nil confirmer must be ignored, have %d", len(h.prefixConfirmers))
	}
}

// The legacy per-module prefixes keep winning over a generic registration, so
// registering a generic prefix can never hijack an existing module's money.
func TestRegisterPrefixConfirmer_LegacyPrefixesStillWin(t *testing.T) {
	h := &PaystackHandler{}
	hijack := &recConfirmer{}
	h.RegisterPrefixConfirmer(RideOrderReferencePrefix, hijack)
	ride := &recConfirmer{}
	h.SetRideOrderConfirmer(ride)
	if err := h.handleChargeSuccess(context.Background(), charge(t, "rideorder:k")); err != nil {
		t.Fatal(err)
	}
	if len(ride.refs) != 1 || len(hijack.refs) != 0 {
		t.Errorf("ride=%v hijack=%v", ride.refs, hijack.refs)
	}
}
