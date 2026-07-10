package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"paymax/crypto-backend/internal/admin"
	"paymax/crypto-backend/internal/store"
)

func withdrawReq(t *testing.T, h http.Handler, idem string) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(map[string]any{
		"assetId": "ast_btc", "networkId": "net_btc", "amount": 1000, "address": "bc1qexample",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/crypto/withdraw", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", idem)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// When an operator flips the crypto_withdrawals kill-switch off, the withdraw money
// path must be blocked (503) after the eligibility gate, before any state changes.
func TestFeatureFlagKillSwitch_BlocksWithdraw(t *testing.T) {
	s := NewServer(store.New())
	if e := s.Admin.SetFlag("crypto_withdrawals", false, admin.RoleSuperAdmin, "incident"); e != nil {
		t.Fatalf("SetFlag: %v", e)
	}
	rec := withdrawReq(t, s.Handler(), "kill-1")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("withdraw with flag OFF = %d, want 503 feature_disabled (body=%s)", rec.Code, rec.Body.String())
	}
}

// With the flag ON (default), the same request must NOT be rejected as
// feature_disabled — it proceeds past the kill-switch (later validation is out of
// scope for this test).
func TestFeatureFlagKillSwitch_AllowsWhenOn(t *testing.T) {
	s := NewServer(store.New())
	rec := withdrawReq(t, s.Handler(), "ok-1")
	if rec.Code == http.StatusServiceUnavailable {
		t.Fatalf("withdraw with flag ON must not be 503 feature_disabled (body=%s)", rec.Body.String())
	}
}
