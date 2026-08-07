package middleware

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/services"
)

// fakeSessionSvc lets us control ValidateAccess for the middleware test.
type fakeSessionSvc struct{ revoked bool }

func (f fakeSessionSvc) IssueSession(string, services.IssuedTokens, services.LoginContext) (string, error) {
	return "", nil
}
func (f fakeSessionSvc) RotateRefresh(string, services.IssuedTokens, services.LoginContext) (*domain.Session, error) {
	return nil, nil
}
func (f fakeSessionSvc) ValidateAccess(string) (*domain.Session, error) {
	if f.revoked {
		return nil, fmt.Errorf("session revoked or expired")
	}
	return &domain.Session{ID: "s1"}, nil
}
func (f fakeSessionSvc) ListMySessions(string) ([]domain.Session, error) { return nil, nil }
func (f fakeSessionSvc) RevokeOne(_, _, _, _ string) error               { return nil }
func (f fakeSessionSvc) RevokeAll(_, _, _ string) (int, error)           { return 0, nil }
func (f fakeSessionSvc) EvaluateLogin(string, string, services.LoginContext) ([]domain.SecurityEvent, error) {
	return nil, nil
}
func (f fakeSessionSvc) AdminForceLogout(_, _, _ string) (int, error) { return 0, nil }
func (f fakeSessionSvc) AdminForcePasswordReset(_, _, _ string) error { return nil }

// fakeSupabase mimics the Supabase /auth/v1/user endpoint returning a valid user.
func fakeSupabaseServer() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"u1","email":"u@example.com"}`))
	}))
}

func TestSessionEnforcementRejectsRevoked(t *testing.T) {
	gin.SetMode(gin.TestMode)
	srv := fakeSupabaseServer()
	defer srv.Close()
	sb := integrations.NewSupabaseRestClient(srv.URL, "key")

	r := gin.New()
	r.Use(RequireAuthContextWithSessions(sb, mockRBAC{allow: true}, fakeSessionSvc{revoked: true}, true))
	r.GET("/x", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer validtoken")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("revoked session must yield 401, got %d (%s)", w.Code, w.Body.String())
	}
}

func TestSessionEnforcementAllowsActive(t *testing.T) {
	gin.SetMode(gin.TestMode)
	srv := fakeSupabaseServer()
	defer srv.Close()
	sb := integrations.NewSupabaseRestClient(srv.URL, "key")

	r := gin.New()
	r.Use(RequireAuthContextWithSessions(sb, mockRBAC{allow: true}, fakeSessionSvc{revoked: false}, true))
	r.GET("/x", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer validtoken")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("active session must pass, got %d (%s)", w.Code, w.Body.String())
	}
}

// Flag OFF: even a "revoked" session passes the middleware (no-op check),
// preserving the pre-hardening behaviour.
func TestSessionEnforcementNoOpWhenDisabled(t *testing.T) {
	gin.SetMode(gin.TestMode)
	srv := fakeSupabaseServer()
	defer srv.Close()
	sb := integrations.NewSupabaseRestClient(srv.URL, "key")

	r := gin.New()
	r.Use(RequireAuthContextWithSessions(sb, mockRBAC{allow: true}, fakeSessionSvc{revoked: true}, false))
	r.GET("/x", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Authorization", "Bearer validtoken")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("flag-off must not enforce, got %d", w.Code)
	}
}
