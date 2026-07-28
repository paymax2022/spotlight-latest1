package monnify

import "testing"

// TestNormalizeStatus locks Monnify's status vocabulary → our internal vocabulary.
func TestNormalizeStatus(t *testing.T) {
	cases := map[string]string{
		"SUCCESS":    "successful",
		"SUCCESSFUL": "successful",
		"PAID":       "successful",
		"COMPLETED":  "successful",
		"FAILED":     "failed",
		"REJECTED":   "failed",
		"EXPIRED":    "failed",
		"REVERSED":   "reversed",
		"PENDING":    "pending",
		"WHATEVER":   "pending",
	}
	for in, want := range cases {
		if got := normalizeStatus(in); got != want {
			t.Errorf("normalizeStatus(%q)=%q, want %q", in, got, want)
		}
	}
}

// TestParseWebhookDisbursement verifies EventType drives the transfer terminal
// state and the provider ref + kobo amount are extracted correctly.
func TestParseWebhookDisbursement(t *testing.T) {
	c := New("k", "s", "C", "secret", false)
	cases := []struct {
		body       string
		wantType   string
		wantStatus string
		wantRef    string
		wantKobo   int64
	}{
		{`{"eventType":"SUCCESSFUL_DISBURSEMENT","eventData":{"reference":"trf-1","status":"SUCCESS","amount":1500}}`, "transfer", "successful", "trf-1", 150000},
		{`{"eventType":"FAILED_DISBURSEMENT","eventData":{"reference":"trf-2","amount":2000}}`, "transfer", "failed", "trf-2", 200000},
		{`{"eventType":"REVERSED_DISBURSEMENT","eventData":{"reference":"trf-3","amount":500}}`, "transfer", "reversed", "trf-3", 50000},
		{`{"eventType":"SUCCESSFUL_TRANSACTION","eventData":{"reference":"col-1","amountPaid":1000}}`, "collection", "successful", "col-1", 100000},
	}
	for _, tc := range cases {
		ev, err := c.ParseWebhook([]byte(tc.body))
		if err != nil {
			t.Fatalf("parse error: %v", err)
		}
		if ev.Type != tc.wantType || ev.Status != tc.wantStatus {
			t.Errorf("body=%s: type/status = %q/%q, want %q/%q", tc.body, ev.Type, ev.Status, tc.wantType, tc.wantStatus)
		}
		if ev.ProviderRef != tc.wantRef {
			t.Errorf("body=%s: providerRef=%q, want %q", tc.body, ev.ProviderRef, tc.wantRef)
		}
		if ev.AmountKobo != tc.wantKobo {
			t.Errorf("body=%s: kobo=%d, want %d", tc.body, ev.AmountKobo, tc.wantKobo)
		}
	}
}

// TestKoboNairaConversion verifies the integer-kobo boundary conversion (no float
// drift on whole-naira amounts; rounds to nearest kobo).
func TestKoboNairaConversion(t *testing.T) {
	if nairaFromKobo(150000) != 1500 {
		t.Fatalf("nairaFromKobo(150000)=%d, want 1500", nairaFromKobo(150000))
	}
	if koboFromNaira(1500) != 150000 {
		t.Fatalf("koboFromNaira(1500)=%d, want 150000", koboFromNaira(1500))
	}
	if koboFromNaira(99.99) != 9999 {
		t.Fatalf("koboFromNaira(99.99)=%d, want 9999", koboFromNaira(99.99))
	}
}

// TestParseRecipientCode round-trips the inline recipient encoding.
func TestParseRecipientCode(t *testing.T) {
	bank, acct := parseRecipientCode("monnify:058:0123456789")
	if bank != "058" || acct != "0123456789" {
		t.Fatalf("parseRecipientCode = %q/%q, want 058/0123456789", bank, acct)
	}
}

// TestVerifyWebhookSignatureBlankSecret fails closed when no secret is configured.
func TestVerifyWebhookSignatureBlankSecret(t *testing.T) {
	c := New("k", "s", "C", "", false)
	if c.VerifyWebhookSignature([]byte("{}"), "anything") {
		t.Fatal("blank webhook secret must fail closed")
	}
}
