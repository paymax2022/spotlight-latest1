package api

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"paymax/crypto-backend/internal/store"
)

// The crypto webhook mutates money state (deposit.confirmed credits holdings,
// withdrawal.failed reverses a debit), so an unconfigured secret must FAIL CLOSED
// — not silently accept unsigned events. The dev bypass is allowed ONLY via an
// explicit ALLOW_DEV_AUTH=true, never implied by an empty secret.

func postWebhook(t *testing.T, h http.Handler, body []byte, hdr map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/crypto/webhooks/testprov", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func sign(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

var webhookEvent = []byte(`{"id":"evt-auth-1","type":"order.created","data":{"reference":"ref-x"}}`)

func TestWebhook_FailsClosed_WhenSecretUnsetAndNoDevAuth(t *testing.T) {
	t.Setenv("CRYPTO_WEBHOOK_SECRET", "")
	t.Setenv("ALLOW_DEV_AUTH", "")
	h := NewServer(store.New()).Handler()

	rec := postWebhook(t, h, webhookEvent, nil)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("unsigned webhook with no secret and no dev-auth: got %d, want 503 (fail closed)", rec.Code)
	}
}

func TestWebhook_DevBypass_OnlyWithExplicitFlag(t *testing.T) {
	t.Setenv("CRYPTO_WEBHOOK_SECRET", "")
	t.Setenv("ALLOW_DEV_AUTH", "true")
	h := NewServer(store.New()).Handler()

	rec := postWebhook(t, h, webhookEvent, nil)

	if rec.Code != http.StatusOK {
		t.Fatalf("unsigned webhook with ALLOW_DEV_AUTH=true: got %d, want 200 (explicit dev bypass)", rec.Code)
	}
}

func TestWebhook_RejectsBadSignature_WhenSecretSet(t *testing.T) {
	t.Setenv("CRYPTO_WEBHOOK_SECRET", "s3cret")
	t.Setenv("ALLOW_DEV_AUTH", "true") // must NOT bypass when a secret is configured
	h := NewServer(store.New()).Handler()

	rec := postWebhook(t, h, webhookEvent, map[string]string{
		"X-Paymax-Signature": "deadbeef",
		"X-Paymax-Timestamp": strconv.FormatInt(time.Now().Unix(), 10),
	})

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("bad signature with secret set: got %d, want 401", rec.Code)
	}
}

func TestWebhook_AcceptsValidSignature_WhenSecretSet(t *testing.T) {
	t.Setenv("CRYPTO_WEBHOOK_SECRET", "s3cret")
	t.Setenv("ALLOW_DEV_AUTH", "")
	h := NewServer(store.New()).Handler()

	rec := postWebhook(t, h, webhookEvent, map[string]string{
		"X-Paymax-Signature": sign("s3cret", webhookEvent),
		"X-Paymax-Timestamp": strconv.FormatInt(time.Now().Unix(), 10),
	})

	if rec.Code != http.StatusOK {
		t.Fatalf("valid signature + fresh timestamp: got %d, want 200", rec.Code)
	}
}

func TestWebhook_RejectsStaleTimestamp_WhenSecretSet(t *testing.T) {
	t.Setenv("CRYPTO_WEBHOOK_SECRET", "s3cret")
	h := NewServer(store.New()).Handler()

	stale := strconv.FormatInt(time.Now().Add(-10*time.Minute).Unix(), 10)
	rec := postWebhook(t, h, webhookEvent, map[string]string{
		"X-Paymax-Signature": sign("s3cret", webhookEvent),
		"X-Paymax-Timestamp": stale,
	})

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("valid signature but stale timestamp: got %d, want 400", rec.Code)
	}
}
