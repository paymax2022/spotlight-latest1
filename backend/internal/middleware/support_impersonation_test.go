package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/services"
)

// Unit coverage for the ESTD-D028 read-only view-as guards. No database:
// ImpersonationSessions is faked.

type fakeImpersonationSessions struct {
	resolveOut SupportImpersonation
	resolveErr error

	recorded   []ImpersonationRequestEvent
	refusals   []string
	finished   []int
	recordErr  error
	finishErr  error
	resolveGot struct{ sid, actor, hash string }
}

func (f *fakeImpersonationSessions) Resolve(_ context.Context, sessionID, actorUserID, actorTokenHash string) (SupportImpersonation, error) {
	f.resolveGot.sid, f.resolveGot.actor, f.resolveGot.hash = sessionID, actorUserID, actorTokenHash
	return f.resolveOut, f.resolveErr
}

func (f *fakeImpersonationSessions) RecordRequest(_ context.Context, _ SupportImpersonation, ev ImpersonationRequestEvent) (int64, error) {
	f.recorded = append(f.recorded, ev)
	if f.recordErr != nil {
		return 0, f.recordErr
	}
	return int64(len(f.recorded)), nil
}

func (f *fakeImpersonationSessions) FinishRequest(_ context.Context, _ int64, status int) error {
	f.finished = append(f.finished, status)
	return f.finishErr
}

func (f *fakeImpersonationSessions) RecordRefusal(_ context.Context, _, event string, ev ImpersonationRequestEvent) error {
	f.refusals = append(f.refusals, event+":"+ev.Detail)
	return nil
}

func impersonationTestEngine(store ImpersonationSessions, enabled bool) *gin.Engine {
	gin.SetMode(gin.TestMode)
	opts := SupportImpersonationOptions{Enabled: enabled, Sessions: func() ImpersonationSessions { return store }}
	r := gin.New()
	r.Use(GuardSupportImpersonation(opts))
	g := r.Group("/api/finance")
	g.Use(func(c *gin.Context) { // stands in for RequireAuthContext
		c.Set(AuthUserContextKey, domain.AuthenticatedUser{ID: "agent-1"})
		c.Set(AuthTokenContextKey, "agent-tok")
		c.Set("user_id", "agent-1")
		c.Next()
	})
	g.Use(ApplySupportImpersonation(opts))
	g.GET("/estate/:id/dashboard", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"user": c.GetString("user_id")})
	})
	g.POST("/estate/:id/dues/invoices", func(c *gin.Context) { c.Status(http.StatusCreated) })
	r.GET("/api/other/ping", func(c *gin.Context) { c.Status(http.StatusOK) })
	return r
}

func impersonationReq(t *testing.T, r *gin.Engine, method, path, sid string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), method, path, nil)
	if sid != "" {
		req.Header.Set(SupportImpersonationHeader, sid)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestImpersonation_NoHeaderUntouched(t *testing.T) {
	r := impersonationTestEngine(&fakeImpersonationSessions{}, true)
	if w := impersonationReq(t, r, http.MethodPost, "/api/finance/estate/e1/dues/invoices", ""); w.Code != http.StatusCreated {
		t.Fatalf("request without header must be untouched, got %d", w.Code)
	}
}

func TestImpersonation_DisabledRefuses(t *testing.T) {
	r := impersonationTestEngine(&fakeImpersonationSessions{}, false)
	w := impersonationReq(t, r, http.MethodGet, "/api/finance/estate/e1/dashboard", "s-1")
	if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), CodeImpersonationDisabled) {
		t.Fatalf("disabled flag must refuse 403 %s, got %d %s", CodeImpersonationDisabled, w.Code, w.Body.String())
	}
}

// The core invariant: while viewing-as, a mutation is refused BEFORE auth,
// routing or the handler — money movement included.
func TestImpersonation_MutationRefusedBeforeHandler(t *testing.T) {
	fs := &fakeImpersonationSessions{}
	r := impersonationTestEngine(fs, true)
	for _, m := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		w := impersonationReq(t, r, m, "/api/finance/estate/e1/dashboard", "s-1")
		if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), CodeImpersonationReadOnly) {
			t.Fatalf("%s must be refused 403 %s, got %d %s", m, CodeImpersonationReadOnly, w.Code, w.Body.String())
		}
	}
	// A mutation on a money path that does exist gets the same refusal.
	w := impersonationReq(t, r, http.MethodPost, "/api/finance/estate/e1/dues/invoices", "s-1")
	if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), CodeImpersonationReadOnly) {
		t.Fatalf("POST dues invoice must be refused read-only, got %d %s", w.Code, w.Body.String())
	}
	if len(fs.refusals) == 0 {
		t.Fatal("refused mutations must be audited against the session")
	}
}

func TestImpersonation_NonAllowListedReadRefused(t *testing.T) {
	r := impersonationTestEngine(&fakeImpersonationSessions{}, true)
	w := impersonationReq(t, r, http.MethodGet, "/api/other/ping", "s-1")
	if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), CodeImpersonationNotAllowed) {
		t.Fatalf("non-allow-listed read must refuse 403 %s, got %d", CodeImpersonationNotAllowed, w.Code)
	}
}

func TestImpersonation_UnknownRouteRefused(t *testing.T) {
	r := impersonationTestEngine(&fakeImpersonationSessions{}, true)
	w := impersonationReq(t, r, http.MethodGet, "/api/finance/estate/e1/not-a-route", "s-1")
	if w.Code != http.StatusForbidden {
		t.Fatalf("unmatched route with header must refuse, got %d", w.Code)
	}
}

func TestImpersonation_InvalidSession403(t *testing.T) {
	fs := &fakeImpersonationSessions{resolveErr: ErrImpersonationNotFound}
	r := impersonationTestEngine(fs, true)
	w := impersonationReq(t, r, http.MethodGet, "/api/finance/estate/e1/dashboard", "s-1")
	if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), CodeImpersonationInvalid) {
		t.Fatalf("invalid session must refuse 403 %s, got %d", CodeImpersonationInvalid, w.Code)
	}
}

func TestImpersonation_ExpiredSession403(t *testing.T) {
	fs := &fakeImpersonationSessions{resolveErr: ErrImpersonationExpired}
	r := impersonationTestEngine(fs, true)
	w := impersonationReq(t, r, http.MethodGet, "/api/finance/estate/e1/dashboard", "s-1")
	if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), CodeImpersonationExpired) {
		t.Fatalf("expired session must refuse 403 %s, got %d", CodeImpersonationExpired, w.Code)
	}
	if len(fs.refusals) == 0 || fs.refusals[0] != "expired:session_expired" {
		t.Fatalf("expired use must be audited, refusals=%v", fs.refusals)
	}
}

func TestImpersonation_AuditFailureFailsClosed(t *testing.T) {
	fs := &fakeImpersonationSessions{
		resolveOut: SupportImpersonation{SessionID: "s-1", ActorUserID: "agent-1", TargetUserID: "target-1"},
		recordErr:  errors.New("audit down"),
	}
	r := impersonationTestEngine(fs, true)
	w := impersonationReq(t, r, http.MethodGet, "/api/finance/estate/e1/dashboard", "s-1")
	if w.Code != http.StatusServiceUnavailable || !strings.Contains(w.Body.String(), CodeImpersonationAuditFail) {
		t.Fatalf("unaudited request must fail closed 503, got %d %s", w.Code, w.Body.String())
	}
}

func TestImpersonation_ValidSessionSwapsIdentity(t *testing.T) {
	fs := &fakeImpersonationSessions{
		resolveOut: SupportImpersonation{SessionID: "s-1", ActorUserID: "agent-1", TargetUserID: "target-1"},
	}
	r := impersonationTestEngine(fs, true)
	w := impersonationReq(t, r, http.MethodGet, "/api/finance/estate/e1/dashboard", "s-1")
	if w.Code != http.StatusOK {
		t.Fatalf("valid session must be served, got %d %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "target-1") {
		t.Fatalf("handler must see the TARGET user, got %s", w.Body.String())
	}
	if w.Header().Get("X-Support-Impersonation-Active") != "s-1" {
		t.Fatal("response must echo the active session id")
	}
	// Session resolution binds to the agent AND their bearer token.
	if fs.resolveGot.actor != "agent-1" || fs.resolveGot.hash != services.HashToken("agent-tok") {
		t.Fatalf("resolve got (%q,%q), want agent-1 + sha256(agent-tok)", fs.resolveGot.actor, fs.resolveGot.hash)
	}
	if len(fs.recorded) != 1 || len(fs.finished) != 1 || fs.finished[0] != http.StatusOK {
		t.Fatalf("expected one audited request stamped with 200, recorded=%v finished=%v", fs.recorded, fs.finished)
	}
}

func TestImpersonation_NilStoreFailsClosed(t *testing.T) {
	r := impersonationTestEngine(nil, true)
	w := impersonationReq(t, r, http.MethodGet, "/api/finance/estate/e1/dashboard", "s-1")
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("no session store must fail closed, got %d", w.Code)
	}
}

// The allow-list must only ever contain GETs, and every entry must be a route
// actually registered under the finance estate group — a stale entry silently
// widens nothing, but a missing one makes the notice promise false.
func TestSupportImpersonationAllowListIsUnderFinance(t *testing.T) {
	src, err := os.ReadFile("../app/finance_routes.go")
	if err != nil {
		t.Fatalf("read finance_routes.go: %v", err)
	}
	body := string(src)
	if !strings.Contains(body, `estGroup := finance.Group("/estate")`) {
		t.Fatal("estate routes must hang off the finance group")
	}
	if !strings.Contains(body, "finance.Use(guards.applyImpersonation())") {
		t.Fatal("finance group must mount ApplySupportImpersonation")
	}
	for route := range supportImpersonationReadRoutes {
		method, path, _ := strings.Cut(route, " ")
		if method != http.MethodGet {
			t.Fatalf("allow-list must stay read-only GETs, found %s", route)
		}
		rel := strings.TrimPrefix(path, "/api/finance/estate")
		if rel == path {
			t.Fatalf("allow-listed route %s is outside /api/finance/estate", route)
		}
		if !strings.Contains(body, `estGroup.GET("`+rel+`"`) {
			t.Fatalf("allow-listed route %s not registered under estGroup", route)
		}
	}
}
