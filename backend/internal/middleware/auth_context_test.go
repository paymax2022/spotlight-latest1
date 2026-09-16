package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/integrations"
)

// AUTH-005: RequireAuthContext's base bearer-token-verification path had only
// the session-revocation add-on (RequireAuthContextWithSessions) covered.
// These pin the core path everything else relies on.

// statusRBAC lets each test control what GetUserStatus reports, on top of
// the no-op mockRBAC already used elsewhere in this package.
type statusRBAC struct {
	mockRBAC
	status string
	err    error
}

func (s statusRBAC) GetUserStatus(string) (string, error) { return s.status, s.err }

func authUserServer(t *testing.T, status int, body string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/auth/v1/user" {
			t.Fatalf("unexpected request to %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
}

func doRequest(r *gin.Engine, authHeader string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	r.ServeHTTP(w, req)
	return w
}

func TestRequireAuthContext_MissingAuthorizationHeaderReturns401(t *testing.T) {
	gin.SetMode(gin.TestMode)
	sb := integrations.NewSupabaseRestClient("http://unused.invalid", "key")
	r := gin.New()
	r.Use(RequireAuthContext(sb, statusRBAC{status: "active"}))
	r.GET("/x", func(c *gin.Context) { c.Status(http.StatusOK) })

	w := doRequest(r, "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("missing Authorization header: got %d, want 401", w.Code)
	}
}

func TestRequireAuthContext_MalformedHeaderReturns401(t *testing.T) {
	gin.SetMode(gin.TestMode)
	sb := integrations.NewSupabaseRestClient("http://unused.invalid", "key")
	r := gin.New()
	r.Use(RequireAuthContext(sb, statusRBAC{status: "active"}))
	r.GET("/x", func(c *gin.Context) { c.Status(http.StatusOK) })

	for _, h := range []string{"validtoken", "Token abc", "Basic abc123", "bearer"} {
		t.Run(h, func(t *testing.T) {
			w := doRequest(r, h)
			if w.Code != http.StatusUnauthorized {
				t.Fatalf("malformed header %q: got %d, want 401", h, w.Code)
			}
		})
	}
}

func TestRequireAuthContext_TokenFailingSupabaseVerificationReturns401(t *testing.T) {
	gin.SetMode(gin.TestMode)
	srv := authUserServer(t, http.StatusUnauthorized, `{"error":"invalid_token"}`)
	defer srv.Close()
	sb := integrations.NewSupabaseRestClient(srv.URL, "key")

	r := gin.New()
	r.Use(RequireAuthContext(sb, statusRBAC{status: "active"}))
	reached := false
	r.GET("/x", func(c *gin.Context) { reached = true; c.Status(http.StatusOK) })

	w := doRequest(r, "Bearer bad-token")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("token failing verification: got %d, want 401", w.Code)
	}
	if reached {
		t.Error("the downstream handler must not run for an unverifiable token")
	}
}

// A verification response with no "id" field must also be rejected — an
// authenticated-looking payload with no usable subject is not a valid user.
func TestRequireAuthContext_TokenWithNoSubjectReturns401(t *testing.T) {
	gin.SetMode(gin.TestMode)
	srv := authUserServer(t, http.StatusOK, `{"email":"noid@example.com"}`)
	defer srv.Close()
	sb := integrations.NewSupabaseRestClient(srv.URL, "key")

	r := gin.New()
	r.Use(RequireAuthContext(sb, statusRBAC{status: "active"}))
	r.GET("/x", func(c *gin.Context) { c.Status(http.StatusOK) })

	w := doRequest(r, "Bearer sometoken")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("token verifying with no id: got %d, want 401", w.Code)
	}
}

func TestRequireAuthContext_ValidTokenProceedsWithAuthenticatedUserInContext(t *testing.T) {
	gin.SetMode(gin.TestMode)
	srv := authUserServer(t, http.StatusOK, `{"id":"u-42","email":"ada@example.com"}`)
	defer srv.Close()
	sb := integrations.NewSupabaseRestClient(srv.URL, "key")

	r := gin.New()
	r.Use(RequireAuthContext(sb, statusRBAC{status: "active"}))

	var gotUserID, gotEmail, gotAuthUserID string
	var ok bool
	r.GET("/x", func(c *gin.Context) {
		gotUserID = c.GetString("user_id")
		gotEmail = c.GetString("user_email")
		if u, present := GetAuthenticatedUser(c); present {
			ok = true
			gotAuthUserID = u.ID
		}
		c.Status(http.StatusOK)
	})

	w := doRequest(r, "Bearer good-token")
	if w.Code != http.StatusOK {
		t.Fatalf("valid token: got %d, want 200", w.Code)
	}
	if !ok {
		t.Error("AuthUserContextKey must be set in context")
	}
	if gotUserID != "u-42" || gotAuthUserID != "u-42" {
		t.Errorf("user_id in context = %q / authUser.ID = %q, want \"u-42\"", gotUserID, gotAuthUserID)
	}
	if gotEmail != "ada@example.com" {
		t.Errorf("user_email in context = %q, want \"ada@example.com\"", gotEmail)
	}
}

// ── platform_users status gate (rbac.GetUserStatus) ─────────────────────
//
// Discovery note: GetUserStatus is said to default to "pending" on a missing
// row. Pinning the middleware's ACTUAL reaction to each status value, not
// asserting what it "should" do.

func TestRequireAuthContext_StatusGate(t *testing.T) {
	cases := []struct {
		status   string
		err      error
		wantCode int
	}{
		{status: "active", wantCode: http.StatusOK},
		{status: "suspended", wantCode: http.StatusForbidden},
		{status: "locked", wantCode: http.StatusForbidden},
		{status: "deleted", wantCode: http.StatusForbidden},
		// Pinning current behaviour: "pending" (the documented default for a
		// missing platform_users row) is not in the blocked set, so it passes.
		{status: "pending", wantCode: http.StatusOK},
		// An empty status (e.g. GetUserStatus errored and returned "") is also
		// not in the blocked set, so it passes too — pinning current behaviour.
		{status: "", wantCode: http.StatusOK},
	}
	for _, tc := range cases {
		t.Run("status="+tc.status, func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			srv := authUserServer(t, http.StatusOK, `{"id":"u-1","email":"a@b.com"}`)
			defer srv.Close()
			sb := integrations.NewSupabaseRestClient(srv.URL, "key")

			r := gin.New()
			r.Use(RequireAuthContext(sb, statusRBAC{status: tc.status, err: tc.err}))
			r.GET("/x", func(c *gin.Context) { c.Status(http.StatusOK) })

			w := doRequest(r, "Bearer good-token")
			if w.Code != tc.wantCode {
				t.Fatalf("status=%q: got %d, want %d (%s)", tc.status, w.Code, tc.wantCode, w.Body.String())
			}
		})
	}
}
