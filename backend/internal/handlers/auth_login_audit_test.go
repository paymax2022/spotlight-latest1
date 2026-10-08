package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/services"
)

// E2E-AUTH-007: every login_activity row used to be anonymous — Login passed
// in.Email, which is empty for identifier logins, and ignored the resolved
// __user_id/__email hints. These tests pin the attribution on both the
// success and failure paths.

type recordedLogin struct{ userID, email, status, reason string }

type recordingAudit struct {
	noopAudit

	mu     sync.Mutex
	logins []recordedLogin
}

func (a *recordingAudit) LogLogin(userID, email, status, reason, _, _ string, _ map[string]any) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.logins = append(a.logins, recordedLogin{userID, email, status, reason})
}

func (a *recordingAudit) last() (recordedLogin, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.logins) == 0 {
		return recordedLogin{}, false
	}
	return a.logins[len(a.logins)-1], true
}

func loginAuditRouter(t *testing.T, auth *stubAuthService) (*gin.Engine, *recordingAudit) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	audit := &recordingAudit{}
	h := NewAuthHandler(auth, nil, audit)
	r := gin.New()
	r.POST("/api/auth/login", h.Login)
	return r, audit
}

// A successful identifier login must be attributed to the account the service
// resolved, not to the (empty) request email field.
func TestLoginActivityAttributesAResolvedIdentifierLogin(t *testing.T) {
	auth := &stubAuthService{loginOut: map[string]any{
		"access_token": "tok", "__email": "ada@example.com", "__user_id": "pu-1",
	}}
	r, audit := loginAuditRouter(t, auth)

	w := post(t, r, "/api/auth/login",
		map[string]string{"identifier": "+2348012345678", "password": "correct-horse-battery"})
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", w.Code, w.Body.String())
	}
	got, ok := audit.last()
	if !ok {
		t.Fatal("no login_activity row was written")
	}
	if got.userID != "pu-1" || got.email != "ada@example.com" {
		t.Errorf("login_activity attribution = (%q, %q), want the resolved (pu-1, ada@example.com)", got.userID, got.email)
	}
	if got.status != "success" || got.reason != "" {
		t.Errorf("login_activity status/reason = (%q, %q), want (success, \"\")", got.status, got.reason)
	}
}

// A refused login is exactly the row forensics needs most. The service wraps
// its error with the identity it resolved before failing; the handler must
// attribute the row to that identity.
func TestLoginActivityAttributesAResolvedFailedLogin(t *testing.T) {
	auth := &stubAuthService{loginErr: &services.LoginFailureError{
		UserID: "pu-9", Email: "bob@example.com", Err: errors.New("invalid credentials"),
	}}
	r, audit := loginAuditRouter(t, auth)

	w := post(t, r, "/api/auth/login",
		map[string]string{"identifier": "+2348099999999", "password": "wrong-password"})
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
	got, ok := audit.last()
	if !ok {
		t.Fatal("no login_activity row was written")
	}
	if got.userID != "pu-9" || got.email != "bob@example.com" {
		t.Errorf("login_activity attribution = (%q, %q), want the resolved (pu-9, bob@example.com)", got.userID, got.email)
	}
	if got.status != "failed" || got.reason != "invalid_credentials" {
		t.Errorf("login_activity status/reason = (%q, %q), want (failed, invalid_credentials)", got.status, got.reason)
	}
}

// The wrapper must not hide ErrEmailNotConfirmed from errors.Is — the 403
// branch still fires, and the row carries the resolved email.
func TestLoginActivityAttributesAnUnconfirmedAccount(t *testing.T) {
	auth := &stubAuthService{loginErr: &services.LoginFailureError{
		Email: "unverified@example.com", Err: services.ErrEmailNotConfirmed,
	}}
	r, audit := loginAuditRouter(t, auth)

	w := post(t, r, "/api/auth/login",
		map[string]string{"identifier": "+2348088888888", "password": "correct-horse-battery"})
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 — ErrEmailNotConfirmed was masked by the wrapper", w.Code)
	}
	got, ok := audit.last()
	if !ok {
		t.Fatal("no login_activity row was written")
	}
	if got.email != "unverified@example.com" || got.reason != "email_not_confirmed" {
		t.Errorf("login_activity = %+v, want email unverified@example.com, reason email_not_confirmed", got)
	}
}

// E2E-FR-049: a GoTrue outage is not a credential verdict. The service returns
// ErrAuthUnavailable (no strike counted); the handler must answer 503 and
// record the honest "upstream_error" reason — never a false
// invalid_credentials row, which is what made an IdP outage look like a wave
// of wrong passwords.
func TestLoginActivityRecordsUpstreamFailureNotInvalidCredentials(t *testing.T) {
	auth := &stubAuthService{loginErr: &services.LoginFailureError{
		UserID: "pu-7", Email: "ada@example.com",
		Err: fmt.Errorf("%w: token endpoint returned 502", services.ErrAuthUnavailable),
	}}
	r, audit := loginAuditRouter(t, auth)

	w := post(t, r, "/api/auth/login",
		map[string]string{"email": "ada@example.com", "password": "correct-horse-battery"})
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 — an upstream outage must not answer 401 invalid credentials", w.Code)
	}
	got, ok := audit.last()
	if !ok {
		t.Fatal("no login_activity row was written — an outage window still belongs in the audit trail")
	}
	if got.userID != "pu-7" || got.email != "ada@example.com" {
		t.Errorf("login_activity attribution = (%q, %q), want the resolved (pu-7, ada@example.com)", got.userID, got.email)
	}
	if got.status != "failed" || got.reason != "upstream_error" {
		t.Errorf("login_activity status/reason = (%q, %q), want (failed, upstream_error) — invalid_credentials would be a false credential verdict", got.status, got.reason)
	}
}
