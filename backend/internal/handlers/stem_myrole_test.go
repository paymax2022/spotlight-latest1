package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/services"
)

// erroringRBACService reports a GetUserRoles failure — embeds RBACService as
// nil so only the one method this test needs is implemented; any other call
// would nil-panic, which MyRole never makes.
type erroringRBACService struct{ services.RBACService }

func (erroringRBACService) GetUserRoles(string) ([]string, error) {
	return nil, &stemMyRoleTestErr{"lookup failed"}
}

type stemMyRoleTestErr struct{ msg string }

func (e *stemMyRoleTestErr) Error() string { return e.msg }

func myRoleRouter(t *testing.T, h *StemHandler, setAdminUserID bool, adminUserID string) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/my-role", func(c *gin.Context) {
		if setAdminUserID {
			c.Set("adminUserID", adminUserID)
		}
		h.MyRole(c)
	})
	return r
}

func TestStemMyRole_NoVerifiedIdentity(t *testing.T) {
	h := NewStemHandler(nil).WithRBAC(fakeRBACService{roles: []string{"judge"}})
	r := myRoleRouter(t, h, false, "")

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/my-role", nil))

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestStemMyRole_NoRBACWired(t *testing.T) {
	h := NewStemHandler(nil) // no WithRBAC call — rbac is nil
	r := myRoleRouter(t, h, true, "user-1")

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/my-role", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if want := `"roles":[]`; !strings.Contains(w.Body.String(), want) {
		t.Fatalf("expected body to contain %q, got %s", want, w.Body.String())
	}
}

func TestStemMyRole_NoRolesHeld(t *testing.T) {
	h := NewStemHandler(nil).WithRBAC(fakeRBACService{roles: []string{"registered-user"}})
	r := myRoleRouter(t, h, true, "user-1")

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/my-role", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if want := `"roles":[]`; !strings.Contains(w.Body.String(), want) {
		t.Fatalf("expected empty roles (no recognized STEM role), got %s", w.Body.String())
	}
}

func TestStemMyRole_ResolvesRealStemRole(t *testing.T) {
	h := NewStemHandler(nil).WithRBAC(fakeRBACService{roles: []string{"judge"}})
	r := myRoleRouter(t, h, true, "user-judge")

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/my-role", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if want := `"roles":["JUDGE"]`; !strings.Contains(w.Body.String(), want) {
		t.Fatalf("expected roles to contain JUDGE, got %s", w.Body.String())
	}
}

// system-admin resolves to its ADMIN alias — same mapping RequireStemRoles
// itself uses (stem_authz.go's normalizeStemRoleSlug). The mechanical
// SYSTEM_ADMIN conversion is also produced internally but filtered out by
// ResolveStemRoleNames since it isn't a name in middleware.AllStemRoleNames
// (router.go's allow-lists use "ADMIN" for this role, never "SYSTEM_ADMIN").
func TestStemMyRole_SystemAdminAliasesToAdmin(t *testing.T) {
	h := NewStemHandler(nil).WithRBAC(fakeRBACService{roles: []string{"system-admin"}})
	r := myRoleRouter(t, h, true, "user-admin")

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/my-role", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	body := w.Body.String()
	if want := `"roles":["ADMIN"]`; !strings.Contains(body, want) {
		t.Fatalf("expected roles to be exactly [ADMIN], got %s", body)
	}
}

func TestStemMyRole_FailsClosedOnRoleLookupError(t *testing.T) {
	h := NewStemHandler(nil).WithRBAC(erroringRBACService{})
	r := myRoleRouter(t, h, true, "user-1")

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/my-role", nil))

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}
