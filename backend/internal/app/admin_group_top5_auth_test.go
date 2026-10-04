package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// E2E-SOC-034: adminGroupTop5 used to mount ONLY requireUserID(), which reads
// ginutil.UserID(c) — a context key that nothing on those groups ever set
// (RequireAuthContext is what populates it, and it was not in the chain). Every
// route built on the helper — /api/creators/admin, /api/savings/admin,
// /api/social/admin, /api/loyalty/admin(+ /black), /api/p2p/admin,
// /api/commission/admin, /api/health/admin, /api/health/pharmacy/admin
// (symptom-search), /api/health/triage/admin, /api/academy/admin and the
// academy /api-rooted admin group — answered 401 "authentication required" to
// EVERY caller including super-admin, verified live on
// POST /api/creators/admin/creators/:id/approve.
//
// The helper now takes the auth middleware (mapsAuth()/RequireAuthContext) as a
// required parameter and mounts it BEFORE requireUserID, matching the
// authMW-then-requireUserID convention from utilitybills_routes.go and the
// one-off events fix it replaced. These tests exercise the REAL
// middleware.RequireAuthContext against a stub GoTrue endpoint — not a stub
// auth middleware — so they pin the actual wiring, not a shape-alike.

// top5AdminRBAC is the RBACService RequireAuthContext consults after the token
// verifies. Embedding the interface (nil) keeps every method except the three
// requireAuth actually calls as a loud nil-panic if ever reached — the same
// convention as tests/property_authz_test.go's denyAllRBAC.
type top5AdminRBAC struct{ services.RBACService }

func (top5AdminRBAC) GetUserStatus(string) (string, error)  { return "active", nil }
func (top5AdminRBAC) GetUserRoles(string) ([]string, error) { return nil, nil }
func (top5AdminRBAC) GetUserPermissions(string, string, string) ([]string, error) {
	return nil, nil
}

// newTop5AdminEngine builds a gin engine whose only route hangs off
// adminGroupTop5 wired with the REAL RequireAuthContext, backed by a stub
// GoTrue that accepts exactly "good-token".
func newTop5AdminEngine(t *testing.T) (*gin.Engine, *bool) {
	t.Helper()

	gin.SetMode(gin.TestMode)
	gotrue := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/v1/user" {
			t.Fatalf("unexpected GoTrue request to %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get("Authorization") == "Bearer good-token" {
			_, _ = w.Write([]byte(`{"id":"u-admin-1","email":"admin@spotlight.internal"}`))
			return
		}
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"invalid_token"}`))
	}))
	t.Cleanup(gotrue.Close)

	sb := integrations.NewSupabaseRestClient(gotrue.URL, "test-api-key")
	authMW := middleware.RequireAuthContext(sb, top5AdminRBAC{})

	r := gin.New()
	reached := false
	admin := adminGroupTop5(r, "/api/creators/admin", authMW)
	admin.POST("/creators/:id/approve", func(c *gin.Context) {
		reached = true
		if got := c.GetString("user_id"); got != "u-admin-1" {
			t.Errorf("handler saw user_id=%q, want u-admin-1 (RequireAuthContext must mirror it)", got)
		}
		c.Status(http.StatusOK)
	})
	return r, &reached
}

// Without a bearer token the group must answer 401 — not 500, not a panic, not
// a pass-through to the handler.
func TestAdminGroupTop5_NoToken_Returns401(t *testing.T) {
	r, reached := newTop5AdminEngine(t)

	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/creators/admin/creators/some-id/approve", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("no token: got %d, want 401 (body: %s)", w.Code, w.Body.String())
	}
	if *reached {
		t.Error("handler must not run for an unauthenticated request")
	}
}

// A definitively-rejected token is also a 401 — the route fails closed.
func TestAdminGroupTop5_BadToken_Returns401(t *testing.T) {
	r, reached := newTop5AdminEngine(t)

	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/creators/admin/creators/some-id/approve", nil)
	req.Header.Set("Authorization", "Bearer bad-token")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("bad token: got %d, want 401 (body: %s)", w.Code, w.Body.String())
	}
	if *reached {
		t.Error("handler must not run for a rejected token")
	}
}

// The E2E-SOC-034 regression itself: a VALID token used to stop at
// requireUserID with 401 "authentication required" because nothing populated
// user_id. With authMW mounted first the request now reaches the handler — the
// distinguishing assertion is 200, where the old chain returned 401.
func TestAdminGroupTop5_ValidToken_ReachesHandler(t *testing.T) {
	r, reached := newTop5AdminEngine(t)

	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/creators/admin/creators/some-id/approve", nil)
	req.Header.Set("Authorization", "Bearer good-token")
	r.ServeHTTP(w, req)

	if w.Code == http.StatusUnauthorized {
		t.Fatalf("valid token: got 401 — E2E-SOC-034 regression (authMW is not running before requireUserID): %s", w.Body.String())
	}
	if w.Code != http.StatusOK {
		t.Fatalf("valid token: got %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	if !*reached {
		t.Error("handler did not run for a valid token")
	}
}
