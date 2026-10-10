package paystackcheckout

import "testing"

// Paystack rejects an empty email ("email" is not allowed to be empty), and the
// mobile food checkout sends none, so the handler must resolve one itself.
func TestResolveCheckoutEmail(t *testing.T) {
	cases := []struct {
		name, body, account, want string
	}{
		{"client value wins", "a@x.com", "acct@x.com", "a@x.com"},
		{"client value is trimmed", "  a@x.com ", "acct@x.com", "a@x.com"},
		{"falls back to the account email", "", "acct@x.com", "acct@x.com"},
		{"whitespace body counts as empty", "   ", "acct@x.com", "acct@x.com"},
		{"phone-only account gets the shared placeholder", "", "", fallbackCheckoutEmail},
		{"both blank", "  ", "  ", fallbackCheckoutEmail},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolveCheckoutEmail(tc.body, tc.account); got != tc.want {
				t.Fatalf("resolveCheckoutEmail(%q,%q) = %q, want %q", tc.body, tc.account, got, tc.want)
			}
		})
	}
}
