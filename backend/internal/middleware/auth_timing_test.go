package middleware

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/services"
)

// captureAuthTiming swaps the log sink and threshold for one test.
func captureAuthTiming(t *testing.T, threshold time.Duration) func() []string {
	t.Helper()
	var mu sync.Mutex
	var lines []string
	prevLog := authTimingLogf
	authTimingLogf = func(f string, a ...any) {
		mu.Lock()
		defer mu.Unlock()
		lines = append(lines, fmt.Sprintf(f, a...))
	}
	prevThreshold := time.Duration(slowAuthThresholdNs.Load())
	SetSlowAuthThreshold(threshold)
	t.Cleanup(func() {
		authTimingLogf = prevLog
		SetSlowAuthThreshold(prevThreshold)
	})
	return func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), lines...)
	}
}

// slowRBAC delays individual lookups so each step has a known cost.
type slowRBAC struct {
	statusRBAC
	roles, perms time.Duration
}

func (s slowRBAC) GetUserRoles(context.Context, string) ([]string, error) {
	time.Sleep(s.roles)
	return []string{"admin"}, nil
}

func (s slowRBAC) GetUserPermissions(context.Context, string, string, string) ([]string, error) {
	time.Sleep(s.perms)
	return []string{"audit.logs.view"}, nil
}

const secretToken = "dummy-bearer-value"

func goodSupabase(t *testing.T, delay time.Duration) *integrations.SupabaseRestClient {
	t.Helper()
	srv := authUserServer(t, http.StatusOK, `{"id":"11111111-1111-4111-8111-111111111111","email":"a@b.test"}`)
	t.Cleanup(srv.Close)
	if delay > 0 {
		srv.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			time.Sleep(delay)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"11111111-1111-4111-8111-111111111111","email":"a@b.test"}`))
		})
	}
	return integrations.NewSupabaseRestClient(srv.URL, "key")
}

func serve(r *gin.Engine) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/users/11111111-1111-4111-8111-111111111111/navigation", nil)
	req.Header.Set("Authorization", "Bearer "+secretToken)
	r.ServeHTTP(w, req)
	return w
}

func authEngine(sb *integrations.SupabaseRestClient, rbac services.RBACService) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(RequireAuthContext(sb, rbac))
	r.GET("/users/:id/navigation", func(c *gin.Context) { c.Status(http.StatusOK) })
	return r
}

func TestAuthTimingPolicy(t *testing.T) {
	tm := authTiming{total: 800 * time.Millisecond}
	if !tm.shouldLog(750 * time.Millisecond) {
		t.Error("over the threshold must log")
	}
	if !(authTiming{total: 750 * time.Millisecond}).shouldLog(750 * time.Millisecond) {
		t.Error("exactly at the threshold must log")
	}
	if (authTiming{total: 749 * time.Millisecond}).shouldLog(750 * time.Millisecond) {
		t.Error("under the threshold must not log")
	}
	if tm.shouldLog(0) || tm.shouldLog(-time.Second) {
		t.Error("a zero or negative threshold turns logging off")
	}
}

func TestAuthTimingNamesTheSlowestStep(t *testing.T) {
	for want, tm := range map[string]authTiming{
		"token":  {token: 5 * time.Second, status: time.Second, roles: time.Second, perms: time.Second},
		"status": {token: time.Second, status: 5 * time.Second, roles: time.Second, perms: time.Second},
		"roles":  {token: time.Second, status: time.Second, roles: 5 * time.Second, perms: time.Second},
		"perms":  {token: time.Second, status: time.Second, roles: time.Second, perms: 5 * time.Second},
	} {
		if got, _ := tm.slowest(); got != want {
			t.Errorf("slowest = %s, want %s", got, want)
		}
	}
}

func TestAuthTimingLineHasTheRouteTemplateAndNoIdentity(t *testing.T) {
	tm := authTiming{total: 6210 * time.Millisecond, token: 1200 * time.Millisecond, status: 4900 * time.Millisecond, roles: 5100 * time.Millisecond, perms: 5300 * time.Millisecond, inflight: 21}
	line := tm.line(http.MethodGet, "/api/admin/users/:id/navigation")
	for _, want := range []string{"[auth-timing]", "GET", "/api/admin/users/:id/navigation", "total=6210ms", "token=1200ms", "status=4900ms", "roles=5100ms", "perms=5300ms", "slowest=perms", "inflight=21"} {
		if !strings.Contains(line, want) {
			t.Errorf("line %q is missing %q", line, want)
		}
	}
	if strings.Contains(line, "Bearer") {
		t.Error("the line must never carry credentials")
	}
	if tm.line(http.MethodGet, "") == "" || !strings.Contains(tm.line(http.MethodGet, ""), "(unmatched)") {
		t.Error("an unmatched route is labelled, not blank")
	}
}

func TestSlowAuthIsLoggedWithPerStepTimings(t *testing.T) {
	lines := captureAuthTiming(t, 20*time.Millisecond)
	r := authEngine(goodSupabase(t, 0), slowRBAC{statusRBAC: statusRBAC{status: "active"}, roles: 90 * time.Millisecond, perms: 10 * time.Millisecond})
	if w := serve(r); w.Code != http.StatusOK {
		t.Fatalf("auth behaviour changed: %d", w.Code)
	}
	got := lines()
	if len(got) != 1 {
		t.Fatalf("want exactly one slow-auth line, got %d: %v", len(got), got)
	}
	l := got[0]
	if !strings.Contains(l, "/users/:id/navigation") || !strings.Contains(l, "slowest=roles") {
		t.Errorf("line = %q", l)
	}
	if strings.Contains(l, secretToken) || strings.Contains(l, "11111111-1111-4111") {
		t.Errorf("the line leaked the token or the user id: %q", l)
	}
}

func TestFastAuthAndDisabledLoggingAreSilent(t *testing.T) {
	lines := captureAuthTiming(t, 5*time.Second)
	r := authEngine(goodSupabase(t, 0), slowRBAC{statusRBAC: statusRBAC{status: "active"}, roles: 30 * time.Millisecond})
	serve(r)
	if got := lines(); len(got) != 0 {
		t.Fatalf("fast request logged: %v", got)
	}
	off := captureAuthTiming(t, 0)
	serve(r)
	if got := off(); len(got) != 0 {
		t.Fatalf("disabled logging still logged: %v", got)
	}
}

func TestSlowTokenCheckIsLoggedEvenWhenAuthFails(t *testing.T) {
	lines := captureAuthTiming(t, 10*time.Millisecond)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(60 * time.Millisecond)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)
	r := authEngine(integrations.NewSupabaseRestClient(srv.URL, "key"), statusRBAC{status: "active"})
	if w := serve(r); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("a failing auth backend must still be a 503, got %d", w.Code)
	}
	got := lines()
	if len(got) != 1 || !strings.Contains(got[0], "slowest=token") {
		t.Fatalf("a slow failing token check must be logged: %v", got)
	}
}

// The point of the in-flight figure: it shows queueing under a burst.
func TestInflightShowsBurstConcurrencyAndReturnsToZero(t *testing.T) {
	lines := captureAuthTiming(t, time.Millisecond)
	r := authEngine(goodSupabase(t, 0), slowRBAC{statusRBAC: statusRBAC{status: "active"}, roles: 80 * time.Millisecond})
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); serve(r) }()
	}
	wg.Wait()
	maxSeen := 0
	for _, l := range lines() {
		var n int
		if i := strings.Index(l, "inflight="); i >= 0 {
			fmt.Sscanf(l[i:], "inflight=%d", &n)
		}
		if n > maxSeen {
			maxSeen = n
		}
	}
	if maxSeen < 2 {
		t.Errorf("a burst of 8 reported at most %d in flight", maxSeen)
	}
	if got := authInflight.Load(); got != 0 {
		t.Errorf("in-flight counter leaked: %d", got)
	}
}

// The counter covers the AUTH stage only, never the handler that runs after it.
func TestInflightExcludesTheHandler(t *testing.T) {
	captureAuthTiming(t, time.Hour)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(RequireAuthContext(goodSupabase(t, 0), statusRBAC{status: "active"}))
	var during int64 = -1
	r.GET("/users/:id/navigation", func(c *gin.Context) { during = authInflight.Load(); c.Status(http.StatusOK) })
	serve(r)
	if during != 0 {
		t.Fatalf("in-flight during the handler = %d, want 0", during)
	}
}

func TestInflightIsReleasedOnEveryRejection(t *testing.T) {
	captureAuthTiming(t, time.Hour)
	r := authEngine(goodSupabase(t, 0), statusRBAC{status: "suspended"})
	for i := 0; i < 5; i++ {
		if w := serve(r); w.Code != http.StatusForbidden {
			t.Fatalf("suspended must be 403, got %d", w.Code)
		}
	}
	if got := authInflight.Load(); got != 0 {
		t.Fatalf("rejected requests leaked the in-flight counter: %d", got)
	}
}
