package ws_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"spotlight/backend/internal/platform/ws"
)

func TestNew_ReturnsNonNilHub(t *testing.T) {
	h := ws.New(nil)
	if h == nil {
		t.Fatal("New() returned nil hub")
	}
}

func TestSendToUser_NoConnectedClients_DoesNotPanic(t *testing.T) {
	h := ws.New(nil)
	msg := ws.Message{Type: "test.event", Payload: map[string]string{"key": "value"}}
	// No registered clients — must not panic.
	h.SendToUser("user-abc", msg)
}

func TestSendToUser_UnknownUser_DoesNotPanic(t *testing.T) {
	h := ws.New(nil)
	h.SendToUser("nonexistent-user-id", ws.Message{Type: "ping", Payload: nil})
}

// A disallowed Origin must be refused with 403 before nhooyr's own same-host
// check ever runs (InsecureSkipVerify is unconditionally true) — regression
// test for the bug where every real browser client 403'd because nhooyr's
// default requires Origin to equal this server's own host, which the frontend
// (a different port in dev, a different subdomain in staging/prod) never is.
func TestServeHTTP_RejectsDisallowedOrigin(t *testing.T) {
	h := ws.New(func(origin string) bool { return origin == "http://localhost:3000" })
	req := httptest.NewRequest(http.MethodGet, "/ws", nil)
	req.Header.Set("Origin", "http://evil.example.com")
	rec := httptest.NewRecorder()

	err := h.ServeHTTP(rec, req, "user-1")
	if err == nil {
		t.Fatal("expected an error for a disallowed Origin")
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
	if !strings.Contains(rec.Body.String(), "evil.example.com") {
		t.Fatalf("body = %q, want it to name the rejected origin", rec.Body.String())
	}
}

// A missing Origin (native app, curl, server-to-server) is never subject to
// same-origin enforcement in the first place, so it must reach the real
// upgrade attempt rather than being rejected outright — the ticket/JWT the
// caller already validated is the actual auth boundary here, not Origin.
func TestServeHTTP_NoOriginHeader_SkipsOriginCheck(t *testing.T) {
	checked := false
	h := ws.New(func(origin string) bool { checked = true; return false })
	req := httptest.NewRequest(http.MethodGet, "/ws", nil)
	rec := httptest.NewRecorder()

	_ = h.ServeHTTP(rec, req, "user-1")
	if checked {
		t.Fatal("originAllowed must not be consulted when no Origin header is present")
	}
	if rec.Code == http.StatusForbidden {
		t.Fatal("a missing Origin must not be rejected as if it were a disallowed one")
	}
}

func TestMessage_MarshalRoundtrip(t *testing.T) {
	original := ws.Message{Type: "wallet.credit", Payload: map[string]any{"amount_kobo": float64(5000)}}
	b, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got ws.Message
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got.Type != original.Type {
		t.Fatalf("Type mismatch: got %q, want %q", got.Type, original.Type)
	}
}
