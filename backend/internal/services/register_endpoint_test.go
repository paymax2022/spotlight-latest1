package services

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
)

// captured records what RegisterUser actually sent to GoTrue.
type captured struct {
	mu    sync.Mutex
	path  string
	body  map[string]any
	calls int
}

func (c *captured) snapshot() (string, map[string]any, int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.path, c.body, c.calls
}

// gotrueStub answers both creation endpoints with a plausible unconfirmed user.
func gotrueStub(t *testing.T, cap *captured) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, "/auth/v1/") {
			// PostgREST calls (the phone patch). Not under test.
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`[]`))
			return
		}
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)

		cap.mu.Lock()
		cap.path, cap.body, cap.calls = r.URL.Path, body, cap.calls+1
		cap.mu.Unlock()

		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"11111111-1111-1111-1111-111111111111","email":"ada@example.com"}`))
	}))
}

func registerWith(t *testing.T, otpEnabled bool) (string, map[string]any) {
	t.Helper()
	cap := &captured{}
	srv := gotrueStub(t, cap)
	defer srv.Close()

	svc := NewAuthService(
		integrations.NewSupabaseRestClient(srv.URL, "service-role-key"),
		nil,
		config.Config{FeatureOTPEmailEnabled: otpEnabled},
	)
	if _, err := svc.RegisterUser(domain.RegisterRequest{
		Email: "Ada@Example.com", Password: "correct-horse-battery",
		FirstName: "Ada", LastName: "Lovelace",
	}); err != nil {
		t.Fatalf("RegisterUser: %v", err)
	}
	path, body, calls := cap.snapshot()
	if calls == 0 {
		t.Fatal("RegisterUser made no GoTrue call")
	}
	return path, body
}

// With the OTP feature ON the account must be created through the ADMIN endpoint,
// which sends no mail. /auth/v1/signup would send GoTrue's own confirmation email
// on top of ours — two codes for one registration, redeemed at two different
// endpoints.
//
// There is no setting that avoids this: enable_confirmations (mailer_autoconfirm
// on cloud) governs BOTH whether the mail goes out AND whether the account starts
// unconfirmed, so turning it off would auto-confirm every sign-up and remove
// email verification altogether.
func TestRegisterUsesTheSilentAdminEndpointWhenOTPIsOn(t *testing.T) {
	path, body := registerWith(t, true)

	if path != "/auth/v1/admin/users" {
		t.Fatalf("created the account at %s — GoTrue will send its own confirmation email as well as ours", path)
	}
	// The account must still start UNCONFIRMED, or login stops gating and our
	// code verifies nothing.
	if confirm, ok := body["email_confirm"].(bool); !ok || confirm {
		t.Errorf("email_confirm = %v, want false — an auto-confirmed account skips verification entirely", body["email_confirm"])
	}
	// The admin endpoint reads user_metadata; /signup reads data. Send the wrong
	// key and handle_new_user finds no full_name, so every profile is nameless —
	// and nothing errors.
	meta, ok := body["user_metadata"].(map[string]any)
	if !ok {
		t.Fatalf("no user_metadata in the admin payload (keys: %v) — profiles would be created without a name", keysOf(body))
	}
	if meta["full_name"] != "Ada Lovelace" {
		t.Errorf("user_metadata.full_name = %v, want the joined name", meta["full_name"])
	}
	if _, present := body["data"]; present {
		t.Error("the admin payload carries \"data\", which that endpoint ignores")
	}
}

// Flag off: unchanged. An account created silently with no code to confirm it is
// worse than a duplicate email — nobody could ever verify it.
func TestRegisterUsesSignupWhenOTPIsOff(t *testing.T) {
	path, body := registerWith(t, false)

	if path != "/auth/v1/signup" {
		t.Fatalf("created the account at %s with the OTP feature off — no verification code would ever be sent", path)
	}
	meta, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("no data in the signup payload (keys: %v)", keysOf(body))
	}
	if meta["full_name"] != "Ada Lovelace" {
		t.Errorf("data.full_name = %v", meta["full_name"])
	}
}

func keysOf(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
