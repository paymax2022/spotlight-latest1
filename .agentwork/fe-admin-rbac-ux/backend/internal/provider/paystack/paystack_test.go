package paystack_test

import (
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"testing"

	"spotlight/backend/internal/provider/paystack"
)

// TestClientName verifies the provider identifier is "paystack".
func TestClientName(t *testing.T) {
	c := paystack.New("sk_test_dummy")
	if c.Name() != "paystack" {
		t.Errorf("Name() = %q, want %q", c.Name(), "paystack")
	}
}

// TestWebhookSignatureVerification verifies HMAC-SHA512 signature check.
// The signature is computed as hex(HMAC-SHA512(secretKey, body)).
func TestWebhookSignatureVerification(t *testing.T) {
	secret := "whsec_test_secret"
	payload := []byte(`{"event":"charge.success","data":{"reference":"ref-001"}}`)

	mac := hmac.New(sha512.New, []byte(secret))
	mac.Write(payload)
	validSig := hex.EncodeToString(mac.Sum(nil))

	c := paystack.New(secret)
	if !c.VerifyWebhookSignature(payload, validSig) {
		t.Error("VerifyWebhookSignature must return true for a valid HMAC-SHA512 signature")
	}
}

// TestWebhookSignatureRejectsInvalid verifies tampered signatures are rejected.
func TestWebhookSignatureRejectsInvalid(t *testing.T) {
	c := paystack.New("sk_test_secret")
	payload := []byte(`{"event":"charge.success"}`)
	badSig := "deadbeefdeadbeefdeadbeef"
	if c.VerifyWebhookSignature(payload, badSig) {
		t.Error("VerifyWebhookSignature must return false for an invalid signature")
	}
}

// TestWebhookSignatureRejectsWrongSecret verifies the correct secret is required.
func TestWebhookSignatureRejectsWrongSecret(t *testing.T) {
	payload := []byte(`{"event":"transfer.success"}`)

	// Sign with one secret.
	mac := hmac.New(sha512.New, []byte("correct_secret"))
	mac.Write(payload)
	sig := hex.EncodeToString(mac.Sum(nil))

	// Verify with a different secret — must fail.
	c := paystack.New("wrong_secret")
	if c.VerifyWebhookSignature(payload, sig) {
		t.Error("VerifyWebhookSignature must reject signatures produced by a different secret")
	}
}
