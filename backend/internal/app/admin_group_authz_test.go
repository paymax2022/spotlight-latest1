package app

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"spotlight/backend/internal/config"
)

// AUTH-010: adminGroup (menu-counts, leads, chatbot sessions, handoffs,
// analytics, competitions, reality-tv dashboard, and — because stemRead/
// stemManage are sub-groups of adminGroup — the whole STEM admin tree too)
// used to be gated ONLY by RequireAdmin, which is satisfied by the shared
// x-admin-api-key alone. frontend-admin's admin-proxy route attaches that key
// to every request it forwards regardless of caller identity, so any
// anonymous request reaching the proxy (or anyone who obtained the key)
// reached real PII — lead names/emails/phones, chatbot transcripts — with no
// identity check at all. overviewGroup and adminConsole were already fixed to
// also require middleware.RequireAdminConsoleRole; this pins that adminGroup
// (wired at router.go, in the same "/admin" tree) now requires it too,
// exercised through the REAL router (NewRouter), not just the middleware in
// isolation the way admin_console_rbac_failclosed_test.go does.
//
// testAdminAPIKey stands in for a correctly-configured ADMIN_API_KEY. Every
// request below sends it via x-admin-api-key — deliberately reproducing what
// frontend-admin's admin-proxy route does unconditionally for every request
// it forwards, authenticated or not (AUTH-010's confused-deputy). If
// RequireAdminConsoleRole were missing from adminGroup, this key alone would
// satisfy RequireAdmin and the request would reach the handler.
const testAdminAPIKey = "test-admin-key-for-auth010"

func TestAdminGroupRoutes_RequireVerifiedAdminIdentity(t *testing.T) {
	r := NewRouter(config.Config{AdminAPIKey: testAdminAPIKey, AppEnv: "test"})

	cases := []struct {
		name   string
		method string
		path   string
	}{
		{"menu-counts (top-level adminGroup route)", http.MethodGet, "/api/v1/admin/menu-counts"},
		{"leads list — PII: names/emails/phones", http.MethodGet, "/api/v1/admin/leads"},
		{"leads PATCH", http.MethodPatch, "/api/v1/admin/leads/some-id"},
		{"chatbot sessions — user conversation transcripts", http.MethodGet, "/api/v1/admin/chatbot/sessions"},
		{"chatbot session by id", http.MethodGet, "/api/v1/admin/chatbot/sessions/some-id"},
		{"handoffs", http.MethodGet, "/api/v1/admin/handoffs"},
		{"analytics summary", http.MethodGet, "/api/v1/admin/analytics/summary"},
		{"competitions overview", http.MethodGet, "/api/v1/admin/competitions/overview"},
		{"competitions open-mic", http.MethodGet, "/api/v1/admin/competitions/open-mic"},
		{"reality-tv dashboard", http.MethodGet, "/api/v1/admin/reality-tv/dashboard"},
		// stemRead/stemManage are sub-groups of adminGroup created AFTER
		// adminGroup.Use(RequireAdminConsoleRole(...)), so they inherit it too —
		// on top of their own pre-existing (and separately header-trust-based,
		// see stem_authz.go) RequireStemRoles check.
		{"stem overview (adminGroup sub-group)", http.MethodGet, "/api/v1/admin/stem/overview"},
		{"stem schools", http.MethodGet, "/api/v1/admin/schools"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			req.Header.Set("x-admin-api-key", testAdminAPIKey) // the confused-deputy key, no bearer token
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code == http.StatusOK {
				t.Fatalf("%s %s with only x-admin-api-key (no verified identity): got 200 — this route is reachable via the confused-deputy path (body: %s)",
					tc.method, tc.path, w.Body.String())
			}
			if w.Code != http.StatusUnauthorized && w.Code != http.StatusForbidden {
				t.Fatalf("%s %s with only x-admin-api-key: got %d, want 401 or 403 (body: %s)",
					tc.method, tc.path, w.Code, w.Body.String())
			}
		})
	}
}

// A bogus client-supplied x-stem-role header, even combined with the
// (correctly-configured) x-admin-api-key, must not grant access to a stem
// sub-group route now that it sits behind RequireAdminConsoleRole too — the
// header alone was previously sufficient once RequireAdmin's key check passed.
func TestAdminGroupStemRoutes_HeaderAloneInsufficient(t *testing.T) {
	r := NewRouter(config.Config{AdminAPIKey: testAdminAPIKey, AppEnv: "test"})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/stem/overview", nil)
	req.Header.Set("x-admin-api-key", testAdminAPIKey)
	req.Header.Set("x-stem-role", "SUPER_ADMIN")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code == http.StatusOK {
		t.Fatalf("x-admin-api-key + x-stem-role, no verified identity: got 200, want 401/403 (body: %s)", w.Body.String())
	}
}
