package tests

// ---------------------------------------------------------------------------
// Property Management suite — authz + flag-gate integration tests.
//
// Mirrors the real route wiring in backend/internal/app/finance_routes.go
// (L1387-1404): propGroup.Use(mapsAuth()) sets user_id + the AuthUserContextKey
// authUser; only /rent-passport/lookup/:userId carries an extra
// middleware.RequirePermission(rbac, "property.manage") hop before the
// handler. registerPropertyRoutes here reproduces that shape with a stub auth
// middleware standing in for mapsAuth() (real Supabase token validation is
// covered elsewhere — see internal/middleware auth tests), so these tests can
// focus on the property-specific authz/flag behavior documented in
// docs/qa/modules/property.md §4 (PROPERTY-AUTHZ-005/006/014/015,
// PROPERTY-SEC-001).
//
// Per docs/qa/modules/property.md §6, the lookup endpoint is the top
// object-level-authorization risk in this package: it returns ANOTHER user's
// payment history, gated ONLY by a global "property.manage" permission with no
// per-target ownership check.
// ---------------------------------------------------------------------------

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/property"
	"spotlight/backend/internal/services"
	"spotlight/backend/internal/testsupport"
)

// ── Fake RBACService implementations ──────────────────────────────────────
//
// Both embed the (large) RBACService interface as a nil value, per the
// convention in internal/crowdfunding/adminext/routes_authz_test.go: a call to
// anything other than CheckPermission nil-panics loudly instead of quietly
// returning a zero value, so an accidental dependency on an unstubbed method
// fails LOUDLY rather than silently passing.

type denyAllRBAC struct {
	services.RBACService
	asked []string
}

func (d *denyAllRBAC) CheckPermission(userID, permission, scopeType, scopeID string) (bool, error) {
	d.asked = append(d.asked, permission)
	return false, nil
}

type allowAllRBAC struct {
	services.RBACService
	asked []string
}

func (a *allowAllRBAC) CheckPermission(userID, permission, scopeType, scopeID string) (bool, error) {
	a.asked = append(a.asked, permission)
	return true, nil
}

// registerPropertyRoutes reproduces finance_routes.go's conditional
// registration under FeaturePropertySuiteEnabled. authUserID is injected by a
// stub middleware standing in for mapsAuth()/RequireAuthContext.
func registerPropertyRoutes(r *gin.Engine, enabled bool, h *property.Handler, rbac services.RBACService, authUserID string) {
	if !enabled {
		return
	}
	g := r.Group("/api/finance/property")
	g.Use(func(c *gin.Context) {
		c.Set("user_id", authUserID)
		c.Set(middleware.AuthUserContextKey, domain.AuthenticatedUser{ID: authUserID})
		c.Next()
	})
	g.GET("/context", h.GetContext)
	g.POST("/context/switch", h.SwitchContext)
	g.GET("/rent-passport/me", h.GetMyRentPassport)
	g.GET("/rent-passport/lookup/:userId",
		middleware.RequirePermission(rbac, "property.manage"),
		h.LookupRentPassport)
}

var propertyRoutePaths = []struct{ method, path string }{
	{"GET", "/api/finance/property/context"},
	{"POST", "/api/finance/property/context/switch"},
	{"GET", "/api/finance/property/rent-passport/me"},
	{"GET", "/api/finance/property/rent-passport/lookup/11111111-1111-1111-1111-111111111111"},
}

// ── PROPERTY-SEC-001: flag off => all 4 routes absent (404), not just denied ──
//
// Pure/no-DB: with the flag off, the route group is never registered at all,
// so gin's own "no matching route" 404 fires before any auth/RBAC/DB code
// runs — distinguishing "route absent" from "route present but 401/403".
func TestPropertyRoutes_FlagOff_AllFourRoutesAbsent(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	// h/rbac are never invoked when enabled=false; nil is safe.
	registerPropertyRoutes(r, false, nil, nil, "irrelevant-user")

	for _, rp := range propertyRoutePaths {
		t.Run(rp.method+" "+rp.path, func(t *testing.T) {
			w := httptest.NewRecorder()
			req := httptest.NewRequest(rp.method, rp.path, strings.NewReader("{}"))
			req.Header.Set("Content-Type", "application/json")
			r.ServeHTTP(w, req)
			if w.Code != http.StatusNotFound {
				t.Errorf("flag off: %s %s = %d, want 404 (route must not be registered at all)", rp.method, rp.path, w.Code)
			}
		})
	}
}

// Sanity counterpart: with the flag on, the same 4 routes DO exist in the
// router (proving registerPropertyRoutes' shape actually matches the 4
// documented endpoints, so the flag-off test above is meaningful and not
// vacuously true from a typo).
func TestPropertyRoutes_FlagOn_AllFourRoutesRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	svc := property.NewService(nil) // never called: RBAC denies before the handler for lookup,
	// and this sub-test only inspects r.Routes(), it never calls ServeHTTP.
	h := property.NewHandler(svc)
	registerPropertyRoutes(r, true, h, &denyAllRBAC{}, "u")

	got := map[string]bool{}
	for _, ri := range r.Routes() {
		got[ri.Method+" "+ri.Path] = true
	}
	want := []string{
		"GET /api/finance/property/context",
		"POST /api/finance/property/context/switch",
		"GET /api/finance/property/rent-passport/me",
		"GET /api/finance/property/rent-passport/lookup/:userId",
	}
	for _, w := range want {
		if !got[w] {
			t.Errorf("route %q not registered when flag is on: %v", w, got)
		}
	}
}

// ── PROPERTY-AUTHZ-015: lookup denied without property.manage, no leak ──────
//
// Pure/no-DB: the deny-all RBAC middleware aborts BEFORE the handler runs, so
// this proves the block happens at the middleware layer regardless of what the
// DB would have returned — service is backed by a nil pool on purpose; if this
// test ever reaches the handler (a regression that removes the RequirePermission
// call) it will panic on the nil pool instead of silently passing, which is the
// point.
func TestPropertyLookup_DeniedWithoutPermission_NoPassportLeaked(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	svc := property.NewService(nil)
	h := property.NewHandler(svc)
	rbac := &denyAllRBAC{}
	registerPropertyRoutes(r, true, h, rbac, "caller-without-permission")

	target := uuid.NewString()
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/finance/property/rent-passport/lookup/"+target, nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("lookup without property.manage = %d, want 403", w.Code)
	}
	if len(rbac.asked) != 1 || rbac.asked[0] != "property.manage" {
		t.Fatalf("RequirePermission asked for %v, want exactly [\"property.manage\"]", rbac.asked)
	}
	body := w.Body.String()
	if strings.Contains(body, "totalPaidKobo") || strings.Contains(body, "score") || strings.Contains(body, "recentPayments") {
		t.Fatalf("403 response body leaks passport-shaped fields: %s", body)
	}
}

// ── Live-DB: allowed lookup returns the TARGET's passport, not the caller's ─

func newPropertyAuthzTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB property authz test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping test db: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func seedPropertyAuthzUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.NewString()
	ctx := context.Background()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email, created_at) VALUES ($1,$2,NOW())`, id, id+"@property-authz.invalid"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM auth.users WHERE id=$1`, id) })
	testsupport.CleanupUser(t, pool, id)
	return id
}

// TestLiveDB_PropertyLookup_AllowedPermission_ReturnsTargetNotCaller is
// PROPERTY-AUTHZ-014: a caller WITH property.manage looks up userT and must
// receive userT's passport — the object-level-authz check this whole endpoint
// exists to prove is scoped to the PATH param, not the caller's own identity.
func TestLiveDB_PropertyLookup_AllowedPermission_ReturnsTargetNotCaller(t *testing.T) {
	pool := newPropertyAuthzTestPool(t)
	ctx := context.Background()

	caller := seedPropertyAuthzUser(t, pool)
	target := seedPropertyAuthzUser(t, pool)

	// Target has payment history; caller has NONE — if the lookup ever leaked
	// the caller's own (empty) passport instead of the target's, this would
	// still show comparable=0/score=0, so seed a due date deliberately to make
	// a wrong-user swap detectable via totalPaidKobo too.
	estateID := uuid.NewString()
	admin := seedPropertyAuthzUser(t, pool)
	if _, err := pool.Exec(ctx, `INSERT INTO estates (id, name, admin_id) VALUES ($1,'Lookup Estate',$2)`, estateID, admin); err != nil {
		t.Fatalf("seed estate: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM estates WHERE id=$1`, estateID) })
	invoiceID := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO estate_dues_invoices (id, estate_id, resident_id, category, amount_kobo, due_date)
		 VALUES ($1,$2,$3,'rent',500000, NOW() + interval '1 day')`,
		invoiceID, estateID, target); err != nil {
		t.Fatalf("seed invoice: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM estate_dues_invoices WHERE id=$1`, invoiceID) })
	payID := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO estate_payments (id, estate_id, invoice_id, payer_id, amount_kobo, method, status)
		 VALUES ($1,$2,$3,$4,500000,'wallet','successful')`,
		payID, estateID, invoiceID, target); err != nil {
		t.Fatalf("seed payment: %v", err)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM estate_payments WHERE id=$1`, payID) })

	gin.SetMode(gin.TestMode)
	r := gin.New()
	svc := property.NewService(pool)
	h := property.NewHandler(svc)
	rbac := &allowAllRBAC{}
	registerPropertyRoutes(r, true, h, rbac, caller)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/finance/property/rent-passport/lookup/"+target, nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("allowed lookup = %d, want 200, body=%s", w.Code, w.Body.String())
	}
	var rp property.RentPassport
	if err := json.Unmarshal(w.Body.Bytes(), &rp); err != nil {
		t.Fatalf("decode passport: %v", err)
	}
	if rp.UserID != target {
		t.Fatalf("lookup returned passport for userId=%q, want the TARGET %q (caller was %q) — IDOR risk", rp.UserID, target, caller)
	}
	if rp.TotalPaidKobo != 500000 {
		t.Errorf("target totalPaidKobo = %d, want 500000 (the caller has zero payments; a wrong-user swap would show 0)", rp.TotalPaidKobo)
	}
}

// ── Live-DB: fail-closed SwitchContext over HTTP, no row written ──────────
//
// PROPERTY-AUTHZ-006 exercised through the real HTTP surface (context_test.go
// already proves this at the service layer directly; this proves the handler
// wiring surfaces it as 403 and that the DB effect — or lack of one — is
// identical through the full request path).
func TestLiveDB_SwitchContext_HTTP_FailClosedNoWrite(t *testing.T) {
	pool := newPropertyAuthzTestPool(t)
	ctx := context.Background()
	caller := seedPropertyAuthzUser(t, pool)
	unheldAgency := uuid.NewString()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	svc := property.NewService(pool)
	h := property.NewHandler(svc)
	registerPropertyRoutes(r, true, h, &denyAllRBAC{}, caller) // rbac unused by this route

	body := `{"contextType":"agency","contextId":"` + unheldAgency + `"}`
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/finance/property/context/switch", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("switch into unheld agency = %d, want 403, body=%s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "activeContext") {
		t.Errorf("403 body should not echo an activeContext: %s", w.Body.String())
	}

	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM property_active_context WHERE user_id=$1`, caller).Scan(&count); err != nil {
		t.Fatalf("query property_active_context: %v", err)
	}
	if count != 0 {
		t.Fatalf("property_active_context has %d row(s) after a refused HTTP switch, want 0", count)
	}
}
