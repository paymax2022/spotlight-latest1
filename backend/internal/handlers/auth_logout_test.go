package handlers

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/middleware"
)

// newLogoutRouter mounts Logout the way apiAuthProtected does: the auth
// middleware has already populated authUser + authToken context keys.
func newLogoutRouter(t *testing.T, auth *stubAuthService, authed bool) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	h := NewAuthHandler(auth, nil, noopAudit{})
	r := gin.New()
	if authed {
		r.Use(func(c *gin.Context) {
			c.Set(middleware.AuthUserContextKey, domain.AuthenticatedUser{ID: "u1", Email: "u@example.com"})
			c.Set(middleware.AuthTokenContextKey, "tok-123")
			c.Next()
		})
	}
	r.POST("/api/auth/logout", h.Logout)
	return r
}

func postLogout(r *gin.Engine) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/auth/logout", nil)
	r.ServeHTTP(w, req)
	return w
}

func TestLogoutAnonymousIsRejected(t *testing.T) {
	auth := &stubAuthService{}
	w := postLogout(newLogoutRouter(t, auth, false))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d (%s)", w.Code, w.Body.String())
	}
	if auth.logoutCalls != 0 {
		t.Fatalf("anonymous logout must not reach GoTrue, got %d calls", auth.logoutCalls)
	}
}

func TestLogoutRevokesUpstreamSession(t *testing.T) {
	auth := &stubAuthService{}
	w := postLogout(newLogoutRouter(t, auth, true))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	if auth.logoutCalls != 1 || auth.logoutToken != "tok-123" {
		t.Fatalf("expected one GoTrue revoke with the bearer token, got calls=%d token=%q", auth.logoutCalls, auth.logoutToken)
	}
}

// A GoTrue outage still completes the local logout — the client must not be
// stranded — but the failure propagates through the audit/log path.
func TestLogoutUpstreamFailureStillSucceeds(t *testing.T) {
	auth := &stubAuthService{logoutErr: errors.New("gotrue unreachable")}
	w := postLogout(newLogoutRouter(t, auth, true))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 despite upstream failure, got %d (%s)", w.Code, w.Body.String())
	}
	if auth.logoutCalls != 1 {
		t.Fatalf("expected one revoke attempt, got %d", auth.logoutCalls)
	}
}
