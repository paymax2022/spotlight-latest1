package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/otp"
	"spotlight/backend/internal/services"
)

// ── doubles ─────────────────────────────────────────────────────────────────

type fakeMinter struct {
	mu      sync.Mutex
	calls   []string
	session map[string]any
	err     error
}

func (f *fakeMinter) MintSession(_ context.Context, email string) (map[string]any, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, email)
	if f.err != nil {
		return nil, f.err
	}
	return f.session, nil
}

func (f *fakeMinter) called() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.calls)
}

type fakeSetter struct {
	mu      sync.Mutex
	calls   int
	changed bool
	err     error
}

func (f *fakeSetter) SetPassword(_ context.Context, _, _ string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	if f.err != nil {
		return false, f.err
	}
	return f.changed, nil
}

// ── login: the challenge half ───────────────────────────────────────────────

// loginRouter wires a Login surface whose password check always succeeds and
// whose service reports the resolved account email the way the real one does.
func loginRouter(t *testing.T, issuer OTPIssuer, mfa bool) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	auth := &stubAuthService{loginOut: map[string]any{
		"access_token": "real-session-token", "refresh_token": "real-refresh",
		"__email": "ada@example.com", "__user_id": "pu-1",
	}}
	h := NewAuthHandler(auth, nil, noopAudit{})
	if issuer != nil {
		h.WithOTPIssuer(issuer)
	}
	h.WithLoginMFA(mfa)
	r := gin.New()
	r.POST("/api/auth/login", h.Login)
	return r
}

func loginBody() map[string]string {
	return map[string]string{"email": "ada@example.com", "password": "correct-horse-battery"}
}

// The point of the factor: a correct password alone must not produce a session.
func TestLoginWithMFAReturnsAChallengeNotASession(t *testing.T) {
	issuer := &recordingIssuer{}
	r := loginRouter(t, issuer.fn(), true)

	w := post(t, r, "/api/auth/login", loginBody())
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", w.Code, w.Body.String())
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)

	if body["mfaRequired"] != true {
		t.Errorf("mfaRequired = %v, want true", body["mfaRequired"])
	}
	// No token, in any of the three shapes Login otherwise uses. A client that
	// reads access_token opportunistically must find nothing here.
	for _, k := range []string{"access_token", "refresh_token", "session", "tokens"} {
		if _, present := body[k]; present {
			t.Errorf("the challenge response carries %q — the password alone produced a session", k)
		}
	}

	calls := issuer.recorded()
	if len(calls) != 1 {
		t.Fatalf("issuer called %d times, want 1", len(calls))
	}
	if calls[0].purpose != otp.PurposeLogin {
		t.Errorf("purpose = %q, want %q", calls[0].purpose, otp.PurposeLogin)
	}
	// Login accepts a phone number; the code must go to the RESOLVED account
	// address, which only the service knows.
	if calls[0].email != "ada@example.com" {
		t.Errorf("code sent to %q, want the resolved account email", calls[0].email)
	}
}

// Fails CLOSED. Unlike Register — where the account already exists and refusing
// would strand the user — refusing here is the entire purpose of the factor.
func TestLoginWithMFARefusesWhenTheCodeCannotBeSent(t *testing.T) {
	issuer := &recordingIssuer{err: errors.New("brevo down")}
	r := loginRouter(t, issuer.fn(), true)

	w := post(t, r, "/api/auth/login", loginBody())
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 — a send failure must not fall through to a session", w.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if _, present := body["access_token"]; present {
		t.Error("a session was returned despite the second factor never being sent")
	}
}

// Flag off: Login is exactly what it was.
func TestLoginWithoutMFAReturnsTheSessionAsBefore(t *testing.T) {
	issuer := &recordingIssuer{}
	r := loginRouter(t, issuer.fn(), false)

	w := post(t, r, "/api/auth/login", loginBody())
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	session, _ := body["session"].(map[string]any)
	if session["access_token"] != "real-session-token" {
		t.Errorf("session = %v, want the password session", session)
	}
	if n := len(issuer.recorded()); n != 0 {
		t.Errorf("a second-factor code was sent with MFA off (%d)", n)
	}
}

// MFA with no issuer would be a locked door for every user at once, so it must
// not engage.
func TestLoginMFAIgnoredWithoutAnIssuer(t *testing.T) {
	r := loginRouter(t, nil, true)
	w := post(t, r, "/api/auth/login", loginBody())
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["mfaRequired"] == true {
		t.Error("MFA engaged with no way to send a code — every user is locked out")
	}
}

// The internal hints must never reach a client. __user_id used to be stripped
// only inside the session-hardening branch, so with that flag off it shipped.
func TestLoginNeverLeaksInternalHints(t *testing.T) {
	r := loginRouter(t, nil, false)
	w := post(t, r, "/api/auth/login", loginBody())
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	session, _ := body["session"].(map[string]any)
	for _, k := range []string{"__user_id", "__email"} {
		if _, present := session[k]; present {
			t.Errorf("the response carries the internal hint %q", k)
		}
	}
}

// ── the redemption half ─────────────────────────────────────────────────────

func stepUpRouter(t *testing.T, sender otp.EmailSender, minter services.SessionMinter) (*gin.Engine, *otp.Service) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	svc, err := otp.NewService(newMemStore(), sender, &memLimiter{}, otp.Config{
		Length: 6, TTL: 10 * time.Minute, MaxAttempts: 5, Pepper: []byte("stepup-test-pepper"),
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	h := NewOTPHandler(svc, "")
	if minter != nil {
		h.WithSessionMinter(minter)
	}
	r := gin.New()
	r.POST("/api/auth/otp/verify", h.VerifyOTP)
	return r, svc
}

// issueLoginCode mints a login code the way Login does — through the service,
// never through the public request endpoint, which refuses this purpose.
func issueLoginCode(t *testing.T, svc *otp.Service, sender *capturingSender, email string) string {
	t.Helper()
	if err := svc.Issue(context.Background(), email, "", otp.PurposeLogin, ""); err != nil {
		t.Fatalf("issue: %v", err)
	}
	return sender.lastCode()
}

func TestStepUpRedemptionReturnsASession(t *testing.T) {
	sender := &capturingSender{}
	minter := &fakeMinter{session: map[string]any{"access_token": "fresh", "refresh_token": "fresh-ref"}}
	r, svc := stepUpRouter(t, sender, minter)

	code := issueLoginCode(t, svc, sender, "ada@example.com")
	w := post(t, r, "/api/auth/otp/verify",
		map[string]string{"email": "ada@example.com", "purpose": "login", "code": code})
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", w.Code, w.Body.String())
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["access_token"] != "fresh" {
		t.Errorf("access_token = %v, want the freshly minted session", body["access_token"])
	}
	// All three shapes, as Login returns.
	if s, _ := body["session"].(map[string]any); s["access_token"] != "fresh" {
		t.Errorf("session shape missing: %v", body["session"])
	}
	if tk, _ := body["tokens"].(map[string]any); tk["accessToken"] != "fresh" {
		t.Errorf("tokens shape missing: %v", body["tokens"])
	}
}

// An account suspended BETWEEN the password and the code must not complete the
// login. The gate is re-run at mint time for exactly this.
func TestStepUpRefusesAnAccountLockedBetweenFactors(t *testing.T) {
	sender := &capturingSender{}
	minter := &fakeMinter{err: services.ErrAccountUnavailable}
	r, svc := stepUpRouter(t, sender, minter)

	code := issueLoginCode(t, svc, sender, "ada@example.com")
	w := post(t, r, "/api/auth/otp/verify",
		map[string]string{"email": "ada@example.com", "purpose": "login", "code": code})
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 — a suspended account completed a sign-in", w.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if _, present := body["access_token"]; present {
		t.Error("a session was issued for an unavailable account")
	}
}

// The code is consumed before minting, so a mint failure must be reported, not
// answered with a cheerful 200 carrying no tokens.
func TestStepUpReportsAMintFailure(t *testing.T) {
	sender := &capturingSender{}
	minter := &fakeMinter{err: errors.New("gotrue down")}
	r, svc := stepUpRouter(t, sender, minter)

	code := issueLoginCode(t, svc, sender, "ada@example.com")
	w := post(t, r, "/api/auth/otp/verify",
		map[string]string{"email": "ada@example.com", "purpose": "login", "code": code})
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", w.Code)
	}
}

func TestStepUpRefusesWithNoMinterWired(t *testing.T) {
	sender := &capturingSender{}
	r, svc := stepUpRouter(t, sender, nil)

	code := issueLoginCode(t, svc, sender, "ada@example.com")
	w := post(t, r, "/api/auth/otp/verify",
		map[string]string{"email": "ada@example.com", "purpose": "login", "code": code})
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 — half-working must not look like success", w.Code)
	}
}

// A login code is single-use like every other. Replaying it must not mint a
// second session.
func TestStepUpCodeCannotBeReplayed(t *testing.T) {
	sender := &capturingSender{}
	minter := &fakeMinter{session: map[string]any{"access_token": "fresh"}}
	r, svc := stepUpRouter(t, sender, minter)

	code := issueLoginCode(t, svc, sender, "ada@example.com")
	body := map[string]string{"email": "ada@example.com", "purpose": "login", "code": code}
	if w := post(t, r, "/api/auth/otp/verify", body); w.Code != http.StatusOK {
		t.Fatalf("first status = %d", w.Code)
	}
	if w := post(t, r, "/api/auth/otp/verify", body); w.Code != http.StatusBadRequest {
		t.Fatalf("replay status = %d, want 400", w.Code)
	}
	if minter.called() != 1 {
		t.Errorf("MintSession called %d times, want 1 — a replayed code minted a second session", minter.called())
	}
}

// A login code must not be redeemable as any other purpose, and vice versa.
func TestStepUpCodeIsScopedToLogin(t *testing.T) {
	sender := &capturingSender{}
	minter := &fakeMinter{session: map[string]any{"access_token": "fresh"}}
	r, svc := stepUpRouter(t, sender, minter)

	code := issueLoginCode(t, svc, sender, "ada@example.com")
	w := post(t, r, "/api/auth/otp/verify",
		map[string]string{"email": "ada@example.com", "purpose": "password_reset", "code": code})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 — a login code was redeemed as a password reset", w.Code)
	}
	if minter.called() != 0 {
		t.Error("a session was minted for a non-login purpose")
	}
}

// ── password reset ──────────────────────────────────────────────────────────

func resetRouter(t *testing.T, verify OTPVerifier, setter services.PasswordSetter) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	h := NewAuthHandler(&stubAuthService{}, nil, noopAudit{})
	if verify != nil {
		h.WithOTPVerifier(verify)
	}
	if setter != nil {
		h.WithPasswordSetter(setter)
	}
	r := gin.New()
	r.POST("/api/auth/reset-password", h.ResetPassword)
	return r
}

func okVerifier() OTPVerifier {
	return func(context.Context, string, string, string, string) error { return nil }
}

// The endpoint used to answer "Password reset successful" for a password it had
// not changed, for any non-empty token. It must actually set the password now.
func TestResetPasswordActuallySetsThePassword(t *testing.T) {
	setter := &fakeSetter{changed: true}
	r := resetRouter(t, okVerifier(), setter)

	w := post(t, r, "/api/auth/reset-password", map[string]string{
		"email": "Ada@Example.com", "code": "482913", "newPassword": "brand-new-passphrase",
	})
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", w.Code, w.Body.String())
	}
	if setter.calls != 1 {
		t.Fatalf("SetPassword called %d times, want 1 — the endpoint reported success without changing anything", setter.calls)
	}
}

// The old shape reported success and changed nothing. It must now say so.
func TestResetPasswordRefusesTheOldTokenForm(t *testing.T) {
	setter := &fakeSetter{changed: true}
	r := resetRouter(t, okVerifier(), setter)

	w := post(t, r, "/api/auth/reset-password", map[string]string{
		"token": "anything-at-all", "newPassword": "brand-new-passphrase",
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 — the token form still reports a reset it did not perform", w.Code)
	}
	if setter.calls != 0 {
		t.Error("a password was changed without a verified code")
	}
}

func TestResetPasswordRefusesAWrongCode(t *testing.T) {
	setter := &fakeSetter{changed: true}
	bad := func(context.Context, string, string, string, string) error { return otp.ErrInvalidCode }
	r := resetRouter(t, bad, setter)

	w := post(t, r, "/api/auth/reset-password", map[string]string{
		"email": "a@b.com", "code": "000000", "newPassword": "brand-new-passphrase",
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	if setter.calls != 0 {
		t.Fatal("the password was changed despite an invalid code")
	}
}

// A suspended account must not take a new password and walk back in.
func TestResetPasswordRefusesAnUnavailableAccount(t *testing.T) {
	setter := &fakeSetter{err: services.ErrAccountUnavailable}
	r := resetRouter(t, okVerifier(), setter)

	w := post(t, r, "/api/auth/reset-password", map[string]string{
		"email": "a@b.com", "code": "482913", "newPassword": "brand-new-passphrase",
	})
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", w.Code)
	}
}

// An address with no account answers exactly like one that was reset.
func TestResetPasswordDoesNotRevealWhetherAnAccountExists(t *testing.T) {
	real := resetRouter(t, okVerifier(), &fakeSetter{changed: true})
	ghost := resetRouter(t, okVerifier(), &fakeSetter{changed: false})
	body := map[string]string{"email": "a@b.com", "code": "482913", "newPassword": "brand-new-passphrase"}

	a := post(t, real, "/api/auth/reset-password", body)
	b := post(t, ghost, "/api/auth/reset-password", body)
	if a.Code != b.Code || a.Body.String() != b.Body.String() {
		t.Errorf("responses differ, so the endpoint enumerates accounts:\n  %d %s\n  %d %s",
			a.Code, a.Body.String(), b.Code, b.Body.String())
	}
}

func TestResetPasswordIs503WhenTheFeatureIsClosed(t *testing.T) {
	r := resetRouter(t, nil, nil)
	w := post(t, r, "/api/auth/reset-password", map[string]string{
		"email": "a@b.com", "code": "482913", "newPassword": "brand-new-passphrase",
	})
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", w.Code)
	}
}

var _ = domain.LoginRequest{}
