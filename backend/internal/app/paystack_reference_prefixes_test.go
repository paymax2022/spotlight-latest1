package app

import (
	"regexp"
	"testing"

	feespay "spotlight/backend/internal/academy/fees/payment"
	estatepay "spotlight/backend/internal/estate/paystackcheckout"
	restpay "spotlight/backend/internal/restaurant/paystackcheckout"
	"spotlight/backend/internal/top5events"
	transportpay "spotlight/backend/internal/transport/paystackcheckout"
	"spotlight/backend/internal/webhooks"
)

// Paystack refuses a transaction reference containing anything but letters,
// digits, '-', '.' and '=' ("Invalid character in transaction reference"). The
// fake Paystack the unit tests use accepts any string, which is how ':'
// separators shipped on every card-checkout rail. Every rail's prefix must be a
// lowercase word ending in a single '-'.
var legalRefPrefix = regexp.MustCompile(`^[a-z0-9]+-$`)

func TestPaystackReferencePrefixes_AreLegalAndMatchTheWebhookRouter(t *testing.T) {
	cases := []struct {
		rail, prefix, webhookCopy string
	}{
		{"restaurant", restpay.ReferencePrefix, webhooks.RestaurantOrderReferencePrefix},
		{"transport ride", transportpay.ReferencePrefix, webhooks.RideOrderReferencePrefix},
		{"estate dues", estatepay.ReferencePrefix, webhooks.DuesOrderReferencePrefix},
		{"academy fees", feespay.ReferencePrefix, webhooks.FeesReferencePrefix},
		{"parcel", transportpay.ParcelReferencePrefix, ""},
		{"towing", transportpay.TowingReferencePrefix, ""},
		{"movers", transportpay.MoversReferencePrefix, ""},
		{"car hire", transportpay.CarHireReferencePrefix, ""},
		{"events tickets", top5events.CardReferencePrefix, ""},
	}
	seen := map[string]string{}
	for _, c := range cases {
		if !legalRefPrefix.MatchString(c.prefix) {
			t.Errorf("%s prefix %q is not Paystack-legal (want ^[a-z0-9]+-$)", c.rail, c.prefix)
		}
		if c.webhookCopy != "" && c.webhookCopy != c.prefix {
			t.Errorf("%s: webhook router prefix %q != package prefix %q — charge.success would stop confirming orders", c.rail, c.webhookCopy, c.prefix)
		}
		if other, dup := seen[c.prefix]; dup {
			t.Errorf("%s and %s share prefix %q", c.rail, other, c.prefix)
		}
		seen[c.prefix] = c.rail
	}
}
