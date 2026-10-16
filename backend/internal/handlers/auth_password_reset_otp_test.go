package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/otp"
	"spotlight/backend/internal/services"
)

// resetFake stands in for the OTP service, the ticket store, the identifier
// resolver and the password setter, so the handler's own behaviour is what is
// under test: the order of the steps, what each one refuses, and that no answer
// depends on whether an account exists.
type resetFake struct {
	mu sync.Mutex

	// accounts maps a phone number to the account email.
	accounts map[string]string
	// goodCode is accepted once, for goodEmail only.
	goodEmail, goodCode string
	verifyErr           error // forces a specific verify failure when set

	issued       chan recordedIssue
	verifyEmails []string
	tickets      map[string]string // ticket -> email
	redeemEmails []string
	setCalls     []struct{ email, password string }
	setErr       error
	ticketErr    error
}

func newResetFake() *resetFake {
	return &resetFake{
		accounts:  map[string]string{"08031234567": "ada@example.com"},
		goodEmail: "ada@example.com",
		goodCode:  "123456",
		issued:    make(chan recordedIssue, 8),
		tickets:   map[string]string{},
	}
}

func (f *resetFake) issue(_ context.Context, email, name, purpose, ip string) error {
	f.issued <- recordedIssue{email, name, purpose, ip}
	return nil
}

func (f *resetFake) verify(_ context.Context, email, purpose, code, _ string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.verifyEmails = append(f.verifyEmails, email)
	if purpose != otp.PurposePasswordReset {
		return otp.ErrInvalidCode
	}
	if f.verifyErr != nil {
		return f.verifyErr
	}
	if email == f.goodEmail && code == f.goodCode {
		f.goodCode = "" // single use
		return nil
	}
	return otp.ErrInvalidCode
}

func (f *resetFake) mint(_ context.Context, email, _ string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.ticketErr != nil {
		return "", f.ticketErr
	}
	t := "ticket-for-" + email
	f.tickets[t] = email
	return t, nil
}

func (f *resetFake) redeem(_ context.Context, email, _, ticket, _ string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.redeemEmails = append(f.redeemEmails, email)
	if owner, ok := f.tickets[ticket]; ok && owner == email {
		delete(f.tickets, ticket) // single use
		return nil
	}
	return otp.ErrInvalidCode
}

func (f *resetFake) resolve(_ context.Context, id string) string {
	if v, ok := f.accounts[id]; ok {
		return v
	}
	if services.LooksLikeEmail(id) {
		return strings.ToLower(id)
	}
	return ""
}

func (f *resetFake) SetPassword(_ context.Context, email, password string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.setErr != nil {
		return false, f.setErr
	}
	f.setCalls = append(f.setCalls, struct{ email, password string }{email, password})
	return true, nil
}

func (f *resetFake) sets() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.setCalls)
}

func newResetRouter(f *resetFake, wired bool) *gin.Engine {
	gin.SetMode(gin.TestMode)
	h := NewAuthHandler(&stubAuthService{}, nil, noopAudit{})
	if wired {
		h.WithOTPIssuer(f.issue).
			WithOTPVerifier(f.verify).
			WithOTPTickets(f.mint, f.redeem).
			WithIdentifierResolver(f.resolve).
			WithPasswordSetter(f)
	}
	r := gin.New()
	r.POST("/request", h.RequestPasswordReset)
	r.POST("/verify", h.VerifyPasswordResetOTP)
	r.POST("/reset", h.ResetPassword)
	return r
}

func resetPost(t *testing.T, r *gin.Engine, path string, body any) (int, map[string]any, string) {
	t.Helper()
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out, w.Body.String()
}

func waitIssued(t *testing.T, f *resetFake) recordedIssue {
	t.Helper()
	select {
	case c := <-f.issued:
		return c
	case <-time.After(2 * time.Second):
		t.Fatal("no code was issued")
		return recordedIssue{}
	}
}

// ── step 1: request ──────────────────────────────────────────────────────────

func TestRequestSendsACodeToTheAccountEmailForAnEmailIdentifier(t *testing.T) {
	f := newResetFake()
	code, _, _ := resetPost(t, newResetRouter(f, true), "/request", map[string]string{"identifier": "Ada@Example.com"})
	if code != http.StatusOK {
		t.Fatalf("status = %d", code)
	}
	got := waitIssued(t, f)
	if got.email != "ada@example.com" || got.purpose != otp.PurposePasswordReset {
		t.Fatalf("issued %+v, want ada@example.com / password_reset", got)
	}
}

func TestRequestAcceptsAPhoneNumberAndMailsTheAccountEmail(t *testing.T) {
	f := newResetFake()
	_, _, raw := resetPost(t, newResetRouter(f, true), "/request", map[string]string{"identifier": "08031234567"})
	got := waitIssued(t, f)
	if got.email != "ada@example.com" {
		t.Fatalf("code went to %q, want the account email", got.email)
	}
	if strings.Contains(raw, "ada@example.com") || strings.Contains(raw, "ada") {
		t.Fatalf("the response leaks the account email: %s", raw)
	}
}

func TestRequestAnswersIdenticallyWhetherOrNotAnAccountMatches(t *testing.T) {
	f := newResetFake()
	r := newResetRouter(f, true)

	c1, _, b1 := resetPost(t, r, "/request", map[string]string{"identifier": "08031234567"}) // matches
	c2, _, b2 := resetPost(t, r, "/request", map[string]string{"identifier": "08099999999"}) // matches nothing
	if c1 != c2 || b1 != b2 {
		t.Fatalf("response differs: (%d %s) vs (%d %s)", c1, b1, c2, b2)
	}
	// The unmatched number must not cost a send.
	waitIssued(t, f)
	select {
	case extra := <-f.issued:
		t.Fatalf("a code was sent for a number with no account: %+v", extra)
	case <-time.After(150 * time.Millisecond):
	}
}

func TestRequestStillAcceptsTheOlderEmailKey(t *testing.T) {
	f := newResetFake()
	resetPost(t, newResetRouter(f, true), "/request", map[string]string{"email": "ada@example.com"})
	if got := waitIssued(t, f); got.email != "ada@example.com" {
		t.Fatalf("issued to %q", got.email)
	}
}

func TestRequestRefusesWhenCodesAreNotAvailable(t *testing.T) {
	// There is no link to fall back on, so "sent" would strand the user.
	code, body, _ := resetPost(t, newResetRouter(newResetFake(), false), "/request", map[string]string{"identifier": "ada@example.com"})
	if code != http.StatusServiceUnavailable || body["error"] != "feature_disabled" {
		t.Fatalf("got %d %v, want 503 feature_disabled", code, body)
	}
}

// ── step 2: verify the code ──────────────────────────────────────────────────

func TestVerifyReturnsAResetTokenOnlyForTheRightCode(t *testing.T) {
	f := newResetFake()
	r := newResetRouter(f, true)

	code, body, _ := resetPost(t, r, "/verify", map[string]string{"identifier": "ada@example.com", "code": "000000"})
	if code != http.StatusBadRequest || body["error"] != "invalid code" {
		t.Fatalf("wrong code: %d %v", code, body)
	}
	if _, has := body["resetToken"]; has || len(f.tickets) != 0 {
		t.Fatal("a ticket was issued for a wrong code")
	}

	code, body, _ = resetPost(t, r, "/verify", map[string]string{"identifier": "ada@example.com", "code": "123456"})
	if code != http.StatusOK || body["verified"] != true {
		t.Fatalf("right code: %d %v", code, body)
	}
	if tok, _ := body["resetToken"].(string); tok == "" {
		t.Fatal("no resetToken returned for a correct code")
	}
}

func TestVerifyWorksWithAPhoneIdentifier(t *testing.T) {
	f := newResetFake()
	code, body, _ := resetPost(t, newResetRouter(f, true), "/verify", map[string]string{"identifier": "08031234567", "code": "123456"})
	if code != http.StatusOK {
		t.Fatalf("status %d %v", code, body)
	}
	if got := body["resetToken"]; got != "ticket-for-ada@example.com" {
		t.Fatalf("ticket was minted for %v, want the account email", got)
	}
}

func TestVerifyForAnUnmatchedPhoneLooksLikeAWrongCode(t *testing.T) {
	f := newResetFake()
	code, body, _ := resetPost(t, newResetRouter(f, true), "/verify", map[string]string{"identifier": "08099999999", "code": "123456"})
	if code != http.StatusBadRequest || body["error"] != "invalid code" {
		t.Fatalf("got %d %v", code, body)
	}
	// It must still travel the same path (so it costs the same), against a
	// placeholder rather than skipping the check.
	if len(f.verifyEmails) != 1 || f.verifyEmails[0] != noAccountAddress {
		t.Fatalf("verify was called with %v, want the placeholder", f.verifyEmails)
	}
}

func TestVerifyMapsExpiryAndLockoutToTheRightStatus(t *testing.T) {
	cases := []struct {
		err  error
		want int
		msg  string
	}{
		{otp.ErrExpired, http.StatusBadRequest, "code expired, request a new code"},
		{otp.ErrTooManyAttempts, http.StatusTooManyRequests, "too many attempts, request a new code"},
		{otp.ErrRateLimited, http.StatusTooManyRequests, "too many attempts, request a new code"},
	}
	for _, tc := range cases {
		f := newResetFake()
		f.verifyErr = tc.err
		code, body, _ := resetPost(t, newResetRouter(f, true), "/verify", map[string]string{"identifier": "ada@example.com", "code": "123456"})
		if code != tc.want || body["error"] != tc.msg {
			t.Errorf("%v: got %d %v, want %d %q", tc.err, code, body, tc.want, tc.msg)
		}
	}
}

func TestVerifyRejectsAnEmptyRequest(t *testing.T) {
	code, _, _ := resetPost(t, newResetRouter(newResetFake(), true), "/verify", map[string]string{"identifier": "ada@example.com"})
	if code != http.StatusBadRequest {
		t.Fatalf("missing code: status %d", code)
	}
}

func TestVerifyTellsTheUserToStartAgainIfTheTicketCannotBeMinted(t *testing.T) {
	f := newResetFake()
	f.ticketErr = errors.New("db down")
	code, body, _ := resetPost(t, newResetRouter(f, true), "/verify", map[string]string{"identifier": "ada@example.com", "code": "123456"})
	if code != http.StatusInternalServerError || !strings.Contains(body["error"].(string), "request a new code") {
		t.Fatalf("got %d %v", code, body)
	}
}

// ── step 3: set the password ─────────────────────────────────────────────────

func TestResetRequiresTheVerifiedToken(t *testing.T) {
	f := newResetFake()
	r := newResetRouter(f, true)

	// No token at all: the code step was skipped.
	code, _, _ := resetPost(t, r, "/reset", map[string]string{"identifier": "ada@example.com", "newPassword": "a-long-password"})
	if code != http.StatusBadRequest || f.sets() != 0 {
		t.Fatalf("no token: status %d, sets=%d", code, f.sets())
	}
	// The raw emailed code is not a substitute for the token.
	code, _, _ = resetPost(t, r, "/reset", map[string]string{"identifier": "ada@example.com", "resetToken": "123456", "newPassword": "a-long-password"})
	if code != http.StatusBadRequest || f.sets() != 0 {
		t.Fatalf("raw code as token: status %d, sets=%d", code, f.sets())
	}
}

func TestFullFlowSetsThePasswordOnceAndTheTokenIsSingleUse(t *testing.T) {
	f := newResetFake()
	r := newResetRouter(f, true)

	resetPost(t, r, "/request", map[string]string{"identifier": "08031234567"})
	waitIssued(t, f)

	_, v, _ := resetPost(t, r, "/verify", map[string]string{"identifier": "08031234567", "code": "123456"})
	tok, _ := v["resetToken"].(string)
	if tok == "" {
		t.Fatalf("verify gave no token: %v", v)
	}

	code, body, _ := resetPost(t, r, "/reset", map[string]string{"identifier": "08031234567", "resetToken": tok, "newPassword": "brand-new-password"})
	if code != http.StatusOK || body["success"] != true {
		t.Fatalf("reset: %d %v", code, body)
	}
	if f.sets() != 1 || f.setCalls[0].email != "ada@example.com" || f.setCalls[0].password != "brand-new-password" {
		t.Fatalf("SetPassword calls: %+v", f.setCalls)
	}

	// Replay: the same token again must not change anything.
	code, _, _ = resetPost(t, r, "/reset", map[string]string{"identifier": "08031234567", "resetToken": tok, "newPassword": "another-password"})
	if code != http.StatusBadRequest || f.sets() != 1 {
		t.Fatalf("replay: status %d, sets=%d", code, f.sets())
	}
}

func TestAWeakPasswordDoesNotBurnTheToken(t *testing.T) {
	f := newResetFake()
	r := newResetRouter(f, true)
	_, v, _ := resetPost(t, r, "/verify", map[string]string{"identifier": "ada@example.com", "code": "123456"})
	tok := v["resetToken"].(string)

	code, _, _ := resetPost(t, r, "/reset", map[string]string{"identifier": "ada@example.com", "resetToken": tok, "newPassword": "short"})
	if code != http.StatusBadRequest {
		t.Fatalf("short password: status %d", code)
	}
	if len(f.redeemEmails) != 0 {
		t.Fatal("the ticket was spent on a request that could never succeed")
	}
	// The user fixes the password and retries with the same token.
	code, _, _ = resetPost(t, r, "/reset", map[string]string{"identifier": "ada@example.com", "resetToken": tok, "newPassword": "a-proper-password"})
	if code != http.StatusOK || f.sets() != 1 {
		t.Fatalf("retry: status %d, sets=%d", code, f.sets())
	}
}

func TestATokenForOneAccountCannotResetAnother(t *testing.T) {
	f := newResetFake()
	r := newResetRouter(f, true)
	_, v, _ := resetPost(t, r, "/verify", map[string]string{"identifier": "ada@example.com", "code": "123456"})
	tok := v["resetToken"].(string)

	code, _, _ := resetPost(t, r, "/reset", map[string]string{"identifier": "victim@example.com", "resetToken": tok, "newPassword": "a-proper-password"})
	if code != http.StatusBadRequest || f.sets() != 0 {
		t.Fatalf("cross-account reset: status %d, sets=%d", code, f.sets())
	}
}

func TestResetReportsASuspendedAccountHonestly(t *testing.T) {
	f := newResetFake()
	f.setErr = services.ErrAccountUnavailable
	r := newResetRouter(f, true)
	_, v, _ := resetPost(t, r, "/verify", map[string]string{"identifier": "ada@example.com", "code": "123456"})

	code, body, _ := resetPost(t, r, "/reset", map[string]string{"identifier": "ada@example.com", "resetToken": v["resetToken"].(string), "newPassword": "a-proper-password"})
	if code != http.StatusForbidden || body["error"] != "account unavailable" {
		t.Fatalf("got %d %v", code, body)
	}
}

func TestResetRefusesWhenTheFlowIsNotWired(t *testing.T) {
	code, body, _ := resetPost(t, newResetRouter(newResetFake(), false), "/reset",
		map[string]string{"identifier": "ada@example.com", "resetToken": "x", "newPassword": "a-proper-password"})
	if code != http.StatusServiceUnavailable || body["error"] != "feature_disabled" {
		t.Fatalf("got %d %v", code, body)
	}
}
