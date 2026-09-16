package services

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/integrations"
)

// The reset endpoint must never become an account-enumeration oracle, while an
// actual outage must not look like success. Those pull in opposite directions,
// so both are pinned here.
func TestRequestPasswordReset_UpstreamStatusHandling(t *testing.T) {
	cases := []struct {
		name      string
		status    int
		wantError bool
		why       string
	}{
		{"200 sent", http.StatusOK, false, "the happy path"},
		{"400 unknown address", http.StatusBadRequest, false,
			"Supabase answers 4xx for an address with no account — surfacing it would disclose which addresses exist"},
		{"422 unprocessable", http.StatusUnprocessableEntity, false, "still a client-side answer, still non-disclosing"},
		{"500 upstream down", http.StatusInternalServerError, true,
			"an outage previously returned nil, so the user was told to check an email that would never arrive"},
		{"503 unavailable", http.StatusServiceUnavailable, true, "same as 500"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if !strings.HasSuffix(r.URL.Path, "/auth/v1/recover") {
					t.Errorf("called %s, want /auth/v1/recover", r.URL.Path)
				}
				w.WriteHeader(tc.status)
			}))
			defer srv.Close()

			svc := NewAuthService(integrations.NewSupabaseRestClient(srv.URL, "test-key"), nil, config.Config{})
			err := svc.RequestPasswordReset("someone@example.test")

			if tc.wantError && err == nil {
				t.Errorf("status %d returned nil — %s", tc.status, tc.why)
			}
			if !tc.wantError && err != nil {
				t.Errorf("status %d returned %v — %s", tc.status, err, tc.why)
			}
		})
	}
}
