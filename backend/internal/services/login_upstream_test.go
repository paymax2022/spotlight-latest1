package services

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
)

// E2E-FR-049: during a GoTrue outage LoginUser used to fold EVERY >=400 into
// "invalid credentials" and bump failed_login_attempts — so a degraded IdP
// mass-locked accounts whose passwords were correct (the load run produced 14
// false invalid_credentials and a 30-minute fixture lockout). These pin the
// split: transport errors, 429 and 5xx are upstream failures (no strike, no
// invalid-verdict), and only a definitive 4xx credential rejection earns a
// bumpFailedLogin strike.

// loginUpstreamServer stubs the Supabase base URL both REST and GoTrue calls
// share: GET platform_users returns one ACTIVE row, the atomic bump RPC counts
// its calls, and /auth/v1/token is answered by the injected tokenHandler.
func loginUpstreamServer(t *testing.T, tokenHandler http.HandlerFunc, rpcCalls *atomic.Int32) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "/auth/v1/token"):
			tokenHandler(w, r)
		case strings.Contains(r.URL.Path, "bump_failed_login_attempts"):
			rpcCalls.Add(1)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte("1"))
		case strings.Contains(r.URL.Path, "platform_users") && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[{"id":"u1","status":"active","failed_login_attempts":0,"locked_until":null,"deleted_at":null}]`))
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
	}))
}

func loginUpstreamSvc(srv *httptest.Server) *authService {
	return &authService{
		supabase: integrations.NewSupabaseRestClient(srv.URL, "key"),
		cfg:      config.Config{MaxFailedLoginAttempts: 5, AccountLockMinutes: 30},
	}
}

// The error LoginUser returns must be a LoginFailureError that wraps
// ErrAuthUnavailable — so the handler can both attribute the audit row and map
// it to 503 instead of 401.
func assertAuthUnavailable(t *testing.T, err error) {
	t.Helper()
	if err == nil {
		t.Fatal("LoginUser must fail when GoTrue cannot produce a verdict, got nil error")
	}
	if !errors.Is(err, ErrAuthUnavailable) {
		t.Fatalf("err = %v, want it to wrap ErrAuthUnavailable (else the handler answers 401 invalid_credentials)", err)
	}
	var fail *LoginFailureError
	if !errors.As(err, &fail) {
		t.Fatalf("err = %v, want a *LoginFailureError so the audit row is attributable", err)
	}
	if fail.UserID != "u1" {
		t.Fatalf("LoginFailureError.UserID = %q, want the resolved platform user id u1", fail.UserID)
	}
	if errors.Is(err, ErrEmailNotConfirmed) {
		t.Fatal("an upstream failure must not masquerade as email_not_confirmed")
	}
}

func TestLoginUser_GoTrue5xxIsUnavailableAndCountsNoStrike(t *testing.T) {
	var rpcCalls atomic.Int32
	srv := loginUpstreamServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"code":500,"msg":"database is unavailable"}`))
	}), &rpcCalls)
	defer srv.Close()

	_, err := loginUpstreamSvc(srv).LoginUser(domain.LoginRequest{Email: "u@x.com", Password: "correct-horse-battery"})
	assertAuthUnavailable(t, err)
	if got := rpcCalls.Load(); got != 0 {
		t.Fatalf("bump_failed_login_attempts was called %d times — a GoTrue outage must not count as a wrong password", got)
	}
}

func TestLoginUser_GoTrue429IsUnavailableAndCountsNoStrike(t *testing.T) {
	var rpcCalls atomic.Int32
	srv := loginUpstreamServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error_code":"over_request_rate_limit"}`))
	}), &rpcCalls)
	defer srv.Close()

	_, err := loginUpstreamSvc(srv).LoginUser(domain.LoginRequest{Email: "u@x.com", Password: "correct-horse-battery"})
	assertAuthUnavailable(t, err)
	if got := rpcCalls.Load(); got != 0 {
		t.Fatalf("bump_failed_login_attempts was called %d times on a 429 — GoTrue's own rate limiter is not a credential verdict", got)
	}
}

// A transport-level failure (connection refused/reset/timeout): no HTTP
// response at all. Previously returned a bare error that the handler answered
// as 401 invalid_credentials.
func TestLoginUser_GoTrueTransportErrorIsUnavailableAndCountsNoStrike(t *testing.T) {
	var rpcCalls atomic.Int32
	srv := loginUpstreamServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Sever the connection so the client's Do returns an error, as a dead
		// or hanging-then-reset GoTrue does.
		hj, ok := w.(http.Hijacker)
		if !ok {
			t.Fatal("test server does not support hijacking")
		}
		conn, _, err := hj.Hijack()
		if err != nil {
			t.Fatalf("hijack: %v", err)
		}
		_ = conn.Close()
	}), &rpcCalls)
	defer srv.Close()

	_, err := loginUpstreamSvc(srv).LoginUser(domain.LoginRequest{Email: "u@x.com", Password: "correct-horse-battery"})
	assertAuthUnavailable(t, err)
	if got := rpcCalls.Load(); got != 0 {
		t.Fatalf("bump_failed_login_attempts was called %d times on a transport failure", got)
	}
}

// A 2xx whose body is not a session is an upstream/compat failure, not a
// verdict on the password — and was also previously folded into 401.
func TestLoginUser_GoTrueUndecodable2xxIsUnavailable(t *testing.T) {
	var rpcCalls atomic.Int32
	srv := loginUpstreamServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`<html>not a token response</html>`))
	}), &rpcCalls)
	defer srv.Close()

	_, err := loginUpstreamSvc(srv).LoginUser(domain.LoginRequest{Email: "u@x.com", Password: "correct-horse-battery"})
	assertAuthUnavailable(t, err)
	if got := rpcCalls.Load(); got != 0 {
		t.Fatalf("bump_failed_login_attempts was called %d times on an undecodable response", got)
	}
}

// The unchanged half of the contract: a definitive credential rejection still
// answers with the same generic message AND still counts a strike. This is the
// behaviour the fix must not dilute — a wrong password during a healthy window
// is the only thing the lockout budget exists for.
func TestLoginUser_GoTrue4xxStillCountsAStrikeAndReadsInvalidCredentials(t *testing.T) {
	for _, status := range []int{http.StatusBadRequest, http.StatusUnauthorized} {
		var rpcCalls atomic.Int32
		srv := loginUpstreamServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_, _ = w.Write([]byte(`{"error":"invalid_grant","error_code":"invalid_credentials"}`))
		}), &rpcCalls)

		_, err := loginUpstreamSvc(srv).LoginUser(domain.LoginRequest{Email: "u@x.com", Password: "wrong-password"})
		srv.Close()
		if err == nil {
			t.Fatalf("status %d: a credential rejection must still fail", status)
		}
		if errors.Is(err, ErrAuthUnavailable) {
			t.Fatalf("status %d: a genuine wrong-password rejection must NOT be classified as upstream", status)
		}
		var fail *LoginFailureError
		if !errors.As(err, &fail) || fail.Err.Error() != "invalid credentials" {
			t.Fatalf("status %d: err = %v, want LoginFailureError wrapping \"invalid credentials\"", status, err)
		}
		if got := rpcCalls.Load(); got != 1 {
			t.Fatalf("status %d: bump_failed_login_attempts called %d times, want exactly 1 — the strike must still count", status, got)
		}
	}
}

// The carve-out that already existed must keep winning even when GoTrue
// reports it on an unusual status — the password was right either way, and no
// strike may count.
func TestLoginUser_EmailNotConfirmedNeverCountsAStrike(t *testing.T) {
	var rpcCalls atomic.Int32
	srv := loginUpstreamServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error_code":"email_not_confirmed"}`))
	}), &rpcCalls)
	defer srv.Close()

	_, err := loginUpstreamSvc(srv).LoginUser(domain.LoginRequest{Email: "u@x.com", Password: "correct-horse-battery"})
	if !errors.Is(err, ErrEmailNotConfirmed) {
		t.Fatalf("err = %v, want ErrEmailNotConfirmed", err)
	}
	if got := rpcCalls.Load(); got != 0 {
		t.Fatalf("bump_failed_login_attempts called %d times on email_not_confirmed", got)
	}
}
