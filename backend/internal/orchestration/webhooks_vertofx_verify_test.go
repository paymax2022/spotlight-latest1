package orchestration_test

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"testing"
	"time"

	orch "spotlight/backend/internal/orchestration"
	"spotlight/backend/internal/orchestration/adapters"
	"spotlight/backend/internal/provider/vertofx"
)

func vertoSvc(secret string) *orch.Service {
	client := vertofx.New("id", "key", false).WithWebhookSecret(secret)
	live := adapters.NewVertoFXLive(client, secret, false)
	return orch.NewService([]orch.Provider{live}, orch.NewMemStore(), orch.Options{Now: time.Now})
}

func TestVerifyProviderWebhook_VertoFX(t *testing.T) {
	payload := []byte(`{"id":"e1","event":"payment.completed","paymentId":"p1"}`)
	m := hmac.New(sha256.New, []byte("s3cret"))
	m.Write(payload)
	good := hex.EncodeToString(m.Sum(nil))

	svc := vertoSvc("s3cret")
	if !svc.VerifyProviderWebhook("vertofx", payload, good) {
		t.Fatal("valid signature rejected")
	}
	if svc.VerifyProviderWebhook("vertofx", payload, "deadbeef") {
		t.Fatal("wrong signature accepted")
	}
	if svc.VerifyProviderWebhook("vertofx", []byte(`{"tampered":1}`), good) {
		t.Fatal("tampered payload accepted")
	}
	if svc.VerifyProviderWebhook("vertofx", payload, "") {
		t.Fatal("empty signature accepted")
	}

	// Empty configured secret must fail closed, even for the signature an
	// empty-key HMAC would produce.
	empty := vertoSvc("")
	e := hmac.New(sha256.New, []byte(""))
	e.Write(payload)
	if empty.VerifyProviderWebhook("vertofx", payload, hex.EncodeToString(e.Sum(nil))) {
		t.Fatal("empty secret accepted an empty-key signature")
	}
	if empty.VerifyProviderWebhook("vertofx", payload, "") {
		t.Fatal("empty secret + empty signature accepted")
	}
	// Unregistered provider name is rejected.
	if svc.VerifyProviderWebhook("nope", payload, good) {
		t.Fatal("unknown provider accepted")
	}
}
