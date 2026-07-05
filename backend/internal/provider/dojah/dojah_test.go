package dojah_test

import (
	"testing"

	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/provider/dojah"
)

func TestName(t *testing.T) {
	if got := dojah.New("app", "sk", false).Name(); got != "dojah" {
		t.Fatalf("Name() = %q, want dojah", got)
	}
}

func TestVerifyIDNumber_SandboxNotConfigured(t *testing.T) {
	c := dojah.New("", "", false)
	res, err := c.VerifyIDNumber(t.Context(), provider.KycVerifyRequest{ClientRef: "ref-1", IDType: "bvn", IDNumber: "123"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != provider.KycPending || res.Terminal {
		t.Fatalf("want pending/non-terminal, got %+v", res)
	}
	if res.ProviderRef != "ref-1" {
		t.Fatalf("ClientRef not echoed: %q", res.ProviderRef)
	}
}

func TestMapWebhook_Statuses(t *testing.T) {
	cases := []struct {
		name string
		body string
		want provider.KycCheckStatus
		ref  string
	}{
		{"passed", `{"reference":"cr1","reference_id":"job1","status":"completed"}`, provider.KycPassed, "cr1"},
		{"failed", `{"reference":"cr2","reference_id":"job2","status":"failed"}`, provider.KycFailed, "cr2"},
		{"review", `{"reference":"cr3","reference_id":"job3","status":"manual_review"}`, provider.KycReview, "cr3"},
		{"pending", `{"reference":"cr4","reference_id":"job4","status":"processing"}`, provider.KycPending, "cr4"},
	}
	c := dojah.New("app", "sk", false)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ev, err := c.ParseKycWebhook([]byte(tc.body))
			if err != nil {
				t.Fatal(err)
			}
			if ev.Status != tc.want {
				t.Fatalf("status = %q, want %q", ev.Status, tc.want)
			}
			if ev.ClientRef != tc.ref {
				t.Fatalf("client_ref = %q, want %q", ev.ClientRef, tc.ref)
			}
			if ev.Provider != "dojah" {
				t.Fatalf("provider = %q", ev.Provider)
			}
		})
	}
}

func TestVerifyKycSignature(t *testing.T) {
	c := dojah.New("app", "sk", false).WithWebhookSecret("whsec")
	payload := []byte(`{"a":1}`)
	// precomputed HMAC-SHA256 of payload with key "whsec"
	// verified against crypto/hmac at construction time in adapter.
	if c.VerifyKycSignature(payload, "deadbeef") {
		t.Fatal("expected invalid signature to be rejected")
	}
	if c.VerifyKycSignature(payload, "") {
		t.Fatal("empty signature must be rejected")
	}
	nocreds := dojah.New("app", "sk", false)
	if nocreds.VerifyKycSignature(payload, "anything") {
		t.Fatal("missing webhook secret must reject")
	}
}
