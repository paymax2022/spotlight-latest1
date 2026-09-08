package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/otp"
)

// fakeVerifier stands in for GoTrue.
type fakeVerifier struct {
	mu        sync.Mutex
	calls     []string
	confirmed bool // what ConfirmEmail reports when it succeeds
	err       error
}

func (f *fakeVerifier) ConfirmEmail(_ context.Context, email string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, email)
	if f.err != nil {
		return false, f.err
	}
	return f.confirmed, nil
}

func (f *fakeVerifier) called() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.calls...)
}

func newVerifyEmailRouter(t *testing.T, sender otp.EmailSender, v *fakeVerifier) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	svc, err := otp.NewService(newMemStore(), sender, &memLimiter{}, otp.Config{
		Length: 6, TTL: 10 * 60_000_000_000, MaxAttempts: 5,
		Pepper: []byte("verify-email-test-pepper"),
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	h := NewOTPHandler(svc, "")
	if v != nil {
		h.WithEmailVerifier(v)
	}
	r := gin.New()
	r.POST("/api/auth/otp/request", h.RequestOTP)
	r.POST("/api/auth/otp/verify", h.VerifyOTP)
	return r
}

func issueAndCode(t *testing.T, r *gin.Engine, sender *capturingSender, email, purpose string) string {
	t.Helper()
	w := post(t, r, "/api/auth/otp/request", map[string]string{"email": email, "purpose": purpose})
	if w.Code != http.StatusOK {
		t.Fatalf("request status = %d: %s", w.Code, w.Body.String())
	}
	code := sender.lastCode()
	if len(code) != 6 {
		t.Fatalf("no code issued")
	}
	return code
}

// The whole point of the wiring: redeeming a verify_email code must activate the
// account, not merely report that the mailbox was reached.
func TestVerifyEmailConfirmsTheAccount(t *testing.T) {
	sender := &capturingSender{}
	v := &fakeVerifier{confirmed: true}
	r := newVerifyEmailRouter(t, sender, v)

	code := issueAndCode(t, r, sender, "Ada@Example.com", otp.PurposeVerifyEmail)
	w := post(t, r, "/api/auth/otp/verify",
		map[string]string{"email": "ada@example.com", "purpose": otp.PurposeVerifyEmail, "code": code})
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", w.Code, w.Body.String())
	}
	calls := v.called()
	if len(calls) != 1 {
		t.Fatalf("ConfirmEmail called %d times, want 1 — the code verified but the account was never activated", len(calls))
	}
	// The verifier must receive the normalized address, or it looks up nothing.
	if calls[0] != "ada@example.com" {
		t.Errorf("ConfirmEmail got %q, want the normalized address", calls[0])
	}
}

// Login and password_reset prove mailbox control and nothing else. Confirming an
// account off the back of a login code would activate an address that never went
// through registration.
func TestOtherPurposesDoNotConfirmAnything(t *testing.T) {
	// PurposeLogin is not self-issuable any more, so it cannot be driven through
	// the request endpoint here; its non-confirmation is covered in
	// otp_login_stepup_test.go.
	for _, purpose := range []string{otp.PurposePasswordReset} {
		t.Run(purpose, func(t *testing.T) {
			sender := &capturingSender{}
			v := &fakeVerifier{confirmed: true}
			r := newVerifyEmailRouter(t, sender, v)

			code := issueAndCode(t, r, sender, "a@b.com", purpose)
			w := post(t, r, "/api/auth/otp/verify",
				map[string]string{"email": "a@b.com", "purpose": purpose, "code": code})
			if w.Code != http.StatusOK {
				t.Fatalf("status = %d: %s", w.Code, w.Body.String())
			}
			if n := len(v.called()); n != 0 {
				t.Errorf("ConfirmEmail was called %d times for purpose %q", n, purpose)
			}
		})
	}
}

// An address with no account behind it must be indistinguishable from one that
// was just confirmed. The request endpoint accepts any address on purpose, so a
// different answer here rebuilds the enumeration oracle.
func TestVerifyEmailAnswersIdenticallyWhenThereIsNoAccount(t *testing.T) {
	senderA, senderB := &capturingSender{}, &capturingSender{}
	withAccount := newVerifyEmailRouter(t, senderA, &fakeVerifier{confirmed: true})
	without := newVerifyEmailRouter(t, senderB, &fakeVerifier{confirmed: false})

	codeA := issueAndCode(t, withAccount, senderA, "real@example.com", otp.PurposeVerifyEmail)
	codeB := issueAndCode(t, without, senderB, "ghost@example.com", otp.PurposeVerifyEmail)

	a := post(t, withAccount, "/api/auth/otp/verify",
		map[string]string{"email": "real@example.com", "purpose": otp.PurposeVerifyEmail, "code": codeA})
	b := post(t, without, "/api/auth/otp/verify",
		map[string]string{"email": "ghost@example.com", "purpose": otp.PurposeVerifyEmail, "code": codeB})

	if a.Code != b.Code {
		t.Errorf("statuses differ: %d vs %d", a.Code, b.Code)
	}
	if a.Body.String() != b.Body.String() {
		t.Errorf("bodies differ, so the endpoint reveals whether an account exists:\n  account:    %s\n  no account: %s",
			a.Body.String(), b.Body.String())
	}
	// And specifically: nothing in the body names the outcome of the lookup.
	if strings.Contains(a.Body.String(), "emailConfirmed") {
		t.Error("the response carries the confirmation outcome — that is the oracle")
	}
}

// The code is consumed before confirmation is attempted, so a GoTrue failure
// leaves the user with a spent code and an inactive account. They must be told,
// not congratulated — their next step is to request a new code.
func TestVerifyEmailReportsAConfirmationFailure(t *testing.T) {
	sender := &capturingSender{}
	v := &fakeVerifier{err: errors.New("gotrue unreachable")}
	r := newVerifyEmailRouter(t, sender, v)

	code := issueAndCode(t, r, sender, "a@b.com", otp.PurposeVerifyEmail)
	w := post(t, r, "/api/auth/otp/verify",
		map[string]string{"email": "a@b.com", "purpose": otp.PurposeVerifyEmail, "code": code})

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 — a failed activation must not be reported as success", w.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["success"] != false {
		t.Errorf("success = %v, want false", body["success"])
	}
	if msg, _ := body["error"].(string); !strings.Contains(msg, "new code") {
		t.Errorf("error = %q — it must tell the user their next step, since the code is already spent", msg)
	}
}

// Enabled but unable to finish the job. Half-working is the failure this refuses
// to ship: the code would be consumed, the response cheerful, and the account
// still unable to log in.
func TestVerifyEmailRefusesWhenNoVerifierIsWired(t *testing.T) {
	sender := &capturingSender{}
	r := newVerifyEmailRouter(t, sender, nil)

	code := issueAndCode(t, r, sender, "a@b.com", otp.PurposeVerifyEmail)
	w := post(t, r, "/api/auth/otp/verify",
		map[string]string{"email": "a@b.com", "purpose": otp.PurposeVerifyEmail, "code": code})
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", w.Code)
	}
}
