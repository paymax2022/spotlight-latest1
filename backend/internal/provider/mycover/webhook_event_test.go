package mycover

import "testing"

// MyCover names its callbacks <resource>.<action> — "purchase.successful",
// "policy.updated" — while the internal contract speaks policy.bound /
// policy.cancelled / policy.lapsed / policy.expired. Nothing translated between
// them, so a real delivery verified its signature and was then dropped as an
// "unhandled event type": the webhook worked and did nothing.
//
// Translating is the adapter's job. It is the layer that knows this provider's
// vocabulary; the service owns the internal one.
func TestNormaliseEventType(t *testing.T) {
	cases := []struct {
		in, want, why string
	}{
		{"purchase.successful", "policy.bound",
			"a successful purchase IS a bind; this is the event a real MyCover buy emits"},
		{"PURCHASE.SUCCESSFUL", "policy.bound", "case is not significant"},
		{" purchase.successful ", "policy.bound", "surrounding space is not significant"},

		// Already in the internal vocabulary — pass through untouched.
		{"policy.cancelled", "policy.cancelled", "already contract-shaped"},
		{"policy.expired", "policy.expired", "already contract-shaped"},
		{"claim.settled", "claim.settled", "already contract-shaped"},

		// ⚠️ Deliberately NOT mapped. policyTargetState turns policy.bound into
		// ACTIVE, so translating an ambiguous "updated" into "bound" would
		// reactivate a policy the provider had cancelled. Unhandled-and-logged is
		// the safe failure; wrongly-active is not.
		{"policy.updated", "policy.updated",
			"ambiguous: could be activation, cancellation or a certificate arriving"},
		{"purchase.failed", "purchase.failed", "a failed purchase must not read as a bind"},
		{"", "", "empty stays empty"},
	}

	for _, tc := range cases {
		if got := normaliseEventType(tc.in); got != tc.want {
			t.Errorf("normaliseEventType(%q) = %q, want %q — %s", tc.in, got, tc.want, tc.why)
		}
	}
}

// The mapping must not invent a policy state. Anything this adapter emits that
// policyTargetState would turn into ACTIVE has to be an event that genuinely
// means "this cover is now live".
func TestNormaliseEventType_OnlyRealBindsBecomeBound(t *testing.T) {
	for _, in := range []string{
		"policy.updated", "purchase.failed", "purchase.pending",
		"payment.successful", "policy.renewed", "inspection.completed",
	} {
		if got := normaliseEventType(in); got == "policy.bound" {
			t.Errorf("normaliseEventType(%q) = policy.bound — this would force the policy ACTIVE", in)
		}
	}
}
