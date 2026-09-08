package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/otp"
	"spotlight/backend/internal/services"
)

// ── doubles ─────────────────────────────────────────────────────────────────

type stubAuthService struct {
	result   *services.RegisterResult
	err      error
	loginOut map[string]any
}

func (s *stubAuthService) RegisterUser(domain.RegisterRequest) (*services.RegisterResult, error) {
	return s.result, s.err
}
func (s *stubAuthService) LoginUser(domain.LoginRequest) (map[string]any, error) {
	// A fresh copy per call: the handler deletes the internal hints in place, and
	// a shared map would make the second test in a run see them already gone.
	out := map[string]any{}
	for k, v := range s.loginOut {
		out[k] = v
	}
	return out, nil
}
func (s *stubAuthService) RequestPasswordReset(string) error                    { return nil }
func (s *stubAuthService) ResetPassword(string, string) error                   { return nil }
func (s *stubAuthService) ChangePassword(string, string, string) error          { return nil }
func (s *stubAuthService) CompleteProfile(string, string, map[string]any) error { return nil }

// noopAudit is declared in session_handler_test.go and reused here.

type recordedIssue struct{ email, name, purpose, ip string }

type recordingIssuer struct {
	mu    sync.Mutex
	calls []recordedIssue
	err   error
}

func (r *recordingIssuer) fn() OTPIssuer {
	return func(_ context.Context, email, name, purpose, ip string) error {
		r.mu.Lock()
		defer r.mu.Unlock()
		r.calls = append(r.calls, recordedIssue{email, name, purpose, ip})
		return r.err
	}
}

func (r *recordingIssuer) recorded() []recordedIssue {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]recordedIssue(nil), r.calls...)
}

// newRegisterRouter builds the Register surface. rbac is nil deliberately —
// Register never touches it, and a full RBAC fake would be twenty dead methods.
func newRegisterRouter(t *testing.T, auth services.AuthService, issuer OTPIssuer) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	h := NewAuthHandler(auth, nil, noopAudit{})
	if issuer != nil {
		h.WithOTPIssuer(issuer)
	}
	r := gin.New()
	r.POST("/api/auth/register", h.Register)
	return r
}

func registerBody() map[string]string {
	return map[string]string{
		"email": "New.User@Example.com", "password": "correct-horse-battery",
		"firstName": "Ada", "lastName": "Lovelace",
	}
}

// ── the wiring ──────────────────────────────────────────────────────────────

// Signup with confirmations ON returns no session, which is what
// NeedsVerification reports. That is exactly when a code has to go out.
func TestRegisterIssuesAVerificationCodeWhenVerificationIsNeeded(t *testing.T) {
	issuer := &recordingIssuer{}
	auth := &stubAuthService{result: &services.RegisterResult{UserID: "u1", Email: "new.user@example.com"}}
	r := newRegisterRouter(t, auth, issuer.fn())

	w := post(t, r, "/api/auth/register", registerBody())
	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d: %s", w.Code, w.Body.String())
	}

	calls := issuer.recorded()
	if len(calls) != 1 {
		t.Fatalf("issuer called %d times, want 1 — registration completed with no way for the user to verify", len(calls))
	}
	if calls[0].purpose != otp.PurposeVerifyEmail {
		t.Errorf("purpose = %q, want %q", calls[0].purpose, otp.PurposeVerifyEmail)
	}
	if calls[0].name != "Ada Lovelace" {
		t.Errorf("name = %q, want the joined full name", calls[0].name)
	}
}

// Confirmations OFF: signup returns a session, the account is already usable,
// and a verification code would be a confusing email about nothing.
func TestRegisterDoesNotIssueWhenSignupAlreadyReturnedASession(t *testing.T) {
	issuer := &recordingIssuer{}
	auth := &stubAuthService{result: &services.RegisterResult{
		UserID: "u1", Email: "a@b.com", AccessToken: "tok", RefreshToken: "ref",
	}}
	r := newRegisterRouter(t, auth, issuer.fn())

	w := post(t, r, "/api/auth/register", registerBody())
	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d", w.Code)
	}
	if n := len(issuer.recorded()); n != 0 {
		t.Errorf("issuer called %d times for an already-confirmed signup", n)
	}
}

// THE property. The account exists by the time we try to send. Failing the
// response would send the user back to a register form that answers
// "registration failed" for an account that is genuinely theirs — and they could
// never get past it.
func TestRegisterStillSucceedsWhenTheCodeCannotBeSent(t *testing.T) {
	issuer := &recordingIssuer{err: errors.New("brevo is down")}
	auth := &stubAuthService{result: &services.RegisterResult{UserID: "u1", Email: "a@b.com"}}
	r := newRegisterRouter(t, auth, issuer.fn())

	w := post(t, r, "/api/auth/register", registerBody())
	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 — a send failure rolled back a successful registration: %s", w.Code, w.Body.String())
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["success"] != true {
		t.Errorf("success = %v, want true", body["success"])
	}
	if body["needsVerification"] != true {
		t.Errorf("needsVerification = %v, want true — the user must still be sent to the verify screen", body["needsVerification"])
	}
}

// With the feature closed the issuer is nil and Register must behave exactly as
// it shipped.
func TestRegisterUnchangedWithNoIssuerWired(t *testing.T) {
	auth := &stubAuthService{result: &services.RegisterResult{UserID: "u1", Email: "a@b.com"}}
	r := newRegisterRouter(t, auth, nil)

	w := post(t, r, "/api/auth/register", registerBody())
	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d", w.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["needsVerification"] != true {
		t.Errorf("needsVerification = %v, want true", body["needsVerification"])
	}
}

// A failed registration must not send a code. Doing so would confirm to anyone
// that an address is already taken — the enumeration leak the generic error
// message exists to prevent.
func TestRegisterDoesNotIssueWhenRegistrationFails(t *testing.T) {
	issuer := &recordingIssuer{}
	auth := &stubAuthService{err: errors.New("registration failed: 422")}
	r := newRegisterRouter(t, auth, issuer.fn())

	w := post(t, r, "/api/auth/register", registerBody())
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	if n := len(issuer.recorded()); n != 0 {
		t.Errorf("a code was sent for a failed registration (%d call(s)) — that tells the caller the address is taken", n)
	}
}
