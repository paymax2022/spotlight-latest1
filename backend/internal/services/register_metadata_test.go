package services

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
)

// The on_auth_user_created trigger copies raw_user_meta_data->>'full_name' into
// user_profiles.full_name. This path sent only first_name/last_name, so every
// account it created had an EMPTY profile name — confirmed against the live DB
// before this test was written.
func TestRegisterUser_SendsFullNameForTheProfileTrigger(t *testing.T) {
	var captured map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/auth/v1/signup") {
			body, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(body, &captured)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"id":"user-123","email":"ada@example.test"}`))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`[]`))
	}))
	defer srv.Close()

	svc := NewAuthService(integrations.NewSupabaseRestClient(srv.URL, "k"), nil, config.Config{})
	err := svc.RegisterUser(domain.RegisterRequest{
		FirstName: "Ada", LastName: "Obi", Email: "ada@example.test",
		Password: "Str0ngPass!23", ConfirmPassword: "Str0ngPass!23", UserType: "user",
	})
	if err != nil {
		t.Fatalf("RegisterUser: %v", err)
	}

	data, _ := captured["data"].(map[string]any)
	if got := data["full_name"]; got != "Ada Obi" {
		t.Errorf("full_name = %v, want \"Ada Obi\" — the trigger reads this key and nothing else", got)
	}
	// The existing keys must survive for callers that read them.
	if data["first_name"] != "Ada" || data["last_name"] != "Obi" {
		t.Errorf("first/last dropped: %v", data)
	}
}

func TestRegisterUser_RejectsMismatchedConfirmation(t *testing.T) {
	svc := NewAuthService(integrations.NewSupabaseRestClient("http://unused", "k"), nil, config.Config{})
	err := svc.RegisterUser(domain.RegisterRequest{
		Email: "a@b.test", Password: "Str0ngPass!23", ConfirmPassword: "different",
	})
	if err == nil {
		t.Fatal("a mismatched confirmation must not reach the signup call")
	}
}

// The account exists once signup succeeds. A failed profile write must not fail
// the request, or the user is told to register again and meets "already
// registered" on an account that is genuinely theirs.
func TestRegisterUser_SucceedsEvenIfTheProfileWriteFails(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/auth/v1/signup") {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"id":"user-123"}`))
			return
		}
		w.WriteHeader(http.StatusInternalServerError) // the profile PATCH fails
	}))
	defer srv.Close()

	svc := NewAuthService(integrations.NewSupabaseRestClient(srv.URL, "k"), nil, config.Config{})
	if err := svc.RegisterUser(domain.RegisterRequest{
		FirstName: "Ada", LastName: "Obi", Email: "ada@example.test", Phone: "08031234567",
		Password: "Str0ngPass!23", ConfirmPassword: "Str0ngPass!23", UserType: "user",
	}); err != nil {
		t.Errorf("registration reported failure for an account that WAS created: %v", err)
	}
}

func TestExtractSignupUserID_HandlesBothResponseShapes(t *testing.T) {
	cases := []struct{ name, body, want string }{
		// Confirmation required: no session, the user object IS the body.
		{"confirmation on", `{"id":"u-1","email":"a@b.test","confirmation_sent_at":"now"}`, "u-1"},
		// Confirmation off: a session, with the user nested.
		{"confirmation off", `{"access_token":"t","user":{"id":"u-2"}}`, "u-2"},
		{"nested wins over empty top level", `{"id":"","user":{"id":"u-3"}}`, "u-3"},
		{"malformed", `not json`, ""},
		{"neither present", `{"email":"a@b.test"}`, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := extractSignupUserID([]byte(tc.body)); got != tc.want {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}
