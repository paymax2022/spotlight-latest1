package mycover

import (
	"encoding/json"
	"testing"
	"time"

	"spotlight/backend/internal/insurance/gateway"
)

// A MyCover policy carries NO status/policy_status/state field. Liveness is the
// boolean `is_active`, which the catalog path already reads but the policy path
// never did — so every policy we bound was stored with an empty status. Verified
// against all five real test-mode policies on the live account: the payload keys
// are activation_date, expiration_date, is_active, policy_number, certificate_url,
// total_premium … and no status of any kind.
//
// Payloads below are the real shape with PII removed.
func TestPolicyFromData_StatusComesFromIsActive(t *testing.T) {
	c := &Client{}
	future := time.Now().AddDate(0, 6, 0).UTC().Format(time.RFC3339)
	past := time.Now().AddDate(0, -6, 0).UTC().Format(time.RFC3339)

	cases := []struct {
		name string
		body string
		want string
	}{
		{
			name: "live policy is active",
			body: `{"id":"882c4ab2","policy_number":"TESTACC/AR/08/2026/HQ/8459","is_active":true,
			        "start_date":"2026-08-31T16:40:19.000Z","expiration_date":"` + future + `"}`,
			want: "active",
		},
		{
			// Not active and the cover window has closed: that is expired, and we can
			// say so from the dates without the provider telling us.
			name: "inactive and past its expiry is expired",
			body: `{"id":"a13a3358","is_active":false,"expiration_date":"` + past + `"}`,
			want: "expired",
		},
		{
			// Not active but still inside its window. MyCover does not distinguish
			// cancelled from lapsed here, so claiming either would be inventing a
			// fact. "inactive" is the honest answer.
			name: "inactive inside its window is inactive, not guessed",
			body: `{"id":"fb6b80de","is_active":false,"expiration_date":"` + future + `"}`,
			want: "inactive",
		},
		{
			// A provider that DOES send a status keeps winning, so this stays
			// correct for Octamile or a future aggregator.
			name: "an explicit status still wins over is_active",
			body: `{"id":"x","status":"cancelled","is_active":true}`,
			want: "cancelled",
		},
		{
			// Neither signal present: empty, not a guessed "active". Reporting a
			// policy as live when we do not know is the dangerous direction.
			name: "no signal at all stays empty",
			body: `{"id":"y"}`,
			want: "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := c.policyFromData(json.RawMessage(tc.body), gateway.ProviderProduct{})
			if got.Status != tc.want {
				t.Errorf("Status = %q, want %q", got.Status, tc.want)
			}
		})
	}
}

// The rest of the real payload must keep mapping, so the status fix is not
// bought at the cost of something else. These field names are the live ones.
func TestPolicyFromData_RealPayloadFieldsSurvive(t *testing.T) {
	c := &Client{}
	body := `{
	  "id":"882c4ab2-ad2d-4f70-bf22-8c9972b43f95",
	  "policy_number":"TESTACC/AR/08/2026/HQ/8459",
	  "is_active":true,
	  "start_date":"2026-08-31T16:40:19.000Z",
	  "expiration_date":"2027-08-26T16:40:19.000Z",
	  "certificate_url":"https://example.invalid/cert.pdf",
	  "amount":4000
	}`
	got := c.policyFromData(json.RawMessage(body), gateway.ProviderProduct{})

	if got.ProviderPolicyRef != "882c4ab2-ad2d-4f70-bf22-8c9972b43f95" {
		t.Errorf("ref = %q", got.ProviderPolicyRef)
	}
	if got.Status != "active" {
		t.Errorf("status = %q, want active", got.Status)
	}
	if got.CertificateRef == "" {
		t.Error("certificate_url was dropped")
	}
	if got.EffectiveAt.IsZero() {
		t.Error("start_date was dropped")
	}
	// expiration_date, not end_date — MyCover sends no end_date at all.
	if got.ExpiresAt.IsZero() {
		t.Error("expiration_date was dropped")
	}
	// amount is naira at the boundary; it must arrive as integer kobo.
	if got.PremiumKobo != 400000 {
		t.Errorf("PremiumKobo = %d, want 400000 (NGN 4,000)", got.PremiumKobo)
	}
}

// certificate_url is legitimately absent on some products — confirmed permanently
// null for two of the five live policies, at buy time and on a later read. An
// absent certificate is normal, not an error and not a retry trigger.
func TestPolicyFromData_AbsentCertificateIsNotAnError(t *testing.T) {
	c := &Client{}
	got := c.policyFromData(json.RawMessage(`{"id":"z","is_active":true,"certificate_url":null}`), gateway.ProviderProduct{})
	if got.CertificateRef != "" {
		t.Errorf("CertificateRef = %q, want empty", got.CertificateRef)
	}
	if got.Status != "active" {
		t.Errorf("a missing certificate must not affect status, got %q", got.Status)
	}
}
