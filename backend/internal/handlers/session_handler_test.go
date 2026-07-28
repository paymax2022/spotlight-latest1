package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/config"
	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// ── fakes ────────────────────────────────────────────────────────────────────

type fakeSessionService struct {
	listed     []domain.Session
	revokedOne bool
	revokedAll int
}

func (f *fakeSessionService) IssueSession(string, services.IssuedTokens, services.LoginContext) (string, error) {
	return "sid", nil
}
func (f *fakeSessionService) RotateRefresh(string, services.IssuedTokens, services.LoginContext) (*domain.Session, error) {
	return &domain.Session{}, nil
}
func (f *fakeSessionService) ValidateAccess(string) (*domain.Session, error) {
	return &domain.Session{}, nil
}
func (f *fakeSessionService) ListMySessions(string) ([]domain.Session, error) { return f.listed, nil }
func (f *fakeSessionService) RevokeOne(_, _, _, _ string) error               { f.revokedOne = true; return nil }
func (f *fakeSessionService) RevokeAll(_, _, _ string) (int, error)           { return 3, nil }
func (f *fakeSessionService) EvaluateLogin(string, string, services.LoginContext) ([]domain.SecurityEvent, error) {
	return nil, nil
}
func (f *fakeSessionService) AdminForceLogout(_, _, _ string) (int, error)    { return 2, nil }
func (f *fakeSessionService) AdminForcePasswordReset(_, _, _ string) error    { return nil }

type noopAudit struct{}

func (noopAudit) LogAction(_, _, _, _, _, _ string, _, _ map[string]any, _, _, _ string) {}
func (noopAudit) LogLogin(_, _, _, _, _, _ string, _ map[string]any)                     {}
func (noopAudit) ListAuditLogs(domain.AuditFilter) ([]map[string]any, error)             { return nil, nil }
func (noopAudit) ListLoginActivity(domain.AuditFilter) ([]map[string]any, error)         { return nil, nil }
func (noopAudit) ListSecurityEvents(domain.AuditFilter) ([]map[string]any, error)        { return nil, nil }

func setupSessionRouter(flag bool) (*gin.Engine, *fakeSessionService) {
	gin.SetMode(gin.TestMode)
	svc := &fakeSessionService{listed: []domain.Session{{ID: "s1"}}}
	cfg := config.Config{FeatureSessionHardeningEnabled: flag}
	h := NewSessionHandler(svc, noopAudit{}, cfg)
	r := gin.New()
	// inject an authenticated user for protected handlers
	r.Use(func(c *gin.Context) {
		c.Set(middleware.AuthUserContextKey, domain.AuthenticatedUser{ID: "u1", Email: "u@example.com"})
		c.Next()
	})
	r.GET("/sessions", h.ListMySessions)
	r.POST("/sessions/revoke-all", h.RevokeMyAllSessions)
	r.POST("/admin/users/:id/force-logout", h.AdminForceLogout)
	return r, svc
}

// Deny-by-default: every endpoint returns 503 feature-disabled when the flag is OFF.
func TestSessionEndpointsDenyByDefaultWhenFlagOff(t *testing.T) {
	r, _ := setupSessionRouter(false)
	for _, tc := range []struct {
		method, path string
	}{
		{http.MethodGet, "/sessions"},
		{http.MethodPost, "/sessions/revoke-all"},
		{http.MethodPost, "/admin/users/u9/force-logout"},
	} {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(tc.method, tc.path, nil)
		r.ServeHTTP(w, req)
		if w.Code != http.StatusServiceUnavailable {
			t.Fatalf("%s %s: expected 503 when flag off, got %d", tc.method, tc.path, w.Code)
		}
	}
}

// Flag ON: list returns 200 and the caller's sessions.
func TestListMySessionsWhenFlagOn(t *testing.T) {
	r, _ := setupSessionRouter(true)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/sessions", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}
}

func TestAdminForceLogoutWhenFlagOn(t *testing.T) {
	r, _ := setupSessionRouter(true)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/admin/users/u9/force-logout", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}
}
