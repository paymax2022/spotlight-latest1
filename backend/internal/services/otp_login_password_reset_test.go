package services

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/integrations"
)

func TestSetPasswordRecoversTimedLockout(t *testing.T) {
	lockUntil := time.Now().UTC().Add(time.Hour)
	var adminPasswordSet bool
	var lockoutPatch map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/rest/v1/platform_users") && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]map[string]any{{
				"id": "u1", "status": "locked", "failed_login_attempts": 5,
				"locked_until": lockUntil, "deleted_at": nil,
			}})
		case strings.HasSuffix(r.URL.Path, "/auth/v1/admin/users/u1") && r.Method == http.MethodPut:
			adminPasswordSet = true
			w.WriteHeader(http.StatusOK)
		case strings.HasSuffix(r.URL.Path, "/rest/v1/platform_users") && r.Method == http.MethodPatch:
			if r.URL.Query().Get("status") != "eq.locked" || r.URL.Query().Get("locked_until") != "not.is.null" {
				t.Errorf("lockout patch query = %q, want only an auto-locked row", r.URL.RawQuery)
			}
			_ = json.NewDecoder(r.Body).Decode(&lockoutPatch)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[{"id":"u1"}]`))
		default:
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	auth := NewAuthService(integrations.NewSupabaseRestClient(srv.URL, "key"), nil, config.Config{})
	bridge := &otpAuthBridge{svc: auth.(*authService)}
	changed, err := bridge.SetPassword(t.Context(), "USER@example.com", "new-password")
	if err != nil {
		t.Fatalf("SetPassword: %v", err)
	}
	if !changed || !adminPasswordSet {
		t.Fatal("password reset did not complete")
	}
	if lockoutPatch["status"] != "active" ||
		lockoutPatch["failed_login_attempts"] != float64(0) ||
		lockoutPatch["locked_until"] != nil {
		t.Fatalf("lockout patch = %v, want active/0/null", lockoutPatch)
	}
}

func TestSetPasswordStillRefusesSuspendedAndManualLocks(t *testing.T) {
	tests := []struct {
		name string
		row  map[string]any
	}{
		{name: "suspended", row: map[string]any{"id": "u1", "status": "suspended"}},
		{name: "manual lock", row: map[string]any{"id": "u1", "status": "locked", "locked_until": nil}},
		{name: "deleted", row: map[string]any{"id": "u1", "status": "active", "deleted_at": time.Now().UTC()}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var passwordSet bool
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.HasSuffix(r.URL.Path, "/rest/v1/platform_users") && r.Method == http.MethodGet {
					w.Header().Set("Content-Type", "application/json")
					_ = json.NewEncoder(w).Encode([]map[string]any{tt.row})
					return
				}
				if strings.Contains(r.URL.Path, "/auth/v1/admin/users/") {
					passwordSet = true
				}
				t.Errorf("blocked reset made unexpected request: %s %s", r.Method, r.URL.Path)
				w.WriteHeader(http.StatusNotFound)
			}))
			defer srv.Close()

			auth := NewAuthService(integrations.NewSupabaseRestClient(srv.URL, "key"), nil, config.Config{})
			bridge := &otpAuthBridge{svc: auth.(*authService)}
			changed, err := bridge.SetPassword(t.Context(), "user@example.com", "new-password")
			if !errors.Is(err, ErrAccountUnavailable) {
				t.Fatalf("SetPassword error = %v, want ErrAccountUnavailable", err)
			}
			if changed || passwordSet {
				t.Fatal("password was changed for a suspended, deleted, or manually locked account")
			}
		})
	}
}
