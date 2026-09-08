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

	mu            sync.Mutex
	registerCalls int
}

func (s *stubAuthService) registered() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.registerCalls
}

func (s *stubAuthService) RegisterUser(domain.RegisterRequest) (*services.RegisterResult, error) {
	s.mu.Lock()
	s.registerCalls++
	s.mu.Unlock()
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

// ── the signup budget (GoTrue's sign_in_sign_ups, replaced) ─────────────────

type recordingGate struct {
	mu      sync.Mutex
	ips     []string
	allowed bool
	err     error
}

func (g *recordingGate) fn() SignupGate {
	return func(_ context.Context, ip string) (bool, error) {
		g.mu.Lock()
		defer g.mu.Unlock()
		g.ips = append(g.ips, ip)
		return g.allowed, g.err
	}
}

func (g *recordingGate) count() int {
	g.mu.Lock()
	defer g.mu.Unlock()
	return len(g.ips)
}

func newGatedRegisterRouter(t *testing.T, gate SignupGate, issuer OTPIssuer) (*gin.Engine, *stubAuthService) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	auth := &stubAuthService{result: &services.RegisterResult{UserID: "u1", Email: "a@b.com"}}
	h := NewAuthHandler(auth, nil, noopAudit{})
	if issuer != nil {
		h.WithOTPIssuer(issuer)
	}
	if gate != nil {
		h.WithSignupGate(gate)
	}
	r := gin.New()
	r.POST("/api/auth/register", h.Register)
	return r, auth
}

// /auth/v1/admin/users does not apply GoTrue's sign_in_sign_ups budget, so
// without this the silent creation path is unthrottled beyond one in-process
// limiter per replica.
func TestRegisterRefusedWhenTheSignupBudgetIsSpent(t *testing.T) {
	gate := &recordingGate{allowed: false}
	issuer := &recordingIssuer{}
	r, auth := newGatedRegisterRouter(t, gate.fn(), issuer.fn())

	w := post(t, r, "/api/auth/register", registerBody())
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", w.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["code"] != "signup_rate_limited" {
		t.Errorf("code = %v, want signup_rate_limited", body["code"])
	}
	// And nothing was created or emailed. This is the ordering assertion: the
	// budget is spent, so the account must never have been created — checking
	// after creation would leave the row behind and only refuse the response.
	if n := auth.registered(); n != 0 {
		t.Errorf("RegisterUser was called %d times for a refused registration — the account was created and then thrown away", n)
	}
	if n := len(issuer.recorded()); n != 0 {
		t.Errorf("a verification code was issued for a refused registration (%d)", n)
	}
}

// A limiter that cannot reach its store must refuse. Answering "allowed" would
// report protection it is not providing.
func TestRegisterRefusedWhenTheSignupBudgetCannotBeEvaluated(t *testing.T) {
	gate := &recordingGate{allowed: true, err: errors.New("database down")}
	r, auth := newGatedRegisterRouter(t, gate.fn(), nil)

	w := post(t, r, "/api/auth/register", registerBody())
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429 — a broken limiter waved the registration through", w.Code)
	}
	if n := auth.registered(); n != 0 {
		t.Errorf("an account was created despite the budget being unevaluable (%d call(s))", n)
	}
}

// An allowed registration consults the budget exactly once and proceeds.
//
// (The ORDERING — budget before creation — is asserted in the two refusal tests
// above, by requiring that RegisterUser was never called. An earlier version of
// this test claimed to check ordering while only counting gate calls, and a
// mutation that moved the check after creation passed it.)
func TestSignupBudgetConsultedOnceOnTheHappyPath(t *testing.T) {
	gate := &recordingGate{allowed: true}
	issuer := &recordingIssuer{}
	r, auth := newGatedRegisterRouter(t, gate.fn(), issuer.fn())

	if w := post(t, r, "/api/auth/register", registerBody()); w.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", w.Code)
	}
	if gate.count() != 1 {
		t.Fatalf("gate consulted %d times, want 1", gate.count())
	}
	if auth.registered() != 1 {
		t.Fatalf("RegisterUser called %d times, want 1", auth.registered())
	}
}

// With no gate wired registration goes through /auth/v1/signup, where GoTrue
// applies its own budget. A second one here would halve the shipped allowance.
func TestRegisterUnthrottledHereWhenGoTrueDoesIt(t *testing.T) {
	r, _ := newGatedRegisterRouter(t, nil, nil)
	if w := post(t, r, "/api/auth/register", registerBody()); w.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", w.Code)
	}
}
