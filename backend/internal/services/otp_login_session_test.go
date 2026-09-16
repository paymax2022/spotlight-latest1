package services

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/integrations"
)

// AUTH-009: a session minted via the OTP login step-up (otpAuthBridge.MintSession,
// backing purpose=login on POST /api/auth/otp/verify) was never registered with
// SessionService — only the password path (AuthHandler.Login) did that. With
// FEATURE_SESSION_HARDENING_ENABLED on, RequireAuthContextWithSessions looks
// every bearer token up in SessionService and fails closed on a miss, so a
// step-up login succeeded at GoTrue and then 401'd "session revoked" on the
// very next request, including GET /api/auth/me.
//
// These tests exercise MintSession end to end against a fake Supabase (GoTrue +
// PostgREST) server and a real sessionService backed by an in-memory store —
// the same fakeSessionStore session_service_test.go already uses — so the
// assertion is the same check RequireAuthContextWithSessions performs:
// SessionService.ValidateAccess on the token MintSession handed back.

// fakeSupabaseAuthServer serves just enough of PostgREST + GoTrue admin for
// otpAuthBridge.MintSession's two calls: the platform_users lockout-gate
// lookup, then generate_link + verify (MintSessionByEmail's magiclink dance).
func fakeSupabaseAuthServer(t *testing.T, accessToken, refreshToken string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/rest/v1/platform_users") && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]map[string]any{
				{"id": "pu-1", "status": "active", "failed_login_attempts": 0, "locked_until": nil, "deleted_at": nil},
			})
		case strings.HasSuffix(r.URL.Path, "/auth/v1/admin/generate_link"):
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"email_otp": "999111"})
		case strings.HasSuffix(r.URL.Path, "/auth/v1/verify"):
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": accessToken, "refresh_token": refreshToken, "expires_in": 3600,
			})
		default:
			t.Errorf("unexpected call: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

// newTestBridge builds an otpAuthBridge directly (bypassing NewOTPAuthBridge,
// which additionally requires a live *pgxpool.Pool that MintSession's path
// never touches) wired the same way otp_routes.go wires it in production:
// WithSessions(sessions, enabled).
func newTestBridge(t *testing.T, srv *httptest.Server, sessions SessionService, enabled bool) *otpAuthBridge {
	t.Helper()
	auth := NewAuthService(integrations.NewSupabaseRestClient(srv.URL, "test-key"), nil, config.Config{})
	svc, ok := auth.(*authService)
	if !ok {
		t.Fatalf("NewAuthService did not return *authService")
	}
	return (&otpAuthBridge{svc: svc}).WithSessions(sessions, enabled)
}

func TestMintSession_StepUpSessionIsUsableAfterward(t *testing.T) {
	srv := fakeSupabaseAuthServer(t, "step-up-access-token", "step-up-refresh-token")
	defer srv.Close()

	store := newFakeStore()
	sessions := NewSessionService(store, nil, nil, config.Config{})
	bridge := newTestBridge(t, srv, sessions, true /* FEATURE_SESSION_HARDENING_ENABLED */)

	session, err := bridge.MintSession(context.Background(), "ADA@Example.com")
	if err != nil {
		t.Fatalf("MintSession: %v", err)
	}
	access, _ := session["access_token"].(string)
	if access != "step-up-access-token" {
		t.Fatalf("access_token = %q, want the minted token", access)
	}

	// This is exactly what RequireAuthContextWithSessions runs on every
	// protected request. Before the fix, MintSession never called
	// IssueSession, so this looked the token up and found nothing — the same
	// "session not found" the middleware collapses into 401 "session revoked".
	sess, verr := sessions.ValidateAccess(access)
	if verr != nil {
		t.Fatalf("ValidateAccess(minted token) = %v, want the session to be found — this is the AUTH-009 regression", verr)
	}
	if sess.UserID != "pu-1" {
		t.Errorf("session.UserID = %q, want the platform_users id resolved by the lockout gate", sess.UserID)
	}
}

// Session hardening OFF is a valid, common configuration. The step-up mint
// must still succeed and must not panic on a nil-equivalent SessionService
// wiring — it just leaves the session untracked, same as the password path
// leaves it untracked when h.sessionHardening is false.
func TestMintSession_SessionHardeningOff_StillMintsButDoesNotTrack(t *testing.T) {
	srv := fakeSupabaseAuthServer(t, "flag-off-access-token", "flag-off-refresh-token")
	defer srv.Close()

	store := newFakeStore()
	sessions := NewSessionService(store, nil, nil, config.Config{})
	bridge := newTestBridge(t, srv, sessions, false /* hardening OFF */)

	session, err := bridge.MintSession(context.Background(), "ada@example.com")
	if err != nil {
		t.Fatalf("MintSession: %v", err)
	}
	if session["access_token"] != "flag-off-access-token" {
		t.Fatalf("MintSession must still succeed with hardening off: %v", session)
	}
	if _, verr := sessions.ValidateAccess("flag-off-access-token"); verr == nil {
		t.Error("a session was tracked despite session hardening being off")
	}
}

// A bridge with no SessionService wired at all (WithSessions never called, or
// called with a nil service) is the same "not wired" convention the rest of
// the OTP bridge already follows for its other optional dependencies. It must
// not panic.
func TestMintSession_NoSessionServiceWired_DoesNotPanic(t *testing.T) {
	srv := fakeSupabaseAuthServer(t, "unwired-access-token", "unwired-refresh-token")
	defer srv.Close()

	auth := NewAuthService(integrations.NewSupabaseRestClient(srv.URL, "test-key"), nil, config.Config{})
	svc, ok := auth.(*authService)
	if !ok {
		t.Fatalf("NewAuthService did not return *authService")
	}
	bridge := &otpAuthBridge{svc: svc} // sessions is nil, sessionHardening is the zero value (false)

	session, err := bridge.MintSession(context.Background(), "ada@example.com")
	if err != nil {
		t.Fatalf("MintSession: %v", err)
	}
	if session["access_token"] != "unwired-access-token" {
		t.Fatalf("MintSession must still succeed with no SessionService wired: %v", session)
	}
}
