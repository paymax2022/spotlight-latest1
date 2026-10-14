package handlers

// Tests for the per-user module membership endpoint and its registry.
// The handler tests use the membershipQuerier seam (no DB); the registry guards
// mirror admin_overview_test.go: structure, links resolve, and a live-DB check
// that every SQL runs against the migrated schema.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/domain"
)

type modulesResp struct {
	Success bool         `json:"success"`
	Modules []userModule `json:"modules"`
}

func superAdminRBAC() perUserRBAC {
	return perUserRBAC{rolesByUser: map[string][]string{rolesActorID: {"super-admin"}}, target: domain.AdminUser{}}
}

func callModules(t *testing.T, h *AdminUsersHandler, id string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/users/:id/modules", withActor(rolesActorID), h.Modules)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/users/"+id+"/modules", nil))
	return w
}

func enabledModulesHandler(svc perUserRBAC, q membershipQuerier) *AdminUsersHandler {
	h := NewAdminUsersHandler(svc, fakeAuditService{})
	h.modulesEnabled = true
	h.membership = q
	return h
}

func decodeModules(t *testing.T, w *httptest.ResponseRecorder) modulesResp {
	t.Helper()
	var out modulesResp
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v (%s)", err, w.Body.String())
	}
	return out
}

func zeroQuerier(context.Context, string, string) (int64, string, error) { return 0, "", nil }

func TestModules_FeatureOff_404(t *testing.T) {
	h := NewAdminUsersHandler(superAdminRBAC(), fakeAuditService{})
	h.membership = zeroQuerier // disabled flag wins even with a querier
	if w := callModules(t, h, rolesTargetID); w.Code != http.StatusNotFound {
		t.Fatalf("flag off: status = %d, want 404", w.Code)
	}
	h2 := NewAdminUsersHandler(superAdminRBAC(), fakeAuditService{})
	h2.modulesEnabled = true // enabled but no pool/querier
	if w := callModules(t, h2, rolesTargetID); w.Code != http.StatusNotFound {
		t.Fatalf("no pool: status = %d, want 404", w.Code)
	}
}

func TestModules_InvalidUUID_400(t *testing.T) {
	h := enabledModulesHandler(superAdminRBAC(), zeroQuerier)
	if w := callModules(t, h, "not-a-uuid"); w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}

func TestModules_UnknownUser_404(t *testing.T) {
	h := enabledModulesHandler(perUserRBAC{targetErr: errors.New("nope")}, zeroQuerier)
	if w := callModules(t, h, rolesTargetID); w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", w.Code)
	}
}

func TestModules_OutOfScope_403_NoQueriesRun(t *testing.T) {
	var calls int32
	q := func(context.Context, string, string) (int64, string, error) {
		atomic.AddInt32(&calls, 1)
		return 1, "", nil
	}
	svc := perUserRBAC{
		scopesByUser: map[string][]domain.UserScope{rolesActorID: {{ScopeType: "state", ScopeID: "lagos"}}},
		target:       domain.AdminUser{State: "abuja"},
	}
	w := callModules(t, enabledModulesHandler(svc, q), rolesTargetID)
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", w.Code)
	}
	if n := atomic.LoadInt32(&calls); n != 0 {
		t.Fatalf("%d membership queries ran for an out-of-scope user", n)
	}
}

func sqlFor(key string) string {
	for _, s := range membershipSpecs {
		if s.Key == key {
			return s.SQL
		}
	}
	return ""
}

func TestModules_MemberNoneError(t *testing.T) {
	member, none, bad := sqlFor("restaurants"), sqlFor("drivers"), sqlFor("crypto_accounts")
	if member == "" || none == "" || bad == "" {
		t.Fatal("test keys missing from registry")
	}
	q := func(_ context.Context, sql, _ string) (int64, string, error) {
		switch sql {
		case member:
			return 2, "2026-01-02 03:04:05+00", nil
		case bad:
			return 0, "", errors.New("relation does not exist")
		}
		return 0, "", nil
	}
	w := callModules(t, enabledModulesHandler(superAdminRBAC(), q), rolesTargetID)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	got := map[string]userModule{}
	for _, m := range decodeModules(t, w).Modules {
		got[m.Key] = m
	}
	if m := got["restaurants"]; m.Status != "member" || m.Count != 2 || m.Since == "" {
		t.Errorf("restaurants = %+v, want member/2/since", m)
	}
	if m := got["drivers"]; m.Status != "none" || m.Count != 0 {
		t.Errorf("drivers = %+v, want none/0", m)
	}
	if m := got["crypto_accounts"]; m.Status != "error" {
		t.Errorf("crypto = %+v, want error", m)
	}
	if strings.Contains(w.Body.String(), "relation does not exist") {
		t.Error("raw error text leaked into the response")
	}
}

func TestModules_OneQueryTimesOut_OthersStillReturned(t *testing.T) {
	slow := sqlFor("crypto_accounts")
	q := func(ctx context.Context, sql, _ string) (int64, string, error) {
		if sql == slow {
			<-ctx.Done()
			return 0, "", ctx.Err()
		}
		return 1, "", nil
	}
	h := enabledModulesHandler(superAdminRBAC(), q)
	h.modulesTimeout = 50 * time.Millisecond
	w := callModules(t, h, rolesTargetID)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	for _, m := range decodeModules(t, w).Modules {
		switch {
		case m.Key == "crypto_accounts" && m.Status != "error":
			t.Errorf("slow row status = %q, want error", m.Status)
		case m.Key != "crypto_accounts" && m.Status != "member":
			t.Errorf("%s status = %q, want member", m.Key, m.Status)
		}
	}
}

func TestModules_HrefSubstitutesUserID(t *testing.T) {
	w := callModules(t, enabledModulesHandler(superAdminRBAC(), zeroQuerier), rolesTargetID)
	mods := decodeModules(t, w).Modules
	var seen int
	for _, m := range mods {
		if strings.Contains(m.Href, "{") {
			t.Errorf("%s: href %q still has a placeholder", m.Key, m.Href)
		}
		if m.Key == "mkt_listings" || m.Key == "connect_profiles" {
			seen++
			if !strings.HasSuffix(m.Href, "/"+rolesTargetID) {
				t.Errorf("%s: href %q does not end in the user id", m.Key, m.Href)
			}
		}
	}
	if seen != 2 {
		t.Fatalf("expected both per-user hrefs, saw %d", seen)
	}
}

func TestModules_PassesUserIDAsParameter(t *testing.T) {
	var bad int32
	q := func(_ context.Context, sql, userID string) (int64, string, error) {
		if userID != rolesTargetID || strings.Contains(sql, rolesTargetID) {
			atomic.AddInt32(&bad, 1)
		}
		return 0, "", nil
	}
	callModules(t, enabledModulesHandler(superAdminRBAC(), q), rolesTargetID)
	if bad != 0 {
		t.Fatalf("%d queries did not bind the user id as $1", bad)
	}
}

func TestModules_RespectsConcurrencyCap(t *testing.T) {
	var cur, max int32
	var mu sync.Mutex
	q := func(context.Context, string, string) (int64, string, error) {
		n := atomic.AddInt32(&cur, 1)
		mu.Lock()
		if n > max {
			max = n
		}
		mu.Unlock()
		time.Sleep(10 * time.Millisecond)
		atomic.AddInt32(&cur, -1)
		return 0, "", nil
	}
	callModules(t, enabledModulesHandler(superAdminRBAC(), q), rolesTargetID)
	if max > overviewConcurrency || max < 2 {
		t.Fatalf("max in-flight = %d, want 2..%d", max, overviewConcurrency)
	}
}

func TestModules_ResponseOrderMatchesRegistry(t *testing.T) {
	w := callModules(t, enabledModulesHandler(superAdminRBAC(), zeroQuerier), rolesTargetID)
	mods := decodeModules(t, w).Modules
	if len(mods) != len(membershipSpecs) {
		t.Fatalf("got %d modules, want %d", len(mods), len(membershipSpecs))
	}
	for i, m := range mods {
		if m.Key != membershipSpecs[i].Key {
			t.Fatalf("row %d = %s, want %s", i, m.Key, membershipSpecs[i].Key)
		}
	}
}

// ---- registry guards ----------------------------------------------------------

var membershipSQL = regexp.MustCompile(`^SELECT count\(\*\), min\([a-z_]+\)::text FROM public\.([a-z_][a-z0-9_]*) WHERE ([a-z_][a-z0-9_]*) = \$1( AND [^;]+)?$`)

var membershipGroups = map[string]bool{
	"Money": true, "Commerce": true, "Travel": true, "Health": true,
	"Community": true, "Programs": true, "Platform": true,
}

func TestMembershipSpecs_Structure(t *testing.T) {
	if len(membershipSpecs) != 22 {
		t.Errorf("registry has %d rows, want 22", len(membershipSpecs))
	}
	seen := map[string]bool{}
	for _, s := range membershipSpecs {
		if s.Key == "" || s.Label == "" || s.Group == "" || s.Href == "" || s.SQL == "" {
			t.Errorf("%q: every field is required: %+v", s.Key, s)
		}
		if seen[s.Key] {
			t.Errorf("duplicate key %q", s.Key)
		}
		seen[s.Key] = true
		if !membershipGroups[s.Group] {
			t.Errorf("%s: unknown group %q", s.Key, s.Group)
		}
		if !strings.HasPrefix(s.Href, "/admin/") {
			t.Errorf("%s: href %q must start with /admin/", s.Key, s.Href)
		}
		if !membershipSQL.MatchString(s.SQL) {
			t.Errorf("%s: SQL does not match the membership shape: %s", s.Key, s.SQL)
		}
	}
}

func TestMembershipSpecs_LinksResolveToRealAdminPages(t *testing.T) {
	root := filepath.Join("..", "..", "..", "frontend-admin", "app")
	if _, err := os.Stat(root); err != nil {
		t.Skip("frontend-admin not in this checkout — cannot resolve membership links")
	}
	for _, s := range membershipSpecs {
		path := strings.ReplaceAll(s.Href, "{userId}", "[id]")
		page := filepath.Join(root, filepath.FromSlash(path), "page.tsx")
		if _, err := os.Stat(page); err != nil {
			t.Errorf("%s: href %q has no page (%s)", s.Key, s.Href, page)
		}
	}
}

func TestMembershipSpecs_ColumnsExist_LiveDB(t *testing.T) {
	pool := overviewLivePool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	for _, s := range membershipSpecs {
		var n int64
		var since *string
		if err := pool.QueryRow(ctx, s.SQL, "00000000-0000-0000-0000-000000000000").Scan(&n, &since); err != nil {
			t.Errorf("%s: query fails against the migrated schema: %v\n  %s", s.Key, err, s.SQL)
		}
	}
}
