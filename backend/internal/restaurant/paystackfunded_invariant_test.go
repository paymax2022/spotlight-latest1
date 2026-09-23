package restaurant

// TestPlaceOrderRequest_HasNoClientSettableExternalSwitch is a regression guard
// for the property PlaceOrderPaystackFunded's own doc comment depends on:
// "external" and "verifiedAmountKobo" are Go-level parameters, never fields on
// any client-facing request DTO — the ONLY way to reach the tier-gate-skipping
// path is through a server-initiated flow (paystackcheckout) that has already
// verified a real Paystack charge. If a future change ever added a field like
// "external" or "skip_tier_gate" to PlaceOrderRequest (or the wire-level
// json.Unmarshal target the HTTP handler binds into), gin's ShouldBindJSON
// would happily populate it from raw client input, and nothing else in this
// package would stop it from being wired through — this test exists so that
// change fails loudly here instead of shipping silently.
//
// Package restaurant (not restaurant_test): PlaceOrderRequest is exported, but
// keeping this beside the money-path code it protects is deliberate.

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestPlaceOrderRequest_HasNoClientSettableExternalSwitch(t *testing.T) {
	forbidden := []string{"external", "verified", "skiptier", "notier", "bypasstier", "paystackfunded"}

	typ := reflect.TypeOf(PlaceOrderRequest{})
	for i := 0; i < typ.NumField(); i++ {
		f := typ.Field(i)
		jsonTag := f.Tag.Get("json")
		name := strings.ToLower(strings.SplitN(jsonTag, ",", 2)[0])
		fieldName := strings.ToLower(f.Name)
		for _, bad := range forbidden {
			if strings.Contains(name, bad) || strings.Contains(fieldName, bad) {
				t.Errorf("PlaceOrderRequest.%s (json tag %q) looks like a client-settable switch for the external/no-tier-gate path — PlaceOrderPaystackFunded must only ever be reached from a server-verified flow, never from client input on this DTO", f.Name, jsonTag)
			}
		}
	}

	// Belt-and-braces: even a client that sends UNKNOWN extra JSON fields must
	// not be able to influence anything — Gin's ShouldBindJSON ignores fields
	// with no matching struct tag, so this just pins that assumption.
	var probe PlaceOrderRequest
	raw := []byte(`{"delivery_address":"x","items":[],"external":true,"verified_amount_kobo":1,"idempotency_key":"k"}`)
	if err := json.Unmarshal(raw, &probe); err != nil {
		t.Fatalf("unmarshal probe: %v", err)
	}
	// No assertion beyond "this compiles and unmarshals without a field to
	// receive external/verified_amount_kobo" — the reflection scan above is
	// the real guard; this just demonstrates the attack shape a regression
	// would need to reopen.
}
