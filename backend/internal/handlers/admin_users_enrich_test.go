package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/services"
)

// enrichingRBAC adds the optional services.AdminUserEnricher to perUserRBAC.
type enrichingRBAC struct {
	perUserRBAC
	calls int
}

func (e *enrichingRBAC) EnrichAdminUser(_ context.Context, u domain.AdminUser) domain.AdminUser {
	e.calls++
	u.AvatarURL = "https://img/p.png"
	return u
}

func getUser(t *testing.T, svc services.RBACService, actor string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	h := NewAdminUsersHandler(svc, fakeAuditService{})
	r := gin.New()
	r.GET("/users/:id", withActor(actor), h.Get)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/users/"+rolesTargetID, nil))
	return w
}

func TestAdminUsersHandler_Get_EnrichesWhenServiceSupportsIt(t *testing.T) {
	svc := &enrichingRBAC{perUserRBAC: perUserRBAC{rolesByUser: map[string][]string{rolesActorID: {"super-admin"}}, target: domain.AdminUser{ID: rolesTargetID, State: "abuja"}}}
	w := getUser(t, svc, rolesActorID)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"avatarUrl":"https://img/p.png"`) {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestAdminUsersHandler_Get_NoEnricher_StillReturnsUser(t *testing.T) {
	svc := perUserRBAC{rolesByUser: map[string][]string{rolesActorID: {"super-admin"}}, target: domain.AdminUser{ID: rolesTargetID}}
	w := getUser(t, svc, rolesActorID)
	if w.Code != 200 || strings.Contains(w.Body.String(), "avatarUrl") {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestAdminUsersHandler_Get_OutOfScope_403_NoEnrichment(t *testing.T) {
	svc := &enrichingRBAC{perUserRBAC: perUserRBAC{
		scopesByUser: map[string][]domain.UserScope{rolesActorID: {{ScopeType: "state", ScopeID: "lagos"}}},
		target:       domain.AdminUser{ID: rolesTargetID, State: "abuja"},
	}}
	w := getUser(t, svc, rolesActorID)
	if w.Code != 403 {
		t.Fatalf("status=%d, want 403", w.Code)
	}
	if svc.calls != 0 {
		t.Fatalf("enricher called %d times for out-of-scope request", svc.calls)
	}
}

type listingRBAC struct {
	perUserRBAC
	rows []domain.AdminUser
}

func (l listingRBAC) ListAdminUsers(domain.AdminUserFilter) ([]domain.AdminUser, error) {
	return l.rows, nil
}

func TestAdminUsersHandler_List_DoesNotExposeEnrichedFields(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := listingRBAC{
		perUserRBAC: perUserRBAC{rolesByUser: map[string][]string{rolesActorID: {"super-admin"}}},
		rows:        []domain.AdminUser{{ID: rolesTargetID, Email: "e@x.com"}},
	}
	h := NewAdminUsersHandler(svc, fakeAuditService{})
	r := gin.New()
	r.GET("/users", withActor(rolesActorID), h.List)
	r.GET("/users/export", withActor(rolesActorID), h.Export)
	for _, path := range []string{"/users", "/users/export"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != 200 {
			t.Fatalf("%s status=%d", path, w.Code)
		}
		for _, k := range []string{"avatarUrl", "lastLoginAt", "emailVerifiedAt", "phoneVerifiedAt", "referralCode", "referredBy"} {
			if strings.Contains(w.Body.String(), k) {
				t.Fatalf("%s leaked %s: %s", path, k, w.Body.String())
			}
		}
	}
}
