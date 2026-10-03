package services

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/integrations"
)

func TestLogoutUserPostsCallerTokenToGoTrue(t *testing.T) {
	var gotAuth, gotKey, gotPath, gotMethod string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotMethod = r.URL.Path, r.Method
		gotAuth = r.Header.Get("Authorization")
		gotKey = r.Header.Get("Apikey")
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	svc := NewAuthService(integrations.NewSupabaseRestClient(srv.URL, "test-key"), nil, config.Config{})
	if err := svc.LogoutUser("user-access-token"); err != nil {
		t.Fatalf("LogoutUser: %v", err)
	}
	if gotMethod != http.MethodPost || gotPath != "/auth/v1/logout" {
		t.Fatalf("expected POST /auth/v1/logout, got %s %s", gotMethod, gotPath)
	}
	if gotAuth != "Bearer user-access-token" {
		t.Fatalf("expected the caller's token on Authorization, got %q", gotAuth)
	}
	if gotKey != "test-key" {
		t.Fatalf("expected apikey header, got %q", gotKey)
	}
}

func TestLogoutUserPropagatesUpstreamFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	svc := NewAuthService(integrations.NewSupabaseRestClient(srv.URL, "test-key"), nil, config.Config{})
	if err := svc.LogoutUser("tok"); err == nil {
		t.Fatalf("expected an error on a 5xx from GoTrue")
	}
	if err := svc.LogoutUser("  "); err == nil {
		t.Fatalf("expected an error on a blank token")
	}
}
