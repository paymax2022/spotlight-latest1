package paystackcheckout

import (
	"regexp"
	"testing"

	"spotlight/backend/internal/webhooks"
)

// Paystack only accepts letters, digits, '-', '.' and '=' in a transaction
// reference; anything else is refused with "Invalid character in transaction
// reference". The fake Paystack the unit tests run against accepts anything,
// which is how a ':' separator shipped.
var paystackSafeRef = regexp.MustCompile(`^[A-Za-z0-9.=-]+$`)

func TestReferenceFor_IsAcceptedByPaystack(t *testing.T) {
	// The shape the mobile app sends: newIdempotencyKey('food-order-paystack').
	for _, key := range []string{"food-order-paystack-1760000000000-k3j9x2ab", "abc123", "A-B.C=D"} {
		ref := referenceFor(key)
		if !paystackSafeRef.MatchString(ref) {
			t.Fatalf("referenceFor(%q) = %q has characters Paystack rejects", key, ref)
		}
	}
}

// The webhook router matches on its own copy of the prefix (it cannot import
// this package). If the two drift, charge.success events stop confirming orders.
func TestReferencePrefix_MatchesWebhookRouter(t *testing.T) {
	if ReferencePrefix != webhooks.RestaurantOrderReferencePrefix {
		t.Fatalf("ReferencePrefix %q != webhooks.RestaurantOrderReferencePrefix %q", ReferencePrefix, webhooks.RestaurantOrderReferencePrefix)
	}
}
