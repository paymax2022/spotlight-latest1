package handlers

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/domain"
)

const (
	rolesActorID  = "11111111-1111-4111-8111-111111111111"
	rolesTargetID = "22222222-2222-4222-8222-222222222222"
)

// perUserRBAC answers GetUserRoles / GetAdminUser / GetUserScopes per user id
// so the actor and the target can differ (fakeRBACService cannot).
type perUserRBAC struct {
	fakeRBACService
	rolesByUser  map[string][]string
	scopesByUser map[string][]domain.UserScope
	target       domain.AdminUser
	targetErr    error
	rolesErr     error
}

func (p perUserRBAC) GetUserRoles(_ context.Context, id string) ([]string, error) {
	if id == rolesTargetID && p.rolesErr != nil {
		return nil, p.rolesErr
	}
	return p.rolesByUser[id], nil
}
func (p perUserRBAC) GetUserScopes(id string) ([]domain.UserScope, error) {
	return p.scopesByUser[id], nil
}
func (p perUserRBAC) GetAdminUser(string) (domain.AdminUser, error) { return p.target, p.targetErr }

func callUserRoles(t *testing.T, svc perUserRBAC, id string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	h := NewAdminUsersHandler(svc, fakeAuditService{})
	r := gin.New()
	r.GET("/users/:id/roles", withActor(rolesActorID), h.Roles)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/users/"+id+"/roles", nil))
	return w
}

func TestAdminUsersHandler_Roles(t *testing.T) {
	stateScoped := map[string][]domain.UserScope{rolesActorID: {{ScopeType: "state", ScopeID: "lagos"}}}
	tests := []struct {
		name       string
		svc        perUserRBAC
		id         string
		wantStatus int
		wantBody   string
		notBody    string
	}{
		{
			name:       "super-admin sees any user's roles",
			svc:        perUserRBAC{rolesByUser: map[string][]string{rolesActorID: {"super-admin"}, rolesTargetID: {"admin"}}, target: domain.AdminUser{State: "abuja"}},
			id:         rolesTargetID,
			wantStatus: 200, wantBody: `"roles":["admin"]`,
		},
		{
			name:       "scoped admin sees in-scope user",
			svc:        perUserRBAC{rolesByUser: map[string][]string{rolesTargetID: {"support"}}, scopesByUser: stateScoped, target: domain.AdminUser{State: "Lagos"}},
			id:         rolesTargetID,
			wantStatus: 200, wantBody: `"roles":["support"]`,
		},
		{
			name:       "scoped admin is refused an out-of-scope user and no roles leak",
			svc:        perUserRBAC{rolesByUser: map[string][]string{rolesTargetID: {"super-admin"}}, scopesByUser: stateScoped, target: domain.AdminUser{State: "abuja"}},
			id:         rolesTargetID,
			wantStatus: 403, notBody: "super-admin",
		},
		{
			name:       "unknown user is 404",
			svc:        perUserRBAC{targetErr: errors.New("not found")},
			id:         rolesTargetID,
			wantStatus: 404,
		},
		{
			name:       "non-uuid id is 400 before any lookup",
			svc:        perUserRBAC{},
			id:         "not-a-uuid",
			wantStatus: 400,
		},
		{
			name:       "roles lookup failure is 500",
			svc:        perUserRBAC{rolesByUser: map[string][]string{rolesActorID: {"super-admin"}}, target: domain.AdminUser{}, rolesErr: errors.New("boom")},
			id:         rolesTargetID,
			wantStatus: 500,
		},
		{
			name:       "no roles renders an empty array",
			svc:        perUserRBAC{rolesByUser: map[string][]string{rolesActorID: {"super-admin"}}, target: domain.AdminUser{}},
			id:         rolesTargetID,
			wantStatus: 200, wantBody: `"roles":[]`,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := callUserRoles(t, tc.svc, tc.id)
			if w.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d (%s)", w.Code, tc.wantStatus, w.Body.String())
			}
			if tc.wantBody != "" && !strings.Contains(w.Body.String(), tc.wantBody) {
				t.Fatalf("body %s missing %s", w.Body.String(), tc.wantBody)
			}
			if tc.notBody != "" && strings.Contains(w.Body.String(), tc.notBody) {
				t.Fatalf("body %s must not contain %s", w.Body.String(), tc.notBody)
			}
		})
	}
}
