package services

import (
	"encoding/json"
	"errors"
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

	// How the stub answers GET /auth/v1/settings. Zero values mean "200, signups
	// open", which is what every pre-existing test expects.
	sStatus int
	sBody   string
}

func (c *captured) settingsStatus() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.sStatus == 0 {
		return http.StatusOK
	}
	return c.sStatus
}

func (c *captured) settingsBody() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.sBody == "" {
		return `{"disable_signup":false,"mailer_autoconfirm":false}`
	}
	return c.sBody
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
		if r.URL.Path == "/auth/v1/settings" {
			w.WriteHeader(cap.settingsStatus())
			_, _ = w.Write([]byte(cap.settingsBody()))
			return
		}
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
	path, body, err := registerRaw(t, otpEnabled, nil)
	if err != nil {
		t.Fatalf("RegisterUser: %v", err)
	}
	return path, body
}

// registerRaw returns the error too, and lets a test choose how the stub answers
// GET /auth/v1/settings.
func registerRaw(t *testing.T, otpEnabled bool, settings func(*captured)) (string, map[string]any, error) {
	t.Helper()
	cap := &captured{}
	if settings != nil {
		settings(cap)
	}
	srv := gotrueStub(t, cap)
	defer srv.Close()

	svc := NewAuthService(
		integrations.NewSupabaseRestClient(srv.URL, "service-role-key"),
		nil,
		config.Config{FeatureOTPEmailEnabled: otpEnabled},
	)
	// The admin path is gated on OTP being OPERATIONAL, not merely flagged — see
	// TestRegisterUsesSignupWhenTheFlagIsOnButOTPNeverWired.
	SetOTPOperational(svc, otpEnabled)
	_, err := svc.RegisterUser(domain.RegisterRequest{
		Email: "Ada@Example.com", Password: "correct-horse-battery",
		FirstName: "Ada", LastName: "Lovelace",
	})
	path, body, _ := cap.snapshot()
	return path, body, err
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

// ── the project signup policy on the admin path ─────────────────────────────

// /auth/v1/admin/users is NOT gated by the project's enable_signup switch — that
// is the price of a creation call that sends no mail. So a project that closed
// registrations would keep creating accounts through it, silently, with the
// operator believing the door was shut.
func TestRegisterRefusesWhenTheProjectHasClosedSignups(t *testing.T) {
	path, _, err := registerRaw(t, true, func(c *captured) {
		c.sBody = `{"disable_signup":true,"mailer_autoconfirm":false}`
	})
	if !errors.Is(err, ErrSignupDisabled) {
		t.Fatalf("error = %v, want ErrSignupDisabled", err)
	}
	if path == "/auth/v1/admin/users" {
		t.Fatal("an account was created despite the project having closed signups")
	}
}

// Fails CLOSED. /settings and /admin/users are the same service, so a settings
// read that fails means the create would very likely fail too — and treating the
// error as "signups are open" would let a partial outage reopen a door the
// project deliberately closed.
func TestRegisterRefusesWhenTheSignupPolicyCannotBeRead(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
	}{
		{"settings endpoint errors", http.StatusInternalServerError, `{}`},
		{"settings body is not json", http.StatusOK, `<html>gateway</html>`},
		// The field being renamed or dropped must not read as "open".
		{"disable_signup field is absent", http.StatusOK, `{"mailer_autoconfirm":false}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path, _, err := registerRaw(t, true, func(c *captured) {
				c.sStatus, c.sBody = tc.status, tc.body
			})
			if !errors.Is(err, ErrSignupDisabled) {
				t.Fatalf("error = %v, want ErrSignupDisabled", err)
			}
			if path == "/auth/v1/admin/users" {
				t.Fatal("an account was created without confirming the signup policy")
			}
		})
	}
}

// With the flag off we use /auth/v1/signup, which GoTrue gates itself. Checking
// again here would be a second opinion on a question the endpoint already
// answers — and one extra round trip on the shipped path.
func TestRegisterDoesNotReadTheSignupPolicyOnTheSignupPath(t *testing.T) {
	path, _, err := registerRaw(t, false, func(c *captured) {
		c.sStatus, c.sBody = http.StatusInternalServerError, `{}`
	})
	if err != nil {
		t.Fatalf("RegisterUser: %v — an unreadable /settings must not affect the /signup path", err)
	}
	if path != "/auth/v1/signup" {
		t.Fatalf("path = %s, want /auth/v1/signup", path)
	}
}

// THE regression for a defect this file's earlier version did not catch.
//
// RegisterUser used to branch on cfg.FeatureOTPEmailEnabled while the register
// HANDLER branched on whether an issuer was actually wired. Those disagree in a
// state that is easy to reach — flag on, Brevo credentials absent, which is the
// repository's state today — and the result was an account created through the
// silent admin path (so GoTrue sent nothing) with no code issued either.
// Unconfirmed, unverifiable, login refused forever, and /api/auth/otp/request
// answering 503 so the user could not even ask for one.
//
// Reproduced live before the fix: registration returned 201, the mail catcher
// recorded zero messages, otp_codes was empty, and login answered 403.
func TestRegisterUsesSignupWhenTheFlagIsOnButOTPNeverWired(t *testing.T) {
	cap := &captured{}
	srv := gotrueStub(t, cap)
	defer srv.Close()

	svc := NewAuthService(
		integrations.NewSupabaseRestClient(srv.URL, "service-role-key"),
		nil,
		// Flag ON …
		config.Config{FeatureOTPEmailEnabled: true},
	)
	// … but the OTP service was never built, so SetOTPOperational is never called.

	if _, err := svc.RegisterUser(domain.RegisterRequest{
		Email: "Ada@Example.com", Password: "correct-horse-battery",
		FirstName: "Ada", LastName: "Lovelace",
	}); err != nil {
		t.Fatalf("RegisterUser: %v", err)
	}
	path, _, _ := cap.snapshot()
	if path != "/auth/v1/signup" {
		t.Fatalf("created the account at %s with no OTP service wired — GoTrue sends nothing and no code is issued, so the account can never be verified", path)
	}
}
