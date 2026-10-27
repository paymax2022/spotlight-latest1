package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/services"
)

// Unit coverage for RequireStepUp (ESTD-D014) and RequireExplicitPermission
// (ESTD-D028). No database: the verifier seam is faked.

type fakeStepUpVerifier struct {
	state StepUpGrantState
	err   error

	gotUser, gotHash string
}

func (f *fakeStepUpVerifier) GrantState(_ context.Context, userID, accessTokenHash string) (StepUpGrantState, error) {
	f.gotUser, f.gotHash = userID, accessTokenHash
	return f.state, f.err
}

// stepUpRouter mounts a protected route behind the gate the way production
// does: RequireAuthContext has already run, so the test sets what it would
// have set (authUser + authToken).
func stepUpRouter(v StepUpVerifier, enforce bool, authed bool) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/privileged", func(c *gin.Context) {
		if authed {
			c.Set(AuthUserContextKey, domain.AuthenticatedUser{ID: "u-1", Email: "a@b.c"})
			c.Set(AuthTokenContextKey, "tok-abc")
		}
		c.Next()
	}, RequireStepUp(StepUpOptions{
		Enforce:  enforce,
		Verifier: func() StepUpVerifier { return v },
		Action:   "test.action",
	}), func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })
	return r
}

func doStepUpReq(t *testing.T, r *gin.Engine) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/privileged", nil)
	req.Header.Set("Authorization", "Bearer tok-abc")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestRequireStepUp_FlagOffPassesThrough(t *testing.T) {
	r := stepUpRouter(nil, false, true)
	if w := doStepUpReq(t, r); w.Code != http.StatusOK {
		t.Fatalf("enforce=false must pass through, got %d", w.Code)
	}
}

func TestRequireStepUp_NoIdentityRefused401(t *testing.T) {
	r := stepUpRouter(&fakeStepUpVerifier{}, true, false)
	w := doStepUpReq(t, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("no upstream identity must 401, got %d", w.Code)
	}
}

func TestRequireStepUp_NilVerifierFailsClosed503(t *testing.T) {
	r := stepUpRouter(nil, true, true)
	w := doStepUpReq(t, r)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("nil verifier must fail closed 503, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), CodeStepUpUnavailable) {
		t.Fatalf("expected code %s in body, got %s", CodeStepUpUnavailable, w.Body.String())
	}
}

func TestRequireStepUp_VerifierErrorFailsClosed503(t *testing.T) {
	r := stepUpRouter(&fakeStepUpVerifier{err: errors.New("db down")}, true, true)
	if w := doStepUpReq(t, r); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("verifier error must fail closed 503, got %d", w.Code)
	}
}

func TestRequireStepUp_NoGrant403Required(t *testing.T) {
	r := stepUpRouter(&fakeStepUpVerifier{state: StepUpGrantState{Found: false}}, true, true)
	w := doStepUpReq(t, r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("no grant must 403, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), CodeStepUpRequired) {
		t.Fatalf("expected code %s in body, got %s", CodeStepUpRequired, w.Body.String())
	}
}

func TestRequireStepUp_ExpiredGrant403Expired(t *testing.T) {
	st := StepUpGrantState{Found: true, Active: false, ExpiresAt: time.Now().Add(-time.Minute)}
	r := stepUpRouter(&fakeStepUpVerifier{state: st}, true, true)
	w := doStepUpReq(t, r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expired grant must 403, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), CodeStepUpExpired) {
		t.Fatalf("expected code %s in body, got %s", CodeStepUpExpired, w.Body.String())
	}
}

func TestRequireStepUp_ActiveGrantPassesAndBindsToken(t *testing.T) {
	fv := &fakeStepUpVerifier{state: StepUpGrantState{Found: true, Active: true, ExpiresAt: time.Now().Add(time.Minute)}}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/privileged", func(c *gin.Context) {
		c.Set(AuthUserContextKey, domain.AuthenticatedUser{ID: "u-9"})
		c.Set(AuthTokenContextKey, "tok-xyz")
		c.Next()
	}, RequireStepUp(StepUpOptions{Enforce: true, Verifier: func() StepUpVerifier { return fv }}),
		func(c *gin.Context) { c.Status(http.StatusNoContent) })
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/privileged", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("active grant must pass, got %d", w.Code)
	}
	if fv.gotUser != "u-9" {
		t.Fatalf("verifier saw user %q, want u-9", fv.gotUser)
	}
	if want := services.HashToken("tok-xyz"); fv.gotHash != want {
		t.Fatalf("verifier saw token hash %q, want sha256 of bearer token", fv.gotHash)
	}
}

// RequireAdminConsoleRole callers carry only "adminUserID" + the Authorization
// header they were verified with. The grant must still bind to that token.
func TestRequireStepUp_AdminUserIDFallback(t *testing.T) {
	fv := &fakeStepUpVerifier{state: StepUpGrantState{Found: true, Active: true}}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/privileged", func(c *gin.Context) {
		c.Set("adminUserID", "adm-1")
		c.Next()
	}, RequireStepUp(StepUpOptions{Enforce: true, Verifier: func() StepUpVerifier { return fv }}),
		func(c *gin.Context) { c.Status(http.StatusNoContent) })
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/privileged", nil)
	req.Header.Set("Authorization", "Bearer console-tok")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("admin console identity must pass with active grant, got %d", w.Code)
	}
	if fv.gotUser != "adm-1" || fv.gotHash != services.HashToken("console-tok") {
		t.Fatalf("verifier saw (%q,%q), want adm-1 + sha256(console-tok)", fv.gotUser, fv.gotHash)
	}
}

func TestRequireExplicitPermission(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const perm = "support.impersonate"
	mk := func(u *domain.AuthenticatedUser) *gin.Engine {
		r := gin.New()
		r.GET("/x", func(c *gin.Context) {
			if u != nil {
				c.Set(AuthUserContextKey, *u)
			}
			c.Next()
		}, RequireExplicitPermission(perm), func(c *gin.Context) { c.Status(http.StatusNoContent) })
		return r
	}
	call := func(r *gin.Engine) int {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/x", nil))
		return w.Code
	}

	if code := call(mk(nil)); code != http.StatusUnauthorized {
		t.Fatalf("no identity: want 401, got %d", code)
	}
	if code := call(mk(&domain.AuthenticatedUser{ID: "u", Permissions: []string{"other"}})); code != http.StatusForbidden {
		t.Fatalf("missing permission: want 403, got %d", code)
	}
	// The point of the guard: the super-admin bypass that RequirePermission
	// honours must NOT confer this capability.
	if code := call(mk(&domain.AuthenticatedUser{ID: "u", Roles: []string{"super-admin"}})); code != http.StatusForbidden {
		t.Fatalf("super-admin without explicit grant: want 403, got %d", code)
	}
	if code := call(mk(&domain.AuthenticatedUser{ID: "u", Permissions: []string{perm}})); code != http.StatusNoContent {
		t.Fatalf("explicit permission: want 204, got %d", code)
	}
}
