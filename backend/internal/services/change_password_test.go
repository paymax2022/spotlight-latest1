package services //nolint:testpackage // exercises unexported authService internals; package-internal tests are the established convention here

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/integrations"
)

// AUD-BE-005: ChangePassword used to validate lengths, revoke auth_sessions
// rows, and return success — it never verified currentPassword and never
// told GoTrue about the new password, so "Password changed" was a lie and
// the old credential kept working. These pin the real flow: current
// password verified via the password grant, then AdminSetPassword, then
// session revocation.

// changePasswordServer stubs the calls ChangePassword makes:
// GET /auth/v1/user (token → user), POST /auth/v1/token (current-password
// verify; 200 only for "correct-pw"), PUT /auth/v1/admin/users/:id (the
// password write; body captured into adminBody), PATCH auth_sessions.
func changePasswordServer(t *testing.T, adminCalled *bool, adminBody *map[string]any) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/auth/v1/user"):
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"u1","email":"u@x.com"}`))
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/auth/v1/token"):
			var in struct {
				Password string `json:"password"`
			}
			raw, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(raw, &in)
			if in.Password == "correct-pw" {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"access_token":"x"}`))
				return
			}
			w.WriteHeader(http.StatusBadRequest)
		case r.Method == http.MethodPut && strings.Contains(r.URL.Path, "/auth/v1/admin/users/"):
			*adminCalled = true
			raw, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(raw, adminBody)
			w.WriteHeader(http.StatusOK)
		case r.Method == http.MethodPatch && strings.Contains(r.URL.Path, "auth_sessions"):
			w.WriteHeader(http.StatusOK)
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
	}))
}

func TestChangePassword_UpdatesPasswordAndRevokesSessions(t *testing.T) {
	var adminCalled bool
	var adminBody map[string]any
	srv := changePasswordServer(t, &adminCalled, &adminBody)
	defer srv.Close()

	svc := &authService{supabase: integrations.NewSupabaseRestClient(srv.URL, "key"), cfg: config.Config{}}
	if err := svc.ChangePassword("valid-token", "correct-pw", "new-strong-pw"); err != nil {
		t.Fatalf("valid change must succeed, got: %v", err)
	}
	if !adminCalled {
		t.Fatal("the password was never sent to GoTrue — the AUD-BE-005 no-op is back")
	}
	if adminBody["password"] != "new-strong-pw" {
		t.Fatalf("admin update body password = %v, want the new password", adminBody["password"])
	}
}

func TestChangePassword_WrongCurrentPasswordDoesNotUpdate(t *testing.T) {
	var adminCalled bool
	var adminBody map[string]any
	srv := changePasswordServer(t, &adminCalled, &adminBody)
	defer srv.Close()

	svc := &authService{supabase: integrations.NewSupabaseRestClient(srv.URL, "key"), cfg: config.Config{}}
	err := svc.ChangePassword("valid-token", "wrong-pw-999", "new-strong-pw")
	if err == nil {
		t.Fatal("wrong current password must fail, got nil error")
	}
	if adminCalled {
		t.Fatal("password was updated despite a failed current-password check")
	}
}

func TestChangePassword_BadTokenRefuses(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/auth/v1/user") {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		t.Fatalf("reached %s with an invalid token", r.URL.Path)
	}))
	defer srv.Close()

	svc := &authService{supabase: integrations.NewSupabaseRestClient(srv.URL, "key"), cfg: config.Config{}}
	if err := svc.ChangePassword("bad-token", "correct-pw", "new-strong-pw"); err == nil {
		t.Fatal("invalid bearer token must refuse, got nil error")
	}
}
